import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CitationStripper, citedNumbers, stripCitations } from "./citations";
import { stripCitationStream } from "./ui-stream";

describe("stripCitations", () => {
  it("atıfı ve önündeki boşluğu siler", () => {
    assert.equal(stripCitations("Sulama sabah yapılmalı [1]."), "Sulama sabah yapılmalı.");
    assert.equal(stripCitations("Don riski var [1][2]. Önlem alın [3]."), "Don riski var. Önlem alın.");
    assert.equal(stripCitations("İki kaynak [1, 2] diyor."), "İki kaynak diyor.");
  });

  it("köşeli parantezli başka metne dokunmaz", () => {
    assert.equal(stripCitations("Yıl [2025] ve [a] ile [1a]."), "Yıl [2025] ve [a] ile [1a].");
  });

  it("sonda yarım kalmış atıf başlangıcını atar", () => {
    assert.equal(stripCitations("Cevap burada [1"), "Cevap burada");
    assert.equal(stripCitations("Cevap burada ["), "Cevap burada");
  });
});

describe("stripCitations (kaynak sayısı ile)", () => {
  it("atıf dışı köşeli parantez korunur: aralık, dizi indeksi, bağlantı metni", () => {
    assert.equal(stripCitations("Sıcaklık [10, 15] derece olur.", 3), "Sıcaklık [10, 15] derece olur.");
    assert.equal(stripCitations("dizi[0] ve dizi[7] okunur.", 3), "dizi[0] ve dizi[7] okunur.");
    assert.equal(stripCitations("Bkz. [1](https://ornek.com) sayfası [2].", 3), "Bkz. [1](https://ornek.com) sayfası.");
    assert.equal(stripCitations("Bkz. [1][2](https://ornek.com) ve [3].", 3), "Bkz. [1][2](https://ornek.com) ve.");
  });

  it("yalnızca 1..max aralığındaki atıflar silinir; karışık dizide aralık dışı kalır", () => {
    assert.equal(stripCitations("Bilgi [1] ve [4] var.", 3), "Bilgi ve [4] var.");
    assert.equal(stripCitations("Bilgi [1][9] var.", 3), "Bilgi [9] var.");
    assert.equal(stripCitations("Bilgi [1, 4] var.", 3), "Bilgi [1, 4] var.");
  });

  it("kaynak yokken (max 0) metne dokunulmaz", () => {
    assert.equal(stripCitations("A [1] B [10, 15] C [", 0), "A [1] B [10, 15] C [");
  });

  it("sonda yarım atıf yalnızca geçerli olabiliyorsa atılır", () => {
    assert.equal(stripCitations("Cevap [1", 3), "Cevap");
    assert.equal(stripCitations("Cevap [2025", 3), "Cevap [2025");
    assert.equal(stripCitations("Cevap [7", 3), "Cevap [7");
  });

  it("kötü niyetli uzun girdi doğrusal sürede işlenir", () => {
    const t0 = Date.now();
    stripCitations(" ".repeat(400_000) + "x", 5);
    stripCitations("[1]".repeat(130_000), 5);
    stripCitations("[ ".repeat(200_000), 5);
    stripCitations("a [1] ".repeat(60_000), 5);
    assert.ok(Date.now() - t0 < 1500, `${Date.now() - t0} ms`);
  });
});

describe("citedNumbers", () => {
  it("bağlantı metni ve aralık dışı numaralar sayılmaz", () => {
    assert.deepEqual(citedNumbers("[1](url) ve [2] ve [10, 15]", 3), [2]);
    assert.deepEqual(citedNumbers("[1] [2]", 0), []);
  });

  it("1..max aralığındaki numaraları tekrarsız ve sıralı döner", () => {
    assert.deepEqual(citedNumbers("a [2] b [1][2] c [9] d [0] e [1, 3]", 3), [1, 2, 3]);
    assert.deepEqual(citedNumbers("atıf yok", 3), []);
  });
});

