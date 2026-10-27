/*
 * Dosya ve sayfa içeriğini düz metne çeviren saf yardımcılar (veritabanı yok, ağ yok).
 * Başlıklar Markdown tarzı `#`/`##`/`###` satırlarına, tablolar satır satır metne çevrilir;
 * chunking.ts bu işaretlerden "Bölüm: …" bağlamını çıkarır.
 */
import { inflateRawSync } from "node:zlib";
import mammoth from "mammoth";
import { type Node, NodeType, parse, type HTMLElement, type TextNode } from "node-html-parser";

/* ---------- HTML → metin ---------- */

const SKIP_TAGS = new Set(["script", "style", "noscript", "svg", "iframe", "template", "head", "img", "canvas", "object"]);
const INLINE = new Set(["a", "span", "b", "strong", "i", "em", "u", "sub", "sup", "small", "code", "mark", "abbr", "font", "s", "del", "ins", "label", "cite", "q", "time"]);
const squash = (s: string) => s.replace(/[\s ]+/g, " ").trim();

/**
 * Düğümün düz metni (HTMLElement.text yerine: o özyinelemelidir, çok derin iç içe HTML'de yığını taşırır).
 * Açık yığınla yürür; belge sırası korunur.
 */
function textOf(root: Node): string {
  const parts: string[] = [];
  const stack: Node[] = [root];
  while (stack.length) {
    const n = stack.pop() as Node;
    if (n.nodeType === NodeType.TEXT_NODE) parts.push((n as TextNode).text);
    else for (let i = n.childNodes.length - 1; i >= 0; i--) stack.push(n.childNodes[i]);
  }
  return parts.join("");
}

function tagOf(node: Node): string {
  return ((node as HTMLElement).tagName ?? "").toLowerCase();
}

function elementChildren(el: Node): HTMLElement[] {
  return el.childNodes.filter((c): c is HTMLElement => c.nodeType === NodeType.ELEMENT_NODE);
}

/** Satırın ait olduğu en yakın tablo `table` mi (iç içe tablolarda satırlar çiftlenmesin)? */
function ownerTable(tr: Node): Node | null {
  for (let p = tr.parentNode as Node | null; p; p = p.parentNode as Node | null) if (tagOf(p) === "table") return p;
  return null;
}

/**
 * Tabloyu satır satır metne çevirir. Başlık satırı (`<th>`) varsa her veri satırı
 * "Başlık: değer | Başlık: değer" olur (satır tek başına anlamlıdır, bölünse bile);
 * yoksa hücreler " | " ile birleştirilir. Boş satırlar atılır.
 */
export function tableToText(table: HTMLElement): string {
  const rows: { cells: string[]; header: boolean }[] = [];
  for (const tr of table.querySelectorAll("tr")) {
    if (ownerTable(tr) !== table) continue;
    const cells = elementChildren(tr).filter((c) => ["td", "th"].includes(tagOf(c)));
    rows.push({ cells: cells.map((c) => squash(textOf(c))), header: cells.length > 0 && cells.every((c) => tagOf(c) === "th") });
  }
  const labels = rows[0]?.header && rows.length > 1 ? rows[0].cells : null;
  const body = labels ? rows.slice(1) : rows;
  const lines: string[] = [];
  for (const r of body) {
    const parts = r.cells.map((v, i) => (v ? (labels?.[i] ? `${labels[i]}: ${v}` : v) : "")).filter(Boolean);
    if (parts.length) lines.push(parts.join(" | "));
  }
  return lines.join("\n");
}

class Blocks {
  readonly list: string[] = [];
  private inline = "";
  private prefix = "";
  text(s: string) {
    this.inline += s;
  }
  marker(prefix: string) {
    this.flush();
    this.prefix = prefix;
  }
  flush() {
    const t = squash(this.inline);
    this.inline = "";
    if (t) {
      this.list.push(this.prefix + t);
      this.prefix = "";
    }
  }
  push(block: string) {
    this.flush();
    if (block.trim()) this.list.push(block);
  }
}

/** Bundan derin iç içe HTML'de ayrıştırma durur, kalan alt ağacın yalnızca düz metni alınır (yığın taşmasını önler). */
const MAX_WALK_DEPTH = 200;

