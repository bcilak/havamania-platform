import { redirect } from "next/navigation";

export function str(fd: FormData, name: string, max = 20000): string {
  const v = fd.get(name);
  return typeof v === "string" ? v.trim().slice(0, max) : "";
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

/**
 * "captions.0.title" gibi noktalı alan adlarını iç içe nesneye çevirir.
 * Sayısal parçalar dizi indeksidir. Yalnızca verilen önekle başlayan alanlar alınır.
 */
export function formToObject(fd: FormData, prefix: string): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  for (const [key, value] of fd.entries()) {
    if (typeof value !== "string" || !key.startsWith(prefix + ".")) continue;
    const path = key.slice(prefix.length + 1).split(".");
    let node: Record<string, unknown> | unknown[] = root;
    path.forEach((part, i) => {
      const last = i === path.length - 1;
      const nextIsIndex = !last && /^\d+$/.test(path[i + 1]);
      const k = /^\d+$/.test(part) ? Number(part) : part;
      const container = node as Record<string | number, unknown>;
      if (last) container[k] = value.trim();
      else {
        container[k] ??= nextIsIndex ? [] : {};
        node = container[k] as Record<string, unknown>;
      }
    });
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
