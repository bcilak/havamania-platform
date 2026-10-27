import { and, asc, desc, eq, gt, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { evalCases, evalResults, evalRuns, type EvalRunSummary, type EvalTarget, type ToolCallRecord } from "@/db/schema";
import { prepareTurn, runTurnOnce } from "@/lib/ai/turn";
import { describeError, describeEvalError, redactErrorText } from "@/lib/ai/turn-core";
import { parseLocation } from "@/lib/ai/location";
import { getPublishedVersion, getVersion, type BotRow } from "@/lib/bot";
import { fmtUsd } from "@/lib/format";
import {
  averageCaseCost,
  costLimitReached,
  estimateRun,
  EVAL_LIMITS,
  classifyResultInsertError,
  evaluateCase,
  normalizeExpect,
  redactChecks,
  redactResultRow,
  tally,
} from "@/lib/eval";

/*
 * Senaryo koşusunun sunucu tarafı: koşuyu başlatır (doğrulama + sınırlar + kayıt) ve
 * `executeEvalRun` ile senaryoları sırayla/2 eşzamanlı çalıştırır. Her senaryo
 * `prepareTurn({ persist: "none" }) + runTurnOnce` ile koşar: konuşma/mesaj yazılmaz, istatistik etkilenmez.
 * `executeEvalRun` Next'e bağlı değildir; eylem onu `after()` içinde çağırır (smoke da doğrudan çağırabilir).
 */

export class EvalStartError extends Error {}

export type EvalCaseRow = typeof evalCases.$inferSelect;

export type StartedRun = { runId: string; cases: EvalCaseRow[]; maxCostUsd: number; target: EvalTarget; estimateUsd: number | null };

const PG_UNIQUE_VIOLATION = "23505";

/** Süreç ölürken `running` kalmış (15 dk ilerlemeyen) koşuları `failed` yapar; tek-koşu kuralını tıkamasın. */
export async function reapStaleRuns(botId: string): Promise<void> {
  await db
    .update(evalRuns)
    .set({
      status: "failed",
      finishedAt: new Date(),
      summary: sql`coalesce(${evalRuns.summary}, '{}'::jsonb) || jsonb_build_object('error', 'Koşu yarıda kaldı (sunucu yeniden başlamış olabilir).')`,
    })
    .where(
      and(
        eq(evalRuns.botId, botId),
        eq(evalRuns.status, "running"),
        sql`coalesce((${evalRuns.summary}->>'lastActivityAt')::timestamptz, ${evalRuns.startedAt}) < now() - make_interval(mins => ${EVAL_LIMITS.staleMinutes})`,
      ),
    );
}

/** Maliyet ortalaması için bakılan son koşu sayısı (tüm sonuç tablosu taranmasın). */
const RECENT_RUNS_FOR_COST = 10;

/** Önceki sonuçlardan senaryo başına ortalama maliyet (son koşulardaki en çok 50 ücretli sonuç). */
export async function recentAverageCost(botId: string): Promise<number | null> {
  const recentRuns = db
    .select({ id: evalRuns.id })
    .from(evalRuns)
    .where(eq(evalRuns.botId, botId))
    .orderBy(desc(evalRuns.startedAt))
    .limit(RECENT_RUNS_FOR_COST);
  const rows = await db
    .select({ cost: evalResults.costUsd })
    .from(evalResults)
    .where(and(inArray(evalResults.runId, recentRuns), gt(evalResults.costUsd, 0)))
    .orderBy(desc(evalResults.createdAt))
    .limit(50);
  return averageCaseCost(rows.map((r) => r.cost));
}

/**
 * Koşuyu doğrular ve kaydeder (status "running"); senaryoları çalıştırmaz.
 * Hata durumunda kullanıcıya gösterilebilir `EvalStartError` fırlatır.
 */
export async function startEvalRun(opts: {
  bot: BotRow;
  target: EvalTarget;
  /** "all": bu bota ait tüm senaryolar (en çok `maxCasesPerRun`). */
  caseIds: string[] | "all";
  maxCostUsd: number;
  actorEmail: string;
}): Promise<StartedRun> {
  const { bot, maxCostUsd } = opts;
  let target = opts.target;
  await reapStaleRuns(bot.id);

  const rows =
    opts.caseIds === "all"
      ? await db.select().from(evalCases).where(eq(evalCases.botId, bot.id)).orderBy(asc(evalCases.createdAt)).limit(EVAL_LIMITS.maxCasesPerRun + 1)
      : opts.caseIds.length
        ? await db
            .select()
            .from(evalCases)
            .where(and(eq(evalCases.botId, bot.id), inArray(evalCases.id, opts.caseIds.slice(0, EVAL_LIMITS.maxCasesPerRun + 1))))
            .orderBy(asc(evalCases.createdAt))
        : [];
  if (!rows.length) throw new EvalStartError("Koşulacak senaryo seçilmedi.");
  if (rows.length > EVAL_LIMITS.maxCasesPerRun) {
    throw new EvalStartError(`Bir koşuda en fazla ${EVAL_LIMITS.maxCasesPerRun} senaryo çalıştırılabilir. Daha azını seçin.`);
  }

  let versionNumber: number | null = null;
  if (target === "published") {
    const v = await getPublishedVersion(bot);
    if (!v) throw new EvalStartError("Asistan henüz yayınlanmadı; yayındaki sürümle koşu yapılamaz.");
    versionNumber = v.number;
    // "Yayındaki" koşu başında o anki sürüme sabitlenir: koşu sürerken yeni yayın/geri dönüş
    // olsa bile tüm senaryolar aynı sürümle çalışır ve kayıtta doğru sürüm görünür.
    target = { versionId: v.id };
  } else if (typeof target === "object") {
    const v = await getVersion(bot.id, target.versionId);
    if (!v) throw new EvalStartError("Sürüm bulunamadı.");
    versionNumber = v.number;
  }

  const est = estimateRun(rows.length, await recentAverageCost(bot.id), maxCostUsd);
  if (est.overLimit) {
    throw new EvalStartError(
      `Tahmini maliyet (${fmtUsd(est.estimateUsd)}) maliyet sınırını (${fmtUsd(maxCostUsd)}) aşıyor. Sınırı yükseltin ya da daha az senaryo seçin.`,
    );
  }

  const summary: EvalRunSummary = {
    total: rows.length,
    completed: 0,
    passed: 0,
    failed: 0,
    unchecked: 0,
    maxCostUsd,
    skipped: 0,
    stoppedBy: null,
    lastActivityAt: new Date().toISOString(),
  };
  try {
    const [run] = await db
      .insert(evalRuns)
      .values({ botId: bot.id, target, versionNumber, status: "running", startedBy: opts.actorEmail, summary, costUsd: 0 })
      .returning({ id: evalRuns.id });
    return { runId: run.id, cases: rows, maxCostUsd, target, estimateUsd: est.estimateUsd };
  } catch (e) {
    if ((e as { code?: string; cause?: { code?: string } })?.code === PG_UNIQUE_VIOLATION || (e as { cause?: { code?: string } })?.cause?.code === PG_UNIQUE_VIOLATION) {
      throw new EvalStartError("Zaten çalışan bir koşu var. Bitmesini bekleyin ya da iptal edin.");
    }
    throw e;
  }
}

/** Koşuyu iptal eder (çalışan işi bir sonraki senaryodan önce durdurur). Koşu çalışmıyorsa false. */
export async function cancelEvalRun(botId: string, runId: string): Promise<boolean> {
  const res = await db
    .update(evalRuns)
    .set({ status: "cancelled", finishedAt: new Date() })
    .where(and(eq(evalRuns.id, runId), eq(evalRuns.botId, botId), eq(evalRuns.status, "running")))
    .returning({ id: evalRuns.id });
  return res.length > 0;
}

async function isRunning(runId: string): Promise<boolean> {
  const [r] = await db.select({ status: evalRuns.status }).from(evalRuns).where(eq(evalRuns.id, runId));
  return r?.status === "running";
}

/**
 * Senaryoyu siler; geçmiş sonuçlardaki soru/cevap kopyası da boşaltılır (kişisel veri kalmasın), geçerlilik
 * bilgisi, ölçüt sonuçları, token ve maliyet kalır. Maskeleme FK `set null` bağı koparmadan önce yapılır.
 * Senaryo satırı en başta `for update` ile kilitlenir: koşu sırasında sonuç yazan insert'in FK denetimi
 * (ve `insertEvalResult`'ın `for key share`'i) silme commit olana dek bekler, sonra boşaltılmış satır yazar;
 * maskeleme ile silme arasına girip açık metinli, bağsız satır bırakamaz. Senaryo yoksa null.
 */
export async function deleteEvalCase(botId: string, caseId: string): Promise<{ questionLength: number; maskedResults: number } | null> {
  return db.transaction(async (tx) => {
    const [c] = await tx
      .select({ question: evalCases.question })
      .from(evalCases)
      .where(and(eq(evalCases.id, caseId), eq(evalCases.botId, botId)))
      .for("update");
    if (!c) return null;
    // Soru/cevap/araç verisi boşalır, hata yalnızca türüne iner, ölçüt etiketleri sıra no'ya döner (redactResultRow ile aynı kural).
    const rows = await tx.select({ id: evalResults.id, error: evalResults.error, checks: evalResults.checks }).from(evalResults).where(eq(evalResults.caseId, caseId));
    for (const r of rows) {
      await tx
        .update(evalResults)
        .set({ question: "", answer: "", toolCalls: [], error: redactErrorText(r.error), checks: redactChecks(r.checks) })
        .where(eq(evalResults.id, r.id));
    }
    await tx.delete(evalCases).where(eq(evalCases.id, caseId));
    return { questionLength: c.question.length, maskedResults: rows.length };
  });
}

/**
 * Bir senaryo sonucunu kaydeder. Senaryo satırı insert'ten önce aynı transaction'da `for key share` ile
 * kilitlenir: `deleteCase` (`for update`) ile birbirini bekler; senaryo silinmişse (ya da silme commit olunca
 * FK reddederse) kişisel veri kalmasın diye soru/cevap/araç verisi boşaltılmış, senaryoya bağsız satır yazılır.
 * Satır yine de yazılır ki koşu özeti (completed/maliyet) ile sonuç listesi tutarlı kalsın.
 * Koşunun kendisi silinmişse hiçbir şey yazılmaz ("run-gone").
 */
export async function insertEvalResult(row: typeof evalResults.$inferInsert & { caseId: string | null; question: string; answer: string; toolCalls: ToolCallRecord[] }): Promise<"saved" | "redacted" | "run-gone"> {
  let outcome: "saved" | "redacted" = "saved";
  try {
    await db.transaction(async (tx) => {
      let values = row;
      if (row.caseId) {
        const [alive] = await tx.select({ id: evalCases.id }).from(evalCases).where(eq(evalCases.id, row.caseId)).for("key share");
        if (!alive) values = redactResultRow(row);
      }
      outcome = values === row ? "saved" : "redacted";
      await tx.insert(evalResults).values(values);
    });
    return outcome;
  } catch (e) {
    const kind = classifyResultInsertError(e);
    if (kind === "run") return "run-gone";
    if (kind !== "case") throw e;
    await db.insert(evalResults).values(redactResultRow(row));
    return "redacted";
  }
}

/**
 * Senaryoları çalıştırır ve sonuçları `eval_results`'a yazar. İptal ve maliyet sınırı her
 * senaryodan önce denetlenir (devam eden en çok `concurrency` senaryo tamamlanır, bu yüzden
 * harcama sınırı en fazla bu kadar senaryo kadar aşılabilir). Hata fırlatmaz; beklenmedik bir
 * hata koşuyu `failed` yapar.
 */
export async function executeEvalRun(opts: { runId: string; bot: BotRow; target: EvalTarget; cases: EvalCaseRow[]; maxCostUsd: number }): Promise<void> {
  const { runId, bot, target, cases, maxCostUsd } = opts;
  const acc: EvalRunSummary = {
    total: cases.length,
    completed: 0,
    passed: 0,
    failed: 0,
    unchecked: 0,
    maxCostUsd,
    skipped: 0,
    stoppedBy: null,
    lastActivityAt: new Date().toISOString(),
  };
  const outcomes: { passed: boolean | null }[] = [];
  let spent = 0;
  let next = 0;

  const flush = async () => {
    acc.lastActivityAt = new Date().toISOString();
    acc.skipped = acc.total - acc.completed;
    // Yarıda kalıp `failed` yapılmış koşunun kaydı ezilmez; iptal edilmiş koşuda devam eden
    // senaryoların sonucu yine özete ve maliyete yazılır.
    await db
      .update(evalRuns)
      .set({ summary: { ...acc }, costUsd: spent })
      .where(and(eq(evalRuns.id, runId), inArray(evalRuns.status, ["running", "cancelled"])));
  };

  async function runCase(c: EvalCaseRow) {
    const expect = normalizeExpect(c.expect);
    const signal = AbortSignal.timeout(EVAL_LIMITS.caseTimeoutMs);
    let answer = "";
    let error: string | null = null;
    let sources: Awaited<ReturnType<typeof runTurnOnce>>["sources"] = [];
    let toolCalls: Awaited<ReturnType<typeof runTurnOnce>>["toolCalls"] = [];
    let toolNames: string[] = [];
    let unanswered = false;
    let inputTokens = 0;
    let outputTokens = 0;
    let costUsd = 0;
    let latencyMs = 0;
    const started = Date.now();
    try {
      const turn = await prepareTurn({
        bot,
        appUser: null,
        platform: "playground",
        conversationId: crypto.randomUUID(),
        mode: c.mode,
        text: c.question,
        attachmentIds: [],
        location: parseLocation(c.location),
        useDraft: target === "draft",
        target,
        persist: "none",
        abortSignal: signal,
      });
      const res = await runTurnOnce(turn);
      answer = res.text;
      error = res.error;
      sources = res.sources;
      toolCalls = res.toolCalls;
      toolNames = res.toolNames;
      unanswered = res.unanswered;
      inputTokens = res.inputTokens;
      outputTokens = res.outputTokens;
      costUsd = res.costUsd;
      latencyMs = res.latencyMs;
      if (signal.aborted && !error) error = `Zaman aşımı (${EVAL_LIMITS.caseTimeoutMs / 1000} sn)`;
    } catch (e) {
      // Sağlayıcı/SDK ham mesajı saklanmaz (kullanıcı girdisini yansıtabilir); bizim ChatError metinlerimiz korunur.
      console.error("[eval] senaryo hatası:", e);
      error = describeEvalError(e);
      latencyMs = Date.now() - started;
    }

    const { passed, checks } = evaluateCase(expect, {
      answer,
      error,
      toolNames,
      sourceIds: [...new Set(sources.map((s) => s.sourceId))],
      unanswered,
    });
    const row = {
      runId,
      caseId: c.id as string | null,
      question: c.question,
      mode: c.mode,
      answer,
      sources,
      toolCalls,
      checks,
      passed,
      unanswered,
      inputTokens,
      outputTokens,
      costUsd,
      latencyMs,
      error,
    };
    if ((await insertEvalResult(row)) === "run-gone") return; // koşu silinmiş: sessizce dur (sonraki isRunning denetimi işçileri durdurur)
    spent += costUsd;
    outcomes.push({ passed });
    acc.completed++;
    Object.assign(acc, tally(outcomes));
    await flush();
  }

  async function worker() {
    for (;;) {
      if (acc.stoppedBy) return;
      if (!(await isRunning(runId))) {
        acc.stoppedBy ??= "cancel";
        return;
      }
      if (costLimitReached(spent, maxCostUsd)) {
        acc.stoppedBy ??= "cost";
        return;
      }
      const i = next++;
      if (i >= cases.length) return;
      await runCase(cases[i]);
    }
  }

  try {
    await Promise.all(Array.from({ length: Math.min(EVAL_LIMITS.concurrency, cases.length) }, worker));
    await flush();
    await db.update(evalRuns).set({ status: "done", finishedAt: new Date() }).where(and(eq(evalRuns.id, runId), eq(evalRuns.status, "running")));
  } catch (e) {
    console.error("[eval] koşu başarısız:", e);
    acc.error = describeError(e);
    await flush().catch(() => {});
    await db
      .update(evalRuns)
      .set({ status: "failed", finishedAt: new Date() })
      .where(and(eq(evalRuns.id, runId), eq(evalRuns.status, "running")))
      .catch(() => {});
  }
}
