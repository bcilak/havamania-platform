import type { ChatMode } from "@/db/schema";
import { MODES } from "@/lib/bot-config";
import type { UserLocation } from "./location";
import { parseLocation } from "./location";
import type { KnowledgeHit, RankedKnowledgeHit } from "./retrieval";
import { parseTarget, type TurnTarget } from "./turn-core";

/*
 * Prompt önizleme ucunun saf parçaları: girdi doğrulama, çıktı boyutu sınırı ve
 * aynı-site (CSRF) kontrolü. Veritabanı ve ağ içermez, birim testle doğrulanır.
 */

export const PREVIEW_LIMITS = {
  /** İstek gövdesi üst sınırı (bayt). Soru ≤ 4000 karakter + konum + hedef bunun çok altında kalır. */
  maxBodyBytes: 16_000,
  maxText: 4000,
  /** Yanıttaki `instructions` en çok bu kadar karakter; fazlası kesilir ve `instructionsTruncated` true olur. */
  maxInstructionsChars: 60_000,
  maxHits: 20,
  /** Yanıttaki her parçanın metni; kesilirse `contentTruncated` true. */
  maxHitChars: 1500,
} as const;

export type PreviewRequest = { mode: ChatMode; text: string; target: TurnTarget; location: UserLocation };

export function parsePreviewRequest(body: unknown): { ok: true; value: PreviewRequest } | { ok: false; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "Geçersiz istek." };
  const b = body as Record<string, unknown>;
  if (typeof b.mode !== "string" || !MODES.includes(b.mode as ChatMode)) return { ok: false, error: "Geçersiz mod." };
  if (typeof b.text !== "string" || !b.text.trim()) return { ok: false, error: "Örnek soru boş olamaz." };
  const text = b.text.trim();
  if (text.length > PREVIEW_LIMITS.maxText) return { ok: false, error: `Örnek soru en fazla ${PREVIEW_LIMITS.maxText} karakter olabilir.` };
  const target = parseTarget(b.target);
  if (!target) return { ok: false, error: "Geçersiz hedef." };
  return { ok: true, value: { mode: b.mode as ChatMode, text, target, location: parseLocation(b.location) } };
}

/** Yaklaşık token: ~4 karakter/token (dil modeli sayacı değildir, tahmindir). */
export const approxTokens = (chars: number): number => Math.ceil(chars / 4);

export function clip(text: string, max: number): { text: string; truncated: boolean } {
  return text.length > max ? { text: text.slice(0, max), truncated: true } : { text, truncated: false };
}

/** Eşik üstü, tekilleştirmede elenmemiş ilk `topK` parça bağlama girer; geri kalanı (eşik altı ya da sıra dışı) yalnızca önizlemede görünür. */
export function splitContext(
  ranked: RankedKnowledgeHit[],
  topK: number,
): { context: KnowledgeHit[]; candidates: (RankedKnowledgeHit & { inContext: boolean })[] } {
  let used = 0;
  const candidates = ranked.map((h) => {
    const inContext = h.relevant && !h.dedup && used < topK;
    if (inContext) used++;
    return { ...h, inContext };
  });
  const context = candidates
    .filter((h) => h.inContext)
    .map(
      (h, i): KnowledgeHit => ({
        chunkId: h.chunkId,
        sourceId: h.sourceId,
        title: h.title,
        type: h.type,
        content: h.content,
        score: h.score,
        similarity: h.similarity,
        lexical: h.lexical,
        rank: i + 1,
      }),
    );
  return { context, candidates };
}

export type PreviewHit = {
  chunkId: string;
  sourceId: string;
  title: string;
  type: string;
  similarity: number | null;
  lexical: boolean;
  /** Eşiği geçti (kosinüs ya da kelime eşleşmesi). */
  relevant: boolean;
  /** Gerçekten prompt'a girdi (ilgili, elenmemiş ve ilk K içinde). */
  inContext: boolean;
  /** İlgili ama tekilleştirmede elendi: "duplicate" (tekrar), "cap" (kaynak başına sınır), "merged" (komşuyla birleşti). */
  dedup: string | null;
  content: string;
  contentTruncated: boolean;
};

export type PreviewResponse = {
  instructions: string;
  instructionsTruncated: boolean;
  hits: PreviewHit[];
  toolsAvailable: boolean;
  tools: string[];
  model: string | null;
  approxInputTokens: number;
  /** Hedefin açıklaması: "Taslak" ya da "v3". */
  targetLabel: string;
  notes: string[];
};

/** Yanıtı boyut sınırlarına uydurur. Token tahmini kesilmemiş metin üzerinden yapılır. */
export function shapePreview(opts: {
  instructions: string;
  candidates: (RankedKnowledgeHit & { inContext: boolean })[];
  toolsAvailable: boolean;
  tools: string[];
  model: string | null;
  targetLabel: string;
  notes: string[];
}): PreviewResponse {
  const ins = clip(opts.instructions, PREVIEW_LIMITS.maxInstructionsChars);
  const hits = opts.candidates.slice(0, PREVIEW_LIMITS.maxHits).map((h): PreviewHit => {
    const c = clip(h.content, PREVIEW_LIMITS.maxHitChars);
    return {
      chunkId: h.chunkId,
      sourceId: h.sourceId,
      title: h.title,
      type: h.type,
      similarity: h.similarity === null ? null : Math.round(h.similarity * 1000) / 1000,
      lexical: h.lexical,
      relevant: h.relevant,
      inContext: h.inContext,
      dedup: h.dedup ?? null,
      content: c.text,
      contentTruncated: c.truncated,
    };
  });
  return {
    instructions: ins.text,
    instructionsTruncated: ins.truncated,
    hits,
    toolsAvailable: opts.toolsAvailable,
    tools: opts.tools,
    model: opts.model,
    approxInputTokens: approxTokens(opts.instructions.length),
    targetLabel: opts.targetLabel,
    notes: opts.notes,
  };
}

/**
 * Aynı-site kontrolü (CSRF): tarayıcı POST'unda `Origin` daima gelir. Next server action'ları
 * gibi Origin'in host'u `X-Forwarded-Host` (yoksa `Host`) ile eşleşmelidir. Origin yoksa ya da
 * "null" ise reddedilir (kapalı varsayılan).
 */
export function isSameOrigin(h: { origin: string | null; host: string | null; forwardedHost: string | null }): boolean {
  if (!h.origin) return false;
  let originHost: string;
  try {
    originHost = new URL(h.origin).host.toLowerCase();
  } catch {
    return false;
  }
  const expected = (h.forwardedHost?.split(",")[0]?.trim() || h.host || "").toLowerCase();
  return expected !== "" && originHost === expected;
}

export const isJsonContentType = (ct: string | null): boolean => /^application\/json\s*(;|$)/i.test(ct ?? "");

/**
 * İstek gövdesini akış olarak okur; `maxBytes` aşılınca okumayı bırakıp `null` döner
 * (çağıran 413 verir). Content-Length yalan söylese ya da hiç olmasa da bellek sınırlıdır.
 * Gövde yoksa boş metin döner.
 */
export async function readBodyLimited(body: ReadableStream<Uint8Array> | null, maxBytes: number): Promise<string | null> {
  if (!body) return "";
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  }
  const all = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.byteLength;
  }
  return new TextDecoder().decode(all);
}
