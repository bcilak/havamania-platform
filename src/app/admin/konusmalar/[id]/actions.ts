"use server";

import { and, desc, eq, lt, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { attachments, conversations, evalCases, messages, type ChatMode } from "@/db/schema";
import { audit } from "@/lib/audit";
import { requireAdmin } from "@/lib/auth";
import { findSimilarQa } from "@/lib/ai/retrieval";
import type { SimilarState } from "@/lib/ai/similar-core";
import { createCorrection } from "@/lib/corrections";
import { emptyExpect, EVAL_LIMITS } from "@/lib/eval";
import { bool, done, fail, str, strStrict } from "@/lib/form";
import { safeAdminPath } from "@/lib/form-limits";
import { can } from "@/lib/roles";
import { storage } from "@/lib/storage";

const GAPS_BACK_RE = /^\/admin\/egitim\/bosluklar(\?[A-Za-z0-9=&%_.~-]*)?$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function toggleFlag(fd: FormData) {
  const admin = await requireAdmin("conversations");
  const id = str(fd, "id");
  const [c] = await db.select().from(conversations).where(eq(conversations.id, id));
  if (!c) fail("/admin/konusmalar", "Konuşma bulunamadı.");
  await db.update(conversations).set({ flagged: !c!.flagged }).where(eq(conversations.id, id));
  await audit(admin, "conversation.flag", id, { flagged: !c!.flagged });
  revalidatePath(`/admin/konusmalar/${id}`);
  done(`/admin/konusmalar/${id}`, c!.flagged ? "İşaret kaldırıldı." : "Konuşma işaretlendi.");
}

export async function deleteConversation(fd: FormData) {
  const admin = await requireAdmin("kvkk");
  const id = str(fd, "id");
  const photos = await db.select({ key: attachments.storageKey }).from(attachments).where(eq(attachments.conversationId, id));
  await Promise.all(photos.map((p) => storage.remove(p.key).catch(() => {})));
  await db.delete(conversations).where(eq(conversations.id, id));
  await audit(admin, "conversation.delete", id, { photos: photos.length });
  done("/admin/konusmalar", "Konuşma ve fotoğrafları kalıcı olarak silindi.");
}

/** Benzer kayıt varsa kayıt oluşturmadan benzerleri döndürür (form uyarıyı gösterir); `force` ile atlanır. */
export async function addCorrection(fd: FormData): Promise<SimilarState> {
  const admin = await requireAdmin("training");
  const conversationId = str(fd, "conversationId");
  const back = `/admin/konusmalar/${conversationId}`;
  const question = str(fd, "question", 1000);
  const correct = strStrict(fd, "correct", 4000, "Doğru cevap", back);
  if (!question || !correct) fail(back, "Soru ve doğru cevap boş olamaz.");
  const [c] = await db.select().from(conversations).where(eq(conversations.id, conversationId));
  if (!c) fail("/admin/konusmalar", "Konuşma bulunamadı.");
  const scope = str(fd, "scope") === "all" ? "all" : (c!.mode as ChatMode);
  if (!bool(fd, "force")) {
    const similar = await findSimilarQa({ botId: c!.botId, question, answer: correct, mode: scope });
    if (similar.length) return { similar };
  }
  await createCorrection({
    botId: c!.botId,
    mode: scope,
    question,
    correctAnswer: correct,
    wrongAnswer: str(fd, "wrong", 4000) || null,
    messageId: str(fd, "messageId") || null,
    conversationId,
    actorEmail: admin.email,
  });
  await audit(admin, "correction.create", conversationId, { question });
  revalidatePath(back);
  done(back, "Düzeltme taslağa eklendi; yayınladığınızda canlı asistan kullanır.");
}

export async function togglePhoto(fd: FormData) {
  const admin = await requireAdmin("photos");
  const id = str(fd, "id");
  const back = safeAdminPath(str(fd, "back"), "/admin/fotograflar");
  const [a] = await db.select().from(attachments).where(eq(attachments.id, id));
  if (!a) fail(back, "Fotoğraf bulunamadı.");
  await db.update(attachments).set({ hidden: !a!.hidden }).where(eq(attachments.id, id));
  await audit(admin, a!.hidden ? "photo.show" : "photo.hide", id);
  revalidatePath(back.split("?")[0]);
  done(back, a!.hidden ? "Fotoğraf yeniden görünür." : "Fotoğraf gizlendi. Modele de artık gönderilmeyecek.");
}

export async function deletePhoto(fd: FormData) {
  const admin = await requireAdmin("kvkk");
  const id = str(fd, "id");
  const back = safeAdminPath(str(fd, "back"), "/admin/fotograflar");
  const [a] = await db.select().from(attachments).where(eq(attachments.id, id));
  if (!a) fail(back, "Fotoğraf bulunamadı.");
  await storage.remove(a!.storageKey).catch(() => {});
  await db.delete(attachments).where(eq(attachments.id, id));
  await audit(admin, "photo.delete", id);
  revalidatePath(back.split("?")[0]);
  done(back, "Fotoğraf kalıcı olarak silindi.");
}

/**
 * Bir cevabın sorusunu test senaryosu olarak kaydeder. Soru kullanıcı konuşmasından geldiği için
 * kişisel veri içerebilir: yönetici metni kontrol ettiğini onaylamadan kayıt oluşmaz. Senaryo kaynak
 * mesajdan bağımsızdır (mesaj silinince bağ boşalır, soru metni kalır). Ölçütler senaryo sayfasında girilir.
 */
export async function addCaseFromMessage(fd: FormData) {
  const admin = await requireAdmin("training");
  // Soru metni kullanıcı verisidir; maskeli görenler (pii yetkisi yok) senaryo oluşturamaz.
  if (!can(admin.role, "pii")) fail("/admin/egitim/bosluklar", "Senaryo oluşturmak için kişisel veri yetkisi gerekir.");
  const conversationId = str(fd, "conversationId");
  const messageId = str(fd, "messageId");
  if (!UUID_RE.test(conversationId)) fail("/admin/konusmalar", "Konuşma bulunamadı.");
  if (!UUID_RE.test(messageId)) fail(`/admin/konusmalar/${conversationId}`, "Mesaj bulunamadı.");
  // Boşluk analizi sayfasından gelen istek, hata durumunda o sayfaya döner (yalnızca bu yola izin verilir; açık yönlendirme yok).
  const backParam = str(fd, "back", 300);
  const back = GAPS_BACK_RE.test(backParam) ? backParam : `/admin/konusmalar/${conversationId}#m-${messageId}`;
  const question = strStrict(fd, "question", EVAL_LIMITS.questionMax, "Soru", back);
  if (!question) fail(back, "Soru boş olamaz.");
  if (!bool(fd, "piiOk")) fail(back, "Soruda kişisel veri olmadığını onaylamanız gerekir.");
  const [c] = await db.select().from(conversations).where(eq(conversations.id, conversationId));
  if (!c) fail("/admin/konusmalar", "Konuşma bulunamadı.");
  const [answer] = await db.select().from(messages).where(and(eq(messages.id, messageId), eq(messages.conversationId, conversationId)));
  if (!answer) fail(back, "Mesaj bulunamadı.");
  // Sorunun geldiği kullanıcı mesajı: bu cevaptan önceki son kullanıcı mesajı.
  const [userMsg] = await db
    .select({ id: messages.id })
    .from(messages)
    .where(and(eq(messages.conversationId, conversationId), eq(messages.role, "user"), lt(messages.createdAt, answer!.createdAt)))
    .orderBy(desc(messages.createdAt))
    .limit(1);
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(evalCases).where(eq(evalCases.botId, c!.botId));
  if (n >= EVAL_LIMITS.maxCases) fail(back, `En fazla ${EVAL_LIMITS.maxCases} senaryo kaydedilebilir. Eskilerini silin.`);
  const [created] = await db
    .insert(evalCases)
    .values({
      botId: c!.botId,
      mode: c!.mode,
      question,
      expect: emptyExpect(),
      note: "Konuşmadan eklendi.",
      sourceMessageId: userMsg?.id ?? null,
      createdBy: admin.email,
    })
    .returning({ id: evalCases.id });
  await audit(admin, "eval.case_create", created.id, { conversationId, questionLength: question.length });
  done(`/admin/egitim/test/senaryolar?duzenle=${created.id}`, "Senaryo eklendi. Beklenen ölçütleri belirleyin.");
}
