import assert from "node:assert/strict";
import { crc32, deflateRawSync } from "node:zlib";
import { describe, it } from "node:test";
import { chunkText } from "./chunking";
import { DOCX_INVALID_ERROR, DOCX_TOO_BIG_ERROR, decodeText, docxToText, htmlToText, inflatedZipSize, pdfPagesToText, SCANNED_PDF_WARNING, zipUncompressedSize } from "./extract-text";
import { planIngest } from "./ingest-core";

/** Sıkıştırmasız, en küçük geçerli ZIP: DOCX fixture'ı testte üretmek için (yeni bağımlılık gerekmez). */
function zip(files: Record<string, string>): Uint8Array {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const nameB = Buffer.from(name);
    const data = Buffer.from(content, "utf8");
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x21, 12); // tarih: 1980-01-01
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameB.length, 26);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0x21, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(data.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameB.length, 28);
    cd.writeUInt32LE(offset, 42);
    parts.push(local, nameB, data);
    central.push(cd, nameB);
    offset += local.length + nameB.length + data.length;
  }
  const cdBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(cdBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...parts, cdBuf, end]));
}

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const para = (text: string, style?: string) =>
  `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ""}<w:r><w:t>${text}</w:t></w:r></w:p>`;
const cell = (text: string) => `<w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/></w:tcPr>${para(text)}</w:tc>`;
const row = (cells: string[], header = false) => `<w:tr>${header ? "<w:trPr><w:tblHeader/></w:trPr>" : ""}${cells.map(cell).join("")}</w:tr>`;
const table = (rows: string) => `<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid>${rows}</w:tbl>`;

function docx(body: string): Uint8Array {
  return zip({
    "[Content_Types].xml":
      '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>',
    "_rels/.rels":
      '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    "word/_rels/document.xml.rels":
      '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
    "word/styles.xml": `<?xml version="1.0" encoding="UTF-8"?><w:styles ${W}><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/></w:style></w:styles>`,
    "word/document.xml": `<?xml version="1.0" encoding="UTF-8"?><w:document ${W}><w:body>${body}</w:body></w:document>`,
  });
}

