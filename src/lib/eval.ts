import type { EvalCheck, EvalExpect, EvalRunStatus, EvalRunSummary, EvalTarget } from "@/db/schema";
import { redactErrorText } from "@/lib/ai/turn-core";

/*
 * Test senaryolarının saf mantığı (veritabanı ve model yok): beklenen ölçütlerin ayrıştırılması,
 * deterministik kontrol, koşu özeti, maliyet kuralları ve iki koşunun karşılaştırılması.
 * LLM ile puanlama kapsam dışıdır.
 */

export const EVAL_LIMITS = {
  /** Koşu başına en çok senaryo. */
  maxCasesPerRun: 100,
  /** Aynı anda model çağrısı yapan senaryo sayısı. */
  concurrency: 2,
  defaultMaxCostUsd: 1,
  /** Panelden verilebilecek en yüksek maliyet sınırı. */
  maxCostCeilingUsd: 10,
  /** Bot başına kayıtlı senaryo üst sınırı. */
  maxCases: 500,
  /** Bu süredir ilerlemeyen "running" koşu yarıda kalmış sayılır. */
  staleMinutes: 15,
  /** Tek senaryonun model süresi üst sınırı. */
  caseTimeoutMs: 120_000,
  questionMax: 1000,
  noteMax: 300,
  phraseMax: 200,
  phrasesPerList: 10,
} as const;

/* ---------- Metin eşleştirme ---------- */

/** Türkçe küçük harf ("İ" → "i", "I" → "ı"), NFC ve tek boşluk. */
export function trLower(s: string): string {
  return s.normalize("NFC").toLocaleLowerCase("tr-TR").replace(/\s+/g, " ").trim();
}

/** Türkçe küçük harfe çevrilmiş içerme. Boş ifade hiçbir zaman eşleşmez. */
export function includesTr(text: string, phrase: string): boolean {
  const p = trLower(phrase);
  return p.length > 0 && trLower(text).includes(p);
}

/* ---------- Ölçütler ---------- */

export const emptyExpect = (): EvalExpect => ({ mustInclude: [], mustNotInclude: [], expectTool: null, expectSourceId: null, expectUnanswered: null });

/** Satır başına bir ifade; boşlar atılır, tekrarlar silinir, sınırlar uygulanır. */
export function parsePhrases(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const p = line.trim().slice(0, EVAL_LIMITS.phraseMax);
    const key = trLower(p);
    if (!p || seen.has(key)) continue;
    seen.add(key);
    out.push(p);
    if (out.length >= EVAL_LIMITS.phrasesPerList) break;
  }
  return out;
}

/** Veritabanından gelen `expect` değerini güvenli biçime getirir (eksik/bozuk alanlar boş sayılır). */
export function normalizeExpect(raw: unknown): EvalExpect {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim().length > 0) : []);
  return {
    mustInclude: list(r.mustInclude),
    mustNotInclude: list(r.mustNotInclude),
    expectTool: typeof r.expectTool === "string" && r.expectTool ? r.expectTool : null,
    expectSourceId: typeof r.expectSourceId === "string" && r.expectSourceId ? r.expectSourceId : null,
    expectUnanswered: typeof r.expectUnanswered === "boolean" ? r.expectUnanswered : null,
  };
}

/** En az bir ölçüt tanımlı mı? */
export function hasExpectations(e: EvalExpect): boolean {
  return e.mustInclude.length > 0 || e.mustNotInclude.length > 0 || Boolean(e.expectTool) || Boolean(e.expectSourceId) || typeof e.expectUnanswered === "boolean";
}

export type EvalOutcome = {
  answer: string;
  /** Model/hazırlık hatası; doluysa senaryo kalır. */
  error: string | null;
  toolNames: string[];
  /** İlgili bulunup bağlama giren kaynakların kimlikleri. */
  sourceIds: string[];
  unanswered: boolean;
};

/** İfade ölçütlerinin etiketi: "İçermeli #1" / "İçermemeli #2" (ifadenin kendisi yazılmaz). */
export function phraseCheckLabel(kind: "include" | "exclude", n: number): string {
  return `${kind === "include" ? "İçermeli" : "İçermemeli"} #${n}`;
}

