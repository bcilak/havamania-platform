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

/** Küçük harfli olsa da kısaltma sayılan birim ve havacılık terimleri (önek değil, tam eşleşme). */
const KNOWN_ABBR = new Set(["kt", "kts", "ft", "nm", "hpa", "mb", "mm", "cm", "km", "kg", "metar", "taf", "notam", "sigmet", "airmet", "qnh", "ils"]);
const isUpper = (c: string) => c !== c.toLocaleLowerCase("tr-TR");

/**
 * Kısaltma / kod mu? ETo, UV, FL, IST, ESB (2-3 harf, tamamı büyük), hPa, ETo (içinde büyük harf olan en çok 4 harf),
 * FL350, 350, 12kt (rakam içeren, en az 2 karakter) ve bilinen kısaltmalar (kt, hPa, METAR, TAF, NOTAM…).
 * Cümle başındaki "Bu", "Ya" gibi yalnızca ilk harfi büyük kelimeler ve "SULAMA" gibi uzun büyük harfli kelimeler
 * kısaltma sayılmaz (önek aramasında kalır).
 */
export function isAbbreviation(raw: string): boolean {
  const chars = [...raw];
  if (chars.length < 2) return false;
  if (/\d/.test(raw)) return true;
  if (KNOWN_ABBR.has(raw.toLowerCase())) return true;
  const upper = chars.filter(isUpper).length;
  if (chars.length <= 3 && upper === chars.length) return true;
  return chars.length <= 4 && chars.slice(1).some(isUpper);
}

export type SearchTerm = {
  term: string;
  /** true: kısaltma/kod, tam eşleşme (önek değil). */
  exact: boolean;
};

/**
 * Sorgudan arama terimleri. Türkçe sondan eklemeli; Postgres'in Türkçe kök bulucusu "sulasam" ile
 * "sulama"yı eşleştiremiyor. Bu yüzden her kelimenin ilk 4 harfiyle önek araması yapılır (sula:*),
 * sonuçlar sıralamayla ayıklanır. Kısaltmalar (UV, FL, ETo, METAR, FL350, 350…) 2 harfli olsalar da
 * düşmez ve önek yerine tam eşleşme olarak aranır (ist:* "istasyon"u da getirirdi).
 * Yerleşik stopword'ler kısaltmaya dokunmaz; yöneticinin alan stopword listesi her zaman geçerlidir.
 */
export function searchTerms(text: string, domainStopwords: string[] = []): SearchTerm[] {
  const domain = new Set(domainStopwords.map(lower));
  const out = new Map<string, SearchTerm>();
  for (const raw of text.split(/[^\p{L}\p{N}]+/u)) {
    if (!raw) continue;
    const w = lower(raw);
    if (domain.has(w)) continue;
    if (isAbbreviation(raw)) {
      // Doküman tarafı veritabanı yereliyle küçültülür ("IST" → "ist"); Türkçe I→ı dönüşümü kullanılmaz.
      const term = raw.toLowerCase();
      out.set(`=${term}`, { term, exact: true });
    } else if (w.length >= 3 && !STOPWORDS.has(w)) {
      const term = w.slice(0, Math.min(w.length, w.length <= 4 ? w.length : 4));
      if (!out.has(term)) out.set(term, { term, exact: false });
    }
  }
  return [...out.values()];
}

/** Terim metinleri (geriye dönük uyumluluk): önek terimi ilk 4 harf, kısaltma tam. */
export function prefixTerms(text: string, domainStopwords: string[] = []): string[] {
  return searchTerms(text, domainStopwords).map((t) => t.term);
}

export function buildPrefixQuery(text: string, domainStopwords: string[] = []): string | null {
  const terms = searchTerms(text, domainStopwords);
  if (!terms.length) return null;
  return terms.map((t) => (t.exact ? t.term : `${t.term}:*`)).join(" | ");
}

/* ---------- Takip sorusu: arama sorgusu kurma ---------- */