describe("docxToText", () => {
  const sample = docx(
    para("Sulama Rehberi", "Heading1") +
      para("Genel bilgi paragrafı.") +
      para("Sebze Takvimi", "Heading2") +
      table(row(["Ürün", "Dikim ayı"], true) + row(["Domates", "Nisan"]) + row(["Biber", "Mayıs"])) +
      para("Tablodan sonraki not."),
  );

  it("başlıkları # işaretleriyle, tablo satırlarını 'Başlık: değer' olarak çıkarır", async () => {
    const text = await docxToText(sample);
    assert.match(text, /^# Sulama Rehberi\n\nGenel bilgi paragrafı\.\n\n## Sebze Takvimi\n\n/);
    assert.ok(text.includes("Ürün: Domates | Dikim ayı: Nisan\nÜrün: Biber | Dikim ayı: Mayıs"), text);
    assert.ok(text.endsWith("Tablodan sonraki not."));
  });

  it("parçalarda başlık bağlamı ve tablo hücre metni bulunur", async () => {
    const out = chunkText(await docxToText(sample));
    assert.equal(out.length, 2);
    assert.ok(out[0].startsWith("Bölüm: Sulama Rehberi\n"));
    assert.ok(out[1].startsWith("Bölüm: Sulama Rehberi › Sebze Takvimi\n"));
    assert.ok(out[1].includes("Dikim ayı: Mayıs"));
  });

  it("başlık satırı işaretlenmemiş tabloda hücreler ' | ' ile birleşir", async () => {
    const text = await docxToText(docx(table(row(["Ürün", "Ay"]) + row(["Domates", "Nisan"]))));
    assert.equal(text, "Ürün | Ay\nDomates | Nisan");
  });
});

describe("htmlToText", () => {
  it("h1-h3 başlık işaretine, h4+ düz metne dönüşür; script/style atılır", () => {
    const t = htmlToText("<h1>Ana</h1><h2>Alt</h2><h3>Daha alt</h3><h4>Küçük</h4><p>Gövde <b>kalın</b> metin.</p><script>x()</script><style>p{}</style>");
    assert.equal(t, "# Ana\n\n## Alt\n\n### Daha alt\n\nKüçük\n\nGövde kalın metin.");
  });

  it("th başlıklı tabloda başlık etiketleri satıra yazılır, boş hücre atlanır", () => {
    const t = htmlToText("<table><tr><th>Ad</th><th>Değer</th><th>Not</th></tr><tr><td>A</td><td>1</td><td></td></tr><tr><td></td><td></td><td></td></tr></table>");
    assert.equal(t, "Ad: A | Değer: 1");
  });

  it("liste öğeleri satır başına '- ' ile gelir", () => {
    assert.equal(htmlToText("<ul><li>bir</li><li>iki</li></ul>"), "- bir\n\n- iki");
  });

  it("iç içe tabloda satırlar çiftlenmez", () => {
    const t = htmlToText("<table><tr><td>dış</td><td><table><tr><td>iç</td></tr></table></td></tr></table>");
    assert.equal(t, "dış | iç");
  });
});

describe("decodeText", () => {
  const bytes = (...b: number[]) => new Uint8Array(b);

  it("geçerli UTF-8'i olduğu gibi okur, not düşmez", () => {
    const r = decodeText(new TextEncoder().encode("Şanlıurfa'da ığdır çiçek"));
    assert.equal(r.text, "Şanlıurfa'da ığdır çiçek");
    assert.equal(r.encoding, "utf-8");
    assert.equal(r.note, null);
  });

  it("UTF-8 BOM'u atar", () => {
    const r = decodeText(bytes(0xef, 0xbb, 0xbf, 0x61, 0x62));
    assert.equal(r.text, "ab");
    assert.equal(r.encoding, "utf-8");
  });

  it("Windows-1254 kodlu 'ğüşıöç' doğru çözülür ve uyarı notu verilir", () => {
    const r = decodeText(bytes(0xf0, 0xfc, 0xfe, 0xfd, 0xf6, 0xe7));
    assert.equal(r.text, "ğüşıöç");
    assert.equal(r.encoding, "windows-1254");
    assert.match(r.note ?? "", /Windows-1254/);
  });

  it("Windows-1254 büyük harfler ve gerçek bir cümle", () => {
    // "İĞŞ Çocuk Öğün Ürün" : İ=DD Ğ=D0 Ş=DE Ç=C7 Ö=D6 Ü=DC
    const raw = bytes(0xdd, 0xd0, 0xde, 0x20, 0xc7, 0x6f, 0x63, 0x75, 0x6b, 0x20, 0xd6, 0xf0, 0xfc, 0x6e, 0x20, 0xdc, 0x72, 0xfc, 0x6e);
    assert.equal(decodeText(raw).text, "İĞŞ Çocuk Öğün Ürün");
  });

  it("çoğunlukla geçerli UTF-8 içinde tek bozuk bayt Windows-1254'e düşürmez", () => {
    const good = new TextEncoder().encode("Şu çiçekler öğle ığdır güneş ".repeat(5));
    const mixed = new Uint8Array([...good, 0xff]);
    const r = decodeText(mixed);
    assert.equal(r.encoding, "utf-8");
    assert.ok(r.text.startsWith("Şu çiçekler"));
    assert.ok(r.note);
  });

  it("UTF-16 LE BOM'lu dosyayı çözer", () => {
    const r = decodeText(bytes(0xff, 0xfe, 0x1e, 0x01, 0x61, 0x00)); // Ğ a
    assert.equal(r.text, "Ğa");
    assert.equal(r.encoding, "utf-16le");
  });

  it("Windows-1254 metin planIngest ile kaynak uyarısına yazılır", async () => {
    const { text, note } = decodeText(bytes(0x53, 0x75, 0x6c, 0x61, 0x6d, 0x61, 0x20, 0xfe, 0x75, 0x20, 0x67, 0xfc, 0x6e));
    assert.equal(text, "Sulama şu gün");
    const plan = await planIngest({ rawText: text, chunk: chunkText, embed: null, notes: [note] });
    assert.equal(plan.warning, "Metin Windows-1254 (Türkçe) kodlamasıyla okundu.");
  });
});

describe("pdfPagesToText", () => {
  it("yeterli metinli sayfalarda uyarı yok", () => {
    const r = pdfPagesToText(["Birinci sayfanın yeterince uzun metni.", "İkinci sayfanın da yeterince uzun metni."]);
    assert.equal(r.warning, null);
    assert.ok(r.text.includes("\n\n"));
  });

  it("sayfa başına 20 karakterin altında metin taranmış PDF uyarısı verir", () => {
    const r = pdfPagesToText(["1", "", "", "iii", "", "", "", "", "", ""]);
    assert.equal(r.warning, SCANNED_PDF_WARNING);
  });

  it("hiç metin yoksa hata fırlatır", () => {
    assert.throws(() => pdfPagesToText(["", "  \n "]), /taranmış PDF olabilir/);
  });
});

describe("docxToText (zip bombası)", () => {
  /** Merkezi dizindeki ilk girdinin açılmış boyutunu yamar (sahte büyük boyut). */
  function withDeclaredSize(data: Uint8Array, size: number): Uint8Array {
    const copy = new Uint8Array(data);
    const dv = new DataView(copy.buffer);
    const eocd = copy.length - 22;
    dv.setUint32(dv.getUint32(eocd + 16, true) + 24, size, true);
    return copy;
  }

  it("normal DOCX'in boyutu okunur ve işlenir", async () => {
    const d = docx(para("Merhaba"));
    const size = zipUncompressedSize(d);
    assert.ok(size > 0 && size < 10_000);
    assert.equal(await docxToText(d), "Merhaba");
  });

  it("merkezi dizinde 50 MB'ı aşan açılmış boyut mammoth'tan önce Türkçe hatayla reddedilir", async () => {
    const d = withDeclaredSize(docx(para("Merhaba")), 60 * 1024 * 1024);
    await assert.rejects(() => docxToText(d), (e: Error) => e.message === DOCX_TOO_BIG_ERROR);
    const huge = withDeclaredSize(docx(para("Merhaba")), 0xffffffff);
    await assert.rejects(() => docxToText(huge), (e: Error) => e.message === DOCX_TOO_BIG_ERROR);
  });

  /** Deflate (yöntem 8) girdili ZIP. `declared` merkezi dizindeki açılmış boyutu (yalan olabilir) belirler. */
  function zipDeflated(files: [name: string, data: Buffer, declared?: number][]): Uint8Array {
    const parts: Buffer[] = [];
    const central: Buffer[] = [];
    let offset = 0;
    for (const [name, data, declared] of files) {
      const nameB = Buffer.from(name);
      const comp = deflateRawSync(data);
      const crc = crc32(data);
      const local = Buffer.alloc(30);
      local.writeUInt32LE(0x04034b50, 0);
      local.writeUInt16LE(20, 4);
      local.writeUInt16LE(8, 8);
      local.writeUInt32LE(crc, 14);
      local.writeUInt32LE(comp.length, 18);
      local.writeUInt32LE(declared ?? data.length, 22);
      local.writeUInt16LE(nameB.length, 26);
      const cd = Buffer.alloc(46);
      cd.writeUInt32LE(0x02014b50, 0);
      cd.writeUInt16LE(20, 4);
      cd.writeUInt16LE(20, 6);
      cd.writeUInt16LE(8, 10);
      cd.writeUInt32LE(crc, 16);
      cd.writeUInt32LE(comp.length, 20);
      cd.writeUInt32LE(declared ?? data.length, 24);
      cd.writeUInt16LE(nameB.length, 28);
      cd.writeUInt32LE(offset, 42);
      parts.push(local, nameB, comp);
      central.push(cd, nameB);
      offset += local.length + nameB.length + comp.length;
    }
    const cdBuf = Buffer.concat(central);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(files.length, 8);
    end.writeUInt16LE(files.length, 10);
    end.writeUInt32LE(cdBuf.length, 12);
    end.writeUInt32LE(offset, 16);
    return new Uint8Array(Buffer.concat([...parts, cdBuf, end]));
  }

  it("küçük boyut bildiren ama ~60 MB açılan deflate bombası reddedilir", async () => {
    const zeros = Buffer.alloc(60 * 1024 * 1024);
    const bomb = zipDeflated([["word/document.xml", zeros, 100]]);
    assert.ok(bomb.length < 200_000);
    assert.ok(zipUncompressedSize(bomb) <= 100, "bildirilen boyut küçük görünmeli");
    await assert.rejects(() => docxToText(bomb), (e: Error) => e.message === DOCX_TOO_BIG_ERROR);
    assert.throws(() => inflatedZipSize(bomb), (e: Error) => e.message === DOCX_TOO_BIG_ERROR);
  });

  it("toplam bütçe girdiler arasında paylaşılır (her biri sınırın altında, toplamı üstünde)", () => {
    const half = Buffer.alloc(30 * 1024 * 1024);
    const z = zipDeflated([["a.xml", half], ["b.xml", half]]);
    assert.throws(() => inflatedZipSize(z), (e: Error) => e.message === DOCX_TOO_BIG_ERROR);
    assert.equal(inflatedZipSize(z, 61 * 1024 * 1024), 60 * 1024 * 1024);
  });

  it("deflate ile sıkıştırılmış normal arşiv gerçek boyutuyla ölçülür ve geçer", () => {
    const xml = Buffer.from('<?xml version="1.0"?><a>Merhaba</a>'.repeat(50));
    const z = zipDeflated([["word/document.xml", xml], ["dir/", Buffer.alloc(0)]]);
    assert.equal(inflatedZipSize(z), xml.length);
  });

  it("bozuk deflate verisi Türkçe hatayla reddedilir", async () => {
    const z = zipDeflated([["word/document.xml", Buffer.from("abcabcabc".repeat(100))]]);
    const bad = new Uint8Array(z);
    bad.fill(0xff, 30 + "word/document.xml".length, 30 + "word/document.xml".length + 8);
    await assert.rejects(() => docxToText(bad), (e: Error) => e.message === DOCX_INVALID_ERROR);
  });

  it("zip olmayan dosya Türkçe hatayla reddedilir", async () => {
    await assert.rejects(() => docxToText(new Uint8Array([1, 2, 3, 4])), (e: Error) => e.message === DOCX_INVALID_ERROR);
  });
});

describe("htmlToText (derin iç içe HTML)", () => {
  it("50 bin düzey iç içe div yığın taşırmadan işlenir ve metni korur", () => {
    const depth = 50_000;
    const html = `${"<div>".repeat(depth)}derin metin${"</div>".repeat(depth)}`;
    const t0 = performance.now();
    const text = htmlToText(html);
    assert.ok(text.includes("derin metin"));
    assert.ok(performance.now() - t0 < 3000);
  });
});

describe("DOCX katı ZIP doğrulaması (JSZip'in farklı dizin okuma yolları)", () => {
  type E = { name: string; data: Buffer; deflate?: boolean };
  type Opt = { count?: number; cdSize?: number; cdOffset?: number; disk?: number; onDisk?: number; zip64Locator?: boolean; prefix?: number; extraCd?: Buffer };

  /** EOCD ve dizin alanları elle bozulabilen ZIP üretici. */
  function build(entries: E[], o: Opt = {}): Uint8Array {
    const prefix = Buffer.alloc(o.prefix ?? 0, 0x41);
    const parts: Buffer[] = [];
    const central: Buffer[] = [];
    let offset = 0;
    for (const { name, data, deflate } of entries) {
      const nameB = Buffer.from(name);
      const body = deflate ? deflateRawSync(data) : data;
      const local = Buffer.alloc(30);
      local.writeUInt32LE(0x04034b50, 0);
      local.writeUInt16LE(20, 4);
      local.writeUInt16LE(deflate ? 8 : 0, 8);
      local.writeUInt32LE(crc32(data), 14);
      local.writeUInt32LE(body.length, 18);
      local.writeUInt32LE(data.length, 22);
      local.writeUInt16LE(nameB.length, 26);
      const cd = Buffer.alloc(46);
      cd.writeUInt32LE(0x02014b50, 0);
      cd.writeUInt16LE(20, 4);
      cd.writeUInt16LE(20, 6);
      cd.writeUInt16LE(deflate ? 8 : 0, 10);
      cd.writeUInt32LE(crc32(data), 16);
      cd.writeUInt32LE(body.length, 20);
      cd.writeUInt32LE(data.length, 24);
      cd.writeUInt16LE(nameB.length, 28);
      cd.writeUInt32LE(offset, 42);
      parts.push(local, nameB, body);
      central.push(cd, nameB);
      offset += local.length + nameB.length + body.length;
    }
    if (o.extraCd) central.push(o.extraCd);
    const cdBuf = Buffer.concat(central);
    const locator = Buffer.alloc(o.zip64Locator ? 20 : 0);
    if (o.zip64Locator) locator.writeUInt32LE(0x07064b50, 0);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(o.disk ?? 0, 4);
    end.writeUInt16LE(o.disk ?? 0, 6);
    end.writeUInt16LE(o.onDisk ?? o.count ?? entries.length, 8);
    end.writeUInt16LE(o.count ?? entries.length, 10);
    end.writeUInt32LE(o.cdSize ?? cdBuf.length, 12);
    end.writeUInt32LE(o.cdOffset ?? offset, 16);
    return new Uint8Array(Buffer.concat([prefix, ...parts, cdBuf, locator, end]));
  }

  const small: E = { name: "word/document.xml", data: Buffer.from("<w:document/>") };
  const bomb: E = { name: "word/document.xml", data: Buffer.alloc(60 * 1024 * 1024), deflate: true };
  const invalid = (e: Error) => e.message === DOCX_INVALID_ERROR;

  it("sentetik normal ZIP kabul edilir (üretici doğrulaması)", () => {
    assert.equal(inflatedZipSize(build([small, { name: "a.xml", data: Buffer.from("x".repeat(500)), deflate: true }])), 13 + 500);
  });

  it("(a) EOCD sayacından fazla, aynı adlı ikinci bomba girdisi reddedilir", async () => {
    // Sayaç 1; dizin iki girdi içerir (ikincisi JSZip'te birincinin yerini alır).
    const z = build([small, bomb], { count: 1 });
    assert.throws(() => inflatedZipSize(z), invalid);
    await assert.rejects(() => docxToText(z), (e: Error) => e.message === DOCX_INVALID_ERROR || e.message === DOCX_TOO_BIG_ERROR);
    // Sayaç doğru bile olsa aynı adlı çift girdi reddedilir.
    assert.throws(() => inflatedZipSize(build([small, bomb])), invalid);
    assert.throws(() => inflatedZipSize(build([small, { ...small, name: "WORD/Document.xml" }])), invalid);
  });

  it("(a) sayaç dizindeki gerçek girdiden küçük/büyük olursa reddedilir", () => {
    const two: E[] = [small, { name: "b.xml", data: Buffer.from("b") }];
    assert.throws(() => inflatedZipSize(build(two, { count: 1 })), invalid);
    assert.throws(() => inflatedZipSize(build(two, { count: 3 })), invalid);
  });

  it("(b) centralDirSize küçük yazılırsa ya da öne/araya veri eklenirse reddedilir", async () => {
    const ok = build([small]);
    const actualCd = 46 + small.name.length;
    assert.throws(() => inflatedZipSize(build([small], { cdSize: actualCd - 10 })), invalid);
    assert.throws(() => inflatedZipSize(build([small], { cdSize: 0 })), invalid);
    assert.throws(() => inflatedZipSize(build([small], { cdSize: actualCd + 5 })), invalid);
    // Önde ek veri: ofsetler kayar (JSZip reader.zero ile telafi eder).
    const shifted = build([small], { prefix: 37 });
    assert.throws(() => inflatedZipSize(shifted), invalid);
    await assert.rejects(() => docxToText(shifted), (e: Error) => e.message === DOCX_INVALID_ERROR);
    assert.ok(inflatedZipSize(ok) > 0);
    // Dizinle EOCD arasına ek veri.
    const gap = Buffer.concat([ok.subarray(0, ok.length - 22), Buffer.alloc(8), ok.subarray(ok.length - 22)]);
    assert.throws(() => inflatedZipSize(new Uint8Array(gap)), invalid);
  });

  it("(c) ZIP64 alanları, disk numarası ve locator reddedilir", async () => {
    assert.throws(() => inflatedZipSize(build([small], { count: 0xffff })), invalid);
    assert.throws(() => inflatedZipSize(build([small], { cdSize: 0xffffffff })), invalid);
    assert.throws(() => inflatedZipSize(build([small], { cdOffset: 0xffffffff })), invalid);
    assert.throws(() => inflatedZipSize(build([small], { onDisk: 0xffff })), invalid);
    assert.throws(() => inflatedZipSize(build([small], { disk: 0xffff })), invalid);
    assert.throws(() => inflatedZipSize(build([small], { disk: 1 })), invalid);
    assert.throws(() => inflatedZipSize(build([small], { zip64Locator: true })), invalid);
    for (const o of [{ count: 0xffff }, { cdSize: 0xffffffff }, { disk: 1 }, { zip64Locator: true }]) {
      await assert.rejects(() => docxToText(build([small], o)), (e: Error) => e.message === DOCX_INVALID_ERROR);
    }
  });

  it("bildirilen açılmış boyutu gerçekle uyuşmayan girdi reddedilir", () => {
    const z = build([{ name: "a.xml", data: Buffer.from("merhaba"), deflate: true }]);
    const bad = new Uint8Array(z);
    const dv = new DataView(bad.buffer);
    dv.setUint32(dv.getUint32(bad.length - 6, true) + 24, 3, true);
    assert.throws(() => inflatedZipSize(bad), invalid);
  });

  it("normal (testte üretilen) DOCX hâlâ geçer ve metni çıkar", async () => {
    const d = docx(para("Merhaba dünya"));
    assert.ok(inflatedZipSize(d) > 0);
    assert.equal(await docxToText(d), "Merhaba dünya");
  });
});
