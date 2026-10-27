import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  averageCaseCost,
  classifyResultInsertError,
  clampMaxCost,
  compareRuns,
  costLimitReached,
  countChanges,
  EVAL_RESULT_CASE_FK,
  EVAL_RESULT_RUN_FK,
  effectiveRunStatus,
  emptyExpect,
  estimateRun,
  evaluateCase,
  failureReason,
  hasExpectations,
  includesTr,
  normalizeExpect,
  parseEvalTarget,
  parsePhrases,
  redactResultRow,
  tally,
  trLower,
  type EvalOutcome,
} from "./eval";

const outcome = (o: Partial<EvalOutcome> = {}): EvalOutcome => ({ answer: "", error: null, toolNames: [], sourceIds: [], unanswered: false, ...o });
const expect = (e: Partial<ReturnType<typeof emptyExpect>>) => ({ ...emptyExpect(), ...e });

describe("trLower / includesTr", () => {
  it("Türkçe İ/ı dönüşümü", () => {
    assert.equal(trLower("İSTANBUL ISPARTA"), "istanbul ısparta");
    assert.ok(includesTr("Yarın ISPARTA'da yağmur var", "Isparta"));
    assert.ok(includesTr("İzmir'de hava açık", "izmir"));
  });
  it("boşluklar tekleşir, boş ifade eşleşmez", () => {
    assert.ok(includesTr("don   riski\nvar", "don riski"));
    assert.equal(includesTr("herhangi", "  "), false);
  });
});

