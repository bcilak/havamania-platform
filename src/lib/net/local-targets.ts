import net from "node:net";

/*
 * Yerel test gevşetmesi. SSRF korumaları (safe-fetch, api-url-guard) üretimde sıkıdır;
 * smoke/e2e testleri ise 127.0.0.1'deki sahte servislere (http) ulaşmak zorundadır.
 *
 * Gevşetme YALNIZCA iki koşul birlikte doğruysa etkindir:
 *   1. ALLOW_LOCAL_TARGETS=1 (veya "true") ayarlı,
 *   2. APP_URL'nin ana makinesi loopback (localhost, *.localhost, 127.0.0.0/8, ::1).
 * APP_URL canlı bir alan adı iken değişken ayarlı olsa bile hiçbir şey gevşemez.
 *
 * Gevşeme yalnızca loopback hedefleri açar (http dahil). Metadata/link-local adresleri,
 * özel ağlar ve http/https dışı şemalar her durumda reddedilmeye devam eder.
 */

type Env = Record<string, string | undefined>;

const stripHost = (h: string) => h.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();

/** Ana makine adı veya IP literal'i loopback mu? (localhost, *.localhost, 127.0.0.0/8, ::1) */
export function isLoopbackHost(host: string): boolean {
  const h = stripHost(host);
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  const kind = net.isIP(h);
  if (kind === 4) return h.startsWith("127.");
  if (kind === 6) return h === "::1" || h === "0:0:0:0:0:0:0:1";
  return false;
}

/** Çözümlenmiş bir adres loopback mu? (isim -> IP sonrası doğrulama için) */
export const isLoopbackAddress = (ip: string): boolean => net.isIP(stripHost(ip)) !== 0 && isLoopbackHost(ip);

/** Gevşetme etkin mi? Karar yalnızca burada verilir. */
export function localTargetsAllowed(env: Env = process.env): boolean {
  const flag = (env.ALLOW_LOCAL_TARGETS ?? "").trim().toLowerCase();
  if (flag !== "1" && flag !== "true") return false;
  try {
    return isLoopbackHost(new URL(env.APP_URL ?? "").hostname);
  } catch {
    return false;
  }
}

let warned = false;

/** Sunucu açılışında gevşetme etkinse bir kez uyarır. */
export function warnIfLocalTargetsAllowed(env: Env = process.env): void {
  if (warned || !localTargetsAllowed(env)) return;
  warned = true;
  console.warn("[güvenlik] ALLOW_LOCAL_TARGETS etkin: loopback hedeflere (127.0.0.1/localhost, http) izin veriliyor. Yalnızca yerel test içindir.");
}
