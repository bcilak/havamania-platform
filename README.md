# Havamania Platform

Tek bir Next.js uygulaması üç işi yapar:

- **Site** (`/`): Havamania landing sayfası, içeriği CMS'ten gelir. Yasal sayfalar: `/gizlilik`, `/kullanim-kosullari`, `/hesap-silme`, `/kvkk` (KVKK m. 10 aydınlatma metni; eski `/privacy`, `/terms`, `/delete-account` adresleri bunlara yönlenir).
- **Admin paneli** (`/admin`): CMS, asistan konuşmaları, fotoğraflar, geri bildirim, bot eğitimi, yayın ve gömme, modeller, KVKK.
- **Sohbet** (`/w/{bot anahtarı}` ve `/api/chat`): mobil uygulamanın WebView'da, web sitelerinin `widget.js` ile açtığı asistan.
- **Mobil backend köprüsü** (`/api/bridge/{ask,consent,delete-user,feedback}`): mobil uygulamanın backend'i (FastAPI) asistanla kullanıcı adına sunucudan sunucuya konuşur. Panelde üretilen bota bağlı sunucu anahtarıyla (`Authorization: Bearer hm_bk_…`) kimlik doğrular. Sağlık hassasiyetleri için ayrı, isteğe bağlı rıza vardır: `GET /consent` yanıtındaki `health {version, text}` metni gösterilir, `/ask` isteğine `health_consent: true` ve `health_consent_version` eklenir; ikisi de yoksa `profile.health_sensitivities` modele gönderilmez (hata verilmez). Metin panelde KVKK ayarlarından düzenlenir.

## Kurulum

Gerekenler: Node.js 20.9+, Docker.

```bash
cp .env.example .env.local      # SESSION_SECRET, ENCRYPTION_KEY, ADMIN_PASSWORD doldurun
npm install
npm run setup                   # Postgres'i başlatır, şemayı kurar, ilk verileri ekler
npm run build && npm run start  # http://localhost:3110/admin
```

`npm run setup` şunları oluşturur: süper admin (`ADMIN_EMAIL` / `ADMIN_PASSWORD`), Havamania Asistan botu ve ilk yayın (v1), sitenin bugünkü içeriği, temel soru-cevaplar ve **"Örnek" etiketli demo konuşmalar**. Demo veriler Pano'daki "Örnek verileri sil" butonuyla tek seferde silinir. İstemiyorsanız `SEED_DEMO=0 npm run db:seed`.

### Portlar

| Hizmet     | Port | Neden                                                         |
| ---------- | ---- | ------------------------------------------------------------- |
| Uygulama   | 3110 | 3000 ve 3100 bu makinede başka projelerce kullanılıyor         |
| PostgreSQL | 5544 | 5432 başka bir Postgres tarafından kullanılıyor               |

### Windows notu

Bu makinedeki Windows Uygulama Denetimi ilkesi Next.js'in native SWC dosyasını engelliyor. Bu yüzden `dev` ve `build` betikleri `--webpack` ile çalışır (WASM derleyici). Linux sunucuda bu bayrağı kaldırıp Turbopack kullanabilirsiniz.

## Betikler

| Komut                   | Ne yapar                                                                   |
| ----------------------- | -------------------------------------------------------------------------- |
| `npm run dev`           | Geliştirme sunucusu (3110)                                                  |
| `npm run build` / `start` | Üretim derlemesi ve sunucusu                                             |
| `npm run setup`         | `db:up` + `db:init` (pgvector) + `db:push` (şema) + `db:seed`              |
| `npm run smoke`         | Çalışan sunucuya karşı duman testi: tüm admin sayfaları, widget akışı, yetkiler, yasal sayfalar (`/kvkk` dahil), köprü kimliği ve doğrulama |
| `npm run smoke:actions` | Veri değiştiren işlemler: CMS kaydet/yayınla, SSS ekle, yayınla/geri al, köprü anahtarı üret/iptal et. Sonunda her şeyi eski hâline döndürür |
| `npm run mock`          | Sahte model (OpenAI uyumlu, araç çağırma dahil) + sahte Havamania veri API'si, port 3199. Anahtarsız geliştirme için |
| `npm run e2e -- setup`  | Botu sahte servislere bağlar ve yayınlar; önce durumun anlık görüntüsünü alır |
| `npm run smoke:chat`    | Sohbetin uçtan uca testi: akış, araçlar, kayıt, gizlilik, Durdur, hız sınırı ve köprü (`/ask`, `model_error`, geri bildirim, silme, KVKK kilit yarışı). `mock` + `e2e -- setup` gerekir. Köprü zaman aşımı (504) kontrolü için sunucuyu `BRIDGE_TIMEOUT_MS=5000` ile başlatın |
| `npm run e2e -- teardown` | Her şeyi `setup` öncesine döndürür                                        |
| `npm run typecheck`     | TypeScript kontrolü                                                         |

