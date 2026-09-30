import { and, eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { conversations, feedback, messages } from "@/db/schema";
import { allow, clientIp, LIMITS, tooMany } from "@/lib/rate-limit";
import { isUuid, widgetFromRequest } from "@/lib/widget-auth";

export async function POST(request: Request) {
  if (!allow(`feedback:${clientIp(request)}`, LIMITS.feedbackPerMin)) return tooMany();
  const widget = await widgetFromRequest(request);
  if (!widget) return NextResponse.json({ error: "Oturum süresi doldu. Sohbeti yeniden açın." }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const { messageId, rating, comment } = body as Record<string, unknown>;
  if (!isUuid(messageId) || (rating !== 1 && rating !== -1)) return NextResponse.json({ error: "Geçersiz istek." }, { status: 400 });

  const [row] = await db
    .select({ conversationId: messages.conversationId })
    .from(messages)
    .innerJoin(conversations, eq(conversations.id, messages.conversationId))
    .where(and(eq(messages.id, messageId), eq(messages.role, "assistant"), eq(conversations.appUserId, widget.appUser.id)));
  if (!row) return NextResponse.json({ error: "Mesaj bulunamadı." }, { status: 404 });

  const text = typeof comment === "string" ? comment.trim().slice(0, 1000) || null : null;
  await db
    .insert(feedback)
    .values({ messageId, conversationId: row.conversationId, rating, comment: text })
    .onConflictDoUpdate({ target: feedback.messageId, set: { rating, ...(text ? { comment: text } : {}), status: "open" } });
  await db
    .update(conversations)
    .set({ negativeCount: sql`(select count(*)::int from feedback f where f.conversation_id = ${row.conversationId} and f.rating = -1)` })
    .where(eq(conversations.id, row.conversationId));
  return NextResponse.json({ ok: true });
}
