import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildPrefixQuery,
  DEFAULT_DOMAIN_STOPWORDS,
  describeMatch,
  isLexicallyRelevant,
  isUnanswered,
  rankHits,
  type ChunkRow,
  type LexRow,
  type VecRow,
} from "./retrieval-core";

const chunk = (id: string, priority = 0): ChunkRow => ({ id, source_id: `s-${id}`, content: `içerik ${id}`, title: `Başlık ${id}`, type: "file", priority });
const lex = (id: string, lex_matches: number, priority = 0): LexRow => ({ ...chunk(id, priority), lex_matches });
const vec = (id: string, similarity: number, priority = 0): VecRow => ({ ...chunk(id, priority), similarity });
const ids = (hits: { row: ChunkRow; relevant: boolean }[], onlyRelevant = true) => hits.filter((h) => h.relevant || !onlyRelevant).map((h) => h.row.id);

describe("buildPrefixQuery", () => {
  it("stopword'leri atar; geriye kelime kalmazsa null döner", () => {
    assert.equal(buildPrefixQuery("ve ile bir bu için"), null);
    assert.equal(buildPrefixQuery(""), null);
  });

  it("tekrar eden önekleri teke indirir", () => {
    assert.equal(buildPrefixQuery("sulama sulamak sulasam"), "sula:*");
  });

  it("ilk dört harfle önek kurar, kısa kelimeyi olduğu gibi bırakır", () => {
    assert.equal(buildPrefixQuery("rüzgâr yağmur don"), "rüzg:* | yağm:* | don:*");
  });

  it("Türkçe büyük/küçük harfi doğru çevirir (I→ı, İ→i)", () => {
    assert.equal(buildPrefixQuery("SULAMA"), "sula:*");
    assert.equal(buildPrefixQuery("ISPARTA"), "ıspa:*");
    assert.equal(buildPrefixQuery("İstanbul"), "ista:*");
  });

  it("alan stopword'lerini sorgudan çıkarır, ayırt edici kelimeyi korur", () => {
    assert.equal(buildPrefixQuery("hava durumu nasıl olacak", DEFAULT_DOMAIN_STOPWORDS), null);
    assert.equal(buildPrefixQuery("Yarın HAVA durumu", DEFAULT_DOMAIN_STOPWORDS), "yarı:*");
    assert.equal(buildPrefixQuery("hava rüzgâr", []), "hava:* | rüzg:*");
  });
});

describe("isLexicallyRelevant", () => {
  it("tek terimde bir eşleşme yeter, çok terimde yarısı (en az 2) gerekir", () => {
    assert.equal(isLexicallyRelevant(1, 1), true);
    assert.equal(isLexicallyRelevant(0, 1), false);
    assert.equal(isLexicallyRelevant(1, 2), false);
    assert.equal(isLexicallyRelevant(2, 2), true);
    assert.equal(isLexicallyRelevant(1, 4), false);
    assert.equal(isLexicallyRelevant(2, 4), true);
    assert.equal(isLexicallyRelevant(2, 5), false);
    assert.equal(isLexicallyRelevant(3, 5), true);
    assert.equal(isLexicallyRelevant(1, 0), false);
  });
});

