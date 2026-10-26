import type { ToolId } from "@/lib/bot-config";
import { decryptOrNull } from "@/lib/crypto";
import { getSetting } from "@/lib/settings";
import { pinnedGet, SafeFetchError } from "@/lib/net/safe-fetch";
import { resolveApiTarget } from "./api-url-guard";
import { API_ERRORS, apiFailure, classifyFetchError, httpFailure, joinApiUrl, parseJsonBody, type ApiResult } from "./havamania-api-core";

export type { ApiErrorCode, ApiResult } from "./havamania-api-core";

/*
 * Havamania'nın mevcut hava/agro/fly veri servisine giden istemci.
 * Uç noktalar Ayarlar › Entegrasyon sayfasından yapılandırılır; API şeması
 * netleşince yalnızca buradaki parametre eşlemesi güncellenecek.
 */

/** Başarılı yanıt gövdesi sınırı; daha büyük gövde geçersiz yanıt sayılır. */
const MAX_API_BYTES = 2 * 1024 * 1024;

export async function callHavamaniaApi(tool: ToolId, params: Record<string, string | number | undefined | null>): Promise<ApiResult> {
  const cfg = await getSetting("integration");
  if (!cfg.baseUrl) return apiFailure("not_configured");

  let url: URL;
  try {
    url = new URL(joinApiUrl(cfg.baseUrl, cfg.endpoints[tool]));
  } catch {
    return apiFailure("not_configured", API_ERRORS.bad_url);
  }
  // https zorunlu ve iç ağ adresleri engelli; yalnızca yerel test gevşetmesi (ALLOW_LOCAL_TARGETS) loopback'i açar.
  // Doğrulanan IP'ye bağlanılır (DNS rebinding): ad ikinci kez çözülmez.
  const allowed = await resolveApiTarget(url);
  if (!allowed.ok) return apiFailure("blocked_url");
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  }
  const headers: Record<string, string> = { accept: "application/json" };
  const key = decryptOrNull(cfg.apiKeyEnc);
  if (key) headers[cfg.authHeader || "Authorization"] = cfg.authHeader === "Authorization" ? `Bearer ${key}` : key;

  let status: number;
  let body: string;
  try {
    // Yönlendirme izlenmez (iç ağa kaçış ve anahtar sızıntısı olmasın); 2xx dışı durum gövdesiz döner.
    // Gövde de zaman aşımına bağlıdır; yavaş gövde "timeout" olarak sınıflanır.
    const res = await pinnedGet(url, allowed.address, { headers, timeoutMs: cfg.timeoutMs || 8000, maxBytes: MAX_API_BYTES });
    status = res.status;
    body = res.text;
  } catch (e) {
    if (e instanceof SafeFetchError) return e.kind === "too_large" ? apiFailure("bad_json") : apiFailure(e.kind === "timeout" ? "timeout" : "network");
    return apiFailure(classifyFetchError(e));
  }
  if (status < 200 || status >= 300) return httpFailure(status);
  // JSON ayrıştırma hatası bağlantı hatası değildir: servis cevap verdi ama geçersiz.
  return parseJsonBody(body);
}