/** Bu sözcüklerle başlayan soru (uzunluğuna bakılmaksızın) önceki mesaja bağlıdır ("peki yarın?", "ya Ankara'da?"). */
const FOLLOW_UP_START = new Set(["peki", "ya", "ama", "ve", "ayrıca", "yani", "hem", "onu", "bunu", "şunu", "orada", "burada", "şurada", "onun", "bunun", "şunun", "oradaki", "buradaki", "öyleyse", "bari", "evet", "hayır"]);
/** Zamirler: yalnızca kısa sorularda takip ipucudur ("bu nedir?", "o ne zaman?"); uzun soruda "Bu hafta…" bağımsızdır. */
const FOLLOW_UP_PRONOUNS = new Set(["o", "bu", "şu", "onu", "bunu", "şunu", "onun", "bunun", "şunun", "bunlar", "şunlar", "onlar", "orada", "burada", "şurada"]);
/** Unicode kelime sınırı: ASCII kelime sınırı Türkçe harflerde (ş, ı, ö…) çalışmaz. Sabit ifadeler, geri sarma yok. */
const WORD_CH = String.raw`\p{L}\p{N}`;
const phrase = (src: string) => new RegExp(`(?<![${WORD_CH}])${src}(?![${WORD_CH}])`, "u");
/** Cümlenin herhangi bir yerinde geçince bağlam gerektiren ifadeler. */
const FOLLOW_UP_PHRASES = ["o zaman", "bu durumda", "bu halde", "şu halde", "onu", "bunu", "şunu", "orada", "burada"].map(phrase);
/** "yarın da?", "Ankara için de?" gibi sonda "da/de" ile biten soru. */
const FOLLOW_UP_END = /\s(da|de)[\s?!.…]*$/u;
/** Bu kadar ya da daha az sözcüklü soruda takip ipucu aranır; ipucu yoksa soru bağımsız sayılır. */
const SHORT_QUESTION_WORDS = 3;
/** Zamirle başlayan sorunun kısa sayılacağı en çok sözcük ("bu ne zaman olur?"). */
const PRONOUN_START_WORDS = 4;
const MAX_QUERY_CHARS = 500;
/** Soru kalıbı sözcükleri: içerik sayılmaz ("sulama nedir?" tek içerik sözcüğüdür). */
const QUESTION_WORDS = new Set(["nedir", "nelerdir", "midir", "mıdır", "mudur", "müdür", "kaçtır", "hangisi", "nerede", "zaman", "kaç", "demek", "olur", "oldu"]);

const wordsOf = (s: string) => s.split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/**
 * Soru kendi başına anlamlı mı? Kısaltma/alan terimi (METAR, UV, FL350, 12kt) ya da en az 2 içerik sözcüğü
 * ("UV indeksi", "buğday sulaması") varsa önceki konuya bağlanmasına gerek yoktur.
 */
function hasStandaloneTerm(text: string): boolean {
  const raw = wordsOf(text);
  if (raw.some(isAbbreviation)) return true;
  const content = raw.map(lower).filter((w) => w.length >= 3 && !STOPWORDS.has(w) && !QUESTION_WORDS.has(w) && !FOLLOW_UP_PRONOUNS.has(w));
  return new Set(content).size >= 2;
}

/**
 * Soru önceki mesaja bağlı bir takip sorusu mu? (kural tabanlı, model çağırmaz)
 * Kısalık tek başına yetmez: "METAR nedir?" yeni konudur. Birleşme için açık bir ipucu gerekir:
 * takip başlangıç sözcüğü, takip ifadesi, sonda "da/de" ya da kısa soruda zamir; kendi başına anlamlı
 * terim içeren kısa soru ipucu olsa da birleşmez.
 */
export function isFollowUp(text: string): boolean {
  const t = lower(text).trim();
  const words = wordsOf(t);
  if (!words.length) return false;
  if (FOLLOW_UP_START.has(words[0])) return true;
  if (words.length > SHORT_QUESTION_WORDS) {
    if (words.length <= PRONOUN_START_WORDS && FOLLOW_UP_PRONOUNS.has(words[0])) return !hasStandaloneTerm(text);
    return FOLLOW_UP_PHRASES.some((re) => re.test(t)) || FOLLOW_UP_END.test(t);
  }
  const cue = words.some((w) => FOLLOW_UP_PRONOUNS.has(w)) || ["da", "de", "ta", "te"].includes(words[words.length - 1]) || FOLLOW_UP_PHRASES.some((re) => re.test(t));
  return cue && !hasStandaloneTerm(text);
}

