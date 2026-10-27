import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildPrefixQuery,
  buildSearchQuery,
  dedupeHits,
  DEFAULT_DOMAIN_STOPWORDS,
  describeMatch,
  isAbbreviation,
  fuseRanked,
  isFollowUp,
  isLexicallyRelevant,
  isUnanswered,
  joinNeighborChunks,
  rankHits,
  searchTerms,
  type ChunkRow,
  type LexRow,
  type VecRow,
} from "./retrieval-core";

const chunk = (id: string, priority = 0): ChunkRow => ({ id, source_id: `s-${id}`, content: `içerik ${id}`, title: `Başlık ${id}`, type: "file", priority });
const lex = (id: string, lex_matches: number, priority = 0): LexRow => ({ ...chunk(id, priority), lex_matches });
const vec = (id: string, similarity: number, priority = 0): VecRow => ({ ...chunk(id, priority), similarity });
const ids = (hits: { row: ChunkRow; relevant: boolean }[], onlyRelevant = true) => hits.filter((h) => h.relevant || !onlyRelevant).map((h) => h.row.id);

describe("buildPrefixQuery", () => {
  it("stopword'leri atar; geriye kelime kalmazsa null döner", () => {
    assert.equal(buildPrefixQuery("ve ile bir bu için"), null);
    assert.equal(buildPrefixQuery(""), null);
  });

  it("tekrar eden önekleri teke indirir", () => {
    assert.equal(buildPrefixQuery("sulama sulamak sulasam"), "sula:*");
  });

  it("ilk dört harfle önek kurar, kısa kelimeyi olduğu gibi bırakır", () => {
    assert.equal(buildPrefixQuery("rüzgâr yağmur don"), "rüzg:* | yağm:* | don:*");
  });

  it("Türkçe büyük/küçük harfi doğru çevirir (I→ı, İ→i)", () => {
    assert.equal(buildPrefixQuery("SULAMA"), "sula:*");
    assert.equal(buildPrefixQuery("ISPARTA"), "ıspa:*");
    assert.equal(buildPrefixQuery("İstanbul"), "ista:*");
  });

  it("alan stopword'lerini sorgudan çıkarır, ayırt edici kelimeyi korur", () => {
    assert.equal(buildPrefixQuery("hava durumu nasıl olacak", DEFAULT_DOMAIN_STOPWORDS), null);
    assert.equal(buildPrefixQuery("Yarın HAVA durumu", DEFAULT_DOMAIN_STOPWORDS), "yarı:*");
    assert.equal(buildPrefixQuery("hava rüzgâr", []), "hava:* | rüzg:*");
  });
});

describe("isLexicallyRelevant", () => {
  it("tek terimde bir eşleşme yeter, çok terimde yarısı (en az 2) gerekir", () => {
    assert.equal(isLexicallyRelevant(1, 1), true);
    assert.equal(isLexicallyRelevant(0, 1), false);
    assert.equal(isLexicallyRelevant(1, 2), false);
    assert.equal(isLexicallyRelevant(2, 2), true);
    assert.equal(isLexicallyRelevant(1, 4), false);
    assert.equal(isLexicallyRelevant(2, 4), true);
    assert.equal(isLexicallyRelevant(2, 5), false);
    assert.equal(isLexicallyRelevant(3, 5), true);
    assert.equal(isLexicallyRelevant(1, 0), false);
  });
});

