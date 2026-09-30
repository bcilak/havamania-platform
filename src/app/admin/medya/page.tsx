import { desc } from "drizzle-orm";
import { FileText, Image as ImageIcon } from "lucide-react";
import { db } from "@/db";
import { media } from "@/db/schema";
import { ConfirmButton, CopyButton, SubmitButton } from "@/components/client";
import { EmptyState, Flash, inputCls, PageHeader, Panel } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import type { SearchParams } from "@/lib/form";
import { fmtBytes, fmtRelative } from "@/lib/format";
import { deleteMedia, updateAlt, uploadMedia } from "./actions";

export const metadata = { title: "Medya kütüphanesi" };

export default async function MediaPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdmin("media");
  const sp = await searchParams;
  const items = await db.select().from(media).orderBy(desc(media.createdAt)).limit(300);
  const base = (process.env.APP_URL || "").replace(/\/$/, "");

  return (
    <>
      <PageHeader title="Medya kütüphanesi" description="Sitede ve paylaşım kartlarında kullanılacak görseller. Her dosyanın herkese açık bir bağlantısı vardır." />
      <Flash sp={sp} />
      <Panel className="mb-6" title="Dosya yükle" description="PNG, JPG, WEBP, GIF, SVG, ICO veya PDF. Dosya başına en fazla 10 MB.">
        <form action={uploadMedia} className="flex flex-wrap items-center gap-3">
          <input name="files" type="file" multiple required accept="image/*,application/pdf" aria-label="Dosyalar" className="text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-sunken file:px-3 file:py-1.5 file:text-sm" />
          <SubmitButton pendingText="Yükleniyor…">Yükle</SubmitButton>
        </form>
      </Panel>
      {items.length ? (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {items.map((m) => {
            const url = `/api/media/${m.id}`;
            return (
              <li key={m.id} className="overflow-hidden rounded-xl border border-line bg-surface">
                <a href={url} target="_blank" className="grid aspect-[4/3] place-items-center bg-sunken">
                  {m.mediaType.startsWith("image/") ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={url} alt={m.alt ?? m.filename} loading="lazy" className="max-h-full max-w-full object-contain p-3" />
                  ) : (
                    <FileText className="size-8 text-muted" />
                  )}
                </a>
                <div className="grid gap-2 p-3">
                  <div className="truncate text-sm font-medium" title={m.filename}>
                    {m.filename}
                  </div>
                  <div className="text-xs text-muted">
                    {fmtBytes(m.size)} · {fmtRelative(m.createdAt)}
                  </div>
                  <form action={updateAlt} className="flex gap-1.5">
                    <input type="hidden" name="id" value={m.id} />
                    <input name="alt" defaultValue={m.alt ?? ""} placeholder="Açıklama (alt metin)" aria-label="Alt metin" className={`${inputCls} h-8 text-[13px]`} />
                    <SubmitButton variant="ghost" size="sm">
                      Kaydet
                    </SubmitButton>
                  </form>
                  <div className="flex gap-1.5">
                    <CopyButton text={`${base}${url}`} label="Bağlantı" />
                    <form action={deleteMedia} className="ml-auto">
                      <input type="hidden" name="id" value={m.id} />
                      <ConfirmButton confirmText="Silinsin mi?">Sil</ConfirmButton>
                    </form>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="rounded-xl border border-line bg-surface">
          <EmptyState icon={ImageIcon} title="Kütüphane boş">
            Logo, paylaşım görseli ya da sayfa görsellerini yukarıdan yükleyin.
          </EmptyState>
        </div>
      )}
    </>
  );
}
