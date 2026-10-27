import { DEFAULT_DOMAIN_STOPWORDS, searchTerms } from "@/lib/ai/retrieval-core";

/*
 * Boşluk analizi: cevapsız ve olumsuz geri bildirimli cevapların kullanıcı soruları, benzerlerine göre gruplanır.
 * Saf mantık (veritabanı ve ağ yok), birim testle doğrulanır; soruları getiren sorgu stats.ts'tedir.
 * Gruplama modelsizdir: normalize + Türkçe önek terimleri (`searchTerms`) + yumuşak Jaccard.
 * Embedding ile birleştirme isteğe bağlıdır; vektörler yalnızca bellekte hesaplanır, hiçbir yerde saklanmaz (KVKK).
 */

export type GapQuestion = {
  /** Soruyu yanıtlayan asistan mesajının kimliği (konuşmada `#m-<id>` bağlantısı ve senaryo eylemi için). */
  messageId: string;
  conversationId: string;
  question: string;
  mode: string;
  at: Date;
  unanswered: boolean;
  negative: boolean;
};

export type GapCluster = {
  /** En sık sorulan metin (eşitlikte en yeni). */
  leader: string;
  terms: string[];
  questions: GapQuestion[];
};

export type GapGroup = {
  /** Kararlı olmayan, yalnızca liste anahtarı: lider sorunun normalize hali. */
  key: string;
  /** Temsilci soru: grubun en sık sorulan metni. */
  question: string;
  /** Temsilci sorunun en yeni örneği (eylemler bu konuşmaya/mesaja işaret eder). */
  target: GapQuestion;
  count: number;
  unanswered: number;
  negative: number;
  /** Moda göre soru sayısı, çoktan aza. */
  modes: { mode: string; count: number }[];
  lastAt: Date;
  /** Birbirinden farklı en çok `maxSamples` soru metni: temsilci önde, kalanlar en yeniden eskiye. */
  samples: GapQuestion[];
};

/** Terim kümelerinin birleşme eşiği (plan: Jaccard ≥ 0.5). */
export const GAP_MIN_JACCARD = 0.5;
/** Embedding birleştirmede kosinüs eşiği; tekrar kontrolünün (0.88) biraz altında, çünkü sorular kısa. */
export const GAP_MIN_COSINE = 0.85;
export const GAP_SAMPLES = 3;

const lower = (s: string) => s.toLocaleLowerCase("tr-TR").normalize("NFC");

/** Küçük harf, noktalamasız, tek boşluklu metin. İki soru yalnızca bu hali eşitse "aynı soru" sayılır. */
export function normalizeQuestion(text: string): string {
  return lower(text).split(/[^\p{L}\p{N}]+/u).filter(Boolean).join(" ");
}

/** Soru eki "mı/mi/mu/mü" ve çekimleri ("mıyım", "misin", "midir"): ayrı yazıldığında anlam taşımaz. */
const QUESTION_PARTICLE = /^m[ıiuü](?:y[ıiuü][mz]|s[ıiuü]n(?:[ıiuü]z)?|d[ıiuü]r|yd[ıiuü])?$/u;

/**
 * Gruplama terimleri: arama terimleriyle aynı (ilk 4 harf öneki, kısaltmalar tam eşleşme); soru ekleri atılır
 * ve hava botunda ayırt edici olmayan alan kelimeleri yok sayılır. Kısaltmalar "=" önekiyle işaretlidir.
 */
export function gapTerms(text: string, domainStopwords: string[] = DEFAULT_DOMAIN_STOPWORDS): string[] {
  const words = text.split(/[^\p{L}\p{N}]+/u).filter((w) => w && !QUESTION_PARTICLE.test(lower(w)));
  const terms = searchTerms(words.join(" "), domainStopwords).map((t) => (t.exact ? `=${t.term}` : t.term));
  return [...new Set(terms)].sort();
}

/**
 * İki terim aynı kökü taşır mı? "yapmalı"/"yapayım" (yapm/yapa) ve "don"/"donma" (don/donm) eşleşir:
 * ortak önek en az 3 harf ve kısa terimin en fazla 1 harfi dışında kalır. Kısaltmalar yalnızca tam eşleşir.
 */
export function termsMatch(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.startsWith("=") || b.startsWith("=")) return false;
  let shared = 0;
  while (shared < a.length && shared < b.length && a[shared] === b[shared]) shared++;
  return shared >= 3 && shared >= Math.min(a.length, b.length) - 1;
}

