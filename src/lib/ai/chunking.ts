/*
 * Metni arama parçalarına böler (saf, bağımlılıksız).
 *
 * - Paragraf sınırına saygı duyar; uzun paragrafı önce cümle, sonra kelime sınırından böler.
 *   Kelime ortasından yalnızca boşluksuz, boyuttan uzun tek bir dizgide (ör. uzun URL) keser.
 * - Örtüşme de cümle ya da kelime başından başlar.
 * - Markdown tarzı başlıklar (`#`, `##`, `###`) izlenir; her parçanın başına
 *   "Bölüm: A › B" satırı eklenir ve boyut hesabına dahildir. Bir parça bölüm sınırını aşmaz.
 * - Tablo satırları (" | " ile ayrılmış) ve madde listeleri satır sınırından bölünür; tablo mümkünse tek parçada kalır.
 */

const FIRST_RE = /^["'“‘(\[«]*(\p{L}|\p{N})/u;
const OPEN_STRIP_RE = /^["'“‘(\[«]+/;
// Noktalama ve kapanış dizileri sınırlı tekrarlıdır: sınırsız `+` boşluksuz uzun nokta dizisinde karesel geri sarar.
const SENT_RE = /([.!?…]{1,8}[)\]"'”’»]{0,4})(\s+)/gu;

/** Ardından büyük harf gelse bile cümleyi bitirmeyen kısaltmalar (küçük harf, tr-TR). */
const NON_TERMINAL_ABBR = new Set([
  "dr", "prof", "doç", "yrd", "sn", "av", "müh", "op", "uzm", "no", "bkz", "örn", "mah", "cad", "sok", "bul", "apt", "st", "gen", "alb", "tuğg", "yzb", "ütğm", "md",
]);
const MONTHS = new Set(["ocak", "şubat", "mart", "nisan", "mayıs", "haziran", "temmuz", "ağustos", "eylül", "ekim", "kasım", "aralık"]);

const lower = (s: string) => s.toLocaleLowerCase("tr-TR");

function isBoundary(text: string, punctAt: number, punct: string, next: number): boolean {
  const rest = text.slice(next, next + 40);
  const strong = /[!?]/.test(punct);
  const first = FIRST_RE.exec(rest);
  if (!first) return true; // madde işareti, tire gibi harf olmayan başlangıç
  if (strong) return true;
  // "vb. ile", "örn. su", "…ve": küçük harfle devam eden cümle bitmemiştir.
  if (/\p{Ll}/u.test(first[1])) return false;
  if (/^[.!?…]+/.exec(punct)?.[0] === ".") {
    const tok = (/(\S+)$/.exec(text.slice(Math.max(0, punctAt - 30), punctAt))?.[1] ?? "").replace(OPEN_STRIP_RE, "");
    const last = tok.split(".").filter(Boolean).pop() ?? "";
    if (NON_TERMINAL_ABBR.has(lower(last))) return false; // "Dr. Ayşe", "No. 5"
    if (/^\p{Lu}$/u.test(last)) return false; // baş harf: "A. Yılmaz"
    if (/^\d{1,2}$/.test(tok)) {
      const word = /^[^\p{L}]*(\p{L}+)/u.exec(rest)?.[1];
      if (word && MONTHS.has(lower(word))) return false; // "12. Ekim"
    }
  }
  return true;
}

/** Cümle başlangıçlarının konumları (her zaman 0 ile başlar). "06.30", "12.10.2026", "3.5" gibi boşluksuz noktalar bölmez. */
export function sentenceStarts(text: string): number[] {
  const starts = [0];
  for (const m of text.matchAll(SENT_RE)) {
    const end = m.index + m[0].length;
    if (end >= text.length) continue;
    if (isBoundary(text, m.index, m[1], end)) starts.push(end);
  }
  return starts;
}

export function splitSentences(text: string): string[] {
  const starts = sentenceStarts(text);
  return starts.map((s, i) => text.slice(s, starts[i + 1] ?? text.length).trim()).filter(Boolean);
}

/** Metnin sonundan en çok `overlap` karakter; mümkünse cümle başından, yoksa kelime başından başlar. */
function tailFrom(text: string, overlap: number): string {
  if (overlap <= 0 || !text) return "";
  if (text.length <= overlap) return text;
  const from = text.length - overlap;
  const s = sentenceStarts(text).find((i) => i >= from && i < text.length);
  if (s !== undefined) return text.slice(s);
  if (/\s/.test(text[from - 1] ?? "")) return text.slice(from);
  const ws = /\s+/.exec(text.slice(from));
  if (ws && from + ws.index + ws[0].length < text.length) return text.slice(from + ws.index + ws[0].length);
  return text.slice(from);
}

/** Boyuttan uzun tek cümleyi kelime sınırından, kelime sonu örtüşmeli pencerelere böler. */
function windowWords(text: string, budget: number, overlap: number): string[] {
  const out: string[] = [];
  let cur: string[] = [];
  let curLen = 0;
  const step = Math.max(1, budget - overlap);
  for (const w of text.split(/\s+/).filter(Boolean)) {
    if (w.length > budget) {
      // Boşluksuz dev dizgi: kaçınılmaz olarak sabit pencere.
      if (cur.length) out.push(cur.join(" "));
      cur = [];
      curLen = 0;
      for (let i = 0; i < w.length; i += step) {
        out.push(w.slice(i, i + budget));
        if (i + budget >= w.length) break;
      }
      continue;
    }
    if (cur.length && curLen + 1 + w.length > budget) {
      out.push(cur.join(" "));
      // Örtüşme: birleşik uzunluğu overlap'i aşmayan en uzun sonek (uzunluklar artımlı tutulur: doğrusal).
      let k = cur.length;
      let tailLen = 0;
      while (k > 0) {
        const add = tailLen === 0 ? cur[k - 1].length : cur[k - 1].length + 1;
        if (tailLen + add > overlap) break;
        tailLen += add;
        k--;
      }
      let start = k;
      while (start < cur.length && tailLen + 1 + w.length > budget) {
        tailLen -= cur[start].length + (start < cur.length - 1 ? 1 : 0);
        start++;
      }
      cur = cur.slice(start);
      curLen = cur.length ? tailLen : 0;
    }
    curLen += cur.length ? w.length + 1 : w.length;
    cur.push(w);
  }
  if (cur.length) out.push(cur.join(" "));
  return out;
}

function packSentences(sentences: string[], budget: number, overlap: number): string[] {
  const out: string[] = [];
  let cur = "";
  for (const s of sentences) {
    if (s.length > budget) {
      if (cur) out.push(cur);
      cur = "";
      out.push(...windowWords(s, budget, overlap));
      continue;
    }
    if (cur && cur.length + 1 + s.length > budget) {
      out.push(cur);
      const tail = tailFrom(cur, overlap);
      cur = tail && tail.length + 1 + s.length <= budget ? `${tail} ${s}` : s;
    } else {
      cur = cur ? `${cur} ${s}` : s;
    }
  }
  if (cur) out.push(cur);
  return out;
}

const ROW_RE = / \| |^(?:[-*•]|\d+[.)])\s/;
/** Tablo satırları ve madde listeleri: satır satır bölünebilen, kendi içinde tamamlanmış satırlar. */
function isRowBlock(p: string): boolean {
  const lines = p.split("\n").filter((l) => l.trim());
  return lines.length >= 1 && lines.every((l) => ROW_RE.test(l));
}

function packLines(lines: string[], budget: number, overlap: number): string[] {
  const out: string[] = [];
  let cur = "";
  for (const line of lines) {
    if (line.length > budget) {
      if (cur) out.push(cur);
      cur = "";
      out.push(...packSentences(splitSentences(line), budget, overlap));
      continue;
    }
    if (cur && cur.length + 1 + line.length > budget) {
      out.push(cur);
      cur = line;
    } else {
      cur = cur ? `${cur}\n${line}` : line;
    }
  }
  if (cur) out.push(cur);
  return out;
}

function splitOversize(p: string, budget: number, overlap: number): string[] {
  if (isRowBlock(p)) return packLines(p.split("\n").map((l) => l.trim()).filter(Boolean), budget, overlap);
  // Sabit satır genişliğiyle kırılmış metinde satır sonu cümle sınırı değildir.
  return packSentences(splitSentences(p.split("\n").map((l) => l.trim()).filter(Boolean).join(" ")), budget, overlap);
}

function chunkSection(paras: string[], budget: number, overlap: number): string[] {
  const out: string[] = [];
  let cur = "";
  let last = "";
  for (const p of paras) {
    if (p.length > budget) {
      if (cur) out.push(cur);
      cur = "";
      out.push(...splitOversize(p, budget, overlap));
      last = p;
      continue;
    }
    if (cur && cur.length + 2 + p.length > budget) {
      out.push(cur);
      // Tablo/liste satırının ortasından başlayan örtüşme anlamsızdır.
      const tail = isRowBlock(last) ? "" : tailFrom(cur, overlap);
      cur = tail && tail.length + 2 + p.length <= budget ? `${tail}\n\n${p}` : p;
    } else {
      cur = cur ? `${cur}\n\n${p}` : p;
    }
    last = p;
  }
  if (cur) out.push(cur);
  return out;
}

type Section = { path: string[]; paras: string[] };

const HEADING_RE = /^(#{1,3})[ \t]+(.+?)[ \t]*#*[ \t]*$/;

/** Bundan uzun satır başlık sayılmaz (başlık en çok 100 karaktere kısalır); regex'in karesel geri sarmasını da önler. */
const MAX_HEADING_LINE = 200;

function headingTitle(raw: string): string {
  return raw.replace(/[*_`]+/g, "").replace(/\s+/g, " ").trim().slice(0, 100);
}

function parseSections(clean: string): Section[] {
  const sections: Section[] = [];
  let path: string[] = [];
  let sec: Section = { path: [], paras: [] };
  sections.push(sec);
  let fence = false;
  for (const para of clean.split("\n\n")) {
    let buf: string[] = [];
    const flush = () => {
      const t = buf.join("\n").trim();
      if (t) sec.paras.push(t);
      buf = [];
    };
    for (const line of para.split("\n")) {
      if (/^\s*(```|~~~)/.test(line)) fence = !fence;
      const h = fence || line.length > MAX_HEADING_LINE ? null : HEADING_RE.exec(line);
      const title = h ? headingTitle(h[2]) : "";
      if (h && title) {
        flush();
        const level = h[1].length;
        path = [...path.slice(0, level - 1)];
        path[level - 1] = title;
        sec = { path: path.filter(Boolean), paras: [] };
        sections.push(sec);
      } else {
        buf.push(line);
      }
    }
    flush();
  }
  return sections;
}

