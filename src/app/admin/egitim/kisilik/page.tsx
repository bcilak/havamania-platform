import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { db } from "@/db";
import { providers } from "@/db/schema";
import { CountedTextarea, SubmitButton } from "@/components/client";
import { checkboxCls, cx, Field, Flash, inputCls, Notice, PageHeader, Panel, selectCls, Tabs, textareaCls } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { getMainBot, getPublishedVersion } from "@/lib/bot";
import { MODE_DISCLAIMERS, MODE_META, MODES, PERSONA_LIMITS, TONES, toneRule, TOOLS, type ToneId, type ToolId } from "@/lib/bot-config";
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
                <CountedTextarea id="guardrails" name="guardrails" rows={6} max={6000} defaultValue={draft.guardrails} className={textareaCls} />
              </Field>
              <Field label="Hata mesajı" htmlFor="fallbackMessage" hint="Model cevap veremediğinde kullanıcıya gösterilir.">
                <input id="fallbackMessage" name="fallbackMessage" defaultValue={draft.fallbackMessage} className={inputCls} />
              </Field>
            </div>
          </Panel>
          <Panel
            title="Yasak konular"
            description={`Asistan bu konularda yardım etmez, kibarca reddeder. Her satıra bir konu (en fazla ${PERSONA_LIMITS.blockedTopics.count} konu, her biri ${PERSONA_LIMITS.blockedTopics.chars} karakter). Genel kuralların sonuna eklenir; sistem kuralları ve sabit uyarılar bundan bağımsız geçerlidir.`}
          >
            <CountedTextarea
              name="blockedTopics"
              rows={4}
              max={2000}
              defaultValue={draft.blockedTopics.join("\n")}
              className={textareaCls}
              aria-label="Yasak konular"
              placeholder={"Örn.\nsiyaset\nyatırım tavsiyesi"}
            />
          </Panel>
          <Panel
            title="Ton metinleri"
            description="Kişilik sekmelerindeki üslup seçeneklerinin asistana verilen metni. Değiştirdiğiniz ton, onu kullanan tüm modları etkiler. Boş bırakmak ya da “varsayılana dön” işaretlemek varsayılan metni geri getirir."
          >
            <div className="grid gap-4">
              {(Object.keys(TONES) as ToneId[]).map((t) => (
                <div key={t} className="grid gap-1.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <label htmlFor={`tone_${t}`} className="text-[13px] font-medium">
                      {TONES[t].label}
                      {draft.toneOverrides[t] ? <span className="ml-2 text-xs font-normal text-warn">düzenlendi</span> : null}
                    </label>
                    <label className="flex items-center gap-1.5 text-xs text-muted">
                      <input type="checkbox" name={`toneReset_${t}`} className={checkboxCls} />
                      Kaydederken varsayılana dön
                    </label>
                  </div>
                  <CountedTextarea id={`tone_${t}`} name={`tone_${t}`} rows={2} max={PERSONA_LIMITS.toneRule} defaultValue={toneRule(draft.toneOverrides, t)} className={textareaCls} />
                  {draft.toneOverrides[t] && <p className="text-xs text-muted">Varsayılan: {TONES[t].rule}</p>}
                </div>
              ))}
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
              <Field
                label="En düşük benzerlik"
                htmlFor="retrievalMinSimilarity"
                hint="0–1 arası. Bunun altında kalan ve kelime eşleşmesi olmayan parçalar asistana verilmez. Başlangıç değeri 0,30; model sağlayıcısı bağlanınca Test alanıyla ayarlayın."
              >
                <input id="retrievalMinSimilarity" name="retrievalMinSimilarity" type="number" step={0.01} min={0} max={1} defaultValue={draft.retrievalMinSimilarity} className={inputCls} />
              </Field>
              <Field
                label="Aramada yok sayılan kelimeler"
                htmlFor="domainStopwords"
                hint="Virgül ya da satırla ayırın. Her soruda geçen kelimeler (hava, durumu…) kelime aramasını anlamsızlaştırır."
              >
                <textarea id="domainStopwords" name="domainStopwords" rows={2} defaultValue={draft.domainStopwords.join(", ")} className={textareaCls} />
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
                <CountedTextarea name="instructions" rows={10} max={12000} defaultValue={m.instructions} className={textareaCls} aria-label="Talimat" />
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
                        <span className="mt-0.5 block text-xs leading-relaxed text-muted">{toneRule(draft.toneOverrides, t)}</span>
                      </span>
                    </label>
                  ))}
                </fieldset>
              </Panel>

              <Panel
                title="Örnek konuşmalar"
                description={`Asistanın üslubunu ve cevap biçimini göstermek için kısa soru-cevap çiftleri (en fazla ${PERSONA_LIMITS.examples.count} çift, her metin ${PERSONA_LIMITS.examples.chars} karakter). Asistana yalnızca biçim rehberi olarak verilir, kuralların yerine geçmez; sayı ve hava verisi yazmayın. Çiftin her iki tarafı da dolu olmalı.`}
              >
                <div className="grid gap-4">
                  {Array.from({ length: Math.min(PERSONA_LIMITS.examples.count, m.examples.length + 1) }, (_, i) => (
                    <div key={i} className="grid gap-3 rounded-lg border border-line p-3 sm:grid-cols-2">
                      <Field label={`Örnek ${i + 1}: kullanıcı`} htmlFor={`exUser${i + 1}`}>
                        <CountedTextarea id={`exUser${i + 1}`} name={`exUser${i + 1}`} rows={3} max={PERSONA_LIMITS.examples.chars} defaultValue={m.examples[i]?.user ?? ""} className={textareaCls} />
                      </Field>
                      <Field label={`Örnek ${i + 1}: asistan`} htmlFor={`exAssistant${i + 1}`}>
                        <CountedTextarea id={`exAssistant${i + 1}`} name={`exAssistant${i + 1}`} rows={3} max={PERSONA_LIMITS.examples.chars} defaultValue={m.examples[i]?.assistant ?? ""} className={textareaCls} />
                      </Field>
                    </div>
                  ))}
                  <p className="text-xs text-muted">Bir örneği silmek için iki alanı da boşaltıp kaydedin. Yeni bir boş çift, kayıttan sonra görünür.</p>
                </div>
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
                      {m.providerId && m.model && !selectedModel && (
                        <p className="text-xs text-warn">Seçili model sağlayıcının listesinde yok; yetenekleri bilinmediği için araç ve görsel kapalı kabul edilir.</p>
                      )}
                      {m.tools.length > 0 && (!selectedModel || !selectedModel.x.tools) && m.providerId && m.model && (
                        <p className="text-xs text-warn">Bu model araç kullanamaz; canlı hava verisi alınamaz.</p>
                      )}
                      <Field label="Yaratıcılık (temperature)" htmlFor="temperature" hint="Düşük değer daha tutarlı ve kısa cevaplar verir. Hava verisi için 0,2–0,4 önerilir.">
                        <input id="temperature" name="temperature" type="number" step={0.1} min={0} max={1} defaultValue={m.temperature} className={`${inputCls} w-28`} />
                      </Field>
                      <Field
                        label="En uzun cevap (token)"
                        htmlFor="maxOutputTokens"
                        hint={`${PERSONA_LIMITS.maxOutputTokens.min}–${PERSONA_LIMITS.maxOutputTokens.max} arası; yaklaşık 1 token ≈ 3–4 karakter. “Kısa ve Net” üslubu için 400 önerilir. Muhakeme (düşünme) yapan bilinen modellerde (o1/o3/o4, gpt-5, “thinking”/“reasoning” adlı modeller) düşünme token'ları da sınıra sayılır; bu modellere gönderilen sınıra otomatik olarak +2048 düşünme payı eklenir (toplam en çok 8000). Cevap yine de boş ya da yarım kalırsa değeri artırın.`}
                      >
                        <input id="maxOutputTokens" name="maxOutputTokens" type="number" step={50} min={PERSONA_LIMITS.maxOutputTokens.min} max={PERSONA_LIMITS.maxOutputTokens.max} defaultValue={m.maxOutputTokens} className={`${inputCls} w-28`} />
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
