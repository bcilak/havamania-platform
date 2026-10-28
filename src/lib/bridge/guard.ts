import type { NextResponse } from "next/server";
import { createLimiter, LimiterBusyError } from "@/lib/limiter";
import { allow, clientIp, LIMITS, retryAfterFor } from "@/lib/rate-limit";
import { authenticateBridge, type BridgeAuth } from "./auth";
import { bridgeError } from "./errors";
import { readJsonCapped } from "./request";
import type { ParseResult } from "./schema";

/*
 * Köprü uçlarının ortak girişi. API sözleşmesindeki "İşlem sırası" 1-4:
 *  1-3. başlık biçimi ve anahtar doğrulaması (geçersizse 401; biçim hatasında veritabanına gidilmez). Doğrulama
 *       bellekte önce yapılır; IP başına sınır yalnızca BAŞARISIZ denemeleri sayar ve keser, geçerli anahtar IP kovası
 *       dolu olsa bile geçer (aynı çıkış IP'sini paylaşan bir saldırgan meşru backend'i kilitleyemez),
 *  4. anahtar başına dakikalık üst sınır.
 * Beklenmeyen hata yalnızca hata adıyla loglanır; gövde, başlık ve user_id loglanmaz.
 */

export type BridgeContext = { auth: BridgeAuth };

export async function withBridge(request: Request, handler: (ctx: BridgeContext) => Promise<Response>): Promise<Response> {
  try {
    const auth = await authenticateBridge(request);
    if (!auth) {
      const failKey = `bridge-auth-fail:${clientIp(request)}`;
      // Kova doluysa 401 yerine 429; dolmadıysa bu başarısız deneme sayılır.
      if (!allow(failKey, LIMITS.bridgeAuthFailPerMin)) {
        return bridgeError("rate_limited", { retryAfter: retryAfterFor(LIMITS.bridgeAuthFailPerMin) });
      }
      return bridgeError("unauthorized");
    }
    if (!allow(`bridge-key:${auth.keyId}`, LIMITS.bridgePerMinPerKey)) {
      return bridgeError("rate_limited", { retryAfter: retryAfterFor(LIMITS.bridgePerMinPerKey) });
    }
    return await handler({ auth });
  } catch (e) {
    console.error("[bridge]", e instanceof Error ? e.name : "UnknownError");
    return bridgeError("internal_error");
  }
}

/*
 * Anahtar başına eşzamanlılık: sızan bir anahtarla farklı user_id'ler kullanılarak dakikalık sınırlar aşılsa bile
 * aynı anda en çok `bridgeConcurrencyPerKey` model çağrısı çalışır, `bridgeQueuePerKey` kadarı bekler; fazlası 429.
 */
/** Eşzamanlılık sınırı dolduğunda istemcinin beklemesi gereken süre (sn). */
export const CONCURRENCY_RETRY_AFTER_S = 5;

const keyLimiters = new Map<string, ReturnType<typeof createLimiter>>();

export async function withKeyConcurrency(keyId: string, task: () => Promise<Response>): Promise<Response> {
  let run = keyLimiters.get(keyId);
  if (!run) {
    run = createLimiter(LIMITS.bridgeConcurrencyPerKey, { maxQueue: LIMITS.bridgeQueuePerKey, waitMs: LIMITS.bridgeQueueWaitMs });
    keyLimiters.set(keyId, run);
  }
  try {
    return await run(task);
  } catch (e) {
    if (e instanceof LimiterBusyError) return bridgeError("rate_limited", { retryAfter: CONCURRENCY_RETRY_AFTER_S });
    throw e;
  }
}

/** "İşlem sırası" 5-7: gövdeyi sınırlı okur, JSON'a çevirir ve şemaya göre doğrular. Hatada hazır yanıtı döner. */
export async function readBody<T>(request: Request, parse: (raw: unknown) => ParseResult<T>): Promise<{ ok: true; value: T } | { ok: false; response: NextResponse }> {
  const raw = await readJsonCapped(request);
  if (!raw.ok) return { ok: false, response: bridgeError(raw.code) };
  const parsed = parse(raw.value);
  if (!parsed.ok) return { ok: false, response: bridgeError(parsed.code, { field: parsed.field }) };
  return { ok: true, value: parsed.value };
}
