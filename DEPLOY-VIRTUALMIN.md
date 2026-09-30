# havamania.com kurulumu (Virtualmin + GoDaddy)

Bu sunucu: **152.53.241.81** (Debian 12, Apache, Docker 29). Uygulama portu: **3060** (3050 başka bir uygulamada).
DNS: **GoDaddy** (şu an ns1/ns2.muratozsay.com). E-posta ve `app.havamania.com` eski sunucuda (**185.165.46.11**) kalır.

Sıra önemlidir: site yeni sunucuda çalışıp test edilmeden DNS değiştirilmez.

---

## Aşama 1 · GoDaddy: otomatik yenileme (hemen)

havamania.com › **Registration Settings** › **Auto-renew: On**. Alan adı 17 Aralık 2026'da doluyor. Ad sunucularına henüz dokunmayın.

## Aşama 2 · Virtualmin: sanal sunucu

**Create Virtual Server** ekranında:

1. **Domain name:** `havamania.com`
2. **Administration password:** bir şifre belirleyin.
3. **Enabled features** bölümünde:
   - ✅ Apache website enabled
   - ✅ SSL website enabled
   - ❌ **DNS domain** (DNS GoDaddy'de)
   - ❌ **Mail for domain** (posta eski sunucuda; açık kalırsa bu sunucudan gönderilen @havamania.com postaları yanlış yere gider)
   - ❌ MySQL / PostgreSQL database (veritabanı Docker'da)
4. **Create Server**.

## Aşama 3 · SSH: uygulamayı kur

Apache modülleri:

```bash
a2enmod proxy proxy_http headers && systemctl reload apache2
```

Kod GitHub'daki özel depodan (`bcilak/havamania-platform`) çekilir. Sunucu GitHub'a bir kez tarayıcı koduyla giriş yapar; anahtar dosyası gerekmez.

1. GitHub CLI'ı kurun:
   ```bash
   apt-get update && apt-get install -y git gh
   ```
2. Giriş yapın:
   ```bash
   gh auth login
   ```
   Sorulara sırayla: **GitHub.com** › **HTTPS** › "Authenticate Git with your GitHub credentials?" **Yes** › **Login with a web browser**. Ekranda 8 haneli bir kod çıkar. Kendi bilgisayarınızda https://github.com/login/device adresini açın, kodu girip **Authorize** deyin.
3. Depoyu çekin:
   ```bash
   gh repo clone bcilak/havamania-platform /opt/havamania
   ```

Ayar dosyasını hazırlayın (bu dosya depoda yoktur, yalnızca sunucuda durur):

```bash
cd /opt/havamania && cp .env.example .env.production && chmod 600 .env.production
echo "SESSION_SECRET=$(openssl rand -base64 48 | tr -d '\n')"
echo "ENCRYPTION_KEY=$(openssl rand -base64 32)"
echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)"
echo "CRON_SECRET=$(openssl rand -hex 24)"
nano .env.production
```

`.env.production` içinde şunları değiştirin:

```
SESSION_SECRET=   (yukarıda üretilen)
ENCRYPTION_KEY=   (yukarıda üretilen; ayrıca güvenli bir yere yedekleyin)
POSTGRES_PASSWORD=(yukarıda üretilen)
CRON_SECRET=      (yukarıda üretilen)
APP_URL=https://havamania.com
APP_PORT=3060
ADMIN_EMAIL=      (panele girecek e-posta)
ADMIN_PASSWORD=   (güçlü bir şifre)
```

`DATABASE_URL` satırına dokunmayın. Kaydedip çıkın (Ctrl+O, Enter, Ctrl+X).

Derleme ve başlatma:

```bash
echo "alias hm='docker compose -f /opt/havamania/docker-compose.prod.yml --env-file /opt/havamania/.env.production'" >> ~/.bashrc && source ~/.bashrc
hm build
hm up -d db
hm run --rm tools npm run db:init:prod
hm run --rm tools npx drizzle-kit push
hm run --rm -e SEED_DEMO=0 tools npm run db:seed:prod
hm up -d app
curl -s http://127.0.0.1:3060/api/health
```

Son komut `{"ok":true}` dönmeli.

## Aşama 4 · Virtualmin: Apache yönlendirmesi

Sol üstten `havamania.com`'u seçin.

**A) SSL sitesi.** **Web Configuration › Configure SSL Website › Edit Directives** ekranında en alta ekleyin:

```apache
ProxyPreserveHost On
RequestHeader set X-Forwarded-Proto "https"
ProxyTimeout 120
ProxyPass /.well-known !
ProxyPass / http://127.0.0.1:3060/ flushpackets=on
ProxyPassReverse / http://127.0.0.1:3060/
```

**B) Normal site (port 80).** **Web Configuration › Configure Website › Edit Directives** ekranında en alta ekleyin:

```apache
ProxyPreserveHost On
RequestHeader set X-Forwarded-Proto "http"
ProxyTimeout 120
ProxyPass /.well-known !
ProxyPass / http://127.0.0.1:3060/ flushpackets=on
ProxyPassReverse / http://127.0.0.1:3060/
```

Her ikisinde de **Save**, ardından sağ üstteki **Apply Changes**.

Satırların nedeni:

- `ProxyPreserveHost On` olmazsa paneldeki formlar çalışmaz.
- `flushpackets=on` sohbetin kelime kelime akması içindir.
- `/.well-known !` SSL sertifikasının alınabilmesi içindir.

## Aşama 5 · DNS'e dokunmadan test

