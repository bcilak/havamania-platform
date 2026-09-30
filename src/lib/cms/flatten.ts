import type { LandingContent } from "./schema";

/** Site içeriğini bilgi tabanına aktarılabilecek düz metne çevirir. */
export function landingToText(c: LandingContent): string {
  const lines: string[] = [];
  lines.push(`# ${c.hero.title}`, c.hero.subtitle, "");
  for (const [key, s] of Object.entries(c.scenes)) {
    const name = key === "core" ? "Havamania Panel" : key === "agro" ? "Agro Modu" : "Fly Modu";
    lines.push(`## ${name}`);
    for (const cap of s.captions) lines.push(`${cap.eyebrow}: ${cap.title} ${cap.sub}`);
    lines.push(`Gösterilen veriler: ${s.chips.map((ch) => `${ch.label} (${ch.value} ${ch.unit})`).join(", ")}.`);
    for (const card of s.screen2.cards) lines.push(`${card.title}: ${card.text}`);
    lines.push("");
  }
  lines.push(`## ${c.phase2.title}`, c.phase2.text, "", `## ${c.assistant.title}`, c.assistant.text, "");
  lines.push(`## Premium: ${c.premium.title}`, c.premium.text);
  for (const card of c.premium.cards) lines.push(`- ${card.title}: ${card.text}`);
  lines.push("", c.footer.tagline);
  return lines.join("\n");
}
