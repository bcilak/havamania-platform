/*
 * Yasal sayfalar (gizlilik, kullanım koşulları, hesap silme). Metinler panelden
 * düzenlenir ve {{...}} yer tutucularıyla şirket bilgisine bağlanır; böylece unvan
 * ya da e-posta değişince üç sayfayı ayrı ayrı düzeltmek gerekmez.
 */

export type LegalSlug = "privacy" | "terms" | "deletion";

export type LegalSettings = {
  company: string;
  address: string;
  email: string;
  hosting: string;
  updatedAt: string; // YYYY-MM-DD
  privacy: string;
  terms: string;
  deletion: string;
};

export const LEGAL_PAGES: Record<LegalSlug, { path: string; title: string; description: string }> = {
  privacy: {
    path: "/gizlilik",
    title: "Gizlilik Politikası",
    description: "Havamania uygulaması, web sitesi ve Havamania Asistan'da kişisel verilerinizin nasıl işlendiği ve KVKK kapsamındaki haklarınız.",
  },
  terms: {
    path: "/kullanim-kosullari",
    title: "Kullanım Koşulları",
    description: "Havamania uygulaması, web sitesi ve Havamania Asistan'ın kullanımına ilişkin koşullar.",
  },
  deletion: {
    path: "/hesap-silme",
    title: "Hesap ve Veri Silme",
    description: "Havamania hesabınızı ve verilerinizi nasıl silebileceğiniz, hangi verilerin silindiği ve ne kadar saklandığı.",
  },
};

export const LEGAL_TOKENS: [string, string][] = [
  ["{{sirket}}", "Şirket unvanı"],
  ["{{adres}}", "Adres (boşsa bu satır gizlenir)"],
  ["{{eposta}}", "İletişim e-postası"],
  ["{{sunucu}}", "Sunucu konumu"],
  ["{{saklama}}", "Asistan saklama süresi (KVKK sayfasından, gün)"],
  ["{{site}}", "Sitenin adresi"],
  ["{{guncelleme}}", "Son güncelleme tarihi"],
];

