import { eq } from "drizzle-orm";
import { after } from "next/server";
import { db } from "@/db";
import { corrections, feedback, kbSources, type ChatMode } from "@/db/schema";
import { correctionState, pendingCorrectionIds, stateBadge, stateContext, type CorrectionState } from "@/lib/ai/correction-state";
import { processSource } from "@/lib/ai/ingest";
import { getPublishedVersion, type BotRow } from "@/lib/bot";
import { loadSources } from "@/lib/kb";

/**
 * Düzeltme = yüksek öncelikli bir SSS kaydı. Bilgi tabanına eklenir (taslakta
 * hemen aranır), yayındaki bota yeni sürüm yayınlanınca girer. İlgili geri
 * bildirim "çözüldü" olarak kapanır; düzeltmenin yayın durumu ayrıca izlenir.
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
  // Üçü birlikte yazılır ya da hiçbiri: yarım kalan düzeltme (kaynak var, kayıt yok) oluşmaz.
  const source = await db.transaction(async (tx) => {
    const [src] = await tx
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
    await tx.insert(corrections).values({
      messageId: input.messageId ?? null,
      conversationId: input.conversationId ?? null,
      mode: input.mode,
      question: input.question,
      wrongAnswer: input.wrongAnswer ?? null,
      correctAnswer: input.correctAnswer,
      kbSourceId: src.id,
      createdBy: input.actorEmail,
    });
    if (input.messageId) {
      await tx.update(feedback).set({ status: "resolved", resolvedBy: input.actorEmail }).where(eq(feedback.messageId, input.messageId));
    }
    return src;
  });
  // İşleme commit'ten sonra başlar; aksi halde henüz görünmeyen satırı arardı.
  after(() => processSource(source.id));
  return source;
}

export type CorrectionBadge = { state: CorrectionState; label: string; tone: "good" | "warn" | "bad" | "neutral" };

/**
 * Düzeltme/SSS kaynaklarının yayın durumu ("İşleniyor / Hata / Yayın bekliyor / Yayında")
 * ve yayını bekleyen sayısı. Kural lib/ai/correction-state.ts içindedir; yayın ile aynı
 * `publishableSourceIds` kuralına dayanır.
 */
export async function loadCorrectionStatus(bot: BotRow) {
  const rows = await loadSources(bot.id);
  const published = await getPublishedVersion(bot);
  const publishedIds = published?.kbSourceIds ?? [];
  const ctx = stateContext(rows, publishedIds);
  const errors = new Map(rows.map((r) => [r.id, r.error]));
  return {
    hasPublished: Boolean(published),
    pendingCount: pendingCorrectionIds(rows, publishedIds).length,
    badge(sourceId: string | null): CorrectionBadge {
      const state = correctionState(sourceId ? ctx.byId.get(sourceId) : undefined, ctx.published, ctx.publishable, ctx.staleLive);
      return { state, ...stateBadge(state, sourceId ? errors.get(sourceId) : null) };
    },
  };
}