/**
 * Deterministik değerlendirme. Ölçüt yoksa `passed` null (değerlendirilmedi).
 * Hata varsa diğer kontroller anlamsız olduğu için tek "model yanıt vermedi" kontrolüyle kalır.
 */
export function evaluateCase(expect: EvalExpect, o: EvalOutcome): { passed: boolean | null; checks: EvalCheck[] } {
  if (o.error) {
    // Hata metni ayrıca `error` alanında; ölçüt satırı ham mesaj taşımaz.
    return { passed: false, checks: [{ id: "error", label: "Model cevap verdi", ok: false }] };
  }
  const checks: EvalCheck[] = [];
  // Ölçüt ifadeleri kişisel veri içerebilir; etiket ifadeyi değil sırasını taşır.
  expect.mustInclude.forEach((p, i) => {
    const ok = includesTr(o.answer, p);
    checks.push({ id: "include", label: phraseCheckLabel("include", i + 1), ok, detail: ok ? undefined : "cevapta yok" });
  });
  expect.mustNotInclude.forEach((p, i) => {
    const ok = !includesTr(o.answer, p);
    checks.push({ id: "exclude", label: phraseCheckLabel("exclude", i + 1), ok, detail: ok ? undefined : "cevapta geçiyor" });
  });
  if (expect.expectTool) {
    const any = expect.expectTool === "any";
    const ok = any ? o.toolNames.length > 0 : o.toolNames.includes(expect.expectTool);
    checks.push({
      id: "tool",
      label: any ? "Bir araç çağrılmalı" : `Araç çağrılmalı: ${expect.expectTool}`,
      ok,
      detail: ok ? undefined : o.toolNames.length ? `çağrılan: ${[...new Set(o.toolNames)].join(", ")}` : "araç çağrılmadı",
    });
  }
  if (expect.expectSourceId) {
    const ok = o.sourceIds.includes(expect.expectSourceId);
    checks.push({ id: "source", label: "Beklenen kaynak ilgili parçalar arasında olmalı", ok, detail: ok ? undefined : "kaynak bulunamadı" });
  }
  if (typeof expect.expectUnanswered === "boolean") {
    const ok = o.unanswered === expect.expectUnanswered;
    checks.push({
      id: "unanswered",
      label: expect.expectUnanswered ? "Cevapsız (karşılığı bulunamadı) olmalı" : "Bilgi tabanından ya da araçtan cevaplanmalı",
      ok,
      detail: ok ? undefined : o.unanswered ? "cevapsız işaretlendi" : "cevaplı işaretlendi",
    });
  }
  return { passed: checks.length ? checks.every((c) => c.ok) : null, checks };
}

/** Başarısız kontrollerin tek satırlık özeti ("neden kaldı"). */
export function failureReason(checks: EvalCheck[]): string {
  return checks
    .filter((c) => !c.ok)
    .map((c) => (c.detail ? `${c.label} (${c.detail})` : c.label))
    .join("; ");
}

/* ---------- Koşu özeti ve sınırlar ---------- */

export function tally(results: { passed: boolean | null }[]): { passed: number; failed: number; unchecked: number } {
  let passed = 0;
  let failed = 0;
  let unchecked = 0;
  for (const r of results) {
    if (r.passed === true) passed++;
    else if (r.passed === false) failed++;
    else unchecked++;
  }
  return { passed, failed, unchecked };
}

/** Yeni bir senaryo çalıştırmadan önce: maliyet sınırına ulaşıldı mı? */
export function costLimitReached(spentUsd: number, maxCostUsd: number): boolean {
  return maxCostUsd > 0 && spentUsd >= maxCostUsd;
}

/** Panelden gelen maliyet sınırı: geçersizse varsayılan, üstte tavan. */
export function clampMaxCost(v: number): number {
  if (!Number.isFinite(v) || v <= 0) return EVAL_LIMITS.defaultMaxCostUsd;
  return Math.min(EVAL_LIMITS.maxCostCeilingUsd, Math.round(v * 100) / 100);
}

