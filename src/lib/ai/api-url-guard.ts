import { isLoopbackHost, localTargetsAllowed } from "@/lib/net/local-targets";
import { resolvePublicHost, SafeFetchError, type LookupFn } from "@/lib/net/safe-fetch";

/*
 * Veri API adresi yönetici girdisidir. https zorunludur ve adres iç ağa (loopback, özel,
 * link-local/metadata) çözülemez. Tek istisna: yerel test gevşetmesi (net/local-targets.ts;
 * ALLOW_LOCAL_TARGETS + localhost APP_URL) açıkken loopback hedefler (http dahil) geçer,
 * böylece sahte servis (http://127.0.0.1:3199) çalışır. Metadata ve özel ağlar yine reddedilir.
 * DNS rebinding: istek, burada doğrulanan IP'ye sabitlenir (safe-fetch pinnedGet);
 * yönlendirmeler ayrıca kapalıdır (havamania-api.ts).
 */

export type ApiUrlCheck = { ok: true } | { ok: false; reason: "not_https" | "blocked" };
export type ApiTarget = { ok: true; address: string } | { ok: false; reason: "not_https" | "blocked" };

/**
 * Adresi doğrular ve bağlanılacak IP'yi döner. İstek bu IP'ye sabitlenmelidir (pinnedGet);
 * adı yeniden çözen bir istemci DNS rebinding'e açıktır.
 */
export async function resolveApiTarget(url: URL, opts: { allowLocal?: boolean; lookup?: LookupFn } = {}): Promise<ApiTarget> {
  const allowLocal = (opts.allowLocal ?? localTargetsAllowed()) && isLoopbackHost(url.hostname);
  if (url.protocol !== "https:" && !(allowLocal && url.protocol === "http:")) return { ok: false, reason: "not_https" };
  if (url.username || url.password) return { ok: false, reason: "blocked" };
  try {
    // allowHosts: [] -> hiçbir ana makine ada göre muaf değildir; yalnızca loopback gevşemesi olabilir.
    const { address } = await resolvePublicHost(url, { lookup: opts.lookup, allowHosts: [], allowLocal });
    return { ok: true, address };
  } catch (e) {
    if (e instanceof SafeFetchError) return { ok: false, reason: "blocked" };
    throw e;
  }
}

export async function checkApiUrl(url: URL, opts: { allowLocal?: boolean; lookup?: LookupFn } = {}): Promise<ApiUrlCheck> {
  const r = await resolveApiTarget(url, opts);
  return r.ok ? { ok: true } : r;
}

/** Kaydetme ve yönetici arayüzü için Türkçe açıklama. */
export const API_URL_REASONS = {
  not_https: "Veri API adresi https:// ile başlamalıdır.",
  blocked: "Bu adres iç ağa işaret ediyor veya çözümlenemiyor; veri API adresi herkese açık olmalıdır.",
} as const;
