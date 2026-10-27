/*
 * Kaynak işlemenin saf parçaları: veritabanı ve ağ içermez, birim testle
 * doğrulanır. Çıkarma, embedding çağrısı ve yazma ingest.ts'tedir.
 */

export const MAX_CHARS = 400_000;

/** İşleme alınabilen durumlar; `processing` olan satırı başka bir işleyici tutuyordur. */
export const CLAIMABLE_STATUSES = ["pending", "ready", "failed"] as const;

/** Bu süredir güncellenmeyen `processing` satırı takılı sayılır (sunucu yarıda kesildi) ve yeniden alınabilir. */
export const STALE_PROCESSING_MS = 15 * 60 * 1000;

/**
 * Kaynağı işleme almak mümkün mü? ingest.ts'teki atomik `update … where` koşuluyla
 * aynı kuraldır; ikinci eşzamanlı çağrı `processing` satırı görür ve çıkar.
 */
export function canClaim(status: string, updatedAt: Date, now: Date = new Date()): boolean {
  if ((CLAIMABLE_STATUSES as readonly string[]).includes(status)) return true;
  return status === "processing" && now.getTime() - updatedAt.getTime() > STALE_PROCESSING_MS;
}

export type IngestPlan = {
  text: string;
  pieces: string[];
  /** Parça başına vektör; embedding kapalıysa ya da başarısızsa null. */
  vectors: number[][] | null;
  /** Panelde gösterilen uyarı; kaynak yine de kullanılabilir. */
  warning: string | null;
};

export function joinWarnings(parts: (string | null | undefined)[]): string | null {
  const out = parts.filter((p): p is string => Boolean(p));
  return out.length ? out.join(" ").slice(0, 500) : null;
}

/**
 * Metni sınırlar, parçalar ve (verildiyse) vektörler. Embedding hatası kaynağı
 * düşürmez: parçalar vektörsüz kalır, kaynak tam metin aramasıyla bulunur ve
 * uyarı yazılır.
 */
export async function planIngest(opts: {
  rawText: string;
  chunk: (text: string) => string[];
  /** null = embedding yapılandırılmamış. */
  embed: ((values: string[]) => Promise<number[][]>) | null;
  /** Çıkarma aşamasından gelen uyarılar (seçilen kodlama, taranmış PDF şüphesi vb.). */
  notes?: (string | null | undefined)[];
}): Promise<IngestPlan> {
  const truncated = opts.rawText.length > MAX_CHARS;
  const text = opts.rawText.slice(0, MAX_CHARS);
  const pieces = opts.chunk(text);
  if (!pieces.length) throw new Error("Kaynaktan metin çıkarılamadı.");

  const warnings: (string | null | undefined)[] = [...(opts.notes ?? []), truncated ? "Metnin ilk 400.000 karakteri alındı." : null];
  let vectors: number[][] | null = null;
  if (opts.embed) {
    try {
      const out = await opts.embed(pieces);
      if (out.length !== pieces.length) throw new Error("Vektör sayısı parça sayısıyla uyuşmuyor.");
      vectors = out;
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      warnings.push(`Vektörleme başarısız, yalnızca kelime aramasıyla bulunur: ${reason.slice(0, 200)}`);
    }
  }
  return { text, pieces, vectors, warning: joinWarnings(warnings) };
}
