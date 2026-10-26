import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { chunkText } from "./chunking";

describe("chunkText", () => {
  it("boş ve yalnızca boşluktan oluşan metinde parça üretmez", () => {
    assert.deepEqual(chunkText(""), []);
    assert.deepEqual(chunkText("  \n\n \t "), []);
  });

  it("kısa paragrafları tek parçada birleştirir", () => {
    const out = chunkText("Birinci paragraf.\n\nİkinci paragraf.");
    assert.deepEqual(out, ["Birinci paragraf.\n\nİkinci paragraf."]);
  });

  it("CRLF ve fazla boşlukları temizler", () => {
    assert.deepEqual(chunkText("a  b\r\n\r\n\r\n\r\nc"), ["a b\n\nc"]);
  });

  it("birikim boyutu aşınca paragraf sınırından bölüp sonuna örtüşme ekler", () => {
    const p1 = "a".repeat(600);
    const p2 = "b".repeat(600);
    const out = chunkText(`${p1}\n\n${p2}`, 1000, 150);
    assert.equal(out.length, 2);
    assert.equal(out[0], p1);
    assert.ok(out[1].startsWith("a".repeat(150) + "\n\n"), "ikinci parça öncekinin son 150 karakteriyle başlamalı");
    assert.ok(out[1].endsWith(p2));
  });

  it("boyuttan uzun paragrafı örtüşmeli pencerelere böler", () => {
    const long = "x".repeat(2500);
    const out = chunkText(long, 1000, 150);
    assert.ok(out.length >= 3);
    assert.ok(out.every((c) => c.length <= 1000));
    assert.equal(out[0].slice(-150), out[1].slice(0, 150));
  });
});