describe("rankHits", () => {
  it("iki listede de görünen parça RRF ile öne geçer", () => {
    const hits = rankHits({
      lexRows: [lex("a", 2), lex("b", 2)],
      vecRows: [vec("b", 0.8), vec("c", 0.7)],
      termCount: 2,
      minSimilarity: 0.3,
    });
    assert.deepEqual(ids(hits), ["b", "a", "c"]);
    assert.ok(hits[0].score <= 1);
  });

  it("eşik altındaki vektör sonuçlarını ilgisiz işaretler", () => {
    const hits = rankHits({ lexRows: [], vecRows: [vec("yakin", 0.62), vec("sinir", 0.3), vec("uzak", 0.12)], termCount: 0, minSimilarity: 0.3 });
    assert.deepEqual(ids(hits), ["yakin", "sinir"]);
    assert.deepEqual(ids(hits, false), ["yakin", "sinir", "uzak"]);
    assert.equal(hits[0].similarity, 0.62);
    assert.equal(hits[0].lexical, false);
  });

  it("sözcüksel eşleşmesi olmayan priority=10 düzeltme ilgisiz kalır ve ilk K'ya girmez", () => {
    const hits = rankHits({
      lexRows: [lex("sss", 2), lex("belge", 2)],
      vecRows: [vec("duzeltme", 0.05, 10), vec("sss", 0.7)],
      termCount: 3,
      minSimilarity: 0.3,
    });
    const top = ids(hits).slice(0, 6);
    assert.ok(!top.includes("duzeltme"));
    assert.deepEqual(top, ["sss", "belge"]);
  });

  it("öncelik ilgili parçayı yükseltir ama iki listede birinci olanı geçemez", () => {
    const hits = rankHits({
      lexRows: [lex("ikili", 2), lex("duzeltme", 2, 10)],
      vecRows: [vec("ikili", 0.9)],
      termCount: 2,
      minSimilarity: 0.3,
    });
    assert.deepEqual(ids(hits), ["ikili", "duzeltme"]);
    // Aynı listede ikinci sıradaki öncelikli parça, birincinin hemen önüne geçmez ama puanı artar.
    const plain = rankHits({ lexRows: [], vecRows: [vec("a", 0.5), vec("b", 0.5)], termCount: 0, minSimilarity: 0.3 });
    const boosted = rankHits({ lexRows: [], vecRows: [vec("a", 0.5), vec("b", 0.5, 4)], termCount: 0, minSimilarity: 0.3 });
    assert.ok(boosted[1].score > plain[1].score);
  });

  it("öncelik tavanı 10'dur", () => {
    const [a] = rankHits({ lexRows: [], vecRows: [vec("a", 0.5, 10)], termCount: 0, minSimilarity: 0.3 });
    const [b] = rankHits({ lexRows: [], vecRows: [vec("a", 0.5, 99)], termCount: 0, minSimilarity: 0.3 });
    assert.equal(a.score, b.score);
  });

  it("vektör yokken yalnızca yeterli kelime eşleşmesi olan parçalar ilgilidir", () => {
    const hits = rankHits({ lexRows: [lex("tam", 2), lex("zayif", 1)], vecRows: [], termCount: 3, minSimilarity: 0.3 });
    assert.deepEqual(ids(hits), ["tam"]);
    assert.equal(hits.find((h) => h.row.id === "tam")?.similarity, null);
    assert.equal(hits.find((h) => h.row.id === "tam")?.lexical, true);
  });
});

describe("describeMatch", () => {
  it("kosinüs varsa benzerlik, yoksa kelime eşleşmesi, eski kayıtta boş döner", () => {
    assert.equal(describeMatch({ similarity: 0.62, lexical: true }), "benzerlik 0,62");
    assert.equal(describeMatch({ similarity: null, lexical: true }), "kelime eşleşmesi");
    assert.equal(describeMatch({}), null);
  });
});

describe("isUnanswered", () => {
  const ok = { name: "forecast", input: {}, output: { ok: true, data: {} } };
  const failed = { name: "forecast", input: {}, output: { ok: false, error: "x" } };

  it("ilgili parça, araç, hata ve durdurma yokken cevapsızdır", () => {
    assert.equal(isUnanswered({ relevantHits: 0, toolCalls: [], error: null, aborted: false }), true);
  });
  it("hata varsa cevapsız sayılmaz", () => {
    assert.equal(isUnanswered({ relevantHits: 0, toolCalls: [], error: "model hatası", aborted: false }), false);
  });
  it("durdurulduysa cevapsız sayılmaz", () => {
    assert.equal(isUnanswered({ relevantHits: 0, toolCalls: [], error: null, aborted: true }), false);
  });
  it("yalnızca başarısız araç çağrısı varsa cevapsızdır", () => {
    assert.equal(isUnanswered({ relevantHits: 0, toolCalls: [failed], error: null, aborted: false }), true);
  });
  it("başarılı araç çağrısı varsa cevaplanmıştır", () => {
    assert.equal(isUnanswered({ relevantHits: 0, toolCalls: [failed, ok], error: null, aborted: false }), false);
  });
  it("ilgili parça varsa cevaplanmıştır", () => {
    assert.equal(isUnanswered({ relevantHits: 2, toolCalls: [], error: null, aborted: false }), false);
  });
});

