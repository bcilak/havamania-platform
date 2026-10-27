/*
 * Veriyi değiştiren server action'ların uçtan uca testi. Her adım sonunda
 * durumu eski hâline döndürür. Önce `npm run build && npm run start`.
 *   npm run smoke:actions
 */
import fs from "node:fs";
import { SignJWT } from "jose";
import postgres from "postgres";

const BASE = (process.env.APP_URL || "http://localhost:3110").replace(/\/$/, "");
const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
const results: { name: string; ok: boolean; detail: string }[] = [];
const check = (name: string, ok: boolean, detail = "") => results.push({ name, ok, detail });

const manifest = JSON.parse(fs.readFileSync(".next/server/server-reference-manifest.json", "utf8"));
function actionId(name: string, page: string): string {
  for (const [id, v] of Object.entries<{ exportedName?: string; workers: Record<string, unknown> }>(manifest.node)) {
    if (v.exportedName === name && `app${page}/page` in v.workers) return id;
  }
  throw new Error(`Action bulunamadı: ${name} @ ${page}`);
}

const [admin] = await sql`select id, email, name, role from admin_users where role = 'super_admin' and active order by created_at limit 1`;
const token = await new SignJWT({ role: admin.role, email: admin.email, name: admin.name })
  .setProtectedHeader({ alg: "HS256" })
  .setSubject(admin.id)
  .setAudience("admin")
  .setIssuedAt()
  .setExpirationTime("10m")
  .sign(new TextEncoder().encode(process.env.SESSION_SECRET!));

/** Bir server action'ı tarayıcının yaptığı gibi çağırır; yönlendirme adresini döner. */
async function act(page: string, name: string, fields: Record<string, string | string[]>, url = page): Promise<string> {
  // JavaScript'siz form gönderimi (progressive enhancement): tarayıcının yaptığının aynısı.
  const fd = new FormData();
  fd.append(`$ACTION_ID_${actionId(name, page)}`, "");
  for (const [k, v] of Object.entries(fields)) for (const x of Array.isArray(v) ? v : [v]) fd.append(k, x);
  const res = await fetch(BASE + url, { method: "POST", headers: { cookie: `hm_admin=${token}` }, body: fd, redirect: "manual" });
  return decodeURIComponent(res.headers.get("location") ?? "");
}

/* ---------- 1. CMS: sahneyi kaydet, yayınla, sitede gör, geri al ---------- */
type Scene = Record<string, unknown> & {
  captions: { eyebrow: string; title: string; sub: string }[];
  chips: Record<string, string>[];
  screen1: Record<string, unknown> & { slots: Record<string, string>[] };
  screen2: Record<string, unknown> & { cards: Record<string, string>[] };
  screen3: Record<string, unknown> & { bubbles: Record<string, string>[] };
};
const [doc] = await sql`select draft, published from cms_documents where id = 'landing'`;
const original: Scene = doc.draft.scenes.core;

function sceneFields(s: Scene): Record<string, string> {
  const f: Record<string, string> = { section: "core" };
  s.captions.forEach((c, i) => Object.entries(c).forEach(([k, v]) => (f[`scene.captions.${i}.${k}`] = v)));
  s.chips.forEach((c, i) => Object.entries(c).forEach(([k, v]) => (f[`scene.chips.${i}.${k}`] = v)));
  for (const k of ["location", "temp", "condition"]) f[`scene.screen1.${k}`] = String(s.screen1[k]);
  s.screen1.slots.forEach((c, i) => Object.entries(c).forEach(([k, v]) => (f[`scene.screen1.slots.${i}.${k}`] = v)));
  for (const k of ["header", "ringValue", "ringLabel", "ringPercent", "title", "note"]) f[`scene.screen2.${k}`] = String(s.screen2[k]);
  for (let i = 0; i < 4; i++) {
    f[`scene.screen2.cards.${i}.title`] = s.screen2.cards[i]?.title ?? "";
    f[`scene.screen2.cards.${i}.text`] = s.screen2.cards[i]?.text ?? "";
  }
  f["scene.screen3.header"] = String(s.screen3.header);
  for (let i = 0; i < 6; i++) {
    f[`scene.screen3.bubbles.${i}.from`] = s.screen3.bubbles[i]?.from ?? "ai";
    f[`scene.screen3.bubbles.${i}.text`] = s.screen3.bubbles[i]?.text ?? "";
  }
  return f;
}

const edited: Scene = structuredClone(original);
edited.captions[0].title = "Dağınık ham veri — test.";
edited.screen2.cards = edited.screen2.cards.slice(0, 1);
let loc = await act("/admin/icerik", "saveSection", sceneFields(edited));
const [afterSave] = await sql`select draft from cms_documents where id = 'landing'`;
check(
  "CMS: sahne taslağa kaydedildi",
  loc.includes("ok=") && afterSave.draft.scenes.core.captions[0].title === edited.captions[0].title && afterSave.draft.scenes.core.screen2.cards.length === 1,
  loc,
);

const tooLong = structuredClone(original);
tooLong.chips[0].value = "123456789012345678";
loc = await act("/admin/icerik", "saveSection", sceneFields(tooLong));
check("CMS: çok uzun çip değeri reddedildi", loc.includes("hata=Panel sahnesi › Çipler › 1. › değer: en fazla 14 karakter"), loc);

loc = await act("/admin/icerik", "publishLanding", {});
const home = await (await fetch(BASE + "/")).text();
check("CMS: yayınlanan başlık sitede", loc.includes("ok=") && home.includes("Dağınık ham veri — test."), loc);

await act("/admin/icerik", "saveSection", sceneFields(original));
await act("/admin/icerik", "publishLanding", {});
const home2 = await (await fetch(BASE + "/")).text();
check("CMS: geri alındı", home2.includes(original.captions[0].title) && !home2.includes("— test."), "");

/* ---------- 2. Bilgi tabanı: soru-cevap ekle, arka planda işlensin ---------- */
const q = `Smoke testi sorusu ${Date.now()}`;
loc = await act("/admin/egitim/bilgi-tabani", "addQa", { question: q, answer: "Bu bir test cevabıdır.", mode: "all" });
let status = "";
for (let i = 0; i < 20 && status !== "ready"; i++) {
  await new Promise((r) => setTimeout(r, 300));
  [{ status } = { status: "" }] = await sql`select status from kb_sources where question = ${q}`;
}
check("Bilgi tabanı: SSS eklendi ve işlendi", loc.includes("ok=") && status === "ready", `${loc} · ${status}`);
await sql`delete from kb_sources where question = ${q}`;

