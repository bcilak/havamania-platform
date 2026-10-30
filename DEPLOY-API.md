# api.havamania.com kurulumu (mobil backend)

Android uygulamasının backend'i (FastAPI, `altikoddigitalsolutions/Havamania-MobileApp` deposunun `backend/` klasörü) havamania.com ile aynı sunucuya kurulur: **152.53.241.81**, Debian 12, Apache, Docker.

| | |
|---|---|
| Kaynak kod | `/opt/havamania-api/src` (mobil deponun klonu) |
| Ayarlar ve gizli dosyalar | `/opt/havamania-api/.env`, `/opt/havamania-api/firebase-admin.json` (yalnızca sunucuda) |
| Compose dosyası | `/opt/havamania/deploy/api/docker-compose.yml` (bu depodan) |
| Uygulama portu | `127.0.0.1:8010` (yalnızca Apache erişir) |
| Docker ağı | `172.31.250.0/24` |
| Veritabanı | Ayrı PostgreSQL 16 konteyneri; platformun veritabanından bağımsız |

Sıra önemlidir. Gizli değerler (anahtarlar, şifreler, Firebase JSON) sohbete, e-postaya ya da depoya yazılmaz; yalnızca sunucudaki dosyalara girilir.

---

## Aşama 0 · Mobil ekipten gelecekler

1. **Firebase Admin hizmet hesabı JSON dosyası** (Firebase Console › Proje ayarları › Hizmet hesapları › Yeni özel anahtar). Mobil ekip dosyayı **doğrudan sunucuya** yükler: Virtualmin › Dosya Yöneticisi ya da SFTP ile `/opt/havamania-api/firebase-admin.json`. E-postayla ya da mesajla gönderilmez.
2. **`FIREBASE_STORAGE_BUCKET`**: Firebase Console › Storage'daki tam bucket adı.
3. **Kurulacak sürüm**: mobil deponun `main` dalı mı, belirli bir commit mi?

