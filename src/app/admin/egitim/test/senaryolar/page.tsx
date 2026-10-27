import Link from "next/link";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { ClipboardCheck, Plus } from "lucide-react";
import { db } from "@/db";
import { evalCases, evalResults, evalRuns, kbSources } from "@/db/schema";
import { ConfirmButton, SubmitButton } from "@/components/client";
import { Badge, btn, checkboxCls, EmptyState, Field, Flash, inputCls, ModeBadge, Notice, PageHeader, Pagination, Panel, selectCls, textareaCls } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { getMainBot, listVersionSummaries } from "@/lib/bot";
import { MODES, MODE_META, TOOLS } from "@/lib/bot-config";
import { effectiveRunStatus, EVAL_LIMITS, estimateRun, normalizeExpect, targetLabel } from "@/lib/eval";
import { recentAverageCost } from "@/lib/eval-run";
import { param, type SearchParams } from "@/lib/form";
import { fmtRelative, fmtUsd, truncate } from "@/lib/format";
import { LIST_PAGE_SIZE, pageInfo, parsePage } from "@/lib/pagination";
import { deleteCase, saveCase, startRun } from "./actions";

export const metadata = { title: "Test senaryoları" };

const BASE = "/admin/egitim/test/senaryolar";

function ExpectBadges({ raw }: { raw: unknown }) {
  const e = normalizeExpect(raw);
  const parts: string[] = [];
  if (e.mustInclude.length) parts.push(`${e.mustInclude.length} içermeli`);
  if (e.mustNotInclude.length) parts.push(`${e.mustNotInclude.length} içermemeli`);
  if (e.expectTool) parts.push(e.expectTool === "any" ? "araç" : `araç: ${e.expectTool}`);
  if (e.expectSourceId) parts.push("kaynak");
  if (typeof e.expectUnanswered === "boolean") parts.push(e.expectUnanswered ? "cevapsız olmalı" : "cevaplı olmalı");
  if (!parts.length) return <span className="text-xs text-faint">Ölçüt yok</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {parts.map((p) => (
        <Badge key={p}>{p}</Badge>
      ))}
    </span>
  );
}

const STATUS_BADGE = {
  running: { tone: "accent", label: "Çalışıyor" },
  done: { tone: "good", label: "Bitti" },
  failed: { tone: "bad", label: "Başarısız" },
  cancelled: { tone: "neutral", label: "İptal edildi" },
} as const;

