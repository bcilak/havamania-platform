/*
 * Duman testi: çalışan sunucuya karşı panelin ve widget'ın uçtan uca çalıştığını doğrular.
 *   npm run start   (başka bir terminalde)
 *   npm run smoke
 * Admin oturumu, uygulamanın kendi SESSION_SECRET'ıyla üretilir; şifre kullanılmaz.
 */
import { SignJWT } from "jose";
import postgres from "postgres";
import sharp from "sharp";
import { stripCitations } from "../src/lib/ai/citations";
import { isFollowUp } from "../src/lib/ai/retrieval-core";
import { bridgeKeyHint, generateBridgeKey, hashBridgeKey } from "../src/lib/bridge/keys-core";
import { gpsJpeg } from "../src/lib/image-fixtures";
import { storage } from "../src/lib/storage";

const BASE = (process.env.APP_URL || "http://localhost:3110").replace(/\/$/, "");
const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
const results: { name: string; ok: boolean; detail: string }[] = [];
const check = (name: string, ok: boolean, detail = "") => results.push({ name, ok, detail });

const [admin] = await sql`select id, email, name, role from admin_users where role = 'super_admin' and active order by created_at limit 1`;
const [bot] = await sql`select id, public_key from bots order by created_at limit 1`;
// Canlıda (SEED_DEMO=0) örnek konuşma yoksa gerçek bir konuşmaya bakılır; hiç yoksa detay sayfası atlanır.
const [demoConv] = await sql`select id from conversations where platform <> 'playground' order by is_demo desc, last_message_at desc limit 1`;

const token = await new SignJWT({ role: admin.role, email: admin.email, name: admin.name })
  .setProtectedHeader({ alg: "HS256" })
  .setSubject(admin.id)
  .setAudience("admin")
  .setIssuedAt()
  .setExpirationTime("10m")
  .sign(new TextEncoder().encode(process.env.SESSION_SECRET!));
const cookie = `hm_admin=${token}`;

/* ---------- Saf mantık: yanlış birleşme ve atıf temizliği ---------- */
check("Takip sorusu: kısa ama bağımsız soru (METAR nedir?, UV indeksi nedir?) birleşmiyor", !isFollowUp("METAR nedir?") && !isFollowUp("UV indeksi nedir?") && isFollowUp("peki yarın?"), "");
check("Atıf temizliği: atıf dışı köşeli parantez ve bağlantı metni korunuyor", stripCitations("Sıcaklık [10, 15] derece, dizi[0], [1](https://o.com) ve [2].", 3) === "Sıcaklık [10, 15] derece, dizi[0], [1](https://o.com) ve.", "");

/* ---------- Admin sayfaları ---------- */
const pages: [string, string][] = [
  ["/admin", "Pano"],
  ["/admin/icerik", "Site sayfaları"],
  ["/admin/icerik?bolum=core", "Veri çipleri"],
  ["/admin/icerik?bolum=premium", "Premium"],
  ["/admin/medya", "Medya kütüphanesi"],
  ["/admin/konusmalar", "Konuşmalar"],
  ["/admin/konusmalar?durum=olumsuz", "Konuşmalar"],
  ["/admin/konusmalar?kaynak=kopru", "Konuşmalar"],
  ["/admin/konusmalar?kaynak=widget", "Konuşmalar"],
  ["/admin/fotograflar", "Fotoğraflar"],
  ["/admin/geri-bildirim", "Geri bildirim"],
  ["/admin/egitim/bilgi-tabani", "Bilgi tabanı"],
  ["/admin/egitim/bilgi-tabani?ara=%C3%A7ar%C5%9Famba+sulasam&arama_mod=agro", "Aramayı dene"],
  ["/admin/egitim/kisilik?mod=agro", "Kişilik ve ton"],
  ["/admin/egitim/kisilik?mod=kurallar", "Ortak kurallar"],
  ["/admin/egitim/duzeltmeler", "Düzeltmeler"],
  ["/admin/egitim/bosluklar", "Boşluk analizi"],
  ["/admin/egitim/bosluklar?gun=7&mod=agro", "Boşluk analizi"],
  ["/admin/egitim/test", "Test alanı"],
  ["/admin/yayin", "Sürümler ve gömme"],
  ["/admin/ayarlar/modeller", "Modeller"],
  ["/admin/ayarlar/entegrasyon", "Veri entegrasyonu"],
  ["/admin/ayarlar/kullanicilar", "Kullanıcılar"],
  ["/admin/ayarlar/kvkk", "KVKK"],
  ["/admin/ayarlar/denetim", "Denetim kaydı"],
  ["/admin/hesabim", "Hesabım"],
  ["/admin/yasal", "Yasal sayfalar"],
];
if (demoConv) pages.splice(7, 0, [`/admin/konusmalar/${demoConv.id}`, "Ayrıntılar"]);
// Sürüm ayrıntı sayfası kalite özetini gösterir (yayınlanmış sürüm yoksa atlanır).
const [anyVersion] = await sql`select id from bot_versions order by published_at desc limit 1`;
if (anyVersion) pages.push([`/admin/yayin/${anyVersion.id}`, "Kalite özeti"]);
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

// Meta veri temizliği: yönlü, GPS'li JPEG yüklenir; indirilen dosyada EXIF/GPS kalmamalı, yön uygulanmış olmalı.
const SMOKE_MARKER = "HM-SMOKE-MARKER";
const gpsFd = new FormData();
gpsFd.append("file", new Blob([new Uint8Array(await gpsJpeg({ width: 64, height: 32, orientation: 6, marker: SMOKE_MARKER }))], { type: "image/jpeg" }), "gps.jpg");
const gpsUp = await fetch(BASE + "/api/widget/upload", { method: "POST", headers: auth, body: gpsFd });
const gpsUpj = await gpsUp.json();
check("Fotoğraf yükleme: GPS'li JPEG kabul ediliyor", gpsUp.ok && typeof gpsUpj.id === "string", `${gpsUp.status}`);
const [gpsRow] = gpsUp.ok ? await sql`select storage_key, media_type, size from attachments where id = ${gpsUpj.id}` : [];
if (gpsRow) {
  const dl = await fetch(`${BASE}/api/files/${gpsRow.storage_key}`, { headers: { cookie } });
  const body = Buffer.from(await dl.arrayBuffer());
  const m = await sharp(body).metadata();
  check("Fotoğraf: indirilen dosyada EXIF/XMP/ICC yok, JPEG olarak sunuluyor", dl.ok && dl.headers.get("content-type") === "image/jpeg" && !m.exif && !m.xmp && !m.icc, `${dl.status} ${dl.headers.get("content-type")}`);
  check("Fotoğraf: yön uygulanmış (64x32 -> 32x64)", m.width === 32 && m.height === 64, `${m.width}x${m.height}`);
  check("Fotoğraf: gövdede GPS/EXIF izi ve işaretçi metin yok", !body.includes("Exif\0\0") && !body.includes(SMOKE_MARKER), "");
  check("Fotoğraf: kayıtlı boyut ve tür çıktıya eşit", gpsRow.size === body.length && gpsRow.media_type === "image/jpeg", `${gpsRow.size} / ${body.length}`);
}

