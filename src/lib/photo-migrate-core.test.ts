import assert from "node:assert/strict";
import { describe, it } from "node:test";
import sharp from "sharp";
import { gpsJpeg, solidPng } from "./image-fixtures";
import { inspectMetadata } from "./image-sanitize";
import { processPhoto, rowNeedsUpdate } from "./photo-migrate-core";

describe("processPhoto", () => {
  it("GPS'li JPEG'i temizler ve hadGps bildirir", async () => {
    const r = await processPhoto(await gpsJpeg(), { keyExt: "jpg" });
    assert.equal(r.outcome, "cleaned");
    assert.equal(r.hadGps, true);
    assert.equal(r.mediaType, "image/jpeg");
    assert.equal(r.afterBytes, r.data!.byteLength);
    assert.equal((await inspectMetadata(r.data!)).clean, true);
  });

  it("çıktıyı yeniden işlemek already_clean verir (idempotent)", async () => {
    const first = await processPhoto(await gpsJpeg(), { keyExt: "jpg" });
    const again = await processPhoto(first.data!, { keyExt: "jpg" });
    assert.equal(again.outcome, "already_clean");
    assert.equal(again.hadGps, false);
    assert.equal(again.data, undefined);
  });

  it("HEIC unsupported döner", async () => {
    const heic = Buffer.from("\0\0\0\x18ftypheic\0\0\0\0mif1heic", "latin1");
    assert.equal((await processPhoto(heic, { keyExt: "jpg" })).outcome, "unsupported");
    assert.equal((await processPhoto(heic, { keyExt: "jpg" })).reason, "heic");
    assert.equal((await processPhoto(heic, { keyExt: "bin" })).outcome, "unsupported");
  });

  it("bozuk dosyada fırlatmaz, failed döner", async () => {
    const jpeg = await gpsJpeg();
    assert.equal((await processPhoto(jpeg.subarray(0, 40), { keyExt: "jpg" })).outcome, "failed");
    assert.equal((await processPhoto(Buffer.from("görsel değil"), { keyExt: "png" })).outcome, "failed");
  });

  it("uzantısı .jpg olan PNG image/jpeg çıktı verir", async () => {
    const png = await sharp({ create: { width: 8, height: 8, channels: 4, background: "#08c" } }).png().withMetadata({ orientation: 6 }).toBuffer();
    const r = await processPhoto(png, { keyExt: "jpg" });
    assert.equal(r.outcome, "cleaned");
    assert.equal(r.mediaType, "image/jpeg");
    assert.equal((await sharp(r.data!).metadata()).format, "jpeg");
  });

  it("piksel sınırını aşan dosyada too_large döner", async () => {
    const meta = await processPhoto(await solidPng(1200, 1200), { keyExt: "png", maxPixels: 1_000_000 });
    // Temiz PNG zaten already_clean sayılır; sınır yalnızca yeniden kodlama gerektiğinde işler.
    assert.equal(meta.outcome, "already_clean");
    const big = await sharp({ create: { width: 1200, height: 1200, channels: 3, background: "#c00" } }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    assert.equal((await processPhoto(big, { keyExt: "jpg", maxPixels: 1_000_000 })).outcome, "too_large");
  });
});

describe("processPhoto: içerik koklama", () => {
  it(".bin/.pdf/.svg/.heic anahtarlı GPS'li JPEG temizlenir, yanlış uzantı işaretlenir, JPEG olarak kalır", async () => {
    for (const keyExt of ["bin", "pdf", "svg", "txt", "heic"]) {
      const r = await processPhoto(await gpsJpeg(), { keyExt });
      assert.equal(r.outcome, "cleaned", keyExt);
      assert.equal(r.extMismatch, true, keyExt);
      assert.equal(r.hadGps, true, keyExt);
      assert.equal(r.mediaType, "image/jpeg", keyExt);
      assert.equal((await inspectMetadata(r.data!)).clean, true, keyExt);
    }
  });

  it("uzantısı doğru dosyada extMismatch false; temiz yanlış uzantılı dosya already_clean ve gerçek türü bildirir", async () => {
    assert.equal((await processPhoto(await gpsJpeg(), { keyExt: "jpg" })).extMismatch, false);
    const clean = await processPhoto(await solidPng(4, 4), { keyExt: "bin" });
    assert.equal(clean.outcome, "already_clean");
    assert.equal(clean.extMismatch, true);
    assert.equal(clean.mediaType, "image/png");
  });

  it("tanınmayan içerik (SVG baytları) failed/unreadable, HEIC unsupported/heic olarak ayrı sayılır", async () => {
    const svg = await processPhoto(Buffer.from("<svg/>"), { keyExt: "svg" });
    assert.deepEqual([svg.outcome, svg.reason], ["failed", "unreadable"]);
  });
});

describe("rowNeedsUpdate (put başarılı, db.update başarısız senaryosu)", () => {
  it("dosya temiz ama satır eski size/media_type taşıyorsa düzeltme ister; uyuşuyorsa istemez", async () => {
    const cleaned = await processPhoto(await gpsJpeg(), { keyExt: "bin" });
    // Önceki çalıştırma: dosya yazıldı (artık temiz) ama satır ham boyut ve eski türle kaldı.
    const onDisk = cleaned.data!;
    const again = await processPhoto(onDisk, { keyExt: "bin" });
    assert.equal(again.outcome, "already_clean");
    assert.equal(rowNeedsUpdate({ size: 123456, mediaType: "image/heif" }, again), true);
    assert.equal(rowNeedsUpdate({ size: onDisk.byteLength, mediaType: "image/heif" }, again), true);
    assert.equal(rowNeedsUpdate({ size: 123456, mediaType: "image/jpeg" }, again), true);
    assert.equal(rowNeedsUpdate({ size: onDisk.byteLength, mediaType: "image/jpeg" }, again), false);
  });

  it("temizlenemeyen sonuçlar için satıra dokunmaz", async () => {
    const heic = Buffer.from("\x00\x00\x00\x18ftypheic\x00\x00\x00\x00mif1heic", "latin1");
    assert.equal(rowNeedsUpdate({ size: 1, mediaType: "image/heic" }, await processPhoto(heic, { keyExt: "bin" })), false);
    assert.equal(rowNeedsUpdate({ size: 1, mediaType: "image/jpeg" }, await processPhoto(Buffer.from("x"), { keyExt: "jpg" })), false);
  });
});
