"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { attachments, conversations, type ChatMode } from "@/db/schema";
import { audit } from "@/lib/audit";
import { requireAdmin } from "@/lib/auth";
import { createCorrection } from "@/lib/corrections";
import { done, fail, str } from "@/lib/form";
import { storage } from "@/lib/storage";

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

export async function addCorrection(fd: FormData) {
  const admin = await requireAdmin("training");
  const conversationId = str(fd, "conversationId");
  const back = `/admin/konusmalar/${conversationId}`;
  const question = str(fd, "question", 1000);
  const correct = str(fd, "correct", 4000);
  if (!question || !correct) fail(back, "Soru ve doğru cevap boş olamaz.");
  const [c] = await db.select().from(conversations).where(eq(conversations.id, conversationId));
  if (!c) fail("/admin/konusmalar", "Konuşma bulunamadı.");
  const scope = str(fd, "scope") === "all" ? "all" : (c!.mode as ChatMode);
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
  done(back, "Düzeltme bilgi tabanına eklendi. Bir sonraki yayında kullanıcılara ulaşır.");
}

export async function togglePhoto(fd: FormData) {
  const admin = await requireAdmin("photos");
  const id = str(fd, "id");
  const back = str(fd, "back") || "/admin/fotograflar";
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
  const back = str(fd, "back") || "/admin/fotograflar";
  const [a] = await db.select().from(attachments).where(eq(attachments.id, id));
  if (!a) fail(back, "Fotoğraf bulunamadı.");
  await storage.remove(a!.storageKey).catch(() => {});
  await db.delete(attachments).where(eq(attachments.id, id));
  await audit(admin, "photo.delete", id);
  revalidatePath(back.split("?")[0]);
  done(back, "Fotoğraf kalıcı olarak silindi.");
}