function walk(node: Node, out: Blocks, depth = 0): void {
  if (depth > MAX_WALK_DEPTH) {
    out.text(` ${textOf(node)} `);
    return;
  }
  if (node.nodeType === NodeType.TEXT_NODE) {
    out.text((node as TextNode).text);
    return;
  }
  if (node.nodeType !== NodeType.ELEMENT_NODE) return;
  const tag = tagOf(node);
  if (SKIP_TAGS.has(tag)) return;
  const heading = /^h([1-6])$/.exec(tag);
  if (heading) {
    const t = squash(textOf(node));
    const level = Number(heading[1]);
    if (t) out.push(level <= 3 ? `${"#".repeat(level)} ${t}` : t);
    return;
  }
  if (tag === "table") {
    out.push(tableToText(node as HTMLElement));
    return;
  }
  if (tag === "br") {
    out.text(" ");
    return;
  }
  const block = !INLINE.has(tag);
  if (tag === "li") out.marker("- ");
  else if (block) out.flush();
  for (const c of node.childNodes) walk(c, out, depth + 1);
  if (block) out.flush();
}

/** Bir HTML düğümünü (ya da belgeyi) başlık işaretli, bloklar boş satırla ayrılmış düz metne çevirir. */
export function nodeToText(root: Node): string {
  const out = new Blocks();
  walk(root, out);
  out.flush();
  return out.list.join("\n\n");
}

export function htmlToText(html: string): string {
  return nodeToText(parse(html));
}

/* ---------- DOCX ---------- */

const DOCX_STYLE_MAP = [
  "p[style-name='Başlık 1'] => h1:fresh",
  "p[style-name='Başlık 2'] => h2:fresh",
  "p[style-name='Başlık 3'] => h3:fresh",
  "p[style-name='Title'] => h1:fresh",
];

/** DOCX'in açılmış (sıkıştırılmamış) boyut üst sınırı; zip bombasına karşı. */
export const MAX_DOCX_UNCOMPRESSED_BYTES = 50 * 1024 * 1024;
const MAX_DOCX_ENTRIES = 20_000;
export const DOCX_TOO_BIG_ERROR = "DOCX dosyası açıldığında 50 MB'ı aşıyor; işlenemedi. Dosyayı küçültüp yeniden yükleyin.";
export const DOCX_INVALID_ERROR = "DOCX dosyası okunamadı (bozuk ya da geçersiz arşiv).";

/** ZIP "end of central directory" kaydının konumu; yoksa -1. */
function findEocd(data: Uint8Array, dv: DataView): number {
  for (let i = data.length - 22; i >= Math.max(0, data.length - 22 - 0xffff); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) return i;
  }
  return -1;
}

/**
 * ZIP merkezi dizinindeki BİLDİRİLEN açılmış boyutların toplamı (arşivi açmadan). Dizin okunamazsa -1.
 * Zip64 (0xFFFFFFFF) girdisi dev boyut sayılır. Bildirilen boyut yalan söyleyebilir (JSZip uyuşmazlığı
 * ancak tamamen açtıktan sonra yakalar); bu yüzden bu yalnızca ucuz ilk elemedir, gerçek boyut
 * `inflatedZipSize` ile sınırlı biçimde ölçülür.
 */
export function zipUncompressedSize(data: Uint8Array): number {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const eocd = findEocd(data, dv);
  if (eocd < 0) return -1;
  const count = dv.getUint16(eocd + 10, true);
  let pos = dv.getUint32(eocd + 16, true);
  if (count === 0xffff || pos === 0xffffffff || dv.getUint32(eocd + 12, true) === 0xffffffff) return -1; // ZIP64: desteklenmez
  if (count > MAX_DOCX_ENTRIES) return Number.POSITIVE_INFINITY;
  let total = 0;
  for (let n = 0; n < count; n++) {
    if (pos + 46 > data.length || dv.getUint32(pos, true) !== 0x02014b50) return -1;
    const size = dv.getUint32(pos + 24, true);
    total += size === 0xffffffff ? Number.POSITIVE_INFINITY : size;
    pos += 46 + dv.getUint16(pos + 28, true) + dv.getUint16(pos + 30, true) + dv.getUint16(pos + 32, true);
  }
  return total;
}

type ZipEntry = { flags: number; method: number; compressed: number; uncompressed: number; localAt: number };

/**
 * Merkezi dizini KATI okur: JSZip (mammoth) ile aynı EOCD'yi seçer ama JSZip'in hoşgörülü davrandığı her
 * durumu (farklı dizin okutabilecek her şüpheli yapıyı) DOCX_INVALID_ERROR ile reddeder:
 *  - EOCD'de 0xFFFF/0xFFFFFFFF alanı, sıfır olmayan disk numarası, ZIP64 locator (JSZip ZIP64'e geçer);
 *  - `cdOffset + cdSize == eocdPos` değilse (önde/arada ek veri; JSZip ofsetleri kaydırır);
 *  - dizinde yürünen girdi sayısı EOCD sayacına eşit değilse (JSZip imza bitene kadar okur);
 *  - aynı adlı (büyük/küçük harf duyarsız) çift girdi, unicode-path extra alanı (ad değiştirir).
 */