const heicFd = new FormData();
heicFd.append("file", new Blob([new Uint8Array(Buffer.from("\0\0\0\x18ftypheic\0\0\0\0mif1heic", "latin1"))], { type: "image/heic" }), "x.heic");
const heicUp = await fetch(BASE + "/api/widget/upload", { method: "POST", headers: auth, body: heicFd });
const heicUpj = await heicUp.json().catch(() => ({}));
check("Fotoğraf yükleme: HEIC anlaşılır uyarıyla reddediliyor", heicUp.status === 400 && /HEIC/.test(heicUpj.error ?? ""), `${heicUp.status} ${heicUpj.error ?? ""}`);

const fakeSvg = new FormData();
fakeSvg.append("file", new Blob(["<svg/>"], { type: "image/png" }), "x.png");
const fakeSvgUp = await fetch(BASE + "/api/widget/upload", { method: "POST", headers: auth, body: fakeSvg });
check("Fotoğraf yükleme: türü png beyan edilen SVG baytları reddediliyor", fakeSvgUp.status === 400, `${fakeSvgUp.status}`);

const svgName = new FormData();
svgName.append("file", new Blob([png], { type: "image/png" }), "x.svg");
const svgNameUp = await fetch(BASE + "/api/widget/upload", { method: "POST", headers: auth, body: svgName });
const svgNameUpj = await svgNameUp.json().catch(() => ({}));
const [svgNameRow] = svgNameUp.ok ? await sql`select storage_key from attachments where id = ${svgNameUpj.id}` : [];
check("Fotoğraf yükleme: adı .svg olan gerçek PNG .png anahtarıyla saklanıyor", Boolean(svgNameRow?.storage_key.endsWith(".png")), `${svgNameUp.status} ${svgNameRow?.storage_key ?? ""}`);

// Savunma katmanı: temizlenmemiş eski dosya doğrudan depoya yazılsa bile sunulurken temizlenir.
const legacyKey = `photos/smoke/${crypto.randomUUID()}.jpg`;
await storage.put(legacyKey, new Uint8Array(await gpsJpeg({ marker: SMOKE_MARKER })), "image/jpeg");
const legacy = await fetch(`${BASE}/api/files/${legacyKey}`, { headers: { cookie } });
const legacyBody = Buffer.from(await legacy.arrayBuffer());
const legacyMeta = legacy.ok ? await sharp(legacyBody).metadata() : null;
check("Dosya: eski GPS'li fotoğraf sunulurken temizleniyor", Boolean(legacyMeta) && !legacyMeta!.exif && !legacyBody.includes(SMOKE_MARKER), `${legacy.status}`);
await storage.remove(legacyKey).catch(() => {});

// Uzantı yanıltıcıysa da (.pdf anahtarlı gerçek JPEG) içerik koklanıp temizlenir; Content-Type içerikten gelir.
const pdfKey = `photos/smoke/${crypto.randomUUID()}.pdf`;
await storage.put(pdfKey, new Uint8Array(await gpsJpeg({ marker: SMOKE_MARKER })), "application/pdf");
const pdfDl = await fetch(`${BASE}/api/files/${pdfKey}`, { headers: { cookie } });
const pdfBody = Buffer.from(await pdfDl.arrayBuffer());
const pdfMeta = pdfDl.ok ? await sharp(pdfBody).metadata() : null;
check(
  "Dosya: .pdf anahtarlı GPS'li JPEG EXIF'siz iniyor (image/jpeg, nosniff)",
  Boolean(pdfMeta) && !pdfMeta!.exif && !pdfBody.includes("Exif\x00\x00") && !pdfBody.includes(SMOKE_MARKER) && pdfDl.headers.get("content-type") === "image/jpeg" && pdfDl.headers.get("x-content-type-options") === "nosniff",
  `${pdfDl.status} ${pdfDl.headers.get("content-type")}`,
);
await storage.remove(pdfKey).catch(() => {});

// Kanonik olmayan anahtar izin ve temizlik denetimini atlatamaz: "photos" izni olmayan editör rolüyle de, izinli rolle de reddedilir.
const editorToken = await new SignJWT({ role: "editor", email: admin.email, name: admin.name })
  .setProtectedHeader({ alg: "HS256" })
  .setSubject(admin.id)
  .setAudience("admin")
  .setIssuedAt()
  .setExpirationTime("10m")
  .sign(new TextEncoder().encode(process.env.SESSION_SECRET!));
const editorCookie = `hm_admin=${editorToken}`;
const canonId = crypto.randomUUID();
const canonKey = `photos/smoke/${canonId}.jpg`;
await storage.put(canonKey, new Uint8Array(await gpsJpeg({ marker: SMOKE_MARKER })), "image/jpeg");
const editorOk = await fetch(`${BASE}/api/files/${canonKey}`, { headers: { cookie: editorCookie } });
check("Dosya: editör rolü photos/ anahtarını göremiyor (403)", editorOk.status === 403, `${editorOk.status}`);
const tricks = [
  `.%2Fphotos%2Fsmoke%2F${canonId}.jpg`,
  `kb%2F..%2Fphotos%2Fsmoke%2F${canonId}.jpg`,
  `photos/smoke%2F..%2Fsmoke%2F${canonId}.jpg`,
  `photos%2Fsmoke%2F${canonId}.jpg`,
];
for (const [who, c] of [["editör", editorCookie], ["süper admin", cookie]] as const) {
  const bad: string[] = [];
  for (const t of tricks) {
    const r = await fetch(`${BASE}/api/files/${t}`, { headers: { cookie: c } });
    const body = Buffer.from(await r.arrayBuffer());
    if (r.ok || body.includes(SMOKE_MARKER)) bad.push(`${t} -> ${r.status}`);
  }
  check(`Dosya: kanonik olmayan anahtarlar reddediliyor (${who})`, bad.length === 0, bad.join("; "));
}
// Büyük harfli önek (büyük/küçük harf duyarsız dosya sistemleri) editör için izni atlatamaz.
const upper = await fetch(`${BASE}/api/files/Photos/smoke/${canonId}.jpg`, { headers: { cookie: editorCookie } });
check("Dosya: Photos/ büyük harfli önekle editör izni atlatılamıyor", !upper.ok, `${upper.status}`);
await storage.remove(canonKey).catch(() => {});

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

