import { iconSvg, resolveIcon } from "./icons";

/* Landing işaretlemesinin ortak yardımcıları (render.ts ve render-sections.ts kullanır). */

/** CMS metinlerini HTML'e kaçışlar. İşaretlemeye giren her kullanıcı metni buradan geçer; string olmayan değer çökertmez. */
export const e = (s: unknown) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

export const INK_MUTED = "#5c5c61";

/** Simge adıysa SVG, tanınmayan eski bir değerse (emoji) olduğu gibi metin. */
export const icon = (value: string) => {
  const name = resolveIcon(value);
  return name ? iconSvg(name) : e(value);
};
