/*
 * Embedding maliyetinin saf parçaları (veritabanı yok, birim testle doğrulanır).
 * Fiyat sağlayıcı kaydında model başına tutulur: providers.embedding_prices = { "<model>": <1M token için USD> }.
 */

/** Makul fiyat üst sınırı (USD / 1M token): yanlış girilmiş fiyat (ör. 20 yerine 20000) maliyeti şişirmesin. */
export const MAX_EMBEDDING_PRICE_PER_1M = 1000;

/** Embedding modelinin 1M token fiyatı (USD); girilmemiş ya da geçersizse 0. */
export function embeddingPrice(prices: Record<string, number> | null | undefined, model: string): number {
  const p = prices?.[model];
  return typeof p === "number" && Number.isFinite(p) && p > 0 ? p : 0;
}

/** Embedding maliyeti (USD): token × fiyat / 1M. */
export function embeddingCostOf(tokens: number, pricePer1M: number): number {
  return (Math.max(0, tokens) / 1_000_000) * Math.max(0, pricePer1M);
}

/**
 * Sağlayıcı formundaki embedding model satırları: "<model>" ya da "<model> <fiyat>" (1M token için USD, virgül de olur).
 * Satır ya da virgülle ayrılır. Fiyatsız model 0 sayılır (kayıt yazılmaz); üst sınırı aşan fiyat `tooHigh`ta döner ve kaydedilmez.
 */
export function parseEmbeddingLines(raw: string): { models: string[]; prices: Record<string, number>; tooHigh: string[] } {
  const models: string[] = [];
  const prices: Record<string, number> = {};
  const tooHigh: string[] = [];
  for (const line of raw.split(/\n|,(?=\s*[^\d\s])/)) {
    const [id, price] = line.trim().split(/\s+/);
    if (!id || models.includes(id)) continue;
    models.push(id);
    const n = Number((price ?? "").replace(",", "."));
    if (price && Number.isFinite(n) && n > MAX_EMBEDDING_PRICE_PER_1M) tooHigh.push(id);
    else if (price && Number.isFinite(n) && n > 0) prices[id] = n;
  }
  return { models, prices, tooHigh };
}

/** `parseEmbeddingLines` girdisinin ters yönü: forma yazılacak metin. */
export function formatEmbeddingLines(models: string[], prices: Record<string, number> | null | undefined): string {
  return models.map((m) => (embeddingPrice(prices, m) > 0 ? `${m} ${prices![m]}` : m)).join("\n");
}
