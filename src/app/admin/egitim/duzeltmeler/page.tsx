import Link from "next/link";
import { desc, eq, inArray } from "drizzle-orm";
import { PenLine } from "lucide-react";
import { db } from "@/db";
import { corrections } from "@/db/schema";
import { ConfirmButton, SubmitButton } from "@/components/client";
import { SourceForm } from "@/components/admin/SourceForm";
import { Badge, btn, EmptyState, Flash, Notice, PageHeader, Pagination, Panel, selectCls } from "@/components/ui";
import { matchesStateFilter, parseStateFilter, STATE_FILTERS } from "@/lib/ai/correction-state";
import { requireAdmin } from "@/lib/auth";
import { getMainBot } from "@/lib/bot";
import { MODES, MODE_META } from "@/lib/bot-config";
import { loadCorrectionStatus } from "@/lib/corrections";
import { param, type SearchParams } from "@/lib/form";
import { fmtRelative } from "@/lib/format";
import { LIST_PAGE_SIZE, pageInfo, parsePage } from "@/lib/pagination";
import { can } from "@/lib/roles";
import { publishPendingCorrections } from "../../yayin/actions";
import { addManualCorrection, deleteCorrection } from "./actions";

export const metadata = { title: "Düzeltmeler" };

const BASE = "/admin/egitim/duzeltmeler";

