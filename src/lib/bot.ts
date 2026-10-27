import { and, count, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { botVersions, bots, providers } from "@/db/schema";
import { withPendingCorrections } from "./ai/correction-state";
import { correctionsNeedFullPublish, pendingIndexOnModelSwitch, protectedEmbeddingProviders, snapshotEmbedding, versionsToFreeze, type EmbeddingRef } from "./ai/embedding-freeze";
import { pendingIndexCount, publishableSourceIds as pickPublishable } from "./ai/kb-lifecycle";
import { MODEL_PROBLEM_TEXT, missingModels, type ModelProblem } from "./ai/model-meta";
import { normalizeBotConfig, type BotConfig } from "./bot-config";
import { loadSources, type Executor } from "./kb";
import { getSetting, setSetting } from "./settings";

export type BotRow = typeof bots.$inferSelect;
export type BotVersionRow = typeof botVersions.$inferSelect;

/** Havamania'da tek bir bot var; ilk oluşturulanı döner. */
export async function getMainBot(): Promise<BotRow> {
  const [bot] = await db.select().from(bots).orderBy(bots.createdAt).limit(1);
  if (!bot) throw new Error("Bot bulunamadı. `npm run db:seed` çalıştırın.");
  return { ...bot, draftConfig: normalizeBotConfig(bot.draftConfig) };
}

export async function getBotByPublicKey(publicKey: string): Promise<BotRow | null> {
  const [bot] = await db.select().from(bots).where(eq(bots.publicKey, publicKey));
  return bot ? { ...bot, draftConfig: normalizeBotConfig(bot.draftConfig) } : null;
}

export async function getPublishedVersion(bot: BotRow): Promise<BotVersionRow | null> {
  if (!bot.publishedVersionId) return null;
  const [v] = await db.select().from(botVersions).where(eq(botVersions.id, bot.publishedVersionId));
  return v ? { ...v, config: normalizeBotConfig(v.config, { frozen: true }) } : null;
}

export async function listVersions(botId: string): Promise<BotVersionRow[]> {
  return db.select().from(botVersions).where(eq(botVersions.botId, botId)).orderBy(desc(botVersions.number));
}

/** Tek sürüm (bu bota ait değilse null); config normalize edilir. */
export async function getVersion(botId: string, versionId: string): Promise<BotVersionRow | null> {
  const [v] = await db.select().from(botVersions).where(and(eq(botVersions.id, versionId), eq(botVersions.botId, botId)));
  return v ? { ...v, config: normalizeBotConfig(v.config, { frozen: true }) } : null;
}

export type VersionSummary = Pick<BotVersionRow, "id" | "number" | "note" | "publishedBy" | "publishedAt"> & { sourceCount: number };

/** Sürüm listesi için hafif satırlar (config ve kaynak kimlikleri çekilmez); en yeni önce. */
export async function listVersionSummaries(botId: string, opts: { limit: number; offset?: number }): Promise<VersionSummary[]> {
  return db
    .select({
      id: botVersions.id,
      number: botVersions.number,
      note: botVersions.note,
      publishedBy: botVersions.publishedBy,
      publishedAt: botVersions.publishedAt,
      sourceCount: sql<number>`case when jsonb_typeof(${botVersions.kbSourceIds}) = 'array' then jsonb_array_length(${botVersions.kbSourceIds}) else 0 end`.mapWith(Number),
    })
    .from(botVersions)
    .where(eq(botVersions.botId, botId))
    .orderBy(desc(botVersions.number))
    .limit(opts.limit)
    .offset(opts.offset ?? 0);
}

export async function countVersions(botId: string): Promise<number> {
  const [row] = await db.select({ n: count() }).from(botVersions).where(eq(botVersions.botId, botId));
  return row?.n ?? 0;
}

/** Sürümün geçmiş listesinde kaçıncı sayfada olduğu (en yeni önce); sürüm yoksa 1. */
export async function versionPageOf(botId: string, versionId: string, pageSize: number): Promise<number> {
  const [v] = await db.select({ number: botVersions.number }).from(botVersions).where(and(eq(botVersions.id, versionId), eq(botVersions.botId, botId)));
  if (!v) return 1;
  const [row] = await db.select({ n: count() }).from(botVersions).where(and(eq(botVersions.botId, botId), gt(botVersions.number, v.number)));
  return Math.floor((row?.n ?? 0) / pageSize) + 1;
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Kullanıcıya gösterilebilecek yayın hatası (ör. yayınlanacak bir şey yok). */
export class PublishError extends Error {}

/**
 * Yeni sürüm yazar. Bot satırı kilitlenir (`for update`): eşzamanlı iki yayın
 * sıraya girer, sürüm numarası çakışmaz; kaynak okuma, numara, insert ve
 * `bots` güncellemesi tek transaction'dadır.
 */
async function insertVersion(
  botId: string,
  actorEmail: string,
  build: (tx: Tx, locked: BotRow) => Promise<{ config: BotConfig; kbSourceIds: string[]; note: string | null; embedding: EmbeddingRef | null }>,
): Promise<BotVersionRow> {
  return db.transaction(async (tx) => {
    const [locked] = await tx.select().from(bots).where(eq(bots.id, botId)).for("update");
    if (!locked) throw new PublishError("Bot bulunamadı.");
    const spec = await build(tx, locked);
    const [last] = await tx.select({ n: botVersions.number }).from(botVersions).where(eq(botVersions.botId, botId)).orderBy(desc(botVersions.number)).limit(1);
    const [version] = await tx
      .insert(botVersions)
      .values({ botId, number: (last?.n ?? 0) + 1, config: spec.config, kbSourceIds: spec.kbSourceIds, embedding: spec.embedding, note: spec.note, publishedBy: actorEmail })
      .returning();
    await tx.update(bots).set({ publishedVersionId: version.id, updatedAt: new Date() }).where(eq(bots.id, botId));
    return version;
  });
}

export type PublishDraftOptions = {
  /** Verilmezse bot satırı kilitliyken okunan taslak config'i yayınlanır (yalnızca betikler için geçersiz kılma). */
  config?: BotConfig;
  /** Açık modların modeli eksikse yayını reddeder (kilitli config üzerinde doğrulanır). */
  requireModels?: boolean;
  /**
   * Embedding modeli değişiyorsa ve işlenmeyi bekleyen kaynak varsa yayını reddeder
   * (kilit altında sayılır). Bekleyenler yeni modelle vektörlenmediği için canlıda yalnızca tam metinle bulunur.
   */
  requireIndexed?: boolean;
  /** Çıktı: kapıya takılan ama onayla geçilen bekleyen kaynak sayısı (audit için). */
  report?: { pendingIndex: number };
};

/**
 * Taslağı dondurup yeni bir sürüm olarak yayınlar. Config, bot satırı kilitliyken
 * okunur; model doğrulaması da aynı değerle yapılır. Silinmemiş, içeriği olan,
 * işlemi bitmiş ve yerine geçeni olmayan kaynaklar sürüme girer.
 */
export async function publishDraft(bot: BotRow, actorEmail: string, note: string | null, opts: PublishDraftOptions = {}): Promise<BotVersionRow> {
  return insertVersion(bot.id, actorEmail, async (tx, locked) => {
    const config = opts.config ?? normalizeBotConfig(locked.draftConfig);
    if (opts.requireModels) {
      const problems = await configModelProblems(config, { includeUnset: true }, tx);
      if (problems.length) {
        throw new PublishError(
          `${problems.map((p) => `${p.label} (${MODEL_PROBLEM_TEXT[p.reason]})`).join(", ")}. Bu modlar yayında hata verir; yine de yayınlamak için onay kutusunu işaretleyin.`,
        );
      }
    }
    // Sürüm, yayın anındaki embedding ayarını dondurur; sorgu vektörü bununla üretilir.
    const embedding = snapshotEmbedding(await getSetting("embedding", tx));
    const sources = await loadSources(bot.id, tx);
    const [published] = locked.publishedVersionId ? await tx.select().from(botVersions).where(eq(botVersions.id, locked.publishedVersionId)) : [];
    const pending = pendingIndexOnModelSwitch({ hasPublished: Boolean(published), frozen: published?.embedding, current: embedding, pending: pendingIndexCount(sources) });
    if (pending && opts.requireIndexed) {
      throw new PublishError(
        `Embedding modeli değişti ve ${pending} kaynak henüz yeni modelle işlenmedi; bunlar canlıda yalnızca tam metin aramasıyla bulunur. İşlemin bitmesini bekleyin ya da yine de yayınlamak için onay kutusunu işaretleyin.`,
      );
    }
    if (opts.report) opts.report.pendingIndex = pending;
    return { config, kbSourceIds: pickPublishable(sources), note, embedding };
  });
}

/**
 * Yalnızca bekleyen düzeltme/SSS kaynaklarını yayına alır: config yayındaki sürümün
 * birebir aynısıdır (taslak yayınlanmaz), kaynak listesi yayındaki liste + bekleyenler.
 */
export async function publishCorrections(bot: BotRow, actorEmail: string): Promise<{ version: BotVersionRow; added: number }> {
  let added = 0;
  const version = await insertVersion(bot.id, actorEmail, async (tx, locked) => {
    if (!locked.publishedVersionId) throw new PublishError("Henüz yayınlanmış bir sürüm yok. Önce taslağı yayınlayın.");
    const [published] = await tx.select().from(botVersions).where(eq(botVersions.id, locked.publishedVersionId));
    if (!published) throw new PublishError("Yayındaki sürüm bulunamadı.");
    const next = withPendingCorrections(await loadSources(bot.id, tx), published.kbSourceIds);
    if (!next.added.length) throw new PublishError("Yayını bekleyen düzeltme yok.");
    // Yayındaki sürüm eski embedding modeliyle çalışıyorsa, yeni modelle vektörlenen düzeltmeler onunla bulunamaz.
    if (correctionsNeedFullPublish(published.embedding, snapshotEmbedding(await getSetting("embedding")))) {
      throw new PublishError(
        "Embedding modeli değişti; yayındaki sürüm hâlâ eski modelle çalışıyor. Düzeltmeleri canlıya almak için tüm kaynakların yeniden işlenmesini bekleyip taslağı yayınlayın.",
      );
    }
    added = next.added.length;
    // Config ve embedding yayındaki sürümün birebir aynısıdır.
    return { config: published.config, kbSourceIds: next.kbSourceIds, note: "Yalnızca düzeltmeler", embedding: published.embedding };
  });
  return { version, added };
}

/**
 * Tembel dondurma: korunan sürümlerden `embedding` sütunu boş olanlara (bu özellikten
 * önce yayınlananlar) `current` ayarını yazar. Embedding ayarı değişmeden ya da
 * sağlayıcı silinmeden ÖNCE, bot satırı kilitliyken çağrılır; yoksa boş sütunlu
 * canlı sürüm değişiklikten sonra sessizce yeni modelle sorgulanırdı. Tek seferlik
 * veri migration'ı gerekmez. Güncellenmiş sürüm listesini döner.
 */
async function freezeLegacyEmbeddings(tx: Tx, botId: string, current: EmbeddingRef) {
  const versions = await tx.select({ id: botVersions.id, number: botVersions.number, embedding: botVersions.embedding }).from(botVersions).where(eq(botVersions.botId, botId));
  const [bot] = await tx.select({ publishedVersionId: bots.publishedVersionId }).from(bots).where(eq(bots.id, botId));
  const publishedVersionId = bot?.publishedVersionId ?? null;
  const ids = versionsToFreeze({ versions, publishedVersionId });
  const snap = snapshotEmbedding(current);
  if (ids.length) await tx.update(botVersions).set({ embedding: snap }).where(and(inArray(botVersions.id, ids), isNull(botVersions.embedding)));
  return { versions: versions.map((v) => (ids.includes(v.id) ? { ...v, embedding: snap } : v)), publishedVersionId };
}

/** Yayınla yarışmamak için bot satırını kilitler (publishDraft ile aynı kilit). */
const lockBot = (tx: Tx, botId: string) => tx.select({ id: bots.id }).from(bots).where(eq(bots.id, botId)).for("update");

/**
 * Embedding ayarını değiştirir. Değişiklik varsa, aynı transaction'da ve yayınla
 * aynı kilit altında, boş sütunlu korunan sürümler önce eski ayarla dondurulur.
 */
export async function changeEmbeddingSetting(botId: string, next: EmbeddingRef): Promise<{ changed: boolean }> {
  return db.transaction(async (tx) => {
    await lockBot(tx, botId);
    const prev = await getSetting("embedding", tx);
    const changed = prev.providerId !== next.providerId || prev.model !== next.model;
    if (changed) await freezeLegacyEmbeddings(tx, botId, prev);
    await setSetting("embedding", next, tx);
    return { changed };
  });
}

/**
 * Sağlayıcıyı siler; korunan bir sürümün embedding sağlayıcısıysa silmez ve o
 * sürüm numaralarını döner. Boş sütunlu korunan sürümler önce güncel ayarla
 * dondurulur (sağlayıcı güncel embedding sağlayıcısıysa onlar da korunur).
 */
export async function deleteProviderUnlessFrozen(botId: string, providerId: string): Promise<{ deleted: true } | { deleted: false; frozenBy: number[] }> {
  return db.transaction(async (tx) => {
    await lockBot(tx, botId);
    const emb = await getSetting("embedding", tx);
    const { versions, publishedVersionId } = await freezeLegacyEmbeddings(tx, botId, emb);
    const frozenBy = protectedEmbeddingProviders({ versions, publishedVersionId }).get(providerId);
    if (frozenBy) return { deleted: false as const, frozenBy };
    await tx.delete(providers).where(eq(providers.id, providerId));
    if (emb.providerId === providerId) await setSetting("embedding", { providerId: null, model: null }, tx);
    return { deleted: true as const };
  });
}

/** Açık modların modeli için sağlayıcı ve model hâlâ var mı. */
export async function configModelProblems(config: BotConfig, opts: { includeUnset: boolean }, ex: Executor = db): Promise<ModelProblem[]> {
  const provs = await ex.select({ id: providers.id, models: providers.models }).from(providers);
  return missingModels(config, provs, opts);
}

/**
 * Geri dönüşün sorun listesi: eski sürümün modları için sağlayıcı silinmiş ya da
 * model listeden çıkmış olabilir. Sürüm bu bota ait değilse null.
 */
export async function checkRollback(bot: BotRow, versionId: string): Promise<{ version: BotVersionRow; problems: string[] } | null> {
  const [v] = await db.select().from(botVersions).where(and(eq(botVersions.id, versionId), eq(botVersions.botId, bot.id)));
  if (!v) return null;
  const found = await configModelProblems(normalizeBotConfig(v.config, { frozen: true }), { includeUnset: false });
  return { version: v, problems: found.map((p) => `v${v.number}'teki ${p.label} modu için ${MODEL_PROBLEM_TEXT[p.reason]}`) };
}

/** Geri dönmek = eski bir sürümü yeniden yayındaki sürüm yapmak. Taslak etkilenmez. */
export async function rollbackTo(bot: BotRow, versionId: string): Promise<BotVersionRow | null> {
  const [v] = await db.select().from(botVersions).where(and(eq(botVersions.id, versionId), eq(botVersions.botId, bot.id)));
  if (!v) return null;
  await db.update(bots).set({ publishedVersionId: v.id, updatedAt: new Date() }).where(eq(bots.id, bot.id));
  return v;
}

/**
 * Taslak config'i kilitli okuyup değiştirir ve yazar; iki kişinin aynı anda
 * kaydetmesi birbirinin değişikliğini ezmez. `change` doğrulama için `fail` ile fırlatabilir (geri alınır).
 */
export async function updateDraftConfig(botId: string, change: (config: BotConfig) => void): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx.select({ draftConfig: bots.draftConfig }).from(bots).where(eq(bots.id, botId)).for("update");
    if (!row) throw new Error("Bot bulunamadı.");
    const config = normalizeBotConfig(row.draftConfig);
    change(config);
    await tx.update(bots).set({ draftConfig: config, updatedAt: new Date() }).where(eq(bots.id, botId));
  });
}
