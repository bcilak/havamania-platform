/*
 * İstemciden gelen konum bilgisini temizler. Konum adı prompt'a girdiği için
 * serbest metin olarak güvenilmez: satır sonu, başlık (#), tırnak, etiket gibi
 * karakterler atılır. Widget ve mobil köprü aynı fonksiyonu kullanır.
 */

export type UserLocation = { lat: number; lon: number; name?: string } | null | undefined;

const NAME_MAX = 60;

function num(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim()) return Number(v);
  return NaN;
}

/** Konum adı: NFC, tek satır, yalnızca harf/rakam/boşluk ve . , ' ( ) / - ; en çok 60 karakter. */
export function sanitizeLocationName(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const name = raw
    .normalize("NFC")
    .replace(/[’‘`´]/g, "'")
    .replace(/[\s\p{C}]+/gu, " ")
    .replace(/[^\p{L}\p{N} .,'()/-]/gu, "")
    .replace(/ {2,}/g, " ")
    .trim()
    .slice(0, NAME_MAX)
    .trim();
  return name || undefined;
}

/** Geçersiz ya da aralık dışı koordinatta null döner. */
export function parseLocation(raw: unknown): UserLocation {
  if (!raw || typeof raw !== "object") return null;
  const l = raw as { lat?: unknown; lon?: unknown; name?: unknown };
  const lat = num(l.lat);
  const lon = num(l.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon, name: sanitizeLocationName(l.name) };
}