describe("kısaltmalar (searchTerms)", () => {
  it("2 harfli ve büyük harfli kısaltmaları düşürmez, tam eşleşme olarak işaretler", () => {
    const t = searchTerms("ETo UV FL kt hPa METAR TAF NOTAM IST ESB", []);
    assert.deepEqual(
      t.map((x) => x.term),
      ["eto", "uv", "fl", "kt", "hpa", "metar", "taf", "notam", "ist", "esb"],
    );
    assert.ok(t.every((x) => x.exact));
  });

  it("rakamlı kodlar tam eşleşir: FL350, 350, 12kt", () => {
    assert.equal(buildPrefixQuery("FL350 rüzgâr 350", DEFAULT_DOMAIN_STOPWORDS), "fl350 | rüzg:* | 350");
    assert.deepEqual(searchTerms("12kt", []), [{ term: "12kt", exact: true }]);
  });

  it("IST küçük harfe Türkçe I→ı kuralıyla değil, veritabanındaki gibi çevrilir", () => {
    assert.equal(buildPrefixQuery("IST ESB"), "ist | esb");
  });

  it("sıradan kelimeler önek kalır; büyük harfli uzun kelime ve cümle başı kelime kısaltma sayılmaz", () => {
    assert.equal(isAbbreviation("Bu"), false);
    assert.equal(isAbbreviation("SULAMA"), false);
    assert.equal(isAbbreviation("de"), false);
    assert.equal(isAbbreviation("ETo"), true);
    assert.equal(isAbbreviation("a"), false);
    assert.equal(buildPrefixQuery("Bu SULAMA ve ile"), "sula:*");
  });

  it("yerleşik stopword kısaltmayı düşürmez ama yöneticinin alan stopword'ü geçerlidir", () => {
    assert.equal(buildPrefixQuery("hava UV indeksi", DEFAULT_DOMAIN_STOPWORDS), "uv | inde:*");
    assert.equal(buildPrefixQuery("hava UV indeksi", ["uv"]), "hava:* | inde:*");
  });

  it("aynı kısaltma tekrarlanınca teke iner", () => {
    assert.equal(searchTerms("UV uv UV", []).length, 1);
  });
});