/* URL kaynağı: iç ağ adresi reddedilir; mock sayfa (ALLOW_LOCAL_TARGETS=1 ve APP_URL localhost ise açık) işlenir */
loc = await act("/admin/egitim/bilgi-tabani", "addUrl", { url: "http://169.254.169.254/latest/meta-data", mode: "all" });
const [metaRow] = await sql`select id from kb_sources where url like 'http://169.254.%'`;
check("Bilgi tabanı: metadata adresi (SSRF) reddedildi", loc.includes("hata=") && loc.includes("iç ağa") && !metaRow, loc);
const mockPage = "http://127.0.0.1:3199/kb-test.html";
loc = await act("/admin/egitim/bilgi-tabani", "addUrl", { url: mockPage, mode: "all" });
let urlStatus = "";
for (let i = 0; i < 20 && urlStatus !== "ready" && urlStatus !== "failed"; i++) {
  await new Promise((r) => setTimeout(r, 300));
  [{ status: urlStatus } = { status: "" }] = await sql`select status from kb_sources where url = ${mockPage}`;
}
const [urlSrc] = await sql`select title, error from kb_sources where url = ${mockPage}`;
check(
  "Bilgi tabanı: URL kaynağı eklendi ve işlendi (ön koşul: mock çalışıyor; sunucuda ve .env.local'de ALLOW_LOCAL_TARGETS=1, APP_URL localhost)",
  loc.includes("ok=") && urlStatus === "ready" && urlSrc?.title === "Sahte bilgi sayfası",
  `${loc} · ${urlStatus} · ${urlSrc?.error ?? ""}`,
);
await sql`delete from kb_sources where url = ${mockPage}`;

/* ---------- 3. Kişilik → yayın → geri alma ---------- */
const [bot] = await sql`select id, draft_config, published_version_id from bots order by created_at limit 1`;
const agro = bot.draft_config.modes.agro;
loc = await act("/admin/egitim/kisilik", "saveMode", {
  modeId: "agro",
  enabled: "on",
  label: agro.label,
  greeting: agro.greeting,
  suggestions: agro.suggestions.join("\n"),
  instructions: agro.instructions,
  tone: "resmi",
  model: "",
  temperature: "0.3",
  tools: agro.tools,
});
const [b2] = await sql`select draft_config from bots where id = ${bot.id}`;
check("Kişilik: Agro tonu taslakta 'resmi'", loc.includes("ok=") && b2.draft_config.modes.agro.tone === "resmi", loc);

// Başlangıçtaki yayın gerçekten var olmalı; yoksa geri alma testi anlamsız olur.
const [origVersion] = await sql`select id, number from bot_versions where id = ${bot.published_version_id}`;
check("Yayın: başlangıçta yayındaki sürüm mevcut", Boolean(origVersion), origVersion ? `v${origVersion.number}` : "yok");

loc = await act("/admin/yayin", "publish", { note: "smoke testi", force: "on" });
const [b3] = await sql`select b.published_version_id, v.number, v.config from bots b join bot_versions v on v.id = b.published_version_id where b.id = ${bot.id}`;
const createdVersionId: string | null = b3 && b3.published_version_id !== bot.published_version_id ? b3.published_version_id : null;
check(
  "Yayın: yeni sürüm yayında",
  loc.includes("ok=") && Boolean(createdVersionId) && b3.config.modes.agro.tone === "resmi",
  `${loc} · v${b3?.number}`,
);

if (origVersion) {
  loc = await act("/admin/yayin", "rollback", { versionId: origVersion.id });
  const [b4] = await sql`select published_version_id from bots where id = ${bot.id}`;
  check("Yayın: önceki sürüme dönüldü", loc.includes("ok=") && b4.published_version_id === origVersion.id, loc);
}

/* ---------- 4. Yayın ve eğitim döngüsü doğrulukları ---------- */
const extraVersionIds: string[] = [];
const extraSourceQuestions: string[] = [];
const publishedNow = async () => (await sql`select published_version_id as id from bots where id = ${bot.id}`)[0].id as string;
const maxNumber = async () => (await sql`select coalesce(max(number), 0)::int as n from bot_versions where bot_id = ${bot.id}`)[0].n as number;

// (a) Sınırı aşan talimat sessizce kesilmez: hata verir, taslak değişmez.
const draftBefore = (await sql`select draft_config from bots where id = ${bot.id}`)[0].draft_config;
loc = await act("/admin/egitim/kisilik", "saveMode", {
  modeId: "agro",
  enabled: "on",
  label: agro.label,
  greeting: agro.greeting,
  suggestions: agro.suggestions.join("\n"),
  instructions: "x".repeat(12001),
  tone: "dengeli",
  model: "",
  temperature: "0.3",
  tools: agro.tools,
});
const draftAfter = (await sql`select draft_config from bots where id = ${bot.id}`)[0].draft_config;
check(
  "Kişilik: 12001 karakterlik talimat hata verir, taslak değişmez",
  loc.includes("hata=") && loc.includes("12000") && JSON.stringify(draftBefore) === JSON.stringify(draftAfter),
  loc,
);

// (b) Eşzamanlı iki yayın: iki farklı ve ardışık sürüm numarası, hata yok.
const n0 = await maxNumber();
const [r1, r2] = await Promise.all([
  act("/admin/yayin", "publish", { note: "smoke eşzamanlı 1", force: "on" }),
  act("/admin/yayin", "publish", { note: "smoke eşzamanlı 2", force: "on" }),
]);
const raced = await sql`select id, number from bot_versions where bot_id = ${bot.id} and number > ${n0} order by number`;
extraVersionIds.push(...raced.map((r) => r.id as string));
check(
  "Yayın: eşzamanlı iki yayın ardışık sürüm numarası üretir",
  r1.includes("ok=") && r2.includes("ok=") && raced.length === 2 && raced[0].number === n0 + 1 && raced[1].number === n0 + 2,
  `${r1} · ${r2} · ${raced.map((r) => r.number).join(",")}`,
);

