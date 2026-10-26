import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  correctionsNeedFullPublish,
  effectiveEmbedding,
  embeddingLabel,
  isVectorOn,
  pendingIndexOnModelSwitch,
  protectedEmbeddingProviders,
  sameEmbedding,
  snapshotEmbedding,
  versionsToFreeze,
  type EmbeddingRef,
} from "./embedding-freeze";
import { protectedVersions } from "./kb-lifecycle";

const OLD = { providerId: "p-old", model: "text-embedding-3-small" };
const NEW = { providerId: "p-new", model: "text-embedding-3-large" };
const OFF = { providerId: null, model: null };

describe("effectiveEmbedding", () => {
  it("dondurulmuş ayar varsa güncel ayar yok sayılır", () => {
    assert.deepEqual(effectiveEmbedding(OLD, NEW), OLD);
  });

  it("eski sürümde (kayıt yok) güncel ayar kullanılır", () => {
    assert.deepEqual(effectiveEmbedding(null, NEW), NEW);
    assert.deepEqual(effectiveEmbedding(undefined, NEW), NEW);
  });

  it("yayın anında vektör kapalıysa sonradan açılan model canlıya girmez", () => {
    assert.deepEqual(effectiveEmbedding(OFF, NEW), OFF);
    assert.equal(isVectorOn(effectiveEmbedding(OFF, NEW)), false);
  });
});

describe("sameEmbedding / snapshotEmbedding", () => {
  it("sağlayıcı ve model birlikte karşılaştırılır", () => {
    assert.equal(sameEmbedding(OLD, { ...OLD }), true);
    assert.equal(sameEmbedding(OLD, { ...OLD, model: "x" }), false);
    assert.equal(sameEmbedding(OLD, { ...OLD, providerId: "y" }), false);
    assert.equal(sameEmbedding(OFF, { providerId: null, model: null }), true);
  });

  it("anlık görüntü eksik alanları null yapar", () => {
    assert.deepEqual(snapshotEmbedding({ providerId: undefined as unknown as null, model: "m" }), { providerId: null, model: "m" });
  });
});

describe("protectedEmbeddingProviders", () => {
  const mk = (n: number, embedding: EmbeddingRef | null) => ({ id: `v${n}`, number: n, embedding });

  it("yayındaki sürümün dondurulmuş sağlayıcısı korunur", () => {
    const m = protectedEmbeddingProviders({ versions: [mk(1, OLD), mk(2, NEW)], publishedVersionId: "v1" });
    assert.deepEqual(m.get("p-old"), [1]);
    assert.deepEqual(m.get("p-new"), [2]);
  });

  it("aynı sağlayıcıyı kullanan sürümler birlikte listelenir", () => {
    const m = protectedEmbeddingProviders({ versions: [mk(3, OLD), mk(1, OLD), mk(2, NEW)], publishedVersionId: "v3" });
    assert.deepEqual(m.get("p-old"), [1, 3]);
  });

  it("eski sürümler (kayıt yok) ve vektörü kapalı sürümler sağlayıcı korumaz", () => {
    const m = protectedEmbeddingProviders({ versions: [mk(1, null), mk(2, OFF)], publishedVersionId: "v2" });
    assert.equal(m.size, 0);
  });

  it("geri alınabilir son 10 sürümün dışındaki sürüm korumaz, yayındaki olsa bile korunur", () => {
    const versions = Array.from({ length: 12 }, (_, i) => mk(i + 1, i === 0 ? OLD : NEW));
    assert.equal(protectedEmbeddingProviders({ versions, publishedVersionId: "v12" }).has("p-old"), false);
    assert.deepEqual(protectedEmbeddingProviders({ versions, publishedVersionId: "v1" }).get("p-old"), [1]);
  });
});

