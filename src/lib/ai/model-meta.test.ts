import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { defaultBotConfig } from "../bot-config";
import { effectiveMaxOutputTokens, isReasoningModel, missingModels, modelMetaOrDefault } from "./model-meta";

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

describe("isReasoningModel", () => {
  it("bilinen muhakeme modellerini tanır", () => {
    for (const id of ["o1", "o1-mini", "o3", "o3-mini", "o4-mini", "openai/o3", "gpt-5", "gpt-5-mini", "claude-x-thinking", "claude-3-7-sonnet-20250219-thinking", "claude-opus-4-thinking", "gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.5-flash-lite", "models/gemini-2.5-pro", "google/gemini-2.5-flash-lite", "Gemini-2.5-Flash", "gemini-2.0-flash-thinking-exp", "deepseek-reasoner", "my-reasoning-model"]) {
      assert.equal(isReasoningModel(id), true, id);
    }
  });

  it("bilinmeyen ya da sıradan modeller için false", () => {
    for (const id of ["gpt-4o", "gpt-4.1", "claude-sonnet-5", "gemini-2.0-flash", "gemini-1.5-pro", "gemini-2.50-x", "o2", "zeta-o3x", "", null, undefined]) {
      assert.equal(isReasoningModel(id), false, String(id));
    }
  });
});

describe("effectiveMaxOutputTokens", () => {
  it("tanımsız sınır tanımsız kalır", () => {
    assert.equal(effectiveMaxOutputTokens(undefined, true), undefined);
    assert.equal(effectiveMaxOutputTokens(undefined, false), undefined);
  });

  it("sıradan modelde değer aynen geçer", () => {
    assert.equal(effectiveMaxOutputTokens(700, false), 700);
  });

  it("muhakeme modelinde düşünme payı eklenir ve toplam 8000'i aşmaz", () => {
    assert.equal(effectiveMaxOutputTokens(700, true), 2748);
    assert.equal(effectiveMaxOutputTokens(4000, true), 6048);
    assert.equal(effectiveMaxOutputTokens(7000, true), 8000);
  });
});
