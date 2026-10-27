import sharp from "sharp";

/*
 * Kullanıcı fotoğraflarının meta verisini (EXIF/GPS, XMP, IPTC, ICC, PNG metin parçaları) temizler.
 * Saf fonksiyonlar: DB ya da depo yok. Gerçek biçim magic byte ile doğrulanır, görsel yeniden
 * kodlanır; sharp çıktıya meta veri yazmadığı için (withMetadata/keep* çağrılmaz) geriye yalnızca piksel kalır.
 */

// Önbellek birikmesi sunucu belleğini şişirmesin.
sharp.cache(false);
// Her çözme/kodlama işi tek iş parçacığı kullanır; eşzamanlılık image-limiter.ts ile sınırlıdır (CPU ve bellek tavanı).
sharp.concurrency(1);

export type ImageFormat = "jpeg" | "png" | "webp" | "gif" | "heif" | "avif";
export type OutputFormat = Exclude<ImageFormat, "heif" | "avif">;
/** Çıktı biçimi istenmediğinde AVIF'in yeniden kodlandığı biçim (alfa kanalını korur). */
const AVIF_OUTPUT: OutputFormat = "webp";

export const IMAGE_LIMITS = { maxPixels: 50_000_000, maxEdge: 2560, jpegQuality: 85, webpQuality: 85, timeoutSeconds: 15 };

const OUTPUT: Record<OutputFormat, { mediaType: string; ext: string }> = {
  jpeg: { mediaType: "image/jpeg", ext: "jpg" },
  png: { mediaType: "image/png", ext: "png" },
  webp: { mediaType: "image/webp", ext: "webp" },
  gif: { mediaType: "image/gif", ext: "gif" },
};

/** Hata kodu route'ta Türkçe mesaja çevrilir; mesajda dosya içeriği ya da meta veri bulunmaz. */
export class ImageRejectedError extends Error {
  constructor(public code: "format" | "heic" | "pixels" | "decode") {
    super(`Fotoğraf reddedildi: ${code}`);
    this.name = "ImageRejectedError";
  }
}

/** Uzantıdan (jpg, jpeg, png, webp, gif) çıktı biçimi. Diğerleri null. */
export function formatForExt(ext: string): OutputFormat | null {
  const e = ext.toLowerCase();
  if (e === "jpg" || e === "jpeg") return "jpeg";
  return e === "png" || e === "webp" || e === "gif" ? e : null;
}

/** Çıktı biçiminin medya türü (image/jpeg, ...). */
export function mediaTypeForFormat(format: OutputFormat): string {
  return OUTPUT[format].mediaType;
}

/** Medya türünden (image/jpeg, ...) çıktı biçimi. Diğerleri null. */
export function formatForMediaType(mediaType: string): OutputFormat | null {
  const hit = (Object.entries(OUTPUT) as [OutputFormat, { mediaType: string }][]).find(([, o]) => o.mediaType === mediaType.split(";")[0].trim().toLowerCase());
  return hit?.[0] ?? null;
}

const ascii = (b: Uint8Array, from: number, to: number) => String.fromCharCode(...b.subarray(from, to));
const startsWith = (b: Uint8Array, sig: number[]) => b.length >= sig.length && sig.every((v, i) => b[i] === v);

/** `ftyp` kutusundaki marka listesi (ana marka + uyumlu markalar). `ftyp` yoksa null. */
function ftypBrands(b: Uint8Array): string[] | null {
  if (b.length < 12 || ascii(b, 4, 8) !== "ftyp") return null;
  const size = new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(0);
  const end = Math.min(b.length, 256, Math.max(size, 12));
  const brands = [ascii(b, 8, 12)];
  for (let i = 16; i + 4 <= end; i += 4) brands.push(ascii(b, i, i + 4));
  return brands;
}

const HEIF_MAJOR = ["heic", "heix", "hevc", "hevx", "mif1", "msf1"];
const HEIF_COMPAT = ["heic", "heix", "hevc", "hevx"];

