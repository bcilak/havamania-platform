import Link from "next/link";
import { and, desc, eq, sql } from "drizzle-orm";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import { db } from "@/db";
import { conversations, feedback, messages } from "@/db/schema";
import { SubmitButton } from "@/components/client";
import { Badge, btn, EmptyState, Flash, ModeBadge, PageHeader, Tabs } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { param, type SearchParams } from "@/lib/form";
import { fmtRelative } from "@/lib/format";
import { can } from "@/lib/roles";
import { setFeedbackStatus } from "./actions";

export const metadata = { title: "Geri bildirim" };

export default async function FeedbackPage({ searchParams }: { searchParams: SearchParams }) {
  const admin = await requireAdmin("feedback");
  const sp = await searchParams;
  const status = (["open", "resolved", "dismissed"].includes(param(sp, "durum")) ? param(sp, "durum") : "open") as "open" | "resolved" | "dismissed";
  const rating = param(sp, "oy") === "olumlu" ? 1 : -1;
  const canTrain = can(admin.role, "training");

  const rows = await db
    .select({
      f: feedback,
      answer: messages.content,
      answerAt: messages.createdAt,
      mode: conversations.mode,
      isDemo: conversations.isDemo,
      question: sql<string | null>`(select u.content from messages u where u.conversation_id = ${messages.conversationId} and u.role = 'user' and u.created_at <= ${messages.createdAt} order by u.created_at desc limit 1)`,
    })
    .from(feedback)
    .innerJoin(messages, eq(messages.id, feedback.messageId))
    .innerJoin(conversations, eq(conversations.id, feedback.conversationId))
    .where(and(eq(feedback.status, status), eq(feedback.rating, rating)))
    .orderBy(desc(feedback.createdAt))
    .limit(100);

  const counts = await db
    .select({ status: feedback.status, n: sql<number>`count(*)::int` })
    .from(feedback)
    .where(eq(feedback.rating, rating))
    .groupBy(feedback.status);
  const countOf = (s: string) => counts.find((c) => c.status === s)?.n ?? 0;
  const q = (s: string) => `/admin/geri-bildirim?durum=${s}${rating === 1 ? "&oy=olumlu" : ""}`;
  const back = q(status);

  return (
    <>
      <PageHeader
        title="Geri bildirim"
        description="Kullanıcıların cevaplara verdiği oylar. Olumsuz bir cevabı düzelttiğinizde düzeltme bilgi tabanına eklenir ve geri bildirim kendiliğinden kapanır."
        actions={
          <div className="flex rounded-lg border border-line-strong p-0.5">
            <Link href="/admin/geri-bildirim" className={rating === -1 ? btn("primary", "sm") : btn("ghost", "sm")}>
              <ThumbsDown className="size-3.5" /> Olumsuz
            </Link>
            <Link href="/admin/geri-bildirim?oy=olumlu" className={rating === 1 ? btn("primary", "sm") : btn("ghost", "sm")}>
              <ThumbsUp className="size-3.5" /> Olumlu
            </Link>
          </div>
        }
      />
      <Flash sp={sp} />
      <Tabs
        items={[
          { href: q("open"), label: "Açık", active: status === "open", count: countOf("open") },
          { href: q("resolved"), label: "Çözüldü", active: status === "resolved", count: countOf("resolved") },
          { href: q("dismissed"), label: "Yoksayıldı", active: status === "dismissed", count: countOf("dismissed") },
        ]}
      />
      {rows.length ? (
        <ul className="grid gap-3">
          {rows.map(({ f, answer, mode, question, isDemo }) => (
            <li key={f.id} className="rounded-xl border border-line bg-surface p-4">
              <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-muted">
                <ModeBadge mode={mode} />
                <span>·</span>
                <span>{fmtRelative(f.createdAt)}</span>
                {isDemo && <Badge>Örnek</Badge>}
                {f.resolvedBy && <span className="ml-auto">{f.resolvedBy}</span>}
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <div className="mb-1 text-xs font-medium text-muted">Kullanıcının sorusu</div>
                  <p className="text-sm leading-relaxed">{question || "(fotoğraf)"}</p>
                </div>
                <div>
                  <div className="mb-1 text-xs font-medium text-muted">Asistanın cevabı</div>
                  <p className="line-clamp-5 text-sm leading-relaxed">{answer}</p>
                </div>
              </div>
              {f.comment && <p className="mt-3 rounded-lg bg-sunken px-3 py-2 text-sm">“{f.comment}”</p>}
              <div className="mt-3 flex flex-wrap gap-2">
                {canTrain && rating === -1 && status === "open" && (
                  <Link href={`/admin/konusmalar/${f.conversationId}?duzelt=${f.messageId}#m-${f.messageId}`} className={btn("primary", "sm")}>
                    Düzelt
                  </Link>
                )}
                <Link href={`/admin/konusmalar/${f.conversationId}#m-${f.messageId}`} className={btn("secondary", "sm")}>
                  Konuşmayı aç
                </Link>
                {status === "open" ? (
                  <>
                    <form action={setFeedbackStatus}>
                      <input type="hidden" name="id" value={f.id} />
                      <input type="hidden" name="status" value="resolved" />
                      <input type="hidden" name="back" value={back} />
                      <SubmitButton variant="ghost" size="sm">
                        Çözüldü
                      </SubmitButton>
                    </form>
                    <form action={setFeedbackStatus}>
                      <input type="hidden" name="id" value={f.id} />
                      <input type="hidden" name="status" value="dismissed" />
                      <input type="hidden" name="back" value={back} />
                      <SubmitButton variant="ghost" size="sm">
                        Yoksay
                      </SubmitButton>
                    </form>
                  </>
                ) : (
                  <form action={setFeedbackStatus}>
                    <input type="hidden" name="id" value={f.id} />
                    <input type="hidden" name="status" value="open" />
                    <input type="hidden" name="back" value={back} />
                    <SubmitButton variant="ghost" size="sm">
                      Yeniden aç
                    </SubmitButton>
                  </form>
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="rounded-xl border border-line bg-surface">
          <EmptyState icon={rating === -1 ? ThumbsDown : ThumbsUp} title="Bu listede kayıt yok">
            Kullanıcılar sohbet ekranında cevapları oyladığında burada görünecek.
          </EmptyState>
        </div>
      )}
    </>
  );
}
