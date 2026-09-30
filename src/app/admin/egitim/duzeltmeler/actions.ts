"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { corrections, kbSources, type ChatMode } from "@/db/schema";
import { audit } from "@/lib/audit";
import { requireAdmin } from "@/lib/auth";
import { getMainBot } from "@/lib/bot";
import { MODES } from "@/lib/bot-config";
import { createCorrection } from "@/lib/corrections";
import { done, fail, str } from "@/lib/form";

const BACK = "/admin/egitim/duzeltmeler";

export async function addManualCorrection(fd: FormData) {
  const admin = await requireAdmin("training");
  const bot = await getMainBot();
  const question = str(fd, "question", 1000);
  const answer = str(fd, "answer", 4000);
  if (!question || !answer) fail(BACK, "Soru ve doğru cevap boş olamaz.");
  const m = str(fd, "mode");
  await createCorrection({
    botId: bot.id,
    mode: MODES.includes(m as ChatMode) ? (m as ChatMode) : "all",
    question,
    correctAnswer: answer,
    actorEmail: admin.email,
  });
  await audit(admin, "correction.create", null, { question });
  revalidatePath(BACK);
  done(BACK, "Düzeltme eklendi.");
}

export async function deleteCorrection(fd: FormData) {
  const admin = await requireAdmin("training");
  const id = str(fd, "id");
  const [c] = await db.select().from(corrections).where(eq(corrections.id, id));
  if (!c) fail(BACK, "Düzeltme bulunamadı.");
  if (c!.kbSourceId) await db.delete(kbSources).where(eq(kbSources.id, c!.kbSourceId));
  await db.delete(corrections).where(eq(corrections.id, id));
  await audit(admin, "kb.delete", id, { correction: c!.question });
  revalidatePath(BACK);
  done(BACK, "Düzeltme ve bilgi tabanı kaydı silindi.");
}
