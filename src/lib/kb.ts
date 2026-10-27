import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { botVersions, bots, corrections, kbSources } from "@/db/schema";
import {
  draftSourceIds as pickDraft,
  planPurge,
  planRemoval,
  protectedSourceIds,
  publishableSourceIds as pickPublishable,
  type KbRow,
} from "@/lib/ai/kb-lifecycle";
import type { SourcePatch } from "@/lib/ai/kb-edit-core";
import { storage } from "@/lib/storage";

type SourceRow = typeof kbSources.$inferSelect;

const lifecycleRows = (rows: KbRow[]): KbRow[] =>
  rows.map((r) => ({ id: r.id, deletedAt: r.deletedAt, supersededBy: r.supersededBy, chunkCount: r.chunkCount, status: r.status }));

/** `db` ya da bir transaction (yayın, okuma ile yazmayı aynı transaction'da yapar). */
export type Executor = Pick<typeof db, "select">;

export async function loadSources(botId: string, ex: Executor = db): Promise<SourceRow[]> {
  return ex.select().from(kbSources).where(eq(kbSources.botId, botId));
}

/** Yalnızca yaşam döngüsü kolonları (cevap/metin gibi büyük alanlar çekilmez). */
async function loadLifecycle(botId: string, ex: Executor = db): Promise<KbRow[]> {
  return ex
    .select({ id: kbSources.id, deletedAt: kbSources.deletedAt, supersededBy: kbSources.supersededBy, chunkCount: kbSources.chunkCount, status: kbSources.status })
    .from(kbSources)
    .where(eq(kbSources.botId, botId));
}

/** Taslak aramasının kapsadığı kaynaklar. */
export async function draftSourceIds(botId: string): Promise<string[]> {
  return pickDraft(await loadLifecycle(botId));
}

/** Yeni yayına girecek kaynaklar (taslakta geçerli, içeriği olan, işlemi bitmiş). */
export async function publishableSourceIds(botId: string, ex: Executor = db): Promise<string[]> {
  return pickPublishable(await loadLifecycle(botId, ex));
}

/** Yayındaki ve son sürümlerdeki kaynaklar ile yayındaki sürümün kaynakları. */
async function frozenIds(botId: string, ex: Executor = db): Promise<{ protectedIds: Set<string>; publishedIds: Set<string> }> {
  const versions = await ex
    .select({ id: botVersions.id, number: botVersions.number, kbSourceIds: botVersions.kbSourceIds })
    .from(botVersions)
    .where(eq(botVersions.botId, botId));
  const [bot] = await ex.select({ publishedVersionId: bots.publishedVersionId }).from(bots).where(eq(bots.id, botId));
  const publishedVersionId = bot?.publishedVersionId ?? null;
  return {
    protectedIds: protectedSourceIds({ versions, publishedVersionId }),
    publishedIds: new Set(versions.find((v) => v.id === publishedVersionId)?.kbSourceIds ?? []),
  };
}

async function hardDelete(ids: string[]) {
  if (!ids.length) return;
  const rows = await db.select({ id: kbSources.id, storageKey: kbSources.storageKey }).from(kbSources).where(inArray(kbSources.id, ids));
  await db.delete(kbSources).where(inArray(kbSources.id, ids));
  // Dosya, yeniden işleme satırlarıyla paylaşılır; son kullanan silinince depodan kalkar.
  for (const key of new Set(rows.map((r) => r.storageKey).filter((k): k is string => Boolean(k)))) {
    const [still] = await db.select({ id: kbSources.id }).from(kbSources).where(eq(kbSources.storageKey, key)).limit(1);
    if (!still) await storage.remove(key).catch(() => {});
  }
}

/**
 * Kaynağı siler. Sürümlerde geçen satırlar yumuşak silinir (taslaktan çıkar,
 * yayındaki sürüm kullanmaya devam eder); diğerleri kalıcı silinir.
 */
export async function removeSource(botId: string, id: string): Promise<{ soft: number; hard: number; live: boolean } | null> {
  const sources = await loadSources(botId);
  if (!sources.some((s) => s.id === id)) return null;
  const { protectedIds, publishedIds } = await frozenIds(botId);
  const plan = planRemoval({ id, rows: lifecycleRows(sources), protectedIds, publishedIds });
  if (plan.soft.length) await db.update(kbSources).set({ deletedAt: new Date(), updatedAt: new Date() }).where(inArray(kbSources.id, plan.soft));
  await hardDelete(plan.hard);
  return { soft: plan.soft.length, hard: plan.hard.length, live: plan.live };
}

/** Taslakta geçerli olmayan ve hiçbir korunan sürümde yer almayan kaynakları kalıcı siler. */
export async function purgeSources(botId: string): Promise<number> {
  const sources = await loadSources(botId);
  const { protectedIds } = await frozenIds(botId);
  const ids = planPurge(lifecycleRows(sources), protectedIds);
  await hardDelete(ids);
  return ids.length;
}

