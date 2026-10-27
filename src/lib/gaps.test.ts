import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  clusterGaps,
  gapTerms,
  groupGaps,
  maskQuestionPii,
  mergeClustersByEmbedding,
  normalizeQuestion,
  termSimilarity,
  termsMatch,
  type GapQuestion,
} from "./gaps";

let seq = 0;
function q(question: string, o: Partial<GapQuestion> = {}): GapQuestion {
  seq++;
  return {
    messageId: `m${seq}`,
    conversationId: `c${seq}`,
    question,
    mode: "agro",
    at: new Date(Date.UTC(2026, 9, 1, 0, seq)),
    unanswered: true,
    negative: false,
    ...o,
  };
}

describe("gapTerms", () => {
  it("soru eklerini ve alan kelimelerini atar, terimleri sıralı döndürür", () => {
    assert.deepEqual(gapTerms("Yarın sulama yapmalı mıyım?"), ["sula", "yapm", "yarı"]);
    assert.deepEqual(gapTerms("hava durumu nasıl olacak"), []);
    assert.deepEqual(gapTerms("MI"), []);
  });
  it("kısaltmalar tam eşleşme olarak işaretlenir", () => {
    assert.deepEqual(gapTerms("UV indeksi kaç"), ["=uv", "inde", "kaç"]);
  });
});

describe("termsMatch / termSimilarity", () => {
  it("aynı kök farklı ek eşleşir, farklı kelime eşleşmez", () => {
    assert.ok(termsMatch("yapm", "yapa"));
    assert.ok(termsMatch("don", "donm"));
    assert.ok(!termsMatch("don", "dol"));
    assert.ok(!termsMatch("=UV", "uv"));
    assert.ok(!termsMatch("=uv", "uvab"));
  });
  it("boş küme 0, aynı küme 1, her terim en çok bir kez eşleşir", () => {
    assert.equal(termSimilarity([], ["sula"]), 0);
    assert.equal(termSimilarity(["sula", "yarı"], ["sula", "yarı"]), 1);
    assert.equal(termSimilarity(["sula"], ["sula", "sulu"]), 0.5);
  });
});

describe("clusterGaps / groupGaps", () => {
  it("'yarın sulama yapmalı mıyım' ile 'yarın sulama yapayım mı' aynı gruba, 'don riski var mı' ayrı gruba düşer", () => {
    const groups = groupGaps([q("Yarın sulama yapmalı mıyım?"), q("yarın sulama yapayım mı"), q("Don riski var mı?")]);
    assert.equal(groups.length, 2);
    assert.equal(groups[0].count, 2);
    assert.equal(groups[1].count, 1);
    assert.equal(normalizeQuestion(groups[1].question), "don riski var mı");
  });

  it("aynı metin tek soru sayısına katılır; temsilci en sık metin, örnekler farklı metinler", () => {
    const a = q("Sulama ne zaman yapılır");
    const b = q("sulama ne zaman yapılır?");
    const c = q("Sulama zamanı ne");
    const d = q("Sulamayı ne zaman yapmalıyım", { unanswered: false, negative: true });
    const [g] = groupGaps([a, b, c, d]);
    assert.equal(g.count, 4);
    assert.equal(g.unanswered, 3);
    assert.equal(g.negative, 1);
    assert.equal(normalizeQuestion(g.question), "sulama ne zaman yapılır");
    assert.equal(g.target.messageId, b.messageId, "temsilcinin en yeni örneği");
    assert.equal(g.samples.length, 3);
    assert.equal(new Set(g.samples.map((s) => normalizeQuestion(s.question))).size, 3);
    assert.equal(g.samples[0].messageId, b.messageId);
    assert.equal(g.lastAt.getTime(), d.at.getTime());
  });

  it("mod dağılımı çoktan aza, sıralama sayıya göre", () => {
    const groups = groupGaps([
      q("Zeytin budaması ne zaman", { mode: "agro" }),
      q("Zeytin budama zamanı ne zaman", { mode: "genel" }),
      q("Zeytin budaması ne zaman", { mode: "agro" }),
      q("Rüzgâr kaç knot", { mode: "fly" }),
    ]);
    assert.equal(groups[0].count, 3);
    assert.deepEqual(groups[0].modes, [
      { mode: "agro", count: 2 },
      { mode: "genel", count: 1 },
    ]);
    assert.equal(groups[1].count, 1);
  });

  it("yalnızca durak sözcük içeren sorular birebir aynıysa birleşir; boş soru atlanır", () => {
    const clusters = clusterGaps([q("hava durumu nasıl"), q("Hava durumu nasıl?"), q("hava nasıl olacak"), q("  ")]);
    assert.equal(clusters.length, 2);
    assert.deepEqual(clusters.map((c) => c.questions.length), [2, 1]);
  });

  it("zincirleme kaymaz: lidere benzemeyen soru, ortadaki köprüye benzese de birleşmez", () => {
    // a~b (2/3) ve b~c (2/3) ama a~c yalnızca 1/5
    const clusters = clusterGaps([q("sulama yapmak"), q("sulama yapmak"), q("yapmak buğday"), q("buğday ekimi"), q("sulama zamanı")], 0.6);
    assert.ok(clusters.length >= 2);
    const lead = clusters[0];
    assert.ok(lead.questions.every((x) => gapTerms(x.question).includes("sula") || gapTerms(x.question).includes("yapm")));
  });
});

