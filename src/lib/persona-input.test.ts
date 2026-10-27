import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PERSONA_LIMITS, TONES } from "./bot-config";
import { buildToneOverrides, pairExamples, parseBlockedTopics } from "./persona-input";

describe("parseBlockedTopics", () => {
  it("satırları temizler, boşları atar, Türkçe büyük/küçük harf duyarsız tekilleştirir", () => {
    const r = parseBlockedTopics("siyaset\r\n\r\n  Yatırım tavsiyesi \nSİYASET\nIRK");
    assert.deepEqual(r.value, ["siyaset", "Yatırım tavsiyesi", "IRK"]);
    // "SİYASET" (noktalı İ) → "siyaset"; "IRK" → "ırk" (noktasız ı): ikisi de tekrar sayılır.
    assert.equal(parseBlockedTopics("ırk\nIRK").value?.length, 1);
  });

  it("çok uzun satır ve çok fazla konu hata verir", () => {
    const long = parseBlockedTopics("x".repeat(PERSONA_LIMITS.blockedTopics.chars + 1));
    assert.equal(long.value, null);
    assert.match(long.error ?? "", /en fazla 80 karakter/);
    const many = parseBlockedTopics(Array.from({ length: 21 }, (_, i) => `konu ${i}`).join("\n"));
    assert.equal(many.value, null);
    assert.match(many.error ?? "", /En fazla 20/);
    assert.deepEqual(parseBlockedTopics("").value, []);
  });
});

describe("pairExamples", () => {
  it("boş satırı atlar, dolu çiftleri sırayla alır", () => {
    const r = pairExamples([
      { user: " Soru 1 ", assistant: "Cevap 1" },
      { user: "", assistant: "  " },
      { user: "Soru 3", assistant: "Cevap 3" },
    ]);
    assert.deepEqual(r.value, [
      { user: "Soru 1", assistant: "Cevap 1" },
      { user: "Soru 3", assistant: "Cevap 3" },
    ]);
  });

  it("yarım çift satır numarasıyla hata verir", () => {
    const r = pairExamples([
      { user: "a", assistant: "b" },
      { user: "yalnız soru", assistant: "" },
    ]);
    assert.equal(r.value, null);
    assert.match(r.error ?? "", /Örnek 2/);
  });

  it("uzunluk sınırını aşan metin hata verir", () => {
    const r = pairExamples([{ user: "a", assistant: "b".repeat(PERSONA_LIMITS.examples.chars + 1) }]);
    assert.equal(r.value, null);
  });
});

describe("buildToneOverrides", () => {
  const fields = (over: Record<string, { text: string; reset: boolean }>) => over as Parameters<typeof buildToneOverrides>[0];

  it("varsayılanla aynı, boş ya da sıfırlama işaretli ton kayda girmez", () => {
    const r = buildToneOverrides(
      fields({
        samimi: { text: TONES.samimi.rule, reset: false },
        resmi: { text: "", reset: false },
        kisa: { text: "Özel kısa metin burada.", reset: true },
        uzman: { text: "Özel uzman metni burada.", reset: false },
      }),
    );
    assert.deepEqual(r.value, { uzman: "Özel uzman metni burada." });
  });

  it("çok kısa metin hata verir", () => {
    const r = buildToneOverrides(fields({ kisa: { text: "kısa", reset: false } }));
    assert.equal(r.value, null);
    assert.match(r.error ?? "", /çok kısa/);
  });
});
