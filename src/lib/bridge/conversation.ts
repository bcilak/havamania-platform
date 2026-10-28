/*
 * `conversation_id` verilmediğinde köprü, aynı kullanıcının aynı moddaki yakın tarihli konuşmasını sürdürür.
 * Bu dosya saf tutulur (veritabanı yok); sorgu `conversation-db.ts`'tedir.
 */

/** Son mesajından bu kadar süre geçmemiş konuşma tekrar kullanılabilir. */
export const REUSE_WINDOW_MS = 30 * 60_000;

export function isReusable(lastMessageAt: Date | number, now: Date | number = Date.now()): boolean {
  const last = lastMessageAt instanceof Date ? lastMessageAt.getTime() : lastMessageAt;
  const at = now instanceof Date ? now.getTime() : now;
  return Number.isFinite(last) && at - last <= REUSE_WINDOW_MS;
}