describe("buildSearchQuery (takip sorusu)", () => {
  it("bağımsız soru olduğu gibi aranır", () => {
    const r = buildSearchQuery(["Yarın buğday sulaması yapmalı mıyım"], "Bu hafta ilaçlama için en uygun gün hangisi");
    assert.deepEqual(r, { query: "Bu hafta ilaçlama için en uygun gün hangisi", followUp: false });
  });

  it("kısa takip sorusu önceki kullanıcı mesajıyla birleşir", () => {
    const r = buildSearchQuery(["Buğday için sulama zamanı nedir"], "peki yarın?");
    assert.equal(r.followUp, true);
    assert.equal(r.query, "Buğday için sulama zamanı nedir peki yarın?");
  });

  it("bağlaçla başlayan ya da 'da/de' ile biten soru takip sorusudur", () => {
    assert.equal(isFollowUp("ya Ankara'da hava durumu için ne yapmalıyım bugün"), true);
    assert.equal(isFollowUp("Peki o zaman ilaçlamayı ne zaman yapmalıyım acaba"), true);
    assert.equal(isFollowUp("Don riski için ne yapmalıyım yarın da"), true);
    assert.equal(isFollowUp("Don riski var mı bu gece"), false);
  });

  it("kısa ama kendi başına anlamlı soru yeni konudur, önceki mesajla birleşmez", () => {
    for (const q of ["METAR nedir?", "UV indeksi nedir?", "TAF nasıl okunur", "Sulama nedir?", "FL350 ne demek", "Don riski nedir?", "Buğday ekimi ne zaman?"]) {
      assert.equal(isFollowUp(q), false, q);
      assert.deepEqual(buildSearchQuery(["Buğday için sulama zamanı nedir"], q), { query: q, followUp: false }, q);
    }
  });

  it("gerçek takip örnekleri birleşir", () => {
    for (const q of ["peki yarın?", "ya mısır?", "yarın da?", "Ankara'da?", "İstanbul için de?", "bu nedir?", "o ne zaman?", "bunu nasıl yaparım", "onun için ne gerekir", "o zaman ne yapmalıyım"]) {
      assert.equal(isFollowUp(q), true, q);
    }
    assert.equal(buildSearchQuery(["Buğday için sulama zamanı nedir"], "Ankara'da?").followUp, true);
  });

  it("ipucu olsa da kendi başına anlamlı terim varsa birleşmez; uzun 'Bu hafta…' sorusu bağımsızdır", () => {
    assert.equal(isFollowUp("UV indeksi Ankara'da?"), false);
    assert.equal(isFollowUp("bu METAR ne demek"), false);
    assert.equal(isFollowUp("Bu hafta ilaçlama için en uygun gün hangisi"), false);
  });

  it("takip ifadeleri Türkçe harflerde de kelime sınırıyla eşleşir", () => {
    assert.equal(isFollowUp("Don riski için şunu açıklar mısın lütfen"), true);
    assert.equal(isFollowUp("Don riski için şunuz işaretini açıklar mısın"), false);
    assert.equal(isFollowUp("Hasat zamanı için bunuşağı hakkında bilgi verir misin"), false);
  });

  it("önceki mesaj da takip sorusuysa bir öncekiyle üçlü birleşir; asistan cevabı katılmaz", () => {
    const r = buildSearchQuery(["Buğday için sulama zamanı nedir", "ya mısır?"], "peki yarın?");
    assert.equal(r.query, "Buğday için sulama zamanı nedir ya mısır? peki yarın?");
  });

  it("geçmiş yoksa ya da mesaj boşsa (yalnızca fotoğraf) sorgu sorunsuz kurulur", () => {
    assert.deepEqual(buildSearchQuery([], "peki yarın?"), { query: "peki yarın?", followUp: false });
    assert.deepEqual(buildSearchQuery(["sulama zamanı nedir"], ""), { query: "sulama zamanı nedir", followUp: false });
  });

  it("çok uzun geçmiş sorguyu sınırlar, mevcut mesaj tam kalır", () => {
    const long = "sulama ".repeat(200);
    const r = buildSearchQuery([long], "peki yarın?");
    assert.ok(r.query.length <= 500);
    assert.ok(r.query.endsWith("peki yarın?"));
  });
});

