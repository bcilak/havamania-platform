import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  diffSources,
  draftSourceIds,
  headOf,
  lineageOf,
  pendingIndexCount,
  planPurge,
  planRemoval,
  protectedSourceIds,
  publishableSourceIds,
  type KbRow,
} from "./kb-lifecycle";

const row = (id: string, o: Partial<KbRow> = {}): KbRow => ({ id, deletedAt: null, supersededBy: null, chunkCount: 3, status: "ready", ...o });
const DELETED = new Date("2026-10-01");

describe("taslak ve yayın görünürlüğü", () => {
  it("silinen kaynak taslaktan ve yeni yayından çıkar", () => {
    const rows = [row("a"), row("b", { deletedAt: DELETED })];
    assert.deepEqual(draftSourceIds(rows), ["a"]);
    assert.deepEqual(publishableSourceIds(rows), ["a"]);
  });

  it("halef içerik kazanana kadar eski satır taslakta geçerli kalır", () => {
    const rows = [row("old", { supersededBy: "new" }), row("new", { chunkCount: 0 })];
    assert.deepEqual(draftSourceIds(rows), ["old", "new"]);
    assert.deepEqual(publishableSourceIds(rows), ["old"]);
  });

  it("halef hazır olunca eski satır taslaktan ve yayından düşer", () => {
    const rows = [row("old", { supersededBy: "new" }), row("new")];
    assert.deepEqual(draftSourceIds(rows), ["new"]);
    assert.deepEqual(publishableSourceIds(rows), ["new"]);
  });

  it("silinmiş halef eskisini taslakta tutar; temizlenmiş halef (kayıp bağ) düşürür", () => {
    const deletedNext = [row("old", { supersededBy: "new" }), row("new", { deletedAt: DELETED })];
    assert.deepEqual(draftSourceIds(deletedNext), ["old"]);
    assert.deepEqual(draftSourceIds([row("old", { supersededBy: "temizlenmis" })]), []);
  });

  it("içeriği olmayan (başarısız) kaynak yayına girmez; eski parçalı olan girer", () => {
    const rows = [row("empty", { chunkCount: 0 }), row("kept", { chunkCount: 2 })];
    assert.deepEqual(publishableSourceIds(rows), ["kept"]);
  });
});

describe("işlenmekte olan kaynak yayına girmez", () => {
  it("yerinde yeniden işlenen (pending/processing) hazır kaynak yayına alınmaz, taslakta kalır", () => {
    const rows = [row("a", { status: "pending" }), row("b", { status: "processing" }), row("c", { status: "failed" }), row("d")];
    assert.deepEqual(draftSourceIds(rows), ["a", "b", "c", "d"]);
    assert.deepEqual(publishableSourceIds(rows), ["c", "d"]);
  });

  it("halefi yerinde yeniden işlenirse yayındaki eski satır yayından düşmez", () => {
    const rows = [row("old", { supersededBy: "new" }), row("new", { status: "processing" })];
    assert.deepEqual(publishableSourceIds(rows), ["old"]);
    assert.deepEqual(diffSources(["old"], publishableSourceIds(rows), rows), { added: [], replaced: [], removed: [] });
  });

  it("işlem bitince halef eski satırın yerine geçer", () => {
    const rows = [row("old", { supersededBy: "new" }), row("new")];
    assert.deepEqual(publishableSourceIds(rows), ["new"]);
  });
});

describe("protectedSourceIds", () => {
  const versions = Array.from({ length: 12 }, (_, i) => ({ id: `v${i + 1}`, number: i + 1, kbSourceIds: [`s${i + 1}`] }));

  it("son 10 sürümün kaynaklarını korur", () => {
    const p = protectedSourceIds({ versions, publishedVersionId: "v12" });
    assert.equal(p.size, 10);
    assert.equal(p.has("s12"), true);
    assert.equal(p.has("s3"), true);
    assert.equal(p.has("s2"), false);
  });

  it("yayındaki sürüm eski olsa da korunur", () => {
    const p = protectedSourceIds({ versions, publishedVersionId: "v1" });
    assert.equal(p.has("s1"), true);
  });
});