/** Yumuşak Jaccard: eşleşen terim çifti sayısı / birleşim. İki küme de boşsa 0 (metin eşitliğine bakılır). */
export function termSimilarity(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const used = new Set<number>();
  let matched = 0;
  for (const x of a) {
    const j = b.findIndex((y, i) => !used.has(i) && termsMatch(x, y));
    if (j >= 0) {
      used.add(j);
      matched++;
    }
  }
  return matched / (a.length + b.length - matched);
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/**
 * Sözcüksel kümeleme: önce birebir aynı (normalize) sorular toplanır; sonra en sık sorulandan başlayarak her sorunun
 * kümesi, liderine en benzer mevcut kümeye (≥ eşik) katılır ya da yeni küme açar. Lidere karşı karşılaştırma,
 * zincirleme kayarak alakasız soruların birleşmesini önler. Metni terim içermeyen sorular (yalnızca durak sözcük)
 * yalnızca birebir aynıysa birleşir. Küme sırası: soru sayısı azalan, eşitlikte en yeni.
 */
export function clusterGaps(questions: GapQuestion[], threshold = GAP_MIN_JACCARD, domainStopwords: string[] = DEFAULT_DOMAIN_STOPWORDS): GapCluster[] {
  const buckets = new Map<string, GapQuestion[]>();
  for (const q of questions) {
    const key = normalizeQuestion(q.question);
    if (!key) continue;
    const list = buckets.get(key);
    if (list) list.push(q);
    else buckets.set(key, [q]);
  }
  const newest = (list: GapQuestion[]) => Math.max(...list.map((q) => q.at.getTime()));
  const ordered = [...buckets.entries()].sort((a, b) => b[1].length - a[1].length || newest(b[1]) - newest(a[1]));

  const clusters: GapCluster[] = [];
  for (const [, list] of ordered) {
    const terms = gapTerms(list[0].question, domainStopwords);
    let best: GapCluster | null = null;
    let bestSim = 0;
    if (terms.length) {
      for (const c of clusters) {
        const sim = termSimilarity(terms, c.terms);
        if (sim >= threshold && sim > bestSim) {
          best = c;
          bestSim = sim;
        }
      }
    }
    if (best) best.questions.push(...list);
    else clusters.push({ leader: list[0].question, terms, questions: [...list] });
  }
  return sortClusters(clusters);
}

function sortClusters(clusters: GapCluster[]): GapCluster[] {
  const newest = (c: GapCluster) => Math.max(...c.questions.map((q) => q.at.getTime()));
  return clusters.sort((a, b) => b.questions.length - a.questions.length || newest(b) - newest(a));
}

/**
 * Anlamsal birleştirme (isteğe bağlı): `vectors[i]`, `clusters[i]` liderinin embedding'idir (null: yok). Kosinüs ≥ eşik
 * olan kümeler, daha büyük olana katılır. Vektörler yalnızca bu çağrıda kullanılır, saklanmaz. Vektörü olmayan
 * (ya da dizinin ötesindeki) kümeler olduğu gibi kalır.
 */
export function mergeClustersByEmbedding(clusters: GapCluster[], vectors: (number[] | null)[], minCosine = GAP_MIN_COSINE): GapCluster[] {
  const kept: { cluster: GapCluster; vec: number[] | null }[] = [];
  clusters.forEach((c, i) => {
    const vec = vectors[i] ?? null;
    const target = vec ? kept.find((k) => k.vec && cosine(vec, k.vec) >= minCosine) : undefined;
    if (target) target.cluster.questions.push(...c.questions);
    else kept.push({ cluster: { ...c, questions: [...c.questions] }, vec });
  });
  return sortClusters(kept.map((k) => k.cluster));
}

export function summarizeCluster(cluster: GapCluster, maxSamples = GAP_SAMPLES): GapGroup {
  const qs = cluster.questions;
  const byNorm = new Map<string, GapQuestion[]>();
  for (const q of qs) {
    const k = normalizeQuestion(q.question);
    const list = byNorm.get(k);
    if (list) list.push(q);
    else byNorm.set(k, [q]);
  }
  // Temsilci: en sık metin (eşitlikte en yeni). Kümenin lideri çoğunlukla odur; embedding birleşiminde değişebilir.
  const newestOf = (list: GapQuestion[]) => list.reduce((a, b) => (b.at > a.at ? b : a));
  const variants = [...byNorm.entries()]
    .map(([key, list]) => ({ key, list, latest: newestOf(list) }))
    .sort((a, b) => b.list.length - a.list.length || b.latest.at.getTime() - a.latest.at.getTime());
  const [head, ...rest] = variants;
  rest.sort((a, b) => b.latest.at.getTime() - a.latest.at.getTime());

  const modeCount = new Map<string, number>();
  for (const q of qs) modeCount.set(q.mode, (modeCount.get(q.mode) ?? 0) + 1);

  return {
    key: head.key,
    question: head.latest.question,
    target: head.latest,
    count: qs.length,
    unanswered: qs.filter((q) => q.unanswered).length,
    negative: qs.filter((q) => q.negative).length,
    modes: [...modeCount.entries()].map(([mode, count]) => ({ mode, count })).sort((a, b) => b.count - a.count),
    lastAt: qs.reduce((a, q) => (q.at > a ? q.at : a), qs[0].at),
    samples: [head, ...rest].slice(0, maxSamples).map((v) => v.latest),
  };
}

/** Sorulardan boşluk grupları (en sık olan önde). `clusters` verilirse (ör. embedding sonrası) kümeleme atlanır. */
export function groupGaps(questions: GapQuestion[], opts: { threshold?: number; maxSamples?: number; clusters?: GapCluster[] } = {}): GapGroup[] {
  const clusters = opts.clusters ?? clusterGaps(questions, opts.threshold);
  return clusters.filter((c) => c.questions.length).map((c) => summarizeCluster(c, opts.maxSamples));
}

/**
 * `pii` yetkisi olmayan roller için örnek soru maskesi: e-posta ve uzun rakam dizileri (telefon, kimlik no).
 * Kimlik/cihaz alanlarının maskesi (`maskId`) ayrıdır; burada sorunun serbest metni süzülür.
 */
export function maskQuestionPii(text: string): string {
  return text
    // Sınırlı tekrar: sınırsız `+` boşluksuz uzun girdide karesel geri sarar (ReDoS).
    .replace(/[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{1,63}/g, "•••@•••")
    .replace(/\+?\d[\d\s().-]{4,40}\d/g, (m) => (m.replace(/\D/g, "").length >= 6 ? "••••" : m));
}