// (c) Sağlayıcısı silinmiş sürüme force olmadan geri alınmaz; force ile alınır.
const [latest] = await sql`select config, kb_source_ids from bot_versions where id = ${await publishedNow()}`;
const brokenConfig = structuredClone(latest.config);
brokenConfig.modes.genel.enabled = true;
brokenConfig.modes.genel.providerId = "00000000-0000-0000-0000-000000000000";
brokenConfig.modes.genel.model = "silinmis-model";
const [broken] = await sql`
  insert into bot_versions (bot_id, number, config, kb_source_ids, note, published_by)
  values (${bot.id}, ${(await maxNumber()) + 1}, ${sql.json(brokenConfig)}, ${sql.json(latest.kb_source_ids)}, 'smoke bozuk sağlayıcı', 'smoke')
  returning id`;
extraVersionIds.push(broken.id as string);
const publishedBeforeRollback = await publishedNow();
loc = await act("/admin/yayin", "rollback", { versionId: broken.id });
check("Yayın: silinmiş sağlayıcılı sürüme force'suz geri alma reddedildi", loc.includes("hata=") && loc.includes("zorla=") && (await publishedNow()) === publishedBeforeRollback, loc);
loc = await act("/admin/yayin", "rollback", { versionId: broken.id, force: "on" });
check("Yayın: force ile geri alma çalışır", loc.includes("ok=") && (await publishedNow()) === broken.id, loc);

// (d) Düzeltme döngüsü: kayıt, "Yayın bekliyor" -> yayın -> "Yayında"; bekleyenleri yayına al config'i değiştirmez.
const cookie = { headers: { cookie: `hm_admin=${token}` } };
const waitReady = async (question: string) => {
  let st = "";
  for (let i = 0; i < 30 && st !== "ready"; i++) {
    await new Promise((r) => setTimeout(r, 300));
    [{ status: st } = { status: "" }] = await sql`select status from kb_sources where question = ${question}`;
  }
  return st;
};
const cq = `Smoke düzeltme sorusu ${Date.now()}`;
extraSourceQuestions.push(cq);
loc = await act("/admin/egitim/duzeltmeler", "addManualCorrection", { question: cq, answer: "Bu bir test düzeltmesidir.", mode: "all" });
const cStatus = await waitReady(cq);
const [corr] = await sql`select c.id, c.kb_source_id from corrections c where c.question = ${cq}`;
check("Düzeltme: corrections ve kb_sources birlikte yazıldı, kaynak işlendi", loc.includes("ok=") && Boolean(corr?.kb_source_id) && cStatus === "ready", `${loc} · ${cStatus}`);
let pageHtml = await (await fetch(BASE + "/admin/egitim/duzeltmeler", cookie)).text();
// Rozet, düzeltmenin sorusundan hemen önceki başlık satırındadır.
const badgeBefore = (html: string, question: string) => html.slice(Math.max(0, html.indexOf(question) - 1200), Math.max(0, html.indexOf(question)));
check("Düzeltme: yeni kayıt sayfada 'Yayın bekliyor'", badgeBefore(pageHtml, cq).includes("Yayın bekliyor"), "");

// Bekleyenleri yayına al: config yayındaki sürümle birebir aynı, kaynak listesi düzeltmeyi içerir.
const prePub = await publishedNow();
const [prePubRow] = await sql`select config from bot_versions where id = ${prePub}`;
loc = await act("/admin/yayin", "publishPendingCorrections", {});
const postPub = await publishedNow();
const [postPubRow] = await sql`select id, config, kb_source_ids from bot_versions where id = ${postPub}`;
if (postPub !== prePub) extraVersionIds.push(postPub);
check(
  "Düzeltme: 'bekleyenleri yayına al' config'i değiştirmez, düzeltmeyi sürüme ekler",
  loc.includes("ok=") && postPub !== prePub && JSON.stringify(postPubRow.config) === JSON.stringify(prePubRow.config) && (postPubRow.kb_source_ids as string[]).includes(corr.kb_source_id),
  loc,
);
pageHtml = await (await fetch(BASE + "/admin/egitim/duzeltmeler", cookie)).text();
check("Düzeltme: yayından sonra sayfada 'Yayında'", badgeBefore(pageHtml, cq).includes("Yayında"), "");

/* ---------- 5. Kişilik genişletmeleri: en uzun cevap, örnek konuşmalar, yasak konular, ton metinleri ---------- */
loc = await act("/admin/egitim/kisilik", "saveMode", {
  modeId: "agro",
  enabled: "on",
  label: agro.label,
  greeting: agro.greeting,
  suggestions: agro.suggestions.join("\n"),
  instructions: agro.instructions,
  tone: "dengeli",
  model: "",
  temperature: "0.3",
  maxOutputTokens: "450",
  exUser1: "Smoke örnek soru",
  exAssistant1: "Smoke örnek cevap",
  tools: agro.tools,
});
const [p1] = await sql`select draft_config from bots where id = ${bot.id}`;
const agroNow = p1.draft_config.modes.agro;
check(
  "Kişilik: en uzun cevap ve örnek konuşma taslağa kaydedildi",
  loc.includes("ok=") && agroNow.maxOutputTokens === 450 && agroNow.examples?.length === 1 && agroNow.examples[0].assistant === "Smoke örnek cevap",
  loc,
);
loc = await act("/admin/egitim/kisilik", "saveMode", {
  modeId: "agro",
  enabled: "on",
  label: agro.label,
  greeting: agro.greeting,
  suggestions: agro.suggestions.join("\n"),
  instructions: agro.instructions,
  tone: "dengeli",
  model: "",
  temperature: "0.3",
  exUser1: "yalnız soru",
  tools: agro.tools,
});
const [p2] = await sql`select draft_config from bots where id = ${bot.id}`;
check("Kişilik: yarım örnek çifti hata verir, taslak değişmez", loc.includes("hata=") && loc.includes("Örnek 1") && JSON.stringify(p2.draft_config) === JSON.stringify(p1.draft_config), loc);

