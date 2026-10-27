import { detectImageFormat, formatForExt, ImageRejectedError, inspectMetadata, mediaTypeForFormat, sanitizeImage, type OutputFormat } from "./image-sanitize";

/*
 * Eski fotoğrafların geçiş kararı (saf fonksiyon; DB ya da depo yok).
 * Biçim anahtarın uzantısından değil İÇERİKTEN anlaşılır (eski anahtarlar .bin/.pdf/.svg olabilir). Anahtar hiç değişmez,
 * yeni dosya oluşmaz: temizlenen içerik aynı anahtara yazılır. Uzantısı bilinen bir fotoğraf uzantısıysa (jpg/png/webp/gif)
 * çıktı o biçimde kodlanır; bilinmeyen uzantıda içeriğin kendi biçimi korunur (AVIF -> WebP).
 */

export type PhotoOutcome = "already_clean" | "cleaned" | "unsupported" | "too_large" | "failed";

export type PhotoResult = {
  outcome: PhotoOutcome;
  /** `unsupported` için `heic`; `failed` için `unreadable` (tanınmayan, bozuk ya da okunamayan içerik). */
  reason?: "heic" | "unreadable";
  /** Yalnızca `cleaned` için: yerine yazılacak temiz baytlar. */
  data?: Uint8Array;
  /** `cleaned` ve `already_clean` için: dosyanın (yazıldıktan sonraki) gerçek medya türü. */
  mediaType?: string;
  /** Orijinalde GPS konumu vardı mı (koordinat okunmaz). */
  hadGps: boolean;
  /** Anahtar uzantısı içeriğin biçimiyle uyuşmuyor (ör. .bin/.pdf/.svg anahtarlı JPEG). */
  extMismatch: boolean;
  beforeBytes: number;
  afterBytes: number;
};

export async function processPhoto(bytes: Uint8Array, opts: { keyExt: string; maxPixels?: number }): Promise<PhotoResult> {
  const base = { hadGps: false, extMismatch: false, beforeBytes: bytes.byteLength, afterBytes: bytes.byteLength };
  const detected = detectImageFormat(bytes);
  if (!detected) return { ...base, outcome: "failed", reason: "unreadable" };
  if (detected === "heif") return { ...base, outcome: "unsupported", reason: "heic" };
  const extFormat: OutputFormat | null = formatForExt(opts.keyExt);
  const extMismatch = extFormat !== detected;
  try {
    let hadGps = false;
    if (detected !== "avif") {
      const meta = await inspectMetadata(bytes);
      hadGps = meta.hadGps;
      if (meta.clean) return { ...base, extMismatch, outcome: "already_clean", mediaType: mediaTypeForFormat(detected) };
    }
    const out = await sanitizeImage(bytes, { maxPixels: opts.maxPixels, outputFormat: extFormat ?? undefined });
    return { ...base, extMismatch, outcome: "cleaned", data: out.data, mediaType: out.mediaType, hadGps, afterBytes: out.data.byteLength };
  } catch (err) {
    if (err instanceof ImageRejectedError && err.code === "pixels") return { ...base, extMismatch, outcome: "too_large" };
    if (err instanceof ImageRejectedError && err.code === "heic") return { ...base, outcome: "unsupported", reason: "heic" };
    return { ...base, extMismatch, outcome: "failed", reason: "unreadable" };
  }
}

/**
 * DB satırı dosyanın gerçek durumuyla uyuşmuyor mu? Önceki bir çalıştırmada `put` başarılı olup `db.update` başarısız
 * olduysa dosya temiz ama satır eski kalır; ikinci çalıştırma `already_clean` derken bu fonksiyon satırın düzeltilmesini ister.
 */
export function rowNeedsUpdate(row: { size: number; mediaType: string }, r: PhotoResult): boolean {
  if ((r.outcome !== "already_clean" && r.outcome !== "cleaned") || !r.mediaType) return false;
  return row.size !== r.afterBytes || row.mediaType !== r.mediaType;
}
