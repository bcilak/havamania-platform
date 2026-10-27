import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  findSimilar,
  modesOverlap,
  normalizeQuestion,
  questionOverlap,
  SIMILAR_MAX,
  SIMILAR_MIN_COSINE,
  similarMessage,
  type SimilarCandidate,
} from "./similar-core";

const cand = (id: string, question: string, mode = "all", type = "qa"): SimilarCandidate => ({ id, title: question, question, mode, type });

describe("normalizeQuestion", () => {
  it("Türkçe küçük harf, noktalama ve boşluk", () => {
    assert.equal(normalizeQuestion("  Sulama NE ZAMAN yapılır?? "), "sulama ne zaman yapılır");
    assert.equal(normalizeQuestion("IŞIK, İyi mi?"), "ışık iyi mi");
  });
  it("yalnız noktalama boş verir", () => {
    assert.equal(normalizeQuestion("?!..."), "");
  });
});

describe("modesOverlap", () => {
  it("aynı mod ya da 'all'", () => {
    assert.equal(modesOverlap("agro", "agro"), true);
    assert.equal(modesOverlap("agro", "all"), true);
    assert.equal(modesOverlap("all", "fly"), true);
    assert.equal(modesOverlap("agro", "fly"), false);
  });
});

describe("questionOverlap", () => {
  it("eşit kümeler 1, ayrık kümeler 0", () => {
    assert.equal(questionOverlap("ne zaman sulanır", "Ne zaman sulanır?"), 1);
    assert.equal(questionOverlap("ne zaman sulanır", "yarın yağmur var mı"), 0);
  });
});

describe("findSimilar", () => {
  it("normalleştirilmiş eşitlik yakalanır (büyük harf ve noktalama farkına rağmen)", () => {
    const r = findSimilar({ question: "Sulama ne zaman yapılır?", mode: "all", candidates: [cand("a", "sulama ne zaman yapılır")] });
    assert.equal(r.length, 1);
    assert.equal(r[0].reason, "same");
  });

  it("JS büyük harfi (I) ve Türkçe İ/ı yazım farkı aynı soru sayılır", () => {
    const stored = [cand("a", "Smoke yerinde düzenleme")];
    for (const q of ["SMOKE YERINDE DÜZENLEME ?", "SMOKE YERİNDE DÜZENLEME ?", "smoke yerınde düzenleme"]) {
      assert.equal(findSimilar({ question: q, mode: "all", candidates: stored })[0]?.reason, "same", q);
    }
    assert.equal(questionOverlap("YERINDE", "yerinde"), 1);
  });

  it("kelime örtüşmesi eşiği: 4/5 benzer, 2/6 benzer değil", () => {
    const base = "ne zaman sulama yapılır";
    assert.equal(findSimilar({ question: base, mode: "all", candidates: [cand("a", `${base} bugün`)] })[0]?.reason, "overlap");
    assert.equal(findSimilar({ question: base, mode: "all", candidates: [cand("a", "ne zaman gübre atılır")] }).length, 0);
  });

  it("embedding eşiğin altında kalırsa benzer sayılmaz, üstündeyse semantic", () => {
    const c = [cand("a", "fidan dikimi için doğru zaman nedir")];
    const q = "fide ne zaman dikilir";
    assert.equal(findSimilar({ question: q, mode: "all", candidates: c, vectorScores: new Map([["a", SIMILAR_MIN_COSINE - 0.01]]) }).length, 0);
    const r = findSimilar({ question: q, mode: "all", candidates: c, vectorScores: new Map([["a", SIMILAR_MIN_COSINE]]) });
    assert.equal(r[0].reason, "semantic");
  });

  it("farklı moddaki kayıt sayılmaz; 'all' ile her mod çakışır", () => {
    const c = [cand("a", "sulama ne zaman", "fly"), cand("b", "sulama ne zaman", "all")];
    const r = findSimilar({ question: "Sulama ne zaman", mode: "agro", candidates: c });
    assert.deepEqual(r.map((m) => m.id), ["b"]);
    assert.deepEqual(findSimilar({ question: "Sulama ne zaman", mode: "all", candidates: c }).map((m) => m.id).sort(), ["a", "b"]);
  });

  it("düzenlenen kaydın kendisi hariç tutulur", () => {
    const r = findSimilar({ question: "sulama", mode: "all", candidates: [cand("self", "sulama")], excludeIds: new Set(["self"]) });
    assert.deepEqual(r, []);
  });

  it("en fazla 3 sonuç; eşit soru önce gelir", () => {
    const c = [
      cand("o1", "ne zaman sulama yapılır bugün"),
      cand("o2", "ne zaman sulama yapılır yarın"),
      cand("same", "ne zaman sulama yapılır"),
      cand("o3", "ne zaman sulama yapılır şimdi"),
    ];
    const r = findSimilar({ question: "Ne zaman sulama yapılır?", mode: "all", candidates: c });
    assert.equal(r.length, SIMILAR_MAX);
    assert.equal(r[0].id, "same");
  });

  it("boş soru hiçbir şeyle eşleşmez", () => {
    assert.deepEqual(findSimilar({ question: "???", mode: "all", candidates: [cand("a", "???")] }), []);
  });

  it("uyarı mesajı kayıtları ve onay kutusunu anlatır", () => {
    const msg = similarMessage(findSimilar({ question: "sulama", mode: "all", candidates: [cand("a", "Sulama")] }));
    assert.match(msg, /Benzer kayıt var/);
    assert.match(msg, /aynı soru/);
  });
});