describe("dedupeHits", () => {
  const item = (chunkId: string, sourceId: string, idx: number | undefined, content: string, relevant = true) => ({ chunkId, sourceId, idx, content, relevant });
  const para = (word: string) => `${word} `.repeat(12).trim();

  it("aynı kaynaktan 5 ilgili parçadan en çok 3'ü kalır", () => {
    const items = [0, 2, 4, 6, 8].map((i) => item(`c${i}`, "s1", i, para(`kelime${i}`)));
    const out = dedupeHits(items, 3);
    assert.deepEqual(out.map((o) => o.status), ["keep", "keep", "keep", "cap", "cap"]);
  });

  it("normalize metni aynı olan parçalar (farklı kaynak) teke iner", () => {
    const a = item("a", "s1", 0, "Sulama sabah erken yapılmalıdır, rüzgâr az olduğunda.");
    const b = item("b", "s2", 0, "SULAMA   sabah erken yapılmalıdır rüzgâr az olduğunda");
    const out = dedupeHits([a, b], 3);
    assert.deepEqual(out.map((o) => o.status), ["keep", "duplicate"]);
  });

  it("yüksek sözcük örtüşmesi olan parça tekrar sayılır; farklı metin kalır", () => {
    const base = "don riski gece sıcaklığı sıfırın altına düştüğünde ürünlerde zarar oluşturur ve önlem gerekir";
    const out = dedupeHits([item("a", "s1", 0, base), item("b", "s2", 0, `${base} lütfen`), item("c", "s3", 0, "tamamen farklı bir konu hakkında uzun bir açıklama metni burada yer alır")], 3);
    assert.deepEqual(out.map((o) => o.status), ["keep", "duplicate", "keep"]);
  });

  it("bitişik idx'li parçalar örtüşme kırpılarak birleşir ve tek parça sayılır", () => {
    const overlap = "Bu cümle iki parçada da geçen örtüşme kısmıdır.";
    const first = `Bölüm: Sulama\nBirinci parçanın ilk cümlesi burada. ${overlap}`;
    const second = `Bölüm: Sulama\n${overlap} İkinci parçanın yeni cümlesi.`;
    const out = dedupeHits([item("a", "s1", 3, first), item("b", "s1", 4, second)], 3);
    assert.deepEqual(out.map((o) => o.status), ["keep", "merged"]);
    const merged = out[0].item.content;
    assert.equal(merged.split(overlap).length - 1, 1);
    assert.equal(merged.split("Bölüm: Sulama").length - 1, 1);
    assert.ok(merged.includes("İkinci parçanın yeni cümlesi."));
  });

  it("önce gelen sonraki idx ise birleşik metin idx sırasıyla yazılır", () => {
    const out = dedupeHits([item("b", "s1", 4, "ikinci kısım metni burada devam eder uzun uzun"), item("a", "s1", 3, "birinci kısım metni burada başlar uzun uzun")], 3);
    assert.equal(out[1].status, "merged");
    assert.ok(out[0].item.content.indexOf("birinci") < out[0].item.content.indexOf("ikinci"));
  });

  it("ilgisiz parçalara dokunmaz ve girdiyi değiştirmez", () => {
    const items = [item("a", "s1", 0, para("x")), item("b", "s1", 1, para("y"), false)];
    const copy = JSON.stringify(items);
    const out = dedupeHits(items, 1);
    assert.deepEqual(out.map((o) => o.status), ["keep", "keep"]);
    assert.equal(JSON.stringify(items), copy);
  });

  it("joinNeighborChunks örtüşme bulamazsa boş satırla ekler", () => {
    assert.equal(joinNeighborChunks("birinci", "ikinci"), "birinci\n\nikinci");
  });
});

describe("fuseRanked", () => {
  const hit = (id: string, relevant: boolean, similarity: number | null = null) => ({
    row: { id, source_id: `s${id}`, content: id, title: id, type: "doc", priority: 0 },
    score: 0.5,
    similarity,
    lexical: false,
    relevant,
  });

  it("iki sorgunun sonuçlarını birleştirir; yalnızca birinde ilgili çıkan parça ilgili kalır", () => {
    const merged = fuseRanked([[hit("a", true), hit("b", false)], [hit("c", true), hit("b", true, 0.6)]]);
    assert.deepEqual(merged.map((h) => h.row.id).sort(), ["a", "b", "c"]);
    const b = merged.find((h) => h.row.id === "b");
    assert.equal(b?.relevant, true);
    assert.equal(b?.similarity, 0.6);
    // Her iki listede de bulunan parça tek listedekilerden üstte olmalı.
    assert.equal(merged[0].row.id, "b");
    assert.ok(merged.every((h) => h.score > 0 && h.score <= 1));
  });

  it("yanlış birleşmede mevcut mesajın kaynağı kaçmaz", () => {
    const wrong = [hit("eski-konu", true)];
    const own = [hit("metar", true)];
    assert.ok(fuseRanked([wrong, own]).some((h) => h.row.id === "metar" && h.relevant));
  });
});

describe("takip sorusu tespiti (ReDoS)", () => {
  it("400 bin karakterlik girdiler 500 ms altında işlenir", () => {
    const t0 = performance.now();
    isFollowUp("a".repeat(400_000));
    isFollowUp(`${" ".repeat(400_000)}x`);
    isFollowUp("bu ".repeat(133_000));
    isFollowUp("ve ".repeat(133_000) + " da ");
    assert.ok(performance.now() - t0 < 500, `${Math.round(performance.now() - t0)} ms`);
  });
});
