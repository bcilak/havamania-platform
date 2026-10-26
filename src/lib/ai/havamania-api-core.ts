/*
 * Havamania veri API'si istemcisinin saf parçaları: veritabanı ve ağ içermez,
 * birim testle doğrulanır. İsteği atan kısım havamania-api.ts'tedir.
 */

export type ApiErrorCode = "not_configured" | "no_location" | `http_${number}` | "timeout" | "network" | "bad_json" | "blocked_url";

export type ApiResult = { ok: true; data: unknown } | { ok: false; error: string; code: ApiErrorCode };

/** Modele ve panele gösterilen Türkçe hata metinleri. */
export const API_ERRORS = {
  not_configured:
    "Havamania veri API'si henüz yapılandırılmadı. Kullanıcıya güncel veriye şu an erişemediğini açıkça söyle; tahmin uydurma.",
  no_location: "Konum bilinmiyor. Kullanıcıya hangi şehir veya ilçe için baktığını sor.",
  bad_url: "Havamania veri API'si adresi geçersiz. Kullanıcıya güncel veriye şu an erişemediğini söyle; tahmin uydurma.",
  blocked_url:
    "Havamania veri API'si adresine güvenlik nedeniyle bağlanılmıyor (iç ağ ya da https dışı). Kullanıcıya güncel veriye şu an erişemediğini söyle; tahmin uydurma.",
  bad_json: "Veri servisi geçersiz yanıt döndü.",
  timeout: "Veri servisine ulaşılamadı (zaman aşımı).",
  network: "Veri servisine ulaşılamadı (bağlantı hatası).",
} as const;

export function apiFailure(code: ApiErrorCode, error?: string): ApiResult {
  const text = error ?? (code.startsWith("http_") ? `Veri servisi ${code.slice(5)} döndü.` : API_ERRORS[code as keyof typeof API_ERRORS]);
  return { ok: false, error: text, code };
}

/**
 * HTTP durumunu hataya çevirir. Yönlendirmeler (3xx) izlenmez; servis taşınmışsa
 * yöneticinin adresi güncellemesi gerekir, bu yüzden ayrı bir açıklama verilir.
 */
export function httpFailure(status: number): ApiResult {
  const code = `http_${status}` as const;
  if (status >= 300 && status < 400) {
    return apiFailure(code, `Veri servisi yönlendirme döndürdü (${status}); yönlendirmeler izlenmez. Entegrasyon adresini güncelleyin.`);
  }
  return apiFailure(code);
}

/**
 * Taban adres ile uç noktayı birleştirir ve taban yolu korur:
 * `https://api.x/v2` + `/weather` → `https://api.x/v2/weather`.
 * (`new URL("/weather", "https://api.x/v2")` yolu `/weather`'a düşürür.)
 * Uç nokta tam URL ise olduğu gibi kullanılır.
 */
export function joinApiUrl(base: string, endpoint: string): string {
  if (/^https?:\/\//i.test(endpoint)) return endpoint;
  return `${base.replace(/\/+$/, "")}/${endpoint.replace(/^\/+/, "")}`;
}

const TIMEOUT_CAUSES = new Set(["UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT", "ETIMEDOUT"]);

/** fetch / gövde okuma hatasını `timeout` ya da `network` olarak sınıflar. */
export function classifyFetchError(e: unknown): "timeout" | "network" {
  if (e && typeof e === "object") {
    const { name, cause } = e as { name?: unknown; cause?: unknown };
    if (name === "TimeoutError") return "timeout";
    const causeCode = cause && typeof cause === "object" ? (cause as { code?: unknown }).code : undefined;
    if (typeof causeCode === "string" && TIMEOUT_CAUSES.has(causeCode)) return "timeout";
  }
  return "network";
}

/** Yanıt gövdesini JSON'a çevirir; boş ya da bozuksa `bad_json` hatası döner. */
export function parseJsonBody(text: string): ApiResult {
  if (!text.trim()) return apiFailure("bad_json");
  try {
    return { ok: true, data: JSON.parse(text) };
  } catch {
    return apiFailure("bad_json");
  }
}

/**
 * Konuma bağlı araçların sorgu parametresi: ad varsa `q`, yoksa cihaz konumu.
 * İkisi de yoksa null (istek atılmaz).
 */
export function locationParams(
  name: string | undefined,
  location: { lat: number; lon: number } | null | undefined,
): { q: string } | { lat: number; lon: number } | null {
  const q = name?.trim();
  if (q) return { q };
  if (location) return { lat: location.lat, lon: location.lon };
  return null;
}
