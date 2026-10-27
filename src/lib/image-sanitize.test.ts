import assert from "node:assert/strict";
import { describe, it } from "node:test";
import sharp from "sharp";
import { animated, EXIF_MARKER, gpsJpeg, pngWithChunk, pngWithText, solidPng } from "./image-fixtures";
import { cleanForServing, detectImageFormat, ensureClean, ImageRejectedError, inspectMetadata, sanitizeImage } from "./image-sanitize";

const has = (bytes: Uint8Array, s: string) => Buffer.from(bytes).includes(Buffer.from(s, "latin1"));
const rejects = (p: Promise<unknown>, code: string) =>
  assert.rejects(p, (e: unknown) => e instanceof ImageRejectedError && e.code === code);

describe("detectImageFormat", () => {
  it("magic byte ile jpeg, png, webp, gif ve heif'i tanır", async () => {
    assert.equal(detectImageFormat(await gpsJpeg()), "jpeg");
    assert.equal(detectImageFormat(await solidPng(2, 2)), "png");
    assert.equal(detectImageFormat(await animated("webp")), "webp");
    assert.equal(detectImageFormat(await animated("gif")), "gif");
    assert.equal(detectImageFormat(Buffer.from("\0\0\0\x18ftypheic\0\0\0\0", "latin1")), "heif");
  });

  it("AVIF (ana ya da uyumlu marka) HEIC sayılmaz", () => {
    assert.equal(detectImageFormat(Buffer.from("\0\0\0\x1cftypavif\0\0\0\0", "latin1")), "avif");
    assert.equal(detectImageFormat(Buffer.from("\0\0\0\x1cftypavis\0\0\0\0", "latin1")), "avif");
    assert.equal(detectImageFormat(Buffer.from("\0\0\0\x18ftypmif1\0\0\0\0miafavif", "latin1")), "avif");
    assert.equal(detectImageFormat(Buffer.from("\0\0\0\x18ftypmif1\0\0\0\0miafheic", "latin1")), "heif");
  });

  it("SVG, boş ve rastgele baytlar için null döner", () => {
    assert.equal(detectImageFormat(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>")), null);
    assert.equal(detectImageFormat(new Uint8Array()), null);
    assert.equal(detectImageFormat(Buffer.from("rastgele baytlar burada")), null);
  });
});

describe("sanitizeImage", () => {
  it("GPS'li JPEG fixture'ı gerçekten meta veri taşıyor (boş geçmeyi engeller)", async () => {
    const src = await gpsJpeg();
    const m = await sharp(src).metadata();
    assert.ok(m.exif);
    assert.equal(m.orientation, 6);
    assert.equal((await inspectMetadata(src)).hadGps, true);
    assert.ok(has(src, EXIF_MARKER));
  });

  it("JPEG: meta veriyi atar, yönü uygular (40x20 -> 20x40)", async () => {
    const out = await sanitizeImage(await gpsJpeg());
    const m = await sharp(out.data).metadata();
    assert.equal(m.exif, undefined);
    assert.equal(m.xmp, undefined);
    assert.equal(m.iptc, undefined);
    assert.equal(m.icc, undefined);
    assert.equal(m.orientation, undefined);
    assert.deepEqual([m.width, m.height], [20, 40]);
    assert.deepEqual([out.width, out.height], [20, 40]);
    assert.equal(out.mediaType, "image/jpeg");
    assert.equal(out.ext, "jpg");
    assert.ok(!has(out.data, "Exif\0\0"));
    assert.ok(!has(out.data, EXIF_MARKER));
    assert.equal((await inspectMetadata(out.data)).clean, true);
  });

  it("ICC profilini atar ve sRGB bırakır", async () => {
    const src = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#369" } }).jpeg().withIccProfile("p3").toBuffer();
    assert.ok((await sharp(src).metadata()).icc);
    const out = await sanitizeImage(src);
    const m = await sharp(out.data).metadata();
    assert.equal(m.icc, undefined);
    assert.equal(m.space, "srgb");
  });

  it("PNG tEXt parçasını atar", async () => {
    const src = pngWithText(await solidPng(1, 1), "Comment", "HM-PNG-MARKER");
    assert.ok(has(src, "HM-PNG-MARKER"));
    assert.ok((await sharp(src).metadata()).comments?.length);
    const out = await sanitizeImage(src);
    assert.ok(!has(out.data, "HM-PNG-MARKER"));
    assert.ok(!(await sharp(out.data).metadata()).comments?.length);
    assert.equal(out.mediaType, "image/png");
  });

  it("uzun kenarı 2560 px ile sınırlar, küçük görseli büyütmez", async () => {
    const big = await sanitizeImage(await solidPng(3000, 1000));
    assert.deepEqual([big.width, big.height], [2560, 853]);
    const small = await sanitizeImage(await solidPng(30, 10));
    assert.deepEqual([small.width, small.height], [30, 10]);
  });

  it("GIF ve WebP animasyonunu korur", async () => {
    for (const f of ["gif", "webp"] as const) {
      const out = await sanitizeImage(await animated(f));
      assert.equal(out.pages, 2, f);
      assert.equal((await sharp(out.data, { animated: true }).metadata()).pages, 2, f);
    }
  });

  it("outputFormat ile istenen biçimde kodlar", async () => {
    const out = await sanitizeImage(await solidPng(4, 4), { outputFormat: "jpeg" });
    assert.equal(out.mediaType, "image/jpeg");
    assert.equal(detectImageFormat(out.data), "jpeg");
  });

  it("SVG ve rastgele baytları format koduyla reddeder", async () => {
    await rejects(sanitizeImage(Buffer.from("<svg/>")), "format");
    await rejects(sanitizeImage(Buffer.from("hiç görsel değil, düz metin")), "format");
  });

  it("JPEG başlığıyla başlayan PNG gövdesini reddeder", async () => {
    const png = await solidPng(8, 8);
    const fake = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), png.subarray(3)]);
    // libvips biçimi içerikten koklar: JPEG olarak açıp bozuk başlıkta düşer, bu yüzden kod "decode" olur ("format" değil).
    await rejects(sanitizeImage(fake), "decode");
  });

  it("kesilmiş JPEG'i decode koduyla reddeder", async () => {
    const jpeg = await sharp({ create: { width: 200, height: 200, channels: 3, background: "#c00" } })
      .composite([{ input: Buffer.alloc(200 * 200 * 3, 7), raw: { width: 200, height: 200, channels: 3 } }])
      .jpeg()
      .toBuffer();
    await rejects(sanitizeImage(jpeg.subarray(0, Math.floor(jpeg.length * 0.6))), "decode");
  });

  it("HEIC'i heic koduyla reddeder", async () => {
    await rejects(sanitizeImage(Buffer.from("\0\0\0\x18ftypheic\0\0\0\0mif1heic", "latin1")), "heic");
  });

  it("küçük dosya / büyük boyut (dekompresyon bombası) ve çok kareli GIF pixels koduyla reddedilir", async () => {
    await rejects(sanitizeImage(await solidPng(1200, 1200), { maxPixels: 1_000_000 }), "pixels");
    await rejects(sanitizeImage(await animated("gif", 800, 800), { maxPixels: 1_000_000 }), "pixels");
  });

  it("idempotent: ikinci geçiş de temiz, ensureClean temiz girdide aynı diziyi döndürür", async () => {
    const once = await sanitizeImage(await gpsJpeg());
    const twice = await sanitizeImage(once.data);
    assert.equal((await inspectMetadata(twice.data)).clean, true);
    assert.equal(await ensureClean(once.data, "image/jpeg"), once.data);
  });
});

