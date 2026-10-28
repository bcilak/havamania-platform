import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { conversations, feedback, messages } from "@/db/schema";

/**
 * Bir asistan mesajına geri bildirim yazar (widget ve mobil köprü ortak). Mesaj, `appUserId`'nin
 * konuşmasına ait bir asistan mesajı olmalı (`botId` verilirse konuşma o bota da ait olmalı); değilse false döner.
 * Aynı mesaja yeniden oy vermek kaydı günceller ve durumu "open"a çevirir.
 */
export async function recordFeedback(opts: { messageId: string; appUserId: string; botId?: string; rating: 1 | -1; comment?: string | null }): Promise<boolean> {
  const { messageId, appUserId, botId, rating } = opts;
  const [row] = await db
    .select({ conversationId: messages.conversationId })
    .from(messages)
    .innerJoin(conversations, eq(conversations.id, messages.conversationId))
    .where(
      and(
        eq(messages.id, messageId),
        eq(messages.role, "assistant"),
        eq(conversations.appUserId, appUserId),
        botId ? eq(conversations.botId, botId) : undefined,
      ),
    );
  if (!row) return false;

  const text = opts.comment?.trim().slice(0, 1000) || null;
  await db
    .insert(feedback)
    .values({ messageId, conversationId: row.conversationId, rating, comment: text })
    .onConflictDoUpdate({ target: feedback.messageId, set: { rating, ...(text ? { comment: text } : {}), status: "open" } });
  await db
    .update(conversations)
    .set({ negativeCount: sql`(select count(*)::int from feedback f where f.conversation_id = ${row.conversationId} and f.rating = -1)` })
    .where(eq(conversations.id, row.conversationId));
  return true;
}