function readZipEntries(data: Uint8Array): ZipEntry[] {
  const bad = () => new Error(DOCX_INVALID_ERROR);
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const eocd = findEocd(data, dv);
  if (eocd < 0) throw bad();
  const disk = dv.getUint16(eocd + 4, true);
  const cdDisk = dv.getUint16(eocd + 6, true);
  const onDisk = dv.getUint16(eocd + 8, true);
  const count = dv.getUint16(eocd + 10, true);
  const cdSize = dv.getUint32(eocd + 12, true);
  const cdOffset = dv.getUint32(eocd + 16, true);
  if (disk === 0xffff || cdDisk === 0xffff || onDisk === 0xffff || count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) throw bad();
  if (disk !== 0 || cdDisk !== 0 || onDisk !== count) throw bad();
  if (eocd >= 20 && dv.getUint32(eocd - 20, true) === 0x07064b50) throw bad(); // ZIP64 locator
  if (count > MAX_DOCX_ENTRIES || cdOffset + cdSize !== eocd) throw bad();
  const entries: ZipEntry[] = [];
  const names = new Set<string>();
  let pos = cdOffset;
  while (pos + 4 <= eocd && dv.getUint32(pos, true) === 0x02014b50) {
    if (pos + 46 > eocd) throw bad();
    const nameLen = dv.getUint16(pos + 28, true);
    const extraLen = dv.getUint16(pos + 30, true);
    const commentLen = dv.getUint16(pos + 32, true);
    const end = pos + 46 + nameLen + extraLen + commentLen;
    if (end > eocd) throw bad();
    const name = Buffer.from(data.subarray(pos + 46, pos + 46 + nameLen)).toString("latin1").toLowerCase();
    if (names.has(name)) throw bad();
    names.add(name);
    // Extra alanları: 0x7075 (Info-ZIP unicode path) JSZip'te girdi adını değiştirebilir.
    for (let x = pos + 46 + nameLen; x + 4 <= pos + 46 + nameLen + extraLen; ) {
      if (dv.getUint16(x, true) === 0x7075) throw bad();
      x += 4 + dv.getUint16(x + 2, true);
    }
    entries.push({
      flags: dv.getUint16(pos + 8, true),
      method: dv.getUint16(pos + 10, true),
      compressed: dv.getUint32(pos + 20, true),
      uncompressed: dv.getUint32(pos + 24, true),
      localAt: dv.getUint32(pos + 42, true),
    });
    if (entries.length > MAX_DOCX_ENTRIES) throw bad();
    pos = end;
  }
  if (pos !== eocd || entries.length !== count) throw bad();
  return entries;
}

/**
 * ZIP girdilerini (deflate: yöntem 8, stored: yöntem 0) gerçekten açarak toplam açılmış boyutu ölçer.
 * Önce merkezi dizin `readZipEntries` ile katı doğrulanır (JSZip'in farklı dizin okumasına yol açacak
 * yapılar reddedilir); sonra her girdi `zlib.inflateRawSync` ile kalan bütçeyle (`maxOutputLength`) açılır,
 * bütçe aşılınca açma durur. Aşım için DOCX_TOO_BIG_ERROR, bozuk/şüpheli/desteklenmeyen yapı için
 * DOCX_INVALID_ERROR fırlatır. Her girdi ölçüldükten sonra bırakılır; bellekte en çok `limit` bayt tutulur.
 */
export function inflatedZipSize(data: Uint8Array, limit = MAX_DOCX_UNCOMPRESSED_BYTES): number {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const entries = readZipEntries(data);
  const cdOffset = dv.getUint32(findEocd(data, dv) + 16, true);
  let total = 0;
  for (const { flags, method, compressed, uncompressed, localAt } of entries) {
    if (compressed === 0xffffffff || localAt === 0xffffffff || uncompressed === 0xffffffff) throw new Error(DOCX_TOO_BIG_ERROR);
    if (flags & 1) throw new Error(DOCX_INVALID_ERROR); // şifreli
    // Sıkıştırılmış veri: yerel başlık (30) + ad + extra'dan sonra başlar (extra uzunluğu merkezi dizindekinden farklı olabilir).
    if (localAt + 30 > cdOffset || dv.getUint32(localAt, true) !== 0x04034b50) throw new Error(DOCX_INVALID_ERROR);
    const start = localAt + 30 + dv.getUint16(localAt + 26, true) + dv.getUint16(localAt + 28, true);
    if (start + compressed > cdOffset) throw new Error(DOCX_INVALID_ERROR);
    const raw = data.subarray(start, start + compressed);
    let actual: number;
    if (method === 0) {
      actual = compressed;
    } else if (method === 8) {
      if (compressed === 0) {
        actual = 0;
      } else {
        try {
          actual = inflateRawSync(raw, { maxOutputLength: Math.max(1, limit - total) }).length;
        } catch (e) {
          if ((e as { code?: string }).code === "ERR_BUFFER_TOO_LARGE") throw new Error(DOCX_TOO_BIG_ERROR);
          throw new Error(DOCX_INVALID_ERROR);
        }
      }
    } else {
      throw new Error(DOCX_INVALID_ERROR);
    }
    total += actual;
    if (total > limit) throw new Error(DOCX_TOO_BIG_ERROR);
    if (actual !== uncompressed) throw new Error(DOCX_INVALID_ERROR); // bildirilen boyut yalan
  }
  return total;
}

