import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { limitMessage, safeAdminPath } from "./form-limits";

describe("limitMessage", () => {
  it("sınır içindeki metin için null döner", () => {
    assert.equal(limitMessage("Talimat", 12000, 12000), null);
    assert.equal(limitMessage("Talimat", 12000, 0), null);
  });

  it("sınırı aşınca etiketi, sınırı ve mevcut uzunluğu söyler", () => {
    assert.equal(limitMessage("Talimat", 12000, 12001), "Talimat en fazla 12000 karakter olabilir (şu an 12001).");
  });
});

describe("safeAdminPath", () => {
  const fb = "/admin/fotograflar";
  it("panel içi göreli yolları (sorgu ve parça dahil) korur", () => {
    assert.equal(safeAdminPath("/admin/fotograflar?sayfa=2", fb), "/admin/fotograflar?sayfa=2");
    assert.equal(safeAdminPath("/admin/konusmalar/abc#m-1", fb), "/admin/konusmalar/abc#m-1");
  });

  it("dış adres, protokol, '//', ters eğik çizgi ve denetim karakterlerini reddeder", () => {
    for (const bad of ["", "https://evil.com", "//evil.com", "/\\evil.com", "/admin//evil.com", "/admin/\\evil", "/admin/x\r\nSet-Cookie: a=b", "/administrator", "admin/x", "javascript:alert(1)", "/baska/yol"]) {
      assert.equal(safeAdminPath(bad, fb), fb, bad);
    }
  });
});
