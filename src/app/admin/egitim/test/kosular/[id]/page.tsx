import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, desc, eq, lt, ne } from "drizzle-orm";
import { Check, ChevronLeft, X } from "lucide-react";
import { db } from "@/db";
import { evalResults, evalRuns } from "@/db/schema";
import { AutoRefresh } from "@/components/admin/AutoRefresh";
import { ConfirmButton } from "@/components/client";
import { Badge, btn, cx, Flash, KeyValue, ModeBadge, Notice, PageHeader, Panel, selectCls } from "@/components/ui";
import { describeMatch } from "@/lib/ai/retrieval-core";
import { requireAdmin } from "@/lib/auth";
import { getMainBot } from "@/lib/bot";
import { CHANGE_LABEL, compareRuns, countChanges, effectiveRunStatus, failureReason, targetLabel, type CompareChange } from "@/lib/eval";
import type { SearchParams } from "@/lib/form";
import { fmtDateTime, fmtInt, fmtRelative, fmtUsd } from "@/lib/format";
import { cancelRun, deleteRun } from "../../senaryolar/actions";

export const metadata = { title: "Test koşusu" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Result = typeof evalResults.$inferSelect;
type Run = typeof evalRuns.$inferSelect;

const STATUS_BADGE = {
  running: { tone: "accent", label: "Çalışıyor" },
  done: { tone: "good", label: "Bitti" },
  failed: { tone: "bad", label: "Başarısız" },
  cancelled: { tone: "neutral", label: "İptal edildi" },
} as const;

const CHANGE_TONE: Record<CompareChange, "good" | "bad" | "neutral"> = {
  fixed: "good",
  regressed: "bad",
  "same-pass": "neutral",
  "same-fail": "neutral",
  unchecked: "neutral",
  "only-a": "neutral",
  "only-b": "neutral",
};

function runTitle(r: Run) {
  return `${targetLabel(r.target, r.versionNumber)} · ${fmtRelative(r.startedAt)}`;
}

function PassBadge({ passed }: { passed: boolean | null }) {
  if (passed === null) return <Badge>Değerlendirilmedi</Badge>;
  return passed ? (
    <Badge tone="good">
      <Check className="size-3" /> Geçti
    </Badge>
  ) : (
    <Badge tone="bad">
      <X className="size-3" /> Kaldı
    </Badge>
  );
}

/** Senaryo silinince soru metni temizlenir (KVKK); sonuç satırı kalır. */
function QuestionText({ text }: { text: string }) {
  return text ? <span className="text-sm font-medium">{text}</span> : <span className="text-sm text-muted">(Senaryo silindi; metin temizlendi)</span>;
}

function ResultBody({ r, compact = false }: { r: Result; compact?: boolean }) {
  const failedReason = failureReason(r.checks);
  return (
    <div className="grid gap-2.5">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
        <PassBadge passed={r.passed} />
        {r.unanswered && <Badge tone="warn">Karşılığı bulunamadı</Badge>}
        <span className="tabular">
          {fmtInt(r.inputTokens)} + {fmtInt(r.outputTokens)} token · {fmtUsd(r.costUsd)} · {((r.latencyMs ?? 0) / 1000).toFixed(1)} sn
        </span>
      </div>
      {failedReason && <p className="rounded-lg bg-bad-soft px-3 py-2 text-[13px]">Kalma nedeni: {failedReason}</p>}
      {r.error && <p className="rounded-lg bg-bad-soft px-3 py-2 text-[13px]">Hata: {r.error} (ayrıntı sunucu günlüğünde)</p>}
      {r.answer ? (
        <div className={cx("text-sm leading-relaxed whitespace-pre-wrap", compact && "max-h-72 overflow-auto")}>{r.answer}</div>
      ) : (
        <p className="text-sm text-muted">Cevap yok.</p>
      )}
      {r.checks.length > 0 && (
        <ul className="grid gap-0.5 text-[13px]">
          {r.checks.map((c, i) => (
            <li key={i} className="flex items-start gap-1.5">
              {c.ok ? <Check className="mt-0.5 size-3.5 shrink-0 text-good" aria-label="Geçti" /> : <X className="mt-0.5 size-3.5 shrink-0 text-bad" aria-label="Kaldı" />}
              <span className={c.ok ? "text-muted" : undefined}>{c.label}</span>
            </li>
          ))}
        </ul>
      )}
      {(r.sources.length > 0 || r.toolCalls.length > 0) && (
        <details className="rounded-lg border border-line">
          <summary className="cursor-pointer px-3 py-2 text-[13px] text-muted hover:text-ink">
            {r.sources.length} kaynak · {r.toolCalls.length} araç çağrısı{r.toolCalls.length ? `: ${r.toolCalls.map((t) => t.name).join(", ")}` : ""}
          </summary>
          {r.sources.length > 0 && (
            <ul className="divide-y divide-line border-t border-line">
              {r.sources.map((s, i) => (
                <li key={i} className="px-3 py-2 text-[13px]">
                  <div className="flex items-center gap-2">
                    <Link href={`/admin/egitim/bilgi-tabani/${s.sourceId}`} className="font-medium text-accent hover:underline">
                      {s.title}
                    </Link>
                    <span className="tabular ml-auto text-xs text-muted">{describeMatch(s)}</span>
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-xs text-muted">{s.snippet}</p>
                </li>
              ))}
            </ul>
          )}
        </details>
      )}
    </div>
  );
}

export default async function EvalRunPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  await requireAdmin("training");
  const { id } = await params;
  const sp = await searchParams;
  if (!UUID_RE.test(id)) notFound();
  const bot = await getMainBot();
  const [run] = await db.select().from(evalRuns).where(and(eq(evalRuns.id, id), eq(evalRuns.botId, bot.id)));
  if (!run) notFound();

  const results = await db.select().from(evalResults).where(eq(evalResults.runId, id)).orderBy(asc(evalResults.createdAt));
  const eff = effectiveRunStatus(run);
  const s = run.summary;

  // Karşılaştırma: ?karsilastir=<koşu> yan yana; yoksa önceki biten koşuya göre değişim.
  const others = await db
    .select()
    .from(evalRuns)
    .where(and(eq(evalRuns.botId, bot.id), ne(evalRuns.id, id)))
    .orderBy(desc(evalRuns.startedAt))
    .limit(20);
  const wantedId = typeof sp.karsilastir === "string" ? sp.karsilastir : "";
  const explicit = others.find((o) => o.id === wantedId) ?? null;
  const previous = explicit
    ? null
    : ((await db
        .select()
        .from(evalRuns)
        .where(and(eq(evalRuns.botId, bot.id), eq(evalRuns.status, "done"), lt(evalRuns.startedAt, run.startedAt)))
        .orderBy(desc(evalRuns.startedAt))
        .limit(1))[0] ?? null);
  const base = explicit ?? previous;
  const baseResults = base ? await db.select().from(evalResults).where(eq(evalResults.runId, base.id)).orderBy(asc(evalResults.createdAt)) : [];
  const rows = base ? compareRuns(baseResults, results).filter((r) => (explicit ? true : Boolean(r.b))) : [];
  const changes = countChanges(rows);
  const byResultId = new Map(rows.filter((r) => r.b).map((r) => [r.b!.id, r]));

  const totalCost = results.reduce((a, r) => a + (r.costUsd ?? 0), 0);
  const tokens = results.reduce((a, r) => a + (r.inputTokens ?? 0) + (r.outputTokens ?? 0), 0);
  const avgLatency = results.length ? results.reduce((a, r) => a + (r.latencyMs ?? 0), 0) / results.length : 0;
  const badge = STATUS_BADGE[eff.status];
  const duration = run.finishedAt ? Math.round((new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime()) / 1000) : null;
  const pending = s ? Math.max(0, s.total - results.length) : 0;

  return (
    <>
      <AutoRefresh active={eff.status === "running"} every={3000} />
      <Link href="/admin/egitim/test/senaryolar" className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
        <ChevronLeft className="size-4" /> Test senaryoları
      </Link>
      <PageHeader
        title={`Koşu: ${targetLabel(run.target, run.versionNumber)}`}
        description={`${run.startedBy ?? "—"} başlattı · ${fmtDateTime(run.startedAt)}`}
        actions={
          eff.status === "running" ? (
            <form action={cancelRun}>
              <input type="hidden" name="id" value={run.id} />
              <ConfirmButton confirmText="Koşu durdurulsun mu?">Koşuyu iptal et</ConfirmButton>
            </form>
          ) : (
            <form action={deleteRun}>
              <input type="hidden" name="id" value={run.id} />
              <ConfirmButton confirmText="Bu koşu ve tüm sonuçları (soru ve cevap metinleri dahil) kalıcı olarak silinsin mi? Bu işlem geri alınamaz.">Koşuyu sil</ConfirmButton>
            </form>
          )
        }
      />
      <Flash sp={sp} />
      <div className="mb-5 grid gap-3">
        {eff.stale && (
          <Notice tone="warn">Bu koşu yarıda kaldı: son ilerlemeden bu yana 15 dakikadan fazla geçti (sunucu yeniden başlamış olabilir). Kaydedilen sonuçlar aşağıda; kalan senaryolar çalışmadı.</Notice>
        )}
        {eff.status === "failed" && !eff.stale && s?.error && <Notice tone="warn">Koşu hata ile bitti: {s.error}</Notice>}
        {s?.stoppedBy === "cost" && (
          <Notice tone="warn">
            Maliyet sınırına ulaşıldı ({fmtUsd(s.maxCostUsd)}); {s.skipped} senaryo çalıştırılmadı.
          </Notice>
        )}
        {run.status === "cancelled" && <Notice>Koşu iptal edildi; {s?.skipped ?? pending} senaryo çalıştırılmadı.</Notice>}
        {eff.status === "running" && <Notice>Koşu sürüyor; sayfa birkaç saniyede bir yenilenir. Bu sayfadan ayrılabilirsiniz, koşu arka planda devam eder.</Notice>}
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="grid content-start gap-4">
          <Panel
            title="Karşılaştır"
            description={
              explicit
                ? "Yan yana görünüm: solda seçtiğiniz koşu, sağda bu koşu."
                : previous
                  ? `Değişim sütunu bir önceki biten koşuya göre: ${runTitle(previous)}.`
                  : "Karşılaştırılacak önceki bir koşu yok."
            }
          >
            <form className="flex flex-wrap items-center gap-2" method="get">
              <select name="karsilastir" defaultValue={explicit?.id ?? ""} className={`${selectCls} w-auto max-w-full`} aria-label="Karşılaştırılacak koşu">
                <option value="">Önceki koşuya göre değişim</option>
                {others.map((o) => (
                  <option key={o.id} value={o.id}>
                    {runTitle(o)} · {o.summary ? `${o.summary.passed}/${o.summary.passed + o.summary.failed} geçti` : STATUS_BADGE[effectiveRunStatus(o).status].label}
                  </option>
                ))}
              </select>
              <button className={btn("secondary")}>Göster</button>
            </form>
            {base && (
              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                <Badge tone="good">{changes.fixed} düzeldi</Badge>
                <Badge tone="bad">{changes.regressed} bozuldu</Badge>
                <Badge>{changes["same-pass"]} geçmeye devam</Badge>
                <Badge>{changes["same-fail"]} kalmaya devam</Badge>
              </div>
            )}
          </Panel>

          {explicit ? (
            <>
              <div className="grid grid-cols-2 gap-3 px-1 text-[13px] font-semibold">
                <span>
                  <Link href={`/admin/egitim/test/kosular/${explicit.id}`} className="text-accent hover:underline">
                    {runTitle(explicit)}
                  </Link>
                </span>
                <span>{runTitle(run)}</span>
              </div>
              <ol className="grid gap-4" aria-label="Senaryo karşılaştırması">
                {rows.map((r) => (
                  <li key={r.key} className="rounded-xl border border-line bg-surface p-4">
                    <div className="mb-3 flex flex-wrap items-center gap-2">
                      <QuestionText text={(r.b ?? r.a)!.question} />
                      <Badge tone={CHANGE_TONE[r.change]} className="ml-auto">
                        {CHANGE_LABEL[r.change]}
                      </Badge>
                    </div>
                    <div className="grid gap-4 md:grid-cols-2">
                      {[r.a, r.b].map((side, i) => (
                        <div key={i} className="min-w-0 md:first:border-r md:first:border-line md:first:pr-4">
                          {side ? <ResultBody r={side} compact /> : <p className="text-sm text-muted">Bu koşuda çalışmadı.</p>}
                        </div>
                      ))}
                    </div>
                  </li>
                ))}
                {!rows.length && <li className="rounded-xl border border-line bg-surface p-6 text-sm text-muted">Karşılaştırılacak sonuç yok.</li>}
              </ol>
            </>
          ) : (
            <ol className="grid gap-4" aria-label="Sonuçlar">
              {results.map((r) => {
                const row = byResultId.get(r.id);
                return (
                  <li key={r.id} className={cx("rounded-xl border bg-surface p-4", r.passed === false ? "border-bad/40" : "border-line")}>
                    <div className="mb-3 flex flex-wrap items-center gap-2">
                      <QuestionText text={r.question} />
                      <ModeBadge mode={r.mode} />
                      {row && row.change !== "only-b" && (
                        <Badge tone={CHANGE_TONE[row.change]} className="ml-auto">
                          Önceki koşuya göre: {CHANGE_LABEL[row.change]}
                        </Badge>
                      )}
                    </div>
                    <ResultBody r={r} />
                  </li>
                );
              })}
              {!results.length && (
                <li className="rounded-xl border border-line bg-surface p-6 text-sm text-muted">{eff.status === "running" ? "İlk sonuçlar bekleniyor…" : "Bu koşuda sonuç yok."}</li>
              )}
            </ol>
          )}
        </div>

        <aside className="grid content-start gap-4">
          <Panel title="Özet">
            <KeyValue
              items={[
                ["Durum", <Badge key="s" tone={badge.tone}>{eff.stale ? "Yarıda kaldı" : badge.label}</Badge>],
                ["Hedef", targetLabel(run.target, run.versionNumber)],
                ["İlerleme", s ? `${results.length}/${s.total}${pending && eff.status !== "running" ? ` (${pending} çalışmadı)` : ""}` : "—"],
                ["Geçti", s ? `${s.passed}` : "—"],
                ["Kaldı", s ? `${s.failed}` : "—"],
                ["Değerlendirilmedi", s ? `${s.unchecked}` : "—"],
                ["Maliyet", `${fmtUsd(totalCost)}${s ? ` / sınır ${fmtUsd(s.maxCostUsd)}` : ""}`],
                ["Token", fmtInt(tokens)],
                ["Ort. gecikme", results.length ? `${(avgLatency / 1000).toFixed(1)} sn` : "—"],
                ["Süre", duration !== null ? `${duration} sn` : "—"],
              ]}
            />
          </Panel>
          <p className="text-xs leading-relaxed text-muted">Bu koşu konuşma ya da mesaj kaydı oluşturmadı; panel istatistiklerine girmedi.</p>
        </aside>
      </div>
    </>
  );
}