loc = await act("/admin/egitim/kisilik", "saveRules", {
  guardrails: p1.draft_config.guardrails,
  fallbackMessage: p1.draft_config.fallbackMessage,
  blockedTopics: "smoke yasak 1\nsmoke yasak 2",
  tone_kisa: "Smoke ton metni: tek cümleyle cevapla.",
  toneReset_uzman: "on",
});
const [p3] = await sql`select draft_config from bots where id = ${bot.id}`;
check(
  "Kişilik: yasak konular ve ton metni kaydedildi (varsayılana dönen ton kayda girmez)",
  loc.includes("ok=") && JSON.stringify(p3.draft_config.blockedTopics) === JSON.stringify(["smoke yasak 1", "smoke yasak 2"]) && p3.draft_config.toneOverrides?.kisa?.startsWith("Smoke ton") && !p3.draft_config.toneOverrides?.uzman,
  loc,
);
loc = await act("/admin/egitim/kisilik", "saveRules", { guardrails: p1.draft_config.guardrails, fallbackMessage: "x", blockedTopics: "y".repeat(81) });
const [p4] = await sql`select draft_config from bots where id = ${bot.id}`;
check("Kişilik: 81 karakterlik yasak konu hata verir, taslak değişmez", loc.includes("hata=") && loc.includes("80") && JSON.stringify(p4.draft_config) === JSON.stringify(p3.draft_config), loc);

/* ---------- 6. Sürüm ayrıntısı: not düzenleme (audit) ve karşılaştırma ---------- */
const noteVersion = extraVersionIds[0]; // bu çalıştırmanın oluşturduğu sürüm; sonunda silinir
const auditCount = async () => (await sql`select count(*)::int as n from audit_log where action = 'bot.version_note'`)[0].n as number;
const a0 = await auditCount();
const oldNote = (await sql`select note from bot_versions where id = ${noteVersion}`)[0].note as string | null;
loc = await act("/admin/yayin", "saveVersionNote", { versionId: noteVersion, note: "smoke yeni not" });
const [noteRow] = await sql`select note from bot_versions where id = ${noteVersion}`;
const [noteAudit] = await sql`select detail from audit_log where action = 'bot.version_note' order by created_at desc limit 1`;
check(
  "Sürüm: not düzenlendi ve audit_log'a eski/yeni yazıldı",
  loc.includes("ok=") && noteRow.note === "smoke yeni not" && (await auditCount()) === a0 + 1 && noteAudit?.detail?.to === "smoke yeni not" && noteAudit?.detail?.from === oldNote,
  `${loc} · ${JSON.stringify(noteAudit?.detail)}`,
);
loc = await act("/admin/yayin", "saveVersionNote", { versionId: noteVersion, note: "n".repeat(301) });
const [noteRow2] = await sql`select note from bot_versions where id = ${noteVersion}`;
check("Sürüm: 301 karakterlik not hata verir, not değişmez", loc.includes("hata=") && loc.includes("300") && noteRow2.note === "smoke yeni not" && (await auditCount()) === a0 + 1, loc);

const detailRes = await fetch(`${BASE}/admin/yayin/${noteVersion}?karsilastir=taslak`, cookie);
const detailHtml = await detailRes.text();
check("Sürüm: karşılaştırma sayfası (sürüm ↔ taslak) 200", detailRes.status === 200 && detailHtml.includes("Bilgi tabanı") && detailHtml.includes("Embedding modeli") && detailHtml.includes("smoke yeni not"), `${detailRes.status}`);
if (origVersion) {
  const twoRes = await fetch(`${BASE}/admin/yayin/${noteVersion}?karsilastir=${origVersion.id}`, cookie);
  const twoHtml = await twoRes.text();
  check("Sürüm: iki sürümün karşılaştırması 200 ve başlığı", twoRes.status === 200 && twoHtml.includes(" → ") && twoHtml.includes(`v${origVersion.number}`), `${twoRes.status}`);
}
const missingRes = await fetch(`${BASE}/admin/yayin/00000000-0000-4000-8000-000000000000`, cookie);
check("Sürüm: olmayan sürüm kimliği 404", missingRes.status === 404, `${missingRes.status}`);

/* ---------- 7. Bilgi tabanı: düzenleme (halef satır), tekrar kontrolü, kaynak ayrıntısı, sayfalama ---------- */
const KB = "/admin/egitim/bilgi-tabani";
const KB_DETAIL = "/admin/egitim/bilgi-tabani/[id]";
const tag = Date.now();
const waitReadyId = async (sourceId: string) => {
  let st = "";
  for (let i = 0; i < 40 && st !== "ready" && st !== "failed"; i++) {
    await new Promise((r) => setTimeout(r, 300));
    [{ status: st } = { status: "" }] = await sql`select status from kb_sources where id = ${sourceId}`;
  }
  return st;
};
const chunkText = async (sourceId: string) => ((await sql`select content from kb_chunks where source_id = ${sourceId} order by idx`).map((r) => r.content as string).join("\n"));
const previewHits = async (target: "draft" | "published", text: string) => {
  const res = await fetch(BASE + "/api/admin/prompt-preview", {
    method: "POST",
    headers: { "content-type": "application/json", origin: BASE, cookie: `hm_admin=${token}` },
    body: JSON.stringify({ mode: "agro", text, target }),
  });
  const body = (await res.json().catch(() => ({}))) as { hits?: { relevant: boolean; content: string }[] };
  return (body.hits ?? []).filter((h) => h.relevant).map((h) => h.content).join("\n");
};

// (a) Yayındaki SSS düzenlenince yayın eski cevabı, taslak yeni cevabı döndürür; eski satır korunur.
const eq1 = `Smoke düzenleme sorusu ${tag}`;
extraSourceQuestions.push(eq1);
await act(KB, "addQa", { question: eq1, answer: `ESKICEVAP${tag} burada.`, mode: "all" });
const [qa1] = await sql`select id from kb_sources where question = ${eq1}`;
check("Düzenleme: SSS eklendi ve işlendi", Boolean(qa1) && (await waitReadyId(qa1.id)) === "ready", "");
const pubForEdit = await act("/admin/yayin", "publish", { note: "smoke düzenleme", force: "on" });
extraVersionIds.push(await publishedNow());
check("Düzenleme: SSS'yi içeren sürüm yayınlandı", pubForEdit.includes("ok=") && ((await sql`select kb_source_ids from bot_versions where id = ${await publishedNow()}`)[0].kb_source_ids as string[]).includes(qa1.id), pubForEdit);

