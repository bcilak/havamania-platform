import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

describe("yerel depolama sürücüsü", () => {
  let dir: string;
  let storage: typeof import("./storage").storage;

  before(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "hm-storage-"));
    process.env.STORAGE_LOCAL_DIR = dir;
    delete process.env.STORAGE_DRIVER;
    storage = (await import("./storage")).storage;
  });

  after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("aynı anahtara iki kez yazınca ikinci içerik okunur ve .tmp dosyası kalmaz", async () => {
    await storage.put("photos/t/a.bin", new Uint8Array([1, 2, 3]), "application/octet-stream");
    await storage.put("photos/t/a.bin", new Uint8Array([9, 8]), "application/octet-stream");
    const got = await storage.get("photos/t/a.bin");
    assert.deepEqual(Array.from(got!.data), [9, 8]);
    const names = await fs.readdir(path.join(dir, "photos/t"));
    assert.deepEqual(names, ["a.bin"]);
  });

  it("yol dışına çıkan anahtarı reddeder", async () => {
    await assert.rejects(storage.put("../x", new Uint8Array([1]), "text/plain"), /Geçersiz dosya yolu/);
  });

  it("kanonik olmayan anahtarı yazma, okuma ve silmede reddeder", async () => {
    for (const k of ["./photos/a.jpg", "kb/../photos/a.jpg", "photos/%2e%2e/a.jpg", "photos\\a.jpg"]) {
      await assert.rejects(storage.put(k, new Uint8Array([1]), "image/jpeg"), /Geçersiz dosya yolu/);
      await assert.rejects(storage.get(k), /Geçersiz dosya yolu/);
      await assert.rejects(storage.remove(k), /Geçersiz dosya yolu/);
    }
  });
});

describe("canonicalKey", () => {
  it("mevcut anahtar biçimlerini kabul eder", async () => {
    const { canonicalKey, newStorageKey } = await import("./storage");
    const id = "0b7c4e1e-52c4-4e0f-9b0e-0d6c0e6a1f11";
    for (const k of [`photos/2026/10/${id}.jpg`, `photos/demo/${id}.svg`, `photos/smoke/${id}.pdf`, `kb/2026/01/${id}.docx`, `media/2026/01/${id}.png`, newStorageKey("photos", "webp")]) {
      assert.equal(canonicalKey(k), k);
    }
  });

  it("kanonik olmayan anahtarları reddeder", async () => {
    const { canonicalKey, assertKey, InvalidKeyError } = await import("./storage");
    const bad = [
      "", ".", "..", "./photos/a.jpg", "kb/../photos/a.jpg", "photos/demo/../a.jpg", "photos//a.jpg", "/photos/a.jpg", "photos/a.jpg/", "photos./a.jpg",
      "photos\\a.jpg", "photos%2Fa.jpg", "photos/%2e%2e/a.jpg", "photos/a\x00.jpg", "photos/a\n.jpg", "photos/a\x7f.jpg", "photos/a b.jpg", "photos/ç.jpg",
      "a/".repeat(300),
    ];
    for (const k of bad) {
      assert.equal(canonicalKey(k), null, JSON.stringify(k));
      assert.throws(() => assertKey(k), InvalidKeyError);
    }
  });
});