describe("versionsToFreeze", () => {
  const mk = (n: number, embedding: EmbeddingRef | null) => ({ id: `v${n}`, number: n, embedding });

  it("korunan sürümlerden yalnızca boş sütunlu olanlar dondurulur", () => {
    const versions = [mk(1, null), mk(2, OLD), mk(3, null), mk(4, OFF)];
    assert.deepEqual(versionsToFreeze({ versions, publishedVersionId: "v3" }).sort(), ["v1", "v3"]);
  });

  it("canlı sürüm boş sütunluysa ayar değişmeden önce dondurulur (sessiz model geçişi olmaz)", () => {
    const versions = [mk(1, null)];
    const ids = versionsToFreeze({ versions, publishedVersionId: "v1" });
    assert.deepEqual(ids, ["v1"]);
    // Dondurulduktan sonra güncel ayar değişse de canlı eski modelle sorgular ve sağlayıcısı korunur.
    const frozen = versions.map((v) => (ids.includes(v.id) ? { ...v, embedding: OLD } : v));
    assert.deepEqual(effectiveEmbedding(frozen[0].embedding, NEW), OLD);
    assert.deepEqual(protectedEmbeddingProviders({ versions: frozen, publishedVersionId: "v1" }).get("p-old"), [1]);
  });

  it("vektörü kapalı dondurulmuş sürüm yeniden dondurulmaz", () => {
    assert.deepEqual(versionsToFreeze({ versions: [mk(1, OFF)], publishedVersionId: "v1" }), []);
  });

  it("geri alınabilir son sürümlerin dışındaki boş sütunlu sürüm dondurulmaz, yayındaki olsa bile dondurulur", () => {
    const versions = Array.from({ length: 12 }, (_, i) => mk(i + 1, null));
    assert.equal(versionsToFreeze({ versions, publishedVersionId: "v12" }).includes("v1"), false);
    assert.equal(versionsToFreeze({ versions, publishedVersionId: "v12" }).length, 10);
    assert.equal(versionsToFreeze({ versions, publishedVersionId: "v1" }).includes("v1"), true);
  });
});

describe("protectedVersions", () => {
  it("son N sürüm + yayındaki sürüm (tekrarsız)", () => {
    const versions = Array.from({ length: 5 }, (_, i) => ({ id: `v${i + 1}`, number: i + 1 }));
    assert.deepEqual(protectedVersions({ versions, publishedVersionId: "v5", keep: 2 }).map((v) => v.number), [5, 4]);
    assert.deepEqual(protectedVersions({ versions, publishedVersionId: "v1", keep: 2 }).map((v) => v.number), [5, 4, 1]);
  });
});

describe("correctionsNeedFullPublish", () => {
  it("dondurulmuş model güncelden farklıysa yalnız-düzeltme yayını engellenir", () => {
    assert.equal(correctionsNeedFullPublish(OLD, NEW), true);
  });

  it("aynı modelde ya da eski sürümde (kayıt yok) engellenmez", () => {
    assert.equal(correctionsNeedFullPublish(OLD, OLD), false);
    assert.equal(correctionsNeedFullPublish(null, NEW), false);
  });
});

describe("embeddingLabel", () => {
  const provs = [{ id: "p-old", name: "OpenAI" }];

  it("sağlayıcı adı ve model", () => {
    assert.equal(embeddingLabel(OLD, provs), "OpenAI · text-embedding-3-small");
  });

  it("kapalı ve silinmiş sağlayıcı", () => {
    assert.match(embeddingLabel(OFF, provs), /kapalı/);
    assert.match(embeddingLabel(NEW, provs), /silinmiş sağlayıcı/);
  });
});

describe("pendingIndexOnModelSwitch", () => {
  it("model değişiyor ve bekleyen kaynak varsa sayıyı döner", () => {
    assert.equal(pendingIndexOnModelSwitch({ hasPublished: true, frozen: OLD, current: NEW, pending: 3 }), 3);
    assert.equal(pendingIndexOnModelSwitch({ hasPublished: true, frozen: OLD, current: OFF, pending: 1 }), 1);
  });

  it("model aynıysa, bekleyen yoksa ya da ilk yayında kapı yoktur", () => {
    assert.equal(pendingIndexOnModelSwitch({ hasPublished: true, frozen: OLD, current: OLD, pending: 3 }), 0);
    assert.equal(pendingIndexOnModelSwitch({ hasPublished: true, frozen: OLD, current: NEW, pending: 0 }), 0);
    assert.equal(pendingIndexOnModelSwitch({ hasPublished: false, frozen: null, current: NEW, pending: 3 }), 0);
  });

  it("eski sürüm (kayıt yok) güncel ayarla çalıştığı için kapı yoktur", () => {
    assert.equal(pendingIndexOnModelSwitch({ hasPublished: true, frozen: null, current: NEW, pending: 3 }), 0);
  });
});