/** Silinmiş ama hâlâ bir sürümde kullanılan kaynaklar ile temizlenebilecek sayısı. */
export async function purgeSummary(botId: string): Promise<{ stillUsed: SourceRow[]; purgeable: number }> {
  const sources = await loadSources(botId);
  const { protectedIds } = await frozenIds(botId);
  const purgeable = planPurge(lifecycleRows(sources), protectedIds).length;
  return { stillUsed: sources.filter((s) => s.deletedAt && protectedIds.has(s.id)), purgeable };
}

/** Kaynak yayındaki sürümde mi, yayındaki ya da geri alınabilir bir sürümde mi (düzenleme/yeniden işleme yeni satır açar). */
export async function sourceUsage(botId: string, id: string): Promise<{ published: boolean; versioned: boolean }> {
  const { protectedIds, publishedIds } = await frozenIds(botId);
  return { published: publishedIds.has(id), versioned: protectedIds.has(id) };
}

/**
 * Yeniden işlenecek satırı hazırlar. Kaynak bir sürümde geçiyorsa (yayında ya da
 * geri alınabilir sürümlerde) yerinde değiştirilmez: yeni bir satır açılır,
 * eskisi ona bağlanır ve yayın o satırı kullanmaya devam eder. Aksi halde aynı
 * satır işlenir. İşlenecek satırın id'sini döner; silinmiş kaynak için null.
 *
 * `patch` (başlık, mod, soru, cevap) düzenlemeyi taşır: korunan kaynakta yeni satıra,
 * korunmayanda aynı satıra uygulanır. `opts.syncCorrection` verilirse düzeltme
 * kaynağının `corrections` kaydı da aynı transaction'da güncellenir (soru, cevap, mod,
 * updated_at/by); kb_source_id yeni satıra taşınmış olur.
 *
 * Her şey tek transaction'da: bot satırı (yayınla yarışmasın) ve zincirin satırları
 * `for update` ile kilitlenir. Eşzamanlı ikinci çağrı kilidi bekler, birincinin
 * açtığı halefi görür ve yeni halef açmak yerine onu yeniden işler.
 */
export async function beginReprocess(
  botId: string,
  sourceId: string,
  patch?: SourcePatch,
  opts?: { syncCorrection?: { actorEmail: string } },
): Promise<string | null> {
  return db.transaction(async (tx) => {
    // Kilit sırası: bots -> kb_sources (zincirde eskiden yeniye). Yayın da bots'u önce kilitler.
    // "no key update": yayınla (for update) yine çakışır; bots'a anahtar referansı veren eklemeleri (mesaj vb.) bloklamaz.
    await tx.select({ id: bots.id }).from(bots).where(eq(bots.id, botId)).for("no key update");

    let head: SourceRow | undefined;
    const seen = new Set<string>();
    for (let cur: string | null = sourceId; cur && !seen.has(cur); ) {
      seen.add(cur);
      const [row]: SourceRow[] = await tx.select().from(kbSources).where(and(eq(kbSources.id, cur), eq(kbSources.botId, botId))).for("update");
      if (!row) break; // kayıp bağ: zincir son bulunan satırda biter
      head = row;
      cur = row.supersededBy;
    }
    if (!head || head.deletedAt) return null;

    const fields = {
      ...(patch?.title !== undefined ? { title: patch.title } : {}),
      ...(patch?.mode !== undefined ? { mode: patch.mode as SourceRow["mode"] } : {}),
      ...(patch?.question !== undefined ? { question: patch.question } : {}),
      ...(patch?.answer !== undefined ? { answer: patch.answer } : {}),
    };
    const merged = { ...head, ...fields };

    const { protectedIds } = await frozenIds(botId, tx);
    let finalId: string;
    if (!protectedIds.has(head.id)) {
      await tx
        .update(kbSources)
        .set({ status: "pending", ...fields, updatedAt: new Date() })
        .where(eq(kbSources.id, head.id));
      finalId = head.id;
    } else {
      const [next] = await tx
        .insert(kbSources)
        .values({
          botId: head.botId,
          type: head.type,
          mode: merged.mode,
          title: merged.title,
          storageKey: head.storageKey,
          mediaType: head.mediaType,
          url: head.url,
          question: merged.question,
          answer: merged.answer,
          priority: head.priority,
          createdBy: head.createdBy,
        })
        .returning({ id: kbSources.id });
      await tx.update(kbSources).set({ supersededBy: next.id }).where(eq(kbSources.id, head.id));
      await tx.update(corrections).set({ kbSourceId: next.id }).where(eq(corrections.kbSourceId, head.id));
      finalId = next.id;
    }

    if (opts?.syncCorrection && head.type === "correction") {
      await tx
        .update(corrections)
        .set({
          question: merged.question ?? "",
          correctAnswer: merged.answer ?? "",
          mode: merged.mode,
          updatedAt: new Date(),
          updatedBy: opts.syncCorrection.actorEmail,
        })
        .where(eq(corrections.kbSourceId, finalId));
    }
    return finalId;
  });
}
