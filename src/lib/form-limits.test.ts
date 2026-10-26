import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { limitMessage } from "./form-limits";

describe("limitMessage", () => {
  it("sınır içindeki metin için null döner", () => {
    assert.equal(limitMessage("Talimat", 12000, 12000), null);
    assert.equal(limitMessage("Talimat", 12000, 0), null);
  });

  it("sınırı aşınca etiketi, sınırı ve mevcut uzunluğu söyler", () => {
    assert.equal(limitMessage("Talimat", 12000, 12001), "Talimat en fazla 12000 karakter olabilir (şu an 12001).");
  });
});