1. Kendi bilgisayarınızda Not Defteri'ni **yönetici olarak** açın. `C:\Windows\System32\drivers\etc\hosts` dosyasının sonuna ekleyin:
   ```
   152.53.241.81 havamania.com www.havamania.com
   ```
2. Tarayıcıda **https**://havamania.com açın. Sertifika uyarısı çıkması normal; henüz Virtualmin'in geçici sertifikası var. "Gelişmiş › Devam et" deyin.
   - Landing açılmalı.
   - `/admin` adresinde `ADMIN_EMAIL` / `ADMIN_PASSWORD` ile giriş yapılabilmeli. Giriş çerezi yalnızca HTTPS'te çalışır, http ile denemeyin.
3. Sunucuda duman testi (36/36 geçmeli):
   ```bash
   hm run --rm -e APP_URL=http://app:3000 tools npm run smoke:prod
   ```

Her şey tamamsa bir sonraki aşamaya geçin. hosts satırını Aşama 7'nin sonunda silin.

## Aşama 6 · GoDaddy: DNS

1. havamania.com › **DNS** › **Nameservers** › **Change Nameservers** › **GoDaddy Nameservers (recommended)** › Save/Continue. Doğrulama kodu isterse girin.
2. Hemen ardından **DNS Records** sekmesine geçin:
   - Hazır gelen `A @ Parked` kaydını düzenleyip değerini `152.53.241.81` yapın.
   - Aşağıdaki kayıtları **Add New Record** ile ekleyin.

| Tür | Ad | Değer | Not |
| --- | --- | --- | --- |
| A | `@` | `152.53.241.81` | Yeni site |
| CNAME | `www` | `@` | Genelde hazır gelir; yoksa ekleyin |
| A | `app` | `185.165.46.11` | Mevcut uygulama, aynen kalır |
| A | `mail` | `185.165.46.11` | E-posta |
| A | `smtp` | `185.165.46.11` | |
| A | `pop` | `185.165.46.11` | |
| A | `ftp` | `185.165.46.11` | |
| MX | `@` | `mail.havamania.com` | Öncelik 10 |
| TXT | `@` | `v=spf1 mx ip4:185.165.46.11 ip4:185.165.46.140 include:relay.mailbaby.net ~all` | |

TTL için `1/2 Hour` yeterli. GoDaddy'nin eklediği `NS`, `SOA` ve `_domainconnect` kayıtlarına dokunmayın.

## Aşama 7 · Yayılma ve SSL

1. Sunucuda şu komut **152.53.241.81** dönene kadar bekleyin. Birkaç saat, en fazla 48 saat sürebilir:
   ```bash
   dig +short havamania.com @8.8.8.8
   ```
2. Virtualmin › havamania.com › **Server Configuration › SSL Certificate › Let's Encrypt** sekmesi: `havamania.com` ve `www.havamania.com` › **Request Certificate**.
3. Virtualmin › **Web Configuration › Website Options** (bazı sürümlerde "Website Redirects") › **Redirect HTTP to HTTPS: Yes**.
4. Kendi bilgisayarınızdaki hosts satırını silin.

## Aşama 8 · SSH: gece görevleri

`crontab -e` ile ekleyin (`CRON_SECRET` yerine `.env.production`'daki değeri yazın):

```cron
15 3 * * * curl -fsS -X POST -H "Authorization: Bearer CRON_SECRET" http://127.0.0.1:3060/api/cron/kvkk >/dev/null
0 2 * * * mkdir -p /opt/havamania-yedek && docker compose -f /opt/havamania/docker-compose.prod.yml --env-file /opt/havamania/.env.production exec -T db pg_dump -U havamania havamania | gzip > /opt/havamania-yedek/db-$(date +\%F).sql.gz && docker run --rm -v havamania_uploads:/data -v /opt/havamania-yedek:/b alpine tar czf /b/fotograflar-$(date +\%F).tgz -C /data . && find /opt/havamania-yedek -mtime +14 -delete
```

Birinci satır her gece 03:15'te KVKK temizliğini yapar. İkinci satır her gece 02:00'de veritabanı ve fotoğraf yedeği alır ve 14 günden eski yedekleri siler. Virtualmin yedekleri Docker verisini kapsamaz; bu yüzden ikinci satır gerekli.

## Aşama 9 · Son kontroller

- https://havamania.com sertifika uyarısı olmadan açılıyor.
- `/admin` › **Hesabım** sayfasından iki adımlı doğrulamayı açın.
- Dışarıdan bir `@havamania.com` adresine e-posta gönderin; gelmeli.
- `app.havamania.com` eskisi gibi açılmalı.

---

## Güncelleme (sonraki sürümler)

Değişiklikler GitHub'a gönderildikten sonra sunucuda (`.env.production` ve yüklenen fotoğraflar korunur):

```bash
cd /opt/havamania && git pull
hm build
hm run --rm tools npx drizzle-kit push    # "truncate" sorarsa HAYIR
hm up -d app
```

## Sorun giderme

| Belirti | Çözüm |
| --- | --- |
| Paneldeki formlar hata veriyor ("Invalid Server Actions request") | Apache'de `ProxyPreserveHost On` eksik |
| Panele giriş yapılıyor ama hemen çıkış yapıyor | Sayfa HTTPS değil; https ile açın |
| Sohbet cevabı akmıyor, tek parça geliyor | `flushpackets=on` eksik |
| 502 / 503 | Uygulama kapalı: `hm ps`, `hm logs app --tail 50` |
| Let's Encrypt hata veriyor | DNS henüz yayılmadı ya da `ProxyPass /.well-known !` eksik |