const MAX_PREFIX = 300;

/** Başlık yolu satırı; boyut hesabına dahil edilsin diye uzunluğu sınırlıdır. */
export function sectionPrefix(path: string[], size: number): string {
  if (!path.length) return "";
  const cap = Math.min(MAX_PREFIX, Math.floor(size / 3));
  let line = `Bölüm: ${path.join(" › ")}`;
  if (line.length > cap) line = `${line.slice(0, Math.max(1, cap - 1)).trimEnd()}…`;
  return `${line}\n`;
}

/** Paragraf ve cümle sınırlarına saygı duyan, ~1000 karakterlik ve 150 karakter örtüşmeli parçalar; başlık varsa başında "Bölüm: …" satırı. */
export function chunkText(text: string, size = 1000, overlap = 150): string[] {
  const clean = text
    .replace(/\r/g, "")
    .replace(/[ \t ]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!clean) return [];
  const out: string[] = [];
  for (const sec of parseSections(clean)) {
    if (!sec.paras.length) continue;
    const prefix = sectionPrefix(sec.path, size);
    const budget = size - prefix.length;
    const ov = Math.min(overlap, Math.floor(budget / 2));
    for (const body of chunkSection(sec.paras, budget, ov)) {
      const c = `${prefix}${body}`.trim();
      if (c) out.push(c);
    }
  }
  return out;
}
