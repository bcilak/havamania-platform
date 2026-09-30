import type { ChatMode } from "@/db/schema";
import { TONES, TOOLS, type BotConfig } from "@/lib/bot-config";
import type { KnowledgeHit } from "./retrieval";
import type { UserLocation } from "./tools";

export function buildInstructions(opts: {
  config: BotConfig;
  mode: ChatMode;
  hits: KnowledgeHit[];
  location: UserLocation;
  toolsAvailable: boolean;
}): string {
  const { config, mode, hits, location, toolsAvailable } = opts;
  const m = config.modes[mode];
  const now = new Date();
  const date = new Intl.DateTimeFormat("tr-TR", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: "Europe/Istanbul",
  }).format(now);

  const parts: string[] = [];
  parts.push(m.instructions.trim());
  parts.push(`## Üslup\n${TONES[m.tone]?.rule ?? TONES.dengeli.rule}`);
  parts.push(`## Genel kurallar\n${config.guardrails.trim()}`);

  const where = location
    ? `${location.name ? `${location.name} ` : ""}(enlem ${location.lat.toFixed(3)}, boylam ${location.lon.toFixed(3)})`
    : "bilinmiyor; gerekiyorsa kullanıcıya sor";
  parts.push(`## Bağlam\nŞu an: ${date} (Türkiye saati).\nKullanıcının konumu: ${where}.`);

  if (hits.length) {
    const kb = hits.map((h, i) => `[${i + 1}] ${h.title}\n${h.content}`).join("\n\n");
    parts.push(
      `## Bilgi tabanından ilgili içerik\nAşağıdaki içerik kullanıcının sorusuyla ilgili olabilir. Cevabını bunlara dayandır. İçerikte olmayan bir bilgiyi oradan geliyormuş gibi sunma. "Soru/Cevap" biçimindeki kayıtlar ekibimizin onayladığı cevaplardır, önceliklidir.\n\n${kb}`,
    );
  } else {
    parts.push("## Bilgi tabanı\nBu soruyla ilgili kayıtlı içerik bulunamadı. Genel bilgine dayanabilirsin ama emin olmadığın konuda bunu belirt.");
  }

  if (toolsAvailable && m.tools.length) {
    const list = m.tools.map((t) => `- ${TOOLS[t].label}`).join("\n");
    parts.push(
      `## Araçlar\nGüncel veri gerektiğinde şu araçları kullan:\n${list}\nAraç bir hata döndürürse bunu kullanıcıya dürüstçe söyle ve değer uydurma.`,
    );
  }

  if (mode === "fly") {
    parts.push("Arayüz her cevabın altına resmî kaynak uyarısını zaten ekliyor. Yine de kesin 'uçulabilir/uçulamaz' kararı verme.");
  }
  return parts.join("\n\n");
}
