"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { corrections, type ChatMode } from "@/db/schema";
import { audit } from "@/lib/audit";
import { requireAdmin } from "@/lib/auth";
import { getMainBot } from "@/lib/bot";
import { MODES } from "@/lib/bot-config";
import { createCorrection } from "@/lib/corrections";
import { removeSource } from "@/lib/kb";
import { done, fail, str, strStrict } from "@/lib/form";

const BACK = "/admin/egitim/duzeltmeler";

export async function addManualCorrection(fd: FormData) {
  const admin = await requireAdmin("training");
  const bot = await getMainBot();
  const question = str(fd, "question", 1000);
  const answer = strStrict(fd, "answer", 4000, "Doğru cevap", BACK);
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
  done(BACK, "Düzeltme taslağa eklendi; yayınladığınızda canlı asistan kullanır.");
}

export async function deleteCorrection(fd: FormData) {
  const admin = await requireAdmin("training");
  const id = str(fd, "id");
  const [c] = await db.select().from(corrections).where(eq(corrections.id, id));
  if (!c) fail(BACK, "Düzeltme bulunamadı.");
  const removed = c!.kbSourceId ? await removeSource((await getMainBot()).id, c!.kbSourceId) : null;
  await db.delete(corrections).where(eq(corrections.id, id));
  await audit(admin, "kb.delete", id, { correction: c!.question });
  revalidatePath(BACK);
  done(
    BACK,
    removed?.live
      ? "Düzeltme taslaktan silindi. Yayındaki sürüm, yeni sürüm yayınlanana kadar bu düzeltmeyi kullanmaya devam eder."
      : "Düzeltme ve bilgi tabanı kaydı silindi.",
  );
}
