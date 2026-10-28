import { and, desc, eq, gte } from "drizzle-orm";
import { db } from "@/db";
import { conversations, type ChatMode } from "@/db/schema";
import { REUSE_WINDOW_MS } from "./conversation";

/** Kullanıcının aynı moddaki, son 30 dakikada mesajlaşılmış en yeni konuşması; yoksa null. */
export async function pickRecentConversation(botId: string, appUserId: string, mode: ChatMode): Promise<string | null> {
  const [row] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(
      and(
        eq(conversations.appUserId, appUserId),
        eq(conversations.botId, botId),
        eq(conversations.mode, mode),
        gte(conversations.lastMessageAt, new Date(Date.now() - REUSE_WINDOW_MS)),
      ),
    )
    .orderBy(desc(conversations.lastMessageAt))
    .limit(1);
  return row?.id ?? null;
}
