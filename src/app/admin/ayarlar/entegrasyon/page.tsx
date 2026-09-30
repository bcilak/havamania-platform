import { Plug } from "lucide-react";
import { SubmitButton } from "@/components/client";
import { btn, checkboxCls, Field, Flash, inputCls, Notice, PageHeader, Panel, selectCls } from "@/components/ui";
import { callHavamaniaApi } from "@/lib/ai/havamania-api";
import { requireAdmin } from "@/lib/auth";
import { TOOLS, type ToolId } from "@/lib/bot-config";
import { decryptOrNull, maskSecret } from "@/lib/crypto";
import { param, type SearchParams } from "@/lib/form";
import { getSetting } from "@/lib/settings";
import { saveIntegration } from "./actions";

export const metadata = { title: "Veri entegrasyonu" };

const SAMPLE: Record<ToolId, Record<string, string>> = {
  current_weather: { q: "Balıkesir" },
  forecast: { q: "İzmir", days: "3" },
  agro_conditions: { q: "Konya", crop: "buğday", days: "5" },
  flight_weather: { origin: "LTFM", destination: "LTAC", flightLevel: "350" },
};

export default async function IntegrationPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdmin("integration");
  const sp = await searchParams;
  const cfg = await getSetting("integration");
  const testTool = param(sp, "test") as ToolId | "";
  const result = testTool && testTool in TOOLS ? await callHavamaniaApi(testTool, SAMPLE[testTool]) : null;

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
            Veri API'si bağlanmadı. Bu durumda asistan güncel veri istendiğinde kullanıcıya veriye şu an erişemediğini söyler ve değer uydurmaz.
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
          <Panel title="Uç noktalar" description="Temel adrese eklenir. Parametreler sorgu dizesi olarak gönderilir.">
            <div className="grid gap-4">
              {(Object.keys(TOOLS) as ToolId[]).map((t) => (
                <Field key={t} label={TOOLS[t].label} htmlFor={`endpoint_${t}`} hint={`Gönderilen: ${Object.keys(SAMPLE[t]).concat(t === "flight_weather" ? ["departureTime"] : ["lat", "lon"]).join(", ")}`}>
                  <input id={`endpoint_${t}`} name={`endpoint_${t}`} defaultValue={cfg.endpoints[t]} className={`${inputCls} font-mono text-[13px]`} />
                </Field>
              ))}
            </div>
          </Panel>
          <div className="flex justify-end">
            <SubmitButton pendingText="Kaydediliyor…">Kaydet</SubmitButton>
          </div>
        </form>

        <Panel title="Canlı test" description="Örnek parametrelerle bir istek atar ve dönen cevabı gösterir." className="self-start">
          <form className="flex gap-2">
            <select name="test" defaultValue={testTool} className={selectCls} aria-label="Araç">
              {(Object.keys(TOOLS) as ToolId[]).map((t) => (
                <option key={t} value={t}>
                  {TOOLS[t].label}
                </option>
              ))}
            </select>
            <button className={btn("secondary")}>Dene</button>
          </form>
          {result && (
            <div className="mt-4 grid gap-2">
              <div className={result.ok ? "text-sm font-medium text-good" : "text-sm font-medium text-bad"}>{result.ok ? "Başarılı" : "Başarısız"}</div>
              <pre className="max-h-80 overflow-auto rounded-lg bg-sunken p-3 font-mono text-[12px] whitespace-pre-wrap">
                {JSON.stringify(result.ok ? result.data : result.error, null, 2).slice(0, 4000)}
              </pre>
            </div>
          )}
        </Panel>
      </div>
    </>
  );
}