describe("evaluateCase", () => {
  it("ölçüt yoksa değerlendirilmez (passed null)", () => {
    const r = evaluateCase(emptyExpect(), outcome({ answer: "merhaba" }));
    assert.equal(r.passed, null);
    assert.deepEqual(r.checks, []);
  });
  it("içermeli: Türkçe büyük/küçük harfe duyarsız", () => {
    assert.equal(evaluateCase(expect({ mustInclude: ["ıslak"] }), outcome({ answer: "Zemin ISLAK olabilir" })).passed, true);
    assert.equal(evaluateCase(expect({ mustInclude: ["İzmir"] }), outcome({ answer: "izmir için" })).passed, true);
    assert.equal(evaluateCase(expect({ mustInclude: ["don"] }), outcome({ answer: "yağmur bekleniyor" })).passed, false);
  });
  it("içermemeli: geçiyorsa kalır ve nedeni yazılır", () => {
    const r = evaluateCase(expect({ mustNotInclude: ["kesinlikle"] }), outcome({ answer: "KESİNLİKLE yağar" }));
    assert.equal(r.passed, false);
    assert.match(failureReason(r.checks), /İçermemeli #1/);
    assert.ok(!JSON.stringify(r.checks).includes("kesinlikle")); // ifade etikette/ayrıntıda yazılmaz
  });
  it("araç: adı ya da any", () => {
    assert.equal(evaluateCase(expect({ expectTool: "forecast" }), outcome({ toolNames: ["forecast"] })).passed, true);
    assert.equal(evaluateCase(expect({ expectTool: "forecast" }), outcome({ toolNames: ["current_weather"] })).passed, false);
    assert.equal(evaluateCase(expect({ expectTool: "any" }), outcome({ toolNames: ["x"] })).passed, true);
    assert.equal(evaluateCase(expect({ expectTool: "any" }), outcome()).passed, false);
  });
  it("kaynak: ilgili parçalar arasında olmalı", () => {
    assert.equal(evaluateCase(expect({ expectSourceId: "s1" }), outcome({ sourceIds: ["s2", "s1"] })).passed, true);
    assert.equal(evaluateCase(expect({ expectSourceId: "s1" }), outcome({ sourceIds: ["s2"] })).passed, false);
  });
  it("cevapsızlık: true ve false beklentisi", () => {
    assert.equal(evaluateCase(expect({ expectUnanswered: true }), outcome({ unanswered: true })).passed, true);
    assert.equal(evaluateCase(expect({ expectUnanswered: true }), outcome({ unanswered: false })).passed, false);
    assert.equal(evaluateCase(expect({ expectUnanswered: false }), outcome({ unanswered: true })).passed, false);
  });
  it("hata varsa diğer kontroller çalışmaz ve senaryo kalır", () => {
    const r = evaluateCase(expect({ mustNotInclude: ["x"] }), outcome({ error: "429 rate limit" }));
    assert.equal(r.passed, false);
    assert.equal(r.checks.length, 1);
    assert.equal(r.checks[0].id, "error");
    assert.ok(!JSON.stringify(r.checks).includes("429")); // ham hata ölçüt satırına girmez
  });
  it("tüm kontroller geçmeli", () => {
    const r = evaluateCase(
      expect({ mustInclude: ["yağış"], mustNotInclude: ["fırtına"], expectTool: "any", expectUnanswered: false }),
      outcome({ answer: "Yağış olasılığı düşük", toolNames: ["forecast"] }),
    );
    assert.equal(r.passed, true);
    assert.equal(r.checks.length, 4);
  });
});

describe("ölçüt ayrıştırma", () => {
  it("parsePhrases: boş satır ve tekrarı atar, sınırlar", () => {
    assert.deepEqual(parsePhrases("don\r\n\n  Don \nyağmur"), ["don", "yağmur"]);
    assert.equal(parsePhrases(Array.from({ length: 30 }, (_, i) => `k${i}`).join("\n")).length, 10);
    assert.equal(parsePhrases("a".repeat(500))[0].length, 200);
  });
  it("normalizeExpect bozuk girdiyi boş ölçüte çevirir", () => {
    assert.deepEqual(normalizeExpect(null), emptyExpect());
    const n = normalizeExpect({ mustInclude: ["a", 3, " "], expectTool: "", expectUnanswered: "evet" });
    assert.deepEqual(n.mustInclude, ["a"]);
    assert.equal(n.expectTool, null);
    assert.equal(n.expectUnanswered, null);
    assert.equal(hasExpectations(n), true);
    assert.equal(hasExpectations(emptyExpect()), false);
    assert.equal(hasExpectations(expect({ expectUnanswered: false })), true);
  });
  it("parseEvalTarget", () => {
    assert.equal(parseEvalTarget("draft"), "draft");
    assert.equal(parseEvalTarget("published"), "published");
    assert.deepEqual(parseEvalTarget("v:0f8fad5b-d9cb-469f-a165-70867728950e"), { versionId: "0f8fad5b-d9cb-469f-a165-70867728950e" });
    assert.equal(parseEvalTarget("v:../etc"), null);
    assert.equal(parseEvalTarget(""), null);
  });
});

describe("maliyet ve koşu durumu", () => {
  it("maliyet sınırı", () => {
    assert.equal(costLimitReached(0.5, 1), false);
    assert.equal(costLimitReached(1, 1), true);
    assert.equal(costLimitReached(5, 0), false); // sınır yok
  });
  it("clampMaxCost", () => {
    assert.equal(clampMaxCost(NaN), 1);
    assert.equal(clampMaxCost(-3), 1);
    assert.equal(clampMaxCost(0.256), 0.26);
    assert.equal(clampMaxCost(500), 10);
  });
  it("tahmin: ortalama yoksa tahmin yok", () => {
    assert.equal(averageCaseCost([0, null, undefined]), null);
    assert.equal(averageCaseCost([0.02, 0.04, 0]), 0.03);
    assert.deepEqual(estimateRun(10, null, 1), { estimateUsd: null, overLimit: false });
    assert.equal(estimateRun(100, 0.05, 1).overLimit, true);
    assert.equal(estimateRun(10, 0.05, 1).overLimit, false);
  });
  it("tally", () => {
    assert.deepEqual(tally([{ passed: true }, { passed: false }, { passed: null }, { passed: true }]), { passed: 2, failed: 1, unchecked: 1 });
  });
  it("yarıda kalan koşu: 15 dakikadan eski 'running' failed görünür", () => {
    const now = Date.parse("2026-10-26T12:00:00Z");
    const startedAt = new Date(now - 40 * 60_000);
    assert.deepEqual(effectiveRunStatus({ status: "running", startedAt, summary: null }, now), { status: "failed", stale: true });
    // Son ilerleme yakınsa uzun süren koşu hâlâ sürüyor sayılır.
    const alive = { lastActivityAt: new Date(now - 2 * 60_000).toISOString() };
    assert.deepEqual(effectiveRunStatus({ status: "running", startedAt, summary: alive }, now), { status: "running", stale: false });
    assert.deepEqual(effectiveRunStatus({ status: "done", startedAt, summary: null }, now), { status: "done", stale: false });
  });
});

describe("compareRuns", () => {
  type R = { id: string; caseId: string | null; question: string; passed: boolean | null };
  let seq = 0;
  const r = (caseId: string | null, passed: boolean | null, question = "q"): R => ({ id: `r${++seq}`, caseId, question, passed });
  it("düzeldi, bozuldu, aynı kaldı, tek tarafta olan", () => {
    const a = [r("1", false), r("2", true), r("3", true), r("4", false), r("5", true)];
    const b = [r("1", true), r("2", false), r("3", true), r("4", false), r("6", true)];
    const rows = compareRuns(a, b);
    assert.deepEqual(
      rows.map((x) => x.change),
      ["fixed", "regressed", "same-pass", "same-fail", "only-b", "only-a"],
    );
    assert.equal(countChanges(rows).fixed, 1);
    assert.equal(countChanges(rows)["only-a"], 1);
  });
  it("senaryosu silinmiş sonuçlar soru metniyle eşlenir; ölçütsüz değerlendirilmedi sayılır", () => {
    const rows = compareRuns([r(null, true, "Don Riski?")], [r(null, null, "don riski?")]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].change, "unchecked");
  });
  it("maskeli (soru boş) sonuçlar tek anahtarda birleşmez; satır kimliğiyle ayrı satır olur", () => {
    const rows = compareRuns([r(null, true, ""), r(null, false, "")], [r(null, true, ""), r(null, true, "")]);
    assert.equal(rows.length, 4);
    assert.equal(new Set(rows.map((x) => x.key)).size, 4);
    assert.ok(rows.every((x) => x.change === "only-a" || x.change === "only-b"));
  });
});

