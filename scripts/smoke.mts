/*
 * Duman testi: çalışan sunucuya karşı panelin ve widget'ın uçtan uca çalıştığını doğrular.
 *   npm run start   (başka bir terminalde)
 *   npm run smoke
 * Admin oturumu, uygulamanın kendi SESSION_SECRET'ıyla üretilir; şifre kullanılmaz.
 */
import { SignJWT } from "jose";
import postgres from "postgres";
import { stripCitations } from "../src/lib/ai/citations";
import { isFollowUp } from "../src/lib/ai/retrieval-core";
import { storage } from "../src/lib/storage";

const BASE = (process.env.APP_URL || "http://localhost:3110").replace(/\/$/, "");
const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
const results: { name: string; ok: boolean; detail: string }[] = [];
const check = (name: string, ok: boolean, detail = "") => results.push({ name, ok, detail });

const [admin] = await sql`select id, email, name, role from admin_users where role = 'super_admin' and active order by created_at limit 1`;
const [bot] = await sql`select public_key from bots order by created_at limit 1`;
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
for (const [path, needle] of [["/gizlilik", "KVKK"], ["/kullanim-kosullari", "Kullanım Koşulları"], ["/hesap-silme", "Silinen veriler"]]) {
  const r = await fetch(BASE + path);
  const html = await r.text();
  check(`Yasal sayfa ${path}`, r.ok && html.includes(needle) && !html.includes("{{"), `${r.status}`);
}
const oldPrivacy = await fetch(BASE + "/privacy", { redirect: "manual" });
check("/privacy → /gizlilik", oldPrivacy.status === 308 && (oldPrivacy.headers.get("location") ?? "").endsWith("/gizlilik"), `${oldPrivacy.status}`);
check("Landing alt bilgisinde yasal bağlantılar", home.includes("href=\"/gizlilik\"") && home.includes("href=\"/hesap-silme\""), "");

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
