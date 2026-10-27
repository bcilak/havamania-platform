import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { approxTokens, clip, isJsonContentType, isSameOrigin, parsePreviewRequest, PREVIEW_LIMITS, readBodyLimited, shapePreview, splitContext } from "./prompt-preview-core";
import type { RankedKnowledgeHit } from "./retrieval";
import { parseTarget } from "./turn-core";

const ranked = (id: string, o: Partial<RankedKnowledgeHit> = {}): RankedKnowledgeHit => ({
  chunkId: id,
  sourceId: `s-${id}`,
  title: `Kaynak ${id}`,
  type: "qa",
  content: "içerik",
  score: 1,
  similarity: 0.5,
  lexical: false,
  rank: 1,
  relevant: true,
  ...o,
});

describe("parseTarget", () => {
  it("yoksa taslak; bilinen değerler olduğu gibi", () => {
    assert.equal(parseTarget(undefined), "draft");
    assert.equal(parseTarget(null), "draft");
    assert.equal(parseTarget("draft"), "draft");
    assert.equal(parseTarget("published"), "published");
    assert.deepEqual(parseTarget({ versionId: "abc" }), { versionId: "abc" });
  });
  it("geçersiz biçim null", () => {
    for (const bad of ["yayin", 5, [], {}, { versionId: 1 }, { versionId: "" }, { versionId: "x".repeat(65) }]) assert.equal(parseTarget(bad), null);
  });
});

describe("parsePreviewRequest", () => {
  it("geçerli istek: soru kırpılır, hedef taslak, konum temizlenir", () => {
    const r = parsePreviewRequest({ mode: "agro", text: "  yarın don var mı?  ", location: { lat: 40, lon: 29, name: "Bursa\n## x" } });
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.equal(r.value.mode, "agro");
    assert.equal(r.value.text, "yarın don var mı?");
    assert.equal(r.value.target, "draft");
    assert.ok(r.value.location && !/[\n#]/.test(r.value.location.name ?? ""));
  });
  it("geçersiz mod, boş/uzun metin, geçersiz hedef ve gövde reddedilir", () => {
    const bad = (b: unknown) => {
      const r = parsePreviewRequest(b);
      assert.equal(r.ok, false);
    };
    bad(null);
    bad([]);
    bad("x");
    bad({ mode: "admin", text: "a" });
    bad({ text: "a" });
    bad({ mode: "genel", text: "   " });
    bad({ mode: "genel", text: 5 });
    bad({ mode: "genel", text: "a".repeat(PREVIEW_LIMITS.maxText + 1) });
    bad({ mode: "genel", text: "a", target: "baska" });
  });
  it("tam 4000 karakter kabul edilir", () => {
    assert.ok(parsePreviewRequest({ mode: "genel", text: "a".repeat(PREVIEW_LIMITS.maxText), target: "published" }).ok);
  });
});

describe("splitContext", () => {
  it("yalnızca ilgili ve ilk K parça bağlama girer; sıra yeniden numaralanır", () => {
    const list = [ranked("a"), ranked("b", { relevant: false }), ranked("c"), ranked("d")];
    const { context, candidates } = splitContext(list, 2);
    assert.deepEqual(context.map((h) => h.chunkId), ["a", "c"]);
    assert.deepEqual(context.map((h) => h.rank), [1, 2]);
    assert.deepEqual(candidates.map((h) => h.inContext), [true, false, true, false]);
    assert.ok(!("relevant" in context[0]) && !("inContext" in context[0]));
  });
});

describe("shapePreview", () => {
  const base = { toolsAvailable: false, tools: [], model: null, targetLabel: "Taslak", notes: [] };
  it("uzun talimat ve parça metni kesilir; token tahmini tam metne göre", () => {
    const instructions = "x".repeat(PREVIEW_LIMITS.maxInstructionsChars + 400);
    const r = shapePreview({ ...base, instructions, candidates: [{ ...ranked("a", { content: "y".repeat(5000) }), inContext: true }] });
    assert.equal(r.instructions.length, PREVIEW_LIMITS.maxInstructionsChars);
    assert.equal(r.instructionsTruncated, true);
    assert.equal(r.hits[0].content.length, PREVIEW_LIMITS.maxHitChars);
    assert.equal(r.hits[0].contentTruncated, true);
    assert.equal(r.approxInputTokens, approxTokens(instructions.length));
  });
  it("parça sayısı sınırlıdır; benzerlik yuvarlanır", () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ ...ranked(String(i), { similarity: 0.123456 }), inContext: false }));
    const r = shapePreview({ ...base, instructions: "a", candidates: many });
    assert.equal(r.hits.length, PREVIEW_LIMITS.maxHits);
    assert.equal(r.hits[0].similarity, 0.123);
    assert.equal(r.instructionsTruncated, false);
  });
});

