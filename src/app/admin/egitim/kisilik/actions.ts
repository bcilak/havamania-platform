"use server";

import { revalidatePath } from "next/cache";
import type { ChatMode } from "@/db/schema";
import { audit } from "@/lib/audit";
import { requireAdmin } from "@/lib/auth";
import { getMainBot, updateDraftConfig } from "@/lib/bot";
import { DEFAULT_MAX_OUTPUT, MODES, PERSONA_LIMITS, TONES, TOOLS, type ToneId, type ToolId } from "@/lib/bot-config";
import { bool, done, fail, num, str, strStrict } from "@/lib/form";
import { buildToneOverrides, pairExamples, parseBlockedTopics } from "@/lib/persona-input";

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
  const tools = (fd.getAll("tools") as string[]).filter((t): t is ToolId => Object.hasOwn(TOOLS, t));
  const suggestions = str(fd, "suggestions", 1000)
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 4);

  // Örnek konuşmalar: exUser1..N / exAssistant1..N alanları (her biri strStrict ile sınırlı).
  const rows = Array.from({ length: PERSONA_LIMITS.examples.count }, (_, i) => ({
    user: strStrict(fd, `exUser${i + 1}`, PERSONA_LIMITS.examples.chars, `Örnek ${i + 1} kullanıcı metni`, back),
    assistant: strStrict(fd, `exAssistant${i + 1}`, PERSONA_LIMITS.examples.chars, `Örnek ${i + 1} asistan metni`, back),
  }));
  const examples = pairExamples(rows);
  if (examples.value === null) fail(back, examples.error);

  // Okuma ve yazma tek kilitli transaction'da: eşzamanlı iki kayıt birbirini ezmez.
  await updateDraftConfig(bot.id, (config) => {
    config.modes[mode] = {
      ...config.modes[mode],
      enabled: bool(fd, "enabled"),
      label: str(fd, "label", 60) || config.modes[mode].label,
      greeting: str(fd, "greeting", 300),
      suggestions,
      instructions,
      tone: Object.hasOwn(TONES, tone) ? tone : "dengeli",
      providerId: providerId || null,
      model: model || null,
      temperature: num(fd, "temperature", 0.4, 0, 1),
      maxOutputTokens: num(fd, "maxOutputTokens", config.modes[mode].maxOutputTokens ?? DEFAULT_MAX_OUTPUT[mode], PERSONA_LIMITS.maxOutputTokens.min, PERSONA_LIMITS.maxOutputTokens.max),
      examples: examples.value,
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
  const blocked = parseBlockedTopics(strStrict(fd, "blockedTopics", 2000, "Yasak konular", back));
  if (blocked.value === null) fail(back, blocked.error);
  const toneFields = Object.fromEntries(
    (Object.keys(TONES) as ToneId[]).map((t) => [
      t,
      { text: strStrict(fd, `tone_${t}`, PERSONA_LIMITS.toneRule, `${TONES[t].label} ton metni`, back), reset: bool(fd, `toneReset_${t}`) },
    ]),
  );
  const tones = buildToneOverrides(toneFields);
  if (tones.value === null) fail(back, tones.error);
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
    config.blockedTopics = blocked.value;
    config.toneOverrides = tones.value;
  });
  await audit(admin, "bot.config", "kurallar");
  revalidatePath(BACK);
  done(back, "Taslağa kaydedildi.");
}
