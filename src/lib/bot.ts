import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { botVersions, bots, kbSources } from "@/db/schema";
import { normalizeBotConfig } from "./bot-config";

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
  return v ? { ...v, config: normalizeBotConfig(v.config) } : null;
}

export async function listVersions(botId: string): Promise<BotVersionRow[]> {
  return db.select().from(botVersions).where(eq(botVersions.botId, botId)).orderBy(desc(botVersions.number));
}

/** Taslağı dondurup yeni bir sürüm olarak yayınlar. O an hazır olan kaynaklar sürüme girer. */
export async function publishDraft(bot: BotRow, actorEmail: string, note: string | null): Promise<BotVersionRow> {
  const ready = await db
    .select({ id: kbSources.id })
    .from(kbSources)
    .where(and(eq(kbSources.botId, bot.id), eq(kbSources.status, "ready")));
  const [last] = await db.select({ n: botVersions.number }).from(botVersions).where(eq(botVersions.botId, bot.id)).orderBy(desc(botVersions.number)).limit(1);
  const [version] = await db
    .insert(botVersions)
    .values({
      botId: bot.id,
      number: (last?.n ?? 0) + 1,
      config: bot.draftConfig,
      kbSourceIds: ready.map((r) => r.id),
      note,
      publishedBy: actorEmail,
    })
    .returning();
  await db.update(bots).set({ publishedVersionId: version.id, updatedAt: new Date() }).where(eq(bots.id, bot.id));
  return version;
}

/** Geri dönmek = eski bir sürümü yeniden yayındaki sürüm yapmak. Taslak etkilenmez. */
export async function rollbackTo(bot: BotRow, versionId: string): Promise<BotVersionRow | null> {
  const [v] = await db.select().from(botVersions).where(and(eq(botVersions.id, versionId), eq(botVersions.botId, bot.id)));
  if (!v) return null;
  await db.update(bots).set({ publishedVersionId: v.id, updatedAt: new Date() }).where(eq(bots.id, bot.id));
  return v;
}
