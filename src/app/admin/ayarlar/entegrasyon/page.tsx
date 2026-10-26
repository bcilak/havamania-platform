import { Plug } from "lucide-react";
import { SubmitButton } from "@/components/client";
import { checkboxCls, Field, Flash, inputCls, Notice, PageHeader, Panel } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { TOOLS, type ToolId } from "@/lib/bot-config";
import { decryptOrNull, maskSecret } from "@/lib/crypto";
import type { SearchParams } from "@/lib/form";
import { getSetting } from "@/lib/settings";
import { saveIntegration } from "./actions";
import { LiveTest } from "./live-test";
import { SENT_PARAMS } from "./samples";

export const metadata = { title: "Veri entegrasyonu" };

export default async function IntegrationPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdmin("integration");
  const sp = await searchParams;
  const cfg = await getSetting("integration");

  return (
    <>
      <PageHeader
        title="Veri entegrasyonu"
        description="Asistanın canlı veri araçları (hava, tahmin, agro, fly) Havamania'nın mevcut veri servisine bu ayarlarla bağlanır."
      />
      <Flash sp={sp} />
      {!cfg.baseUrl && (
        <div className="mb-5">
          <Notice tone="warn" icon={Plug}>
            Veri API&apos;si bağlanmadı. Bu durumda asistan güncel veri istendiğinde kullanıcıya veriye şu an erişemediğini söyler ve değer uydurmaz.
          </Notice>
        </div>
      )}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
        <form action={saveIntegration} className="grid gap-5">
          <Panel title="Bağlantı">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Temel adres" htmlFor="baseUrl" className="sm:col-span-2">
                <input id="baseUrl" name="baseUrl" defaultValue={cfg.baseUrl} placeholder="https://api.havamania.com" className={inputCls} />
              </Field>
              <Field label="API anahtarı" htmlFor="apiKey" hint={cfg.apiKeyEnc ? `Kayıtlı: ${maskSecret(decryptOrNull(cfg.apiKeyEnc))}. Boş bırakırsanız korunur.` : "Kayıtlı anahtar yok."}>
                <input id="apiKey" name="apiKey" type="password" autoComplete="off" className={inputCls} />
              </Field>
              <Field label="Anahtar başlığı" htmlFor="authHeader" hint="Authorization seçilirse 'Bearer <anahtar>' gönderilir; başka bir başlık adında anahtar olduğu gibi gönderilir.">
                <input id="authHeader" name="authHeader" defaultValue={cfg.authHeader} className={inputCls} />
              </Field>
              <Field label="Zaman aşımı (ms)" htmlFor="timeoutMs">
                <input id="timeoutMs" name="timeoutMs" type="number" min={1000} max={30000} step={500} defaultValue={cfg.timeoutMs} className={inputCls} />
              </Field>
              {cfg.apiKeyEnc && (
                <label className="flex items-center gap-2.5 self-end pb-2 text-sm">
                  <input type="checkbox" name="clearKey" className={checkboxCls} /> Kayıtlı anahtarı sil
                </label>
              )}
            </div>
          </Panel>
          <Panel title="Uç noktalar" description="Temel adrese eklenir; temel adresteki yol korunur (https://api.x/v2 + /weather → /v2/weather). Parametreler sorgu dizesi olarak gönderilir.">
            <div className="grid gap-4">
              {(Object.keys(TOOLS) as ToolId[]).map((t) => (
                <Field key={t} label={TOOLS[t].label} htmlFor={`endpoint_${t}`} hint={`Gönderilen: ${SENT_PARAMS[t]}`}>
                  <input id={`endpoint_${t}`} name={`endpoint_${t}`} defaultValue={cfg.endpoints[t]} className={`${inputCls} font-mono text-[13px]`} />
                </Field>
              ))}
            </div>
          </Panel>
          <div className="flex justify-end">
            <SubmitButton pendingText="Kaydediliyor…">Kaydet</SubmitButton>
          </div>
        </form>

        <Panel title="Canlı test" description="Kayıtlı ayarlarla, örnek parametrelerle gerçek bir istek atar ve dönen cevabı gösterir. Sayfa yenilemek istek atmaz; yalnızca “Dene” atar." className="self-start">
          <LiveTest tools={(Object.keys(TOOLS) as ToolId[]).map((t) => ({ id: t, label: TOOLS[t].label }))} />
        </Panel>
      </div>
    </>
  );
}