/** Önceki sonuçlardan senaryo başına ortalama maliyet; veri yoksa null. */
export function averageCaseCost(costs: (number | null | undefined)[]): number | null {
  const real = costs.filter((c): c is number => typeof c === "number" && c > 0);
  return real.length ? real.reduce((a, b) => a + b, 0) / real.length : null;
}

/** Başlamadan tahmin: ortalama bilinmiyorsa tahmin yapılmaz ve sınır koşu sırasında uygulanır. */
export function estimateRun(count: number, avgCostUsd: number | null, maxCostUsd: number): { estimateUsd: number | null; overLimit: boolean } {
  if (avgCostUsd === null) return { estimateUsd: null, overLimit: false };
  const estimateUsd = avgCostUsd * count;
  return { estimateUsd, overLimit: maxCostUsd > 0 && estimateUsd > maxCostUsd };
}

/**
 * Görüntülenecek koşu durumu: sunucu yeniden başlarken ya da süreç ölürken `after()` işi yarıda
 * kalırsa kayıt "running" kalır. Son ilerlemeden bu yana `staleMinutes` geçtiyse "failed" gösterilir.
 */
export function effectiveRunStatus(
  run: { status: EvalRunStatus; startedAt: Date | string; summary: Pick<EvalRunSummary, "lastActivityAt"> | null },
  now: number = Date.now(),
): { status: EvalRunStatus; stale: boolean } {
  if (run.status !== "running") return { status: run.status, stale: false };
  const last = Math.max(new Date(run.startedAt).getTime(), run.summary?.lastActivityAt ? new Date(run.summary.lastActivityAt).getTime() : 0);
  if (now - last > EVAL_LIMITS.staleMinutes * 60_000) return { status: "failed", stale: true };
  return { status: "running", stale: false };
}

/* ---------- Hedef ---------- */

/** Formdan gelen hedef: "draft" | "published" | "v:<sürüm kimliği>". Geçersizse null. */
export function parseEvalTarget(raw: string): EvalTarget | null {
  if (raw === "draft" || raw === "published") return raw;
  if (raw.startsWith("v:") && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw.slice(2))) return { versionId: raw.slice(2) };
  return null;
}

export function targetLabel(target: EvalTarget, versionNumber: number | null): string {
  if (target === "draft") return "Taslak";
  if (target === "published") return versionNumber !== null ? `Yayındaki (v${versionNumber})` : "Yayındaki sürüm";
  return versionNumber !== null ? `Sürüm v${versionNumber}` : "Seçili sürüm";
}

/* ---------- Karşılaştırma ---------- */

export type CompareSide = { passed: boolean | null };
export type CompareChange = "fixed" | "regressed" | "same-pass" | "same-fail" | "unchecked" | "only-a" | "only-b";

export function changeOf(a: CompareSide | undefined, b: CompareSide | undefined): CompareChange {
  if (!a) return "only-b";
  if (!b) return "only-a";
  if (a.passed === null || b.passed === null) return "unchecked";
  if (a.passed === b.passed) return a.passed ? "same-pass" : "same-fail";
  return b.passed ? "fixed" : "regressed";
}

export const CHANGE_LABEL: Record<CompareChange, string> = {
  fixed: "Düzeldi",
  regressed: "Bozuldu",
  "same-pass": "Geçmeye devam",
  "same-fail": "Kalmaya devam",
  unchecked: "Değerlendirilmedi",
  "only-a": "Yalnızca ilk koşuda",
  "only-b": "Yalnızca ikinci koşuda",
};

export type CompareRow<T> = { key: string; a?: T; b?: T; change: CompareChange };

/**
 * Aynı senaryonun iki koşudaki sonuçlarını eşler (a = temel/önceki, b = yeni). Eşleşme senaryo
 * kimliğiyle; senaryosu silinmiş sonuçlar soru metniyle eşlenir; metni de temizlenmiş (maskeli) sonuçlar
 * eşlenemez, satır kimliğiyle ayrı satır olur. Sıra: b'nin sırası, sonra yalnızca a'dakiler.
 */
