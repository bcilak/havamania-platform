import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { forecastRange, WEATHER_FUTURE_TOLERANCE_MS, WEATHER_STALE_MS, weatherFreshness } from "./weather-context";

const NOW = new Date("2026-10-28T12:00:00Z");
const MIN = 60_000;
/** `NOW`dan `minutesAgo` dakika önceki an (negatif: gelecek). */
const at = (minutesAgo: number) => new Date(NOW.getTime() - minutesAgo * MIN).toISOString();

describe("weatherFreshness", () => {
  it("sabitler: 3 saat ve 10 dakika", () => {
    assert.equal(WEATHER_STALE_MS, 3 * 60 * MIN);
    assert.equal(WEATHER_FUTURE_TOLERANCE_MS, 10 * MIN);
  });

  it("2 saat 59 dakika güncel", () => {
    assert.deepEqual(weatherFreshness(at(179), NOW), { stale: false, reason: null, ageMinutes: 179 });
  });

  it("tam 3 saat güncel; 3 saat 1 dakika eski (age)", () => {
    assert.equal(weatherFreshness(at(180), NOW).stale, false);
    assert.deepEqual(weatherFreshness(at(181), NOW), { stale: true, reason: "age", ageMinutes: 181 });
  });

  it("istemci stale: true -> client (taze veride de)", () => {
    assert.deepEqual(weatherFreshness(at(5), NOW, true), { stale: true, reason: "client", ageMinutes: 5 });
    assert.equal(weatherFreshness(at(5), NOW, false).stale, false);
    assert.equal(weatherFreshness(at(5), NOW, null).stale, false);
  });

  it("istemci stale: false yaşlı veriyi güncel yapmaz", () => {
    assert.equal(weatherFreshness(at(400), NOW, false).reason, "age");
  });

  it("gelecek: +9 dakika güncel, +11 dakika future", () => {
    assert.deepEqual(weatherFreshness(at(-9), NOW), { stale: false, reason: null, ageMinutes: -9 });
    assert.deepEqual(weatherFreshness(at(-10), NOW), { stale: false, reason: null, ageMinutes: -10 });
    assert.deepEqual(weatherFreshness(at(-11), NOW), { stale: true, reason: "future", ageMinutes: -11 });
  });

  it("offset'li zaman doğru çözülür", () => {
    // 14:30+03:00 = 11:30Z -> 30 dakika önce
    assert.equal(weatherFreshness("2026-10-28T14:30:00+03:00", NOW).ageMinutes, 30);
  });

  it("çözülemeyen zaman güvenli tarafta (eski)", () => {
    assert.equal(weatherFreshness("bozuk", NOW).stale, true);
    assert.equal(weatherFreshness("bozuk", NOW, true).reason, "client");
  });
});

describe("forecastRange", () => {
  it("ilk, son tarih ve gün sayısı; sıra önemsiz", () => {
    assert.deepEqual(forecastRange([{ date: "2026-10-30" }, { date: "2026-10-28" }, { date: "2026-10-29" }]), { first: "2026-10-28", last: "2026-10-30", days: 3 });
    assert.deepEqual(forecastRange([{ date: "2026-12-31" }]), { first: "2026-12-31", last: "2026-12-31", days: 1 });
  });

  it("ardışık günlerde gün sayısı ilk-son aralığına eşit (ay ve yıl sınırı dahil)", () => {
    const r = forecastRange([{ date: "2027-01-01" }, { date: "2026-12-30" }, { date: "2026-12-31" }]);
    assert.deepEqual(r, { first: "2026-12-30", last: "2027-01-01", days: 3 });
    const span = (Date.parse(`${r!.last}T00:00:00Z`) - Date.parse(`${r!.first}T00:00:00Z`)) / 86_400_000 + 1;
    assert.equal(r!.days, span);
  });

  it("tahmin yoksa null", () => {
    assert.equal(forecastRange(undefined), null);
    assert.equal(forecastRange([]), null);
  });

  it("girdi dizisini değiştirmez", () => {
    const input = [{ date: "2026-10-30" }, { date: "2026-10-28" }];
    forecastRange(input);
    assert.deepEqual(input, [{ date: "2026-10-30" }, { date: "2026-10-28" }]);
  });
});
