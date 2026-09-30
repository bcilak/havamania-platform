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
