"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { and, eq, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { evalCases, evalResults, evalRuns, kbSources, type ChatMode, type EvalExpect } from "@/db/schema";
import { audit } from "@/lib/audit";
import { requireAdmin } from "@/lib/auth";
import { getMainBot } from "@/lib/bot";
import { MODES, TOOLS } from "@/lib/bot-config";
import { parseLocation } from "@/lib/ai/location";
import { clampMaxCost, EVAL_LIMITS, parseEvalTarget, parsePhrases } from "@/lib/eval";
import { cancelEvalRun, deleteEvalCase, EvalStartError, executeEvalRun, reapStaleRuns, startEvalRun } from "@/lib/eval-run";
import { done, fail, num, str, strStrict } from "@/lib/form";

const BASE = "/admin/egitim/test/senaryolar";
const RUN_BASE = "/admin/egitim/test/kosular";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Senaryo ekler (id yok) ya da günceller (id var). */
export async function saveCase(fd: FormData) {
  const admin = await requireAdmin("training");
  const bot = await getMainBot();
  const id = str(fd, "id");
  const back = id ? `${BASE}?duzenle=${id}` : `${BASE}?yeni=1`;

  const question = strStrict(fd, "question", EVAL_LIMITS.questionMax, "Soru", back);
  if (!question) fail(back, "Soru boş olamaz.");
  const mode = str(fd, "mode");
  if (!MODES.includes(mode as ChatMode)) fail(back, "Geçerli bir mod seçin.");
  const note = strStrict(fd, "note", EVAL_LIMITS.noteMax, "Not", back) || null;

  // Konum: ikisi de dolu ve geçerliyse kaydedilir; yarım ya da geçersizse hata.
  const latRaw = str(fd, "lat", 20);
  const lonRaw = str(fd, "lon", 20);
  let location: { lat: number; lon: number; name?: string } | null = null;
  if (latRaw || lonRaw) {
    const parsed = parseLocation({ lat: latRaw.replace(",", "."), lon: lonRaw.replace(",", "."), name: str(fd, "locName", 80) });
    if (!parsed) fail(back, "Konum için geçerli bir enlem (-90..90) ve boylam (-180..180) girin ya da ikisini de boş bırakın.");
    location = parsed!;
  }

  const toolRaw = str(fd, "expectTool");
  if (toolRaw && toolRaw !== "any" && !Object.hasOwn(TOOLS, toolRaw)) fail(back, "Geçersiz araç seçimi.");
  const sourceRaw = str(fd, "expectSource");
  if (sourceRaw) {
    const ok = UUID_RE.test(sourceRaw) && (await db.select({ id: kbSources.id }).from(kbSources).where(and(eq(kbSources.id, sourceRaw), eq(kbSources.botId, bot.id)))).length > 0;
    if (!ok) fail(back, "Beklenen kaynak bulunamadı.");
  }
  const unansweredRaw = str(fd, "expectUnanswered");
  const expect: EvalExpect = {
    mustInclude: parsePhrases(str(fd, "mustInclude", 4000)),
    mustNotInclude: parsePhrases(str(fd, "mustNotInclude", 4000)),
    expectTool: toolRaw || null,
    expectSourceId: sourceRaw || null,
    expectUnanswered: unansweredRaw === "yes" ? true : unansweredRaw === "no" ? false : null,
  };

  if (id) {
    if (!UUID_RE.test(id)) fail(BASE, "Senaryo bulunamadı.");
    const res = await db
      .update(evalCases)
      .set({ question, mode: mode as ChatMode, location, expect, note, updatedAt: new Date() })
      .where(and(eq(evalCases.id, id), eq(evalCases.botId, bot.id)))
      .returning({ id: evalCases.id });
    if (!res.length) fail(BASE, "Senaryo bulunamadı.");
    await audit(admin, "eval.case_update", id, { questionLength: question.length });
    revalidatePath(BASE);
    done(BASE, "Senaryo güncellendi.");
  }

  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(evalCases).where(eq(evalCases.botId, bot.id));
  if (n >= EVAL_LIMITS.maxCases) fail(back, `En fazla ${EVAL_LIMITS.maxCases} senaryo kaydedilebilir. Eskilerini silin.`);
  const [created] = await db
    .insert(evalCases)
    .values({ botId: bot.id, mode: mode as ChatMode, question, location, expect, note, createdBy: admin.email })
    .returning({ id: evalCases.id });
  await audit(admin, "eval.case_create", created.id, { questionLength: question.length });
  revalidatePath(BASE);
  done(BASE, "Senaryo eklendi.");
}

