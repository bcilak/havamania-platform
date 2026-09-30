import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { db } from "@/db";
import { providers } from "@/db/schema";
import { SubmitButton } from "@/components/client";
import { checkboxCls, cx, Field, Flash, inputCls, Notice, PageHeader, Panel, selectCls, Tabs, textareaCls } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { getMainBot, getPublishedVersion } from "@/lib/bot";
import { MODE_DISCLAIMERS, MODE_META, MODES, TONES, TOOLS, type ToneId, type ToolId } from "@/lib/bot-config";
import { param, type SearchParams } from "@/lib/form";
import type { ChatMode } from "@/db/schema";
import { saveMode, saveRules } from "./actions";

export const metadata = { title: "Kişilik ve ton" };

export default async function PersonaPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdmin("training");
  const sp = await searchParams;
  const tab = param(sp, "mod") || "genel";
  const bot = await getMainBot();
  const published = await getPublishedVersion(bot);
  const draft = bot.draftConfig;
  const dirty = !published || JSON.stringify(published.config) !== JSON.stringify(draft);
  const provs = await db.select().from(providers).orderBy(providers.createdAt);

  return (
    <>
      <PageHeader
        title="Kişilik ve ton"
        description="Her mod için asistanın ne yapacağını, nasıl konuşacağını, hangi modeli ve hangi veri araçlarını kullanacağını belirleyin."
      />
      <Flash sp={sp} />
      {dirty && (
        <div className="mb-5">
          <Notice>
            Taslakta yayınlanmamış değişiklikler var. Kullanıcılar hâlâ {published ? `v${published.number}` : "hiçbir sürümü"} görüyor.{" "}
            <Link href="/admin/egitim/test" className="font-medium text-accent underline">
              Test alanında dene
            </Link>{" "}
            ·{" "}
            <Link href="/admin/yayin" className="font-medium text-accent underline">
              Yayınla
            </Link>
          </Notice>
        </div>
      )}
      <Tabs
        items={[
          ...MODES.map((m) => ({ href: `/admin/egitim/kisilik?mod=${m}`, label: MODE_META[m].label, active: tab === m })),
          { href: "/admin/egitim/kisilik?mod=kurallar", label: "Ortak kurallar ve sınırlar", active: tab === "kurallar" },
        ]}
      />

      {tab === "kurallar" ? (
        <form action={saveRules} className="grid gap-5">
          <Panel title="Ortak kurallar" description="Tüm modlarda talimat metninin sonuna eklenir.">
            <div className="grid gap-4">
              <Field label="Kurallar" htmlFor="guardrails">
                <textarea id="guardrails" name="guardrails" rows={6} defaultValue={draft.guardrails} className={textareaCls} />
              </Field>
              <Field label="Hata mesajı" htmlFor="fallbackMessage" hint="Model cevap veremediğinde kullanıcıya gösterilir.">
                <input id="fallbackMessage" name="fallbackMessage" defaultValue={draft.fallbackMessage} className={inputCls} />
              </Field>
            </div>
          </Panel>
          <Panel title="Sınırlar">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Hafıza (son mesaj sayısı)" htmlFor="historyWindow" hint="Modele gönderilen geçmiş. Uzadıkça maliyet artar.">
                <input id="historyWindow" name="historyWindow" type="number" min={2} max={40} defaultValue={draft.historyWindow} className={inputCls} />
              </Field>
              <Field label="Kullanıcı başına günlük mesaj" htmlFor="maxMessagesPerDay" hint="0 = sınırsız.">
                <input id="maxMessagesPerDay" name="maxMessagesPerDay" type="number" min={0} defaultValue={draft.maxMessagesPerDay} className={inputCls} />
              </Field>
              <Field label="Bilgi tabanından alınan parça" htmlFor="retrievalTopK">
                <input id="retrievalTopK" name="retrievalTopK" type="number" min={1} max={15} defaultValue={draft.retrievalTopK} className={inputCls} />
              </Field>
              <Field label="Fotoğraf boyutu sınırı (MB)" htmlFor="maxPhotoMb">
                <input id="maxPhotoMb" name="maxPhotoMb" type="number" min={1} max={20} defaultValue={draft.maxPhotoMb} className={inputCls} />
              </Field>
              <label className="flex items-center gap-2.5 self-end pb-2 text-sm">
                <input type="checkbox" name="photosEnabled" defaultChecked={draft.photosEnabled} className={checkboxCls} />
                Kullanıcılar fotoğraf gönderebilir
              </label>
            </div>
          </Panel>
          <div className="flex justify-end">
            <SubmitButton pendingText="Kaydediliyor…">Taslağa kaydet</SubmitButton>
          </div>
        </form>
      ) : MODES.includes(tab as ChatMode) ? (
        (() => {
          const mode = tab as ChatMode;
          const m = draft.modes[mode];
          const selectedModel = provs.flatMap((p) => p.models.map((x) => ({ p, x }))).find(({ p, x }) => p.id === m.providerId && x.id === m.model);
          return (
            <form action={saveMode} className="grid gap-5">
              <input type="hidden" name="modeId" value={mode} />
              <Panel title="Genel">
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="flex items-center gap-2.5 text-sm sm:col-span-2">
                    <input type="checkbox" name="enabled" defaultChecked={m.enabled} className={checkboxCls} />
                    Bu mod kullanıcılara açık
                  </label>
                  <Field label="Asistanın adı" htmlFor="label">
                    <input id="label" name="label" defaultValue={m.label} className={inputCls} />
                  </Field>
                  <Field label="Karşılama mesajı" htmlFor="greeting">
                    <input id="greeting" name="greeting" defaultValue={m.greeting} className={inputCls} />
                  </Field>
                  <Field label="Önerilen sorular" htmlFor="suggestions" hint="Her satıra bir soru, en fazla 4. Boş sohbet ekranında düğme olarak görünür." className="sm:col-span-2">
                    <textarea id="suggestions" name="suggestions" rows={3} defaultValue={m.suggestions.join("\n")} className={textareaCls} />
                  </Field>
                </div>
              </Panel>

              <Panel title="Talimat" description="Asistanın rolü, bilmesi gerekenler ve kaçınması gerekenler. Ortak kurallar ve üslup bunun sonuna eklenir.">
                <textarea name="instructions" rows={10} defaultValue={m.instructions} className={textareaCls} aria-label="Talimat" />
                {MODE_DISCLAIMERS[mode] && (
                  <div className="mt-3 flex items-start gap-2 rounded-lg bg-sunken px-3 py-2.5 text-[13px]">
                    <ShieldCheck className="mt-0.5 size-4 shrink-0 text-muted" />
                    <span>
                      <strong>Sabit uyarı (kodda):</strong> {MODE_DISCLAIMERS[mode]} Her cevabın altında gösterilir ve panelden kaldırılamaz.
                    </span>
                  </div>
                )}
              </Panel>

              <Panel title="Üslup">
                <fieldset className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  <legend className="sr-only">Ton</legend>
                  {(Object.keys(TONES) as ToneId[]).map((t) => (
                    <label key={t} className="flex cursor-pointer gap-2.5 rounded-lg border border-line p-3 has-checked:border-accent has-checked:bg-accent-soft">
                      <input type="radio" name="tone" value={t} defaultChecked={m.tone === t} className="mt-0.5 accent-[var(--color-accent)]" />
                      <span>
                        <span className="block text-sm font-medium">{TONES[t].label}</span>
                        <span className="mt-0.5 block text-xs leading-relaxed text-muted">{TONES[t].rule}</span>
                      </span>
                    </label>
                  ))}
                </fieldset>
              </Panel>

              <div className="grid gap-5 lg:grid-cols-2">
                <Panel title="Model">
                  {provs.length ? (
                    <div className="grid gap-4">
                      <Field label="Yapay zekâ modeli" htmlFor="model">
                        <select id="model" name="model" defaultValue={m.providerId && m.model ? `${m.providerId}::${m.model}` : ""} className={selectCls}>
                          <option value="">Seçilmedi</option>
                          {provs.map((p) => (
                            <optgroup key={p.id} label={p.name}>
                              {p.models.map((x) => (
                                <option key={x.id} value={`${p.id}::${x.id}`}>
                                  {x.label}
                                  {!x.vision ? " · görsel yok" : ""}
                                  {!x.tools ? " · araç yok" : ""}
                                </option>
                              ))}
                            </optgroup>
                          ))}
                        </select>
                      </Field>
                      {selectedModel && !selectedModel.x.vision && <p className="text-xs text-warn">Bu model fotoğrafları göremez; kullanıcıya bunu söyler.</p>}
                      <Field label="Yaratıcılık (temperature)" htmlFor="temperature" hint="Düşük değer daha tutarlı ve kısa cevaplar verir. Hava verisi için 0,2–0,4 önerilir.">
                        <input id="temperature" name="temperature" type="number" step={0.1} min={0} max={1} defaultValue={m.temperature} className={`${inputCls} w-28`} />
                      </Field>
                    </div>
                  ) : (
                    <p className="text-sm text-muted">
                      Henüz model sağlayıcısı eklenmedi.{" "}
                      <Link href="/admin/ayarlar/modeller" className="font-medium text-accent underline">
                        Modeller sayfasından ekleyin
                      </Link>
                      .
                    </p>
                  )}
                </Panel>
                <Panel title="Canlı veri araçları" description="Asistan güncel veri gerektiğinde bunları kendisi çağırır.">
                  <div className="grid gap-2">
                    {(Object.keys(TOOLS) as ToolId[]).map((t) => (
                      <label key={t} className={cx("flex gap-2.5 rounded-lg p-2 text-sm hover:bg-sunken")}>
                        <input type="checkbox" name="tools" value={t} defaultChecked={m.tools.includes(t)} className={`${checkboxCls} mt-0.5`} />
                        <span>
                          <span className="block font-medium">{TOOLS[t].label}</span>
                          <span className="block text-xs text-muted">{TOOLS[t].description}</span>
                        </span>
                      </label>
                    ))}
                    <p className="mt-1 text-xs text-muted">
                      Araçlar{" "}
                      <Link href="/admin/ayarlar/entegrasyon" className="text-accent underline">
                        Havamania veri API
                      </Link>{" "}
                      ayarından beslenir.
                    </p>
                  </div>
                </Panel>
              </div>

              <div className="flex justify-end">
                <SubmitButton pendingText="Kaydediliyor…">Taslağa kaydet</SubmitButton>
              </div>
            </form>
          );
        })()
      ) : null}
    </>
  );
}