## Canlıya çıkış

Adım adım Virtualmin kurulumu için `DEPLOY-VIRTUALMIN.md`. Docker ile (önerilen). Bağımsız Next.js çıktısı (`output: "standalone"`) kullanılır; imaj ~Node 22 Alpine.

```bash
cp .env.example .env.production      # SESSION_SECRET, ENCRYPTION_KEY, APP_URL=https://alanadiniz,
                                     # ADMIN_EMAIL, ADMIN_PASSWORD, POSTGRES_PASSWORD, CRON_SECRET doldurun
docker compose -f docker-compose.prod.yml --env-file .env.production up -d db
docker compose -f docker-compose.prod.yml --env-file .env.production run --rm tools npm run db:init:prod
docker compose -f docker-compose.prod.yml --env-file .env.production run --rm tools npx drizzle-kit push
docker compose -f docker-compose.prod.yml --env-file .env.production run --rm -e SEED_DEMO=0 tools npm run db:seed:prod
docker compose -f docker-compose.prod.yml --env-file .env.production up -d app
```

- Uygulama `127.0.0.1:3000`'de dinler. Önüne HTTPS sonlandıran bir ters vekil koyun (nginx, Caddy, Cloudflare) ve `X-Forwarded-For` başlığını iletin; hız sınırları gerçek IP'ye göre çalışır.
- Sağlık kontrolü: `GET /api/health` (veritabanı dahil). İmajda Docker `HEALTHCHECK` tanımlı.
- Canlıda `SEED_DEMO=0` kullanın; demo konuşmaları oluşmaz.
- Güvenlik başlıkları `next.config.ts`'te: panel ve giriş iframe'e alınamaz, `/w/*` web gömmesi için bilerek açıktır.
- Hız sınırları süreç içidir; birden fazla uygulama örneği çalıştıracaksanız paylaşılan bir depoya (Redis) taşınmalı.
- Anonim erişim açıkken biri cihaz kimliğini değiştirerek kullanıcı başına günlük sınırı aşabilir; hız sınırları bunu yavaşlatır, kesin çözüm Yayın › Gömme'den anonim erişimi kapatıp imzalı token istemektir.

Doğrulandı: imaj derleniyor, konteyner `healthy` oluyor ve `npm run smoke` konteynere karşı 36/36 geçiyor.

## Sonra yapılandırılacaklar

Panel bunların hepsi olmadan açılır ve çalışır; Pano'daki "Kurulum" listesi eksikleri gösterir.

1. **Model sağlayıcısı** (Yönetim › Modeller): Anthropic, OpenAI, Google ya da OpenAI uyumlu bir uç nokta. Anahtarlar AES-256-GCM ile şifreli saklanır. Fiyatları girerseniz Pano maliyeti gösterir.
2. **Mod başına model** (Eğitim › Kişilik ve ton), ardından **Yayınla**. Model seçilmeden sohbet "Bu mod için henüz bir yapay zekâ modeli seçilmedi" der.
3. **Embedding modeli** (isteğe bağlı, Modeller › Bilgi tabanı araması). Seçilmezse arama yalnızca Türkçe tam metinle yapılır. Değiştirmek tüm kaynakların yeniden işlenmesini tetikler.
4. **Havamania veri API'si** (Yönetim › Veri entegrasyonu): hava, tahmin, agro ve fly araçlarının adresi, anahtarı ve uç noktaları. Bağlanana kadar asistan güncel veri istendiğinde erişemediğini söyler, değer uydurmaz.
5. **Kullanıcı token anahtarı** (Yayın › Gömme): mobil uygulamanın backend'i giriş yapmış kullanıcıyı bu anahtarla imzaladığı HS256 JWT ile tanıtır (`sub` = kullanıcı kimliği). Anonim erişim şu an açık.
6. **KVKK aydınlatma metni** (Yönetim › KVKK): hukuk onayından geçmeli. Mesajlar yurt dışındaki yapay zekâ sağlayıcılarına gittiği için yurt dışına aktarım sayılır.
7. **Zamanlanmış temizlik**: `.env.local`'e `CRON_SECRET` ekleyin ve günde bir kez `POST /api/cron/kvkk` (`Authorization: Bearer $CRON_SECRET`) çağırın.
8. **Yasal sayfalar** (İçerik › Yasal sayfalar): şirket unvanı, iletişim e-postası, sunucu konumu ve metinler. Google Play'e gizlilik politikası ve hesap silme adresi olarak buradaki bağlantılar verilir. Metinler uygulamanın topladığı verilerle ve Play Console'daki Veri güvenliği formuyla uyuşmalı; hukuk onayından geçmeli. Politikada asistan verilerinin saklama süresi sonunda silindiği yazar: 7. maddedeki zamanlanmış temizliği açmadan mağazaya göndermeyin.
9. **Mobil backend köprüsü** (Yayın › Gömme › Köprü anahtarları, yalnızca süper yönetici): anahtar bir kez gösterilir, veritabanında yalnızca SHA-256 özeti tutulur. En çok 2 etkin anahtar vardır (rotasyon): önce yeni anahtarı oluşturup backend'e girin, sonra eskisini iptal edin (iptal en geç 30 sn içinde etkinleşir). Ortam değişkenleri (hepsi isteğe bağlı, `.env*` dosyalarına yazılmasa da olur): `BRIDGE_TIMEOUT_MS` (43000, model bütçesi), `RATE_LIMIT_BRIDGE_PER_USER_PER_MIN` (8), `RATE_LIMIT_BRIDGE_PER_KEY_PER_MIN` (120), `RATE_LIMIT_BRIDGE_CONCURRENCY` (16, anahtar başına aynı anda çalışan /ask; `RATE_LIMIT_BRIDGE_QUEUE` 32 bekleyen, `RATE_LIMIT_BRIDGE_QUEUE_WAIT_MS` 10000; dolunca 429 `rate_limited` + `Retry-After`), `BRIDGE_DAILY_MESSAGES_PER_BOT` (5000, bot başına günlük köprü mesajı tavanı; kalıcı `bridge_usage` sayacından sayılır, konuşma silmeyle sıfırlanmaz; dolunca 429 `daily_limit`), `RATE_LIMIT_BRIDGE_AUTH_FAIL_PER_MIN` (20, IP başına). Paneldeki günlük mesaj sınırı köprüye de maliyet tavanı olarak uygulanır; mobil premium kotasından yüksek tutun.
10. **Yeni onay metni ve yasal metinler**: `/admin/yasal` sayfasında kayıtlı metni varsayılandan farklı olan her sayfa için uyarı çıkar; yeni gizlilik, hesap silme ve KVKK metinlerini almak için "varsayılana döndür"ü işaretleyin. Kayıtlı bir `kvkk` ayarı varsa yeni onay metnini Yönetim › KVKK'dan girin (sürüm artar; widget ve mobil uygulama yeniden onay ister).
11. **Canlı ortam**: `APP_URL`, S3/R2 deposu (`STORAGE_DRIVER=s3`), güçlü `ADMIN_PASSWORD`, HTTPS.