loc = await act(KB_DETAIL, "updateSource", { id: qa1.id, question: eq1, answer: `YENICEVAP${tag} burada.`, mode: "all" }, `${KB}/${qa1.id}`);
const [oldRow] = await sql`select superseded_by from kb_sources where id = ${qa1.id}`;
const nextId = oldRow?.superseded_by as string | null;
check("Düzenleme: yayındaki SSS yerinde değişmedi, halef satır açıldı", loc.includes("ok=") && Boolean(nextId) && nextId !== qa1.id, loc);
if (nextId) {
  const nextState = await waitReadyId(nextId);
  const [pubRow] = await sql`select kb_source_ids from bot_versions where id = ${await publishedNow()}`;
  check("Düzenleme: yayındaki sürüm eski satırda kaldı, halef sürümde değil", (pubRow.kb_source_ids as string[]).includes(qa1.id) && !(pubRow.kb_source_ids as string[]).includes(nextId), "");
  check("Düzenleme: eski parça eski cevabı, halef parça yeni cevabı taşır", nextState === "ready" && (await chunkText(qa1.id)).includes(`ESKICEVAP${tag}`) && (await chunkText(nextId)).includes(`YENICEVAP${tag}`), nextState);
  const pubSeen = await previewHits("published", eq1);
  const draftSeen = await previewHits("draft", eq1);
  check("Düzenleme: yayındaki sürüm eski cevabı, taslak yeni cevabı döndürür", pubSeen.includes(`ESKICEVAP${tag}`) && !pubSeen.includes(`YENICEVAP${tag}`) && draftSeen.includes(`YENICEVAP${tag}`) && !draftSeen.includes(`ESKICEVAP${tag}`), `yayın: ${pubSeen.slice(0, 60)} · taslak: ${draftSeen.slice(0, 60)}`);

  const detail = await fetch(`${BASE}${KB}/${qa1.id}`, cookie);
  const detailHtml = await detail.text();
  const [{ n: nChunks }] = await sql`select count(*)::int as n from kb_chunks where source_id = ${qa1.id}`;
  const [{ chunk_count: cc }] = await sql`select chunk_count from kb_sources where id = ${qa1.id}`;
  check("Ayrıntı: kaynak sayfası 200, parça sayısı chunk_count'a eşit, halef zinciri görünür", detail.status === 200 && cc === nChunks && detailHtml.includes(`Parçalar (${cc})`) && detailHtml.includes("Halef") && detailHtml.includes("Vektör"), `${detail.status} · ${cc}/${nChunks}`);
  const headDetail = await (await fetch(`${BASE}${KB}/${nextId}`, cookie)).text();
  check("Ayrıntı: güncel kayıt öncülünü ve sürüm bağlantısını gösterir", headDetail.includes("Öncül") && headDetail.includes("Hiçbir sürümde yok") && detailHtml.includes("/admin/yayin/"), "");
}
const missingKb = await fetch(`${BASE}${KB}/00000000-0000-4000-8000-000000000000`, cookie);
const badKb = await fetch(`${BASE}${KB}/yok`, cookie);
check("Ayrıntı: olmayan / geçersiz kaynak kimliği 404", missingKb.status === 404 && badKb.status === 404, `${missingKb.status},${badKb.status}`);

// (b) Korunmayan (hiç yayınlanmamış) SSS yerinde güncellenir.
const eq2 = `Smoke yerinde düzenleme ${tag}`;
extraSourceQuestions.push(eq2);
await act(KB, "addQa", { question: eq2, answer: `ILKCEVAP${tag}`, mode: "agro" });
const [qa2] = await sql`select id from kb_sources where question = ${eq2}`;
await waitReadyId(qa2.id);
loc = await act(KB_DETAIL, "updateSource", { id: qa2.id, question: eq2, answer: `SONCEVAP${tag}`, mode: "agro" }, `${KB}/${qa2.id}`);
const st2 = await waitReadyId(qa2.id);
const [row2] = await sql`select superseded_by from kb_sources where id = ${qa2.id}`;
const [{ n: rows2 }] = await sql`select count(*)::int as n from kb_sources where question = ${eq2}`;
check("Düzenleme: yayınlanmamış SSS aynı satırda güncellendi ve yeniden işlendi", loc.includes("ok=") && st2 === "ready" && !row2.superseded_by && rows2 === 1 && (await chunkText(qa2.id)).includes(`SONCEVAP${tag}`), loc);

// (c) Tekrar kontrolü: aynı soru uyarıyla döner ve kayıt oluşmaz; force ile eklenir; farklı mod çakışmaz.
const sameQuestionLoud = eq2.toUpperCase() + " ?";
extraSourceQuestions.push(sameQuestionLoud);
const dupWarn = await act(KB, "addQa", { question: sameQuestionLoud, answer: "Başka cevap", mode: "agro" });
const [{ n: dup1 }] = await sql`select count(*)::int as n from kb_sources where question = ${sameQuestionLoud}`;
check("Tekrar: aynı soru (büyük harf/noktalama farkıyla) force'suz eklenmez, yönlendirme yok", !dupWarn.includes("ok=") && dup1 === 0, `${dupWarn} · ${dup1}`);
const dupForce = await act(KB, "addQa", { question: sameQuestionLoud, answer: "Başka cevap", mode: "agro", force: "on" });
const [{ n: dup2 }] = await sql`select count(*)::int as n from kb_sources where question = ${sameQuestionLoud}`;
check("Tekrar: force ile eklenir", dupForce.includes("ok=") && dup2 === 1, dupForce);
const otherMode = `Smoke farklı mod ${tag}`;
extraSourceQuestions.push(otherMode);
await act(KB, "addQa", { question: otherMode, answer: "Genel cevap", mode: "genel" });
await act(KB, "addQa", { question: otherMode, answer: "Fly cevabı", mode: "fly" });
const [{ n: modes }] = await sql`select count(*)::int as n from kb_sources where question = ${otherMode}`;
check("Tekrar: farklı moddaki aynı soru uyarı vermez", modes === 2, `${modes}`);
const corrDup = await act("/admin/egitim/duzeltmeler", "addManualCorrection", { question: cq, answer: "Yinelenen düzeltme", mode: "all" });
const [{ n: corrRows }] = await sql`select count(*)::int as n from corrections where question = ${cq}`;
check("Tekrar: aynı soruyla ikinci düzeltme force'suz eklenmez", !corrDup.includes("ok=") && corrRows === 1, `${corrDup} · ${corrRows}`);
// Düzenlemede de: ikinci SSS'nin sorusunu ilkinin sorusuna çevirmek uyarıyla durur.
const [qa3] = await sql`select id from kb_sources where question = ${otherMode} and mode = 'fly'`;
await waitReadyId(qa3.id);
await act(KB_DETAIL, "updateSource", { id: qa3.id, question: eq2, answer: "Fly cevabı", mode: "agro" }, `${KB}/${qa3.id}`);
const [qa3Row] = await sql`select question, mode from kb_sources where id = ${qa3.id}`;
check("Tekrar: düzenlemede benzer soru force'suz kaydedilmez", qa3Row.question === otherMode && qa3Row.mode === "fly", `${qa3Row.question}`);