describe("CitationStripper (parçalı akış)", () => {
  const run = (parts: string[]) => {
    const s = new CitationStripper();
    return parts.map((p) => s.push(p)).join("") + s.flush();
  };

  it("bölünmüş atıfları temizler: '[' + '1]' ve '[1' + ']'", () => {
    assert.equal(run(["Sulama yapılmalı [", "1]", "."]), "Sulama yapılmalı.");
    assert.equal(run(["Sulama yapılmalı [1", "]."]), "Sulama yapılmalı.");
    assert.equal(run(["Sulama yapılmalı", " ", "[", "1", "]", "[", "2", "]", " Sonra."]), "Sulama yapılmalı Sonra.");
  });

  it("atıf olmayan köşeli parantezi geri verir", () => {
    assert.equal(run(["Yıl [", "2025", "] kaydı"]), "Yıl [2025] kaydı");
    assert.equal(run(["Liste [abc] var"]), "Liste [abc] var");
  });

  it("tek tek karakter gelse de parçalı sonuç tek parçalı sonuçla aynıdır", () => {
    const text = "Önce bilgi [1]. Sonra başka bilgi [2][3]. Yıl [2025] ve [x]. Son [1, 2] bitti [";
    assert.equal(run([...text]), stripCitations(text));
  });

  it("akış bitince yarım atıf atılır", () => {
    assert.equal(run(["Metin [1"]), "Metin");
  });

  it("bölünmüş akışta atıf dışı köşeli parantez ve bağlantı metni korunur", () => {
    const run3 = (parts: string[], max: number) => {
      const s = new CitationStripper(max);
      return parts.map((p) => s.push(p)).join("") + s.flush();
    };
    assert.equal(run3(["Sıcaklık [10", ", 15] derece"], 3), "Sıcaklık [10, 15] derece");
    assert.equal(run3(["Bkz. [1", "]", "(https://o.com) ve [2", "]."], 3), "Bkz. [1](https://o.com) ve.");
    assert.equal(run3(["dizi[", "0] okunur"], 3), "dizi[0] okunur");
    assert.equal(run3(["A [", "1] B [", "1"], 0), "A [1] B [1");
  });

  it("tek tek karakter gelse de max'li sonuç tek parçalı sonuçla aynıdır", () => {
    const text = "Bkz. [1](u) ve [2][3]. Aralık [10, 15] ve dizi[0] ile [1, 2] bitti [2";
    const s = new CitationStripper(3);
    const streamed = [...text].map((c) => s.push(c)).join("") + s.flush();
    assert.equal(streamed, stripCitations(text, 3));
  });
});

describe("stripCitationStream", () => {
  async function pipeN(chunks: Record<string, unknown>[], n: number) {
    const src = new ReadableStream<{ type: string; [k: string]: unknown }>({
      start(c) {
        for (const ch of chunks) c.enqueue(ch as { type: string });
        c.close();
      },
    });
    const out: string[] = [];
    const reader = stripCitationStream(src, n).getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value.type === "text-delta") out.push(value.delta as string);
    }
    return out.join("");
  }

  it("kaynak sayısına göre süzer; kaynak yoksa atlar", async () => {
    const chunks = [
      { type: "text-delta", id: "t", delta: "Bilgi [1] ve [10, " },
      { type: "text-delta", id: "t", delta: "15] derece [" },
      { type: "text-end", id: "t" },
    ];
    assert.equal(await pipeN(chunks, 2), "Bilgi ve [10, 15] derece");
    assert.equal(await pipeN(chunks, 0), "Bilgi [1] ve [10, 15] derece [");
  });

  async function pipe(chunks: Record<string, unknown>[]) {
    const src = new ReadableStream<{ type: string; [k: string]: unknown }>({
      start(c) {
        for (const ch of chunks) c.enqueue(ch as { type: string });
        c.close();
      },
    });
    const out: { type: string; [k: string]: unknown }[] = [];
    const reader = stripCitationStream(src).getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      out.push(value);
    }
    return out;
  }

  it("metin akışından atıfları siler, diğer chunk'lara dokunmaz", async () => {
    const out = await pipe([
      { type: "start", messageId: "m1" },
      { type: "text-start", id: "t1" },
      { type: "text-delta", id: "t1", delta: "Don riski var [" },
      { type: "text-delta", id: "t1", delta: "1" },
      { type: "text-delta", id: "t1", delta: "]. Önlem alın" },
      { type: "text-end", id: "t1" },
      { type: "finish", finishReason: "stop" },
    ]);
    const text = out.filter((c) => c.type === "text-delta").map((c) => c.delta).join("");
    assert.equal(text, "Don riski var. Önlem alın");
    assert.ok(!text.includes("["));
    assert.deepEqual(out.map((c) => c.type).filter((t) => t !== "text-delta"), ["start", "text-start", "text-end", "finish"]);
  });

  it("text-end'den önce bekleyen düz boşluğu bırakır, yarım atıfı atar", async () => {
    const out = await pipe([
      { type: "text-start", id: "t1" },
      { type: "text-delta", id: "t1", delta: "Bitti [1" },
      { type: "text-end", id: "t1" },
    ]);
    assert.equal(out.filter((c) => c.type === "text-delta").map((c) => c.delta).join(""), "Bitti");
  });

  it("metin kimliklerini ayrı tutar", async () => {
    const out = await pipe([
      { type: "text-delta", id: "a", delta: "Bir [" },
      { type: "text-delta", id: "b", delta: "İki [1]" },
      { type: "text-delta", id: "a", delta: "2] son" },
      { type: "text-end", id: "a" },
      { type: "text-end", id: "b" },
    ]);
    const by = (id: string) => out.filter((c) => c.type === "text-delta" && c.id === id).map((c) => c.delta).join("");
    assert.equal(by("a"), "Bir son");
    assert.equal(by("b"), "İki");
  });
});
