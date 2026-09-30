import Link from "next/link";
import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import { EyeOff, Images } from "lucide-react";
import { db } from "@/db";
import { attachments, conversations } from "@/db/schema";
import { ConfirmButton, SubmitButton } from "@/components/client";
import { Badge, btn, cx, EmptyState, Flash, ModeBadge, PageHeader, Tabs } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { param, type SearchParams } from "@/lib/form";
import { fmtBytes, fmtRelative, PLATFORM_LABEL } from "@/lib/format";
import { can } from "@/lib/roles";
import { deletePhoto, togglePhoto } from "../konusmalar/[id]/actions";

export const metadata = { title: "Fotoğraflar" };
const PAGE = 48;

export default async function PhotosPage({ searchParams }: { searchParams: SearchParams }) {
  const admin = await requireAdmin("photos");
  const sp = await searchParams;
  const view = param(sp, "gorunum") === "gizli" ? "gizli" : "tum";
  const page = Math.max(1, Number(param(sp, "sayfa")) || 1);
  const canDelete = can(admin.role, "kvkk");

  const where = and(isNotNull(attachments.messageId), view === "gizli" ? eq(attachments.hidden, true) : undefined);
  const [{ n: total }] = await db.select({ n: sql<number>`count(*)::int` }).from(attachments).where(where);
  const [{ n: hiddenCount }] = await db.select({ n: sql<number>`count(*)::int` }).from(attachments).where(eq(attachments.hidden, true));
  const rows = await db
    .select({ a: attachments, mode: conversations.mode, platform: conversations.platform })
    .from(attachments)
    .innerJoin(conversations, eq(conversations.id, attachments.conversationId))
    .where(where)
    .orderBy(desc(attachments.createdAt))
    .limit(PAGE)
    .offset((page - 1) * PAGE);
  const back = `/admin/fotograflar${view === "gizli" ? "?gorunum=gizli" : ""}`;

  return (
    <>
      <PageHeader
        title="Fotoğraflar"
        description="Kullanıcıların asistana gönderdiği fotoğraflar. Gizlenen fotoğraf panelde soluk görünür ve modele bir daha gönderilmez."
      />
      <Flash sp={sp} />
      <Tabs
        items={[
          { href: "/admin/fotograflar", label: "Tümü", active: view === "tum" },
          { href: "/admin/fotograflar?gorunum=gizli", label: "Gizlenenler", active: view === "gizli", count: hiddenCount },
        ]}
      />
      {rows.length ? (
        <>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {rows.map(({ a, mode, platform }) => (
              <li key={a.id} className="overflow-hidden rounded-xl border border-line bg-surface">
                <a href={`/api/files/${a.storageKey}`} target="_blank" className="relative block bg-sunken">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/files/${a.storageKey}`} alt="Kullanıcı fotoğrafı" loading="lazy" className={cx("aspect-square w-full object-cover", a.hidden && "opacity-30")} />
                  {a.hidden && (
                    <span className="absolute inset-0 grid place-items-center">
                      <Badge tone="warn">
                        <EyeOff className="size-3" /> Gizli
                      </Badge>
                    </span>
                  )}
                </a>
                <div className="grid gap-2 p-3">
                  <div className="flex items-center justify-between gap-2 text-xs text-muted">
                    <ModeBadge mode={mode} />
                    <span>{fmtRelative(a.createdAt)}</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted">
                    <span>{PLATFORM_LABEL[platform]}</span>·<span>{fmtBytes(a.size)}</span>
                    {a.isDemo && <Badge className="ml-auto">Örnek</Badge>}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    <Link href={`/admin/konusmalar/${a.conversationId}#m-${a.messageId}`} className={btn("secondary", "sm")}>
                      Konuşma
                    </Link>
                    <form action={togglePhoto}>
                      <input type="hidden" name="id" value={a.id} />
                      <input type="hidden" name="back" value={back} />
                      <SubmitButton variant="ghost" size="sm">
                        {a.hidden ? "Göster" : "Gizle"}
                      </SubmitButton>
                    </form>
                    {canDelete && (
                      <form action={deletePhoto}>
                        <input type="hidden" name="id" value={a.id} />
                        <input type="hidden" name="back" value={back} />
                        <ConfirmButton confirmText="Silinsin mi?">Sil</ConfirmButton>
                      </form>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
          {total > PAGE && (
            <div className="mt-4 flex justify-end gap-2">
              {page > 1 && (
                <Link className={btn("secondary", "sm")} href={`?gorunum=${view}&sayfa=${page - 1}`}>
                  Önceki
                </Link>
              )}
              {page * PAGE < total && (
                <Link className={btn("secondary", "sm")} href={`?gorunum=${view}&sayfa=${page + 1}`}>
                  Sonraki
                </Link>
              )}
            </div>
          )}
        </>
      ) : (
        <div className="rounded-xl border border-line bg-surface">
          <EmptyState icon={Images} title={view === "gizli" ? "Gizlenmiş fotoğraf yok" : "Henüz fotoğraf gönderilmedi"}>
            Kullanıcılar sohbet ekranından fotoğraf gönderdiğinde burada görünecek. Örneğin Agro modunda yaprak ya da tarla fotoğrafı.
          </EmptyState>
        </div>
      )}
    </>
  );
}
