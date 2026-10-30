/*
 * Uygulamadan gelen yapılandırılmış hava verisi için saf yardımcılar (bayatlık ve tahmin aralığı).
 * Sunucu bayatlığı kendisi de hesaplar: istemcinin `stale` bayrağına güvenilmez, yalnızca ek bir işaret olarak okunur.
 */

/** Veri bu süreden eskiyse "ESKİ" sayılır. */
export const WEATHER_STALE_MS = 3 * 60 * 60 * 1000;
/** `observed_at` şu andan bu kadar ilerideyse saat kayması varsayılır; veri zamanı doğrulanamadı sayılır. */
export const WEATHER_FUTURE_TOLERANCE_MS = 10 * 60 * 1000;

export type WeatherFreshness = {
  stale: boolean;
  /** client: istemci `stale: true` gönderdi; future: veri zamanı gelecekte; age: 3 saatten eski. */
  reason: "client" | "age" | "future" | null;
  /** Veri zamanından bu yana geçen dakika (yuvarlanmış); gelecekteki veri için negatif. */
  ageMinutes: number;
};

export function weatherFreshness(observedAt: string, now: Date, clientStale?: boolean | null): WeatherFreshness {
  const observed = Date.parse(observedAt);
  // Şema zaten doğruluyor; yine de çözülemeyen zaman güvenli tarafta (ESKİ) kalır.
  if (!Number.isFinite(observed)) return { stale: true, reason: clientStale ? "client" : "future", ageMinutes: 0 };
  const diff = now.getTime() - observed;
  const ageMinutes = Math.round(diff / 60_000);
  if (clientStale === true) return { stale: true, reason: "client", ageMinutes };
  if (-diff > WEATHER_FUTURE_TOLERANCE_MS) return { stale: true, reason: "future", ageMinutes };
  if (diff > WEATHER_STALE_MS) return { stale: true, reason: "age", ageMinutes };
  return { stale: false, reason: null, ageMinutes };
}

/**
 * Tahminin ilk/son tarihi ve gün sayısı (YYYY-MM-DD, sıra önemsiz); tahmin yoksa null.
 * Köprü şeması günlerin ardışık olmasını zorunlu kılar, bu yüzden `days` ilk-son arasındaki gün sayısına eşittir ve
 * "ilk – son (N gün)" aralığı boş gün içermez.
 */
export function forecastRange(forecast: readonly { date: string }[] | undefined): { first: string; last: string; days: number } | null {
  if (!forecast?.length) return null;
  const dates = forecast.map((d) => d.date).sort();
  return { first: dates[0], last: dates[dates.length - 1], days: dates.length };
}