const PRIVACY = `Bu Gizlilik Politikası, {{sirket}} ("biz") tarafından sunulan Havamania mobil uygulaması, havamania.com web sitesi ve uygulamadaki Havamania Asistan (birlikte "Hizmet") kapsamında kişisel verilerinizin nasıl işlendiğini açıklar. 6698 sayılı Kişisel Verilerin Korunması Kanunu ("KVKK") kapsamındaki aydınlatma yükümlülüğümüz de bu metinle yerine getirilir.

## 1. Veri sorumlusu

Kişisel verileriniz veri sorumlusu sıfatıyla {{sirket}} tarafından işlenir.
- **Unvan:** {{sirket}}
- **Adres:** {{adres}}
- **E-posta:** {{eposta}}

## 2. Hangi verileri topluyoruz?

**Hesap bilgileri.** Kayıt olurken ya da giriş yaparken verdiğiniz ad, e-posta adresi ve şifre. Şifreler geri döndürülemez biçimde saklanır. Google veya Apple ile giriş yaparsanız bu hizmetlerin bizimle paylaştığı ad, e-posta ve hesap kimliği.

**Konum bilgisi.** İzin verdiğinizde cihazınızın kesin veya yaklaşık konumu. Konumu, bulunduğunuz yerin hava durumunu, tarla koşullarını ve uçuş bilgilerini göstermek için kullanırız. Konum iznini dilediğiniz zaman cihaz ayarlarından kapatabilirsiniz; bu durumda konuma bağlı özellikler çalışmayabilir.

**Havamania Asistan verileri.** Asistana yazdığınız mesajlar, gönderdiğiniz fotoğraflar, asistanın cevapları, seçtiğiniz mod (genel, agro, fly), cevaplara verdiğiniz geri bildirimler ve açık rıza kaydınız. Bu veriler uygulamaya özel rastgele bir cihaz kimliği, varsa hesap kimliğiniz, cihaz platformu (iOS veya Android) ve uygulama sürümüyle birlikte saklanır. Sorularınızda geçen yer adları gibi bilgiler de bu kapsamdadır.

**Bildirim bilgileri.** Bildirimlere izin verirseniz, cihazınıza bildirim gönderebilmek için oluşturulan bildirim anahtarı (push token) ve bildirim tercihleriniz.

**Kullanım ve teknik veriler.** Cihaz modeli, işletim sistemi ve uygulama sürümü, dil, uygulama içi etkileşimler (ör. hangi ekranların açıldığı), çökme ve hata kayıtları. Bu veriler analitik ve çökme raporlama hizmetleri (ör. Google Firebase) aracılığıyla toplanır.

**Web sitesi.** havamania.com'u ziyaret ettiğinizde sunucularımız güvenlik amacıyla IP adresi, tarayıcı bilgisi ve istek zamanı gibi standart kayıtları tutar. Web sitesinde reklam veya izleme çerezi kullanmıyoruz; yalnızca yönetim paneline giriş için zorunlu bir oturum çerezi bulunur.

## 3. Verileri hangi amaçlarla ve hangi hukuki sebeplerle işliyoruz?

- **Hizmeti sunmak** (hesabınızı oluşturmak, konumunuza göre hava, tarım ve uçuş bilgisi göstermek, bildirim göndermek): sözleşmenin kurulması ve ifası (KVKK m. 5/2-c).
- **Asistanın sorularınıza cevap vermesi ve bu amaçla mesajlarınızın yurt dışındaki yapay zekâ sağlayıcılarına aktarılması:** açık rızanız (KVKK m. 5/1 ve m. 9). Rızanızı asistanı ilk açtığınızda verirsiniz.
- **Hizmetin güvenliği, kötüye kullanımın önlenmesi, hataların giderilmesi ve Hizmetin iyileştirilmesi** (çökme raporları, kullanım istatistikleri, asistan cevaplarının kalitesinin incelenmesi): meşru menfaatimiz (KVKK m. 5/2-f).
- **Yasal yükümlülükler** (resmî makamların talepleri, kayıt saklama yükümlülükleri): kanunlarda açıkça öngörülmesi ve hukuki yükümlülüğümüz (KVKK m. 5/2-a ve 5/2-ç).

Kişisel verilerinizi üçüncü taraflara satmıyoruz.

## 4. Havamania Asistan hakkında

- Asistanın cevapları yapay zekâ tarafından otomatik olarak üretilir; hatalı veya eksik olabilir. Tarım ve uçuşla ilgili kararlarınızda resmî kaynakları esas alın.
- Mesajlarınız ve fotoğraflarınız, cevap üretilebilmesi için yapay zekâ hizmet sağlayıcılarına (Anthropic, OpenAI, Google gibi) aktarılır. Bu sağlayıcıların sunucuları yurt dışında, ağırlıklı olarak ABD'de bulunur.
- Asistanın kalitesini artırmak için yetkili personelimiz konuşmaları inceleyebilir ve hatalı cevapları düzeltebilir. İnceleme yalnızca bu amaçla ve erişim yetkisi olan kişilerce yapılır.
- Fotoğraflar herkese açık değildir; yalnızca yetkili personel tarafından veya süreli, imzalı bağlantılarla görüntülenebilir.
- Asistan konuşmaları ve fotoğraflar, son mesajdan itibaren en fazla **{{saklama}} gün** saklanır ve bu sürenin sonunda kalıcı olarak silinir.

## 5. Verileri kimlerle paylaşıyoruz?

- **Barındırma:** Hizmetin sunucuları ve veritabanı {{sunucu}} bulunan bir veri merkezinde barındırılır.
- **Yapay zekâ sağlayıcıları:** yalnızca asistan mesajlarınız ve fotoğraflarınız, cevap üretmek amacıyla (bkz. 4. bölüm).
- **Analitik, çökme raporlama ve bildirim hizmetleri** (ör. Google Firebase): kullanım ve teknik veriler ile bildirim anahtarı.
- **Kimlik doğrulama hizmetleri:** Google veya Apple ile giriş yaparsanız ilgili hizmet.
- **Hava durumu veri kaynakları:** konuma bağlı bilgi gösterebilmek için konum koordinatları; bu iletimde adınız veya e-postanız paylaşılmaz.
- **Resmî makamlar:** yalnızca yasal bir zorunluluk olduğunda.

Bu hizmet sağlayıcıların bir kısmı yurt dışındadır. Asistan verilerinin yurt dışına aktarımı açık rızanıza dayanır; diğer aktarımlar KVKK'nın 9. maddesine uygun olarak yapılır.

## 6. Verileri ne kadar süre saklıyoruz?

- **Hesap bilgileri:** hesabınız açık olduğu sürece; hesabınızı sildiğinizde silinir.
- **Asistan konuşmaları ve fotoğraflar:** en fazla {{saklama}} gün; hesabınızı silerseniz daha erken.
- **Kullanım ve çökme verileri:** ilgili analitik hizmetinin ayarlarında belirlenen süre boyunca.
- **Yedekler:** sistem yedekleri en geç 14 gün içinde kendiliğinden silinir.
- **Yasal saklama yükümlülüğü olan kayıtlar:** ilgili mevzuatta öngörülen süre boyunca.

## 7. Güvenlik

Verileriniz şifreli bağlantı (HTTPS) üzerinden iletilir. Hizmet sağlayıcılarına ait erişim anahtarları şifrelenmiş olarak saklanır. Yönetim paneline erişim rollerle sınırlandırılır ve iki adımlı doğrulamayla korunabilir; panelde yapılan işlemler kayıt altına alınır. Hiçbir sistem kesin güvenlik garantisi veremese de verilerinizi korumak için makul teknik ve idari tedbirleri alırız.

## 8. Haklarınız

KVKK'nın 11. maddesi uyarınca şu haklara sahipsiniz:
- Kişisel verilerinizin işlenip işlenmediğini öğrenme ve işlenmişse bilgi talep etme,
- İşlenme amacını ve verilerin amacına uygun kullanılıp kullanılmadığını öğrenme,
- Yurt içinde veya yurt dışında verilerin aktarıldığı üçüncü kişileri bilme,
- Eksik veya yanlış işlenmişse düzeltilmesini isteme,
- KVKK'nın 7. maddesindeki şartlar çerçevesinde silinmesini veya yok edilmesini isteme,
- Düzeltme ve silme işlemlerinin verilerin aktarıldığı üçüncü kişilere bildirilmesini isteme,
- Münhasıran otomatik sistemlerle analiz edilmesi sonucu aleyhinize bir sonuç çıkmasına itiraz etme,
- Kanuna aykırı işleme nedeniyle zarara uğramanız hâlinde zararın giderilmesini talep etme.

Açık rızanızı dilediğiniz zaman geri alabilirsiniz. Başvurularınızı, kimliğinizi doğrulayabileceğimiz bilgilerle birlikte {{eposta}} adresine iletebilirsiniz. Başvurunuzu en geç 30 gün içinde ücretsiz olarak sonuçlandırırız. Başvurunuzun reddedilmesi veya cevabı yetersiz bulmanız hâlinde Kişisel Verileri Koruma Kurulu'na şikâyette bulunabilirsiniz.

## 9. Hesabınızı ve verilerinizi silme

Hesabınızı uygulamanın içinden silebilirsiniz. Adımlar ve silinen veriler için: {{site}}/hesap-silme

## 10. Çocuklar

Havamania 13 yaşın altındaki çocuklara yönelik değildir ve bu yaştaki çocuklardan bilerek kişisel veri toplamayız. Böyle bir durumu fark ederseniz {{eposta}} adresinden bize bildirin; ilgili verileri sileriz.

## 11. Değişiklikler

Bu politikayı zaman zaman güncelleyebiliriz. Güncel metin her zaman bu sayfada yayımlanır; önemli değişiklikleri ayrıca uygulama içinden duyururuz.`;

