import { resolveIcon } from "./icons";
import type { LandingContent } from "./schema";

/*
 * Kayıtlı landing içeriğini güncel biçime getirir. Okuma sırasında uygulanır, böylece
 * sunucuda ayrıca bir veri taşıma adımı gerekmez. Yalnızca eski VARSAYILAN metinler
 * değiştirilir; panelde düzenlenmiş bir metin olduğu gibi kalır. Editör bir sonraki
 * kayıtta dönüşmüş hâli saklar.
 */

const OLD_EYEBROWS: Record<string, string> = {
  "Faz 2 · Agro Modu": "Agro Modu",
  "Faz 2 · Fly Modu": "Fly Modu",
};

/* Yol haritası konumlandırması: eski varsayılan metin → yeni metin. Landing artık Agro ve Fly'ı
   mod olarak anlatmıyor; asistanın modları değişmedi, yalnızca site anlatımı değişti. */
const OLD_SEO_TITLE = "Havamania — Akıllı Hava, Tarım & Uçuş Asistanı";
const NEW_SEO_TITLE = "Havamania — Akıllı Hava ve Seyahat Asistanı";
const OLD_SEO_DESCRIPTION =
  "Havamania, dağınık atmosferik veriyi tek panelde anlama dönüştürür. Seyahat planlayıcı, Agro Modu, Fly Modu ve size kendi dilinizden konuşan bir asistan.";
const NEW_SEO_DESCRIPTION =
  "Havamania hava verisini anlamlı bilgiye çevirir: güzergâh boyunca hava, seyahat planlayıcı ve kendi dilinizden konuşan bir asistan. Enerji ve havacılık yolda.";
const OLD_ASSISTANT_TEXT =
  "İster tarla ister uçuş — asistan tonunu siz seçersiniz: Samimi, Resmî, Dengeli (önerilen), Kısa ve Net ya da Detaylı Uzman.";
const NEW_ASSISTANT_TEXT =
  "İster şehirde ister yolda, asistanın tonunu siz seçersiniz: Samimi, Resmî, Dengeli (önerilen), Kısa ve Net ya da Detaylı Uzman.";
const OLD_PREMIUM_TEXT = "Standart tahminlerin ötesine geçin — %100 kişiselleştirilmiş bir hava, tarım ve uçuş deneyimi.";
const NEW_PREMIUM_TEXT = "Standart tahminlerin ötesine geçin: size göre kişiselleşen bir hava ve seyahat deneyimi.";
const OLD_PREMIUM_CARD0_TEXT = "Hava, tarla ve uçuş için özelleştirilmiş raporlar.";
const NEW_PREMIUM_CARD0_TEXT = "Hava ve seyahatleriniz için ayrıntılı raporlar.";

/** Metin eski varsayılanla birebir aynıysa yenisini verir; düzenlenmişse dokunmaz. */
const swap = (value: string, from: string, to: string) => (value === from ? to : value);

export function migrateLanding(c: LandingContent): LandingContent {
  const scenes = Object.fromEntries(
    Object.entries(c.scenes).map(([key, s]) => [
      key,
      {
        ...s,
        captions: s.captions.map((cap) => ({ ...cap, eyebrow: Object.hasOwn(OLD_EYEBROWS, cap.eyebrow) ? OLD_EYEBROWS[cap.eyebrow] : cap.eyebrow })),
        chips: s.chips.map((chip) => ({ ...chip, icon: resolveIcon(chip.icon) ?? chip.icon })),
      },
    ]),
  ) as LandingContent["scenes"];

  return {
    ...c,
    seo: {
      ...c.seo,
      title: swap(c.seo.title, OLD_SEO_TITLE, NEW_SEO_TITLE),
      description: swap(c.seo.description, OLD_SEO_DESCRIPTION, NEW_SEO_DESCRIPTION),
    },
    scenes,
    assistant: { ...c.assistant, text: swap(c.assistant.text, OLD_ASSISTANT_TEXT, NEW_ASSISTANT_TEXT) },
    premium: {
      ...c.premium,
      text: swap(c.premium.text, OLD_PREMIUM_TEXT, NEW_PREMIUM_TEXT),
      cards: c.premium.cards.map((card, i) => ({
        ...card,
        icon: resolveIcon(card.icon) ?? card.icon,
        text: i === 0 ? swap(card.text, OLD_PREMIUM_CARD0_TEXT, NEW_PREMIUM_CARD0_TEXT) : card.text,
      })),
    },
  };
}
