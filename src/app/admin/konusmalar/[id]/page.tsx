import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq, inArray } from "drizzle-orm";
import { Bot, ChevronLeft, CircleAlert, Flag, PenLine, ThumbsDown, ThumbsUp, User, Wrench, BookOpen } from "lucide-react";
import { db } from "@/db";
import { appUsers, attachments, conversations, feedback, messages } from "@/db/schema";
import { ConfirmButton, SubmitButton } from "@/components/client";
import { Badge, btn, cx, Field, Flash, KeyValue, ModeBadge, PageHeader, Panel, selectCls, textareaCls } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { MODE_DISCLAIMERS, MODE_META } from "@/lib/bot-config";
import type { SearchParams } from "@/lib/form";
import { fmtDateTime, fmtInt, fmtTime, fmtUsd, maskId, PLATFORM_LABEL } from "@/lib/format";
import { can } from "@/lib/roles";
import { addCorrection, deleteConversation, deletePhoto, toggleFlag, togglePhoto } from "./actions";

export const metadata = { title: "Konuşma" };

function Json({ value }: { value: unknown }) {
  return (
    <pre className="max-h-64 overflow-auto rounded-lg bg-sunken p-3 font-mono text-[12px] leading-relaxed whitespace-pre-wrap text-ink">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

export default async function ConversationDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const admin = await requireAdmin("conversations");
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const [c] = await db.select().from(conversations).where(eq(conversations.id, id));
  if (!c) notFound();
  const [user] = c.appUserId ? await db.select().from(appUsers).where(eq(appUsers.id, c.appUserId)) : [];
  const msgs = await db.select().from(messages).where(eq(messages.conversationId, id)).orderBy(asc(messages.createdAt));
  const ids = msgs.map((m) => m.id);
  const photos = ids.length ? await db.select().from(attachments).where(inArray(attachments.messageId, ids)) : [];
  const fbs = ids.length ? await db.select().from(feedback).where(inArray(feedback.messageId, ids)) : [];

  const pii = can(admin.role, "pii");
  const canTrain = can(admin.role, "training");
  const canDelete = can(admin.role, "kvkk");
  const self = `/admin/konusmalar/${id}`;
  const disclaimer = MODE_DISCLAIMERS[c.mode];

  return (
    <>
      <Link href="/admin/konusmalar" className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
        <ChevronLeft className="size-4" /> Konuşmalar
      </Link>
      <PageHeader
        title={c.title || "Başlıksız konuşma"}
        actions={
          <>
            <form action={toggleFlag}>
              <input type="hidden" name="id" value={c.id} />
              <SubmitButton variant="secondary" size="sm">
                <Flag className="size-3.5" /> {c.flagged ? "İşareti kaldır" : "İşaretle"}
              </SubmitButton>
            </form>
            {canDelete && (
              <form action={deleteConversation}>
                <input type="hidden" name="id" value={c.id} />
                <ConfirmButton confirmText="Kalıcı olarak silinsin mi?">Sil</ConfirmButton>
              </form>
            )}
          </>
        }
      />
      <Flash sp={sp} />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <ol className="grid gap-4" aria-label="Mesajlar">
          {msgs.map((m, i) => {
            const own = photos.filter((p) => p.messageId === m.id);
            const fb = fbs.find((f) => f.messageId === m.id);
            const prevUser = m.role === "assistant" ? [...msgs.slice(0, i)].reverse().find((x) => x.role === "user") : null;
            const isUser = m.role === "user";
            return (
              <li key={m.id} id={`m-${m.id}`} className="scroll-mt-6">
                <div
                  className={cx(
                    "rounded-xl border p-4",
                    isUser ? "border-line bg-surface" : "border-line bg-surface",
                    fb?.rating === -1 && "border-bad/40",
                  )}
                >
                  <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted">
                    {isUser ? <User className="size-3.5" /> : <Bot className="size-3.5 text-accent" />}
                    <span className="font-medium text-ink">{isUser ? "Kullanıcı" : "Asistan"}</span>
                    <span>{fmtTime(m.createdAt)}</span>
                    {!isUser && m.model && <span className="font-mono">{m.model}</span>}
                    {!isUser && m.latencyMs != null && <span className="tabular">{(m.latencyMs / 1000).toFixed(1)} sn</span>}
                    {!isUser && m.inputTokens != null && (
                      <span className="tabular">
                        {fmtInt(m.inputTokens)} + {fmtInt(m.outputTokens)} token · {fmtUsd(m.costUsd)}
                      </span>
                    )}
                    {m.unanswered && <Badge tone="warn">Karşılığı bulunamadı</Badge>}
                    {fb && (
                      <Badge tone={fb.rating === 1 ? "good" : "bad"} className="ml-auto">
                        {fb.rating === 1 ? <ThumbsUp className="size-3" /> : <ThumbsDown className="size-3" />}
                        {fb.rating === 1 ? "Beğenildi" : "Beğenilmedi"}
                        {fb.status !== "open" && ` · ${fb.status === "resolved" ? "çözüldü" : "yoksayıldı"}`}
                      </Badge>
                    )}
                  </div>

                  {m.content && <div className="text-[15px] leading-relaxed whitespace-pre-wrap">{m.content}</div>}
                  {m.error && (
                    <div className="mt-2 flex items-start gap-2 rounded-lg bg-bad-soft px-3 py-2 text-xs">
                      <CircleAlert className="mt-0.5 size-3.5 shrink-0 text-bad" />
                      <span className="font-mono break-all">{m.error}</span>
                    </div>
                  )}
                  {fb?.comment && <p className="mt-2 rounded-lg bg-sunken px-3 py-2 text-sm">Kullanıcı yorumu: “{fb.comment}”</p>}

                  {own.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {own.map((p) => (
                        <figure key={p.id} className="w-40">
                          <a href={`/api/files/${p.storageKey}`} target="_blank" className="block overflow-hidden rounded-lg border border-line">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={`/api/files/${p.storageKey}`} alt="Kullanıcının gönderdiği fotoğraf" className={cx("aspect-square w-full object-cover", p.hidden && "opacity-30")} />
                          </a>
                          <figcaption className="mt-1 flex gap-1">
                            <form action={togglePhoto}>
                              <input type="hidden" name="id" value={p.id} />
                              <input type="hidden" name="back" value={self} />
                              <SubmitButton variant="ghost" size="sm">
                                {p.hidden ? "Göster" : "Gizle"}
                              </SubmitButton>
                            </form>
                            {canDelete && (
                              <form action={deletePhoto}>
                                <input type="hidden" name="id" value={p.id} />
                                <input type="hidden" name="back" value={self} />
                                <ConfirmButton confirmText="Silinsin mi?">Sil</ConfirmButton>
                              </form>
                            )}
                          </figcaption>
                        </figure>
                      ))}
                    </div>
                  )}

                  {!isUser && disclaimer && <p className="mt-3 border-t border-line pt-2 text-xs text-muted">Kullanıcıya gösterilen uyarı: {disclaimer}</p>}

                  {!isUser && (m.toolCalls.length > 0 || m.sources.length > 0 || canTrain) && (
                    <div className="mt-3 grid gap-2">
                      {m.toolCalls.length > 0 && (
                        <details className="rounded-lg border border-line">
                          <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 text-[13px] text-muted hover:text-ink">
                            <Wrench className="size-3.5" /> {m.toolCalls.length} araç çağrısı: {m.toolCalls.map((t) => t.name).join(", ")}
                          </summary>
                          <div className="grid gap-3 border-t border-line p-3">
                            {m.toolCalls.map((t, ti) => (
                              <div key={ti} className="grid gap-1.5">
                                <div className="font-mono text-xs font-medium">{t.name}</div>
                                <Json value={{ girdi: t.input, çıktı: t.output }} />
                              </div>
                            ))}
                          </div>
                        </details>
                      )}
                      {m.sources.length > 0 && (
                        <details className="rounded-lg border border-line">
                          <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 text-[13px] text-muted hover:text-ink">
                            <BookOpen className="size-3.5" /> {m.sources.length} bilgi tabanı kaynağı kullanıldı
                          </summary>
                          <ul className="divide-y divide-line border-t border-line">
                            {m.sources.map((s, si) => (
                              <li key={si} className="px-3 py-2.5 text-sm">
                                <div className="flex items-center gap-2">
                                  <span className="font-medium">{s.title}</span>
                                  <span className="tabular ml-auto text-xs text-muted">benzerlik {Math.round(s.score * 100)}</span>
                                </div>
                                <p className="mt-1 line-clamp-3 text-[13px] text-muted">{s.snippet}</p>
                              </li>
                            ))}
                          </ul>
                        </details>
                      )}
                      {canTrain && (
                        <details className="rounded-lg border border-line" open={sp.duzelt === m.id}>
                          <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 text-[13px] text-accent">
                            <PenLine className="size-3.5" /> Bu cevabı düzelt
                          </summary>
                          <form action={addCorrection} className="grid gap-3 border-t border-line p-3">
                            <input type="hidden" name="conversationId" value={c.id} />
                            <input type="hidden" name="messageId" value={m.id} />
                            <input type="hidden" name="wrong" value={m.content} />
                            <Field label="Soru" htmlFor={`q-${m.id}`} hint="Kullanıcıların bu soruyu sorma biçimi. Gerekirse sadeleştirin.">
                              <textarea id={`q-${m.id}`} name="question" rows={2} defaultValue={prevUser?.content ?? ""} required className={textareaCls} />
                            </Field>
                            <Field label="Doğru cevap" htmlFor={`a-${m.id}`}>
                              <textarea id={`a-${m.id}`} name="correct" rows={4} required className={textareaCls} />
                            </Field>
                            <div className="flex flex-wrap items-end justify-between gap-3">
                              <Field label="Geçerli olduğu modlar" htmlFor={`s-${m.id}`}>
                                <select id={`s-${m.id}`} name="scope" className={`${selectCls} w-auto`}>
                                  <option value="mode">Yalnızca {MODE_META[c.mode].label}</option>
                                  <option value="all">Tüm modlar</option>
                                </select>
                              </Field>
                              <SubmitButton pendingText="Ekleniyor…">Düzeltmeyi kaydet</SubmitButton>
                            </div>
                          </form>
                        </details>
                      )}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
          {!msgs.length && <li className="rounded-xl border border-line bg-surface p-6 text-sm text-muted">Bu konuşmada mesaj yok.</li>}
        </ol>

        <aside className="grid content-start gap-4">
          <Panel title="Ayrıntılar">
            <KeyValue
              items={[
                ["Mod", <ModeBadge key="m" mode={c.mode} />],
                ["Platform", PLATFORM_LABEL[c.platform]],
                ["Sürüm", c.versionNumber ? `v${c.versionNumber}` : c.platform === "playground" ? "Taslak" : "—"],
                ["Başladı", fmtDateTime(c.startedAt)],
                ["Son mesaj", fmtDateTime(c.lastMessageAt)],
                ["Mesaj", fmtInt(c.messageCount)],
                ["Token", `${fmtInt(c.inputTokens)} girdi · ${fmtInt(c.outputTokens)} çıktı`],
                ["Maliyet", fmtUsd(c.costUsd)],
              ]}
            />
            {c.isDemo && <Badge className="mt-3">Örnek veri</Badge>}
          </Panel>
          {user && (
            <Panel title="Kullanıcı" description={pii ? undefined : "Kişisel veriler rolünüz gereği maskeli."}>
              <KeyValue
                items={[
                  ["Cihaz", <span key="d" className="font-mono text-xs">{pii ? user.deviceId : maskId(user.deviceId)}</span>],
                  ["Uygulama kimliği", <span key="e" className="font-mono text-xs">{user.externalUserId ? (pii ? user.externalUserId : maskId(user.externalUserId)) : "anonim"}</span>],
                  ["Uygulama sürümü", user.appVersion ?? "—"],
                  ["Dil", user.locale ?? "—"],
                  ["KVKK onayı", user.consentAt ? `v${user.consentVersion} · ${fmtDateTime(user.consentAt)}` : "—"],
                  ["İlk görülme", fmtDateTime(user.firstSeenAt)],
                ]}
              />
              {pii && (
                <Link href={`/admin/konusmalar?q=&platform=${user.platform}`} className={cx(btn("ghost", "sm"), "mt-3")}>
                  Aynı platformdaki konuşmalar
                </Link>
              )}
            </Panel>
          )}
        </aside>
      </div>
    </>
  );
}
