import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkApiUrl, resolveApiTarget } from "./api-url-guard";

const lookupTo = (address: string) => async () => [{ address, family: address.includes(":") ? 6 : 4 }];

describe("checkApiUrl", () => {
  it("gevşetme açıkken loopback http (sahte servis) geçer", async () => {
    for (const u of ["http://127.0.0.1:3199", "http://localhost:3199/api", "http://[::1]:3199", "https://127.0.0.1:3199"]) {
      assert.deepEqual(await checkApiUrl(new URL(u), { allowLocal: true, lookup: lookupTo("127.0.0.1") }), { ok: true }, u);
    }
  });

  it("gevşetme açıkken bile metadata, özel ağ ve loopback dışı http reddedilir", async () => {
    const o = { allowLocal: true, lookup: lookupTo("93.184.216.34") };
    assert.deepEqual(await checkApiUrl(new URL("http://169.254.169.254/latest"), o), { ok: false, reason: "not_https" });
    assert.deepEqual(await checkApiUrl(new URL("https://169.254.169.254/latest"), o), { ok: false, reason: "blocked" });
    assert.deepEqual(await checkApiUrl(new URL("https://10.0.0.5"), o), { ok: false, reason: "blocked" });
    assert.deepEqual(await checkApiUrl(new URL("http://api.example.com"), o), { ok: false, reason: "not_https" });
    assert.deepEqual(await checkApiUrl(new URL("ftp://127.0.0.1"), o), { ok: false, reason: "not_https" });
    assert.deepEqual(await checkApiUrl(new URL("http://u:p@127.0.0.1:3199"), o), { ok: false, reason: "blocked" });
    // ad localhost'a benziyor ama iç ağa çözülüyor
    assert.deepEqual(await checkApiUrl(new URL("http://app.localhost:3199"), { allowLocal: true, lookup: lookupTo("169.254.169.254") }), { ok: false, reason: "blocked" });
  });

  it("gevşetme kapalıyken (üretim) 127.0.0.1 http reddedilir", async () => {
    assert.deepEqual(await checkApiUrl(new URL("http://127.0.0.1:3199"), { allowLocal: false }), { ok: false, reason: "not_https" });
  });

  it("ortam: değişken + localhost APP_URL gevşek; APP_URL canlı veya değişken yok -> katı", async () => {
    const env = process.env as Record<string, string | undefined>;
    const before = { f: env.ALLOW_LOCAL_TARGETS, a: env.APP_URL };
    const url = new URL("http://127.0.0.1:3199");
    try {
      env.ALLOW_LOCAL_TARGETS = "1";
      env.APP_URL = "http://localhost:3110";
      assert.deepEqual(await checkApiUrl(url), { ok: true });
      env.APP_URL = "https://havamania.com";
      assert.deepEqual(await checkApiUrl(url), { ok: false, reason: "not_https" });
      env.APP_URL = "http://localhost:3110";
      delete env.ALLOW_LOCAL_TARGETS;
      assert.deepEqual(await checkApiUrl(url), { ok: false, reason: "not_https" });
    } finally {
      for (const [k, v] of [["ALLOW_LOCAL_TARGETS", before.f], ["APP_URL", before.a]] as const) {
        if (v === undefined) delete env[k];
        else env[k] = v;
      }
    }
  });

  it("üretimde https dışı reddedilir", async () => {
    const r = await checkApiUrl(new URL("http://api.example.com"), { allowLocal: false, lookup: lookupTo("93.184.216.34") });
    assert.deepEqual(r, { ok: false, reason: "not_https" });
  });

  it("üretimde loopback, özel, link-local ve metadata adresleri reddedilir", async () => {
    for (const host of ["https://127.0.0.1", "https://10.0.0.5", "https://169.254.169.254", "https://[::1]", "https://localhost"]) {
      const r = await checkApiUrl(new URL(host), { allowLocal: false, lookup: lookupTo("127.0.0.1") });
      assert.deepEqual(r, { ok: false, reason: "blocked" }, host);
    }
  });

  it("adı herkese açık ama iç adrese çözülen ana makine reddedilir", async () => {
    const r = await checkApiUrl(new URL("https://api.example.com"), { allowLocal: false, lookup: lookupTo("169.254.169.254") });
    assert.deepEqual(r, { ok: false, reason: "blocked" });
  });

  it("genel adrese çözülen https adresi geçer; kimlik bilgisi reddedilir", async () => {
    const lookup = lookupTo("93.184.216.34");
    assert.deepEqual(await checkApiUrl(new URL("https://api.example.com/v2"), { allowLocal: false, lookup }), { ok: true });
    assert.deepEqual(await checkApiUrl(new URL("https://u:p@api.example.com"), { allowLocal: false, lookup }), { ok: false, reason: "blocked" });
  });
});

describe("resolveApiTarget", () => {
  it("doğrulanan IP'yi döner (isteğin sabitleneceği adres)", async () => {
    assert.deepEqual(await resolveApiTarget(new URL("https://api.example.com/v1"), { allowLocal: false, lookup: lookupTo("93.184.216.34") }), {
      ok: true,
      address: "93.184.216.34",
    });
    assert.deepEqual(await resolveApiTarget(new URL("http://127.0.0.1:3199"), { allowLocal: true }), { ok: true, address: "127.0.0.1" });
  });

  it("iç ağa çözülen adı reddeder", async () => {
    assert.deepEqual(await resolveApiTarget(new URL("https://api.example.com"), { allowLocal: false, lookup: lookupTo("10.0.0.5") }), { ok: false, reason: "blocked" });
  });
});
