/*
 * Sohbetin uçtan uca testi (sahte servislerle):
 *   npm run mock            (ayrı terminalde)
 *   npm run e2e -- setup
 *   npm run smoke:chat
 *   npm run e2e -- teardown
 */
import { SignJWT } from "jose";
import postgres from "postgres";
import { decrypt } from "../src/lib/crypto";

const BASE = (process.env.APP_URL || "http://localhost:3110").replace(/\/$/, "");
const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
const results: { name: string; ok: boolean; detail: string }[] = [];
const check = (name: string, ok: boolean, detail = "") => results.push({ name, ok, detail });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const [bot] = await sql`select id, public_key, token_secret_enc from bots order by created_at limit 1`;
const secret = decrypt(bot.token_secret_enc);
const appToken = (sub: string) =>
  new SignJWT({}).setProtectedHeader({ alg: "HS256" }).setSubject(sub).setIssuedAt().setExpirationTime("10m").sign(new TextEncoder().encode(secret));

// Test alanı (playground) isteği yönetici oturumu ister; oturum uygulamanın SESSION_SECRET'ıyla üretilir.
const [admin] = await sql`select id, email, name, role from admin_users where role = 'super_admin' and active order by created_at limit 1`;
const adminCookie = `hm_admin=${await new SignJWT({ role: admin.role, email: admin.email, name: admin.name })
  .setProtectedHeader({ alg: "HS256" })
  .setSubject(admin.id)
  .setAudience("admin")
  .setIssuedAt()
  .setExpirationTime("10m")
  .sign(new TextEncoder().encode(process.env.SESSION_SECRET!))}`;

/** Test alanı isteği; akış varsa sonuna kadar okunur. */
async function playChat(body: Record<string, unknown>) {
  const res = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: adminCookie },
    body: JSON.stringify({ playground: true, ...body }),
  });
  if (!res.ok) return { status: res.status, error: ((await res.json().catch(() => ({}))) as { error?: string }).error ?? "" };
  // Akış satırlarından cevap metni (test alanında atıflar [n] görünür).
  let text = "";
  for (const line of (await res.text().catch(() => "")).split("\n")) {
    if (!line.startsWith("data: ") || line === "data: [DONE]") continue;
    try {
      const ev = JSON.parse(line.slice(6));
      if (ev.type === "text-delta") text += ev.delta;
    } catch {
      /* akış dışı satır */
    }
  }
  return { status: res.status, error: "", text };
}

async function session(deviceId: string, userToken?: string) {
  const [{ v }] = await sql`select coalesce((value->>'consentVersion')::int, 1) as v from settings where key = 'kvkk' union all select 1 limit 1`;
  const res = await fetch(`${BASE}/api/widget/session`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `10.0.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` },
    body: JSON.stringify({ botKey: bot.public_key, deviceId, platform: "ios", userToken, consentVersion: v }),
  });
  return res.json();
}

/** Akışı sonuna kadar okur; metni ve araç parçalarını döner. */
async function chat(token: string, body: Record<string, unknown>, abortAfterMs?: number) {
  const ctrl = new AbortController();
  if (abortAfterMs) setTimeout(() => ctrl.abort(), abortAfterMs);
  const res = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
    signal: ctrl.signal,
  });
  if (!res.ok) return { status: res.status, text: "", tools: [] as string[], error: (await res.json().catch(() => ({}))).error as string };
  let text = "";
  const tools: string[] = [];
  let messageId = "";
  try {
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data: ") || line === "data: [DONE]") continue;
        const ev = JSON.parse(line.slice(6));
        if (ev.type === "text-delta") text += ev.delta;
        if (ev.type === "tool-input-available") tools.push(ev.toolName);
        if (ev.type === "start" && ev.messageId) messageId = ev.messageId;
      }
    }
  } catch {
    /* bilerek iptal edildi */
  }
  return { status: res.status, text, tools, messageId, error: "" };
}

