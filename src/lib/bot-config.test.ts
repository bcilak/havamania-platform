import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { clampMaxOutputTokens, defaultBotConfig, normalizeBotConfig, PERSONA_LIMITS, TONES, toneRule, type BotConfig } from "./bot-config";

describe("normalizeBotConfig: kişilik alanları", () => {
  it("eski kayıt (yeni alanlar yok) mod bazlı varsayılanları alır", () => {
    const old = JSON.parse(JSON.stringify(defaultBotConfig())) as Record<string, unknown>;
    delete old.blockedTopics;
    delete old.toneOverrides;
    for (const m of Object.values(old.modes as Record<string, Record<string, unknown>>)) {
      delete m.maxOutputTokens;
      delete m.examples;
    }
    const cfg = normalizeBotConfig(old as unknown as BotConfig);
    assert.deepEqual([cfg.modes.genel.maxOutputTokens, cfg.modes.agro.maxOutputTokens, cfg.modes.fly.maxOutputTokens], [700, 800, 900]);
    assert.deepEqual(cfg.modes.genel.examples, []);
    assert.deepEqual(cfg.blockedTopics, []);
    assert.deepEqual(cfg.toneOverrides, {});
  });

  it("null girdi tam varsayılanı verir", () => {
    assert.deepEqual(normalizeBotConfig(null), defaultBotConfig());
  });

  it("verilen değerler korunur; aralık dışı token sınıra çekilir", () => {
    const d = defaultBotConfig();
    d.modes.genel.maxOutputTokens = 50;
    d.modes.agro.maxOutputTokens = 99999;
    d.modes.fly.maxOutputTokens = 1234.6;
    const cfg = normalizeBotConfig(d);
    assert.equal(cfg.modes.genel.maxOutputTokens, PERSONA_LIMITS.maxOutputTokens.min);
    assert.equal(cfg.modes.agro.maxOutputTokens, PERSONA_LIMITS.maxOutputTokens.max);
    assert.equal(cfg.modes.fly.maxOutputTokens, 1235);
  });

  it("bozuk alanlar temizlenir: eksik çift, fazla uzunluk, fazla sayı, bilinmeyen ton", () => {
    const d = defaultBotConfig();
    d.modes.genel.examples = [
      { user: "a", assistant: "b" },
      { user: "yalnız", assistant: "" },
      ...Array.from({ length: 8 }, (_, i) => ({ user: `u${i}`, assistant: "x".repeat(2000) })),
    ];
    d.blockedTopics = Array.from({ length: 30 }, (_, i) => ` konu ${i} `).concat(["konu 1", "y".repeat(200)]);
    (d.toneOverrides as Record<string, string>) = { samimi: "  Özel samimi metin  ", bilinmeyen: "x", resmi: "   " };
    const cfg = normalizeBotConfig(d);
    assert.equal(cfg.modes.genel.examples.length, PERSONA_LIMITS.examples.count);
    assert.deepEqual(cfg.modes.genel.examples[0], { user: "a", assistant: "b" });
    assert.ok(cfg.modes.genel.examples.every((e) => e.assistant.length <= PERSONA_LIMITS.examples.chars));
    assert.equal(cfg.blockedTopics.length, PERSONA_LIMITS.blockedTopics.count);
    assert.equal(cfg.blockedTopics[0], "konu 0");
    assert.deepEqual(cfg.toneOverrides, { samimi: "Özel samimi metin" });
  });
});

describe("toneRule", () => {
  it("düzenlenmiş metin varsa onu, yoksa varsayılanı verir", () => {
    assert.equal(toneRule({ kisa: "Tek cümleyle cevapla." }, "kisa"), "Tek cümleyle cevapla.");
    assert.equal(toneRule({ kisa: "Tek cümleyle cevapla." }, "resmi"), TONES.resmi.rule);
    assert.equal(toneRule(undefined, "uzman"), TONES.uzman.rule);
    assert.equal(toneRule({ dengeli: "  " }, "dengeli"), TONES.dengeli.rule);
  });

  it("ton kimlikleri (mobil köprü sözleşmesi) değişmez", () => {
    assert.deepEqual(Object.keys(TONES).sort(), ["dengeli", "kisa", "resmi", "samimi", "uzman"]);
  });
});

describe("clampMaxOutputTokens", () => {
  it("sayı olmayan değer varsayılana düşer", () => {
    assert.equal(clampMaxOutputTokens(undefined, 700), 700);
    assert.equal(clampMaxOutputTokens("500", 700), 700);
    assert.equal(clampMaxOutputTokens(Number.NaN, 700), 700);
    assert.equal(clampMaxOutputTokens(400, 700), 400);
  });
});

describe("normalizeBotConfig: dondurulmuş sürüm (frozen)", () => {
  const oldConfig = () => {
    const old = JSON.parse(JSON.stringify(defaultBotConfig())) as Record<string, unknown>;
    for (const m of Object.values(old.modes as Record<string, Record<string, unknown>>)) delete m.maxOutputTokens;
    return old as unknown as BotConfig;
  };

  it("maxOutputTokens olmayan eski sürümde sınır tanımsız kalır", () => {
    const cfg = normalizeBotConfig(oldConfig(), { frozen: true });
    assert.deepEqual([cfg.modes.genel.maxOutputTokens, cfg.modes.agro.maxOutputTokens, cfg.modes.fly.maxOutputTokens], [undefined, undefined, undefined]);
  });

  it("aynı kayıt taslak olarak normalize edilince varsayılanı alır", () => {
    const cfg = normalizeBotConfig(oldConfig());
    assert.deepEqual([cfg.modes.genel.maxOutputTokens, cfg.modes.agro.maxOutputTokens, cfg.modes.fly.maxOutputTokens], [700, 800, 900]);
  });

  it("sürümde kayıtlı sınır korunur (aralığa çekilerek)", () => {
    const c = defaultBotConfig();
    c.modes.genel.maxOutputTokens = 450;
    c.modes.fly.maxOutputTokens = 99999;
    const cfg = normalizeBotConfig(c, { frozen: true });
    assert.equal(cfg.modes.genel.maxOutputTokens, 450);
    assert.equal(cfg.modes.fly.maxOutputTokens, PERSONA_LIMITS.maxOutputTokens.max);
  });
});

describe("toneRule: prototip anahtarları", () => {
  it("'constructor' ve '__proto__' varsayılan tona düşer", () => {
    for (const bad of ["constructor", "__proto__", "toString", "hasOwnProperty"]) {
      assert.equal(toneRule(undefined, bad as never), TONES.dengeli.rule, bad);
    }
  });
});
