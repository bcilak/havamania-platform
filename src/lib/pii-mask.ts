import { maskQuestionPii } from "./gaps";

const DOT = "••••";

/** Konum/koordinat/kimlik taşıyan JSON alanları (`normKey` ile karşılaştırılır); altındaki değerin tamamı maskelenir. */
const SENSITIVE_KEYS = new Set([
  "lat",
  "lon",
  "lng",
  "long",
  "latitude",
  "longitude",
  "location",
  "loc",
  "coords",
  "coordinates",
  "geo",
  "position",
  "q",
  "query",
  "city",
  "district",
  "town",
  "address",
  "place",
  "enlem",
  "boylam",
  "konum",
  "koordinat",
  "il",
  "ilce",
  "mahalle",
  "adres",
  "semt",
  "sokak",
  "posta",
  "telefon",
  "eposta",
  "ad",
  "soyad",
]);

/** Anahtarı küçük harfe, aksansız ve yalnız harf/rakama indirger ("İlçe" -> "ilce", "e-posta" -> "eposta"). */
function normKey(k: string): string {
  return k.toLocaleLowerCase("tr").normalize("NFD").replace(/\p{M}/gu, "").replace(/ı/g, "i").replace(/[^a-z0-9]/g, "");
}

/** Ondalık kısmı 3+ haneli sayı koordinat benzeri sayılır (21.5 sıcaklık kalır, 41.0082 maskelenir). */
function isCoordLike(n: number): boolean {
  return Number.isFinite(n) && /\.\d{3,}/.test(String(n));
}

/**
 * `pii` yetkisi olmayan roller için serbest metin maskesi: e-posta, uzun rakam dizisi (telefon, kimlik no)
 * ve konum/koordinat (ondalıklı enlem-boylam çifti, "enlem 41.01", derece-dakika). Metin okunabilir kalır.
 * Tüm kalıplarda tekrarlar sınırlıdır (ReDoS yok). Sunucuda uygulanmalı; istemciye ham değer gitmemeli.
 */
export function maskPii(text: string): string {
  return maskQuestionPii(
    text
      .replace(/\b(enlem|boylam|lat|lon|lng|latitude|longitude)\b[\s:=]{0,3}-?\d{1,3}(?:[.,]\d{1,12})?/gi, (_m, label: string) => `${label} ${DOT}`)
      .replace(/-?\d{1,3}[.,]\d{2,12}[ \t]{0,2}[,;/][ \t]{0,2}-?\d{1,3}[.,]\d{2,12}/g, DOT)
      .replace(/\d{1,3}[ \t]?°[ \t]?\d{1,2}[ \t]?['′][^\s]{0,12}/g, DOT)
      .replace(/-?\d{1,3}\.\d{4,12}/g, DOT),
  );
}

/**
 * Araç çağrısı girdi/çıktısı (JSON) için maske: konum/koordinat/adres/kimlik alanlarının değeri tümüyle (sayı, dizi,
 * nesne dahil), koordinat benzeri ondalıklı sayılar anahtardan bağımsız, diğer metin değerleri `maskPii` ile
 * maskelenir. Yeni nesne döner; girdi değişmez. Derinlik/boyut sınırlıdır.
 */
export function maskToolPayload(value: unknown): unknown {
  let budget = 5000;
  const walk = (v: unknown, depth: number): unknown => {
    if (--budget < 0 || depth > 12) return DOT;
    if (typeof v === "string") return maskPii(v);
    if (typeof v === "number") return isCoordLike(v) ? DOT : v;
    if (Array.isArray(v)) return v.map((x) => walk(x, depth + 1));
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
        out[k] = SENSITIVE_KEYS.has(normKey(k)) && x != null ? DOT : walk(x, depth + 1);
      }
      return out;
    }
    return v;
  };
  return walk(value, 0);
}

/** Rol `pii` yetkisine sahipse metni olduğu gibi, değilse maskeli döndürür. */
export function piiText(pii: boolean, text: string): string {
  return pii ? text : maskPii(text);
}

/** Rol `pii` yetkisine sahipse araç JSON'unu olduğu gibi, değilse maskeli döndürür. */
export function piiPayload(pii: boolean, value: unknown): unknown {
  return pii ? value : maskToolPayload(value);
}
