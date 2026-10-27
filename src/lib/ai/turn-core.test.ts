import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SourceRecord, ToolCallRecord } from "@/db/schema";
import { abortedContent, abortKind, abortedUsage, describeError, effectiveTarget, exposeTurnData, promptChars, redactErrorText } from "./turn-core";

const tool: ToolCallRecord = { name: "current_weather", input: { location: "Bursa" }, output: { ok: true, data: { secret: 1 } } };
const source = { sourceId: "s1", title: "SSS", snippet: "x", score: 1 } as SourceRecord;

describe("effectiveTarget", () => {
  it("test alanı: target verilirse o, yoksa useDraft'a göre", () => {
    assert.equal(effectiveTarget({ platform: "playground", useDraft: true }), "draft");
    assert.equal(effectiveTarget({ platform: "playground", useDraft: false }), "published");
    assert.equal(effectiveTarget({ platform: "playground", useDraft: true, target: "published" }), "published");
    assert.deepEqual(effectiveTarget({ platform: "playground", useDraft: true, target: { versionId: "v" } }), { versionId: "v" });
  });

  it("widget ve köprü: target yok sayılır, her zaman yayındaki sürüm", () => {
    for (const platform of ["ios", "android", "web"] as const) {
      assert.equal(effectiveTarget({ platform, useDraft: false, target: "draft" }), "published");
      assert.equal(effectiveTarget({ platform, useDraft: false, target: { versionId: "v" } }), "published");
    }
  });
});

describe("exposeTurnData", () => {
  it("widget/köprü: yalnızca araç adları, girdi-çıktı ve kaynak yok", () => {
    const out = exposeTurnData("ios", { toolCalls: [tool], sources: [source] });
    assert.deepEqual(out, { toolNames: ["current_weather"], toolCalls: [], sources: [] });
  });

  it("test alanı: her şey döner", () => {
    const out = exposeTurnData("playground", { toolCalls: [tool], sources: [source] });
    assert.deepEqual(out.toolCalls, [tool]);
    assert.deepEqual(out.sources, [source]);
  });
});

describe("iptal/zaman aşımı kullanımı", () => {
  it("bildirilen 0 ise karakter tahmini kullanılır (~4 karakter/token)", () => {
    assert.deepEqual(abortedUsage({ promptChars: 4000, outputChars: 0, reportedIn: 0, reportedOut: 0 }), { inTok: 1000, outTok: 0 });
    assert.deepEqual(abortedUsage({ promptChars: 4001, outputChars: 41, reportedIn: 0, reportedOut: 0 }), { inTok: 1001, outTok: 11 });
  });

  it("bildirilen değer tahminden büyükse o korunur", () => {
    assert.deepEqual(abortedUsage({ promptChars: 40, outputChars: 40, reportedIn: 500, reportedOut: 300 }), { inTok: 500, outTok: 300 });
  });

  it("promptChars talimat ve metin mesajlarını sayar, görsel parçaları saymaz", () => {
    const base = promptChars("abc", [{ content: "merhaba" }]);
    assert.ok(base >= 3 + 7);
    assert.equal(promptChars("abc", [{ content: "merhaba" }, { content: [{ type: "file" }] }]) - base, '""'.length + 1);
  });

  it("iptal edilen cevap kısmi metni ve notu taşır", () => {
    assert.equal(abortedContent(""), "(Kullanıcı cevabı durdurdu.)");
    assert.equal(abortedContent("  Yarım cev "), "Yarım cev\n\n(Kullanıcı cevabı durdurdu.)");
  });

  it("kesinti notu: yalnızca bizim zaman aşımı sinyalimiz 'zaman aşımı'; web sohbetindeki kopma/Durdur 'kullanıcı' sayılır", () => {
    assert.equal(abortKind(AbortSignal.abort()), "user");
    assert.equal(abortKind({ reason: new DOMException("x", "TimeoutError") }), "timeout");
    // request.signal bağlantı kopunca Durdur'dan ayırt edilemez: eski davranış (kullanıcı durdurdu).
    assert.equal(abortKind({ reason: new Error("socket hang up") }), "user");
    assert.equal(abortKind({}), "user");
    assert.equal(abortKind(undefined), "user");
    assert.equal(abortedContent("Yarım", "timeout"), "Yarım\n\n(Cevap zaman aşımı nedeniyle yarıda kesildi.)");
    assert.ok(!abortedContent("a", "timeout").includes("Kullanıcı"));
  });

  it("hata metni: ham mesaj saklanmaz, yalnızca sınıf ve durum/kod", () => {
    const leak = "Invalid prompt: TC 12345678901 Ali Veli";
    assert.equal(describeError(new Error(leak)), "Model hatası");
    assert.equal(describeError(leak), "Model hatası");
    assert.equal(describeError(Object.assign(new Error(leak), { statusCode: 429 })), "Sağlayıcı hatası (HTTP 429)");
    assert.equal(describeError(Object.assign(new Error(leak), { lastError: { statusCode: 503 } })), "Sağlayıcı hatası (HTTP 503)");
    assert.equal(describeError(Object.assign(new Error("x"), { cause: { code: "ECONNRESET" } })), "Model hatası (ECONNRESET)");
    assert.equal(describeError(new DOMException(leak, "TimeoutError")), "Zaman aşımı");
    assert.ok(!describeError(Object.assign(new Error(leak), { code: "has space TC 123" })).includes("TC"));
  });

  it("redactErrorText: yalnızca describeError biçimi kalır, eski ham mesaj genel sınıfa iner", () => {
    assert.equal(redactErrorText(null), null);
    assert.equal(redactErrorText(""), null);
    assert.equal(redactErrorText("Sağlayıcı hatası (HTTP 429)"), "Sağlayıcı hatası (HTTP 429)");
    assert.equal(redactErrorText("Zaman aşımı (120 sn)"), "Zaman aşımı (120 sn)");
    assert.equal(redactErrorText("Invalid prompt: TC 12345678901"), "Model hatası");
    assert.equal(redactErrorText("Model hatası (HTTP 429) Ali Veli"), "Model hatası");
  });
});
