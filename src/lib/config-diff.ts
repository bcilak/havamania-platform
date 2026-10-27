/*
 * Asistan ayarlarının (BotConfig) iki hali arasındaki fark. Saf mantık, veritabanı yok.
 *
 * Aynı fonksiyon üç yerde kullanılır: taslak ↔ yayındaki sürüm (yayın sayfası),
 * iki sürümün karşılaştırması ve sürüm ↔ taslak karşılaştırması. Her değişiklik
 * kısa bir özet cümlesi taşır; uzun metinlerde ayrıca satır düzeyinde fark (LCS) bulunur.
 */

import type { EmbeddingRef } from "./ai/embedding-freeze";
import { sameEmbedding } from "./ai/embedding-freeze";
import { MODES, TONES, TOOLS, toneRule, type BotConfig, type ToneId, type ToolId } from "./bot-config";

export type LineOp = { op: "same" | "add" | "del"; text: string };

/** LCS tablosu bu hücre sayısını aşarsa ortadaki kısım topluca silinmiş/eklenmiş sayılır. */
const MAX_LCS_CELLS = 250_000;

/** Satır düzeyinde basit fark (en uzun ortak alt dizi). Ortak baş ve son satırlar önce ayrılır. */
export function lineDiff(before: string, after: string, maxCells = MAX_LCS_CELLS): LineOp[] {
  const a = before === "" ? [] : before.replace(/\r\n/g, "\n").split("\n");
  const b = after === "" ? [] : after.replace(/\r\n/g, "\n").split("\n");
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  const midA = a.slice(head, a.length - tail);
  const midB = b.slice(head, b.length - tail);

  const out: LineOp[] = a.slice(0, head).map((text) => ({ op: "same", text }));
  if ((midA.length + 1) * (midB.length + 1) > maxCells) {
    out.push(...midA.map((text): LineOp => ({ op: "del", text })), ...midB.map((text): LineOp => ({ op: "add", text })));
  } else {
    // lcs[i][j]: midA[i..] ile midB[j..] arasındaki ortak alt dizi uzunluğu.
    const w = midB.length + 1;
    const lcs = new Uint32Array((midA.length + 1) * w);
    for (let i = midA.length - 1; i >= 0; i--) {
      for (let j = midB.length - 1; j >= 0; j--) {
        lcs[i * w + j] = midA[i] === midB[j] ? lcs[(i + 1) * w + j + 1] + 1 : Math.max(lcs[(i + 1) * w + j], lcs[i * w + j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < midA.length && j < midB.length) {
      if (midA[i] === midB[j]) {
        out.push({ op: "same", text: midA[i] });
        i++;
        j++;
      } else if (lcs[(i + 1) * w + j] >= lcs[i * w + j + 1]) {
        out.push({ op: "del", text: midA[i++] });
      } else {
        out.push({ op: "add", text: midB[j++] });
      }
    }
    while (i < midA.length) out.push({ op: "del", text: midA[i++] });
    while (j < midB.length) out.push({ op: "add", text: midB[j++] });
  }
  out.push(...a.slice(a.length - tail).map((text): LineOp => ({ op: "same", text })));
  return out;
}

export type ConfigChange = {
  /** Değişikliğin kapsamı: mod adı ya da "Genel". */
  scope: string;
  /** Tek cümlelik özet (liste görünümü). */
  summary: string;
  /** Metin alanlarında satır düzeyinde fark. */
  lines?: LineOp[];
};

const FIRST_PUBLISH = "İlk yayın";

const SCALARS: { key: "historyWindow" | "maxMessagesPerDay" | "photosEnabled" | "maxPhotoMb" | "retrievalTopK" | "retrievalMinSimilarity"; label: string }[] = [
  { key: "historyWindow", label: "Modele giden son mesaj sayısı" },
  { key: "maxMessagesPerDay", label: "Günlük mesaj sınırı" },
  { key: "photosEnabled", label: "Fotoğraf yükleme" },
  { key: "maxPhotoMb", label: "Azami fotoğraf boyutu (MB)" },
  { key: "retrievalTopK", label: "Bilgi tabanından alınan parça sayısı" },
  { key: "retrievalMinSimilarity", label: "İlgililik eşiği" },
];

const show = (v: unknown): string => (typeof v === "boolean" ? (v ? "açık" : "kapalı") : String(v));
const same = (x: unknown, y: unknown) => JSON.stringify(x) === JSON.stringify(y);
const examplesText = (e: BotConfig["modes"]["genel"]["examples"]) => e.map((x) => `Kullanıcı: ${x.user}\nAsistan: ${x.assistant}`).join("\n---\n");
const toolLabel = (t: string) => TOOLS[t as ToolId]?.label ?? t;

/**
 * `before` null ise ilk yayındır. Sonuç sırası: modlar, ortak kurallar, yasak konular,
 * ton metinleri, sayısal ayarlar.
 */
export function diffConfigs(before: BotConfig | null, after: BotConfig): ConfigChange[] {
  if (!before) return [{ scope: "Genel", summary: FIRST_PUBLISH }];
  const out: ConfigChange[] = [];
  const add = (scope: string, summary: string, from?: string, to?: string) =>
    out.push({ scope, summary: scope === "Genel" ? summary : `${scope}: ${summary}`, ...(from !== undefined && to !== undefined ? { lines: lineDiff(from, to) } : {}) });

  for (const m of MODES) {
    const x = before.modes[m];
    const y = after.modes[m];
    const s = y.label;
    if (x.enabled !== y.enabled) add(s, y.enabled ? "açıldı" : "kapatıldı");
    if (x.label !== y.label) add(s, `ad ${x.label} → ${y.label}`);
    if (x.instructions !== y.instructions) add(s, "talimat değişti", x.instructions, y.instructions);
    if (x.tone !== y.tone) add(s, `üslup ${TONES[x.tone]?.label} → ${TONES[y.tone]?.label}`);
    if (x.model !== y.model) add(s, `model ${x.model ?? "yok"} → ${y.model ?? "yok"}`);
    else if (x.providerId !== y.providerId) add(s, `sağlayıcı değişti (model: ${y.model ?? "yok"})`);
    if (x.temperature !== y.temperature) add(s, `temperature ${x.temperature} → ${y.temperature}`);
    if (x.maxOutputTokens !== y.maxOutputTokens) add(s, `en uzun cevap ${x.maxOutputTokens ?? "sınır yok"} → ${y.maxOutputTokens ?? "sınır yok"}${y.maxOutputTokens === undefined ? "" : " token"}`);
    if (!same(x.examples, y.examples)) add(s, `örnek konuşmalar değişti (${x.examples.length} → ${y.examples.length})`, examplesText(x.examples), examplesText(y.examples));
    const addedTools = y.tools.filter((t) => !x.tools.includes(t));
    const removedTools = x.tools.filter((t) => !y.tools.includes(t));
    if (addedTools.length || removedTools.length) {
      const parts = [addedTools.length ? `eklenen: ${addedTools.map(toolLabel).join(", ")}` : "", removedTools.length ? `çıkan: ${removedTools.map(toolLabel).join(", ")}` : ""];
      add(s, `araçlar değişti (${parts.filter(Boolean).join("; ")})`);
    }
    if (x.greeting !== y.greeting) add(s, "karşılama metni değişti", x.greeting, y.greeting);
    if (!same(x.suggestions, y.suggestions)) add(s, "öneri soruları değişti", x.suggestions.join("\n"), y.suggestions.join("\n"));
  }

  if (before.guardrails !== after.guardrails) add("Genel", "Ortak kurallar değişti", before.guardrails, after.guardrails);
  if (before.fallbackMessage !== after.fallbackMessage) add("Genel", "Hata mesajı değişti", before.fallbackMessage, after.fallbackMessage);
  if (!same(before.blockedTopics, after.blockedTopics)) {
    add("Genel", `Yasak konular değişti (${before.blockedTopics.length} → ${after.blockedTopics.length})`, before.blockedTopics.join("\n"), after.blockedTopics.join("\n"));
  }
  for (const t of Object.keys(TONES) as ToneId[]) {
    const x = toneRule(before.toneOverrides, t);
    const y = toneRule(after.toneOverrides, t);
    if (x !== y) add("Genel", `Ton metni değişti: ${TONES[t].label}`, x, y);
  }
  if (!same(before.domainStopwords, after.domainStopwords)) {
    add("Genel", `Aramada yok sayılan kelimeler değişti (${before.domainStopwords.length} → ${after.domainStopwords.length})`, before.domainStopwords.join("\n"), after.domainStopwords.join("\n"));
  }
  for (const { key, label } of SCALARS) {
    if (before[key] !== after[key]) add("Genel", `${label}: ${show(before[key])} → ${show(after[key])}`);
  }
  return out;
}

/** Liste görünümü için yalnızca özet cümleleri. */
export const summarizeChanges = (changes: ConfigChange[]): string[] => changes.map((c) => c.summary);

export type EmbeddingDiff = {
  /** unknown: iki taraftan birinin yayın anı kaydı yok, karşılaştırılamaz. */
  status: "same" | "changed" | "unknown";
  text: string;
};

/** Dondurulmuş embedding ayarlarının farkı. `label` sağlayıcı/model adını yazıya çevirir. */
export function diffEmbeddings(before: EmbeddingRef | null, after: EmbeddingRef | null, label: (e: EmbeddingRef) => string): EmbeddingDiff {
  if (!before || !after) {
    return { status: "unknown", text: "Karşılaştırılamadı: sürümlerden birinde yayın anı embedding kaydı yok (eski sürümler güncel ayarla çalışır)." };
  }
  if (sameEmbedding(before, after)) return { status: "same", text: `Aynı: ${label(after)}` };
  return { status: "changed", text: `${label(before)} → ${label(after)}` };
}