// (d) Düzeltme düzenleme: yayındaki düzeltme halef satıra taşınır, corrections kaydı güncellenir, rozet "Yayın bekliyor" olur.
const corrSrcBefore = corr.kb_source_id as string;
loc = await act(KB_DETAIL, "updateSource", { id: corrSrcBefore, question: cq, answer: `Düzenlenmiş düzeltme ${tag}`, mode: "all" }, `${KB}/${corrSrcBefore}`);
const [corrNow] = await sql`select id, kb_source_id, correct_answer, updated_at, updated_by from corrections where question = ${cq}`;
const [{ n: corrCount }] = await sql`select count(*)::int as n from corrections where question = ${cq}`;
const [corrOld] = await sql`select superseded_by from kb_sources where id = ${corrSrcBefore}`;
check(
  "Düzeltme düzenleme: corrections güncellendi, kb_source_id halefe taşındı, tek kayıt",
  loc.includes("ok=") && corrCount === 1 && corrNow.correct_answer === `Düzenlenmiş düzeltme ${tag}` && Boolean(corrNow.updated_at) && Boolean(corrNow.updated_by) && corrNow.kb_source_id === corrOld?.superseded_by && corrNow.kb_source_id !== corrSrcBefore,
  loc,
);
await waitReadyId(corrNow.kb_source_id);
pageHtml = await (await fetch(BASE + "/admin/egitim/duzeltmeler", cookie)).text();
check("Düzeltme düzenleme: sayfada yeni cevap ve 'Yayın bekliyor' rozeti", pageHtml.includes(`Düzenlenmiş düzeltme ${tag}`) && badgeBefore(pageHtml, cq).includes("Yayın bekliyor"), "");
loc = await act("/admin/yayin", "publishPendingCorrections", {});
const afterPending = await publishedNow();
extraVersionIds.push(afterPending);
const [pendingVer] = await sql`select kb_source_ids from bot_versions where id = ${afterPending}`;
pageHtml = await (await fetch(BASE + "/admin/egitim/duzeltmeler", cookie)).text();
check(
  "Düzeltme düzenleme: yayından sonra 'Yayında'; sürümde halef var, eski satır yok",
  loc.includes("ok=") && badgeBefore(pageHtml, cq).includes("Yayında") && (pendingVer.kb_source_ids as string[]).includes(corrNow.kb_source_id) && !(pendingVer.kb_source_ids as string[]).includes(corrSrcBefore),
  loc,
);

// (e) Sayfalama: 55 kaynak ve 55 düzeltme eklenir; 50'şerli sayfalar, süzgeç korunur.
const pgTag = `smokesayfa${tag}`;
await sql`insert into kb_sources (bot_id, type, mode, title, status, question, answer)
  select ${bot.id}, 'qa', 'all', ${pgTag} || ' ' || g, 'ready', ${pgTag} || ' soru ' || g, 'x' from generate_series(1, 55) g`;
await sql`insert into corrections (mode, question, correct_answer) select 'all', ${pgTag} || ' soru ' || g, 'x' from generate_series(1, 55) g`;
const kbP1 = await (await fetch(`${BASE}${KB}?tur=qa`, cookie)).text();
const kbP2Res = await fetch(`${BASE}${KB}?tur=qa&sayfa=2`, cookie);
const kbP2 = await kbP2Res.text();
const rowLinks = (html: string) => new Set(html.match(/href="\/admin\/egitim\/bilgi-tabani\/[0-9a-f-]{36}"/g) ?? []).size;
check("Sayfalama: kaynak listesi 50'şerli, 2. sayfada 'Önceki' ve süzgeç korunur", rowLinks(kbP1) === 50 && kbP1.includes("Sonraki") && kbP1.includes("tur=qa") && kbP2Res.status === 200 && kbP2.includes("Önceki") && rowLinks(kbP2) > 0, `${rowLinks(kbP1)} · ${rowLinks(kbP2)}`);
const cP1 = await (await fetch(`${BASE}/admin/egitim/duzeltmeler`, cookie)).text();
const cP2 = await (await fetch(`${BASE}/admin/egitim/duzeltmeler?sayfa=2`, cookie)).text();
const cPending = await (await fetch(`${BASE}/admin/egitim/duzeltmeler?durum=bekliyor`, cookie)).text();
// Sayfa metni RSC akış verisinde de geçtiği için her kayıt HTML'de iki kez görünür; bu yüzden kayıt başına tek sayılır (rowLinks gibi).
const cCount = (html: string) => new Set(html.match(new RegExp(`${pgTag} soru \\d+`, "g")) ?? []).size;
check("Sayfalama: düzeltmeler 50'şerli (200 sınırı yok), 2. sayfa var", cP1.includes("Sonraki") && cP2.includes("Önceki") && cCount(cP1) === 50 && cCount(cP2) === 5, `${cCount(cP1)} · ${cCount(cP2)}`);
check("Sayfalama: durum süzgeci kaynaksız (silinmiş) kayıtları 'Yayın bekliyor'dan ayıklar", cPending.includes("200") && !cPending.includes(pgTag), "");
await sql`delete from kb_sources where title like ${pgTag + " %"}`;
await sql`delete from corrections where question like ${pgTag + " %"}`;

