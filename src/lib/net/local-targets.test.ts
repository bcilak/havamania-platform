import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isLoopbackAddress, isLoopbackHost, localTargetsAllowed } from "./local-targets";

describe("isLoopbackHost", () => {
  it("loopback ad ve IP'leri tanır", () => {
    for (const h of ["localhost", "LOCALHOST.", "app.localhost", "127.0.0.1", "127.9.9.9", "::1", "[::1]"]) assert.equal(isLoopbackHost(h), true, h);
  });

  it("diğerlerini tanımaz (metadata, özel ağ, canlı alan adı)", () => {
    for (const h of ["havamania.com", "localhost.evil.com", "evil-localhost", "169.254.169.254", "10.0.0.5", "0.0.0.0", "128.0.0.1", "fe80::1", "::ffff:127.0.0.1", ""]) {
      assert.equal(isLoopbackHost(h), false, h);
    }
  });

  it("isLoopbackAddress yalnızca IP literal'i kabul eder", () => {
    assert.equal(isLoopbackAddress("127.0.0.1"), true);
    assert.equal(isLoopbackAddress("::1"), true);
    assert.equal(isLoopbackAddress("localhost"), false);
    assert.equal(isLoopbackAddress("169.254.169.254"), false);
  });
});

describe("localTargetsAllowed", () => {
  it("değişken + localhost APP_URL -> gevşek", () => {
    for (const app of ["http://localhost:3110", "http://127.0.0.1:3110", "http://[::1]:3110", "http://dev.localhost:3110"]) {
      assert.equal(localTargetsAllowed({ ALLOW_LOCAL_TARGETS: "1", APP_URL: app }), true, app);
    }
    assert.equal(localTargetsAllowed({ ALLOW_LOCAL_TARGETS: "true", APP_URL: "http://localhost:3110" }), true);
  });

  it("APP_URL canlı alan adı -> değişken olsa da katı", () => {
    for (const app of ["https://havamania.com", "https://localhost.havamania.com", "http://10.0.0.5:3110", "http://169.254.169.254"]) {
      assert.equal(localTargetsAllowed({ ALLOW_LOCAL_TARGETS: "1", APP_URL: app }), false, app);
    }
  });

  it("değişken yok/geçersiz -> katı (üretim varsayılanı)", () => {
    assert.equal(localTargetsAllowed({ APP_URL: "http://localhost:3110" }), false);
    assert.equal(localTargetsAllowed({ ALLOW_LOCAL_TARGETS: "0", APP_URL: "http://localhost:3110" }), false);
    assert.equal(localTargetsAllowed({ ALLOW_LOCAL_TARGETS: "yes", APP_URL: "http://localhost:3110" }), false);
    assert.equal(localTargetsAllowed({}), false);
  });

  it("APP_URL yok veya bozuk -> katı", () => {
    assert.equal(localTargetsAllowed({ ALLOW_LOCAL_TARGETS: "1" }), false);
    assert.equal(localTargetsAllowed({ ALLOW_LOCAL_TARGETS: "1", APP_URL: "not a url" }), false);
  });

  it("NODE_ENV karara etki etmez", () => {
    assert.equal(localTargetsAllowed({ ALLOW_LOCAL_TARGETS: "1", APP_URL: "http://localhost:3110", NODE_ENV: "production" }), true);
  });
});