describe("classifyResultInsertError", () => {
  const pg = (constraint_name: string) => ({ code: "23503", constraint_name });
  it("senaryo ve koşu yabancı anahtar kısıtlarını ada göre ayırır", () => {
    assert.equal(classifyResultInsertError(pg(EVAL_RESULT_CASE_FK)), "case");
    assert.equal(classifyResultInsertError(pg(EVAL_RESULT_RUN_FK)), "run");
  });
  it("drizzle'ın sardığı hatada cause zincirini izler", () => {
    assert.equal(classifyResultInsertError(Object.assign(new Error("Failed query"), { cause: pg(EVAL_RESULT_CASE_FK) })), "case");
    assert.equal(classifyResultInsertError(Object.assign(new Error("Failed query"), { cause: pg(EVAL_RESULT_RUN_FK) })), "run");
  });
  it("başka kısıt, başka hata ve metin eşleşmesi 'other' döner", () => {
    assert.equal(classifyResultInsertError(pg("baska_fk")), "other");
    assert.equal(classifyResultInsertError(new Error(`foreign key ${EVAL_RESULT_CASE_FK}`)), "other");
    assert.equal(classifyResultInsertError({ code: "23505" }), "other");
    assert.equal(classifyResultInsertError(null), "other");
    assert.equal(classifyResultInsertError("x"), "other");
  });
});

describe("redactResultRow", () => {
  it("soru, cevap ve araç çağrılarını boşaltır; senaryo bağını keser; geri kalanı korur", () => {
    const row = { caseId: "c1" as string | null, question: "TC 123 hava?", answer: "Merhaba Ali", toolCalls: [{ name: "t", input: "x", output: "y" }], passed: true, costUsd: 0.5, error: null };
    const out = redactResultRow(row);
    assert.equal(out.caseId, null);
    assert.equal(out.question, "");
    assert.equal(out.answer, "");
    assert.deepEqual(out.toolCalls, []);
    assert.equal(out.passed, true);
    assert.equal(out.costUsd, 0.5);
    assert.equal(row.question, "TC 123 hava?"); // girdi değişmez
  });
  it("hata yalnızca türe iner; ölçüt etiketleri sıra no taşır, ayrıntı silinir", () => {
    const row = {
      caseId: "c1" as string | null,
      question: "q",
      answer: "a",
      toolCalls: [],
      error: "Invalid prompt: TC 12345678901",
      checks: [
        { id: "include", label: "Cevapta “Ali Veli” geçmeli", ok: false, detail: "cevapta yok" },
        { id: "include", label: "Cevapta “İzmir” geçmeli", ok: true },
        { id: "exclude", label: "Cevapta “0532” geçmemeli", ok: false, detail: "cevapta geçiyor" },
        { id: "tool", label: "Bir araç çağrılmalı", ok: true },
      ],
    };
    const out = redactResultRow(row);
    assert.equal(out.error, "Model hatası");
    assert.deepEqual(out.checks, [
      { id: "include", label: "İçermeli #1", ok: false },
      { id: "include", label: "İçermeli #2", ok: true },
      { id: "exclude", label: "İçermemeli #1", ok: false },
      { id: "tool", label: "Bir araç çağrılmalı", ok: true },
    ]);
    assert.deepEqual(redactResultRow(out).checks, out.checks); // idempotent
    assert.equal(redactResultRow({ ...row, error: "Sağlayıcı hatası (HTTP 429)" }).error, "Sağlayıcı hatası (HTTP 429)");
    assert.equal(redactResultRow({ ...row, error: null }).error, null);
  });
});
