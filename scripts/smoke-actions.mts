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
