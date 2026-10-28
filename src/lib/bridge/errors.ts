import { NextResponse } from "next/server";
import type { ChatError } from "@/lib/ai/turn-core";

/*
 * Köprü hata sözleşmesi: gövde her zaman `{ error, message }` (400'de isteğe bağlı `field`,
 * 428'de `consent`). Mesajlar sabit Türkçe metindir; iç bilgi (model adı, sağlayıcı hatası,
 * kullanıcı girdisi) hiçbir zaman buraya girmez.
 */

export type BridgeErrorCode =
  | "invalid_request"
  | "unauthorized"
  | "not_found"
  | "mode_disabled"
  | "conversation_conflict"
  | "too_large"
  | "consent_required"
  | "rate_limited"
  | "daily_limit"
  | "not_configured"
  | "model_error"
  | "timeout"
  | "internal_error";

export const BRIDGE_STATUS: Record<BridgeErrorCode, number> = {
  invalid_request: 400,
  unauthorized: 401,
  not_found: 404,
  mode_disabled: 409,
  conversation_conflict: 409,
  too_large: 413,
  consent_required: 428,
  rate_limited: 429,
  daily_limit: 429,
  not_configured: 503,
  model_error: 503,
  timeout: 504,
  internal_error: 500,
};

export const BRIDGE_MESSAGES: Record<BridgeErrorCode, string> = {
  invalid_request: "İstek geçersiz.",
  unauthorized: "Yetkilendirme başarısız.",
  not_found: "Kayıt bulunamadı.",
  mode_disabled: "Bu mod şu anda kapalı.",
  conversation_conflict: "Bu konuşma kullanılamıyor. Yeni bir konuşma başlatın.",
  too_large: "İstek çok büyük.",
  consent_required: "Devam etmek için güncel aydınlatma ve açık rıza metnini onaylamanız gerekiyor.",
  rate_limited: "Çok fazla istek gönderildi. Biraz bekleyip tekrar deneyin.",
  daily_limit: "Günlük mesaj sınırına ulaşıldı. Daha sonra tekrar deneyin.",
  not_configured: "Asistan şu anda hizmet veremiyor.",
  model_error: "Asistan şu anda cevap veremedi. Lütfen tekrar deneyin.",
  timeout: "Cevap zamanında hazırlanamadı. Lütfen tekrar deneyin.",
  internal_error: "Beklenmeyen bir hata oluştu.",
};

export type BridgeErrorExtra = {
  /** 400: hatalı alanın yolu (ör. `context.profile.interest`). */
  field?: string;
  /** 429: `Retry-After` (saniye, en az 1). */
  retryAfter?: number;
  /** 428: güncel onay metni (`health`: ayrı sağlık rızası metni). */
  consent?: { version: number; text: string; health?: { version: number; text: string } };
};

/** Başarılı ve hatalı tüm köprü yanıtlarının ortak başlıkları. CORS başlığı bilerek yok. */
export const BRIDGE_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } as const;

export function bridgeError(code: BridgeErrorCode, extra: BridgeErrorExtra = {}): NextResponse {
  const body: Record<string, unknown> = { error: code, message: BRIDGE_MESSAGES[code] };
  if (extra.field) body.field = extra.field;
  if (extra.consent) body.consent = extra.consent;
  const headers: Record<string, string> = { ...BRIDGE_HEADERS };
  if (extra.retryAfter !== undefined) headers["retry-after"] = String(Math.max(1, Math.ceil(extra.retryAfter)));
  return NextResponse.json(body, { status: BRIDGE_STATUS[code], headers });
}

/** Başarılı JSON yanıtı (ortak başlıklarla). */
export function bridgeJson(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: { ...BRIDGE_HEADERS } });
}

/** Sohbet çekirdeğinin fırlattığı `ChatError`'u sözleşme koduna çevirir; bilinmeyen kod 500 olur. */
export function fromChatError(e: Pick<ChatError, "code" | "retryAfter">): NextResponse {
  switch (e.code) {
    case "mode_disabled":
      return bridgeError("mode_disabled");
    case "not_configured":
    case "version_not_found":
      return bridgeError("not_configured");
    case "daily_limit":
      return bridgeError("daily_limit", { retryAfter: e.retryAfter ?? 60 });
    case "conversation_not_found":
    case "conversation_mode_mismatch":
      return bridgeError("conversation_conflict");
    case "empty":
      return bridgeError("invalid_request");
    default:
      return bridgeError("internal_error");
  }
}
