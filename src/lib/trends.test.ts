import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fmtPct, pct, rateSeries, summarizeTools, versionQuality } from "./trends";

describe("pct / fmtPct", () => {
  it("payda 0 ise 0; tek ondalığa yuvarlar", () => {
    assert.equal(pct(3, 0), 0);
    assert.equal(pct(1, 3), 33.3);
    assert.equal(pct(2, 3), 66.7);
    assert.equal(fmtPct(12.5), "%12,5");
    assert.equal(fmtPct(0), "%0");
    assert.equal(fmtPct(40), "%40");
  });
});

describe("rateSeries", () => {
  const rows = [
    { day: "2026-10-05", assistant: 10, negative: 1, unanswered: 4 },
    { day: "2026-10-12", assistant: 0, negative: 0, unanswered: 0 },
  ];
  it("olumsuz ve cevapsız oranını haftalık noktalara çevirir, boş haftada 0", () => {
    const neg = rateSeries(rows, "negative");
    assert.deepEqual(neg.map((p) => p.value), [10, 0]);
    assert.deepEqual(rateSeries(rows, "unanswered").map((p) => p.value), [40, 0]);
    assert.equal(neg[0].numerator, 1);
    assert.equal(neg[0].denominator, 10);
    assert.equal(neg[0].day, "2026-10-05");
    assert.ok(neg[0].label.startsWith("5 "));
  });
});

describe("summarizeTools", () => {
  it("araç adına göre toplar; yalnızca ok=false başarısızdır; en sık hata kodunu verir", () => {
    const stats = summarizeTools([
      { name: "forecast", ok: "true", code: null, n: 6 },
      { name: "forecast", ok: "false", code: "timeout", n: 1 },
      { name: "forecast", ok: "false", code: "http_500", n: 3 },
      { name: "current_weather", ok: null, code: null, n: 2 },
      { name: "agro_conditions", ok: "false", code: null, n: 1 },
    ]);
    assert.deepEqual(stats.map((s) => s.name), ["forecast", "current_weather", "agro_conditions"]);
    assert.deepEqual(stats[0], { name: "forecast", calls: 10, failed: 4, failurePct: 40, topCode: { code: "http_500", n: 3 } });
    assert.equal(stats[1].failed, 0);
    assert.equal(stats[1].topCode, null);
    assert.deepEqual(stats[2].topCode, { code: "unknown", n: 1 });
    assert.deepEqual(summarizeTools([]), []);
  });
});

describe("versionQuality", () => {
  it("sürüm başına oranlar, yeni sürüm önde; cevapsız sürümde 0", () => {
    const q = versionQuality([
      { number: 2, conversations: 3, assistant: 8, negative: 2, unanswered: 1 },
      { number: 3, conversations: 0, assistant: 0, negative: 0, unanswered: 0 },
      { number: 1, conversations: 5, assistant: 4, negative: 0, unanswered: 2 },
    ]);
    assert.deepEqual(q.map((v) => v.number), [3, 2, 1]);
    assert.equal(q[0].negativePct, 0);
    assert.equal(q[1].negativePct, 25);
    assert.equal(q[1].unansweredPct, 12.5);
    assert.equal(q[2].unansweredPct, 50);
  });
});
