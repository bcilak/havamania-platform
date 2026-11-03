import type { LandingContent } from "./schema";

/**
 * Site içeriğini bilgi tabanına aktarılabilecek düz metne çevirir.
 * Örnek güzergâh rakamları (şehir sıcaklıkları) aktarılmaz: asistan bunları gerçek veri sanmasın.
 * `earlyAccess`: erken erişim formu sitede yayındaysa true. Form yokken asistan olmayan bir
 * formdan söz etmesin diye varsayılan false.
 */
export function landingToText(c: LandingContent, opts: { earlyAccess?: boolean } = {}): string {
  const lines: string[] = [];
  lines.push(`# ${c.hero.title}`, c.hero.subtitle, "");

  lines.push("## Havamania Panel");
  const core = c.scenes.core;
  for (const cap of core.captions) lines.push(`${cap.eyebrow}: ${cap.title} ${cap.sub}`);
  lines.push(`Gösterilen veriler: ${core.chips.map((ch) => `${ch.label} (${ch.value} ${ch.unit})`).join(", ")}.`);
  for (const card of core.screen2.cards) lines.push(`${card.title}: ${card.text}`);
  lines.push("");

  const r = c.route;
  lines.push(`## Seyahat: ${r.eyebrow}`, `${r.title} ${r.text}`);
  for (const b of r.bullets) lines.push(`- ${b}`);
  lines.push("");

  lines.push(`## Uygulamadaki özellikler (Faz 1, yayında)`, `${c.features.title} ${c.features.text}`);
  for (const it of c.features.items) lines.push(`- ${it.title}: ${it.text}`);
  lines.push(`${c.agroCard.title}: ${c.agroCard.text}`, "");

  const en = c.energy;
  lines.push("## Havamania Energy (Faz 2, yakında; henüz kullanıma açık değil)", `${en.title}. ${en.text}`);
  for (const card of [en.solar, en.wind]) {
    lines.push(`${card.title}: ${card.text}`);
    lines.push(`Analiz edilen veriler: ${card.data.join(", ")}.`);
    lines.push(`Kullanım alanları: ${card.uses.join(", ")}.`);
    lines.push(`Neye yardımcı olur: ${card.benefits.join(", ")}.`);
  }
  lines.push("");

  const av = c.aviation;
  lines.push("## Havamania Fly (Faz 3, planlanıyor; henüz kullanıma açık değil, havacılık kararlarında kullanılmaz)", `${av.title}. ${av.text}`);
  lines.push("Planlanan analizler:");
  for (const a of av.analyses) lines.push(`- ${a.title}: ${a.text}`);
  lines.push(`Kullanım alanları: ${av.uses.join(", ")}.`, av.note, "");

  lines.push(`## ${c.roadmap.eyebrow}`, `${c.roadmap.title} ${c.roadmap.text}`);
  for (const p of c.roadmap.phases) lines.push(`- ${p.label} · ${p.name} (${p.stateLabel}): ${p.text}`);
  lines.push("");
  if (opts.earlyAccess) lines.push("Erken erişim: sitedeki #erken-erisim formuyla başvurulur.", "");

  lines.push(`## ${c.assistant.title}`, c.assistant.text, "");
  lines.push(`## Premium: ${c.premium.title}`, c.premium.text);
  for (const card of c.premium.cards) lines.push(`- ${card.title}: ${card.text}`);
  lines.push("", c.footer.tagline);
  return lines.join("\n");
}
