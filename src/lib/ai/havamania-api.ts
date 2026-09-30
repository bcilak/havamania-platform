import type { ToolId } from "@/lib/bot-config";
import { decryptOrNull } from "@/lib/crypto";
import { getSetting } from "@/lib/settings";

/*
 * Havamania'nın mevcut hava/agro/fly veri servisine giden istemci.
 * Uç noktalar Ayarlar › Entegrasyon sayfasından yapılandırılır; API şeması
 * netleşince yalnızca buradaki parametre eşlemesi güncellenecek.
 */

export type ApiResult = { ok: true; data: unknown } | { ok: false; error: string };

export async function callHavamaniaApi(tool: ToolId, params: Record<string, string | number | undefined | null>): Promise<ApiResult> {
  const cfg = await getSetting("integration");
  if (!cfg.baseUrl) {
    return {
      ok: false,
      error: "Havamania veri API'si henüz yapılandırılmadı. Kullanıcıya güncel veriye şu an erişemediğini açıkça söyle; tahmin uydurma.",
    };
  }
  const url = new URL(cfg.endpoints[tool], cfg.baseUrl);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  }
  const headers: Record<string, string> = { accept: "application/json" };
  const key = decryptOrNull(cfg.apiKeyEnc);
  if (key) headers[cfg.authHeader || "Authorization"] = cfg.authHeader === "Authorization" ? `Bearer ${key}` : key;

  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(cfg.timeoutMs || 8000), cache: "no-store" });
    if (!res.ok) return { ok: false, error: `Veri servisi ${res.status} döndü.` };
    return { ok: true, data: await res.json() };
  } catch (e) {
    const reason = e instanceof Error && e.name === "TimeoutError" ? "zaman aşımı" : "bağlantı hatası";
    return { ok: false, error: `Veri servisine ulaşılamadı (${reason}).` };
  }
}