export default async function CorrectionsPage({ searchParams }: { searchParams: SearchParams }) {
  const admin = await requireAdmin("training");
  const sp = await searchParams;
  const bot = await getMainBot();
  const status = await loadCorrectionStatus(bot);
  const canPublish = can(admin.role, "publish");

  // Filtreler: mod (tüm modlar dahil) ve yayın durumu. Durum kayıtta tutulmadığı için bellekte süzülür;
  // önce yalnızca kimlikler okunur, sayfadaki kayıtların tamamı ayrıca çekilir.
  const modeRaw = param(sp, "mod");
  const modeFilter = modeRaw === "all" || MODES.some((m) => m === modeRaw) ? (modeRaw as (typeof MODES)[number] | "all") : "";
  const stateFilter = parseStateFilter(param(sp, "durum"));
  const light = await db
    .select({ id: corrections.id, kbSourceId: corrections.kbSourceId })
    .from(corrections)
    .where(modeFilter ? eq(corrections.mode, modeFilter) : undefined)
    .orderBy(desc(corrections.createdAt));
  const matching = stateFilter ? light.filter((c) => matchesStateFilter(status.badge(c.kbSourceId).state, stateFilter)) : light;
  const pg = pageInfo(matching.length, parsePage(param(sp, "sayfa")), LIST_PAGE_SIZE);
  const pageIds = matching.slice(pg.offset, pg.offset + pg.limit).map((c) => c.id);
  const byId = new Map((pageIds.length ? await db.select().from(corrections).where(inArray(corrections.id, pageIds)) : []).map((c) => [c.id, c]));
  const list = pageIds.map((id) => byId.get(id)).filter((c): c is NonNullable<typeof c> => Boolean(c));
  const filtered = Boolean(modeFilter || stateFilter);

  return (
    <>
      <PageHeader
        title="Düzeltmeler"
        description="Ekibin düzelttiği cevaplar. Her düzeltme bilgi tabanına yüksek öncelikli bir soru-cevap olarak girer. Düzeltme taslağa eklendi; yayınladığınızda canlı asistan kullanır."
      />
      <Flash sp={sp} />
      {status.pendingCount > 0 && (
        <div className="mb-5">
          <Notice>
            <span className="flex flex-wrap items-center justify-between gap-3">
              <span>
                <strong>{status.pendingCount} düzeltme/SSS</strong> yayın bekliyor; canlı asistan henüz kullanmıyor.
              </span>
              {canPublish && status.hasPublished && (
                <form action={publishPendingCorrections}>
                  <input type="hidden" name="back" value="duzeltmeler" />
                  <SubmitButton variant="secondary" size="sm" pendingText="Yayınlanıyor…">
                    Bekleyen düzeltmeleri yayına al
                  </SubmitButton>
                </form>
              )}
            </span>
          </Notice>
        </div>
      )}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div>
          <form className="mb-4 flex flex-wrap items-center gap-2" role="search" aria-label="Düzeltmeleri süz">
            <select name="mod" defaultValue={modeFilter} className={`${selectCls} w-auto`} aria-label="Mod">
              <option value="">Tüm kapsamlar</option>
              <option value="all">Tüm modlarda geçerli</option>
              {MODES.map((m) => (
                <option key={m} value={m}>
                  Yalnızca {MODE_META[m].label}
                </option>
              ))}
            </select>
            <select name="durum" defaultValue={stateFilter} className={`${selectCls} w-auto`} aria-label="Durum">
              <option value="">Tüm durumlar</option>
              {STATE_FILTERS.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
            <button className={btn("secondary")}>Süz</button>
            {filtered && (
              <Link href={BASE} className="text-sm text-accent hover:underline">
                Süzgeci temizle
              </Link>
            )}
          </form>
          {list.length ? (
            <ul className="grid gap-3">
              {list.map((c) => {
                const badge = status.badge(c.kbSourceId);
                return (
                  <li key={c.id} className="rounded-xl border border-line bg-surface p-4">
                    <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted">
                      <span>{c.mode === "all" ? "Tüm modlar" : MODE_META[c.mode].label}</span>·<span>{c.createdBy}</span>·<span>{fmtRelative(c.createdAt)}</span>
                      <Badge tone={badge.tone}>{badge.label}</Badge>
                      {c.updatedAt && (
                        <span>
                          · düzenlendi {fmtRelative(c.updatedAt)}
                          {c.updatedBy ? ` (${c.updatedBy})` : ""}
                        </span>
                      )}
                    </div>
                    <div className="text-sm font-medium">{c.question}</div>
                    {c.wrongAnswer && <p className="mt-2 line-clamp-2 text-sm text-muted line-through decoration-bad/50">{c.wrongAnswer}</p>}
                    <p className="mt-2 text-sm leading-relaxed">{c.correctAnswer}</p>
                    <div className="mt-3 flex flex-wrap items-center gap-3">
                      {c.kbSourceId && (
                        <Link href={`/admin/egitim/bilgi-tabani/${c.kbSourceId}`} className="text-sm text-accent hover:underline">
                          Düzenle / parçaları gör
                        </Link>
                      )}
                      {c.conversationId && (
                        <Link href={`/admin/konusmalar/${c.conversationId}${c.messageId ? `#m-${c.messageId}` : ""}`} className="text-sm text-accent hover:underline">
                          Konuşmayı aç
                        </Link>
                      )}
                      <form action={deleteCorrection} className="ml-auto">
                        <input type="hidden" name="id" value={c.id} />
                        <ConfirmButton confirmText="Silinsin mi?">Sil</ConfirmButton>
                      </form>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="rounded-xl border border-line bg-surface">
              <EmptyState icon={PenLine} title={filtered ? "Bu süzgece uyan düzeltme yok" : "Henüz düzeltme yok"}>
                {filtered
                  ? "Süzgeci değiştirin ya da temizleyin."
                  : "Konuşma dökümünde bir cevabın altındaki “Bu cevabı düzelt” bağlantısını kullanın ya da yandaki formdan ekleyin."}
              </EmptyState>
            </div>
          )}
          <Pagination basePath={BASE} params={{ mod: modeFilter, durum: stateFilter }} page={pg.page} pages={pg.pages} total={pg.total} noun="düzeltme" />
        </div>
        <Panel title="Elle düzeltme ekle" className="self-start">
          <SourceForm
            key={`${param(sp, "ok")}|${param(sp, "hata")}`}
            action={addManualCorrection}
            idPrefix="c-new"
            answerLabel="Doğru cevap"
            answerMax={4000}
            answerRows={5}
            submitLabel="Ekle"
            pendingText="Ekleniyor…"
            resetOnSuccess
          />
        </Panel>
      </div>
    </>
  );
}
