/*
 * Kaynak atıfları ([1], [2][3], [1, 2]) için saf yardımcılar.
 *
 * Model, bilgi tabanından aldığı bilgiyi cümle sonunda [n] ile belirtmesi için yönlendirilir; n, prompt'taki
 * kaynak bloğunun numarasıdır (= sources[n-1]). Karar: kaynaklar son kullanıcıya gösterilmez. Bu yüzden
 * atıflar kayda ve son kullanıcıya giden akıştan temizlenir; hangi kaynakların anıldığı yalnızca
 * mesaj meta verisinde (`sources[].cited`) tutulur ve panelde görünür.
 */

/**
 * Atıf biçimi: [1], [12], [1, 2], [1;2] (en çok iki haneli numaralar) ve bunların ardışık dizisi ([1][2]).
 * Boşluklar sınırlıdır ({0,3}); yineleme grupları birbirinden ayrık karakterlerle başladığı için geri sarma doğrusaldır.
 */
const MARKER = String.raw`\[\s{0,3}\d{1,2}(?:\s{0,3}[,;]\s{0,3}\d{1,2})*\s{0,3}\]`;
const RUN_SRC = `(?:${MARKER})+`;
const MARKER_FULL = new RegExp(`^${MARKER}$`);
/** Akışın ucunda yarım kalmış olabilen atıf başlangıcı: "[", "[1", "[1,", "[12 ;". */
const PARTIAL = /^\[[\d \t,;]{0,14}$/;
/** Kaynak sayısı bilinmiyorsa (eski çağrılar) kabul edilen en büyük numara. */
const DEFAULT_MAX = 99;
/** Bir atıf işaretinin uzunluk üst sınırı (geriye doğru taramada). */
const MARKER_MAX_CHARS = 40;

const isSpace = (c: string | undefined) => c === " " || c === "\t";

/** İşaretin tüm numaraları 1..max aralığında mı? ([10, 15] derece ya da dizi[0] atıf değildir.) */
function isCitation(marker: string, max: number): boolean {
  const nums = marker.match(/\d+/g) ?? [];
  return nums.length > 0 && nums.every((n) => Number(n) >= 1 && Number(n) <= max);
}

/** Sondaki boşluk/sekmeleri atar (regex yok: uzun boşluk dizilerinde doğrusal). */
function trimSpaces(s: string): string {
  let end = s.length;
  while (end > 0 && isSpace(s[end - 1])) end--;
  return end === s.length ? s : s.slice(0, end);
}

/**
 * Atıfları siler. Ardışık işaret dizisinin hemen ardından "(" geliyorsa markdown bağlantı metnidir
 * ("[1](url)") ve dokunulmaz; aralık dışı numaralı işaretler korunur. Silinen atıfın önündeki boşluk da gider.
 * Metnin sonu "karara bağlanmış" sayılır (sonrasında "(" gelmeyecek).
 */
function clean(text: string, max: number): string {
  const parts: string[] = [];
  let last = 0;
  for (const m of text.matchAll(new RegExp(RUN_SRC, "g"))) {
    const start = m.index;
    const end = start + m[0].length;
    if (text[end] === "(") continue;
    const kept = (m[0].match(new RegExp(MARKER, "g")) ?? []).filter((x) => !isCitation(x, max));
    let segEnd = start;
    if (kept.length === 0) while (segEnd > last && isSpace(text[segEnd - 1])) segEnd--;
    parts.push(text.slice(last, segEnd), kept.join(""));
    last = end;
  }
  parts.push(text.slice(last));
  return parts.join("");
}

/** Sonda yarım kalmış, geçerli olabilecek atıf başlangıcının ("[", "[1", "[1,") konumu; yoksa -1. */
function partialTailStart(text: string, max: number): number {
  const p = text.lastIndexOf("[");
  if (p < 0 || text.length - p > 15) return -1;
  const tail = text.slice(p);
  if (!PARTIAL.test(tail)) return -1;
  const nums = tail.match(/\d+/g) ?? [];
  return nums.every((n) => n.length <= 2 && Number(n) >= 1 && Number(n) <= max) ? p : -1;
}

/** `cut` konumundan geriye doğru, hemen önündeki tam atıf işaretlerinin başlangıcı. */
function runStartBefore(text: string, cut: number): number {
  let at = cut;
  while (at > 0 && text[at - 1] === "]") {
    const open = text.lastIndexOf("[", at - 1);
    if (open < 0 || at - open > MARKER_MAX_CHARS || !MARKER_FULL.test(text.slice(open, at))) break;
    at = open;
  }
  return at;
}

/** Atıf işaretlerini ve metnin sonunda yarım kalmış atıf başlangıcını siler. max: kaynak sayısı; 0 ise metne dokunulmaz. */
export function stripCitations(text: string, max: number = DEFAULT_MAX): string {
  if (max <= 0) return text;
  const p = partialTailStart(text, max);
  const out = clean(p >= 0 ? text.slice(0, p) : text, max);
  return p >= 0 ? trimSpaces(out) : out;
}

/** Metindeki atıfların numaraları (1..max aralığında, tekrarsız, artan sırada; bağlantı metni sayılmaz). */
export function citedNumbers(text: string, max: number): number[] {
  const found = new Set<number>();
  if (max <= 0) return [];
  for (const run of text.matchAll(new RegExp(RUN_SRC, "g"))) {
    if (text[run.index + run[0].length] === "(") continue;
    for (const m of run[0].match(new RegExp(MARKER, "g")) ?? []) {
      if (!isCitation(m, max)) continue;
      for (const n of m.match(/\d+/g) ?? []) found.add(Number(n));
    }
  }
  return [...found].sort((a, b) => a - b);
}

/**
 * Parçalı akış için durumlu süzgeç: gelen parçaları birleştirip atıfları siler. Sonu henüz belli olmayan kısım
 * (yarım atıf "[", "[1"; tam atıfın ardından "(" gelip gelmeyeceği; atıfın önündeki boşluk) sonraki parçaya kadar
 * bekletilir. `max` kaynak sayısıdır; 0 ise (kaynak yok) süzgeç atlanır, metin olduğu gibi geçer.
 * `push` o ana kadar güvenle gösterilebilecek metni, `flush` akış bitince kalanı döner.
 */
export class CitationStripper {
  private held = "";

  constructor(private readonly max: number = DEFAULT_MAX) {}

  push(delta: string): string {
    if (this.max <= 0) return delta;
    const text = this.held + delta;
    let cut = text.length;
    const p = partialTailStart(text, this.max);
    if (p >= 0) cut = p;
    cut = runStartBefore(text, cut);
    while (cut > 0 && isSpace(text[cut - 1])) cut--;
    this.held = text.slice(cut);
    return clean(text.slice(0, cut), this.max);
  }

  /** Akış bitti: yarım kalmış atıf başlangıcı atılır, bekleyen tam atıflar silinir, düz boşluk korunur. */
  flush(): string {
    if (this.max <= 0) return "";
    const text = this.held;
    this.held = "";
    return stripCitations(text, this.max);
  }
}
