import { desc } from "drizzle-orm";
import { db } from "@/db";
import { deletionRequests } from "@/db/schema";
import { ConfirmButton, SubmitButton } from "@/components/client";
import { Badge, checkboxCls, Field, Flash, inputCls, KeyValue, Notice, PageHeader, Panel, selectCls, TableWrap, td, textareaCls, th } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import type { SearchParams } from "@/lib/form";
import { fmtDateTime, fmtInt } from "@/lib/format";
import { countExpired } from "@/lib/kvkk";
import { getSetting } from "@/lib/settings";
import { storage } from "@/lib/storage";
import { cleanupNow, handleDeletion, saveKvkk } from "./actions";

export const metadata = { title: "KVKK" };

export default async function KvkkPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdmin("kvkk");
  const sp = await searchParams;
  const cfg = await getSetting("kvkk");
  const expired = await countExpired(cfg.retentionDays);
  const requests = await db.select().from(deletionRequests).orderBy(desc(deletionRequests.createdAt)).limit(50);
  const cronReady = Boolean(process.env.CRON_SECRET);

  return (
    <>
      <PageHeader title="KVKK" description="Kullanıcı verilerinin ne kadar saklanacağı, kullanıcıya gösterilen aydınlatma metni ve silme talepleri." />
      <Flash sp={sp} />
      <div className="mb-5">
        <Notice tone="warn">
          Mesajlar ve fotoğraflar yurt dışındaki yapay zekâ sağlayıcılarına gönderildiği için bu işlem yurt dışına veri aktarımı sayılır. Aydınlatma metni ve açık rıza
          içeriği canlıya çıkmadan önce hukuk ekibinizin onayından geçmeli.
        </Notice>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <form action={saveKvkk} className="grid content-start gap-5">
          <Panel title="Aydınlatma metni ve açık rıza" description={`Kullanıcı sohbeti ilk açtığında gösterilir. Şu anki sürüm: v${cfg.consentVersion}.`}>
            <div className="grid gap-4">
              <textarea name="consentText" rows={7} defaultValue={cfg.consentText} className={textareaCls} aria-label="Aydınlatma metni" />
              <label className="flex items-center gap-2.5 text-sm">
                <input type="checkbox" name="bump" className={checkboxCls} /> Metin değişmese de kullanıcılardan yeniden onay iste
              </label>
              <p className="text-xs text-muted">Metni değiştirdiğinizde sürüm kendiliğinden artar ve herkes bir sonraki açılışta yeniden onaylar.</p>
            </div>
          </Panel>
          <Panel title="Saklama süresi">
            <Field label="Konuşmalar ve fotoğraflar kaç gün saklansın?" htmlFor="retentionDays" hint="Süre dolunca konuşma, tüm mesajları ve fotoğraflarıyla kalıcı olarak silinir.">
              <input id="retentionDays" name="retentionDays" type="number" min={7} max={3650} defaultValue={cfg.retentionDays} className={`${inputCls} w-32`} />
            </Field>
          </Panel>
          <div className="flex justify-end">
            <SubmitButton pendingText="Kaydediliyor…">Kaydet</SubmitButton>
          </div>
        </form>

        <div className="grid content-start gap-5">
          <Panel title="Saklama temizliği">
            <KeyValue
              items={[
                ["Süresi dolan", `${fmtInt(expired)} konuşma`],
                ["Son temizlik", cfg.lastCleanupAt ? fmtDateTime(cfg.lastCleanupAt) : "hiç çalışmadı"],
                ["Dosya deposu", storage.driverName()],
                ["Otomatik çalıştırma", cronReady ? <Badge key="c" tone="good">CRON_SECRET tanımlı</Badge> : <Badge key="c" tone="warn">Kurulmadı</Badge>],
              ]}
            />
            <form action={cleanupNow} className="mt-4">
              <ConfirmButton variant={expired ? "danger" : "secondary"} size="md" confirmText={`${expired} konuşma kalıcı silinsin mi?`}>
                Şimdi temizle
              </ConfirmButton>
            </form>
            <p className="mt-3 text-xs leading-relaxed text-muted">
              Otomatik temizlik için sunucuda günde bir kez şu isteği zamanlayın:{" "}
              <code className="rounded bg-sunken px-1 py-0.5 font-mono break-all">POST /api/cron/kvkk</code> ve{" "}
              <code className="rounded bg-sunken px-1 py-0.5 font-mono">Authorization: Bearer $CRON_SECRET</code>.
            </p>
          </Panel>

          <Panel title="Silme talebi" description="Bir kullanıcının tüm konuşmalarını, fotoğraflarını ve kaydını siler.">
            <form action={handleDeletion} className="grid gap-3">
              <Field label="Kimlik türü" htmlFor="type">
                <select id="type" name="type" className={selectCls}>
                  <option value="external_user">Uygulamadaki kullanıcı kimliği</option>
                  <option value="device">Cihaz kimliği</option>
                </select>
              </Field>
              <Field label="Kimlik" htmlFor="identifier">
                <input id="identifier" name="identifier" required className={`${inputCls} font-mono text-[13px]`} />
              </Field>
              <ConfirmButton size="md" confirmText="Tüm verisi kalıcı silinsin mi?">
                Verileri sil
              </ConfirmButton>
            </form>
          </Panel>
        </div>
      </div>

      <h2 className="mt-8 mb-3 text-[15px] font-semibold">Silme talepleri</h2>
      {requests.length ? (
        <TableWrap>
          <thead>
            <tr>
              <th className={th}>Tarih</th>
              <th className={th}>Kimlik</th>
              <th className={th}>Sonuç</th>
              <th className={`${th} text-right`}>Konuşma</th>
              <th className={`${th} text-right`}>Fotoğraf</th>
              <th className={th}>İşleyen</th>
            </tr>
          </thead>
          <tbody>
            {requests.map((r) => (
              <tr key={r.id}>
                <td className={`${td} whitespace-nowrap text-muted`}>{fmtDateTime(r.createdAt)}</td>
                <td className={`${td} font-mono text-xs`}>
                  {r.identifier} <span className="text-muted">({r.identifierType === "device" ? "cihaz" : "kullanıcı"})</span>
                </td>
                <td className={td}>{r.status === "completed" ? <Badge tone="good">Silindi</Badge> : <Badge>Bulunamadı</Badge>}</td>
                <td className={`${td} tabular text-right`}>{r.deletedConversations}</td>
                <td className={`${td} tabular text-right`}>{r.deletedPhotos}</td>
                <td className={`${td} text-muted`}>{r.requestedBy}</td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      ) : (
        <p className="text-sm text-muted">Henüz silme talebi işlenmedi.</p>
      )}
    </>
  );
}
