import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { chunkText, splitSentences } from "./chunking";

const words = (n: number, w = "sulama") => Array.from({ length: n }, () => w).join(" ");
const sentence = "Zeytin ağaçlarında zeytinsineği mücadelesi eylül ayında başlar ve ekim sonuna kadar sürer.";
const repeated = (n: number) => Array.from({ length: n }, () => sentence).join(" ");

describe("splitSentences (Türkçe)", () => {
  it("kısaltmalardan sonra bölmez: Dr., Prof., No., örn., vb.", () => {
    assert.deepEqual(splitSentences("Dr. Ayşe Yılmaz geldi. Prof. Dr. Ali Kaya da geldi."), ["Dr. Ayşe Yılmaz geldi.", "Prof. Dr. Ali Kaya da geldi."]);
    assert.deepEqual(splitSentences("Pist No. 5 kapalı. Örn. Ankara açık."), ["Pist No. 5 kapalı.", "Örn. Ankara açık."]);
    assert.deepEqual(splitSentences("Domates, biber vb. ürünler dikilir. Sonra sulanır."), ["Domates, biber vb. ürünler dikilir.", "Sonra sulanır."]);
  });

  it("vb. sonrası büyük harfle yeni cümle başlar", () => {
    assert.deepEqual(splitSentences("Sebze, meyve vb. Yarın yağış var."), ["Sebze, meyve vb.", "Yarın yağış var."]);
  });

  it("ondalık sayı, saat ve tarihi bölmez", () => {
    const t = "Sıcaklık 3.5 derece. Kalkış 06.30 civarı. Tarih 12.10.2026 olarak açıklandı.";
    assert.deepEqual(splitSentences(t), ["Sıcaklık 3.5 derece.", "Kalkış 06.30 civarı.", "Tarih 12.10.2026 olarak açıklandı."]);
  });

  it("sıra sayısı + ay adını ve baş harfi bölmez", () => {
    assert.equal(splitSentences("Toplantı 12. Ekim tarihinde yapıldı.").length, 1);
    assert.equal(splitSentences("Yazar A. Yılmaz bu konuyu yazdı.").length, 1);
  });

  it("! ? ve … ile biten cümleleri ayırır", () => {
    assert.deepEqual(splitSentences("Don riski var mı? Evet! Dikkatli olun… Yarın görüşürüz."), [
      "Don riski var mı?",
      "Evet!",
      "Dikkatli olun…",
      "Yarın görüşürüz.",
    ]);
  });
});

describe("chunkText cümle ve kelime sınırı", () => {
  it("3000+ karakterlik tek paragraf cümle başından bölünür, cümle ortadan kesilmez", () => {
    const text = repeated(34);
    assert.ok(text.length > 3000);
    const out = chunkText(text);
    assert.ok(out.length >= 3);
    for (const c of out) {
      assert.ok(c.length <= 1000);
      assert.ok(c.startsWith("Zeytin"), c.slice(0, 30));
      assert.ok(c.endsWith("sürer."), c.slice(-30));
    }
  });

  it("örtüşme cümle başından başlar ve önceki parçanın sonunda bulunur", () => {
    const out = chunkText(repeated(34));
    for (let i = 1; i < out.length; i++) {
      assert.ok(out[i - 1].endsWith(sentence));
      assert.ok(out[i].startsWith(sentence), "örtüşme bir cümleyle başlamalı");
    }
  });

  it("cümle sınırı olmayan uzun metin kelime ortasından kesilmez; örtüşme kelime başından başlar", () => {
    const out = chunkText(words(600)); // ~4200 karakter, noktalama yok
    assert.ok(out.length >= 4);
    for (const c of out) {
      assert.ok(c.length <= 1000);
      assert.ok(c.split(" ").every((w) => w === "sulama"), "kelime kesilmiş");
    }
  });

  it("çok uzun tek cümleyi kelime sınırından böler", () => {
    const long = `Yarın ${words(250, "bölgemizde")} yağış bekleniyor.`;
    const out = chunkText(long);
    assert.ok(out.length >= 2);
    for (const c of out) {
      assert.ok(c.length <= 1000);
      assert.ok(c.split(/\s+/).every((w) => ["Yarın", "bölgemizde", "yağış", "bekleniyor."].includes(w)));
    }
  });

  it("parça 'Dr.' gibi bir kısaltmada bitmez", () => {
    const filler = repeated(11); // ~990 karakter
    const out = chunkText(`${filler} Dr. Ayşe Yılmaz bu konuda uzmandır. ${sentence}`);
    for (const c of out) assert.ok(!/(^|\s)Dr\.$/.test(c), "Dr. ile bitmiş parça");
    assert.ok(out.some((c) => c.includes("Dr. Ayşe Yılmaz")));
  });

  it("boşluksuz dev dizgide son çare sabit pencere kullanır", () => {
    const out = chunkText("x".repeat(2500));
    assert.ok(out.every((c) => c.length <= 1000));
  });

  it("sabit genişlikte satır kırılmış metinde satır sonu cümle sınırı sayılmaz", () => {
    const wrapped = repeated(30).replace(/(.{70}) /g, "$1\n");
    const out = chunkText(wrapped);
    for (const c of out) assert.ok(c.startsWith("Zeytin") && c.endsWith("sürer."));
  });
});