/**
 * Bilgi tabanı arama sorgusu. `previousUserTexts` bu mesajdan önceki kullanıcı mesajlarıdır (eskiden yeniye).
 * Mevcut mesaj takip sorusuysa önceki kullanıcı mesajıyla birleştirilir; önceki mesajın kendisi de takip
 * sorusuysa bir önceki de eklenir (en çok 2). Asistan cevabı sorguya katılmaz. Mevcut mesaj boşsa (yalnızca
 * fotoğraf) son kullanıcı mesajı kullanılır.
 */
export function buildSearchQuery(previousUserTexts: string[], text: string): { query: string; followUp: boolean } {
  const prev = previousUserTexts.map((t) => t.trim()).filter(Boolean);
  const current = text.trim();
  if (!current) return { query: prev.at(-1) ?? "", followUp: false };
  if (!prev.length || !isFollowUp(current)) return { query: current, followUp: false };
  const parts = [current];
  const last = prev[prev.length - 1];
  parts.unshift(last);
  if (isFollowUp(last) && prev.length >= 2) parts.unshift(prev[prev.length - 2]);
  // Sınır aşılırsa en eski parçalar kısalır; mevcut mesaj her zaman tam kalır.
  let query = parts.join(" ");
  while (query.length > MAX_QUERY_CHARS && parts.length > 2) {
    parts.shift();
    query = parts.join(" ");
  }
  if (query.length > MAX_QUERY_CHARS) query = `${parts[0].slice(0, Math.max(0, MAX_QUERY_CHARS - current.length - 1))} ${current}`.trim();
  return { query, followUp: true };
}

/** Sözcüksel ilgililik: tek terimde 1, aksi halde terimlerin yarısı (en az 2). */
export function lexicalThreshold(termCount: number): number {
  if (termCount <= 1) return 1;
  return Math.max(2, Math.ceil(termCount / 2));
}

export function isLexicallyRelevant(matched: number, termCount: number): boolean {
  return termCount > 0 && matched >= lexicalThreshold(termCount);
}

/** idx: parçanın kaynak içindeki sırası (komşu parçaları birleştirmek için); eski testlerde/kayıtlarda yok. */
export type ChunkRow = { id: string; source_id: string; idx?: number; content: string; title: string; type: string; priority: number };
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

/**
 * Aynı parçaları farklı sorgularla bulunmuş iki sıralı listeyi (rankHits çıktısı) RRF ile birleştirir.
 * Takip sorusunda birleşik sorgu yanlışlıkla konu karıştırsa bile mevcut mesajın kendi sonuçları kaçmaz.
 * Parça herhangi bir listede ilgiliyse ilgilidir; benzerlik ve sözcüksel eşleşme en iyisini korur.
 */
export function fuseRanked(lists: RankedHit[][]): RankedHit[] {
  const acc = new Map<string, { hit: RankedHit; rrf: number }>();
  for (const list of lists) {
    list.forEach((h, rank) => {
      const cur = acc.get(h.row.id);
      const add = 1 / (60 + rank);
      if (!cur) {
        acc.set(h.row.id, { hit: { ...h }, rrf: add });
        return;
      }
      cur.rrf += add;
      cur.hit.relevant = cur.hit.relevant || h.relevant;
      cur.hit.lexical = cur.hit.lexical || h.lexical;
      if (h.similarity !== null && (cur.hit.similarity === null || h.similarity > cur.hit.similarity)) cur.hit.similarity = h.similarity;
    });
  }
  const max = lists.length / 60;
  return [...acc.values()].map((e) => ({ ...e.hit, score: Math.min(1, e.rrf / max) })).sort((a, b) => b.score - a.score);
}

/* ---------- Tekilleştirme ---------- */

export const DEFAULT_PER_SOURCE_MAX = 3;
/** Bu oranda ya da daha çok ortak sözcüğü olan parça, daha yüksek sıradakinin tekrarı sayılır. */
const NEAR_DUPLICATE = 0.9;
/** Çok kısa parçalarda örtüşme oranı anlamsızdır; yalnızca birebir eşitlik sayılır. */
const MIN_WORDS_FOR_OVERLAP = 6;
const MIN_MERGE_OVERLAP = 20;
const HEADER_RE = /^Bölüm: [^\n]*\n/;

