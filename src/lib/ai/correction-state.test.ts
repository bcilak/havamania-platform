import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { correctionState, matchesStateFilter, parseStateFilter, pendingCorrectionIds, stateBadge, stateContext, withPendingCorrections, type CorrectionSource } from "./correction-state";
import { publishableSourceIds } from "./kb-lifecycle";

const row = (id: string, o: Partial<CorrectionSource> = {}): CorrectionSource => ({
  id,
  type: "correction",
  status: "ready",
  deletedAt: null,
  supersededBy: null,
  chunkCount: 2,
  ...o,
});

function stateOf(id: string, rows: CorrectionSource[], published: string[]) {
  const ctx = stateContext(rows, published);
  return correctionState(ctx.byId.get(id), ctx.published, ctx.publishable, ctx.staleLive);
}

describe("correctionState", () => {
  it("işlenmemiş ve başarısız kaynakları ayırır", () => {
    const rows = [row("p", { status: "processing", chunkCount: 0 }), row("q", { status: "pending", chunkCount: 0 }), row("f", { status: "failed", chunkCount: 0 })];
    assert.equal(stateOf("p", rows, []), "processing");
    assert.equal(stateOf("q", rows, []), "processing");
    assert.equal(stateOf("f", rows, []), "failed");
  });

  it("yayındaki kaynağın halefi başarısız olursa 'yayında (son işlem başarısız)'", () => {
    const rows = [row("old", { supersededBy: "new" }), row("new", { status: "failed", chunkCount: 0 })];
    assert.equal(stateOf("new", rows, ["old"]), "published_stale");
    assert.equal(stateOf("new", rows, []), "failed");
    assert.equal(stateOf("new", [row("new", { status: "failed", chunkCount: 0 })], ["new"]), "failed");
  });

  it("yerinde yeniden işlenen hazır kaynak yayına girmeyen 'processing' sayılır, yayın bekliyor değil", () => {
    assert.equal(stateOf("a", [row("a", { status: "processing" })], []), "processing");
    assert.deepEqual(pendingCorrectionIds([row("a", { status: "pending" })], []), []);
  });

  it("hazır ve yayındaki listede değilse yayın bekliyor, listedeyse yayında", () => {
    const rows = [row("a")];
    assert.equal(stateOf("a", rows, []), "pending");
    assert.equal(stateOf("a", rows, ["a"]), "published");
  });

  it("silinmiş ya da olmayan kaynak 'missing'", () => {
    assert.equal(stateOf("x", [], []), "missing");
    assert.equal(stateOf("a", [row("a", { deletedAt: new Date() })], ["a"]), "missing");
  });

  it("içeriği olmayan hazır kaynak yayına girmeyecek", () => {
    assert.equal(stateOf("a", [row("a", { chunkCount: 0 })], []), "unusable");
  });

  it("yayındaki satırın yenilenmiş hâli yayın bekliyor, eski satır taslakta düşer", () => {
    const rows = [row("old", { supersededBy: "new" }), row("new")];
    assert.equal(stateOf("new", rows, ["old"]), "pending");
    assert.equal(stateOf("old", rows, ["old"]), "published");
  });

  it("kararı publishableSourceIds ile tutarlı: pending olanlar yayına girenlerin alt kümesi", () => {
    const rows = [row("a"), row("b", { chunkCount: 0 }), row("c", { deletedAt: new Date() })];
    const publishable = new Set(publishableSourceIds(rows));
    for (const id of pendingCorrectionIds(rows, [])) assert.ok(publishable.has(id));
    assert.deepEqual(pendingCorrectionIds(rows, []), ["a"]);
  });
});

describe("stateBadge", () => {
  it("etiketler", () => {
    assert.equal(stateBadge("processing").label, "İşleniyor");
    assert.equal(stateBadge("pending").label, "Yayın bekliyor");
    assert.equal(stateBadge("published").label, "Yayında");
    assert.equal(stateBadge("failed", "Metin boş").label, "Hata: Metin boş");
    assert.equal(stateBadge("failed").tone, "bad");
    assert.equal(stateBadge("published_stale", "Metin boş").label, "Yayında (son işlem başarısız: Metin boş)");
  });
});

describe("withPendingCorrections", () => {
  it("yayındaki liste korunur, bekleyen düzeltmeler eklenir", () => {
    const rows = [row("pub", { type: "file" }), row("c1"), row("s1", { type: "qa" })];
    const r = withPendingCorrections(rows, ["pub"]);
    assert.deepEqual(r.kbSourceIds, ["pub", "c1", "s1"]);
    assert.deepEqual(r.added, ["c1", "s1"]);
    assert.deepEqual(r.replaced, []);
  });

  it("bekleyen dosya/URL/site kaynakları yayına alınmaz", () => {
    const rows = [row("f", { type: "file" }), row("u", { type: "url" }), row("w", { type: "cms" }), row("c")];
    assert.deepEqual(withPendingCorrections(rows, []).kbSourceIds, ["c"]);
  });

  it("yayındaki satırın yenilenmiş hâli eskisinin yerine geçer, çift girmez", () => {
    const rows = [row("old", { supersededBy: "new", type: "qa" }), row("new", { type: "qa" })];
    const r = withPendingCorrections(rows, ["x", "old"]);
    assert.deepEqual(r.kbSourceIds, ["x", "new"]);
    assert.deepEqual(r.replaced, ["old"]);
  });

  it("taslakta silinen ama yayında olan düzeltme olduğu gibi kalır (yalnızca eklemek)", () => {
    const rows = [row("gone", { deletedAt: new Date() }), row("c")];
    assert.deepEqual(withPendingCorrections(rows, ["gone"]).kbSourceIds, ["gone", "c"]);
  });

  it("bekleyen yoksa liste aynı kalır", () => {
    const rows = [row("a")];
    const r = withPendingCorrections(rows, ["a"]);
    assert.deepEqual(r.kbSourceIds, ["a"]);
    assert.deepEqual(r.added, []);
  });

  it("işlenmekte olan düzeltme alınmaz", () => {
    const rows = [row("busy", { status: "processing", chunkCount: 0 })];
    assert.deepEqual(withPendingCorrections(rows, []).added, []);
  });
});

describe("durum filtresi", () => {
  it("geçersiz değer boş filtreye düşer", () => {
    assert.equal(parseStateFilter("bekliyor"), "bekliyor");
    assert.equal(parseStateFilter("x"), "");
  });

  it("her durum doğru filtreye girer", () => {
    assert.equal(matchesStateFilter("pending", "bekliyor"), true);
    assert.equal(matchesStateFilter("pending", "yayinda"), false);
    assert.equal(matchesStateFilter("published_stale", "yayinda"), true);
    assert.equal(matchesStateFilter("failed", "hata"), true);
    assert.equal(matchesStateFilter("processing", "isleniyor"), true);
    assert.equal(matchesStateFilter("missing", "bekliyor"), false);
    assert.equal(matchesStateFilter("missing", ""), true);
  });
});