describe("mergeClustersByEmbedding", () => {
  it("benzer vektörlü kümeleri büyük olana katar, vektörsüzleri olduğu gibi bırakır", () => {
    const clusters = clusterGaps([q("Tarlayı ne zaman sulamalı"), q("Tarlayı ne zaman sulamalı"), q("Fide dikimi için su ihtiyacı"), q("Rüzgâr kaç knot")]);
    assert.equal(clusters.length, 3);
    const vectors = [[1, 0], [0.99, 0.05], null];
    const merged = mergeClustersByEmbedding(clusters, vectors, 0.9);
    assert.equal(merged.length, 2);
    assert.equal(merged[0].questions.length, 3);
    assert.equal(merged[1].questions.length, 1);
    // girdi değişmez
    assert.equal(clusters[0].questions.length, 2);
    assert.equal(mergeClustersByEmbedding(clusters, [], 0.9).length, 3);
  });
  it("kosinüs eşiğin altındaysa birleştirmez", () => {
    const clusters = clusterGaps([q("Tarlayı sulamalı mı"), q("Zeytin hasadı")]);
    assert.equal(mergeClustersByEmbedding(clusters, [[1, 0], [0, 1]]).length, 2);
  });
});

describe("maskQuestionPii", () => {
  it("e-posta ve uzun rakam dizilerini maskeler, kısa sayıları bırakır", () => {
    assert.equal(maskQuestionPii("Ali ali@example.com yazdı"), "Ali •••@••• yazdı");
    assert.equal(maskQuestionPii("Beni 0555 123 45 67 numaradan arayın"), "Beni •••• numaradan arayın");
    assert.equal(maskQuestionPii("TC 12345678901 ile"), "TC •••• ile");
    assert.equal(maskQuestionPii("FL350 seviyesinde 12 kt rüzgâr"), "FL350 seviyesinde 12 kt rüzgâr");
    assert.equal(maskQuestionPii("Yarın 25 derece mi"), "Yarın 25 derece mi");
  });
});

describe("maskQuestionPii (telefon biçimleri)", () => {
  it("boşluklu, uluslararası ve bitişik telefon biçimlerini maskeler", () => {
    for (const phone of ["0532 123 45 67", "+90 532 123 4567", "05321234567", "0532-123-45-67"]) {
      assert.equal(maskQuestionPii(`Beni ${phone} arayın`), "Beni •••• arayın", phone);
    }
  });
});

describe("maskQuestionPii (ReDoS)", () => {
  it("uzun boşluksuz ya da rakam dizisi girdileri her biri 500 ms altında maskelenir", () => {
    const inputs = ["a".repeat(400_000), "1".repeat(400_000), "1 ".repeat(200_000), `${"a".repeat(200_000)}@`, "a@".repeat(200_000)];
    for (const input of inputs) {
      const t0 = performance.now();
      maskQuestionPii(input);
      assert.ok(performance.now() - t0 < 500, `${Math.round(performance.now() - t0)} ms`);
    }
  });

  it("uzun rakam dizisi maskelenir", () => {
    assert.ok(!maskQuestionPii("no 1234567890123456789012345678901234567890123456 son").includes("1234567890"));
  });
});
