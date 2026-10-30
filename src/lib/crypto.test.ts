import assert from "node:assert/strict";
import crypto from "node:crypto";
import { afterEach, describe, it } from "node:test";
import { deriveKey, hmac } from "./crypto";

const original = process.env.ENCRYPTION_KEY;
const keyOf = (fill: number) => Buffer.alloc(32, fill).toString("base64");

afterEach(() => {
  if (original === undefined) delete process.env.ENCRYPTION_KEY;
  else process.env.ENCRYPTION_KEY = original;
});

describe("deriveKey (HKDF-SHA256)", () => {
  it("32 bayt döner, ana anahtardan farklıdır ve aynı girdi aynı sonucu verir", () => {
    process.env.ENCRYPTION_KEY = keyOf(7);
    const a = deriveKey("bridge-request:v1");
    assert.equal(a.length, 32);
    assert.ok(!a.equals(Buffer.alloc(32, 7)));
    assert.ok(deriveKey("bridge-request:v1").equals(a));
  });

  it("RFC 5869 ile uyumlu: boş tuz, info etiketi, 32 bayt çıktı", () => {
    process.env.ENCRYPTION_KEY = keyOf(7);
    const expected = Buffer.from(crypto.hkdfSync("sha256", Buffer.alloc(32, 7), Buffer.alloc(0), "bridge-request:v1", 32));
    assert.ok(deriveKey("bridge-request:v1").equals(expected));
  });

  it("farklı info ya da farklı ana anahtar farklı alt anahtar üretir; ortam değişince önbellek yenilenir", () => {
    process.env.ENCRYPTION_KEY = keyOf(1);
    const a = deriveKey("bridge-request:v1");
    assert.ok(!deriveKey("baska-amac").equals(a));
    process.env.ENCRYPTION_KEY = keyOf(2);
    assert.ok(!deriveKey("bridge-request:v1").equals(a));
  });

  it("anahtar eksik, bozuk ya da 32 bayt değilse hata fırlatır", () => {
    delete process.env.ENCRYPTION_KEY;
    assert.throws(() => deriveKey("x"), /ENCRYPTION_KEY/);
    process.env.ENCRYPTION_KEY = Buffer.alloc(16, 1).toString("base64");
    assert.throws(() => deriveKey("x"), /32 bayt/);
    process.env.ENCRYPTION_KEY = "";
    assert.throws(() => deriveKey("x"), /ENCRYPTION_KEY/);
  });

  it("hmac Buffer anahtarı kabul eder ve string ile aynı baytlarda aynı sonucu verir", () => {
    const k = Buffer.from("abc");
    assert.equal(hmac("veri", k), hmac("veri", "abc"));
  });
});
