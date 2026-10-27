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

describe("chunkText (ReDoS)", () => {
  const timed = (label: string, fn: () => void) => {
    const t0 = performance.now();
    fn();
    const ms = performance.now() - t0;
    assert.ok(ms < 500, `${label}: ${Math.round(ms)} ms`);
  };

  it("boşluksuz 400 bin noktalı dizi 500 ms altında işlenir", () => {
    timed("nokta", () => chunkText(".".repeat(400_000)));
    timed("nokta+boşluk sonu", () => chunkText(`${"a".repeat(1000)}${".".repeat(400_000)} b`));
  });

  it("'# a # # # …' ve uzun boşluklu başlık satırı 500 ms altında işlenir", () => {
    timed("başlık", () => chunkText(`# a ${"# ".repeat(200_000)}`));
    timed("başlık boşluk", () => chunkText(`# a${" ".repeat(400_000)}x`));
    timed("diyez", () => chunkText(`# ${"#".repeat(400_000)}`));
  });

  it("boşluk benzeri tek tip karakterlerden oluşan uzun paragraf 500 ms altında işlenir", () => {
    timed("form feed", () => chunkText(`a${"\f".repeat(400_000)}b`));
    timed("satır sonu", () => chunkText(`a ${"\n \n".repeat(100_000)}b`));
  });

  it("uzun başlık satırı başlık sayılmaz, normal başlık bağlamı korunur", () => {
    const out = chunkText(`# ${"x ".repeat(150)}\n\nİçerik.\n\n# Kısa Başlık\n\nGövde metni.`);
    assert.ok(out.some((c) => c.startsWith("Bölüm: Kısa Başlık\n")));
  });
});