/** İlk baytlara bakarak biçimi söyler. SVG ve bilinmeyen her şey null. */
export function detectImageFormat(bytes: Uint8Array): ImageFormat | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "jpeg";
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") return "webp";
  if (bytes.length >= 6 && (ascii(bytes, 0, 6) === "GIF87a" || ascii(bytes, 0, 6) === "GIF89a")) return "gif";
  const brands = ftypBrands(bytes);
  if (brands) {
    // AVIF dosyaları çoğu kez `mif1` da taşır; AV1 markası varsa HEIC sayılmaz.
    if (brands.some((x) => x === "avif" || x === "avis")) return "avif";
    if (HEIF_MAJOR.includes(brands[0]) || brands.slice(1).some((x) => HEIF_COMPAT.includes(x))) return "heif";
  }
  return null;
}

function toRejected(err: unknown): ImageRejectedError {
  if (err instanceof ImageRejectedError) return err;
  const msg = err instanceof Error ? err.message : "";
  // Magic byte izinli ama içerik sharp'ın tanıdığı bir biçim değilse: biçim uyuşmazlığı.
  if (/unsupported image format/i.test(msg)) return new ImageRejectedError("format");
  return new ImageRejectedError(/pixel limit/i.test(msg) ? "pixels" : "decode");
}

export type SanitizedImage = {
  data: Uint8Array;
  format: OutputFormat;
  mediaType: string;
  ext: string;
  width: number;
  height: number;
  pages: number;
};

/** Doğrular, EXIF yönünü uygular, küçültür ve meta verisiz yeniden kodlar. Herhangi bir adım başarısız olursa ImageRejectedError fırlatır. */
export async function sanitizeImage(
  bytes: Uint8Array,
  opts: { maxPixels?: number; outputFormat?: OutputFormat } = {},
): Promise<SanitizedImage> {
  const maxPixels = opts.maxPixels ?? IMAGE_LIMITS.maxPixels;
  const detected = detectImageFormat(bytes);
  if (!detected) throw new ImageRejectedError("format");
  if (detected === "heif") throw new ImageRejectedError("heic");
  const outFormat = opts.outputFormat ?? (detected === "avif" ? AVIF_OUTPUT : detected);

  try {
    // Çok kareyi yalnızca hedef biçim taşıyabiliyorsa (GIF/WebP) oku; JPEG/PNG çıktıda yalnızca ilk kare alınır
    // (animasyonu tüm karelerle çözüp ilk kareyi atmak boşa bellek/CPU harcar).
    const animated = (detected === "gif" || detected === "webp") && (outFormat === "gif" || outFormat === "webp");
    const img = sharp(bytes, { limitInputPixels: maxPixels, failOn: "error", animated }).timeout({ seconds: IMAGE_LIMITS.timeoutSeconds });
    const meta = await img.metadata();
    // sharp'ın kendi koklaması magic byte sonucuyla örtüşmeli. AVIF için sharp "heif" bildirir; yalnızca AV1 sıkıştırması kabul edilir (HEVC çözülemez).
    if (meta.format !== (detected === "avif" ? "heif" : detected)) throw new ImageRejectedError("format");
    if (detected === "avif" && meta.compression !== "av1") throw new ImageRejectedError("format");
    // Animasyonda yükseklik tüm karelerin toplamıdır: kare sayısıyla şişirme de sınırlanır.
    if ((meta.width ?? 0) * (meta.height ?? 0) > maxPixels) throw new ImageRejectedError("pixels");

    const pipeline = img.autoOrient().resize({ width: IMAGE_LIMITS.maxEdge, height: IMAGE_LIMITS.maxEdge, fit: "inside", withoutEnlargement: true });
    const encoded =
      outFormat === "jpeg"
        ? pipeline.jpeg({ quality: IMAGE_LIMITS.jpegQuality })
        : outFormat === "webp"
          ? pipeline.webp({ quality: IMAGE_LIMITS.webpQuality })
          : outFormat === "gif"
            ? pipeline.gif()
            : pipeline.png();
    const { data, info } = await encoded.toBuffer({ resolveWithObject: true });

    // Fail-closed: çıktıda hâlâ meta veri varsa saklama.
    if (!(await inspectMetadata(data)).clean) throw new ImageRejectedError("decode");

    const pages = info.pages ?? 1;
    return { data, format: outFormat, ...OUTPUT[outFormat], width: info.width, height: info.pageHeight ?? info.height / pages, pages };
  } catch (err) {
    throw toRejected(err);
  }
}