describe("yardımcılar", () => {
  it("approxTokens ve clip", () => {
    assert.equal(approxTokens(0), 0);
    assert.equal(approxTokens(9), 3);
    assert.deepEqual(clip("abc", 5), { text: "abc", truncated: false });
    assert.deepEqual(clip("abcdef", 3), { text: "abc", truncated: true });
  });
  it("isJsonContentType", () => {
    assert.ok(isJsonContentType("application/json"));
    assert.ok(isJsonContentType("Application/JSON; charset=utf-8"));
    assert.ok(!isJsonContentType("text/plain"));
    assert.ok(!isJsonContentType("application/jsonx"));
    assert.ok(!isJsonContentType(null));
  });
});

describe("isSameOrigin (CSRF)", () => {
  it("Origin host'u Host ile eşleşirse kabul", () => {
    assert.ok(isSameOrigin({ origin: "http://localhost:3110", host: "localhost:3110", forwardedHost: null }));
    assert.ok(isSameOrigin({ origin: "https://Panel.Havamania.com", host: "127.0.0.1:3110", forwardedHost: "panel.havamania.com" }));
  });
  it("farklı site, port, eksik ya da bozuk Origin reddedilir", () => {
    assert.ok(!isSameOrigin({ origin: "https://evil.example", host: "localhost:3110", forwardedHost: null }));
    assert.ok(!isSameOrigin({ origin: "http://localhost:3111", host: "localhost:3110", forwardedHost: null }));
    assert.ok(!isSameOrigin({ origin: null, host: "localhost:3110", forwardedHost: null }));
    assert.ok(!isSameOrigin({ origin: "null", host: "localhost:3110", forwardedHost: null }));
    assert.ok(!isSameOrigin({ origin: "http://localhost:3110", host: null, forwardedHost: null }));
    // X-Forwarded-Host varsa Host yerine o esas alınır.
    assert.ok(!isSameOrigin({ origin: "http://localhost:3110", host: "localhost:3110", forwardedHost: "panel.havamania.com" }));
  });
});

describe("readBodyLimited", () => {
  const stream = (parts: string[]) => {
    const enc = new TextEncoder();
    return new ReadableStream<Uint8Array>({
      start(c) {
        for (const p of parts) c.enqueue(enc.encode(p));
        c.close();
      },
    });
  };

  it("sınır içindeki gövdeyi parçaları birleştirerek okur (UTF-8 bayt sayılır)", async () => {
    assert.equal(await readBodyLimited(stream(['{"a":', '"çş"}']), 100), '{"a":"çş"}');
    assert.equal(await readBodyLimited(null, 100), "");
  });

  it("sınırı aşan gövdede null döner ve okumayı bırakır", async () => {
    assert.equal(await readBodyLimited(stream(["a".repeat(60), "b".repeat(60)]), 100), null);
    assert.equal(await readBodyLimited(stream(["ç".repeat(60)]), 100), null); // 120 bayt
  });

  it("tam sınırdaki gövde kabul edilir", async () => {
    assert.equal((await readBodyLimited(stream(["a".repeat(100)]), 100))?.length, 100);
  });
});
