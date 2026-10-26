"use server";

import { revalidatePath } from "next/cache";
import type { ChatMode } from "@/db/schema";
import { audit } from "@/lib/audit";
import { requireAdmin } from "@/lib/auth";
import { getMainBot, updateDraftConfig } from "@/lib/bot";
import { MODES, TONES, TOOLS, type ToneId, type ToolId } from "@/lib/bot-config";
import { bool, done, fail, num, str, strStrict } from "@/lib/form";

const BACK = "/admin/egitim/kisilik";

export async function saveMode(fd: FormData) {
  const admin = await requireAdmin("training");
  const bot = await getMainBot();
  const mode = str(fd, "modeId") as ChatMode;
  if (!MODES.includes(mode)) fail(BACK, "Geçersiz mod.");
  const back = `${BACK}?mod=${mode}`;

  const instructions = strStrict(fd, "instructions", 12000, "Talimat", back);
  if (instructions.length < 20) fail(back, "Talimat metni çok kısa.");
  const tone = str(fd, "tone") as ToneId;
  const [providerId, model] = str(fd, "model").split("::");
  const tools = (fd.getAll("tools") as string[]).filter((t): t is ToolId => t in TOOLS);
  const suggestions = str(fd, "suggestions", 1000)
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 4);

  // Okuma ve yazma tek kilitli transaction'da: eşzamanlı iki kayıt birbirini ezmez.
  await updateDraftConfig(bot.id, (config) => {
    config.modes[mode] = {
      ...config.modes[mode],
      enabled: bool(fd, "enabled"),
      label: str(fd, "label", 60) || config.modes[mode].label,
      greeting: str(fd, "greeting", 300),
      suggestions,
      instructions,
      tone: tone in TONES ? tone : "dengeli",
      providerId: providerId || null,
      model: model || null,
      temperature: num(fd, "temperature", 0.4, 0, 1),
      tools,
    };
    if (!MODES.some((m) => config.modes[m].enabled)) fail(back, "En az bir mod açık kalmalı.");
  });
  await audit(admin, "bot.config", mode);
  revalidatePath(BACK);
  done(back, "Taslağa kaydedildi. Test alanında deneyip Yayın sayfasından yayınlayabilirsiniz.");
}

export async function saveRules(fd: FormData) {
  const admin = await requireAdmin("training");
  const bot = await getMainBot();
  const back = `${BACK}?mod=kurallar`;
  const guardrails = strStrict(fd, "guardrails", 6000, "Kurallar", back);
  const stopwords = [
    ...new Set(
      str(fd, "domainStopwords", 1000)
        .split(/[\n,]+/)
        .map((w) => w.trim().toLocaleLowerCase("tr-TR"))
        .filter(Boolean),
    ),
  ].slice(0, 50);
  await updateDraftConfig(bot.id, (config) => {
    config.guardrails = guardrails;
    config.fallbackMessage = str(fd, "fallbackMessage", 300) || config.fallbackMessage;
    config.historyWindow = num(fd, "historyWindow", 12, 2, 40);
    config.maxMessagesPerDay = num(fd, "maxMessagesPerDay", 60, 0, 10000);
    config.photosEnabled = bool(fd, "photosEnabled");
    config.maxPhotoMb = num(fd, "maxPhotoMb", 8, 1, 20);
    config.retrievalTopK = num(fd, "retrievalTopK", 6, 1, 15);
    config.retrievalMinSimilarity = num(fd, "retrievalMinSimilarity", 0.3, 0, 1);
    config.domainStopwords = stopwords;
  });
  await audit(admin, "bot.config", "kurallar");
  revalidatePath(BACK);
  done(back, "Taslağa kaydedildi.");
}
