/*
 * Tekrar kontrolünün saf kuralları: yeni ya da düzenlenen SSS/düzeltmenin sorusu,
 * aynı kapsamdaki mevcut kayıtlarla karşılaştırılır. Veritabanı ve ağ içermez,
 * birim testle doğrulanır; adayları ve vektör skorlarını getiren kısım retrieval.ts'tedir.
 */

/**
 * Embedding benzerliği eşiği (kosinüs). Karşılaştırılan metin kayıtlı parçayla aynı biçimdedir
 * ("Soru: …\nCevap: …"), bu yüzden aynı soru ve benzer cevap ~1'e yakın çıkar. Sağlayıcı
 * bağlanınca gerçek veriyle ayarlanır; ilgililik eşiğinin (0.30) çok üstünde tutulur ki
 * yalnızca gerçekten benzer kayıtlar uyarı versin.
 */
export const SIMILAR_MIN_COSINE = 0.88;
/** Soru kelime kümelerinin Jaccard örtüşmesi eşiği (4 ortak / 5 toplam kelime = 0.8 yeter). */
export const SIMILAR_MIN_OVERLAP = 0.8;
/** Formda gösterilen en fazla benzer kayıt. */
export const SIMILAR_MAX = 3;

/** "all" | "genel" | "agro" | "fly" */
export type ModeScope = string;

export type SimilarCandidate = {
  id: string;
  title: string;
  question: string;
  mode: ModeScope;
  type: string;
};

export type SimilarReason = "same" | "semantic" | "overlap";

export type SimilarMatch = SimilarCandidate & {
  reason: SimilarReason;
  /** same = 1; semantic = kosinüs; overlap = Jaccard. */
  score: number;
};

/** Formun uyarı durumu (server action döndürür); `similar` doluysa kayıt oluşmamıştır. */
export type SimilarState = { similar: SimilarMatch[] } | null;

const lower = (s: string) => s.toLocaleLowerCase("tr-TR").normalize("NFC");

/** Küçük harf (Türkçe), noktalama ve fazla boşluk atılmış soru; eşitlik karşılaştırması için. */
export function normalizeQuestion(q: string): string {
  return lower(q)
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * Tekrar karşılaştırma anahtarı: `normalizeQuestion` + noktasız ı → i. Büyük/küçük harf farkı
 * ("YERINDE" tr-TR'de "yerınde" olur) ve İ/I/ı/i yazım farkı aynı soruyu ayırmasın diye
 * yalnızca eşitlik ve örtüşme hesabında kullanılır.
 */
export function questionKey(q: string): string {
  return normalizeQuestion(q).replaceAll("ı", "i");
}

/** Aynı mod ya da taraflardan biri "all" (tüm modlarda geçerli) ise iki kayıt aynı kapsamda yarışır. */
export function modesOverlap(a: ModeScope, b: ModeScope): boolean {
  return a === b || a === "all" || b === "all";
}

/** Normalleştirilmiş iki sorunun kelime kümesi örtüşmesi (Jaccard, 0-1). */
export function questionOverlap(a: string, b: string): number {
  const wa = new Set(questionKey(a).split(" ").filter(Boolean));
  const wb = new Set(questionKey(b).split(" ").filter(Boolean));
  if (!wa.size || !wb.size) return 0;
  let common = 0;
  for (const w of wa) if (wb.has(w)) common++;
  return common / (wa.size + wb.size - common);
}

/**
 * En fazla `SIMILAR_MAX` benzer kayıt: önce soru eşitliği, sonra güçlü skora göre.
 * - same: normalleştirilmiş sorular eşit
 * - semantic: embedding kosinüsü ≥ SIMILAR_MIN_COSINE (`vectorScores`: kaynak id → en yüksek kosinüs)
 * - overlap: kelime örtüşmesi ≥ SIMILAR_MIN_OVERLAP
 * `excludeIds` (düzenlenen kaydın kendisi ve eski halleri) hiç aday olmaz.
 */
export function findSimilar(opts: {
  question: string;
  mode: ModeScope;
  candidates: SimilarCandidate[];
  vectorScores?: ReadonlyMap<string, number>;
  excludeIds?: ReadonlySet<string>;
  max?: number;
}): SimilarMatch[] {
  const target = questionKey(opts.question);
  if (!target) return [];
  const out: SimilarMatch[] = [];
  for (const c of opts.candidates) {
    if (opts.excludeIds?.has(c.id) || !modesOverlap(opts.mode, c.mode)) continue;
    const cosine = opts.vectorScores?.get(c.id);
    const overlap = questionOverlap(opts.question, c.question);
    const semantic = cosine !== undefined && cosine >= SIMILAR_MIN_COSINE;
    if (questionKey(c.question) === target) out.push({ ...c, reason: "same", score: 1 });
    else if (semantic && cosine >= overlap) out.push({ ...c, reason: "semantic", score: cosine });
    else if (overlap >= SIMILAR_MIN_OVERLAP) out.push({ ...c, reason: "overlap", score: overlap });
    else if (semantic) out.push({ ...c, reason: "semantic", score: cosine });
  }
  const rank = (m: SimilarMatch) => (m.reason === "same" ? 2 : 1) + m.score;
  return out.sort((a, b) => rank(b) - rank(a)).slice(0, opts.max ?? SIMILAR_MAX);
}

export const SIMILAR_REASON_LABEL: Record<SimilarReason, string> = {
  same: "aynı soru",
  semantic: "anlamca çok yakın",
  overlap: "çok benzer soru",
};

/** Yönlendirme mesajında kullanılan kısa özet (formsuz geri dönüşler için). */
export function similarMessage(matches: SimilarMatch[]): string {
  const list = matches
    .map((m) => `«${m.question.length > 80 ? `${m.question.slice(0, 80)}…` : m.question}» (${SIMILAR_REASON_LABEL[m.reason]})`)
    .join("; ");
  return `Benzer kayıt var: ${list}. Yine de kaydetmek için "Benzer kayıt olsa da kaydet" kutusunu işaretleyip tekrar gönderin.`;
}