describe("ensureClean", () => {
  it("meta veri taşıyan eski dosyayı belleğe temizleyip döndürür, medya türünü korur", async () => {
    const src = await gpsJpeg();
    const out = await ensureClean(src, "image/jpeg");
    assert.notEqual(out, src);
    assert.equal((await inspectMetadata(out)).clean, true);
    assert.ok(!has(out, EXIF_MARKER));
  });

  it("HEIC ve görsel olmayan baytlarda hata fırlatır (fail-closed)", async () => {
    await rejects(ensureClean(Buffer.from("\0\0\0\x18ftypheic\0\0\0\0", "latin1"), "image/heic"), "heic");
    await rejects(ensureClean(Buffer.from("<svg/>"), "image/png"), "format");
  });
});

describe("AVIF", () => {
  it("sharp AV1 AVIF'i çözer: meta verisiz WebP olarak yeniden kodlanır", async () => {
    const avif = await sharp({ create: { width: 16, height: 8, channels: 3, background: "#0a0" } }).avif().toBuffer();
    assert.equal(detectImageFormat(avif), "avif");
    const out = await sanitizeImage(avif);
    assert.equal(out.format, "webp");
    assert.equal(out.mediaType, "image/webp");
    assert.equal((await inspectMetadata(out.data)).clean, true);
    const served = await cleanForServing(avif);
    assert.equal(served.mediaType, "image/webp");
  });
});

