/*
 * Duman testi: çalışan sunucuya karşı panelin ve widget'ın uçtan uca çalıştığını doğrular.
 *   npm run start   (başka bir terminalde)
 *   npm run smoke
 * Admin oturumu, uygulamanın kendi SESSION_SECRET'ıyla üretilir; şifre kullanılmaz.
 */
import { SignJWT } from "jose";
import postgres from "postgres";

const BASE = (process.env.APP_URL || "http://localhost:3110").replace(/\/$/, "");
const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
const results: { name: string; ok: boolean; detail: string }[] = [];
const check = (name: string, ok: boolean, detail = "") => results.push({ name, ok, detail });

const [admin] = await sql`select id, email, name, role from admin_users where role = 'super_admin' and active order by created_at limit 1`;
const [bot] = await sql`select public_key from bots order by created_at limit 1`;
const [demoConv] = await sql`select id from conversations where is_demo order by last_message_at desc limit 1`;

const token = await new SignJWT({ role: admin.role, email: admin.email, name: admin.name })
  .setProtectedHeader({ alg: "HS256" })
  .setSubject(admin.id)
  .setAudience("admin")
  .setIssuedAt()
  .setExpirationTime("10m")
  .sign(new TextEncoder().encode(process.env.SESSION_SECRET!));
const cookie = `hm_admin=${token}`;

/* ---------- Admin sayfaları ---------- */
const pages: [string, string][] = [
  ["/admin", "Pano"],
  ["/admin/icerik", "Site sayfaları"],
  ["/admin/icerik?bolum=core", "Veri çipleri"],
  ["/admin/icerik?bolum=premium", "Premium"],
  ["/admin/medya", "Medya kütüphanesi"],
  ["/admin/konusmalar", "Konuşmalar"],
  ["/admin/konusmalar?durum=olumsuz", "Konuşmalar"],
  [`/admin/konusmalar/${demoConv?.id}`, "Ayrıntılar"],
  ["/admin/fotograflar", "Fotoğraflar"],
  ["/admin/geri-bildirim", "Geri bildirim"],
  ["/admin/egitim/bilgi-tabani", "Bilgi tabanı"],
  ["/admin/egitim/bilgi-tabani?ara=%C3%A7ar%C5%9Famba+sulasam&arama_mod=agro", "Aramayı dene"],
  ["/admin/egitim/kisilik?mod=agro", "Kişilik ve ton"],
  ["/admin/egitim/kisilik?mod=kurallar", "Ortak kurallar"],
  ["/admin/egitim/duzeltmeler", "Düzeltmeler"],
  ["/admin/egitim/test", "Test alanı"],
  ["/admin/yayin", "Sürümler ve gömme"],
  ["/admin/ayarlar/modeller", "Modeller"],
  ["/admin/ayarlar/entegrasyon", "Veri entegrasyonu"],
  ["/admin/ayarlar/kullanicilar", "Kullanıcılar"],
  ["/admin/ayarlar/kvkk", "KVKK"],
  ["/admin/ayarlar/denetim", "Denetim kaydı"],
  ["/admin/hesabim", "Hesabım"],
];
for (const [path, expect] of pages) {
  const t = Date.now();
  const res = await fetch(BASE + path, { headers: { cookie }, redirect: "manual" });
  const html = await res.text();
  const bad = /Application error|Internal Server Error|Unhandled Runtime Error/.test(html);
  check(`GET ${path}`, res.status === 200 && html.includes(expect) && !bad, `${res.status} · ${Date.now() - t} ms${bad ? " · hata metni" : ""}${html.includes(expect) ? "" : ` · "${expect}" yok`}`);
}

const noAuth = await fetch(BASE + "/admin/konusmalar", { redirect: "manual" });
check("Oturumsuz /admin → /login", noAuth.status === 307 && (noAuth.headers.get("location") ?? "").includes("/login"), `${noAuth.status} ${noAuth.headers.get("location")}`);

/* ---------- Bilgi tabanı araması (Türkçe önek) ---------- */
const kb = await (await fetch(BASE + "/admin/egitim/bilgi-tabani?ara=Sal%C4%B1+sabah%C4%B1+ila%C3%A7lama+yapabilir+miyim&arama_mod=agro", { headers: { cookie } })).text();
check("Arama: 'ilaçlama' sorusu SSS'yi buluyor", kb.includes("İlaçlama için uygun hava koşulları"), "");

