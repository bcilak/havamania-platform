import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { secondsUntilNextDay } from "./daily-cap";

describe("secondsUntilNextDay", () => {
  it("Istanbul gece yarısına kalan süreyi verir (UTC+3)", () => {
    // 2026-10-28 20:00 UTC = 23:00 Istanbul -> 1 saat kaldı
    assert.equal(secondsUntilNextDay(Date.UTC(2026, 9, 28, 20, 0, 0)), 3600);
    // 2026-10-28 21:00 UTC = 00:00 Istanbul (yeni gün) -> 24 saat
    assert.equal(secondsUntilNextDay(Date.UTC(2026, 9, 28, 21, 0, 0)), 86400);
  });

  it("gece yarısına çok az kala en az 60 sn döner", () => {
    assert.equal(secondsUntilNextDay(Date.UTC(2026, 9, 28, 20, 59, 50)), 60);
  });
});