/* ---------- 1. Akış, araç çağrısı, kayıt ---------- */
const dev = `e2e-${Date.now()}`;
const s = await session(dev);
check("Oturum açıldı", typeof s.token === "string", JSON.stringify(s).slice(0, 80));
const conv = crypto.randomUUID();
const r1 = await chat(s.token, { conversationId: conv, mode: "genel", text: "Bugün hava nasıl, şemsiye gerekir mi?", location: { lat: 39.65, lon: 27.88, name: "Balıkesir" } });
check("Cevap akıyor", r1.status === 200 && r1.text.length > 20, `${r1.status} · ${r1.text.slice(0, 60)}`);
check("Araç çağrıldı (current_weather)", r1.tools.includes("current_weather"), r1.tools.join(","));
await sleep(400);
const [saved] = await sql`select id, content, tool_calls, input_tokens, output_tokens, cost_usd, model from messages where conversation_id = ${conv} and role = 'assistant'`;
check(
  "Cevap veritabanında: araç çıktısı, token, maliyet",
  !!saved && saved.tool_calls.length === 1 && saved.tool_calls[0].output?.ok === true && saved.input_tokens > 0 && Number(saved.cost_usd) > 0,
  saved ? `${saved.model} · ${saved.input_tokens}+${saved.output_tokens} · $${saved.cost_usd}` : "yok",
);
// Mod ayarındaki en uzun cevap (token) sağlayıcıya max_tokens / max_completion_tokens olarak gitmeli.
const MOCK = (process.env.MOCK_URL || "http://localhost:3199").replace(/\/$/, "");
const lastCall = await fetch(`${MOCK}/__last-chat`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
const [{ cap }] = await sql`select coalesce((v.config->'modes'->'genel'->>'maxOutputTokens')::int, 700) as cap from bots b join bot_versions v on v.id = b.published_version_id where b.id = ${bot.id}`;
check(
  "Model isteğinde max_tokens = mod ayarı (genel)",
  lastCall === null ? true : (lastCall.max_tokens ?? lastCall.max_completion_tokens) === cap,
  lastCall === null ? "mock /__last-chat yok (eski mock; yeniden başlatın), atlandı" : `istek ${lastCall.max_tokens ?? lastCall.max_completion_tokens} · ayar ${cap}`,
);
check("İstemcideki mesaj kimliği = veritabanındaki", r1.messageId === saved?.id, `${r1.messageId?.slice(0, 8)} / ${saved?.id?.slice(0, 8)}`);

/* ---------- 2. Mod koruması ---------- */
const r2 = await chat(s.token, { conversationId: conv, mode: "fly", text: "türbülans?" });
check("Başka moddan mesaj reddedildi (409)", r2.status === 409, `${r2.status} ${r2.error}`);

/* ---------- 3. Gizlilik: aynı cihaz, farklı hesaplar ---------- */
const shared = `e2e-paylasilan-${Date.now()}`;
const a = await session(shared, await appToken("e2e_kullanici_A"));
const convA = crypto.randomUUID();
await chat(a.token, { conversationId: convA, mode: "genel", text: "A'nın özel sorusu" });
await sleep(300);
const b = await session(shared, await appToken("e2e_kullanici_B"));
check("B, A'nın konuşmasını görmüyor", b.token && !b.conversation, JSON.stringify(b.conversation)?.slice(0, 60) ?? "konuşma yok");
const a2 = await session(shared, await appToken("e2e_kullanici_A"));
check("A geri gelince kendi konuşması dönüyor", a2.conversation?.id === convA, a2.conversation?.id?.slice(0, 8) ?? "yok");
const anon = await session(shared);
check("Aynı cihazda anonim oturum da A'yı görmüyor", anon.token && !anon.conversation, "");
const bSteal = await chat(b.token, { conversationId: convA, mode: "genel", text: "A'nın konuşmasına yazmayı dene" });
check("B, A'nın konuşmasına yazamıyor (404)", bSteal.status === 404, `${bSteal.status}`);

/* ---------- 4. Durdur: kesilen cevap kaydediliyor ---------- */
const convStop = crypto.randomUUID();
const r4 = await chat(s.token, { conversationId: convStop, mode: "agro", text: "YAVAS bir cevap ver lütfen" }, 1500);
await sleep(1500);
const [stopped] = await sql`select content, output_tokens from messages where conversation_id = ${convStop} and role = 'assistant'`;
check("Durdurulan cevap yarım metniyle kaydedildi", !!stopped && stopped.content.includes("durdurdu") && stopped.content.startsWith("Test cevab") && stopped.output_tokens > 0, stopped ? `${stopped.content.slice(0, 50)}… · ${stopped.output_tokens} token` : `kayıt yok (${r4.status})`);

/* ---------- 4b. Retrieval: ilgililik eşiği ve "cevapsız" kuralı (e2e setup sahte embedding + "E2E SSS" kurar) ---------- */
const convNoKb = crypto.randomUUID();
await chat(s.token, { conversationId: convNoKb, mode: "genel", text: "Blorfkuantum zxwvq mekanizması işliyor mu" });
await sleep(400);
const [noKb] = await sql`select unanswered, sources from messages where conversation_id = ${convNoKb} and role = 'assistant'`;
check("Bilgi tabanında karşılığı olmayan soru: unanswered=true, sources=[]", !!noKb && noKb.unanswered === true && noKb.sources.length === 0, noKb ? `unanswered=${noKb.unanswered} · ${noKb.sources.length} kaynak` : "kayıt yok");
const convKb = crypto.randomUUID();
const rKb = await chat(s.token, { conversationId: convKb, mode: "genel", text: "Zirvepulsar katsayısı nedir?" });
await sleep(400);
const [withKb] = await sql`select unanswered, sources from messages where conversation_id = ${convKb} and role = 'assistant'`;
const top = withKb?.sources?.[0];
check(
  "Bilgi tabanındaki SSS bulunuyor: sources[0].similarity dolu, unanswered=false",
  !!top && typeof top.similarity === "number" && top.similarity > 0.3 && withKb.unanswered === false,
  top ? `${top.title} · benzerlik ${top.similarity}` : "kaynak yok",
);

/* ---------- 4b2. Takip sorusu sorgusu, kısaltma araması, [n] atıf, embedding maliyeti ---------- */
// Sahte model, bilgi tabanı parçası verilince [1] ile atıf yapar (eski mock: /__last-chat "cites" alanı yok → atıf kontrolleri atlanır).
const mockCites = (await fetch(`${MOCK}/__last-chat`).then((r) => (r.ok ? r.json() : null)).catch(() => null))?.cites === true;
const sF = await session(`e2e-takip-${Date.now()}`);
const convF = crypto.randomUUID();
await chat(sF.token, { conversationId: convF, mode: "genel", text: "Zirvepulsar katsayısı nedir?" });
await sleep(300);
await chat(sF.token, { conversationId: convF, mode: "genel", text: "peki yarın?" });
await sleep(400);
const [fu] = await sql`select search_query, sources from messages where conversation_id = ${convF} and role = 'assistant' order by created_at desc limit 1`;
check(
  "Takip sorusu: arama sorgusu önceki kullanıcı mesajıyla birleşti ve SSS bulundu",
  !!fu && fu.search_query?.includes("Zirvepulsar") && fu.search_query.includes("peki yarın") && fu.sources.some((x: { title: string }) => x.title === "E2E SSS"),
  fu ? `sorgu="${fu.search_query}" · ${fu.sources.length} kaynak` : "kayıt yok",
);
const [single] = await sql`select search_query from messages where conversation_id = ${convKb} and role = 'assistant'`;
check("Bağımsız soruda sorgu yalnızca o mesajdır", single?.search_query === "Zirvepulsar katsayısı nedir?", `${single?.search_query}`);

const convAbbr = crypto.randomUUID();
await chat(sF.token, { conversationId: convAbbr, mode: "genel", text: "FQ kısaltması ne demek" });
await sleep(400);
const [ab] = await sql`select sources from messages where conversation_id = ${convAbbr} and role = 'assistant'`;
const abHit = ab?.sources?.find((x: { title: string }) => x.title === "E2E kısaltma");
check("2 harfli kısaltma (FQ) tam eşleşmeyle bulunuyor (lexical=true)", !!abHit && abHit.lexical === true, abHit ? `${abHit.title} · lexical=${abHit.lexical}` : "kaynak yok");

const [kbMsg] = await sql`select content, sources, cost_usd, input_tokens, output_tokens, embedding_tokens, embedding_cost_usd from messages where conversation_id = ${convKb} and role = 'assistant'`;
if (mockCites) {
  check("Son kullanıcı akışında ve kayıtlı cevapta [n] atfı yok", !/\[\d/.test(rKb.text) && !/\[\d/.test(kbMsg?.content ?? "[1]") && rKb.text.length > 20, `akış: ${rKb.text.slice(-60).replace(/\n/g, " ")}`);
  const pg = await playChat({ conversationId: crypto.randomUUID(), mode: "genel", text: "Zirvepulsar katsayısı nedir?" });
  await sleep(500);
  const [pm] = await sql`select m.content, m.sources from messages m join conversations c on c.id = m.conversation_id where m.role = 'assistant' and c.platform = 'playground' order by m.created_at desc limit 1`;
  check(
    "Test alanı: akışta [1] görünür, kayıtta kaynak cited=true, kayıtlı metinde [n] yok",
    /\[1\]/.test(pg.text ?? "") && pm?.sources?.[0]?.cited === true && !/\[\d/.test(pm.content),
    `cited=${pm?.sources?.[0]?.cited} · akışta [1]: ${/\[1\]/.test(pg.text ?? "")}`,
  );
  check("Widget cevabında kaynak cited=true işaretli (panelde görünür)", kbMsg?.sources?.[0]?.cited === true, `cited=${kbMsg?.sources?.[0]?.cited}`);
} else {
  check("[n] atıf kontrolleri atlandı (mock eski; npm run mock'u yeniden başlatın)", true, "atlandı");
}

const [embProv] = await sql`select embedding_prices from providers where name = 'E2E sahte model'`;
const embPrice = Number(embProv?.embedding_prices?.["mock-embed"] ?? 0);
const [modelMeta] = await sql`select (models->0->>'inputPer1M')::float as inp, (models->0->>'outputPer1M')::float as outp from providers where name = 'E2E sahte model'`;
const modelCost = (kbMsg.input_tokens / 1e6) * modelMeta.inp + (kbMsg.output_tokens / 1e6) * modelMeta.outp;
const embCost = (kbMsg.embedding_tokens / 1e6) * embPrice;
check(
  "Sorgu embedding'i: embedding_tokens > 0 ve cost_usd = model + embedding maliyeti",
  kbMsg.embedding_tokens > 0 && embPrice > 0 && Math.abs(Number(kbMsg.embedding_cost_usd) - embCost) < 2e-6 && Math.abs(Number(kbMsg.cost_usd) - (modelCost + embCost)) < 3e-6,
  `${kbMsg.embedding_tokens} token · embedding $${kbMsg.embedding_cost_usd} · toplam $${kbMsg.cost_usd} (beklenen ${(modelCost + embCost).toFixed(6)})`,
);
const [ingested] = await sql`select embedding_tokens, embedding_cost_usd from kb_sources where bot_id = ${bot.id} and title = 'E2E SSS' and deleted_at is null order by created_at desc limit 1`;
check("Ingest embedding'i kaynağa yazıldı (embedding_tokens > 0, maliyet = token × fiyat)", ingested?.embedding_tokens > 0 && Math.abs(Number(ingested.embedding_cost_usd) - (ingested.embedding_tokens / 1e6) * embPrice) < 2e-6, `${ingested?.embedding_tokens} token · $${ingested?.embedding_cost_usd}`);
const { periodStats } = await import("../src/lib/stats");
const st = await periodStats(1);
check(
  "Pano maliyeti: model + arama + vektörleme toplamı (test alanı hariç)",
  st.search_cost > 0 && st.ingest_cost > 0 && Math.abs(st.cost - (st.model_cost + st.search_cost + st.ingest_cost)) < 1e-4,
  `toplam $${st.cost.toFixed(6)} = model ${st.model_cost.toFixed(6)} + arama ${st.search_cost.toFixed(6)} + vektörleme ${st.ingest_cost.toFixed(6)}`,
);

/* ---------- 4c. Canlı veri araçları: hata yolları (mock: #arac:<ad>:<q>, q = __500 | __timeout | __badjson) ---------- */
// Ayrı oturum: ana kullanıcının dakikalık sınırını harcamasın. Zaman aşımı testi entegrasyon timeoutMs'e (e2e setup: 5 sn) kadar sürer.
const s2 = await session(`e2e-arac-${Date.now()}`);
const toolFailures: { label: string; text: string; code: string }[] = [
  { label: "500", text: "#arac:current_weather:__500 blorfkuantum", code: "http_500" },
  { label: "zaman aşımı", text: "#arac:current_weather:__timeout blorfkuantum", code: "timeout" },
  { label: "bozuk JSON", text: "#arac:current_weather:__badjson blorfkuantum", code: "bad_json" },
  { label: "konumsuz istek", text: "#arac:current_weather: blorfkuantum", code: "no_location" }, // location gönderilmez
];
for (const f of toolFailures) {
  const conv = crypto.randomUUID();
  const r = await chat(s2.token, { conversationId: conv, mode: "genel", text: f.text });
  await sleep(500);
  const [m] = await sql`select tool_calls, unanswered, error, content from messages where conversation_id = ${conv} and role = 'assistant'`;
  const call = m?.tool_calls?.[0];
  check(
    `Araç hatası (${f.label}): akış tamamlandı, output.ok=false, code=${f.code}, unanswered=true`,
    r.status === 200 && r.tools.includes("current_weather") && r.text.length > 0 && !!m && !m.error && call?.output?.ok === false && call.output.code === f.code && m.unanswered === true,
    m ? `${r.status} · code=${call?.output?.code} · unanswered=${m.unanswered} · error=${m.error ?? "-"}` : `kayıt yok (${r.status})`,
  );
}

/* ---------- 4d. Test alanı: sürüm seçimi (target) ---------- */
const [pub] = await sql`select v.id, v.number from bots b join bot_versions v on v.id = b.published_version_id where b.id = ${bot.id}`;
if (pub) {
  const convPub = crypto.randomUUID();
  const rp = await playChat({ conversationId: convPub, mode: "genel", text: "Merhaba, yayındaki sürümle deniyorum", target: "published" });
  await sleep(400);
  const [cp] = await sql`select version_number, platform from conversations where id = ${convPub}`;
  check("Test alanı target=published: konuşma yayındaki sürüm numarasında, platform=playground", rp.status === 200 && cp?.version_number === pub.number && cp?.platform === "playground", `${rp.status} · v${cp?.version_number} / yayında v${pub.number} · ${cp?.platform}`);

  const convVer = crypto.randomUUID();
  const rv = await playChat({ conversationId: convVer, mode: "genel", text: "Belirli sürümle deniyorum", target: { versionId: pub.id } });
  await sleep(400);
  const [cv] = await sql`select version_number from conversations where id = ${convVer}`;
  check("Test alanı target={versionId}: konuşma o sürümün numarasında", rv.status === 200 && cv?.version_number === pub.number, `${rv.status} · v${cv?.version_number}`);
}
const convDraft = crypto.randomUUID();
const rd = await playChat({ conversationId: convDraft, mode: "genel", text: "Taslakla deniyorum" });
await sleep(400);
const [cd] = await sql`select version_number from conversations where id = ${convDraft}`;
check("Test alanı varsayılan hedef taslak: version_number boş", rd.status === 200 && cd?.version_number === null, `${rd.status} · ${cd?.version_number}`);
const badVer = await playChat({ conversationId: crypto.randomUUID(), mode: "genel", text: "x", target: { versionId: crypto.randomUUID() } });
const badVer2 = await playChat({ conversationId: crypto.randomUUID(), mode: "genel", text: "x", target: { versionId: "gecersiz" } });
check("Test alanı: bu bota ait olmayan / geçersiz versionId 404 'Sürüm bulunamadı.'", badVer.status === 404 && badVer2.status === 404 && badVer.error === "Sürüm bulunamadı.", `${badVer.status},${badVer2.status} · ${badVer.error}`);
const badTarget = await playChat({ conversationId: crypto.randomUUID(), mode: "genel", text: "x", target: "baska" });
check("Test alanı: geçersiz target biçimi 400", badTarget.status === 400, `${badTarget.status}`);
const noAdmin = await fetch(`${BASE}/api/chat`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ conversationId: crypto.randomUUID(), mode: "genel", text: "x", playground: true, target: "published" }),
});
check("Test alanı: oturumsuz istek 401", noAdmin.status === 401, `${noAdmin.status}`);
// Widget isteğinde target yok sayılır: geçersiz sürüm kimliği bile hata vermez, konuşma yayındaki sürümde açılır.
const convWidget = crypto.randomUUID();
const rw = await chat(s2.token, { conversationId: convWidget, mode: "genel", text: "Widget target'ı yok saymalı", target: { versionId: crypto.randomUUID() } });
await sleep(400);
const [cw] = await sql`select version_number, platform from conversations where id = ${convWidget}`;
check("Widget isteğinde target yok sayılır (yayındaki sürüm, playground değil)", rw.status === 200 && (!pub || cw?.version_number === pub.number) && cw?.platform !== "playground", `${rw.status} · v${cw?.version_number} · ${cw?.platform}`);

/* ---------- 4e. Kayıtlı test senaryoları: koşu konuşma yazmaz; ölçütler, maliyet sınırı, tek koşu, iptal, yarıda kalan ---------- */
// Koşu motoru süreç içinde çağrılır (eylem yalnızca after() ile aynı fonksiyonu çalıştırır).
const { getMainBot } = await import("../src/lib/bot");
const { cancelEvalRun, executeEvalRun, startEvalRun } = await import("../src/lib/eval-run");
const evBot = await getMainBot();
const evTag = `smoke-eval-${Date.now()}`;
const [kbE2e] = await sql`select id from kb_sources where bot_id = ${bot.id} and title = 'E2E SSS' order by created_at desc limit 1`;
const mkCase = async (question: string, expect: Record<string, unknown>) =>
  (await sql`insert into eval_cases (bot_id, mode, question, expect, note, created_by) values (${bot.id}, 'genel', ${question}, ${sql.json(expect as never)}, ${evTag}, 'smoke') returning id`)[0].id as string;
const caseA = await mkCase("Zirvepulsar katsayısı nedir?", { mustInclude: ["ZİRVEPULSAR"], mustNotInclude: ["kesinlikle bilmiyorum"], expectSourceId: kbE2e?.id ?? null, expectUnanswered: false });
const caseB = await mkCase("Yarın hava nasıl olacak?", { mustInclude: [], mustNotInclude: [], expectTool: "agro_conditions" });
const caseC = await mkCase("Zirvepulsar katsayısı nedir, bir daha söyler misin?", { mustInclude: ["test cevabı"], mustNotInclude: [] });
const count = async () => {
  const [{ m, c }] = await sql`select (select count(*)::int from messages) as m, (select count(*)::int from conversations) as c`;
  return { m: m as number, c: c as number };
};
const toCaseRow = (c: Record<string, unknown>) =>
  ({ id: c.id, botId: c.bot_id, mode: c.mode, question: c.question, location: c.location, expect: c.expect, note: c.note, sourceMessageId: null, createdBy: c.created_by, createdAt: c.created_at, updatedAt: null }) as never;
const before = await count();
const started = await startEvalRun({ bot: evBot, target: "published", caseIds: [caseA, caseB], maxCostUsd: 1, actorEmail: "smoke" });
let dupMsg = "";
try {
  await startEvalRun({ bot: evBot, target: "published", caseIds: [caseA], maxCostUsd: 1, actorEmail: "smoke" });
} catch (e) {
  dupMsg = (e as Error).message;
}
check("Senaryo koşusu: çalışan koşu varken ikinci koşu reddedilir", dupMsg.includes("Zaten çalışan"), dupMsg);
await executeEvalRun({ runId: started.runId, bot: evBot, target: started.target, cases: started.cases, maxCostUsd: started.maxCostUsd });
const [run1] = await sql`select status, summary, cost_usd, version_number from eval_runs where id = ${started.runId}`;
const res1 = await sql`select case_id, passed, checks, sources, tool_calls, input_tokens, cost_usd, latency_ms from eval_results where run_id = ${started.runId}`;
const rA = res1.find((r) => r.case_id === caseA);
const rB = res1.find((r) => r.case_id === caseB);
check("Senaryo koşusu: done, 2 sonuç, biri geçti biri kaldı", run1?.status === "done" && res1.length === 2 && rA?.passed === true && rB?.passed === false, `${run1?.status} · ${res1.length} sonuç · A=${rA?.passed} B=${rB?.passed}`);
check(
  "Senaryo koşusu: kalma nedeni (araç), kaynak ve token/maliyet/gecikme kaydedildi",
  !!rB && (rB.checks as { ok: boolean; id: string }[]).some((c) => c.id === "tool" && !c.ok) && !!rA && (rA.sources as unknown[]).length > 0 && rA.input_tokens > 0 && Number(run1.cost_usd) > 0 && rA.latency_ms >= 0 && run1.summary.passed === 1 && run1.summary.failed === 1,
  `kaynak ${(rA?.sources as unknown[])?.length} · $${run1?.cost_usd}`,
);
const after1 = await count();
check("Senaryo koşusu konuşma/mesaj yazmaz (messages ve conversations sayısı değişmedi)", after1.m === before.m && after1.c === before.c, `mesaj ${before.m}→${after1.m} · konuşma ${before.c}→${after1.c}`);

// Başlamadan tahmin: önceki koşudan ortalama maliyet bilinir; sınır çok düşükse koşu hiç başlamaz.
let estMsg = "";
try {
  await startEvalRun({ bot: evBot, target: "draft", caseIds: [caseA, caseB, caseC], maxCostUsd: 0.000001, actorEmail: "smoke" });
} catch (e) {
  estMsg = (e as Error).message;
}
check("Senaryo koşusu: tahmini maliyet sınırı aşarsa başlamaz", estMsg.includes("Tahmini maliyet"), estMsg);

// Koşu sırasında maliyet sınırı: kayıt elle açılır (tahmin kapısını atlar), motor ilk iki senaryodan sonra durur.
const runSummary = (total: number, maxCostUsd: number, lastActivityAt = new Date().toISOString()) => ({ total, completed: 0, passed: 0, failed: 0, unchecked: 0, maxCostUsd, skipped: 0, lastActivityAt });
const [limRun] = await sql`insert into eval_runs (bot_id, target, status, started_by, summary) values (${bot.id}, ${sql.json("published")}, 'running', 'smoke', ${sql.json(runSummary(3, 0.000001))}) returning id`;
const limCases = (await sql`select * from eval_cases where id in ${sql([caseA, caseB, caseC])} order by created_at`).map(toCaseRow);
await executeEvalRun({ runId: limRun.id, bot: evBot, target: "published", cases: limCases, maxCostUsd: 0.000001 });
const [limDone] = await sql`select status, summary, (select count(*)::int from eval_results where run_id = ${limRun.id}) as n from eval_runs where id = ${limRun.id}`;
check("Senaryo koşusu: maliyet sınırı aşılınca durur, kalan senaryo çalışmaz", limDone?.status === "done" && limDone.summary.stoppedBy === "cost" && limDone.n < 3 && limDone.summary.skipped >= 1, `${limDone?.status} · ${limDone?.n}/3 sonuç · stoppedBy=${limDone?.summary?.stoppedBy}`);

// İptal: iptal edilmiş koşuda hiçbir senaryo çalışmaz.
const [canRun] = await sql`insert into eval_runs (bot_id, target, status, started_by, summary) values (${bot.id}, ${sql.json("published")}, 'running', 'smoke', ${sql.json(runSummary(3, 1))}) returning id`;
const cancelled = await cancelEvalRun(bot.id, canRun.id);
await executeEvalRun({ runId: canRun.id, bot: evBot, target: "published", cases: limCases, maxCostUsd: 1 });
const [canDone] = await sql`select status, (select count(*)::int from eval_results where run_id = ${canRun.id}) as n from eval_runs where id = ${canRun.id}`;
check("Senaryo koşusu: iptal edilen koşuda senaryo çalışmaz, durum cancelled kalır", cancelled && canDone?.status === "cancelled" && canDone.n === 0, `${canDone?.status} · ${canDone?.n} sonuç`);

// Yarıda kalan: 40 dakikadır ilerlemeyen "running" koşu yeni koşuyu engellemez ve failed olur.
const [staleRun] = await sql`insert into eval_runs (bot_id, target, status, started_by, started_at, summary) values (${bot.id}, ${sql.json("published")}, 'running', 'smoke', now() - interval '40 minutes', ${sql.json(runSummary(1, 1, new Date(Date.now() - 40 * 60_000).toISOString()))}) returning id`;
const afterStale = await startEvalRun({ bot: evBot, target: "published", caseIds: [caseA], maxCostUsd: 1, actorEmail: "smoke" });
const [staleNow] = await sql`select status from eval_runs where id = ${staleRun.id}`;
check("Senaryo koşusu: 15 dakikadır ilerlemeyen koşu 'failed' olur, yeni koşu başlar", staleNow?.status === "failed" && !!afterStale.runId, `${staleNow?.status}`);

await sql`delete from eval_runs where started_by = 'smoke' and bot_id = ${bot.id}`;
await sql`delete from eval_cases where note = ${evTag}`;

/* ---------- 5. Hız sınırı ---------- */
let limited = 0;
for (let i = 0; i < 12; i++) {
  const r = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${s.token}` },
    body: JSON.stringify({ conversationId: crypto.randomUUID(), mode: "genel", text: "" }),
  });
  if (r.status === 429) limited++;
  await r.body?.cancel();
}
check("Kullanıcı başına dakikalık sınır devrede", limited > 0, `${limited}/12 istek 429`);

await sql.end();
const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? "✓" : "✗"} ${r.name}${r.detail ? `  (${r.detail})` : ""}`);
console.log(`\n${results.length - failed.length}/${results.length} başarılı`);
process.exit(failed.length ? 1 : 0);