const TERMS = `Bu Kullanım Koşulları, {{sirket}} ("biz") tarafından sunulan Havamania mobil uygulaması, havamania.com web sitesi ve Havamania Asistan'ın (birlikte "Hizmet") kullanımına ilişkin kuralları belirler. Hizmeti kullanarak bu koşulları kabul etmiş olursunuz.

## 1. Hizmet

Havamania; hava durumu, tarım (agro) ve uçuş (fly) odaklı bilgiler ile bu konularda soru sorabileceğiniz yapay zekâ destekli bir asistan sunar. Hizmetin kapsamını değiştirebilir, geliştirebilir veya bazı özellikleri sonlandırabiliriz.

## 2. Bilgilendirme amaçlıdır

- Havamania'daki bilgiler ve asistanın cevapları **yalnızca bilgilendirme ve karar desteği** amaçlıdır. Hava tahminleri doğası gereği belirsizlik içerir.
- **Uçuş:** Havamania resmî bir meteoroloji brifingi değildir. Uçuş planlamasında METAR, TAF, SIGMET ve NOTAM gibi resmî kaynakları ve ilgili otoritelerin duyurularını esas alın.
- **Tarım:** İlaçlama önerileri genel bilgidir. Ürün etiketindeki doz ve bekleme sürelerine uyun; gerektiğinde bir ziraat mühendisine danışın.
- Asistanın cevapları yapay zekâ tarafından otomatik üretilir; hatalı, eksik veya güncel olmayan bilgi içerebilir.

## 3. Hesabınız

Kayıt sırasında doğru bilgi vermek ve hesabınızın güvenliğini sağlamak sizin sorumluluğunuzdadır. Hesabınızda yetkisiz bir kullanım fark ederseniz {{eposta}} adresinden bize bildirin. Hesabınızı dilediğiniz zaman uygulamanın içinden silebilirsiniz.

## 4. Kullanım kuralları

Hizmeti kullanırken şunları yapmamayı kabul edersiniz:
- Yasalara aykırı, hakaret, taciz veya nefret içeren içerik göndermek,
- Başkalarına ait kişisel verileri veya fotoğrafları izinsiz paylaşmak,
- Hizmeti otomatik araçlarla aşırı yüklemek, güvenlik önlemlerini aşmaya veya yazılımı tersine mühendislikle çözmeye çalışmak,
- Asistanı zararlı veya yanıltıcı içerik üretmeye yönlendirmek.

Bu kurallara aykırı kullanımda hesabınızı askıya alabilir veya kapatabiliriz.

## 5. Gönderdiğiniz içerik

Asistana gönderdiğiniz mesaj ve fotoğrafların hakları sizde kalır. Bu içerikleri Hizmeti sunmak, cevap üretmek ve asistanın kalitesini artırmak amacıyla Gizlilik Politikası'nda açıklandığı şekilde işlememize izin verirsiniz. Gizlilik Politikası: {{site}}/gizlilik

## 6. Fikrî mülkiyet

Havamania adı, logosu, tasarımı, yazılımı ve içerikleri {{sirket}} veya lisans verenlerinin mülkiyetindedir. Yazılı iznimiz olmadan kopyalanamaz, çoğaltılamaz veya ticari amaçla kullanılamaz.

## 7. Sorumluluğun sınırlandırılması

Hizmet "olduğu gibi" sunulur. Yasaların izin verdiği ölçüde; tahminlerin veya asistan cevaplarının doğruluğu, kesintisiz erişim ya da belirli bir amaca uygunluk konusunda garanti vermeyiz ve Hizmetteki bilgilere dayanılarak alınan kararlardan doğan doğrudan veya dolaylı zararlardan sorumlu tutulamayız. Bu sınırlama, kasıt veya ağır ihmalden doğan sorumluluğumuzu ve tüketici mevzuatından doğan haklarınızı etkilemez.

## 8. Üçüncü taraf hizmetler

Hizmet; hava durumu veri sağlayıcıları, yapay zekâ sağlayıcıları ve Google, Apple gibi üçüncü taraf hizmetlerle birlikte çalışır. Uygulamayı indirdiğiniz mağazanın (Google Play, App Store) koşulları da ayrıca geçerlidir.

## 9. Değişiklikler ve fesih

Bu koşulları güncelleyebiliriz; güncel metin bu sayfada yayımlanır. Değişikliklerden sonra Hizmeti kullanmaya devam etmeniz güncel koşulları kabul ettiğiniz anlamına gelir. Hizmeti dilediğiniz zaman kullanmayı bırakabilir ve hesabınızı silebilirsiniz.

## 10. Uygulanacak hukuk ve iletişim

Bu koşullar Türkiye Cumhuriyeti kanunlarına tabidir. Sorularınız için: {{eposta}}`;