export function compareRuns<T extends CompareSide & { id: string; caseId: string | null; question: string }>(a: T[], b: T[]): CompareRow<T>[] {
  // Maskeli satırın (soru "") metni yok: aynı anahtarda toplanıp birbirini ezmesin diye satır kimliği anahtar olur.
  const keyOf = (r: T) => r.caseId ?? (r.question === "" ? `r:${r.id}` : `q:${trLower(r.question)}`);
  const aMap = new Map(a.map((r) => [keyOf(r), r]));
  const rows: CompareRow<T>[] = [];
  const used = new Set<string>();
  for (const r of b) {
    const k = keyOf(r);
    used.add(k);
    rows.push({ key: k, a: aMap.get(k), b: r, change: changeOf(aMap.get(k), r) });
  }
  for (const r of a) {
    const k = keyOf(r);
    if (!used.has(k)) rows.push({ key: k, a: r, change: "only-a" });
  }
  return rows;
}

export function countChanges(rows: { change: CompareChange }[]): Record<CompareChange, number> {
  const out: Record<CompareChange, number> = { fixed: 0, regressed: 0, "same-pass": 0, "same-fail": 0, unchecked: 0, "only-a": 0, "only-b": 0 };
  for (const r of rows) out[r.change]++;
  return out;
}

/* ---------- Sonuç kaydı: senaryo/koşu silinme yarışı ---------- */

/** `eval_results` yabancı anahtar kısıtlarının adları (drizzle'ın ürettiği adlar). */
export const EVAL_RESULT_CASE_FK = "eval_results_case_id_eval_cases_id_fk";
export const EVAL_RESULT_RUN_FK = "eval_results_run_id_eval_runs_id_fk";
const PG_FK_VIOLATION = "23503";

type PgErrorFields = { code?: unknown; constraint_name?: unknown; constraint?: unknown; cause?: unknown };

/**
 * Sonuç eklerken alınan hatayı sınıflar. Metne değil, postgres hata alanlarına (`code`,
 * `constraint_name`) bakar; drizzle hatayı sarmalıyorsa `cause` zincirini de izler.
 * "case": senaryo silinmiş; "run": koşu silinmiş; "other": başka hata (yeniden fırlatılmalı).
 */
export function classifyResultInsertError(e: unknown): "case" | "run" | "other" {
  for (let cur = e, depth = 0; cur && typeof cur === "object" && depth < 4; cur = (cur as PgErrorFields).cause, depth++) {
    const err = cur as PgErrorFields;
    const name = err.constraint_name ?? err.constraint;
    if (err.code !== PG_FK_VIOLATION && typeof name !== "string") continue;
    if (name === EVAL_RESULT_CASE_FK) return "case";
    if (name === EVAL_RESULT_RUN_FK) return "run";
  }
  return "other";
}

/**
 * Senaryosu artık olmayan sonucun kaydedilecek hali: senaryoya bağsız (case_id null) satır kişisel veri
 * taşımasın diye soru, cevap ve araç çağrısı girdi/çıktıları boşaltılır; hata metni yalnızca türüne/koduna
 * indirilir; ölçüt etiketleri ifade yerine sıra no taşır ve ayrıntılar silinir. Geçerlilik, ölçüt sonuçları,
 * kaynak kimlikleri, token, maliyet ve gecikme kalır; böylece koşu özeti ile sonuç satırları tutarlı olur.
 */
export function redactResultRow<T extends { question: string; answer: string; toolCalls: unknown[]; caseId: string | null; error?: string | null; checks?: EvalCheck[] }>(row: T): T {
  return { ...row, caseId: null, question: "", answer: "", toolCalls: [], error: redactErrorText(row.error), checks: redactChecks(row.checks ?? []) };
}

/** Ölçüt sonuçlarını kişisel veri taşımayacak hale getirir (idempotent): ifade etiketleri sıra no, ayrıntı boş. */
export function redactChecks(checks: EvalCheck[]): EvalCheck[] {
  let inc = 0;
  let exc = 0;
  return checks.map((c) => {
    const label = c.id === "include" ? phraseCheckLabel("include", ++inc) : c.id === "exclude" ? phraseCheckLabel("exclude", ++exc) : c.label;
    return { id: c.id, label, ok: c.ok };
  });
}