/** EXIF tamponunda GPS IFD işaretçisi (IFD0 etiketi 0x8825) var mı? Yalnızca boolean; koordinat okunmaz. */
function exifHasGps(exif: Uint8Array): boolean {
  let t = 0;
  while (t + 8 <= exif.length && !((exif[t] === 0x49 && exif[t + 1] === 0x49 && exif[t + 2] === 0x2a) || (exif[t] === 0x4d && exif[t + 1] === 0x4d && exif[t + 3] === 0x2a))) t++;
  if (t + 8 > exif.length) return false;
  const le = exif[t] === 0x49;
  const dv = new DataView(exif.buffer, exif.byteOffset + t, exif.length - t);
  const ifd = dv.getUint32(4, le);
  if (ifd + 2 > dv.byteLength) return false;
  const count = dv.getUint16(ifd, le);
  for (let i = 0; i < count && ifd + 2 + (i + 1) * 12 <= dv.byteLength; i++) {
    if (dv.getUint16(ifd + 2 + i * 12, le) === 0x8825) return true;
  }
  return false;
}

/**
 * JPEG'de sharp'ın metadata() alanlarında görünmeyen kalıntılar: COM (yorum) segmenti, JFIF/Adobe dışındaki APPn
 * segmentleri (APP1 EXIF/XMP, APP2 MPF/ICC, APP13 IPTC...), EOI sonrası eklenmiş veri. Bozuk/kesik yapı da "kalıntılı" sayılır.
 */
function jpegHasExtras(b: Uint8Array): boolean {
  let i = 2;
  while (i < b.length) {
    if (b[i] !== 0xff) return true; // beklenmeyen bayt
    while (b[i + 1] === 0xff) i++; // dolgu baytları
    const m = b[i + 1];
    if (m === undefined) return true;
    i += 2;
    if (m === 0xd9) return i < b.length; // EOI: sonrasında veri varsa kalıntı
    if (m === 0x01 || (m >= 0xd0 && m <= 0xd8)) continue; // uzunluksuz işaretçiler
    if (i + 2 > b.length) return true;
    const len = (b[i] << 8) | b[i + 1];
    if (len < 2 || i + len > b.length) return true;
    if (m === 0xfe) return true; // COM
    if (m >= 0xe1 && m <= 0xef && !(m === 0xee && ascii(b, i + 2, i + 7) === "Adobe")) return true;
    if (m === 0xe0 && ascii(b, i + 2, i + 7) !== "JFIF\x00") return true; // JFXX küçük resmi vb.
    i += len;
    if (m === 0xda) {
      // Taranmış veri: sıfır baytı ile kaçışlanmış FF ve RSTn dışındaki ilk işaretçiye kadar atla.
      while (i + 1 < b.length && !(b[i] === 0xff && b[i + 1] !== 0x00 && b[i + 1] !== 0xff && !(b[i + 1] >= 0xd0 && b[i + 1] <= 0xd7))) i++;
      if (i + 1 >= b.length) return true; // EOI yok: kesik
    }
  }
  return true; // EOI görülmedi
}

/** sharp'ın yazdığı ve görüntüyü tanımlayan PNG parçaları (kritik + şeffaflık/çözünürlük/renk/animasyon). Diğer her parça (tEXt, zTXt, iTXt, eXIf, iCCP, tIME, özel ancillary...) kalıntıdır. */
const PNG_SAFE_CHUNKS = new Set(["IHDR", "PLTE", "IDAT", "IEND", "tRNS", "pHYs", "gAMA", "cHRM", "sRGB", "sBIT", "bKGD", "hIST", "acTL", "fcTL", "fdAT"]);

/** PNG'de güvenli listede olmayan parça, IEND sonrası veri ya da bozuk/kesik yapı var mı? */
function pngHasExtras(b: Uint8Array): boolean {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let i = 8;
  while (i + 12 <= b.length) {
    const len = dv.getUint32(i);
    const type = ascii(b, i + 4, i + 8);
    if (i + 12 + len > b.length || !PNG_SAFE_CHUNKS.has(type)) return true;
    i += 12 + len;
    if (type === "IEND") return i < b.length;
  }
  return true; // IEND görülmedi
}

/** GIF alt blok zincirinin bitişi (sonraki konum); kesikse -1. */
function gifSkipSubBlocks(b: Uint8Array, p: number): number {
  while (p < b.length) {
    const n = b[p];
    p += 1 + n;
    if (n === 0) return p <= b.length ? p : -1;
  }
  return -1;
}

