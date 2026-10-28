import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { healthConsentGiven, KVKK_DEFAULT_CONSENT_DATE, renderConsentText, renderHealthConsentText, resolveConsentUpdatedAt, usesToken } from "./consent";
import { LEGAL_DEFAULTS } from "./legal";
import { KVKK_DEFAULTS } from "./kvkk-defaults";

describe("renderConsentText", () => {
  const kvkk = KVKK_DEFAULTS;

  it("varsayılan metinde yer tutucular dolar ve {{ kalmaz", () => {
    const out = renderConsentText(kvkk, { company: "Örnek AŞ" }, "https://havamania.com/");
    assert.ok(!out.includes("{{"));
    assert.ok(out.includes("Örnek AŞ"));
    assert.ok(out.includes("en fazla 180 gün"));
    assert.ok(out.includes("https://havamania.com/kvkk"));
  });

  it("saklama süresi sabit değil ayardan gelir", () => {
    const out = renderConsentText({ ...kvkk, retentionDays: 30 }, LEGAL_DEFAULTS, "https://x.test");
    assert.ok(out.includes("en fazla 30 gün"));
    assert.ok(!out.includes("180"));
  });

  it("varsayılan asistan metni yurt dışı aktarımı belirtir; sağlık paragrafı içermez (widget sağlık verisi toplamaz)", () => {
    const out = renderConsentText(kvkk, LEGAL_DEFAULTS, "https://x.test");
    assert.match(out, /yurt dışındaki yapay zekâ hizmet sağlayıcılarına aktarılır/);
    assert.doesNotMatch(out, /sağlık|m\. 6|ayrı ayrı/i);
    assert.equal(kvkk.consentVersion, 2);
  });

  it("sağlık rızası ayrı metin ve ayrı sürümdür: m. 6, yurt dışı aktarım, isteğe bağlılık ve yer tutucular dolar", () => {
    const out = renderHealthConsentText(kvkk, { company: "Örnek AŞ" }, "https://havamania.com/");
    assert.match(out, /m\. 6/);
    assert.match(out, /yurt dışındaki yapay zekâ hizmet sağlayıcılarına aktarılmasına ayrıca açık rıza/);
    assert.match(out, /isteğe bağlı/);
    assert.match(out, /asistanın cevapları bu bilgiye dayanabilir ve cevaplar konuşma kaydında saklama süresince tutulur \(en fazla 180 gün\)/);
    assert.ok(out.includes("Örnek AŞ") && out.includes("https://havamania.com/kvkk"));
    assert.ok(!out.includes("{{"));
    assert.equal(kvkk.healthConsentVersion, 2, "metin değişti: sürüm 1 -> 2");
    assert.notEqual(out, renderConsentText(kvkk, { company: "Örnek AŞ" }, "https://havamania.com/"));
  });

  it("boş şirket adında yedek unvan kullanılır; tanımsız yer tutucu olduğu gibi kalır", () => {
    const out = renderConsentText({ consentText: "{{sirket}} {{bilinmeyen}}", retentionDays: 1 }, { company: "  " }, "https://x.test");
    assert.equal(out, "Altıkod Digital Solutions {{bilinmeyen}}");
  });
});

describe("healthConsentGiven", () => {
  it("yalnızca health_consent true VE sürüm güncelse true", () => {
    assert.equal(healthConsentGiven({ health_consent: true, health_consent_version: 3 }, 3), true);
    assert.equal(healthConsentGiven({ health_consent: true, health_consent_version: 2 }, 3), false, "eski sürüm");
    assert.equal(healthConsentGiven({ health_consent: true }, 3), false, "sürüm yok");
    assert.equal(healthConsentGiven({ health_consent: true, health_consent_version: null }, 3), false);
    assert.equal(healthConsentGiven({ health_consent: false, health_consent_version: 3 }, 3), false);
    assert.equal(healthConsentGiven({ health_consent: null, health_consent_version: 3 }, 3), false);
    assert.equal(healthConsentGiven({}, 3), false);
  });
});

describe("resolveConsentUpdatedAt", () => {
  it("sıra: consentUpdatedAt, ayar satırı, sabit varsayılan", () => {
    const row = new Date("2026-09-01T10:00:00Z");
    assert.equal(resolveConsentUpdatedAt("2026-10-01T00:00:00Z", row), "2026-10-01T00:00:00.000Z");
    assert.equal(resolveConsentUpdatedAt(null, row), "2026-09-01T10:00:00.000Z");
    assert.equal(resolveConsentUpdatedAt(null, null), KVKK_DEFAULT_CONSENT_DATE);
    assert.equal(resolveConsentUpdatedAt("bozuk", undefined), KVKK_DEFAULT_CONSENT_DATE);
  });
});

describe("usesToken", () => {
  it("yer tutucuyu algılar", () => {
    assert.ok(usesToken("a {{saklama}} b", "{{saklama}}"));
    assert.ok(!usesToken("a b", "{{sirket}}"));
  });
});
