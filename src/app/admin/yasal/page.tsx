import { ExternalLink } from "lucide-react";
import { CopyButton, SubmitButton } from "@/components/client";
import { checkboxCls, Field, Flash, inputCls, Notice, PageHeader, Panel, textareaCls } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import type { SearchParams } from "@/lib/form";
import { formatLegalDate, LEGAL_PAGES, LEGAL_TOKENS, type LegalSlug } from "@/lib/legal";
import { getSetting } from "@/lib/settings";
import { saveLegal } from "./actions";

export const metadata = { title: "Yasal sayfalar" };

export default async function LegalAdminPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdmin("cms");
  const sp = await searchParams;
  const [cfg, kvkk] = await Promise.all([getSetting("legal"), getSetting("kvkk")]);
  const site = (process.env.APP_URL || "http://localhost:3110").replace(/\/$/, "");
  const slugs = Object.keys(LEGAL_PAGES) as LegalSlug[];

  return (
    <>
      <PageHeader
        title="Yasal sayfalar"
        description={`Gizlilik politikası, kullanım koşulları ve hesap silme sayfası. Kaydettiğiniz anda yayınlanır. Son güncelleme: ${formatLegalDate(cfg.updatedAt)}.`}
      />
      <Flash sp={sp} />

      <div className="mb-5 grid gap-3">
        {!cfg.email && (
          <Notice tone="warn">İletişim e-postası boş. Sayfalarda “[iletişim e-postası henüz eklenmedi]” yazıyor; mağazaya göndermeden önce doldurun.</Notice>
        )}
        <Notice>
          Metinler uygulamanın gerçekte topladığı verilerle ve Google Play Console’daki Veri güvenliği formuyla uyuşmalı. Yayından önce hukuk ekibinizin onayından geçirin.
        </Notice>
      </div>

      <Panel title="Mağaza bağlantıları" description="Google Play Console ve App Store Connect'e bu adresleri girin." className="mb-5">
        <ul className="grid gap-2.5">
          {slugs.map((s) => {
            const url = `${site}${LEGAL_PAGES[s].path}`;
            return (
              <li key={s} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                <span className="w-44 shrink-0 font-medium">{LEGAL_PAGES[s].title}</span>
                <a href={LEGAL_PAGES[s].path} target="_blank" className="inline-flex min-w-0 items-center gap-1 font-mono text-[13px] text-accent hover:underline [overflow-wrap:anywhere]">
                  {url} <ExternalLink className="size-3.5 shrink-0" />
                </a>
                <CopyButton text={url} />
              </li>
            );
          })}
        </ul>
        <p className="mt-3 text-xs text-muted">
          Play Console: Uygulama içeriği › Gizlilik politikası için ilk adresi, Veri güvenliği › Hesap silme için üçüncü adresi kullanın.
        </p>
      </Panel>

      <form action={saveLegal} className="grid gap-5">
        <Panel title="Şirket bilgileri" description="Üç sayfadaki yer tutucular bu bilgilerle doldurulur.">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Şirket unvanı (veri sorumlusu)" htmlFor="company" hint="Ticaret sicilindeki tam unvan, ör. '... Bilişim Ltd. Şti.'">
              <input id="company" name="company" defaultValue={cfg.company} required className={inputCls} />
            </Field>
            <Field label="İletişim e-postası" htmlFor="email" hint="KVKK başvuruları ve hesap silme talepleri buraya gelir.">
              <input id="email" name="email" type="email" defaultValue={cfg.email} placeholder="kvkk@ornek.com" className={inputCls} />
            </Field>
            <Field label="Adres" htmlFor="address" hint="Boş bırakırsanız adres satırı gösterilmez." className="sm:col-span-2">
              <input id="address" name="address" defaultValue={cfg.address} className={inputCls} />
            </Field>
            <Field label="Sunucu konumu" htmlFor="hosting" hint="Cümle içinde geçer: '... {{sunucu}} bulunan bir veri merkezinde barındırılır.' Ör. 'Almanya'da'.">
              <input id="hosting" name="hosting" defaultValue={cfg.hosting} className={inputCls} />
            </Field>
          </div>
        </Panel>

        <Panel title="Yer tutucular" description="Metinlerde bu ifadeler kullanılabilir; sayfada gerçek değerle değiştirilir.">
          <ul className="grid gap-1.5 text-sm sm:grid-cols-2">
            {LEGAL_TOKENS.map(([t, label]) => (
              <li key={t}>
                <code className="rounded bg-sunken px-1 py-0.5 font-mono text-[12.5px]">{t}</code> <span className="text-muted">{label}</span>
                {t === "{{saklama}}" && <span className="text-muted"> · şu an {kvkk.retentionDays}</span>}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs leading-relaxed text-muted">
            Biçim: boş satır paragraf, <code className="font-mono">## </code> başlık, <code className="font-mono">- </code> madde, <code className="font-mono">1. </code> numaralı liste,{" "}
            <code className="font-mono">**kalın**</code>. Bağlantılar ve e-posta adresleri kendiliğinden tıklanabilir olur.
          </p>
        </Panel>

        {slugs.map((s) => (
          <Panel
            key={s}
            title={LEGAL_PAGES[s].title}
            actions={
              <a href={LEGAL_PAGES[s].path} target="_blank" className="inline-flex items-center gap-1 text-sm text-accent hover:underline">
                Sayfayı aç <ExternalLink className="size-3.5" />
              </a>
            }
          >
            <textarea name={s} rows={16} defaultValue={cfg[s]} className={`${textareaCls} font-mono text-[13px] leading-relaxed`} aria-label={LEGAL_PAGES[s].title} />
            <label className="mt-3 flex items-center gap-2.5 text-sm text-muted">
              <input type="checkbox" name={`reset_${s}`} className={checkboxCls} /> Kaydederken bu sayfayı varsayılan metne döndür
            </label>
          </Panel>
        ))}

        <div className="flex justify-end">
          <SubmitButton pendingText="Kaydediliyor…">Kaydet ve yayınla</SubmitButton>
        </div>
      </form>
    </>
  );
}