// Kayıtlı test senaryoları (ekle/düzenle/sil, konuşmadan ekle). Koşu BAŞLATILMAZ: gerçek model çağrısı ve harcama yok.
const EV = "/admin/egitim/test/senaryolar";
const evTag = `smokesenaryo${Date.now()}`;
const evAudit = async (action: string, target: string) => (await sql`select count(*)::int as n from audit_log where action = ${action} and target = ${target}`)[0].n as number;
loc = await act(EV, "saveCase", { question: `${evTag} Yarın don olur mu?`, mode: "agro", mustInclude: "don\nİZMİR\n", mustNotInclude: "kesinlikle", expectTool: "any", expectUnanswered: "no", note: evTag });
const [evCase] = await sql`select id, mode, expect, created_by from eval_cases where note = ${evTag}`;
check(
  "Senaryo: eklendi (ölçütler ayrıştırıldı) ve audit_log'a eval.case_create yazıldı",
  loc.includes("ok=") && !!evCase && evCase.mode === "agro" && evCase.expect.mustInclude.length === 2 && evCase.expect.expectTool === "any" && evCase.expect.expectUnanswered === false && (await evAudit("eval.case_create", evCase.id)) === 1,
  loc,
);
loc = await act(EV, "saveCase", { question: `${evTag} geçersiz kaynak`, mode: "genel", expectSource: crypto.randomUUID(), note: `${evTag}-x` });
const [badSrc] = await sql`select id from eval_cases where note = ${evTag + "-x"}`;
check("Senaryo: olmayan beklenen kaynak reddedilir", loc.includes("hata=") && !badSrc, loc);
loc = await act(EV, "saveCase", { question: `${evTag} yarım konum`, mode: "genel", lat: "39.6", note: `${evTag}-y` });
const [halfLoc] = await sql`select id from eval_cases where note = ${evTag + "-y"}`;
check("Senaryo: yarım/geçersiz konum reddedilir", loc.includes("hata=") && !halfLoc, loc);
loc = await act(EV, "saveCase", { id: evCase.id, question: `${evTag} Yarın don olur mu? (düzenlendi)`, mode: "agro", lat: "39,65", lon: "27.88", locName: "Balıkesir", mustInclude: "don", note: evTag });
const [evEdited] = await sql`select question, location, expect, updated_at from eval_cases where id = ${evCase.id}`;
check(
  "Senaryo: düzenlendi (konum kaydedildi, ölçüt değişti) ve audit_log'a eval.case_update yazıldı",
  loc.includes("ok=") && evEdited.question.includes("düzenlendi") && evEdited.location?.lat === 39.65 && evEdited.expect.mustInclude.length === 1 && !!evEdited.updated_at && (await evAudit("eval.case_update", evCase.id)) === 1,
  loc,
);
const evPage = await fetch(BASE + EV, cookie);
const evHtml = await evPage.text();
check("Senaryo sayfası: liste, KVKK uyarısı ve koşu formu görünür", evPage.status === 200 && evHtml.includes(`${evTag} Yarın don olur mu?`) && evHtml.includes("Kişisel veri") && evHtml.includes("Seçilenleri koş"), `${evPage.status}`);
check("Koşu sayfası: bilinmeyen koşu 404", (await fetch(`${BASE}/admin/egitim/test/kosular/${crypto.randomUUID()}`, cookie)).status === 404, "");
loc = await act(EV, "startRun", { target: "draft", scope: "selected", maxCost: "1" });
const [anyRun] = await sql`select count(*)::int as n from eval_runs where started_by = ${admin.email} and started_at > now() - interval '1 minute'`;
check("Koşu: senaryo seçilmeden başlatılamaz (koşu kaydı yok)", loc.includes("hata=") && anyRun.n === 0, loc);
loc = await act(EV, "startRun", { target: "baska", scope: "all" });
check("Koşu: geçersiz hedef reddedilir", loc.includes("hata="), loc);

// Konuşmadan senaryo: onay kutusu zorunlu; kaynak konuşma silinince senaryo kalır, kaynak bağı boşalır.
const [evConv] = await sql`insert into conversations (id, bot_id, mode, platform, title) values (${crypto.randomUUID()}, ${bot.id}, 'fly', 'playground', ${evTag}) returning id`;
const [evUserMsg] = await sql`insert into messages (conversation_id, role, content) values (${evConv.id}, 'user', ${evTag + " FL350 türbülans var mı?"}) returning id`;
const [evBotMsg] = await sql`insert into messages (conversation_id, role, content, created_at) values (${evConv.id}, 'assistant', 'Orta düzeyde.', now() + interval '1 second') returning id`;
const CONV = "/admin/konusmalar/[id]";
loc = await act(CONV, "addCaseFromMessage", { conversationId: evConv.id, messageId: evBotMsg.id, question: `${evTag} FL350 türbülans var mı?` }, `/admin/konusmalar/${evConv.id}`);
const [noConsent] = await sql`select id from eval_cases where question like ${evTag + " FL350%"}`;
check("Konuşmadan senaryo: kişisel veri onayı olmadan oluşmaz", loc.includes("hata=") && !noConsent, loc);
loc = await act(CONV, "addCaseFromMessage", { conversationId: evConv.id, messageId: evBotMsg.id, question: `${evTag} FL350 türbülans var mı?`, piiOk: "on" }, `/admin/konusmalar/${evConv.id}`);
const [fromConv] = await sql`select id, mode, source_message_id, expect from eval_cases where question like ${evTag + " FL350%"}`;
check(
  "Konuşmadan senaryo: onayla oluşur (mod konuşmadan, kaynak = kullanıcı mesajı), düzenleme sayfasına yönlenir, audit yazılır",
  loc.includes("duzenle=") && !!fromConv && fromConv.mode === "fly" && fromConv.source_message_id === evUserMsg.id && (await evAudit("eval.case_create", fromConv.id)) === 1,
  loc,
);
await sql`delete from conversations where id = ${evConv.id}`;
const [orphan] = await sql`select question, source_message_id from eval_cases where id = ${fromConv.id}`;
check("Konuşmadan senaryo: kaynak konuşma silinince senaryo kalır, kaynak bağı boşalır", !!orphan && orphan.source_message_id === null && orphan.question.includes("FL350"), `${orphan?.source_message_id}`);