`FIREBASE_PROJECT_ID` = `havamania-be3df` (Android'deki google-services.json ile aynı). Bu değer ilk kullanıcı oluştuktan sonra **değiştirilmez**; kullanıcı kimlikleri ondan türetilir.

## Aşama 1 · DNS

havamania.com DNS'inin yönetildiği yerde (GoDaddy) bir kayıt ekleyin:

| Tür | Ad | Değer | TTL |
|---|---|---|---|
| A | `api` | `152.53.241.81` | 600 |

Yayıldığını kontrol edin (birkaç dakika sürebilir):

```bash
dig +short api.havamania.com
```

## Aşama 2 · Virtualmin: alt sunucu

**Create Virtual Server** › **Sub-server** (havamania.com altında):

1. **Domain name:** `api.havamania.com`
2. **Enabled features:** ✅ Apache website, ✅ SSL website. ❌ DNS, ❌ Mail, ❌ MySQL/PostgreSQL.
3. **Create Server**.

## Aşama 3 · SSH: hazırlık

Port ve ağın boş olduğunu kontrol edin (ikisi de boş çıktı vermeli):

```bash
ss -ltnp | grep ':8010 '
docker network inspect $(docker network ls -q) --format '{{range .IPAM.Config}}{{.Subnet}} {{end}}' | tr ' ' '\n' | grep '^172.31.250'
```

Kodu ve kurulum dosyalarını çekin:

```bash
mkdir -p /opt/havamania-api && chmod 700 /opt/havamania-api
git clone https://github.com/altikoddigitalsolutions/Havamania-MobileApp.git /opt/havamania-api/src
cd /opt/havamania && git pull
cp /opt/havamania/deploy/api/env.example /opt/havamania-api/.env && chmod 600 /opt/havamania-api/.env
```

Gizli değerleri üretin ve `.env`'e yazın:

```bash
echo "SECRET_KEY=$(openssl rand -hex 32)"
echo "METRICS_SECRET=$(openssl rand -hex 24)"
echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)"
nano /opt/havamania-api/.env
```

`.env` içinde: `SECRET_KEY`, `METRICS_SECRET`, `POSTGRES_PASSWORD` (yukarıda üretilen) ve `FIREBASE_STORAGE_BUCKET` (Aşama 0). `POSTGRES_PASSWORD`'ü sonradan değiştirmeyin; veritabanı ilk açılışta bu şifreyle oluşur.

Firebase dosyasının yerinde olduğunu doğrulayın (dosya yoksa Docker onun yerine boş bir klasör oluşturur ve backend açılmaz):

```bash
ls -l /opt/havamania-api/firebase-admin.json && chmod 600 /opt/havamania-api/firebase-admin.json
```

Kısayol:

```bash
echo "alias hma='docker compose -f /opt/havamania/deploy/api/docker-compose.yml --env-file /opt/havamania-api/.env'" >> ~/.bashrc && source ~/.bashrc
```

## Aşama 4 · Köprü anahtarı

1. havamania.com/admin › **Yayın › Gömme › Mobil backend köprüsü** › anahtar üret (süper yönetici).
2. Gösterilen anahtarı kopyalayıp doğrudan `/opt/havamania-api/.env` içindeki `CHATBOT_API_KEY=` satırına yapıştırın (`nano /opt/havamania-api/.env`). Anahtar yalnızca bir kez gösterilir; başka hiçbir yere yazmayın.

Backend bu anahtar olmadan üretim kipinde açılmaz; migration da çalışmaz.

## Aşama 5 · Derleme, veritabanı, başlatma

```bash
hma build api
hma up -d db
hma run --rm api alembic upgrade head
hma run --rm api alembic current
```

Son komut `0017_push_deliveries (head)` göstermeli.

```bash
hma up -d api
hma ps
curl -s http://127.0.0.1:8010/health
```

`hma ps`'te ikisi de `healthy` olmalı; son komut `{"status":"ok"}` döner. Açılmazsa `hma logs --tail 50 api`.

Platform köprüsünü sunucunun içinden deneyin (anahtar ekrana yazılmaz; `200` beklenir):

```bash
hma exec -T api python -c "import os,urllib.request as u;r=u.Request(os.environ['CHATBOT_BASE_URL']+'/consent',headers={'Authorization':'Bearer '+os.environ['CHATBOT_API_KEY']});print(u.urlopen(r,timeout=10).status)"
```

`401` dönerse anahtar yanlış kopyalanmış ya da iptal edilmiş demektir.

## Aşama 6 · Virtualmin: Apache yönlendirmesi

api.havamania.com › **Web Configuration › Edit Directives**. **Hem 80 hem 443** sanal sunucusunda, `DocumentRoot` satırından sonra:

```apache
ProxyPreserveHost On
ProxyTimeout 90
RequestHeader set X-Forwarded-Proto "https"
ProxyPass /.well-known !
ProxyPass /docs !
ProxyPass /redoc !
ProxyPass /openapi.json !
ProxyPass /v1/metrics !
ProxyPass / http://127.0.0.1:8010/
ProxyPassReverse / http://127.0.0.1:8010/
```

- `/docs`, `/redoc`, `/openapi.json` ve `/v1/metrics` dışarıya kapalıdır (404). Metrikler sunucunun içinden `http://127.0.0.1:8010/v1/metrics` ile okunur.
- `ProxyTimeout 90`, backend'in 50 saniyelik platform beklemesinden uzun olmalı.

Sonra **SSL Certificate › Let's Encrypt** › `api.havamania.com` için sertifika alın (DNS yayılmış olmalı). **Website Redirects** ile HTTP → HTTPS yönlendirmesini açın.

## Aşama 7 · Doğrulama

```bash
curl -s https://api.havamania.com/health
curl -s -o /dev/null -w "%{http_code}\n" https://api.havamania.com/docs
curl -s -o /dev/null -w "%{http_code}\n" https://api.havamania.com/v1/chatbot/consent
```

Beklenen: `{"status":"ok"}`, `404`, `401` (Firebase token'ı olmadan).

Hız sınırının kullanıcı başına çalıştığını kontrol edin: dışarıdan bir istek attıktan sonra `hma logs --tail 5 api` satırlarında istemci adresi sizin IP'niz olmalı, `172.31.250.1` olmamalı.

## Aşama 8 · Zamanlanmış görevler

`crontab -e` ile ekleyin:

```cron
*/5 * * * * docker compose -f /opt/havamania/deploy/api/docker-compose.yml --env-file /opt/havamania-api/.env exec -T api python -m app.services.resume_account_deletions >> /var/log/havamania-api-silme.log 2>&1
30 2 * * * mkdir -p /opt/havamania-api-yedek && docker compose -f /opt/havamania/deploy/api/docker-compose.yml --env-file /opt/havamania-api/.env exec -T db pg_dump -U havamania_api havamania_api | gzip > /opt/havamania-api-yedek/db-$(date +\%F).sql.gz && find /opt/havamania-api-yedek -mtime +14 -delete
```

- İlki bekleyen hesap silme işlerini her 5 dakikada yeniden dener (çıkış kodu 1 = en az bir iş hâlâ başarısız; log dosyasına bakın).
- İkincisi her gece veritabanı yedeği alır, 14 günden eskileri siler.
- Platformun kendi KVKK görevi (`/api/cron/kvkk`, DEPLOY-VIRTUALMIN.md Aşama 8) de kurulu olmalı: `crontab -l | grep cron/kvkk`.

## Aşama 9 · Hesap silmeyi açma (sonra)

Ön koşullar: Firestore ve Storage kuralları canlı projeye dağıtılmış (mobil ekip), Aşama 8'deki silme görevi kurulu. Sonra:

1. `/opt/havamania-api/.env` › `ACCOUNT_DELETION_ENABLED=true`, ardından `hma up -d api`.
2. Bir test hesabıyla uygulamadan hesap silin. Platform panelinde o kullanıcının konuşmaları kalmamalı; `/var/log/havamania-api-silme.log`'da hata olmamalı.

---

## Güncelleme (sonraki sürümler)

```bash
hma exec -T db pg_dump -U havamania_api havamania_api | gzip > /opt/havamania-api-yedek/db-once-$(date +\%F-\%H\%M).sql.gz
cd /opt/havamania-api/src && git pull
cd /opt/havamania && git pull
hma build api
hma run --rm api alembic upgrade head
hma up -d api
curl -s http://127.0.0.1:8010/health
```

Migration, yeni kod açılmadan önce çalışır; yeni kod eski şemayla çalışmaz.

## Anahtar yenileme

Panelde yeni anahtar üret → `.env`'deki `CHATBOT_API_KEY`'i değiştir → `hma up -d api` → Aşama 5'teki iç denemeyle `200` gör → panelde eski anahtarı iptal et.

## Sorun giderme

| Belirti | Neden |
|---|---|
| `api` konteyneri sürekli yeniden başlıyor | `hma logs --tail 50 api`. Çoğunlukla `.env`'de eksik `CHATBOT_API_KEY`, `SECRET_KEY` ya da `firebase-admin.json` klasör olarak oluşmuş (`rm -r` edip dosyayı koyun) |
| Uygulamada her istek `401` | `FIREBASE_PROJECT_ID` yanlış ya da hizmet hesabı dosyası başka projenin |
| Asistan `503` | Platform anahtarı yanlış (`/consent` iç denemesi `401`) ya da platformda model seçili değil |
| Let's Encrypt hata veriyor | DNS henüz yayılmadı ya da `ProxyPass /.well-known !` eksik |
| `alembic upgrade` 0012'de duruyor | Eski veritabanında yinelenen cihaz token'ı var; yeni kurulumda olmaz |
| Loglarda tüm istemciler `172.31.250.1` | Docker ağ geçidi farklı; `docker network inspect havamania-api_internal` ile kontrol edin |
