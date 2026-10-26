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
async function act(page: string, name: string, fields: Record<string, string | string[]>): Promise<string> {
  // JavaScript'siz form gönderimi (progressive enhancement): tarayıcının yaptığının aynısı.
  const fd = new FormData();
  fd.append(`$ACTION_ID_${actionId(name, page)}`, "");
  for (const [k, v] of Object.entries(fields)) for (const x of Array.isArray(v) ? v : [v]) fd.append(k, x);
  const res = await fetch(BASE + page, { method: "POST", headers: { cookie: `hm_admin=${token}` }, body: fd, redirect: "manual" });
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
