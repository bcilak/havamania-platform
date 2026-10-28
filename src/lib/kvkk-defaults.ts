import type { KvkkSettings } from "./settings";

/*
 * KVKK ayarlarının varsayılanı (veritabanı yok; birim testleri okuyabilsin diye `settings.ts`'ten ayrı).
 * Seed `kvkk` satırı yazmaz; satırı olmayan kurulumlar bu değerle çalışır. Metin değişince sürüm de artar:
 * herkes (widget dahil) yeniden onay verir. Kayıtlı satırı olan kurulumlar etkilenmez.
 *
 * İki ayrı rıza vardır: (1) asistan rızası (`consentText`, widget ve mobil; sağlık verisi YOKTUR, çünkü widget
 * sağlık verisi toplamaz), (2) sağlık verisi rızası (`healthConsentText`, yalnızca mobil; isteğe bağlı, KVKK m. 6).
 */
export const KVKK_DEFAULTS: KvkkSettings = {
  retentionDays: 180,
  consentVersion: 2,
  // Yer tutucular gösterilirken doldurulur (`renderConsentText`): {{sirket}}, {{saklama}}, {{site}}.
  consentText: [
    "{{sirket}}, Havamania Asistan'da yazdığınız mesajları, gönderdiğiniz fotoğrafları ve sorunuza cevap verebilmek için uygulamanın eklediği bilgileri (konum ya da seçili şehir, hava durumu özeti, seyahat planı özeti ve profil tercihleriniz) size cevap vermek ve hizmeti iyileştirmek amacıyla işler. Konuşmalar en fazla {{saklama}} gün saklanır.",
    "Yurt dışına aktarım: Cevap üretilebilmesi için sohbetleriniz ve bu bilgiler yurt dışındaki yapay zekâ hizmet sağlayıcılarına aktarılır.",
    "Ayrıntılı bilgi: {{site}}/kvkk",
    "Onaylayarak sohbetlerinizin ve uygulama bilgilerinizin işlenmesine ve yurt dışındaki yapay zekâ hizmet sağlayıcılarına aktarılmasına açık rıza vermiş olursunuz.",
  ].join("\n\n"),
  consentUpdatedAt: null,
  // Sağlık verisi rızası ayrı ve isteğe bağlıdır; mobil uygulama ikinci bir onay kutusuyla gösterir. Metin değişince sürüm artar (v2: "cevaplar bu bilgiye dayanabilir ve saklama süresince tutulur" cümlesi eklendi).
  healthConsentVersion: 2,
  healthConsentText: [
    "Sağlık hassasiyetleriniz (ör. alerji, astım) KVKK m. 6 kapsamında özel nitelikli kişisel veridir. Profilinize eklediyseniz, size uygun cevap üretilebilmesi için bu bilgi yalnızca sorunuzla birlikte asistana gönderilir ve yurt dışındaki yapay zekâ hizmet sağlayıcılarına aktarılır.",
    "Bu bilgi platformumuzda ayrıca saklanmaz; ancak asistanın cevapları bu bilgiye dayanabilir ve cevaplar konuşma kaydında saklama süresince tutulur (en fazla {{saklama}} gün).",
    "Bu onay isteğe bağlıdır. Vermezseniz sağlık hassasiyetleriniz asistana gönderilmez ve asistanı kullanmaya devam edebilirsiniz. Onayınızı dilediğiniz zaman geri alabilirsiniz. Ayrıntılı bilgi: {{site}}/kvkk",
    "Onaylayarak {{sirket}} tarafından sağlık hassasiyetlerinizin işlenmesine ve yurt dışındaki yapay zekâ hizmet sağlayıcılarına aktarılmasına ayrıca açık rıza vermiş olursunuz.",
  ].join("\n\n"),
  lastCleanupAt: null,
};
