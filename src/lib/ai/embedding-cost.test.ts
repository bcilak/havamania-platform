import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { embeddingCostOf, embeddingPrice, formatEmbeddingLines, parseEmbeddingLines } from "./embedding-cost";

describe("embeddingCostOf", () => {
  it("token × fiyat / 1M", () => {
    assert.equal(embeddingCostOf(1_000_000, 0.02), 0.02);
    assert.equal(embeddingCostOf(500, 0.1), 0.00005);
  });
  it("fiyat yoksa ya da token negatifse 0", () => {
    assert.equal(embeddingCostOf(1234, 0), 0);
    assert.equal(embeddingCostOf(-5, 1), 0);
  });
});

describe("embeddingPrice", () => {
  it("modelin fiyatını döner; yoksa ya da geçersizse 0", () => {
    assert.equal(embeddingPrice({ "text-embedding-3-small": 0.02 }, "text-embedding-3-small"), 0.02);
    assert.equal(embeddingPrice({ a: 1 }, "b"), 0);
    assert.equal(embeddingPrice(null, "b"), 0);
    assert.equal(embeddingPrice({ a: Number.NaN }, "a"), 0);
  });
});

describe("parseEmbeddingLines / formatEmbeddingLines", () => {
  it("model ve isteğe bağlı fiyatı ayırır (nokta ya da virgül)", () => {
    const r = parseEmbeddingLines("text-embedding-3-small 0.02\ntext-embedding-3-large 0,13\nmock-embed");
    assert.deepEqual(r.models, ["text-embedding-3-small", "text-embedding-3-large", "mock-embed"]);
    assert.deepEqual(r.prices, { "text-embedding-3-small": 0.02, "text-embedding-3-large": 0.13 });
  });
  it("virgülle ayrılmış eski biçimi ve tekrarları kabul eder", () => {
    const r = parseEmbeddingLines("a, b, a");
    assert.deepEqual(r.models, ["a", "b"]);
    assert.deepEqual(r.prices, {});
  });
  it("biçimlendirme ayrıştırmanın tersidir", () => {
    const text = formatEmbeddingLines(["a", "b"], { a: 0.5 });
    assert.equal(text, "a 0.5\nb");
    assert.deepEqual(parseEmbeddingLines(text).prices, { a: 0.5 });
  });
});

describe("embedding fiyat üst sınırı", () => {
  it("1000 USD / 1M token üzerindeki fiyat kaydedilmez, tooHigh'ta döner", () => {
    const r = parseEmbeddingLines(["a 20000", "b 1000", "c 0.02"].join(String.fromCharCode(10)));
    assert.deepEqual(r.tooHigh, ["a"]);
    assert.deepEqual(r.prices, { b: 1000, c: 0.02 });
    assert.deepEqual(r.models, ["a", "b", "c"]);
  });
});
