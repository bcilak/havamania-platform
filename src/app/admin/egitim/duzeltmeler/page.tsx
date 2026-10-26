import Link from "next/link";
import { desc } from "drizzle-orm";
import { PenLine } from "lucide-react";
import { db } from "@/db";
import { corrections } from "@/db/schema";
import { ConfirmButton, CountedTextarea, SubmitButton } from "@/components/client";
import { Badge, EmptyState, Field, Flash, inputCls, Notice, PageHeader, Panel, selectCls, textareaCls } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { getMainBot } from "@/lib/bot";
import { MODES, MODE_META } from "@/lib/bot-config";
import { loadCorrectionStatus } from "@/lib/corrections";
import type { SearchParams } from "@/lib/form";
import { fmtRelative } from "@/lib/format";
import { can } from "@/lib/roles";
import { publishPendingCorrections } from "../../yayin/actions";
import { addManualCorrection, deleteCorrection } from "./actions";

export const metadata = { title: "Düzeltmeler" };

export default async function CorrectionsPage({ searchParams }: { searchParams: SearchParams }) {
  const admin = await requireAdmin("training");
  const sp = await searchParams;
  const bot = await getMainBot();
  const LIMIT = 200;
  const rows = await db.select().from(corrections).orderBy(desc(corrections.createdAt)).limit(LIMIT + 1);
  const overLimit = rows.length > LIMIT;
  const list = rows.slice(0, LIMIT);
  const status = await loadCorrectionStatus(bot);
  const canPublish = can(admin.role, "publish");

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
          {list.length ? (
            <ul className="grid gap-3">
              {list.map((c) => {
                const badge = status.badge(c.kbSourceId);
                return (
                <li key={c.id} className="rounded-xl border border-line bg-surface p-4">
                  <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted">
                    <span>{c.mode === "all" ? "Tüm modlar" : MODE_META[c.mode].label}</span>·<span>{c.createdBy}</span>·<span>{fmtRelative(c.createdAt)}</span>
                    <Badge tone={badge.tone}>{badge.label}</Badge>
                  </div>
                  <div className="text-sm font-medium">{c.question}</div>
                  {c.wrongAnswer && (
                    <p className="mt-2 line-clamp-2 text-sm text-muted line-through decoration-bad/50">{c.wrongAnswer}</p>
                  )}
                  <p className="mt-2 text-sm leading-relaxed">{c.correctAnswer}</p>
                  <div className="mt-3 flex gap-2">
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
              <EmptyState icon={PenLine} title="Henüz düzeltme yok">
                Konuşma dökümünde bir cevabın altındaki &ldquo;Bu cevabı düzelt&rdquo; bağlantısını kullanın ya da yandaki formdan ekleyin.
              </EmptyState>
            </div>
          )}
          {overLimit && <p className="mt-3 text-sm text-muted">200&apos;den fazla kayıt var; yalnızca en yeni 200 gösteriliyor.</p>}
        </div>
        <Panel title="Elle düzeltme ekle" className="self-start">
          <form action={addManualCorrection} className="grid gap-3">
            <Field label="Soru" htmlFor="question">
              <input id="question" name="question" required className={inputCls} />
            </Field>
            <Field label="Doğru cevap" htmlFor="answer">
              <CountedTextarea id="answer" name="answer" rows={5} required max={4000} className={textareaCls} />
            </Field>
            <Field label="Mod" htmlFor="mode">
              <select id="mode" name="mode" className={selectCls}>
                <option value="all">Tüm modlar</option>
                {MODES.map((m) => (
                  <option key={m} value={m}>
                    {MODE_META[m].label}
                  </option>
                ))}
              </select>
            </Field>
            <SubmitButton pendingText="Ekleniyor…">Ekle</SubmitButton>
          </form>
        </Panel>
      </div>
    </>
  );
}