## Mobil gömme

Yayın › Gömme sayfası bot anahtarı doldurulmuş kod parçalarını gösterir. Native sarmalayıcılar `sdk/` altında:

- `sdk/ios/HavamaniaChat.swift`: WKWebView, köprü, fotoğraf seçimi (Info.plist'e kamera/fotoğraf izin metinleri gerekir)
- `sdk/android/HavamaniaChat.kt`: WebView aktivitesi, `onShowFileChooser` ile fotoğraf seçimi

Gömme kodu sürüm numarası değil bot anahtarı içerir: panelde yayınladığınız değişiklik, uygulamayı güncellemeden kullanıcılara ulaşır. Kullanıcı token'ı URL'nin `#` kısmında taşınır; sunucu loglarına düşmez.

## Yapı

```
src/
  app/
    page.tsx                 site (CMS'ten)
    login/                   giriş + iki adımlı doğrulama
    admin/                   panel sayfaları ve server action'lar
    w/[botKey]/              sohbet ekranı (WebView / iframe)
    api/chat                 sohbet (SSE akış)
    api/widget/*             oturum + KVKK onayı, fotoğraf yükleme, geri bildirim
    api/files, api/media     depo dosyaları (imzalı / herkese açık medya)
    api/cron/kvkk            saklama süresi temizliği
    widget.js                web siteleri için gömme betiği
  components/                panel arayüzü, sohbet bileşeni, landing motoru
  db/schema.ts               17 tablo (Drizzle + pgvector)
  lib/
    ai/                      sağlayıcılar, araçlar, arama, belge işleme, orkestratör
    cms/                     içerik şeması, landing şablonu
    bot-config.ts            modlar, tonlar, araçlar, sabit güvenlik uyarıları
sdk/                         iOS ve Android sarmalayıcıları
scripts/                     kurulum ve duman testleri
```

## Güvenlik notları

- `/admin` altı `proxy.ts` ile korunur; her sayfa ve action ayrıca rol izni kontrol eder (süper admin, içerik editörü, bot eğitmeni, destek).
- Destek rolü kişisel verileri (cihaz/kullanıcı kimliği) maskeli görür.
- Sohbet geçmişi istemciden değil veritabanından kurulur; kullanıcı başkasının konuşmasına yazamaz.
- Kullanıcı fotoğrafları yalnızca admin oturumu ya da süreli imzalı bağlantıyla, `sandbox` CSP'siyle sunulur.
- Fly ve Agro uyarıları koddadır (`MODE_DISCLAIMERS`); panelden kaldırılamaz.
