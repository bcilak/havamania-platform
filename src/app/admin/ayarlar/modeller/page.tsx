import { Cpu, Plus } from "lucide-react";
import { db } from "@/db";
import { providers, type ProviderKind } from "@/db/schema";
import { ConfirmButton, SubmitButton } from "@/components/client";
import { Badge, checkboxCls, EmptyState, Field, Flash, inputCls, Notice, PageHeader, Panel, selectCls, textareaCls } from "@/components/ui";
import { PROVIDER_KINDS } from "@/lib/ai/providers";
import { requireAdmin } from "@/lib/auth";
import { getMainBot, getPublishedVersion } from "@/lib/bot";
import { MODES } from "@/lib/bot-config";
import { decryptOrNull, maskSecret } from "@/lib/crypto";
import type { SearchParams } from "@/lib/form";
import { getSetting } from "@/lib/settings";
import { createProvider, deleteProvider, reindexNow, runModelTest, saveEmbedding, updateProvider } from "./actions";

export const metadata = { title: "Modeller" };

export default async function ModelsPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdmin("models");
  const sp = await searchParams;
  const list = await db.select().from(providers).orderBy(providers.createdAt);
  const embedding = await getSetting("embedding");
  const bot = await getMainBot();
  const published = await getPublishedVersion(bot);
  const usage = (providerId: string, model: string) =>
    MODES.filter((m) => {
      const d = bot.draftConfig.modes[m];
      const p = published?.config.modes[m];
      return (d.providerId === providerId && d.model === model) || (p?.providerId === providerId && p?.model === model);
    }).map((m) => bot.draftConfig.modes[m].label);
  const embeddable = list.filter((p) => PROVIDER_KINDS[p.kind].embeddings && p.embeddingModels.length);

  return (
    <>
      <PageHeader
        title="Modeller"
        description="Asistanın kullanabileceği yapay zekâ sağlayıcıları. Anahtarlar veritabanında şifreli saklanır. Hangi modun hangi modeli kullanacağını Kişilik ve ton sayfasından seçersiniz."
      />
      <Flash sp={sp} />

      <div className="grid gap-5">
        {list.length === 0 && (
          <div className="rounded-xl border border-line bg-surface">
            <EmptyState icon={Cpu} title="Henüz sağlayıcı yok">
              Aşağıdan Anthropic, OpenAI, Google ya da OpenAI uyumlu bir uç nokta ekleyin. Anahtarı sonra değiştirebilirsiniz.
            </EmptyState>
          </div>
        )}

        {list.map((p) => {
          const kind = PROVIDER_KINDS[p.kind];
          const rows = [...p.models, ...Array.from({ length: 2 }, () => null)];
          return (
            <Panel
              key={p.id}
              id={`p-${p.id}`}
              title={
                <span className="flex items-center gap-2">
                  {p.name} <Badge>{kind.label}</Badge>
                </span>
              }
              description={`Anahtar ${maskSecret(decryptOrNull(p.apiKeyEnc)) || "girilmemiş"}${p.baseUrl ? ` · ${p.baseUrl}` : ""}`}
              actions={
                <form action={deleteProvider}>
                  <input type="hidden" name="id" value={p.id} />
                  <ConfirmButton confirmText="Sağlayıcı silinsin mi?">Sil</ConfirmButton>
                </form>
              }
            >
              <form action={updateProvider} className="grid gap-4">
                <input type="hidden" name="id" value={p.id} />
                <div className="grid gap-4 sm:grid-cols-3">
                  <Field label="Görünen ad" htmlFor={`n-${p.id}`}>
                    <input id={`n-${p.id}`} name="name" defaultValue={p.name} className={inputCls} />
                  </Field>
                  <Field label="Yeni API anahtarı" htmlFor={`k-${p.id}`} hint="Boş bırakırsanız mevcut anahtar korunur.">
                    <input id={`k-${p.id}`} name="apiKey" type="password" autoComplete="off" placeholder={kind.keyHint} className={inputCls} />
                  </Field>
                  <Field label="Temel adres (base URL)" htmlFor={`b-${p.id}`} hint={kind.needsBaseUrl ? "Zorunlu." : "İsteğe bağlı; proxy kullanıyorsanız."}>
                    <input id={`b-${p.id}`} name="baseUrl" defaultValue={p.baseUrl ?? ""} placeholder="https://…" className={inputCls} />
                  </Field>
                </div>

                <div className="overflow-x-auto rounded-lg border border-line">
                  <table className="w-full min-w-[760px] text-sm">
                    <thead className="bg-sunken text-left text-[11.5px] font-semibold tracking-wide text-muted uppercase">
                      <tr>
                        <th className="px-3 py-2">Model kimliği</th>
                        <th className="px-3 py-2">Görünen ad</th>
                        <th className="px-3 py-2 text-center">Görsel</th>
                        <th className="px-3 py-2 text-center">Araç</th>
                        <th className="px-3 py-2">Girdi $/1M</th>
                        <th className="px-3 py-2">Çıktı $/1M</th>
                        <th className="px-3 py-2">Kullanan</th>
                        <th className="px-3 py-2 text-center">Kaldır</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((m, i) => (
                        <tr key={i} className="border-t border-line">
                          <td className="px-3 py-2">
                            <input name={`models.${i}.id`} defaultValue={m?.id ?? ""} placeholder={m ? "" : "yeni model kimliği"} aria-label="Model kimliği" className={`${inputCls} h-8 font-mono text-[13px]`} />
                          </td>
                          <td className="px-3 py-2">
                            <input name={`models.${i}.label`} defaultValue={m?.label ?? ""} aria-label="Görünen ad" className={`${inputCls} h-8`} />
                          </td>
                          <td className="px-3 py-2 text-center">
                            <input type="checkbox" name={`models.${i}.vision`} defaultChecked={m?.vision ?? true} className={checkboxCls} aria-label="Görsel desteği" />
                          </td>
                          <td className="px-3 py-2 text-center">
                            <input type="checkbox" name={`models.${i}.tools`} defaultChecked={m?.tools ?? true} className={checkboxCls} aria-label="Araç desteği" />
                          </td>
                          <td className="px-3 py-2">
                            <input name={`models.${i}.inputPer1M`} defaultValue={m?.inputPer1M ?? 0} inputMode="decimal" aria-label="Girdi fiyatı" className={`${inputCls} tabular h-8 w-24`} />
                          </td>
                          <td className="px-3 py-2">
                            <input name={`models.${i}.outputPer1M`} defaultValue={m?.outputPer1M ?? 0} inputMode="decimal" aria-label="Çıktı fiyatı" className={`${inputCls} tabular h-8 w-24`} />
                          </td>
                          <td className="px-3 py-2 text-xs text-muted">{m ? usage(p.id, m.id).join(", ") || "—" : ""}</td>
                          <td className="px-3 py-2 text-center">
                            {m && <input type="checkbox" name={`models.${i}.remove`} className={checkboxCls} aria-label="Kaldır" />}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-xs text-muted">
                  Fiyatlar yalnızca panodaki maliyet takibi içindir; sağlayıcınızın güncel fiyat sayfasından girin. Bilinmiyorsa 0 bırakın.
                </p>
                {kind.embeddings && (
                  <Field label="Embedding modelleri" htmlFor={`e-${p.id}`} hint="Virgülle ya da satır satır. Bilgi tabanı vektör araması için.">
                    <textarea id={`e-${p.id}`} name="embeddingModels" rows={2} defaultValue={p.embeddingModels.join("\n")} className={`${textareaCls} font-mono text-[13px]`} />
                  </Field>
                )}
                <div className="flex justify-end">
                  <SubmitButton pendingText="Kaydediliyor…">Kaydet</SubmitButton>
                </div>
              </form>

              {p.models.length > 0 && (
                <form action={runModelTest} className="mt-4 flex flex-wrap items-end gap-2 border-t border-line pt-4">
                  <input type="hidden" name="id" value={p.id} />
                  <Field label="Bağlantıyı test et" htmlFor={`t-${p.id}`}>
                    <select id={`t-${p.id}`} name="model" className={`${selectCls} w-auto`}>
                      {p.models.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <SubmitButton variant="secondary" pendingText="Deneniyor…">
                    Test et
                  </SubmitButton>
                </form>
              )}
            </Panel>
          );
        })}

        <Panel title="Sağlayıcı ekle" description="Anthropic eklendiğinde Claude modelleri hazır gelir; diğerlerinde model kimliklerini siz girersiniz.">
          <form action={createProvider} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Tür" htmlFor="kind">
              <select id="kind" name="kind" required className={selectCls}>
                {(Object.keys(PROVIDER_KINDS) as ProviderKind[]).map((k) => (
                  <option key={k} value={k}>
                    {PROVIDER_KINDS[k].label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Görünen ad" htmlFor="name">
              <input id="name" name="name" placeholder="Örn. Anthropic – canlı" className={inputCls} />
            </Field>
            <Field label="API anahtarı" htmlFor="apiKey">
              <input id="apiKey" name="apiKey" type="password" autoComplete="off" required className={inputCls} />
            </Field>
            <Field label="Temel adres" htmlFor="baseUrl" hint="Yalnızca uyumlu uç noktalar için.">
              <input id="baseUrl" name="baseUrl" placeholder="https://…/v1" className={inputCls} />
            </Field>
            <div className="sm:col-span-2 lg:col-span-4">
              <SubmitButton pendingText="Ekleniyor…">
                <Plus className="size-4" /> Ekle
              </SubmitButton>
            </div>
          </form>
        </Panel>

        <Panel
          id="embedding"
          title="Bilgi tabanı araması (embedding)"
          description="Seçilirse arama, Türkçe tam metin aramasına ek olarak anlam benzerliğiyle de yapılır. Anthropic embedding modeli sunmaz; OpenAI, Google ya da uyumlu bir uç nokta gerekir."
        >
          <div className="mb-4">
            <Notice tone="warn">
              Embedding modelini değiştirmek tüm bilgi tabanının yeniden işlenmesi demektir; eski vektörler yeni modelle karşılaştırılamaz. Değiştirdiğinizde bu otomatik başlar.
            </Notice>
          </div>
          <form action={saveEmbedding} className="flex flex-wrap items-end gap-2">
            <Field label="Model" htmlFor="embedding" className="min-w-64">
              <select id="embedding" name="embedding" defaultValue={embedding.providerId && embedding.model ? `${embedding.providerId}::${embedding.model}` : ""} className={selectCls}>
                <option value="">Kullanma (yalnızca tam metin araması)</option>
                {embeddable.map((p) => (
                  <optgroup key={p.id} label={p.name}>
                    {p.embeddingModels.map((m) => (
                      <option key={m} value={`${p.id}::${m}`}>
                        {m}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </Field>
            <SubmitButton pendingText="Kaydediliyor…">Kaydet</SubmitButton>
          </form>
          {embedding.model && (
            <form action={reindexNow} className="mt-3">
              <ConfirmButton variant="secondary" confirmText="Tüm kaynaklar yeniden işlensin mi?">
                Şimdi yeniden indeksle
              </ConfirmButton>
            </form>
          )}
        </Panel>
      </div>
    </>
  );
}