describe("chunkText başlık bağlamı", () => {
  const md = [
    "# Zeytin Rehberi",
    "",
    "Giriş metni.",
    "",
    "## Hastalıklar",
    "",
    "### Zeytinsineği",
    "",
    "Eylülde mücadele başlar.",
    "",
    "## Sulama",
    "",
    "Yaz boyunca haftada bir sulayın.",
  ].join("\n");

  it("her parçanın başına Bölüm yolu eklenir", () => {
    assert.deepEqual(chunkText(md), [
      "Bölüm: Zeytin Rehberi\nGiriş metni.",
      "Bölüm: Zeytin Rehberi › Hastalıklar › Zeytinsineği\nEylülde mücadele başlar.",
      "Bölüm: Zeytin Rehberi › Sulama\nYaz boyunca haftada bir sulayın.",
    ]);
  });

  it("başlıksız metne Bölüm satırı eklenmez", () => {
    assert.deepEqual(chunkText("Düz metin."), ["Düz metin."]);
  });

  it("parça bölüm sınırını aşmaz", () => {
    assert.deepEqual(chunkText("## A\n\nBirinci.\n\n## B\n\nİkinci."), ["Bölüm: A\nBirinci.", "Bölüm: B\nİkinci."]);
  });

  it("başlık satırı gövdeyle bitişik (boş satırsız) de tanınır", () => {
    assert.deepEqual(chunkText("## Sulama\nHaftada bir."), ["Bölüm: Sulama\nHaftada bir."]);
  });

  it("kod bloğundaki #, #etiket ve 4. seviye başlık bölüm sayılmaz", () => {
    const out = chunkText("```\n# yorum\n```\n\n#etiket metni\n\n#### Alt başlık");
    assert.equal(out.length, 1);
    assert.ok(!out[0].startsWith("Bölüm:"));
  });

  it("Bölüm satırı boyut hesabına dahildir ve her bölünmüş parçada bulunur", () => {
    const out = chunkText(`# ${"Başlık ".repeat(10).trim()}\n\n${words(300)}`);
    assert.ok(out.length >= 2);
    for (const c of out) {
      assert.ok(c.length <= 1000, String(c.length));
      assert.ok(c.startsWith("Bölüm: Başlık"));
    }
  });

  it("çok uzun başlık yolu sınırlanır", () => {
    const out = chunkText(`# ${"u".repeat(100)}\n## ${"v".repeat(100)}\n### ${"w".repeat(100)}\n\nmetin`);
    assert.equal(out.length, 1);
    assert.ok(out[0].split("\n")[0].length <= 300);
    assert.ok(out[0].endsWith("\nmetin"));
  });

  it("küçük size ile de boyutu aşmaz", () => {
    const out = chunkText(`# Başlık\n\n${words(100)}`, 200, 30);
    assert.ok(out.every((c) => c.length <= 200));
  });
});

describe("chunkText tablo ve liste satırları", () => {
  const row = (i: number) => `Ürün: Domates ${i} | Dikim: nisan | Verim: ${i * 10} kg`;

  it("sığan tablo tek parçada kalır", () => {
    const table = Array.from({ length: 5 }, (_, i) => row(i)).join("\n");
    const out = chunkText(`${words(120)}\n\n${table}`);
    assert.ok(out.some((c) => c.includes(table)), "tablo bölünmüş");
  });

  it("öncekiyle aynı parçaya sığmayan tablo bölünmeden yeni parçaya taşınır", () => {
    const table = Array.from({ length: 8 }, (_, i) => row(i)).join("\n");
    const out = chunkText(`${words(120, "uzun")}\n\n${table}`, 800, 100);
    assert.equal(out.length, 2);
    assert.ok(out[1].endsWith(table), "tablo tek parçada ve bütün olmalı");
    assert.ok(!out[0].includes(row(0)));
  });

  it("boyuttan büyük tablo yalnızca satır sınırından bölünür", () => {
    const table = Array.from({ length: 40 }, (_, i) => row(i)).join("\n");
    const out = chunkText(table);
    assert.ok(out.length >= 2);
    const lines = out.flatMap((c) => c.split("\n"));
    assert.equal(lines.length, 40);
    assert.ok(lines.every((l) => l.startsWith("Ürün: Domates ") && l.endsWith(" kg")));
  });

  it("madde listesi de satır sınırından bölünür", () => {
    const list = Array.from({ length: 60 }, (_, i) => `- madde numara ${i} metni`).join("\n");
    const out = chunkText(list);
    assert.ok(out.length >= 2);
    for (const l of out.flatMap((c) => c.split("\n"))) assert.match(l, /^- madde numara \d+ metni$/);
  });
});
