/*
 * Köprü günlük mesaj tavanı: saf yardımcılar (veritabanı yok; birim testleri okuyabilsin diye `usage-db.ts`'ten ayrı).
 * Gün sınırı Europe/Istanbul takvim günüdür (UTC+3, yaz saati uygulaması yok).
 */

const ISTANBUL_OFFSET_MS = 3 * 3600_000;
const DAY_MS = 24 * 3600_000;

/** Bir sonraki Istanbul gece yarısına kalan süre (sn); sayaç sıfırlanana kadar istemcinin beklemesi gereken süre. En az 60. */
export function secondsUntilNextDay(nowMs: number): number {
  const local = nowMs + ISTANBUL_OFFSET_MS;
  const next = (Math.floor(local / DAY_MS) + 1) * DAY_MS;
  return Math.max(60, Math.ceil((next - local) / 1000));
}
