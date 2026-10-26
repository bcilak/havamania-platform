import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { chunkText } from "./chunking";
import { canClaim, CLAIMABLE_STATUSES, joinWarnings, MAX_CHARS, planIngest, STALE_PROCESSING_MS } from "./ingest-core";

const fakeVectors = async (values: string[]) => values.map((_, i) => [i, 1]);
const failingEmbed = async (): Promise<number[][]> => {
  throw new Error("429 kota aşıldı");
};

describe("planIngest", () => {
  it("embedding başarılıysa vektörleri döner, uyarı yok", async () => {
    const r = await planIngest({ rawText: "Birinci paragraf.\n\nİkinci paragraf.", chunk: chunkText, embed: fakeVectors });
    assert.equal(r.warning, null);
    assert.equal(r.pieces.length, r.vectors?.length);
  });

  it("embedding hatasında kaynak düşmez: vektörsüz parça + uyarı", async () => {
    const r = await planIngest({ rawText: "Sulama zamanı nedir?", chunk: chunkText, embed: failingEmbed });
    assert.equal(r.vectors, null);
    assert.equal(r.pieces.length, 1);
    assert.match(r.warning ?? "", /^Vektörleme başarısız, yalnızca kelime aramasıyla bulunur: 429/);
  });

  it("embedding kapalıyken (embed=null) uyarı üretmez", async () => {
    const r = await planIngest({ rawText: "metin", chunk: chunkText, embed: null });
    assert.equal(r.vectors, null);
    assert.equal(r.warning, null);
  });

  it("vektör sayısı parça sayısına uymazsa hata sayılır ve uyarıya düşer", async () => {
    const r = await planIngest({ rawText: "metin", chunk: chunkText, embed: async () => [] });
    assert.equal(r.vectors, null);
    assert.match(r.warning ?? "", /Vektörleme başarısız/);
  });

  it("400.000 karakterden uzun metni keser ve uyarır", async () => {
    const r = await planIngest({ rawText: "a".repeat(MAX_CHARS + 10), chunk: (t) => [t.slice(0, 5)], embed: null });
    assert.equal(r.text.length, MAX_CHARS);
    assert.match(r.warning ?? "", /400\.000/);
  });

  it("kesme ve vektörleme uyarıları birleşir", async () => {
    const r = await planIngest({ rawText: "a".repeat(MAX_CHARS + 1), chunk: (t) => [t.slice(0, 5)], embed: failingEmbed });
    assert.match(r.warning ?? "", /400\.000.*Vektörleme başarısız/);
  });

  it("metinden parça çıkmazsa hata fırlatır (eski içerik değişmez)", async () => {
    await assert.rejects(planIngest({ rawText: "   ", chunk: chunkText, embed: null }), /metin çıkarılamadı/);
  });
});

describe("canClaim", () => {
  const now = new Date("2026-10-26T12:00:00Z");
  const ago = (ms: number) => new Date(now.getTime() - ms);

  it("pending, ready ve failed kaynak işleme alınabilir", () => {
    for (const s of CLAIMABLE_STATUSES) assert.equal(canClaim(s, now, now), true, s);
  });

  it("işlenmekte olan kaynak ikinci çağrıya verilmez", () => {
    assert.equal(canClaim("processing", ago(1000), now), false);
    assert.equal(canClaim("processing", ago(STALE_PROCESSING_MS), now), false);
  });

  it("uzun süredir güncellenmeyen processing satırı takılı sayılır ve alınabilir", () => {
    assert.equal(canClaim("processing", ago(STALE_PROCESSING_MS + 1), now), true);
  });

  it("bilinmeyen durum alınmaz", () => {
    assert.equal(canClaim("deleted", ago(STALE_PROCESSING_MS * 2), now), false);
  });
});

describe("joinWarnings", () => {
  it("boşları atar, hepsi boşsa null döner", () => {
    assert.equal(joinWarnings([null, undefined, ""]), null);
    assert.equal(joinWarnings(["a", null, "b"]), "a b");
  });
});