const DELETION = `Bu sayfa, {{sirket}} tarafından geliştirilen **Havamania** uygulamasındaki hesabınızı ve ilgili verilerinizi nasıl silebileceğinizi açıklar.

## Uygulamanın içinden silme

1. Havamania uygulamasını açın ve hesabınıza giriş yapın.
2. **Profil › Ayarlar › Hesabı sil** adımlarını izleyin.
3. Silme işlemini onaylayın.

Hesabınız ve aşağıda listelenen veriler kalıcı olarak silinir; bu işlem geri alınamaz.

## Uygulamaya erişemiyorsanız

Uygulamayı kaldırdıysanız veya giriş yapamıyorsanız, hesabınıza kayıtlı e-posta adresinden {{eposta}} adresine "Hesap silme talebi" konulu bir e-posta gönderin. Kimliğinizi doğruladıktan sonra hesabınızı en geç 30 gün içinde sileriz.

## Silinen veriler

- Hesap bilgileriniz (ad, e-posta, giriş bilgileri)
- Konum bilgileriniz ve uygulama tercihleriniz
- Havamania Asistan ile yaptığınız tüm konuşmalar ve gönderdiğiniz fotoğraflar
- Bildirim anahtarınız

## Saklanan veriler

- Yasal olarak saklamamız gereken kayıtlar, yalnızca ilgili mevzuatta öngörülen süre boyunca saklanır.
- Sistem yedeklerindeki kopyalar en geç 14 gün içinde kendiliğinden silinir.
- Kimliğinizle ilişkilendirilemeyen anonim kullanım istatistikleri saklanabilir.

## Yalnızca asistan geçmişini silme

Hesabınızı silmeden yalnızca Havamania Asistan konuşmalarınızın ve fotoğraflarınızın silinmesini istiyorsanız {{eposta}} adresine yazabilirsiniz. Asistan verileri ayrıca en fazla {{saklama}} gün sonra kendiliğinden silinir.

Gizlilik hakkında ayrıntılı bilgi: {{site}}/gizlilik`;