/* ---------- Yasal sayfalar (Google Play / App Store) ---------- */
for (const [path, needle] of [["/gizlilik", "KVKK"], ["/kullanim-kosullari", "Kullanım Koşulları"], ["/hesap-silme", "Silinen veriler"], ["/kvkk", "Veri sorumlusu"]]) {
  const r = await fetch(BASE + path);
  const html = await r.text();
  check(`Yasal sayfa ${path}`, r.ok && html.includes(needle) && !html.includes("{{"), `${r.status}`);
}
const oldPrivacy = await fetch(BASE + "/privacy", { redirect: "manual" });
check("/privacy → /gizlilik", oldPrivacy.status === 308 && (oldPrivacy.headers.get("location") ?? "").endsWith("/gizlilik"), `${oldPrivacy.status}`);
check("Landing alt bilgisinde yasal bağlantılar (KVKK dahil)", home.includes("href=\"/gizlilik\"") && home.includes("href=\"/hesap-silme\"") && home.includes("href=\"/kvkk\""), "");
const sitemap = await (await fetch(BASE + "/sitemap.xml")).text();
check("Site haritasında /kvkk", sitemap.includes("/kvkk</loc>"), "");

/* ---------- Köprü (mobil backend, /api/bridge): kimlik, sözleşme, doğrulama, silme ---------- */
// Test anahtarları SQL ile eklenir ve sonda silinir (test verisi temizliği; audit_log'a dokunulmaz).
// Model gerekmeyen kontroller burada; model gerektirenler (/ask 200, feedback 204, kilit yarışı) smoke:chat'te.
{
  const BR = `${BASE}/api/bridge`;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const rndIp = () => `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
  // Başarısız kimlik sayacı IP başınadır (20/dk); bu bölüm kendi IP'sini, anahtar beklemeleri her seferinde yenisini kullanır.
  const brIp = rndIp();
  type Init = { method?: string; headers?: Record<string, string>; body?: string; ip?: string };
  const br = (path: string, key: string | null, init: Init = {}) =>
    fetch(BR + path, { method: init.method ?? "GET", headers: { "x-forwarded-for": init.ip ?? brIp, ...(key ? { authorization: `Bearer ${key}` } : {}), ...init.headers }, body: init.body });
  const brPost = (path: string, key: string | null, body: unknown, init: Init = {}) =>
    br(path, key, { method: "POST", headers: { "content-type": "application/json", ...init.headers }, body: typeof body === "string" ? body : JSON.stringify(body), ip: init.ip });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const json = async (r: Response) => (await r.json().catch(() => ({}))) as Record<string, any>;

  await sql`delete from bridge_keys where name like 'smoke-test-%'`;
  const mkKey = async (label: string) => {
    const key = generateBridgeKey();
    await sql`insert into bridge_keys (bot_id, name, key_hash, hint, created_by) values (${bot.id}, ${`smoke-test-${label}`}, ${hashBridgeKey(key)}, ${bridgeKeyHint(key)}, 'smoke')`;
    return key;
  };
  // Yeni anahtar önbellekte yoksa en çok ~5 sn içinde yeniden yüklenir (bkz. auth.ts).
  const waitKey = async (key: string) => {
    for (let i = 0; i < 9; i++) {
      const r = await br("/consent", key, { ip: rndIp() });
      await r.body?.cancel();
      if (r.status !== 401) return r.status;
      await sleep(1000);
    }
    return 401;
  };
  const stamp = Date.now();
  const extIds = { a: `smoke-br-a-${stamp}`, b: `smoke-br-b-${stamp}`, old: `smoke-br-old-${stamp}`, v: `smoke-br-v-${stamp}` };
  try {
    const keyMain = await mkKey("ana");
    const keyRev = await mkKey("iptal");
    const ready = [await waitKey(keyMain), await waitKey(keyRev)];
    check("Köprü: test anahtarları geçerli (önbellek yüklendi)", ready.every((s) => s === 200), ready.join(","));

    /* Kimlik */
    const noHdr = await br("/consent", null);
    const noHdrJ = await json(noHdr);
    check("Köprü: Authorization yok → 401 unauthorized ({error, message})", noHdr.status === 401 && noHdrJ.error === "unauthorized" && typeof noHdrJ.message === "string", `${noHdr.status} ${noHdrJ.error}`);
    const badHeaders = ["Bearer hm_bk_", "Bearer hm_bk_kisa", `Bearer ${keyMain.slice(0, -1)}`, `Bearer ${keyMain}x`, `bearer ${keyMain}`, "Basic YWJjOmRlZg=="];
    const badStatuses: number[] = [];
    for (const h of badHeaders) {
      const r = await br("/consent", null, { headers: { authorization: h } });
      await r.body?.cancel();
      badStatuses.push(r.status);
    }
    check("Köprü: bozuk / eksik / fazla uzun / küçük harfli 'bearer' / Basic başlık → 401", badStatuses.every((s) => s === 401), badStatuses.join(","));
    const unknown = await br("/consent", generateBridgeKey());
    await unknown.body?.cancel();
    check("Köprü: biçimi doğru ama bilinmeyen anahtar → 401", unknown.status === 401, `${unknown.status}`);
    const postNoKey = await brPost("/ask", null, { user_id: "x", question: "x", consent_version: 1 });
    await postNoKey.body?.cancel();
    check("Köprü: anahtarsız POST /ask → 401 (gövde okunmadan)", postNoKey.status === 401, `${postNoKey.status}`);

    /* /consent: tek kaynak, başlıklar */
    const cons = await br("/consent", keyMain);
    const consJ = await json(cons);
    const cv = consJ.version as number;
    check(
      "Köprü: GET /consent 200, sürüm widget ile aynı, metinde {{ yok, updated_at ISO",
      cons.status === 200 && Number.isInteger(cv) && cv === s1j.consentVersion && typeof consJ.text === "string" && !consJ.text.includes("{{") && !Number.isNaN(Date.parse(consJ.updated_at)) && new Date(consJ.updated_at).toISOString() === consJ.updated_at,
      `${cons.status} v${cv} (widget v${s1j.consentVersion})`,
    );
    check("Köprü: onay metni widget oturumuyla birebir aynı (tek kaynak)", consJ.text === s1j.consentText, "");
    check("Köprü: yanıtlarda cache-control no-store, JSON, CORS başlığı yok", (cons.headers.get("cache-control") ?? "").includes("no-store") && (cons.headers.get("content-type") ?? "").includes("application/json") && !cons.headers.has("access-control-allow-origin") && !noHdr.headers.has("access-control-allow-origin") && (noHdr.headers.get("cache-control") ?? "").includes("no-store"), "");
    const opt = await br("/consent", keyMain, { method: "OPTIONS" });
    await opt.body?.cancel();
    check("Köprü: OPTIONS CORS yanıtı vermiyor", !opt.headers.has("access-control-allow-origin"), `${opt.status}`);

    /* Gövde ve doğrulama (hepsi model çağrısından önce sonuçlanır) */
    const q = (over: Record<string, unknown>) => ({ user_id: extIds.v, question: "Merhaba", consent_version: cv, ...over });
    const big = await brPost("/ask", keyMain, `{"user_id":"x","question":"${"a".repeat(33 * 1024)}"}`);
    const bigJ = await json(big);
    check("Köprü: 33 KB gövde → 413 too_large", big.status === 413 && bigJ.error === "too_large", `${big.status} ${bigJ.error}`);
    const plain = await br("/ask", keyMain, { method: "POST", headers: { "content-type": "text/plain" }, body: "{}" });
    check("Köprü: text/plain → 400", plain.status === 400, `${plain.status}`);
    const cases: [string, unknown, number, string][] = [
      ["bozuk JSON", "{bozuk", 400, "invalid_request"],
      ["soru 4001 karakter", q({ question: "a".repeat(4001) }), 413, "too_large"],
      ["soru boşluk", q({ question: "   " }), 400, "invalid_request"],
      ["context.weather 2001 karakter", q({ context: { weather: "h".repeat(2001) } }), 413, "too_large"],
      ["context.city 101 karakter", q({ context: { city: "c".repeat(101) } }), 413, "too_large"],
      ["profil alanı 501 karakter", q({ context: { profile: { interest: "i".repeat(501) } } }), 413, "too_large"],
      ["mode: x", q({ mode: "x" }), 400, "invalid_request"],
      ["language: en", q({ language: "en" }), 400, "invalid_request"],
      ["user_id satır sonu", q({ user_id: "a\nb" }), 400, "invalid_request"],
      ["user_id 129 karakter", q({ user_id: "u".repeat(129) }), 400, "invalid_request"],
      ["consent_version yok", { user_id: extIds.v, question: "Merhaba" }, 400, "invalid_request"],
      ["conversation_id UUID değil", q({ conversation_id: "abc" }), 400, "invalid_request"],
    ];
    for (const [label, body, status, error] of cases) {
      const r = await brPost("/ask", keyMain, body);
      const j = await json(r);
      check(`Köprü: /ask ${label} → ${status} ${error}`, r.status === status && j.error === error && typeof j.message === "string", `${r.status} ${j.error}`);
    }

    /* Onay sürümü: eski sürümle 428, kullanıcı kaydı oluşmaz */
    const oldV = cv > 1 ? cv - 1 : cv + 1;
    const r428 = await brPost("/ask", keyMain, { user_id: extIds.old, question: "Merhaba", consent_version: oldV });
    const r428j = await json(r428);
    const [{ n: oldUsers }] = await sql`select count(*)::int as n from app_users where bot_id = ${bot.id} and external_user_id = ${extIds.old}`;
    check(
      "Köprü: /ask eski onay sürümüyle 428 consent_required, gövdede güncel onay metni, kullanıcı kaydı yok",
      r428.status === 428 && r428j.error === "consent_required" && r428j.consent?.version === cv && r428j.consent?.text === consJ.text && oldUsers === 0,
      `${r428.status} · app_users ${oldUsers}`,
    );

    /* /feedback ve /delete-user (SQL ile açılan kullanıcılar) */
    const mkUser = async (ext: string) =>
      (await sql`insert into app_users (bot_id, device_id, external_user_id, platform, consent_version, consent_at) values (${bot.id}, 'bridge', ${ext}, 'android', ${cv}, now()) returning id`)[0].id as string;
    const userA = await mkUser(extIds.a);
    await mkUser(extIds.b);
    const convA = crypto.randomUUID();
    await sql`insert into conversations (id, bot_id, app_user_id, mode, platform, version_number, is_demo) values (${convA}, ${bot.id}, ${userA}, 'genel', 'android', 1, false)`;
    const [msgA] = await sql`insert into messages (conversation_id, role, content) values (${convA}, 'assistant', 'Smoke cevabı') returning id`;
    const fbOther = await brPost("/feedback", keyMain, { user_id: extIds.b, message_id: msgA.id, rating: 1 });
    const fbUnknown = await brPost("/feedback", keyMain, { user_id: `smoke-br-yok-${stamp}`, message_id: msgA.id, rating: 1 });
    const fbRand = await brPost("/feedback", keyMain, { user_id: extIds.a, message_id: crypto.randomUUID(), rating: 1 });
    const fbBadRating = await brPost("/feedback", keyMain, { user_id: extIds.a, message_id: msgA.id, rating: 0 });
    const fbLong = await brPost("/feedback", keyMain, { user_id: extIds.a, message_id: msgA.id, rating: 1, comment: "k".repeat(1001) });
    const fbCodes = await Promise.all([fbOther, fbUnknown, fbRand].map(async (r) => (await json(r)).error));
    check("Köprü: /feedback başka kullanıcının / kayıtsız kullanıcının / olmayan mesaj → 404 not_found", [fbOther, fbUnknown, fbRand].every((r) => r.status === 404) && fbCodes.every((c) => c === "not_found"), [fbOther, fbUnknown, fbRand].map((r) => r.status).join(","));
    check("Köprü: /feedback rating 0 → 400, yorum 1001 karakter → 413", fbBadRating.status === 400 && fbLong.status === 413, `${fbBadRating.status},${fbLong.status}`);
    const fbOk = await brPost("/feedback", keyMain, { user_id: extIds.a, message_id: msgA.id, rating: 1 });
    const [fbRow] = await sql`select rating from feedback where message_id = ${msgA.id}`;
    check("Köprü: /feedback kendi mesajına 204, gövde boş, kayıt oluştu", fbOk.status === 204 && (await fbOk.text()) === "" && fbRow?.rating === 1, `${fbOk.status}`);

    const [{ n: auditBefore }] = await sql`select count(*)::int as n from audit_log where action = 'kvkk.delete_user'`;
    const del1 = await brPost("/delete-user", keyMain, { user_id: extIds.a });
    const del1j = await json(del1);
    const del2 = await brPost("/delete-user", keyMain, { user_id: extIds.a });
    const del2j = await json(del2);
    const [{ n: leftUsers }] = await sql`select count(*)::int as n from app_users where id = ${userA}`;
    const [{ n: leftConvs }] = await sql`select count(*)::int as n from conversations where id = ${convA}`;
    check("Köprü: /delete-user ilk çağrı 200 {1, 0}, kullanıcı ve konuşma kalmadı", del1.status === 200 && del1j.deleted_conversations === 1 && del1j.deleted_photos === 0 && leftUsers === 0 && leftConvs === 0, `${del1.status} ${JSON.stringify(del1j)}`);
    check("Köprü: /delete-user idempotent (ikinci çağrı 200 {0, 0})", del2.status === 200 && del2j.deleted_conversations === 0 && del2j.deleted_photos === 0, `${del2.status} ${JSON.stringify(del2j)}`);
    const [{ n: auditAfter }] = await sql`select count(*)::int as n from audit_log where action = 'kvkk.delete_user'`;
    const [{ n: rawInAudit }] = await sql`select count(*)::int as n from audit_log where detail::text like ${`%${extIds.a}%`} or target like ${`%${extIds.a}%`}`;
    const [{ n: rawInDeletion }] = await sql`select count(*)::int as n from deletion_requests where identifier = ${extIds.a}`;
    check("Köprü: silme denetim kaydı yazıldı ama ham user_id denetimde ve silme talebinde yok (maskeli)", auditAfter - auditBefore === 2 && rawInAudit === 0 && rawInDeletion === 0, `denetim +${auditAfter - auditBefore} · ham: ${rawInAudit}/${rawInDeletion}`);
    const delBad = await brPost("/delete-user", keyMain, { user_id: "" });
    check("Köprü: /delete-user boş user_id → 400", delBad.status === 400, `${delBad.status}`);

    /* Widget, köprü kimliğine bürünemez */
    for (const dev of ["bridge", "Bridge-123"]) {
      const r = await fetch(BASE + "/api/widget/session", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": rndIp() }, body: JSON.stringify({ botKey: bot.public_key, deviceId: dev, platform: "android" }) });
      await r.body?.cancel();
      check(`Widget oturumu: ayrılmış deviceId "${dev}" → 400`, r.status === 400, `${r.status}`);
    }

    /* İptal: iptal edilen anahtar önbellek yenilenince 401 olur (TTL 30 sn; bilinmeyen anahtar ≥5 sn sonra yeniden yüklemeyi tetikler) */
    await sql`update bridge_keys set revoked_at = now(), revoked_by = 'smoke' where key_hash = ${hashBridgeKey(keyRev)}`;
    await sleep(5500);
    const reload = await br("/consent", generateBridgeKey());
    await reload.body?.cancel();
    let revStatus = 0;
    for (let i = 0; i < 4; i++) {
      const r = await br("/consent", keyRev, { ip: rndIp() });
      await r.body?.cancel();
      revStatus = r.status;
      if (revStatus === 401) break;
      await sleep(1000);
    }
    const mainAfter = await br("/consent", keyMain);
    await mainAfter.body?.cancel();
    check("Köprü: iptal edilen anahtar 401, diğer anahtar çalışmaya devam ediyor", revStatus === 401 && mainAfter.status === 200, `iptal ${revStatus} · ana ${mainAfter.status}`);
  } finally {
    await sql`delete from bridge_keys where name like 'smoke-test-%'`;
    await sql`delete from conversations where app_user_id in (select id from app_users where device_id = 'bridge' and external_user_id like 'smoke-br-%')`;
    await sql`delete from app_users where device_id = 'bridge' and external_user_id like 'smoke-br-%'`;
  }
}

/* ---------- Prompt önizleme ucu: yetki, CSRF, doğrulama, yazmama ---------- */
// Destek rolü gerçek bir kullanıcı satırı ister (rol veritabanından okunur); geçici satır sonda silinir.
const [supportUser] = await sql`insert into admin_users (email, name, password_hash, role, active) values (${`smoke-destek-${Date.now()}@example.invalid`}, 'Smoke Destek', '!', 'support', true) returning id, email, name, role`;
const supportToken = await new SignJWT({ role: "support", email: supportUser.email, name: supportUser.name })
  .setProtectedHeader({ alg: "HS256" })
  .setSubject(supportUser.id)
  .setAudience("admin")
  .setIssuedAt()
  .setExpirationTime("10m")
  .sign(new TextEncoder().encode(process.env.SESSION_SECRET!));
const PP = BASE + "/api/admin/prompt-preview";
const pp = (body: unknown, opts: { cookie?: string; origin?: string | null } = {}) =>
  fetch(PP, {
    method: "POST",
    headers: { "content-type": "application/json", ...(opts.origin === null ? {} : { origin: opts.origin ?? BASE }), ...(opts.cookie ? { cookie: opts.cookie } : {}) },
    body: JSON.stringify(body),
  });
const ppQ = { mode: "agro", text: "Salı sabahı ilaçlama yapabilir miyim?" };
check("Prompt önizleme: oturumsuz 401", (await pp(ppQ)).status === 401, "");
check("Prompt önizleme: destek rolü 403", (await pp(ppQ, { cookie: `hm_admin=${supportToken}` })).status === 403, "");
check("Prompt önizleme: farklı Origin 403", (await pp(ppQ, { cookie, origin: "https://evil.example" })).status === 403, "");
check("Prompt önizleme: Origin yok 403", (await pp(ppQ, { cookie, origin: null })).status === 403, "");
const ppBad = await Promise.all([
  pp({ ...ppQ, mode: "yok" }, { cookie }),
  pp({ ...ppQ, text: "  " }, { cookie }),
  pp({ ...ppQ, text: "a".repeat(4001) }, { cookie }),
  pp({ ...ppQ, target: "baska" }, { cookie }),
]);
check("Prompt önizleme: geçersiz mod / boş / 4001 karakter / hedef 400", ppBad.every((r) => r.status === 400), ppBad.map((r) => r.status).join(","));
const ppV1 = await pp({ ...ppQ, target: { versionId: crypto.randomUUID() } }, { cookie });
const ppV2 = await pp({ ...ppQ, target: { versionId: "../etc/passwd" } }, { cookie });
check("Prompt önizleme: rastgele / geçersiz versionId 404", ppV1.status === 404 && ppV2.status === 404, `${ppV1.status},${ppV2.status}`);
const [{ n: msgBefore }] = await sql`select count(*)::int as n from messages`;
const [{ n: convBefore }] = await sql`select count(*)::int as n from conversations`;
// `<kaynak` bloğu yalnızca eşiği geçen parçalarla kurulur (bu ortamda embedding yok; kelime eşleşmesi terimlerin yarısını ister).
// Bu yüzden soru, tohum verideki bir SSS'nin (satır 70'teki aramayla aynı) kendi sorusudur; parçası kelime eşiğini geçer.
// SSS silinmiş/değişmişse (ppQa boş) yalnızca yanıtın biçimi doğrulanır.
const [ppQa] = await sql`select question from kb_sources
  where type = 'qa' and question = 'İlaçlama için uygun hava koşulları nelerdir?' and status = 'ready' and chunk_count > 0 and deleted_at is null and superseded_by is null and mode in ('agro', 'all')
  limit 1`;
const ppRelevantQ = { mode: "agro", text: ppQa ? (ppQa.question as string) : ppQ.text };
const ppOk = await pp(ppRelevantQ, { cookie });
const ppJson = await ppOk.json().catch(() => ({}));
const [{ n: msgAfter }] = await sql`select count(*)::int as n from messages`;
const [{ n: convAfter }] = await sql`select count(*)::int as n from conversations`;
check(
  "Prompt önizleme: taslak 200, no-store, talimat <kaynak içeriyor",
  ppOk.status === 200 && (ppOk.headers.get("cache-control") ?? "").includes("no-store") && typeof ppJson.instructions === "string" && (!ppQa || ppJson.instructions.includes("<kaynak")) && Array.isArray(ppJson.hits),
  `${ppOk.status} · ${ppJson.error ?? `${ppJson.hits?.filter((h: { inContext: boolean }) => h.inContext).length}/${ppJson.hits?.length} parça bağlamda`}`,
);
check("Prompt önizleme: messages / conversations satırı oluşmadı", msgBefore === msgAfter && convBefore === convAfter, `messages ${msgBefore}→${msgAfter} · conversations ${convBefore}→${convAfter}`);
const [pubVer] = await sql`select v.number from bots b join bot_versions v on v.id = b.published_version_id order by b.created_at limit 1`;
if (pubVer) {
  const ppPub = await pp({ ...ppQ, target: "published" }, { cookie });
  const ppPubJson = await ppPub.json().catch(() => ({}));
  check("Prompt önizleme: yayındaki sürüm", ppPub.status === 200 && ppPubJson.targetLabel === `v${pubVer.number}`, `${ppPub.status} · ${ppPubJson.targetLabel ?? ppPubJson.error}`);
}

/* ---------- Boşluk analizi ve pano: yetki ve kişisel veri maskesi ---------- */
const gapCookie = `hm_admin=${supportToken}`;
const gapDenied = await fetch(BASE + "/admin/egitim/bosluklar", { headers: { cookie: gapCookie }, redirect: "manual" });
check("Boşluk analizi: destek rolü reddedilir", gapDenied.status === 307 && (gapDenied.headers.get("location") ?? "").includes("/admin?hata=yetki"), `${gapDenied.status} ${gapDenied.headers.get("location")}`);
// Gerçek (örnek olmayan) bir konuşmada, telefon numarası içeren ve üç kez tekrarlanan karşılıksız soru.
const [gapBot] = await sql`select id from bots order by created_at limit 1`;
const gapConv = crypto.randomUUID();
const gapPhone = "0555 123 45 67";
await sql`insert into conversations (id, bot_id, mode, platform, version_number, is_demo) values (${gapConv}, ${gapBot.id}, 'agro', 'web', 1, false)`;
for (let i = 0; i < 3; i++) {
  await sql`insert into messages (conversation_id, role, content, created_at) values (${gapConv}, 'user', ${`Smokegap fideleri sulayayım beni ${gapPhone} arayın`}, now() - make_interval(secs => ${i * 10 + 5}))`;
  await sql`insert into messages (conversation_id, role, content, unanswered, tool_calls, created_at) values (${gapConv}, 'assistant', 'Bilgim yok.', true, ${JSON.stringify([{ name: "forecast", input: {}, output: { ok: false, error: "x", code: "timeout" } }])}::text::jsonb, now() - make_interval(secs => ${i * 10 + 4}))`;
}
try {
  const gapAdminHtml = await (await fetch(BASE + "/admin/egitim/bosluklar", { headers: { cookie } })).text();
  check("Boşluk analizi: grup, örnek soru ve eylemler görünüyor", gapAdminHtml.includes("Smokegap") && /3(<!-- -->)? soru/.test(gapAdminHtml) && gapAdminHtml.includes("Senaryoya ekle"), "");
  const panoSupport = await fetch(BASE + "/admin", { headers: { cookie: gapCookie } });
  const panoSupportHtml = await panoSupport.text();
  check("Pano (destek): 200, boşluk sorusunda telefon maskeli", panoSupport.status === 200 && panoSupportHtml.includes("Smokegap") && !panoSupportHtml.includes(gapPhone) && panoSupportHtml.includes("••••"), `${panoSupport.status}`);
  check("Pano (destek): eğitim eylemleri (SSS, boşluk sayfası) gösterilmiyor", !panoSupportHtml.includes("/admin/egitim/bosluklar") && !panoSupportHtml.includes("bilgi-tabani?soru="), "");
  check("Pano (destek): telefon bağlantı/forma da sızmıyor (ham ve URL kodlu)", !panoSupportHtml.includes(encodeURIComponent(gapPhone)) && !panoSupportHtml.includes("0555") && panoSupportHtml.includes("en iyi çabayla"), "");
  const panoAdminHtml = await (await fetch(BASE + "/admin", { headers: { cookie } })).text();
  check("Pano (yönetici): boşluk grubu ve araç tablosu", panoAdminHtml.includes("Smokegap") && panoAdminHtml.includes("En sık 5 boşluk") && panoAdminHtml.includes("Araç başarısı") && panoAdminHtml.includes("timeout"), "");
} finally {
  await sql`delete from conversations where id = ${gapConv}`;
}
/* ---------- Destek rolü: konuşma detayı, liste, geri bildirim ve debug ucu kişisel veri sızdırmaz ---------- */
{
  const piiPhone = "0532 987 65 43";
  const piiLat = "39.925533";
  const piiLon = "32.866287";
  const piiMail = "smokepii.kisi@example.com";
  const piiEnlem = "41.0082";
  const piiConv = crypto.randomUUID();
  await sql`insert into conversations (id, bot_id, mode, platform, version_number, is_demo, title) values (${piiConv}, ${gapBot.id}, 'agro', 'web', 1, false, ${`Smokepii ${piiPhone}`})`;
  await sql`insert into messages (conversation_id, role, content, created_at) values (${piiConv}, 'user', ${`Smokepii konumum ${piiLat}, ${piiLon} ve ${piiPhone} ${piiMail}`}, now() - interval '2 seconds')`;
  const tools = [{ name: "current_weather", input: { lat: Number(piiLat), lon: Number(piiLon), location: "Smokepiikoy", enlem: Number(piiEnlem), merkez: [Number(piiEnlem), 28.9784] }, output: { ok: true, data: { city: "Smokepiikoy", latitude: Number(piiLat), longitude: Number(piiLon), temp: 21 } } }];
  const [am] = await sql`insert into messages (conversation_id, role, content, search_query, tool_calls, created_at) values (${piiConv}, 'assistant', ${`Tamam ${piiPhone} numarasını not aldım`}, ${`hava ${piiLat} ${piiLon}`}, ${JSON.stringify(tools)}::text::jsonb, now() - interval '1 second') returning id`;
  await sql`insert into feedback (message_id, conversation_id, rating, comment) values (${am.id}, ${piiConv}, -1, ${`Beni ${piiPhone} arayın ${piiMail}`})`;
  const raws = [piiPhone, piiLat, piiLon, piiMail, "Smokepiikoy", "987 65 43"];
  const leaks = (html: string) => raws.filter((r) => html.includes(r) || html.includes(encodeURIComponent(r)));
  try {
    const sup = (path: string) => fetch(BASE + path, { headers: { cookie: gapCookie } });
    const detail = await sup(`/admin/konusmalar/${piiConv}`);
    const detailHtml = await detail.text();
    check("Destek: konuşma detayı 200, içerik okunabilir ve maskeli", detail.status === 200 && detailHtml.includes("Smokepii") && detailHtml.includes("••••"), `${detail.status}`);
    check("Destek: konuşma detayı HTML + RSC yükünde telefon/e-posta/koordinat/konum adı yok", leaks(detailHtml).length === 0, leaks(detailHtml).join(" | "));
    const list = await (await sup(`/admin/konusmalar?q=Smokepii&aralik=tumu`)).text();
    check("Destek: konuşma listesi başlığı maskeli", list.includes("Smokepii") && leaks(list).length === 0, leaks(list).join(" | "));
    const blocked = await (await sup(`/admin/konusmalar?q=${encodeURIComponent(piiPhone)}&aralik=tumu`)).text();
    // Next, istek URL'sini (destek kullanıcısının kendi yazdığı arama) RSC yüküne yansıtır; bu mesaj verisi değil, yok sayılır.
    const blockedLeaks = leaks(blocked.replaceAll(`q=${piiPhone.replaceAll(" ", "+")}`, "q=").replaceAll(`q=${encodeURIComponent(piiPhone)}`, "q="));
    check(
      "Destek: telefon desenli arama engellenir (mesaj içeriği sorgulanamaz)",
      !blocked.includes("Smokepii") && blocked.includes("aramalar yapılamaz") && blockedLeaks.length === 0,
      `sonuç sızdı: ${blocked.includes("Smokepii")} · uyarı var: ${blocked.includes("aramalar yapılamaz")} · ham değer: ${blockedLeaks.join(" | ") || "yok"}`,
    );
    // ILIKE jokeri ("_") ile telefon çıkarımı: harf dışı karakterler atılınca 3'ten uzun rakam dizisi olduğu için engellenir.
    const wildcard = await (await sup(`/admin/konusmalar?q=${encodeURIComponent(piiPhone.replaceAll(" ", "_"))}&aralik=tumu`)).text();
    check(
      "Destek: '_' jokerli telefon araması boş sonuç döner, ham değer sızmaz",
      !wildcard.includes("Smokepii") && wildcard.includes("aramalar yapılamaz") && leaks(wildcard).length === 0,
      `sonuç sızdı: ${wildcard.includes("Smokepii")} · uyarı var: ${wildcard.includes("aramalar yapılamaz")} · ham değer: ${leaks(wildcard).join(" | ") || "yok"}`,
    );
    check("Destek: konuşma detayında 'enlem' anahtarlı ham koordinat yok", !detailHtml.includes(piiEnlem), "");
    const fbHtml = await (await sup(`/admin/geri-bildirim`)).text();
    check("Destek: geri bildirim yorumu ve mesajlar maskeli", fbHtml.includes("arayın") && leaks(fbHtml).length === 0, leaks(fbHtml).join(" | "));
    const panoHtml = await (await sup(`/admin`)).text();
    check("Destek: pano (geri bildirim, son konuşmalar) maskeli", leaks(panoHtml).length === 0, leaks(panoHtml).join(" | "));
    const dbg = await sup(`/api/admin/messages/${am.id}`);
    const dbgText = await dbg.text();
    check("Destek: /api/admin/messages/[id] araç JSON ve sorgu maskeli", dbg.status === 200 && leaks(dbgText).length === 0 && dbgText.includes("current_weather") && dbgText.includes("temp"), leaks(dbgText).join(" | "));
    // Yetkili rol ham veriyi görmeye devam eder.
    const adminDetail = await (await fetch(BASE + `/admin/konusmalar/${piiConv}`, { headers: { cookie } })).text();
    check("Yönetici: konuşma detayında ham değerler görünür", adminDetail.includes(piiLat) && adminDetail.includes(piiMail) && adminDetail.includes("Smokepiikoy"), "");
    const adminDbg = await (await fetch(BASE + `/api/admin/messages/${am.id}`, { headers: { cookie } })).text();
    check("Yönetici: debug ucu ham araç verisi döner", adminDbg.includes(piiLat) && adminDbg.includes("Smokepiikoy"), "");
  } finally {
    await sql`delete from conversations where id = ${piiConv}`;
  }
}
/* ---------- Destek rolü: sağlık işaretli (health_context) konuşmanın içeriğini göremez ---------- */
{
  const notice = "Bu konuşma sağlık bilgisi içerebilir; içeriği görme yetkiniz yok.";
  const hConv = crypto.randomUUID();
  const hTitle = "Smokehealthtitle";
  const hUser = "Smokehealthmsg polen alerjim var, nerede yürüyüş yapabilirim";
  const hAnswer = "Smokehealthans polen yoğunluğu düşük bölgeleri öneririm";
  const hComment = "Smokehealthcmt cevap işime yaramadı";
  const hQuery = "Smokehealthsrc polen alerjisi yürüyüş";
  await sql`insert into conversations (id, bot_id, mode, platform, version_number, is_demo, title, health_context) values (${hConv}, ${gapBot.id}, 'genel', 'web', 1, false, ${hTitle}, true)`;
  await sql`insert into messages (conversation_id, role, content, created_at) values (${hConv}, 'user', ${hUser}, now() - interval '2 seconds')`;
  const [hm] = await sql`insert into messages (conversation_id, role, content, search_query, created_at) values (${hConv}, 'assistant', ${hAnswer}, ${hQuery}, now() - interval '1 second') returning id`;
  await sql`insert into feedback (message_id, conversation_id, rating, comment) values (${hm.id}, ${hConv}, -1, ${hComment})`;
  const raws = [hTitle, hUser, hAnswer, hComment, hQuery];
  const leaks = (html: string) => raws.filter((r) => html.includes(r));
  try {
    const sup = (path: string) => fetch(BASE + path, { headers: { cookie: gapCookie } });
    const detail = await sup(`/admin/konusmalar/${hConv}`);
    const detailHtml = await detail.text();
    check("Destek: sağlık işaretli konuşma detayı 200, uyarı var, içerik/başlık/yorum yok", detail.status === 200 && detailHtml.includes(notice) && leaks(detailHtml).length === 0, `${detail.status} ${leaks(detailHtml).join(" | ")}`);
    const list = await (await sup(`/admin/konusmalar?aralik=tumu`)).text();
    check("Destek: konuşma listesinde sağlık işaretli konuşmanın başlığı yok", list.includes(`/admin/konusmalar/${hConv}`) && !list.includes(hTitle), "");
    const search = await (await sup(`/admin/konusmalar?q=Smokehealthmsg&aralik=tumu`)).text();
    check("Destek: sağlık işaretli konuşma mesaj aramasıyla bulunamaz", !search.includes(`/admin/konusmalar/${hConv}`), "");
    const fbHtml = await (await sup(`/admin/geri-bildirim`)).text();
    check("Destek: geri bildirimde sağlık işaretli konuşmanın soru/cevap/yorumu yok, uyarı var", fbHtml.includes(notice) && leaks(fbHtml).length === 0, leaks(fbHtml).join(" | "));
    const panoHtml = await (await sup(`/admin`)).text();
    check("Destek: pano (son konuşmalar, geri bildirim) sağlık işaretli içeriği göstermiyor", leaks(panoHtml).length === 0, leaks(panoHtml).join(" | "));
    const dbg = await sup(`/api/admin/messages/${hm.id}`);
    const dbgText = await dbg.text();
    const dbgJson = (() => {
      try {
        return JSON.parse(dbgText);
      } catch {
        return {};
      }
    })();
    check("Destek: /api/admin/messages/[id] sağlık işaretli konuşmada kısıtlı (sorgu/hata/araç yok)", dbg.status === 200 && dbgJson.restricted === true && leaks(dbgText).length === 0 && dbgJson.notice === notice, `${dbg.status} ${leaks(dbgText).join(" | ")}`);
    // pii yetkili rol içeriği görür; yine de düzeltme/senaryo kopyası alamaz.
    const adminHtml = await (await fetch(BASE + `/admin/konusmalar/${hConv}`, { headers: { cookie } })).text();
    check("Yönetici: sağlık işaretli konuşma içeriğini görür", adminHtml.includes(hUser) && adminHtml.includes(hAnswer) && !adminHtml.includes(notice), "");
    check("Yönetici: sağlık işaretli konuşmada düzeltme ve senaryo formu yok", !adminHtml.includes("Bu cevabı düzelt") && !adminHtml.includes("Senaryoya ekle"), "");
    const adminDbg = await (await fetch(BASE + `/api/admin/messages/${hm.id}`, { headers: { cookie } })).text();
    check("Yönetici: debug ucu sağlık işaretli konuşmada sorguyu döner", adminDbg.includes(hQuery), "");
  } finally {
    await sql`delete from conversations where id = ${hConv}`;
  }
}
await sql`delete from admin_users where id = ${supportUser.id}`;

// Test cihazının izlerini temizle (yüklenen görsel dosyası dahil)
const files = await sql`select storage_key from attachments where app_user_id in (select id from app_users where device_id = ${deviceId})`;
for (const f of files) await storage.remove(f.storage_key).catch(() => {});
await sql`delete from attachments where app_user_id in (select id from app_users where device_id = ${deviceId})`;
await sql`delete from conversations where app_user_id in (select id from app_users where device_id = ${deviceId})`;
await sql`delete from app_users where device_id = ${deviceId}`;
await sql.end();

const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? "✓" : "✗"} ${r.name}${r.detail ? `  (${r.detail})` : ""}`);
console.log(`\n${results.length - failed.length}/${results.length} başarılı`);
process.exit(failed.length ? 1 : 0);