describe("planRemoval", () => {
  const rows = [row("a"), row("b")];

  it("hiçbir sürümde olmayan kaynak kalıcı silinir", () => {
    const plan = planRemoval({ id: "a", rows, protectedIds: new Set(), publishedIds: new Set() });
    assert.deepEqual(plan, { soft: [], hard: ["a"], live: false });
  });

  it("yayındaki kaynak yumuşak silinir ve live işaretlenir", () => {
    const plan = planRemoval({ id: "a", rows, protectedIds: new Set(["a"]), publishedIds: new Set(["a"]) });
    assert.deepEqual(plan, { soft: ["a"], hard: [], live: true });
  });

  it("yalnızca eski sürümde olan kaynak yumuşak silinir ama live değildir", () => {
    const plan = planRemoval({ id: "a", rows, protectedIds: new Set(["a"]), publishedIds: new Set() });
    assert.deepEqual(plan, { soft: ["a"], hard: [], live: false });
  });

  it("zinciri birlikte siler: yayındaki eski satır yumuşak, yeni satır kalıcı", () => {
    const chain = [row("old", { supersededBy: "new" }), row("new", { chunkCount: 0 })];
    const plan = planRemoval({ id: "new", rows: chain, protectedIds: new Set(["old"]), publishedIds: new Set(["old"]) });
    assert.deepEqual(plan.hard, ["new"]);
    assert.deepEqual(plan.soft, ["old"]);
    assert.equal(plan.live, true);
  });

  it("zaten silinmiş korunan satırı tekrar yazmaz", () => {
    const plan = planRemoval({
      id: "a",
      rows: [row("a", { deletedAt: DELETED })],
      protectedIds: new Set(["a"]),
      publishedIds: new Set(["a"]),
    });
    assert.deepEqual(plan, { soft: [], hard: [], live: false });
  });
});

describe("planPurge", () => {
  it("yalnızca taslakta geçerli olmayan ve korunmayanları döner", () => {
    const rows = [
      row("live-deleted", { deletedAt: DELETED }),
      row("old-deleted", { deletedAt: DELETED }),
      row("active"),
      row("replaced", { supersededBy: "active" }),
    ];
    assert.deepEqual(planPurge(rows, new Set(["live-deleted"])).sort(), ["old-deleted", "replaced"]);
  });
});

describe("headOf ve lineageOf", () => {
  const rows = [row("a", { supersededBy: "b" }), row("b", { supersededBy: "c" }), row("c")];

  it("zincirin başını ve tüm öncekileri bulur", () => {
    assert.equal(headOf("a", rows), "c");
    assert.equal(headOf("c", rows), "c");
    assert.deepEqual(lineageOf("c", rows).sort(), ["a", "b", "c"]);
  });

  it("döngüde takılmaz", () => {
    const loop = [row("x", { supersededBy: "y" }), row("y", { supersededBy: "x" })];
    assert.ok(["x", "y"].includes(headOf("x", loop)));
    assert.equal(lineageOf("x", loop).length, 2);
  });
});

describe("diffSources", () => {
  it("eklenen, yenilenen ve kalkan kaynakları ayırır", () => {
    const rows = [
      row("old", { supersededBy: "new" }),
      row("new"),
      row("gone", { deletedAt: DELETED }),
      row("fresh"),
      row("same"),
    ];
    const d = diffSources(["old", "gone", "same"], ["new", "fresh", "same"], rows);
    assert.deepEqual(d.replaced, [{ from: "old", to: "new" }]);
    assert.deepEqual(d.added, ["fresh"]);
    assert.deepEqual(d.removed, ["gone"]);
  });
});

describe("pendingIndexCount", () => {
  it("bekleyen ve işlenen zincir başlarını sayar", () => {
    const rows = [row("a"), row("b", { status: "pending" }), row("c", { status: "processing" }), row("d", { status: "failed" })];
    assert.equal(pendingIndexCount(rows), 2);
  });

  it("halefi işlenen kaynak bir kez sayılır (eski satır sayılmaz)", () => {
    const rows = [row("old", { supersededBy: "new" }), row("new", { status: "pending", chunkCount: 0 })];
    assert.equal(pendingIndexCount(rows), 1);
  });

  it("silinmiş kaynaklar sayılmaz; hepsi hazırsa 0", () => {
    assert.equal(pendingIndexCount([row("a", { status: "pending", deletedAt: DELETED }), row("b")]), 0);
  });
});