export const LEGAL_DEFAULTS: LegalSettings = {
  company: "Altıkod Digital Solutions",
  address: "",
  email: "",
  hosting: "Avrupa Birliği'nde",
  updatedAt: "2026-10-04",
  privacy: PRIVACY,
  terms: TERMS,
  deletion: DELETION,
};

export const LEGAL_BODY_DEFAULTS: Record<LegalSlug, string> = { privacy: PRIVACY, terms: TERMS, deletion: DELETION };

/** Yer tutucuları doldurur. Adres boşsa adres geçen satırlar tamamen çıkarılır. */
export function fillLegal(body: string, cfg: LegalSettings, ctx: { retentionDays: number; siteUrl: string }): string {
  const lines = cfg.address.trim() ? body.split("\n") : body.split("\n").filter((l) => !l.includes("{{adres}}"));
  const values: Record<string, string> = {
    "{{sirket}}": cfg.company.trim() || "Altıkod Digital Solutions",
    "{{adres}}": cfg.address.trim(),
    "{{eposta}}": cfg.email.trim() || "[iletişim e-postası henüz eklenmedi]",
    "{{sunucu}}": cfg.hosting.trim() || "Avrupa Birliği'nde",
    "{{saklama}}": String(ctx.retentionDays),
    "{{site}}": ctx.siteUrl.replace(/\/$/, ""),
    "{{guncelleme}}": formatLegalDate(cfg.updatedAt),
  };
  return lines.join("\n").replace(/\{\{[a-z]+\}\}/g, (t) => values[t] ?? t);
}

export function formatLegalDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso : new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(d);
}
