import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { defaultBotConfig, type BotConfig } from "./bot-config";
import { diffConfigs, diffEmbeddings, lineDiff, summarizeChanges } from "./config-diff";

const clone = (): BotConfig => structuredClone(defaultBotConfig());
const label = (e: { providerId: string | null; model: string | null }) => (e.model ? `p · ${e.model}` : "kapalı");

describe("diffConfigs", () => {
  it("aynı config'te fark yok; ilk yayında tek özet var", () => {
    assert.deepEqual(diffConfigs(clone(), clone()), []);
    assert.deepEqual(summarizeChanges(diffConfigs(null, clone())), ["İlk yayın"]);
  });

  it("mod talimatı değişimi özet ve satır farkı üretir", () => {
    const a = clone();
    const b = clone();
    b.modes.agro.instructions = `${a.modes.agro.instructions}\nYeni satır.`;
    const [c, ...rest] = diffConfigs(a, b);
    assert.equal(rest.length, 0);
    assert.equal(c.summary, "Agro Asistan: talimat değişti");
    assert.deepEqual(c.lines?.filter((l) => l.op !== "same"), [{ op: "add", text: "Yeni satır." }]);
  });

  it("ton değişimi eski ve yeni tonu yazar", () => {
    const a = clone();
    const b = clone();
    b.modes.genel.tone = "resmi";
    assert.deepEqual(summarizeChanges(diffConfigs(a, b)), ["Havamania Asistan: üslup Dengeli (önerilen) → Resmî"]);
  });

  it("ton metni override'ı değişirse yalnızca o ton raporlanır", () => {
    const b = clone();
    b.toneOverrides = { kisa: "Tek cümleyle cevapla." };
    const out = diffConfigs(clone(), b);
    assert.equal(out.length, 1);
    assert.equal(out[0].summary, "Ton metni değişti: Kısa ve Net");
  });

  it("eklenen ve çıkan araçları ayrı yazar", () => {
    const a = clone();
    const b = clone();
    b.modes.agro.tools = ["current_weather", "flight_weather"];
    const [c] = diffConfigs(a, b);
    assert.match(c.summary, /eklenen: Uçuş hava durumu/);
    assert.match(c.summary, /çıkan: Tahmin \(saatlik ve günlük\), Tarım koşulları/);
  });

  it("araç sırası farkı değişiklik sayılmaz", () => {
    const b = clone();
    b.modes.agro.tools = [...b.modes.agro.tools].reverse();
    assert.deepEqual(diffConfigs(clone(), b), []);
  });

  it("F2-3 alanları: en uzun cevap, örnekler, yasak konular, eşik", () => {
    const b = clone();
    b.modes.fly.maxOutputTokens = 400;
    b.modes.genel.examples = [{ user: "Selam", assistant: "Merhaba" }];
    b.blockedTopics = ["siyaset"];
    b.retrievalMinSimilarity = 0.45;
    b.photosEnabled = false;
    const sums = summarizeChanges(diffConfigs(clone(), b));
    assert.ok(sums.includes("Fly Asistan: en uzun cevap 900 → 400 token"));
    assert.ok(sums.includes("Havamania Asistan: örnek konuşmalar değişti (0 → 1)"));
    assert.ok(sums.includes("Yasak konular değişti (0 → 1)"));
    assert.ok(sums.includes("İlgililik eşiği: 0.3 → 0.45"));
    assert.ok(sums.includes("Fotoğraf yükleme: açık → kapalı"));
  });

  it("model aynı, sağlayıcı farklıysa sağlayıcı değişimini yazar", () => {
    const a = clone();
    const b = clone();
    a.modes.genel.model = b.modes.genel.model = "m1";
    a.modes.genel.providerId = "p1";
    b.modes.genel.providerId = "p2";
    assert.deepEqual(summarizeChanges(diffConfigs(a, b)), ["Havamania Asistan: sağlayıcı değişti (model: m1)"]);
  });
});

describe("lineDiff", () => {
  const ops = (x: ReturnType<typeof lineDiff>) => x.map((l) => `${l.op === "same" ? " " : l.op === "add" ? "+" : "-"}${l.text}`);

  it("ortadaki satır değişimi, baş ve sonu korur", () => {
    assert.deepEqual(ops(lineDiff("a\nb\nc", "a\nB\nc")), [" a", "-b", "+B", " c"]);
  });

  it("araya satır eklenmesini ve çıkarılmasını bulur (LCS)", () => {
    assert.deepEqual(ops(lineDiff("a\nb\nc\nd", "a\nc\nx\nd")), [" a", "-b", " c", "+x", " d"]);
  });

  it("boş metinden ve boş metne", () => {
    assert.deepEqual(ops(lineDiff("", "x\ny")), ["+x", "+y"]);
    assert.deepEqual(ops(lineDiff("x", "")), ["-x"]);
    assert.deepEqual(lineDiff("", ""), []);
  });

  it("CRLF ve LF aynı sayılır", () => {
    assert.ok(lineDiff("a\r\nb", "a\nb").every((l) => l.op === "same"));
  });

  it("çok büyük girdide toplu sil/ekle'ye düşer, sonuç yine tutarlıdır", () => {
    const a = Array.from({ length: 800 }, (_, i) => `a${i}`).join("\n");
    const b = Array.from({ length: 800 }, (_, i) => `b${i}`).join("\n");
    const d = lineDiff(a, b, 1000);
    assert.equal(d.filter((l) => l.op === "del").length, 800);
    assert.equal(d.filter((l) => l.op === "add").length, 800);
  });
});

describe("diffEmbeddings", () => {
  const e1 = { providerId: "p", model: "m1" };
  const e2 = { providerId: "p", model: "m2" };

  it("aynı, farklı ve kayıt yok durumları", () => {
    assert.equal(diffEmbeddings(e1, { ...e1 }, label).status, "same");
    const changed = diffEmbeddings(e1, e2, label);
    assert.equal(changed.status, "changed");
    assert.equal(changed.text, "p · m1 → p · m2");
    assert.equal(diffEmbeddings(null, e2, label).status, "unknown");
    assert.equal(diffEmbeddings(e1, null, label).status, "unknown");
  });
});

describe("diffConfigs: kaynak başına en çok parça", () => {
  it("değişimi sayısal ayar olarak özetler", () => {
    const a = clone();
    const b = clone();
    b.retrievalPerSourceMax = 5;
    assert.deepEqual(summarizeChanges(diffConfigs(a, b)), ["Kaynak başına en çok parça: 3 → 5"]);
  });
});
