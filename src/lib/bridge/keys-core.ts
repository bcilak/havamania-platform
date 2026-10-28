import crypto from "node:crypto";
import { randomToken } from "@/lib/crypto";

/*
 * Köprü sunucu anahtarı: saf yardımcılar (veritabanı yok, test edilebilir).
 * Anahtar `hm_bk_` + 43 karakter base64url'dür; veritabanında yalnızca SHA-256 özeti saklanır.
 */

export const BRIDGE_KEY_RE = /^hm_bk_[A-Za-z0-9_-]{43}$/;
/** Bir botta aynı anda etkin olabilecek anahtar sayısı (rotasyon için ikincisi). */
export const MAX_ACTIVE_KEYS = 2;
/** Köprü kullanıcılarının `app_users.device_id` değeri. Widget bu önekle oturum açamaz (bkz. widget/session). */
export const BRIDGE_DEVICE_ID = "bridge";

/** Cihaz kimliği köprüye ayrılmış önekle başlıyor mu (büyük/küçük harf duyarsız). */
export function isReservedDeviceId(deviceId: string): boolean {
  return deviceId.toLowerCase().startsWith(BRIDGE_DEVICE_ID);
}

export function generateBridgeKey(): string {
  return `hm_bk_${randomToken(32)}`;
}

export function hashBridgeKey(key: string): string {
  return crypto.createHash("sha256").update(key).digest("hex");
}

/** Listede tanımak için son 4 karakter. */
export function bridgeKeyHint(key: string): string {
  return key.slice(-4);
}

/** `Authorization: Bearer hm_bk_…` başlığından anahtarı çıkarır; biçim tutmazsa null (bu aşamada veritabanı kullanılmaz). */
export function parseBearer(header: string | null | undefined): string | null {
  if (!header?.startsWith("Bearer ")) return null;
  const key = header.slice("Bearer ".length);
  return BRIDGE_KEY_RE.test(key) ? key : null;
}

/**
 * Özetin hangi adaya ait olduğunu bulur. Tüm adaylar karşılaştırılır (erken çıkış yok),
 * böylece süre eşleşmenin yerini ele vermez.
 */
export function matchKey<T extends { keyHash: string }>(hash: string, candidates: readonly T[]): T | null {
  const a = Buffer.from(hash, "hex");
  let found: T | null = null;
  for (const c of candidates) {
    const b = Buffer.from(c.keyHash, "hex");
    if (a.length === b.length && crypto.timingSafeEqual(a, b) && found === null) found = c;
  }
  return found;
}