describe("inspectMetadata: JPEG kalıntıları", () => {
  // SOI'den sonra bir segment ekler.
  const withSegment = (jpeg: Uint8Array, marker: number, payload: Buffer) => {
    const seg = Buffer.concat([Buffer.from([0xff, marker, (payload.length + 2) >> 8, (payload.length + 2) & 0xff]), payload]);
    return Buffer.concat([Buffer.from(jpeg.subarray(0, 2)), seg, Buffer.from(jpeg.subarray(2))]);
  };
  const base = async () => (await sanitizeImage(await gpsJpeg())).data;

  it("sanitizeImage çıktısı temiz sayılır", async () => {
    assert.equal((await inspectMetadata(await base())).clean, true);
  });

  it("COM segmenti, APP2 (MPF) ve EOI sonrası veri temiz sayılmaz", async () => {
    const clean = Buffer.from(await base());
    assert.equal((await inspectMetadata(withSegment(clean, 0xfe, Buffer.from("HM-COM-MARKER")))).clean, false);
    assert.equal((await inspectMetadata(withSegment(clean, 0xe2, Buffer.from("MPF\x00\x00\x00\x00\x00")))).clean, false);
    assert.equal((await inspectMetadata(Buffer.concat([clean, Buffer.from("HM-TRAILING-MARKER")]))).clean, false);
  });

  it("kalıntılı dosya yeniden kodlanınca marker kalmaz", async () => {
    const dirty = withSegment(Buffer.from(await base()), 0xfe, Buffer.from("HM-COM-MARKER"));
    const out = await ensureClean(dirty, "image/jpeg");
    assert.ok(!has(out, "HM-COM-MARKER"));
    assert.equal((await inspectMetadata(out)).clean, true);
    const tail = await ensureClean(Buffer.concat([Buffer.from(await base()), Buffer.from("HM-TRAILING-MARKER")]), "image/jpeg");
    assert.ok(!has(tail, "HM-TRAILING-MARKER"));
  });
});

describe("cleanForServing", () => {
  it("uzantıdan bağımsız: içerik JPEG ise image/jpeg döner ve temizler", async () => {
    const out = await cleanForServing(await gpsJpeg());
    assert.equal(out.mediaType, "image/jpeg");
    assert.ok(!has(out.data, EXIF_MARKER));
    assert.equal((await inspectMetadata(out.data)).clean, true);
  });

  it("temiz girdide aynı diziyi ve içeriğin türünü döndürür", async () => {
    const png = await solidPng(4, 4);
    const out = await cleanForServing(png);
    assert.equal(out.data, png);
    assert.equal(out.mediaType, "image/png");
  });

  it("HEIC, SVG ve bilinmeyen biçimde hata fırlatır", async () => {
    await rejects(cleanForServing(Buffer.from("\x00\x00\x00\x18ftypheic\x00\x00\x00\x00mif1heic", "latin1")), "heic");
    await rejects(cleanForServing(Buffer.from("<svg/>")), "format");
    await rejects(cleanForServing(Buffer.from("%PDF-1.4 ...")), "format");
  });
});

describe("inspectMetadata: PNG kalıntıları", () => {
  const SIGNATURES = ["tEXt", "zTXt", "iTXt", "eXIf", "iCCP", "tIME", "prVt"];

  it("sharp'ın kendi PNG çıktısı (RGB, RGBA, palet, yeniden kodlanmış) temiz sayılır, yeniden kodlama döngüsü olmaz", async () => {
    const rgba = await sharp({ create: { width: 9, height: 7, channels: 4, background: "#0f08" } }).png().toBuffer();
    const palette = await sharp({ create: { width: 9, height: 7, channels: 4, background: "#0f08" } }).png({ palette: true }).toBuffer();
    for (const png of [await solidPng(9, 7), rgba, palette]) {
      assert.equal((await inspectMetadata(png)).clean, true);
      const out = await sanitizeImage(png);
      assert.equal((await inspectMetadata(out.data)).clean, true);
      const again = await cleanForServing(out.data);
      assert.equal(again.data, out.data); // temiz girdi aynı dizi: tekrar kodlanmaz
    }
  });

  it("tEXt/zTXt/iTXt/eXIf/iCCP/tIME ve özel ancillary parçalar temiz sayılmaz, yeniden kodlanınca kalmaz", async () => {
    const png = await solidPng(6, 6);
    for (const type of SIGNATURES) {
      const dirty = pngWithChunk(png, type, Buffer.from("HM-PNG-MARKER-" + type));
      assert.equal((await inspectMetadata(dirty)).clean, false, type);
      const out = await cleanForServing(dirty);
      assert.ok(!has(out.data, "HM-PNG-MARKER"), type);
      assert.equal((await inspectMetadata(out.data)).clean, true, type);
    }
  });

  it("IEND sonrası ve kesik PNG temiz sayılmaz", async () => {
    const png = await solidPng(6, 6);
    const trailing = Buffer.concat([png, Buffer.from("HM-TRAILING-MARKER")]);
    assert.equal((await inspectMetadata(trailing)).clean, false);
    assert.ok(!has((await cleanForServing(trailing)).data, "HM-TRAILING-MARKER"));
    assert.equal((await inspectMetadata(png.subarray(0, png.length - 12))).clean, false); // IEND yok
  });
});

