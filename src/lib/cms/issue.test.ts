import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { describeIssue, type Issue } from "./issue";
import { defaultLandingContent, landingSchema } from "./schema";

/** Varsayılan içeriği bozup şemadan çıkan ilk sorunu editör diliyle döner. */
function firstMessage(mutate: (c: ReturnType<typeof defaultLandingContent>) => void): string {
  const c = defaultLandingContent();
  mutate(c);
  const r = landingSchema.safeParse(c);
  assert.ok(!r.success);
  return describeIssue(r.error.issues[0] as unknown as Issue);
}

describe("describeIssue", () => {
  it("metin sınırı: karakter der", () => {
    assert.equal(
      firstMessage((c) => (c.energy.solar.data[0] = "x".repeat(61))),
      "Enerji › Solar › analiz edilen veriler › 1.: en fazla 60 karakter olabilir",
    );
    assert.equal(
      firstMessage((c) => (c.scenes.core.chips[0].value = "1".repeat(15))),
      "Panel sahnesi › Çipler › 1. › değer: en fazla 14 karakter olabilir",
    );
  });

  it("dizi sınırı: karakter değil tane der", () => {
    assert.equal(
      firstMessage((c) => (c.energy.solar.uses = Array.from({ length: 7 }, () => "a"))),
      "Enerji › Solar › kullanım alanları: en fazla 6 tane olabilir",
    );
    assert.equal(
      firstMessage((c) => (c.features.items = Array.from({ length: 13 }, () => c.features.items[0]))),
      "Özellik ızgarası › kartlar: en fazla 12 tane olabilir",
    );
  });

  it("boş dizi: boş bırakılamaz", () => {
    assert.equal(
      firstMessage((c) => (c.aviation.uses = [])),
      "Uçuş › kullanım alanları: boş bırakılamaz",
    );
  });

  it("sabit uzunluklu dizi: tam N tane olmalı", () => {
    assert.equal(
      firstMessage((c) => (c.route.sample.stops = c.route.sample.stops.slice(0, 3))),
      "Güzergâh bölümü › örnek ekran › duraklar: tam 4 tane olmalı",
    );
  });
});
