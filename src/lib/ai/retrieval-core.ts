/*
 * Bilgi tabanı aramasının saf parçaları: veritabanı ve ağ içermez, birim testle
 * doğrulanır. Sorguyu çalıştıran kısım retrieval.ts'tedir.
 */

const STOPWORDS = new Set(
  "ve ile bir bu şu o da de mi mı mu mü için gibi ama fakat çok daha en ne neden nasıl hangi var yok olur olsun ben sen biz siz onlar benim senin bana sana bunu şunu ise ki ya veya hem her şey kadar sonra önce göre".split(
    " ",
  ),
);

/** Hava botunda hemen her parçada geçen kelimeler; aramada ayırt edici değil. */
export const DEFAULT_DOMAIN_STOPWORDS = ["hava", "durumu", "durum", "nasıl", "olacak"];
export const DEFAULT_MIN_SIMILARITY = 0.3;

/** Öncelik katkısı RRF'nin tek liste payının (1/60 ≈ 0.0167) altında kalır. */
const PRIORITY_STEP = 0.0012;
const PRIORITY_CAP = 10;

const lower = (s: string) => s.toLocaleLowerCase("tr-TR").normalize("NFC");

/**
 * Türkçe sondan eklemeli; Postgres'in Türkçe kök bulucusu "sulasam" ile
 * "sulama"yı eşleştiremiyor. Bu yüzden her kelimenin ilk 4 harfiyle önek
 * araması yapılır (sula:*), sonuçlar sıralamayla ayıklanır.
 */
export function prefixTerms(text: string, domainStopwords: string[] = []): string[] {
  const domain = new Set(domainStopwords.map(lower));
  const words = lower(text)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w) && !domain.has(w));
  return [...new Set(words.map((w) => w.slice(0, Math.min(w.length, w.length <= 4 ? w.length : 4))))];
}

export function buildPrefixQuery(text: string, domainStopwords: string[] = []): string | null {
  const terms = prefixTerms(text, domainStopwords);
  if (!terms.length) return null;
  return terms.map((t) => `${t}:*`).join(" | ");
}

/** Sözcüksel ilgililik: tek terimde 1, aksi halde terimlerin yarısı (en az 2). */
export function lexicalThreshold(termCount: number): number {
  if (termCount <= 1) return 1;
  return Math.max(2, Math.ceil(termCount / 2));
}

export function isLexicallyRelevant(matched: number, termCount: number): boolean {
  return termCount > 0 && matched >= lexicalThreshold(termCount);
}

export type ChunkRow = { id: string; source_id: string; content: string; title: string; type: string; priority: number };
/** lex_matches: sorgudaki kaç farklı önek terimi bu parçayla eşleşti. */
export type LexRow = ChunkRow & { lex_matches: number };
/** similarity: 1 - kosinüs uzaklığı. */
export type VecRow = ChunkRow & { similarity: number };

export type RankedHit = {
  row: ChunkRow;
  /** Normalize edilmiş birleşik puan (0-1); yalnızca sıralama içindir, arayüzde gösterilmez. */
  score: number;
  similarity: number | null;
  lexical: boolean;
  relevant: boolean;
};

/**
 * İki aday listesini (tam metin, vektör) reciprocal rank fusion ile birleştirir.
 * Bir parça ilgili sayılır: kosinüs ≥ minSimilarity VEYA sözcüksel eşleşme yeterli.
 * Öncelik (düzeltme/SSS) yalnızca ilgili parçalara eklenir. Dönen liste puana
 * göre sıralıdır ve ilgisizleri de içerir; çağıran `relevant` ile süzer.
 */
export function rankHits(opts: {
  lexRows: LexRow[];
  vecRows: VecRow[];
  termCount: number;
  minSimilarity: number;
}): RankedHit[] {
  const { lexRows, vecRows, termCount, minSimilarity } = opts;
  const acc = new Map<string, { row: ChunkRow; rrf: number; similarity: number | null; matched: number }>();
  const touch = (row: ChunkRow) => {
    let e = acc.get(row.id);
    if (!e) {
      e = { row, rrf: 0, similarity: null, matched: 0 };
      acc.set(row.id, e);
    }
    return e;
  };
  lexRows.forEach((row, rank) => {
    const e = touch(row);
    e.rrf += 1 / (60 + rank);
    e.matched = row.lex_matches;
  });
  vecRows.forEach((row, rank) => {
    const e = touch(row);
    e.rrf += 1 / (60 + rank);
    e.similarity = row.similarity;
  });

  const max = 2 / 60;
  return [...acc.values()]
    .map((e) => {
      const lexical = isLexicallyRelevant(e.matched, termCount);
      const relevant = lexical || (e.similarity !== null && e.similarity >= minSimilarity);
      const boost = relevant ? Math.min(e.row.priority, PRIORITY_CAP) * PRIORITY_STEP : 0;
      return { row: e.row, score: Math.min(1, (e.rrf + boost) / max), similarity: e.similarity, lexical, relevant };
    })
    .sort((a, b) => b.score - a.score);
}

/** Arayüzde gösterilecek eşleşme etiketi; eski kayıtlarda (alan yok) null. */
export function describeMatch(s: { similarity?: number | null; lexical?: boolean }): string | null {
  if (s.similarity != null) return `benzerlik ${s.similarity.toFixed(2).replace(".", ",")}`;
  if (s.lexical) return "kelime eşleşmesi";
  return null;
}

/**
 * "Bilgi tabanında karşılık yok" bayrağı: hata yok, durdurulmadı, ilgili parça
 * yok ve başarılı bir araç çağrısı da yok. Yalnızca hata dönen araç cevap sayılmaz.
 */
export function isUnanswered(opts: {
  relevantHits: number;
  toolCalls: { output: unknown }[];
  error: string | null;
  aborted: boolean;
}): boolean {
  if (opts.error || opts.aborted || opts.relevantHits > 0) return false;
  return !opts.toolCalls.some((t) => (t.output as { ok?: unknown } | null | undefined)?.ok === true);
}
