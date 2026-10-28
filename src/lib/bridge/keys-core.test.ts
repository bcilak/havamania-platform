import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BRIDGE_KEY_RE, bridgeKeyHint, generateBridgeKey, hashBridgeKey, isReservedDeviceId, matchKey, MAX_ACTIVE_KEYS, parseBearer } from "./keys-core";

const KEY = `hm_bk_${"A".repeat(43)}`;

describe("parseBearer", () => {
  it("doğru biçimde anahtarı döner", () => {
    assert.equal(parseBearer(`Bearer ${KEY}`), KEY);
    const generated = generateBridgeKey();
    assert.equal(parseBearer(`Bearer ${generated}`), generated);
  });

  it("eksik ya da fazla uzunlukta null döner", () => {
    assert.equal(parseBearer(`Bearer ${KEY.slice(0, -1)}`), null);
    assert.equal(parseBearer(`Bearer ${KEY}A`), null);
    assert.equal(parseBearer("Bearer hm_bk_"), null);
  });

  it("Bearer öneki yoksa ya da küçük harfliyse null döner", () => {
    assert.equal(parseBearer(KEY), null);
    assert.equal(parseBearer(`bearer ${KEY}`), null);
    assert.equal(parseBearer(`Bearer  ${KEY}`), null);
    assert.equal(parseBearer(`Bearer ${KEY} `), null);
  });

  it("başlık yoksa ya da yanlış önekliyse null döner", () => {
    assert.equal(parseBearer(null), null);
    assert.equal(parseBearer(undefined), null);
    assert.equal(parseBearer(""), null);
    assert.equal(parseBearer(`Bearer hm_pk_${"A".repeat(43)}`), null);
  });

  it("anahtar alfabesi dışındaki karakteri reddeder", () => {
    assert.equal(parseBearer(`Bearer hm_bk_${"A".repeat(42)}+`), null);
    assert.equal(parseBearer(`Bearer hm_bk_${"A".repeat(42)}\n`), null);
  });
});

describe("hashBridgeKey", () => {
  it("64 karakterlik hex verir ve anahtarı içermez", () => {
    const h = hashBridgeKey(KEY);
    assert.match(h, /^[0-9a-f]{64}$/);
    assert.ok(!h.includes("hm_bk_"));
  });

  it("aynı anahtar aynı özeti, farklı anahtarlar farklı özeti verir", () => {
    const a = generateBridgeKey();
    const b = generateBridgeKey();
    assert.equal(hashBridgeKey(a), hashBridgeKey(a));
    assert.notEqual(hashBridgeKey(a), hashBridgeKey(b));
  });
});

describe("matchKey", () => {
  const k1 = generateBridgeKey();
  const k2 = generateBridgeKey();
  const candidates = [
    { id: "1", keyHash: hashBridgeKey(k1) },
    { id: "2", keyHash: hashBridgeKey(k2) },
  ];

  it("doğru adayı bulur", () => {
    assert.equal(matchKey(hashBridgeKey(k1), candidates)?.id, "1");
    assert.equal(matchKey(hashBridgeKey(k2), candidates)?.id, "2");
  });

  it("yanlış anahtarda ve boş listede null döner", () => {
    assert.equal(matchKey(hashBridgeKey(generateBridgeKey()), candidates), null);
    assert.equal(matchKey(hashBridgeKey(k1), []), null);
  });

  it("bozuk uzunluktaki aday eşleşmez ve hata fırlatmaz", () => {
    assert.equal(matchKey(hashBridgeKey(k1), [{ id: "x", keyHash: "abcd" }]), null);
  });
});

describe("generateBridgeKey", () => {
  it("biçime uyar ve her seferinde farklıdır", () => {
    const keys = new Set(Array.from({ length: 20 }, () => generateBridgeKey()));
    assert.equal(keys.size, 20);
    for (const k of keys) assert.match(k, BRIDGE_KEY_RE);
  });

  it("ipucu son 4 karakterdir", () => {
    assert.equal(bridgeKeyHint(KEY), "AAAA");
    assert.equal(MAX_ACTIVE_KEYS, 2);
  });
});

describe("isReservedDeviceId", () => {
  it("bridge önekini büyük/küçük harf duyarsız ayırır", () => {
    assert.equal(isReservedDeviceId("bridge"), true);
    assert.equal(isReservedDeviceId("BRIDGE-123456"), true);
    assert.equal(isReservedDeviceId("Bridge"), true);
    assert.equal(isReservedDeviceId("web-bridge-1"), false);
    assert.equal(isReservedDeviceId("device-123456"), false);
  });
});
