import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isReusable, REUSE_WINDOW_MS } from "./conversation";

describe("isReusable", () => {
  const now = Date.parse("2026-10-27T12:00:00Z");
  const ago = (ms: number) => new Date(now - ms);

  it("29:59 önceki konuşma tekrar kullanılabilir", () => {
    assert.equal(isReusable(ago(29 * 60_000 + 59_000), now), true);
  });

  it("30:01 önceki konuşma kullanılamaz", () => {
    assert.equal(isReusable(ago(30 * 60_000 + 1_000), now), false);
  });

  it("pencere 30 dakika", () => {
    assert.equal(REUSE_WINDOW_MS, 1_800_000);
  });

  it("şimdi ve Date/number karışımı çalışır; geçersiz tarih kullanılamaz", () => {
    assert.equal(isReusable(now, new Date(now)), true);
    assert.equal(isReusable(Number.NaN, now), false);
  });
});