export async function deleteCase(fd: FormData) {
  const admin = await requireAdmin("training");
  const bot = await getMainBot();
  const id = str(fd, "id");
  if (!UUID_RE.test(id)) fail(BASE, "Senaryo bulunamadı.");
  const res = await deleteEvalCase(bot.id, id);
  if (!res) fail(BASE, "Senaryo bulunamadı.");
  await audit(admin, "eval.case_delete", id, res!);
  revalidatePath(BASE);
  done(BASE, "Senaryo silindi. Geçmiş koşulardaki bu senaryonun soru ve cevap metinleri de temizlendi.");
}

/** Seçili (ya da tüm) senaryoları arka planda koşar ve koşu sayfasına yönlendirir. */
export async function startRun(fd: FormData) {
  const admin = await requireAdmin("training");
  const bot = await getMainBot();
  const target = parseEvalTarget(str(fd, "target"));
  if (!target) fail(BASE, "Geçersiz hedef.");
  const maxCostUsd = clampMaxCost(num(fd, "maxCost", EVAL_LIMITS.defaultMaxCostUsd));
  const scope = str(fd, "scope");
  const ids = scope === "all" ? ("all" as const) : fd.getAll("ids").filter((v): v is string => typeof v === "string" && UUID_RE.test(v));

  let started;
  try {
    started = await startEvalRun({ bot, target: target!, caseIds: ids, maxCostUsd, actorEmail: admin.email });
  } catch (e) {
    if (e instanceof EvalStartError) fail(BASE, e.message);
    throw e;
  }
  await audit(admin, "eval.run_start", started.runId, { target: started.target, cases: started.cases.length, maxCostUsd });
  after(() => executeEvalRun({ runId: started.runId, bot, target: started.target, cases: started.cases, maxCostUsd: started.maxCostUsd }));
  revalidatePath(BASE);
  done(`${RUN_BASE}/${started.runId}`, "Koşu başladı; sonuçlar geldikçe bu sayfada görünür.");
}

export async function cancelRun(fd: FormData) {
  const admin = await requireAdmin("training");
  const bot = await getMainBot();
  const id = str(fd, "id");
  if (!UUID_RE.test(id)) fail(BASE, "Koşu bulunamadı.");
  const [run] = await db.select({ id: evalRuns.id }).from(evalRuns).where(and(eq(evalRuns.id, id), eq(evalRuns.botId, bot.id)));
  if (!run) fail(BASE, "Koşu bulunamadı.");
  const ok = await cancelEvalRun(bot.id, id);
  if (ok) await audit(admin, "eval.run_cancel", id);
  revalidatePath(`${RUN_BASE}/${id}`);
  done(`${RUN_BASE}/${id}`, ok ? "Koşu iptal edildi; devam eden senaryo bitince durur." : "Koşu zaten bitmiş.");
}

/**
 * Koşuyu ve tüm sonuçlarını kalıcı siler (sonuçlar soru/cevap metni içerir; KVKK için panelden silinebilir olmalı).
 * Çalışan koşu silinemez; önce iptal edilir.
 */
export async function deleteRun(fd: FormData) {
  const admin = await requireAdmin("training");
  const bot = await getMainBot();
  const id = str(fd, "id");
  if (!UUID_RE.test(id)) fail(BASE, "Koşu bulunamadı.");
  await reapStaleRuns(bot.id); // yarıda kalmış (sunucu ölmüş) koşu silinebilsin
  const [run] = await db.select({ id: evalRuns.id, status: evalRuns.status }).from(evalRuns).where(and(eq(evalRuns.id, id), eq(evalRuns.botId, bot.id)));
  if (!run) fail(BASE, "Koşu bulunamadı.");
  if (run!.status === "running") fail(`${RUN_BASE}/${id}`, "Çalışan koşu silinemez. Önce iptal edin.");
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(evalResults).where(eq(evalResults.runId, id));
  // Yalnızca bitmiş koşu silinir: iptal ile silme arasında yeniden "running" olamaz, ama yarışa karşı koşul tekrar yazılır.
  const res = await db.delete(evalRuns).where(and(eq(evalRuns.id, id), eq(evalRuns.botId, bot.id), ne(evalRuns.status, "running"))).returning({ id: evalRuns.id });
  if (!res.length) fail(`${RUN_BASE}/${id}`, "Çalışan koşu silinemez. Önce iptal edin.");
  await audit(admin, "eval.run_delete", id, { results: n });
  revalidatePath(BASE);
  done(BASE, "Koşu ve sonuçları kalıcı olarak silindi.");
}
