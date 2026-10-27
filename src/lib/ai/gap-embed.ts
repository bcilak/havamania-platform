import { embedMany } from "ai";
import { embeddingCostOf } from "./embedding-cost";
import { resolveEmbedding } from "./providers";

/** Boşluk analizinde bir sayfa açılışında en fazla bu kadar metin vektörlenir (maliyet sınırı). */
export const GAP_EMBED_MAX = 300;
const TEXT_MAX = 300;

/**
 * Boşluk gruplarının liderlerini anlamsal birleştirme için vektörler. Sonuç yalnızca çağıranın belleğinde yaşar:
 * kalıcı tutulmaz (kullanıcı sorusundan türeyen veri; KVKK). Embedding kapalıysa ya da çağrı başarısızsa null döner
 * ve sayfa sözcüksel gruplamayla devam eder. `texts` GAP_EMBED_MAX'tan uzunsa fazlası için null verilir.
 */
export async function embedGapTexts(texts: string[]): Promise<{ vectors: (number[] | null)[]; model: string; tokens: number; costUsd: number } | null> {
  const emb = await resolveEmbedding().catch(() => null);
  if (!emb || !texts.length) return null;
  const head = texts.slice(0, GAP_EMBED_MAX).map((t) => t.slice(0, TEXT_MAX));
  try {
    const { embeddings, usage } = await embedMany({ model: emb.model, values: head });
    const tokens = usage?.tokens ?? 0;
    return { vectors: texts.map((_, i) => embeddings[i] ?? null), model: emb.id, tokens, costUsd: embeddingCostOf(tokens, emb.pricePer1M) };
  } catch (e) {
    console.error("[gaps] embedding başarısız, sözcüksel gruplamayla devam:", e);
    return null;
  }
}