describe("inspectMetadata: GIF kalıntıları", () => {
  // Logical screen descriptor + (varsa) genel renk tablosundan hemen sonra bir uzantı bloğu ekler.
  const withBlock = (gif: Uint8Array, block: Buffer) => {
    let at = 13;
    if (gif[10] & 0x80) at += 3 * (1 << ((gif[10] & 7) + 1));
    return Buffer.concat([Buffer.from(gif.subarray(0, at)), block, Buffer.from(gif.subarray(at))]);
  };
  const subBlocks = (data: Buffer) => Buffer.concat([Buffer.from([data.length]), data, Buffer.from([0])]);
  const comment = Buffer.concat([Buffer.from([0x21, 0xfe]), subBlocks(Buffer.from("HM-GIF-MARKER"))]);
  const xmp = Buffer.concat([Buffer.from([0x21, 0xff, 11]), Buffer.from("XMP DataXMP"), subBlocks(Buffer.from("HM-GIF-MARKER"))]);
  const plainText = Buffer.concat([Buffer.from([0x21, 0x01, 12]), Buffer.alloc(12), subBlocks(Buffer.from("HM-GIF-MARKER"))]);

  it("sharp'ın kendi GIF çıktısı (tek kare ve animasyonlu) temiz sayılır, yeniden kodlama döngüsü olmaz", async () => {
    const still = (await sanitizeImage(await solidPng(9, 7), { outputFormat: "gif" })).data;
    for (const gif of [still, await animated("gif")]) {
      assert.equal((await inspectMetadata(gif)).clean, true);
      const out = await sanitizeImage(gif);
      assert.equal((await inspectMetadata(out.data)).clean, true);
      assert.equal((await cleanForServing(out.data)).data, out.data);
    }
  });

  it("yorum, XMP/diğer uygulama uzantısı, düz metin ve trailer sonrası veri temiz sayılmaz; yeniden kodlanınca kalmaz", async () => {
    const gif = Buffer.from(await animated("gif"));
    const cases: Record<string, Buffer> = {
      comment: withBlock(gif, comment),
      xmp: withBlock(gif, xmp),
      plainText: withBlock(gif, plainText),
      trailing: Buffer.concat([gif, Buffer.from("HM-GIF-MARKER")]),
    };
    for (const [name, dirty] of Object.entries(cases)) {
      assert.equal((await inspectMetadata(dirty)).clean, false, name);
      const out = await cleanForServing(dirty);
      assert.ok(!has(out.data, "HM-GIF-MARKER"), name);
      assert.equal((await inspectMetadata(out.data)).clean, true, name);
      assert.equal(out.mediaType, "image/gif");
    }
  });

  it("kesik GIF (trailer yok) temiz sayılmaz", async () => {
    const gif = await animated("gif");
    assert.equal((await inspectMetadata(gif.subarray(0, gif.length - 1))).clean, false);
  });
});

describe("sanitizeImage: çok kareli girdi", () => {
  it("JPEG/PNG çıktıda yalnızca ilk kare alınır; GIF/WebP çıktıda tüm kareler korunur", async () => {
    for (const src of ["gif", "webp"] as const) {
      const input = await animated(src);
      for (const outputFormat of ["jpeg", "png"] as const) {
        const out = await sanitizeImage(input, { outputFormat });
        assert.equal(out.pages, 1, `${src}->${outputFormat}`);
        assert.equal(out.height, 8);
      }
      assert.equal((await sanitizeImage(input)).pages, 2, src);
    }
  });
});