export default async function ScenariosPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdmin("training");
  const sp = await searchParams;
  const bot = await getMainBot();

  const editId = param(sp, "duzenle");
  const [editing] = /^[0-9a-f-]{36}$/i.test(editId)
    ? await db.select().from(evalCases).where(and(eq(evalCases.id, editId), eq(evalCases.botId, bot.id)))
    : [];

  const [{ n: total }] = await db.select({ n: sql<number>`count(*)::int` }).from(evalCases).where(eq(evalCases.botId, bot.id));
  const pg = pageInfo(total, parsePage(param(sp, "sayfa")), LIST_PAGE_SIZE);
  const cases = await db
    .select()
    .from(evalCases)
    .where(eq(evalCases.botId, bot.id))
    .orderBy(desc(evalCases.createdAt))
    .limit(pg.limit)
    .offset(pg.offset);

  // Her senaryonun en son koşudaki sonucu (sayfadaki senaryolar için).
  const last = cases.length
    ? await db
        .selectDistinctOn([evalResults.caseId], { caseId: evalResults.caseId, passed: evalResults.passed, runId: evalResults.runId })
        .from(evalResults)
        .where(inArray(evalResults.caseId, cases.map((c) => c.id)))
        .orderBy(evalResults.caseId, desc(evalResults.createdAt))
    : [];
  const lastBy = new Map(last.map((l) => [l.caseId, l]));

  const runs = await db.select().from(evalRuns).where(eq(evalRuns.botId, bot.id)).orderBy(desc(evalRuns.startedAt)).limit(8);
  const live = runs.map((r) => ({ run: r, eff: effectiveRunStatus(r) }));
  const running = live.find((x) => x.eff.status === "running");

  const versions = await listVersionSummaries(bot.id, { limit: 30 });
  const sources = await db
    .select({ id: kbSources.id, title: kbSources.title })
    .from(kbSources)
    .where(and(eq(kbSources.botId, bot.id), eq(kbSources.status, "ready"), isNull(kbSources.deletedAt)))
    .orderBy(asc(kbSources.title))
    .limit(300);

  const avg = await recentAverageCost(bot.id);
  const runCount = Math.min(total, EVAL_LIMITS.maxCasesPerRun);
  const est = estimateRun(runCount, avg, EVAL_LIMITS.defaultMaxCostUsd);
  const expect = normalizeExpect(editing?.expect);

  return (
    <>
      <PageHeader
        title="Test senaryoları"
        description="Sık sorulan ya da hatalı cevaplanmış soruları ölçütleriyle kaydedin; taslağı, yayındaki sürümü ya da eski bir sürümü tek seferde bu sorularla deneyin. Koşular konuşma kaydı oluşturmaz, istatistiklere girmez; model sağlayıcınıza gerçek istek gönderir."
      />
      <Flash sp={sp} />
      <div className="mb-5 grid gap-3">
        <Notice tone="warn">
          <strong>Kişisel veri:</strong> Konuşmadan kopyalanan sorular ad, telefon, adres gibi kişisel veri içerebilir. Senaryoya eklemeden önce soruyu sadeleştirin. Kaynak konuşma ya da kullanıcı silinse bile
          senaryo bağımsız olarak kalır; gerekirse senaryoyu da elle silin. Koşu sonuçları da soru ve cevap metnini saklar: senaryoyu silince geçmiş sonuçlardaki metinler temizlenir,
          bir koşuyu ve tüm sonuçlarını koşu sayfasındaki “Koşuyu sil” ile kalıcı silebilirsiniz.
        </Notice>
        {running && (
          <Notice>
            Bir koşu devam ediyor ({running.run.summary?.completed ?? 0}/{running.run.summary?.total ?? "?"}).{" "}
            <Link href={`/admin/egitim/test/kosular/${running.run.id}`} className="font-medium text-accent underline">
              Koşuyu aç
            </Link>
          </Notice>
        )}
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="grid content-start gap-5">
          <form action={startRun}>
            <Panel
              title={`Senaryolar (${total})`}
              description={`Koşu başına en fazla ${EVAL_LIMITS.maxCasesPerRun} senaryo ve ${EVAL_LIMITS.concurrency} eşzamanlı istek. Maliyet sınırına ulaşılınca koşu durur.`}
              bodyClassName="p-0"
            >
              {cases.length ? (
                <>
                  <div className="grid gap-3 border-b border-line p-4 sm:grid-cols-[1fr_140px_auto]">
                    <Field label="Hangi ayarlarla koşulsun?" htmlFor="run-target">
                      <select id="run-target" name="target" defaultValue="draft" className={selectCls}>
                        <option value="draft">Taslak</option>
                        {bot.publishedVersionId && <option value="published">Yayındaki sürüm</option>}
                        {versions.map((v) => (
                          <option key={v.id} value={`v:${v.id}`}>
                            Sürüm v{v.number}
                            {v.id === bot.publishedVersionId ? " (yayında)" : ""}
                            {v.note ? ` · ${truncate(v.note, 40)}` : ""}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Maliyet sınırı ($)" htmlFor="run-max" hint={`En çok ${EVAL_LIMITS.maxCostCeilingUsd}`}>
                      <input id="run-max" name="maxCost" type="number" step="0.1" min="0.1" max={EVAL_LIMITS.maxCostCeilingUsd} defaultValue={EVAL_LIMITS.defaultMaxCostUsd} className={inputCls} />
                    </Field>
                    <div className="flex flex-wrap items-end gap-2">
                      <SubmitButton name="scope" value="selected" pendingText="Başlatılıyor…">
                        Seçilenleri koş
                      </SubmitButton>
                      <SubmitButton name="scope" value="all" variant="secondary" pendingText="Başlatılıyor…">
                        Tümünü koş
                      </SubmitButton>
                    </div>
                  </div>
                  <p className="border-b border-line px-4 py-2.5 text-xs leading-relaxed text-muted">
                    {est.estimateUsd !== null
                      ? `Önceki koşulara göre senaryo başına ≈ ${fmtUsd(avg)}; ${runCount} senaryo ≈ ${fmtUsd(est.estimateUsd)}. `
                      : "Henüz maliyet verisi yok; sınır koşu sırasında uygulanır. "}
                    Model fiyatı girilmediyse maliyet $0 görünür ve maliyet sınırı işlemez.
                  </p>
                  <ul className="divide-y divide-line">
                    {cases.map((c) => {
                      const l = lastBy.get(c.id);
                      return (
                        <li key={c.id} className="flex items-start gap-3 px-4 py-3">
                          <input type="checkbox" name="ids" value={c.id} className={`${checkboxCls} mt-1`} aria-label={`Seç: ${truncate(c.question, 60)}`} />
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-medium break-words">{truncate(c.question, 160)}</div>
                            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                              <ModeBadge mode={c.mode} />
                              <ExpectBadges raw={c.expect} />
                              {l && (
                                <Link href={`/admin/egitim/test/kosular/${l.runId}`} className="text-xs text-accent hover:underline">
                                  Son koşu: {l.passed === null ? "değerlendirilmedi" : l.passed ? "geçti" : "kaldı"}
                                </Link>
                              )}
                            </div>
                            {c.note && <p className="mt-1 text-xs text-muted">{c.note}</p>}
                          </div>
                          <Link href={`${BASE}?duzenle=${c.id}#form`} className="text-sm text-accent hover:underline">
                            Düzenle
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </>
              ) : (
                <EmptyState icon={ClipboardCheck} title="Henüz senaryo yok">
                  Yandaki formdan ekleyin ya da konuşma dökümünde bir cevabın altındaki “Senaryoya ekle” bağlantısını kullanın.
                </EmptyState>
              )}
            </Panel>
          </form>
          <Pagination basePath={BASE} page={pg.page} pages={pg.pages} total={pg.total} noun="senaryo" />

          <Panel title="Son koşular" bodyClassName="p-0">
            {live.length ? (
              <ul className="divide-y divide-line">
                {live.map(({ run, eff }) => {
                  const s = run.summary;
                  const b = STATUS_BADGE[eff.status];
                  return (
                    <li key={run.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3 text-sm">
                      <Link href={`/admin/egitim/test/kosular/${run.id}`} className="font-medium text-accent hover:underline">
                        {targetLabel(run.target, run.versionNumber)}
                      </Link>
                      <Badge tone={b.tone}>{eff.stale ? "Yarıda kaldı" : b.label}</Badge>
                      {s && (
                        <span className="tabular text-muted">
                          {s.passed}/{s.passed + s.failed} geçti{s.unchecked ? ` · ${s.unchecked} değerlendirilmedi` : ""}
                        </span>
                      )}
                      <span className="tabular ml-auto text-xs text-muted">
                        {fmtUsd(run.costUsd)} · {fmtRelative(run.startedAt)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="px-5 py-4 text-sm text-muted">Henüz koşu yapılmadı.</p>
            )}
          </Panel>
        </div>

        <div id="form" className="grid content-start gap-4 self-start">
          <Panel
            title={editing ? "Senaryoyu düzenle" : "Yeni senaryo"}
            actions={
              editing && (
                <Link href={BASE} className={btn("ghost", "sm")}>
                  <Plus className="size-3.5" /> Yeni
                </Link>
              )
            }
          >
            <form key={editing?.id ?? "new"} action={saveCase} className="grid gap-3">
              {editing && <input type="hidden" name="id" value={editing.id} />}
              <Field label="Soru" htmlFor="ec-question" hint="Gerçek bir kullanıcının yazacağı gibi. Kişisel veri içermemeli.">
                <textarea id="ec-question" name="question" required rows={3} maxLength={EVAL_LIMITS.questionMax} defaultValue={editing?.question ?? ""} className={textareaCls} />
              </Field>
              <Field label="Mod" htmlFor="ec-mode">
                <select id="ec-mode" name="mode" defaultValue={editing?.mode ?? "genel"} className={selectCls}>
                  {MODES.map((m) => (
                    <option key={m} value={m}>
                      {MODE_META[m].label}
                    </option>
                  ))}
                </select>
              </Field>
              <fieldset className="grid gap-2">
                <legend className="mb-1.5 text-[13px] font-medium">Konum (isteğe bağlı)</legend>
                <div className="grid grid-cols-2 gap-2">
                  <input name="lat" inputMode="decimal" placeholder="Enlem 39.65" defaultValue={editing?.location?.lat ?? ""} className={inputCls} aria-label="Enlem" />
                  <input name="lon" inputMode="decimal" placeholder="Boylam 27.88" defaultValue={editing?.location?.lon ?? ""} className={inputCls} aria-label="Boylam" />
                </div>
                <input name="locName" maxLength={80} placeholder="Yer adı (ör. Balıkesir)" defaultValue={editing?.location?.name ?? ""} className={inputCls} aria-label="Yer adı" />
              </fieldset>

              <div className="border-t border-line pt-3 text-[13px] font-semibold">Beklenen ölçütler</div>
              <Field label="Cevapta geçmeli" htmlFor="ec-inc" hint="Satır başına bir ifade. Büyük/küçük harf ve Türkçe İ/ı ayrımı yok sayılır.">
                <textarea id="ec-inc" name="mustInclude" rows={3} defaultValue={expect.mustInclude.join("\n")} className={textareaCls} />
              </Field>
              <Field label="Cevapta geçmemeli" htmlFor="ec-exc" hint="Satır başına bir ifade.">
                <textarea id="ec-exc" name="mustNotInclude" rows={2} defaultValue={expect.mustNotInclude.join("\n")} className={textareaCls} />
              </Field>
              <Field label="Araç çağrılmalı mı?" htmlFor="ec-tool">
                <select id="ec-tool" name="expectTool" defaultValue={expect.expectTool ?? ""} className={selectCls}>
                  <option value="">Kontrol etme</option>
                  <option value="any">Herhangi bir araç</option>
                  {Object.entries(TOOLS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Beklenen kaynak" htmlFor="ec-src" hint="Bu kaynaktan ilgili bir parça bağlama girmeli.">
                <select id="ec-src" name="expectSource" defaultValue={expect.expectSourceId ?? ""} className={selectCls}>
                  <option value="">Kontrol etme</option>
                  {sources.map((s) => (
                    <option key={s.id} value={s.id}>
                      {truncate(s.title, 70)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Cevapsız olmalı mı?" htmlFor="ec-un" hint="“Cevapsız”: bilgi tabanında ilgili parça yok ve araç da cevap vermedi.">
                <select id="ec-un" name="expectUnanswered" defaultValue={expect.expectUnanswered === true ? "yes" : expect.expectUnanswered === false ? "no" : ""} className={selectCls}>
                  <option value="">Kontrol etme</option>
                  <option value="yes">Evet, cevapsız olmalı</option>
                  <option value="no">Hayır, cevaplanmalı</option>
                </select>
              </Field>
              <Field label="Not" htmlFor="ec-note">
                <input id="ec-note" name="note" maxLength={EVAL_LIMITS.noteMax} defaultValue={editing?.note ?? ""} className={inputCls} />
              </Field>
              <SubmitButton pendingText="Kaydediliyor…">{editing ? "Güncelle" : "Senaryo ekle"}</SubmitButton>
            </form>
            {editing && (
              <form action={deleteCase} className="mt-3 border-t border-line pt-3">
                <input type="hidden" name="id" value={editing.id} />
                <ConfirmButton confirmText="Silinsin mi?">Senaryoyu sil</ConfirmButton>
                {editing.sourceMessageId && <p className="mt-2 text-xs text-muted">Bu senaryo bir konuşmadan oluşturuldu; konuşma silinirse senaryo korunur.</p>}
              </form>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}
