import { redirect } from "next/navigation";
import { limitMessage } from "./form-limits";

export function str(fd: FormData, name: string, max = 20000): string {
  const v = fd.get(name);
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

/** `str` gibi ama sınırı aşan girdiyi sessizce kesmez; kullanıcıya hata gösterip `back` sayfasına döner. */
export function strStrict(fd: FormData, name: string, max: number, label: string, back: string): string {
  const v = fd.get(name);
  // Tarayıcı satır sonlarını CRLF gönderir; sayaçla aynı sayılsın diye LF'ye indirilir.
  const text = typeof v === "string" ? v.replace(/\r\n/g, "\n").trim() : "";
  const msg = limitMessage(label, max, text.length);
  if (msg) fail(back, msg);
  return text;
}

export function num(fd: FormData, name: string, fallback: number, min = -Infinity, max = Infinity): number {
  const n = Number(str(fd, name).replace(",", "."));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function bool(fd: FormData, name: string): boolean {
  const v = fd.get(name);
  return v === "on" || v === "true" || v === "1";
}

/** Dizi indeksi üst sınırı: seyrek dev dizi ("captions.4294967294") event loop'u bloklamasın. */
const MAX_INDEX = 199;
/** Nesne prototipine ulaştıran parçalar; bunları içeren alan tamamen atlanır. */
const UNSAFE_PARTS = new Set(["__proto__", "constructor", "prototype"]);

/**
 * "captions.0.title" gibi noktalı alan adlarını iç içe nesneye çevirir.
 * Sayısal parçalar dizi indeksidir; 0–199 dışı indeks, prototipe ulaşan parça, dizide sayısal olmayan anahtar
 * ve nesne olmayan ara düğüm içeren alanlar atlanır.
 * Yalnızca verilen önekle başlayan alanlar alınır.
 */
export function formToObject(fd: FormData, prefix: string): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  for (const [key, value] of fd.entries()) {
    if (typeof value !== "string" || !key.startsWith(prefix + ".")) continue;
    const path = key.slice(prefix.length + 1).split(".");
    // Tehlikeli ya da aşırı büyük indeksli alan, ağaca hiçbir şey yazmadan tümden atlanır.
    if (path.some((p) => UNSAFE_PARTS.has(p) || (/^\d+$/.test(p) && Number(p) > MAX_INDEX))) continue;
    let node: Record<string | number, unknown> = root;
    for (let i = 0; i < path.length; i++) {
      const part = path[i];
      const isIndex = /^\d+$/.test(part);
      // Dizi konteynerine yalnızca sayısal indeks yazılır ("length" gibi anahtarlar dizi boyunu bozar).
      if (Array.isArray(node) && !isIndex) break;
      const k = isIndex ? Number(part) : part;
      if (i === path.length - 1) {
        node[k] = value.trim();
        break;
      }
      // Kalıtılan değil, yalnızca kendi anahtarına bakılır.
      if (!Object.hasOwn(node, k)) node[k] = /^\d+$/.test(path[i + 1]) ? [] : {};
      const next = node[k];
      // Ara düğüm nesne/dizi değilse (ör. önce "a=metin", sonra "a.b") alan atlanır.
      if (typeof next !== "object" || next === null) break;
      node = next as Record<string | number, unknown>;
    }
  }
  return root;
}

function withParam(path: string, key: string, message: string) {
  return `${path}${path.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(message)}`;
}

/** Başarılı işlemden sonra sayfaya bir onay mesajıyla dön. */
export function done(path: string, message: string): never {
  redirect(withParam(path, "ok", message));
}

/** Kullanıcıya düzeltebileceği bir hata göster. */
export function fail(path: string, message: string): never {
  redirect(withParam(path, "hata", message));
}

export type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export function param(sp: Record<string, string | string[] | undefined>, key: string): string {
  const v = sp[key];
  return (Array.isArray(v) ? v[0] : v) ?? "";
}
