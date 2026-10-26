import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { defaultBotConfig } from "../bot-config";
import { missingModels, modelMetaOrDefault } from "./model-meta";

const listed = { id: "m1", label: "M1", vision: true, tools: true, inputPer1M: 1, outputPer1M: 2 };

describe("modelMetaOrDefault", () => {
  it("listedeki modelin kendi yeteneklerini döner", () => {
    assert.equal(modelMetaOrDefault([listed], "m1"), listed);
  });

  it("listede olmayan modelde araç ve görsel kapalı, fiyat 0 varsayılır", () => {
    const meta = modelMetaOrDefault([listed], "bilinmeyen");
    assert.equal(meta.tools, false);
    assert.equal(meta.vision, false);
    assert.equal(meta.inputPer1M, 0);
    assert.equal(meta.id, "bilinmeyen");
  });
});

describe("missingModels", () => {
  const cfg = () => {
    const c = defaultBotConfig();
    for (const m of Object.values(c.modes)) {
      m.enabled = true;
      m.providerId = "p1";
      m.model = "m1";
    }
    return c;
  };
  const providers = [{ id: "p1", models: [{ id: "m1" }] }];

  it("her şey yerindeyse boş döner", () => {
    assert.deepEqual(missingModels(cfg(), providers, { includeUnset: true }), []);
  });

  it("silinmiş sağlayıcıyı ve listede olmayan modeli ayırır", () => {
    const c = cfg();
    c.modes.agro.providerId = "silinmis";
    c.modes.fly.model = "kaldirildi";
    const out = missingModels(c, providers, { includeUnset: true });
    assert.deepEqual(out.map((p) => [p.mode, p.reason]), [["agro", "provider"], ["fly", "model"]]);
  });

  it("kapalı modlar sayılmaz", () => {
    const c = cfg();
    c.modes.agro.enabled = false;
    c.modes.agro.providerId = "silinmis";
    assert.deepEqual(missingModels(c, providers, { includeUnset: true }), []);
  });

  it("seçilmemiş model yalnızca includeUnset ile raporlanır", () => {
    const c = cfg();
    c.modes.genel.model = null;
    assert.deepEqual(missingModels(c, providers, { includeUnset: true }).map((p) => p.reason), ["unset"]);
    assert.deepEqual(missingModels(c, providers, { includeUnset: false }), []);
  });
});