/**
 * GIF'te yorum (0xFE), düz metin (0x01), NETSCAPE2.0/ANIMEXTS1.0 dışındaki uygulama uzantıları (XMP DataXMP dahil),
 * trailer sonrası veri ya da bozuk/kesik yapı var mı? Grafik denetim ve döngü uzantıları yalnızca beklenen boyutta kabul edilir.
 */
function gifHasExtras(b: Uint8Array): boolean {
  if (b.length < 14) return true;
  let i = 13;
  if (b[10] & 0x80) i += 3 * (1 << ((b[10] & 7) + 1));
  while (i < b.length) {
    const t = b[i];
    if (t === 0x3b) return i + 1 < b.length; // trailer: sonrasında veri varsa kalıntı
    if (t === 0x2c) {
      if (i + 10 > b.length) return true;
      const flags = b[i + 9];
      i += 10;
      if (flags & 0x80) i += 3 * (1 << ((flags & 7) + 1));
      i = gifSkipSubBlocks(b, i + 1); // LZW en küçük kod boyutu + görüntü verisi
    } else if (t === 0x21) {
      const label = b[i + 1];
      if (label === 0xf9) {
        if (b[i + 2] !== 4 || b[i + 7] !== 0) return true; // grafik denetim: 4 baytlık blok + sonlandırıcı
        i += 8;
      } else if (label === 0xff) {
        const id = b[i + 2] === 11 ? ascii(b, i + 3, i + 14) : "";
        if ((id !== "NETSCAPE2.0" && id !== "ANIMEXTS1.0") || b[i + 14] !== 3 || b[i + 18] !== 0) return true; // döngü sayısı: 3 baytlık blok
        i += 19;
      } else return true; // 0xFE yorum, 0x01 düz metin, bilinmeyen
    } else return true;
    if (i < 0 || i > b.length) return true;
  }
  return true; // trailer görülmedi
}

/** Meta veri kalıntısı var mı? `clean`: exif/xmp/iptc/icc yok, yön yok ya da 1, JPEG'de COM/APPn/EOI sonrası veri yok, PNG'de güvenli listede olmayan parça/IEND sonrası veri yok, GIF'te yorum/uygulama uzantısı/trailer sonrası veri yok. */
export async function inspectMetadata(bytes: Uint8Array): Promise<{ clean: boolean; hadGps: boolean; format: string | undefined }> {
  const m = await sharp(bytes).metadata();
  const clean =
    !m.exif && !m.xmp && !m.iptc && !m.icc && (m.orientation === undefined || m.orientation === 1) && !m.comments?.length && !(m.format === "jpeg" && jpegHasExtras(bytes)) && !(m.format === "png" && pngHasExtras(bytes)) && !(m.format === "gif" && gifHasExtras(bytes));
  return { clean, hadGps: m.exif ? exifHasGps(m.exif) : false, format: m.format };
}

/** Eski dosyalar için: temizse aynı baytlar, değilse meta verisiz yeniden kodlanmış hâli (yalnızca bellekte). Hata fırlatabilir. */
export async function ensureClean(bytes: Uint8Array, mediaType: string): Promise<Uint8Array> {
  const detected = detectImageFormat(bytes);
  if (!detected) throw new ImageRejectedError("format");
  if (detected === "heif") throw new ImageRejectedError("heic");
  try {
    if (detected !== "avif" && (await inspectMetadata(bytes)).clean) return bytes;
  } catch (err) {
    throw toRejected(err);
  }
  return (await sanitizeImage(bytes, { outputFormat: formatForMediaType(mediaType) ?? undefined })).data;
}

/**
 * Sunum için: uzantıya ve depodaki türe bakmadan içeriği koklar; çıktı türü içeriğin (temizlenmiş çıktının) biçiminden gelir.
 * Tanınmayan, temizlenemeyen biçim ve HEIC için ImageRejectedError fırlatır.
 */
export async function cleanForServing(bytes: Uint8Array): Promise<{ data: Uint8Array; mediaType: string }> {
  const detected = detectImageFormat(bytes);
  if (!detected) throw new ImageRejectedError("format");
  if (detected === "heif") throw new ImageRejectedError("heic");
  try {
    if (detected !== "avif" && (await inspectMetadata(bytes)).clean) return { data: bytes, mediaType: OUTPUT[detected].mediaType };
  } catch (err) {
    throw toRejected(err);
  }
  const out = await sanitizeImage(bytes);
  return { data: out.data, mediaType: out.mediaType };
}
