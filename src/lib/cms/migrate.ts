import { resolveIcon } from "./icons";
import type { LandingContent } from "./schema";

/*
 * Kayıtlı landing içeriğini güncel biçime getirir. Okuma sırasında uygulanır, böylece
 * sunucuda ayrıca bir veri taşıma adımı gerekmez. Yalnızca eski VARSAYILAN metinler
 * değiştirilir; panelde düzenlenmiş bir metin olduğu gibi kalır. Editör bir sonraki
 * kayıtta dönüşmüş hâli saklar.
 */

const OLD_PHASE2 = {
  badge: "Faz 2 · Yolda",
  title: "Aynı zekâ, iki yeni dünya.",
  text: "Havamania'nın motoru şimdi tarlanın ve gökyüzünün diline çevriliyor: Agro Modu ve Fly Modu. Aynı patla-topla, yeni veriler.",
};
const NEW_PHASE2 = {
  badge: "Üç mod · Tek uygulama",
  title: "Aynı zekâ, üç dünya.",
  text: "Havamania'nın motoru şehirde, tarlada ve gökyüzünde aynı dili konuşur: Hava, Agro ve Fly modları. Aynı patla-topla, her moda özel veriler.",
};
const OLD_EYEBROWS: Record<string, string> = {
  "Faz 2 · Agro Modu": "Agro Modu",
  "Faz 2 · Fly Modu": "Fly Modu",
};

export function migrateLanding(c: LandingContent): LandingContent {
  const scenes = Object.fromEntries(
    Object.entries(c.scenes).map(([key, s]) => [
      key,
      {
        ...s,
        captions: s.captions.map((cap) => ({ ...cap, eyebrow: OLD_EYEBROWS[cap.eyebrow] ?? cap.eyebrow })),
        chips: s.chips.map((chip) => ({ ...chip, icon: resolveIcon(chip.icon) ?? chip.icon })),
      },
    ]),
  ) as LandingContent["scenes"];

  const phase2 = { ...c.phase2 };
  for (const k of ["badge", "title", "text"] as const) if (phase2[k] === OLD_PHASE2[k]) phase2[k] = NEW_PHASE2[k];

  return {
    ...c,
    scenes,
    phase2,
    premium: { ...c.premium, cards: c.premium.cards.map((card) => ({ ...card, icon: resolveIcon(card.icon) ?? card.icon })) },
  };
}
