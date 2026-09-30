import { eq } from "drizzle-orm";
import { after } from "next/server";
import { db } from "@/db";
import { corrections, feedback, kbSources, type ChatMode } from "@/db/schema";
import { processSource } from "@/lib/ai/ingest";

/**
 * Düzeltme = yüksek öncelikli bir SSS kaydı. Bilgi tabanına eklenir, bir sonraki
 * yayında yayındaki bota girer. İlgili geri bildirim "çözüldü" olarak kapanır.
 */
export async function createCorrection(input: {
  botId: string;
  mode: ChatMode | "all";
  question: string;
  correctAnswer: string;
  wrongAnswer?: string | null;
  messageId?: string | null;
  conversationId?: string | null;
  actorEmail: string;
}) {
  const [source] = await db
    .insert(kbSources)
    .values({
      botId: input.botId,
      type: "correction",
      mode: input.mode,
      title: input.question.slice(0, 120),
      question: input.question,
      answer: input.correctAnswer,
      priority: 10,
      createdBy: input.actorEmail,
    })
    .returning();
  await db.insert(corrections).values({
    messageId: input.messageId ?? null,
    conversationId: input.conversationId ?? null,
    mode: input.mode,
    question: input.question,
    wrongAnswer: input.wrongAnswer ?? null,
    correctAnswer: input.correctAnswer,
    kbSourceId: source.id,
    createdBy: input.actorEmail,
  });
  if (input.messageId) {
    await db.update(feedback).set({ status: "resolved", resolvedBy: input.actorEmail }).where(eq(feedback.messageId, input.messageId));
  }
  after(() => processSource(source.id));
  return source;
}