/** DOCX → başlık ve tablo yapısı korunmuş düz metin (mammoth HTML çıktısı üzerinden). */
export async function docxToText(data: Uint8Array): Promise<string> {
  const size = zipUncompressedSize(data);
  if (size < 0) throw new Error(DOCX_INVALID_ERROR);
  if (size > MAX_DOCX_UNCOMPRESSED_BYTES) throw new Error(DOCX_TOO_BIG_ERROR);
  // Bildirilen boyut yalan olabilir: mammoth'a (JSZip) vermeden önce gerçek açılmış boyut sınırla ölçülür.
  inflatedZipSize(data);
  const { value } = await mammoth.convertToHtml(
    { buffer: Buffer.from(data) },
    { styleMap: DOCX_STYLE_MAP, convertImage: mammoth.images.imgElement(async () => ({ src: "" })) },
  );
  return htmlToText(value);
}

/* ---------- Metin kodlaması ---------- */

export type DecodedText = { text: string; encoding: "utf-8" | "utf-16le" | "utf-16be" | "windows-1254"; note: string | null };

const ENCODING_LABEL: Record<DecodedText["encoding"], string> = {
  "utf-8": "UTF-8",
  "utf-16le": "UTF-16 (LE)",
  "utf-16be": "UTF-16 (BE)",
  "windows-1254": "Windows-1254 (Türkçe)",
};

/**
 * .txt/.md baytlarını çözer. BOM'a bakar; UTF-8 geçerliyse onu kullanır. Geçersizse ve
 * geçersiz baytlar geçerli çok baytlı dizilerden belirgin çoksa (Windows-1254'te "ğüşıöç"
 * baytları UTF-8 olarak geçersizdir) Windows-1254 ile okur. UTF-8 dışı seçimler `note` ile bildirilir.
 */
export function decodeText(data: Uint8Array): DecodedText {
  const done = (text: string, encoding: DecodedText["encoding"]): DecodedText => ({
    text,
    encoding,
    note: encoding === "utf-8" ? null : `Metin ${ENCODING_LABEL[encoding]} kodlamasıyla okundu.`,
  });
  if (data[0] === 0xff && data[1] === 0xfe) return done(new TextDecoder("utf-16le").decode(data), "utf-16le");
  if (data[0] === 0xfe && data[1] === 0xff) return done(new TextDecoder("utf-16be").decode(data), "utf-16be");
  try {
    return done(new TextDecoder("utf-8", { fatal: true }).decode(data), "utf-8");
  } catch {
    // geçersiz UTF-8: aşağıda oranla karar verilir
  }
  const lossy = new TextDecoder("utf-8").decode(data);
  let invalid = 0;
  let multibyte = 0;
  for (const ch of lossy) {
    if (ch === "�") invalid++;
    else if (ch.charCodeAt(0) > 0x7f) multibyte++;
  }
  if (multibyte >= invalid * 4) {
    return { text: lossy, encoding: "utf-8", note: "Metindeki bazı baytlar geçerli UTF-8 değildi, atlandı." };
  }
  return done(new TextDecoder("windows-1254").decode(data), "windows-1254");
}

/* ---------- PDF ---------- */

export const SCANNED_PDF_WARNING = "Metin bulunamadı, taranmış PDF olabilir (OCR desteklenmiyor).";
const MIN_CHARS_PER_PAGE = 20;

/** Sayfa metinlerini birleştirir. Hiç metin yoksa hata, sayfa başına 20 karakterden azsa uyarı döner. */
export function pdfPagesToText(pages: string[]): { text: string; warning: string | null } {
  const text = pages.map((p) => p.trim()).filter(Boolean).join("\n\n");
  if (!text) throw new Error(SCANNED_PDF_WARNING);
  const count = Math.max(1, pages.length);
  return { text, warning: text.replace(/\s+/g, "").length / count < MIN_CHARS_PER_PAGE ? SCANNED_PDF_WARNING : null };
}
