import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { PenLine } from "lucide-react";
import { db } from "@/db";
import { corrections, kbSources } from "@/db/schema";
import { ConfirmButton, SubmitButton } from "@/components/client";
import { Badge, EmptyState, Field, Flash, inputCls, PageHeader, Panel, selectCls, textareaCls } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { MODES, MODE_META } from "@/lib/bot-config";
import type { SearchParams } from "@/lib/form";
import { fmtRelative } from "@/lib/format";
import { addManualCorrection, deleteCorrection } from "./actions";

export const metadata = { title: "Düzeltmeler" };

export default async function CorrectionsPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdmin("training");
  const sp = await searchParams;
  const rows = await db
    .select({ c: corrections, status: kbSources.status })
    .from(corrections)
    .leftJoin(kbSources, eq(kbSources.id, corrections.kbSourceId))
    .orderBy(desc(corrections.createdAt))
    .limit(200);

  return (
    <>
      <PageHeader
        title="Düzeltmeler"
        description="Ekibin düzelttiği cevaplar. Her düzeltme bilgi tabanına yüksek öncelikli bir soru-cevap olarak girer ve bot aynı soruda artık bunu esas alır."
      />
      <Flash sp={sp} />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div>
          {rows.length ? (
            <ul className="grid gap-3">
              {rows.map(({ c, status }) => (
                <li key={c.id} className="rounded-xl border border-line bg-surface p-4">
                  <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted">
                    <span>{c.mode === "all" ? "Tüm modlar" : MODE_META[c.mode].label}</span>·<span>{c.createdBy}</span>·<span>{fmtRelative(c.createdAt)}</span>
                    {status === "ready" ? <Badge tone="good">Bilgi tabanında</Badge> : status ? <Badge tone="warn">İşleniyor</Badge> : <Badge tone="bad">Kaynak silinmiş</Badge>}
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
              ))}
            </ul>
          ) : (
            <div className="rounded-xl border border-line bg-surface">
              <EmptyState icon={PenLine} title="Henüz düzeltme yok">
                Konuşma dökümünde bir cevabın altındaki &ldquo;Bu cevabı düzelt&rdquo; bağlantısını kullanın ya da yandaki formdan ekleyin.
              </EmptyState>
            </div>
          )}
        </div>
        <Panel title="Elle düzeltme ekle" className="self-start">
          <form action={addManualCorrection} className="grid gap-3">
            <Field label="Soru" htmlFor="question">
              <input id="question" name="question" required className={inputCls} />
            </Field>
            <Field label="Doğru cevap" htmlFor="answer">
              <textarea id="answer" name="answer" rows={5} required className={textareaCls} />
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
