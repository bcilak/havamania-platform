import { db } from "@/db";
import { kbEmbeddingUsage } from "@/db/schema";

/**
 * Vektörleme harcamasını olay anıyla kaydeder (panodaki "vektörleme" maliyeti buradan toplanır).
 * Kayıt hatası asıl işi bozmaz: yalnızca günlüğe yazılır. Token yoksa satır eklenmez.
 */
export async function recordEmbeddingUsage(opts: {
  botId: string;
  sourceId?: string | null;
  kind: "ingest" | "gap_semantic";
  tokens: number;
  costUsd: number;
}): Promise<void> {
  if (!(opts.tokens > 0)) return;
  try {
    await db.insert(kbEmbeddingUsage).values({ botId: opts.botId, sourceId: opts.sourceId ?? null, kind: opts.kind, tokens: Math.round(opts.tokens), costUsd: opts.costUsd });
  } catch (e) {
    console.error("[embedding-usage] maliyet kaydı yazılamadı:", e);
  }
}