/* ---------- Widget akışı ---------- */
const deviceId = `smoke-${Date.now()}`;
const s1 = await fetch(BASE + "/api/widget/session", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ botKey: bot.public_key, deviceId, platform: "android", appVersion: "9.9.9" }),
});
const s1j = await s1.json();
check("Widget oturumu: KVKK onayı isteniyor", s1.ok && s1j.consentRequired === true, JSON.stringify(s1j).slice(0, 80));

const s2 = await fetch(BASE + "/api/widget/session", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ botKey: bot.public_key, deviceId, platform: "android", consentVersion: s1j.consentVersion }),
});
const s2j = await s2.json();
check("Widget oturumu: onaydan sonra token", s2.ok && typeof s2j.token === "string", `${s2.status}`);
const auth = { authorization: `Bearer ${s2j.token}` };

const png = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));
const fd = new FormData();
fd.append("file", new Blob([png], { type: "image/png" }), "test.png");
const up = await fetch(BASE + "/api/widget/upload", { method: "POST", headers: auth, body: fd });
const upj = await up.json();
check("Fotoğraf yükleme", up.ok && typeof upj.id === "string", `${up.status} ${JSON.stringify(upj).slice(0, 60)}`);

const svg = new FormData();
svg.append("file", new Blob(["<svg/>"], { type: "image/svg+xml" }), "x.svg");
const upBad = await fetch(BASE + "/api/widget/upload", { method: "POST", headers: auth, body: svg });
check("Fotoğraf yükleme: SVG reddediliyor", upBad.status === 400, `${upBad.status}`);

const chat = await fetch(BASE + "/api/chat", {
  method: "POST",
  headers: { "content-type": "application/json", ...auth },
  body: JSON.stringify({ conversationId: crypto.randomUUID(), mode: "agro", text: "Yarın ilaçlama yapabilir miyim?", attachmentIds: [upj.id] }),
});
const chatj = await chat.json().catch(() => ({}));
check(
  "Sohbet: model seçilmeden anlaşılır hata",
  chat.status === 503 && /model/i.test(chatj.error ?? ""),
  `${chat.status} ${chatj.error ?? ""}`,
);

const noTok = await fetch(BASE + "/api/chat", {
  method: "POST",
  headers: { "content-type": "application/json", authorization: "Bearer sahte" },
  body: JSON.stringify({ conversationId: crypto.randomUUID(), mode: "genel", text: "merhaba" }),
});
check("Sohbet: geçersiz token 401", noTok.status === 401, `${noTok.status}`);

const [photo] = await sql`select storage_key from attachments where is_demo limit 1`;
if (photo) {
  const unsigned = await fetch(`${BASE}/api/files/${photo.storage_key}`);
  check("Dosya: imzasız erişim engelleniyor", unsigned.status === 403, `${unsigned.status}`);
  const asAdmin = await fetch(`${BASE}/api/files/${photo.storage_key}`, { headers: { cookie } });
  check("Dosya: admin görebiliyor", asAdmin.ok && (asAdmin.headers.get("content-security-policy") ?? "").includes("sandbox"), `${asAdmin.status}`);
}

const cron = await fetch(BASE + "/api/cron/kvkk", { method: "POST", headers: { authorization: "Bearer yanlis" } });
check("Cron: yanlış anahtar 401", cron.status === 401, `${cron.status}`);

const wjs = await fetch(BASE + "/widget.js");
check("widget.js", wjs.ok && (await wjs.text()).includes("havamania-chat"), `${wjs.status}`);

const home = await (await fetch(BASE + "/")).text();
check("Landing CMS'ten üretiliyor", home.includes("data-scene=\"core\"") && home.includes("Dağınık veri"), "");

// Test cihazının izlerini temizle
await sql`delete from attachments where app_user_id in (select id from app_users where device_id = ${deviceId})`;
await sql`delete from conversations where app_user_id in (select id from app_users where device_id = ${deviceId})`;
await sql`delete from app_users where device_id = ${deviceId}`;
await sql.end();

const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? "✓" : "✗"} ${r.name}${r.detail ? `  (${r.detail})` : ""}`);
console.log(`\n${results.length - failed.length}/${results.length} başarılı`);
process.exit(failed.length ? 1 : 0);