const normalizeBody = (content: string) => lower(content.replace(HEADER_RE, "")).replace(/[^\p{L}\p{N}]+/gu, " ").trim();

function overlapRatio(a: string[], b: string[]): number {
  const small = a.length <= b.length ? a : b;
  const big = new Set(a.length <= b.length ? b : a);
  if (!small.length) return 0;
  let shared = 0;
  for (const w of new Set(small)) if (big.has(w)) shared++;
  return shared / new Set(small).size;
}

/** İki bitişik parçayı birleştirir: ortak (örtüşen) kısım bir kez yazılır, aynı bölüm başlığı tekrarlanmaz. */
export function joinNeighborChunks(first: string, second: string): string {
  const h1 = HEADER_RE.exec(first)?.[0];
  const h2 = HEADER_RE.exec(second)?.[0];
  const rest = h2 && h1 === h2 ? second.slice(h2.length) : second;
  const max = Math.min(first.length, rest.length, 400);
  for (let k = max; k >= MIN_MERGE_OVERLAP; k--) {
    if (first.endsWith(rest.slice(0, k))) return first + rest.slice(k);
  }
  return `${first}\n\n${rest}`;
}

export type DedupeStatus = "keep" | "merged" | "duplicate" | "cap";
type DedupeItem = { chunkId: string; sourceId: string; idx?: number; content: string; relevant: boolean };

/**
 * İlgili parçaları (puan sırasıyla) tekilleştirir. Sıra ve uzunluk korunur; her öğeye durum atanır:
 *  - keep: bağlama girebilir (komşu birleşmişse içeriği birleşik metindir)
 *  - merged: aynı kaynaktan bitişik idx'li parça bir üst sıradakiyle birleştirildi
 *  - duplicate: normalize metni aynı ya da %90+ sözcük örtüşmesi olan, daha yüksek sıradaki parçanın tekrarı
 *  - cap: kaynak başına üst sınır doldu (birleşen parçalar da sayılır)
 * İlgisiz parçalar olduğu gibi `keep` kalır (çağıran `relevant` ile süzer).
 */
export function dedupeHits<T extends DedupeItem>(items: T[], perSourceMax: number = DEFAULT_PER_SOURCE_MAX): { item: T; status: DedupeStatus }[] {
  const cap = Math.max(1, perSourceMax);
  const out = items.map((item) => ({ item: { ...item }, status: "keep" as DedupeStatus }));
  const kept: { at: number; words: string[]; norm: string; lo: number | null; hi: number | null }[] = [];
  const perSource = new Map<string, number>();

  out.forEach((o, i) => {
    if (!o.item.relevant) return;
    const norm = normalizeBody(o.item.content);
    const words = norm.split(" ").filter(Boolean);
    const dup = kept.some((k) => k.norm === norm || (words.length >= MIN_WORDS_FOR_OVERLAP && k.words.length >= MIN_WORDS_FOR_OVERLAP && overlapRatio(k.words, words) >= NEAR_DUPLICATE));
    if (dup) {
      o.status = "duplicate";
      return;
    }
    const count = perSource.get(o.item.sourceId) ?? 0;
    if (count >= cap) {
      o.status = "cap";
      return;
    }
    const idx = o.item.idx;
    if (idx !== undefined) {
      const host = kept.find((k) => out[k.at].item.sourceId === o.item.sourceId && k.lo !== null && k.hi !== null && (idx === k.hi + 1 || idx === k.lo - 1));
      if (host && host.lo !== null && host.hi !== null) {
        const target = out[host.at].item;
        target.content = idx > host.hi ? joinNeighborChunks(target.content, o.item.content) : joinNeighborChunks(o.item.content, target.content);
        host.lo = Math.min(host.lo, idx);
        host.hi = Math.max(host.hi, idx);
        host.words = normalizeBody(target.content).split(" ").filter(Boolean);
        host.norm = normalizeBody(target.content);
        perSource.set(o.item.sourceId, count + 1);
        o.status = "merged";
        return;
      }
    }
    perSource.set(o.item.sourceId, count + 1);
    kept.push({ at: i, words, norm, lo: idx ?? null, hi: idx ?? null });
  });
  return out;
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