describe("rankHits", () => {
  it("iki listede de görünen parça RRF ile öne geçer", () => {
    const hits = rankHits({
      lexRows: [lex("a", 2), lex("b", 2)],
      vecRows: [vec("b", 0.8), vec("c", 0.7)],
      termCount: 2,
      minSimilarity: 0.3,
    });
    assert.deepEqual(ids(hits), ["b", "a", "c"]);
    assert.ok(hits[0].score <= 1);
  });

  it("eşik altındaki vektör sonuçlarını ilgisiz işaretler", () => {
    const hits = rankHits({ lexRows: [], vecRows: [vec("yakin", 0.62), vec("sinir", 0.3), vec("uzak", 0.12)], termCount: 0, minSimilarity: 0.3 });
    assert.deepEqual(ids(hits), ["yakin", "sinir"]);
    assert.deepEqual(ids(hits, false), ["yakin", "sinir", "uzak"]);
    assert.equal(hits[0].similarity, 0.62);
    assert.equal(hits[0].lexical, false);
  });

  it("sözcüksel eşleşmesi olmayan priority=10 düzeltme ilgisiz kalır ve ilk K'ya girmez", () => {
    const hits = rankHits({
      lexRows: [lex("sss", 2), lex("belge", 2)],
      vecRows: [vec("duzeltme", 0.05, 10), vec("sss", 0.7)],
      termCount: 3,
      minSimilarity: 0.3,
    });
    const top = ids(hits).slice(0, 6);
    assert.ok(!top.includes("duzeltme"));
    assert.deepEqual(top, ["sss", "belge"]);
  });

  it("öncelik ilgili parçayı yükseltir ama iki listede birinci olanı geçemez", () => {
    const hits = rankHits({
      lexRows: [lex("ikili", 2), lex("duzeltme", 2, 10)],
      vecRows: [vec("ikili", 0.9)],
      termCount: 2,
      minSimilarity: 0.3,
    });
    assert.deepEqual(ids(hits), ["ikili", "duzeltme"]);
    // Aynı listede ikinci sıradaki öncelikli parça, birincinin hemen önüne geçmez ama puanı artar.
    const plain = rankHits({ lexRows: [], vecRows: [vec("a", 0.5), vec("b", 0.5)], termCount: 0, minSimilarity: 0.3 });
    const boosted = rankHits({ lexRows: [], vecRows: [vec("a", 0.5), vec("b", 0.5, 4)], termCount: 0, minSimilarity: 0.3 });
    assert.ok(boosted[1].score > plain[1].score);
  });

  it("öncelik tavanı 10'dur", () => {
    const [a] = rankHits({ lexRows: [], vecRows: [vec("a", 0.5, 10)], termCount: 0, minSimilarity: 0.3 });
    const [b] = rankHits({ lexRows: [], vecRows: [vec("a", 0.5, 99)], termCount: 0, minSimilarity: 0.3 });
    assert.equal(a.score, b.score);
  });

  it("vektör yokken yalnızca yeterli kelime eşleşmesi olan parçalar ilgilidir", () => {
    const hits = rankHits({ lexRows: [lex("tam", 2), lex("zayif", 1)], vecRows: [], termCount: 3, minSimilarity: 0.3 });
    assert.deepEqual(ids(hits), ["tam"]);
    assert.equal(hits.find((h) => h.row.id === "tam")?.similarity, null);
    assert.equal(hits.find((h) => h.row.id === "tam")?.lexical, true);
  });
});

describe("describeMatch", () => {
  it("kosinüs varsa benzerlik, yoksa kelime eşleşmesi, eski kayıtta boş döner", () => {
    assert.equal(describeMatch({ similarity: 0.62, lexical: true }), "benzerlik 0,62");
    assert.equal(describeMatch({ similarity: null, lexical: true }), "kelime eşleşmesi");
    assert.equal(describeMatch({}), null);
  });
});

describe("isUnanswered", () => {
  const ok = { name: "forecast", input: {}, output: { ok: true, data: {} } };
  const failed = { name: "forecast", input: {}, output: { ok: false, error: "x" } };

  it("ilgili parça, araç, hata ve durdurma yokken cevapsızdır", () => {
    assert.equal(isUnanswered({ relevantHits: 0, toolCalls: [], error: null, aborted: false }), true);
  });
  it("hata varsa cevapsız sayılmaz", () => {
    assert.equal(isUnanswered({ relevantHits: 0, toolCalls: [], error: "model hatası", aborted: false }), false);
  });
  it("durdurulduysa cevapsız sayılmaz", () => {
    assert.equal(isUnanswered({ relevantHits: 0, toolCalls: [], error: null, aborted: true }), false);
  });
  it("yalnızca başarısız araç çağrısı varsa cevapsızdır", () => {
    assert.equal(isUnanswered({ relevantHits: 0, toolCalls: [failed], error: null, aborted: false }), true);
  });
  it("başarılı araç çağrısı varsa cevaplanmıştır", () => {
    assert.equal(isUnanswered({ relevantHits: 0, toolCalls: [failed, ok], error: null, aborted: false }), false);
  });
  it("ilgili parça varsa cevaplanmıştır", () => {
    assert.equal(isUnanswered({ relevantHits: 2, toolCalls: [], error: null, aborted: false }), false);
  });
});