// Koşu sonuçları kişisel veri kopyası taşır: senaryo silinince metin maskelenir, "Koşuyu sil" koşuyu kalıcı siler.
const [evRun] = await sql`insert into eval_runs (bot_id, target, status, started_by, summary, cost_usd) values (${bot.id}, '"draft"'::jsonb, 'done', ${admin.email}, '{}'::jsonb, 0) returning id`;
await sql`insert into eval_results (run_id, case_id, question, mode, answer) values (${evRun.id}, ${evCase.id}, ${evTag + " soru metni"}, 'agro', ${evTag + " cevap metni"})`;
const [evRunRunning] = await sql`insert into eval_runs (bot_id, target, status, started_by, summary, cost_usd) values (${bot.id}, '"draft"'::jsonb, 'running', ${admin.email}, ${sql.json({ lastActivityAt: new Date().toISOString() })}, 0) returning id`;
loc = await act(EV, "deleteRun", { id: evRunRunning.id });
const [stillRunning] = await sql`select id from eval_runs where id = ${evRunRunning.id}`;
check("Koşu sil: çalışan koşu silinemez", loc.includes("hata=") && !!stillRunning, loc);
await sql`delete from eval_runs where id = ${evRunRunning.id}`;
loc = await act(EV, "deleteRun", { id: "gecersiz" });
check("Koşu sil: geçersiz kimlik anlaşılır hata verir", loc.includes("hata="), loc);

const locDelCase = await act(EV, "deleteCase", { id: evCase.id });
const [masked] = await sql`select question, answer, case_id from eval_results where run_id = ${evRun.id}`;
check(
  "Senaryo silinince geçmiş sonuçtaki soru ve cevap metni temizlenir (satır kalır)",
  locDelCase.includes("ok=") && !!masked && masked.question === "" && masked.answer === "" && masked.case_id === null,
  locDelCase,
);
const evRunPage = await fetch(`${BASE}/admin/egitim/test/kosular/${evRun.id}`, cookie);
check("Koşu sayfası: tam UUID dışı kimlik 404, geçerli koşu 200 ('Koşuyu sil' görünür)", evRunPage.status === 200 && (await evRunPage.text()).includes("Koşuyu sil") && (await fetch(`${BASE}/admin/egitim/test/kosular/${evRun.id}x`, cookie)).status === 404, `${evRunPage.status}`);
loc = await act(EV, "deleteRun", { id: evRun.id });
const [runGone] = await sql`select (select count(*)::int from eval_runs where id = ${evRun.id}) as runs, (select count(*)::int from eval_results where run_id = ${evRun.id}) as results`;
check("Koşu sil: koşu ve sonuçları kalıcı silinir, audit_log'a eval.run_delete yazılır", loc.includes("ok=") && runGone.runs === 0 && runGone.results === 0 && (await evAudit("eval.run_delete", evRun.id)) === 1, loc);

// Konuşmadan senaryo: geçersiz kimlikler 500 değil anlaşılır hata verir.
loc = await act(CONV, "addCaseFromMessage", { conversationId: "gecersiz", messageId: "x", question: "soru", piiOk: "on" }, "/admin/konusmalar/00000000-0000-0000-0000-000000000000");
check("Konuşmadan senaryo: geçersiz konuşma kimliği anlaşılır hata verir", loc.includes("hata=") && loc.includes("Konuşma bulunamadı."), loc);

// "Yayındaki" hedef koşu başında sürüme sabitlenir.
{
  const { startEvalRun } = await import("../src/lib/eval-run");
  const { getMainBot } = await import("../src/lib/bot");
  const mainBot = await getMainBot();
  const [pubCase] = await sql`insert into eval_cases (bot_id, mode, question, expect, note) values (${bot.id}, 'genel', ${evTag + " sabitleme"}, '{}'::jsonb, ${evTag}) returning id`;
  if (mainBot.publishedVersionId) {
    const started = await startEvalRun({ bot: mainBot, target: "published", caseIds: [pubCase.id], maxCostUsd: 100, actorEmail: admin.email });
    const [pinned] = await sql`select target, version_number from eval_runs where id = ${started.runId}`;
    check(
      "Koşu: 'yayındaki' hedef koşu başında sürüm kimliğine sabitlenir (kayıtta sürüm numarası var)",
      pinned.target?.versionId === mainBot.publishedVersionId && typeof pinned.version_number === "number",
      JSON.stringify(pinned.target),
    );
    await sql`delete from eval_runs where id = ${started.runId}`;
  }
  await sql`delete from eval_cases where id = ${pubCase.id}`;
}

loc = locDelCase;
const [gone] = await sql`select id from eval_cases where id = ${evCase.id}`;
check("Senaryo: silindi ve audit_log'a eval.case_delete yazıldı", loc.includes("ok=") && !gone && (await evAudit("eval.case_delete", evCase.id)) === 1, loc);
await sql`delete from eval_cases where question like ${evTag + "%"}`;

// Kaynakları ve oluşturulan sürümleri temizle; yayındaki sürüm başlangıca dönsün.
if (origVersion) await sql`update bots set published_version_id = ${origVersion.id} where id = ${bot.id}`;
await sql`delete from corrections where question = ${cq}`;
for (const question of extraSourceQuestions) await sql`delete from kb_sources where question = ${question}`;
for (const id of extraVersionIds) await sql`delete from bot_versions where id = ${id} and id <> ${origVersion?.id ?? "00000000-0000-0000-0000-000000000000"}`;

// Temizlik: taslağı geri yükle; yalnızca bu çalıştırmanın oluşturduğu sürümü sil,
// o da artık yayında değilse. Denetim kaydına dokunulmaz (kayıtlar silinemez).
await sql`update bots set draft_config = ${sql.json(bot.draft_config)} where id = ${bot.id}`;
const [now] = await sql`select published_version_id from bots where id = ${bot.id}`;
if (createdVersionId && now.published_version_id !== createdVersionId) {
  await sql`delete from bot_versions where id = ${createdVersionId}`;
}
await sql.end();

const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? "✓" : "✗"} ${r.name}${r.detail ? `  (${r.detail.slice(0, 140)})` : ""}`);
console.log(`\n${results.length - failed.length}/${results.length} başarılı`);
process.exit(failed.length ? 1 : 0);
