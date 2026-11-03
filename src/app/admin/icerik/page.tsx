import { ExternalLink } from "lucide-react";
import { ConfirmButton, SubmitButton } from "@/components/client";
import { Badge, btn, Field, Flash, inputCls, Notice, PageHeader, Panel, selectCls, Tabs, textareaCls } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { LANDING_ICONS, resolveIcon } from "@/lib/cms/icons";
import { getLanding, getLandingDoc } from "@/lib/cms/store";
import { defaultLandingContent, SCENE_META, type LandingContent } from "@/lib/cms/schema";
import { param, type SearchParams } from "@/lib/form";
import { fmtDateTime } from "@/lib/format";
import { discardDraft, publishLanding, saveSection } from "./actions";

export const metadata = { title: "Site sayfaları" };

const SECTIONS = [
  { id: "genel", label: "Genel ve hero" },
  { id: "core", label: "Panel sahnesi" },
  { id: "seyahat", label: "Seyahat" },
  { id: "enerji", label: "Enerji" },
  { id: "ucus", label: "Uçuş" },
  { id: "yol", label: "Yol haritası ve erken erişim" },
  { id: "asistan", label: "Asistan" },
  { id: "premium", label: "Premium ve alt bilgi" },
];

const STAGES = ["Parçalar dağılırken", "Parçalar birleşirken ve 1. ekranda", "2. ekranda", "3. ekranda (asistan)"];

const ROADMAP_STATES = [
  { value: "live", label: "Yayında" },
  { value: "soon", label: "Yakında" },
  { value: "planned", label: "Planlanıyor" },
  { value: "vision", label: "Vizyon" },
];

function Input({ name, value, label, max, className }: { name: string; value: string; label?: string; max?: number; className?: string }) {
  return (
    <input name={name} defaultValue={value} maxLength={max} aria-label={label ?? name} className={`${inputCls} ${className ?? ""}`} />
  );
}

/** Etiketli tek satırlık (ya da `rows` verilirse çok satırlı) metin alanı. */
function Txt({ id, name, label, value, max, rows, hint, className }: { id: string; name: string; label: string; value: string; max: number; rows?: number; hint?: string; className?: string }) {
  return (
    <Field label={label} htmlFor={id} hint={hint} className={className}>
      {rows ? (
        <textarea id={id} name={name} rows={rows} defaultValue={value} maxLength={max} className={textareaCls} />
      ) : (
        <input id={id} name={name} defaultValue={value} maxLength={max} className={inputCls} />
      )}
    </Field>
  );
}

/** Madde listesi: üst sınıra kadar boş satırla doldurulur; boş satırlar kaydedilirken atılır. */
function ListInputs({ name, values, size, max, label }: { name: string; values: string[]; size: number; max: number; label: string }) {
  const rows = [...values, ...Array.from({ length: Math.max(0, size - values.length) }, () => "")];
  return (
    <div className="grid gap-1.5">
      {rows.map((v, i) => (
        <Input key={i} name={`${name}.${i}`} value={v} label={`${label} ${i + 1}`} max={max} />
      ))}
    </div>
  );
}

/** Simgeli kart listesi (özellik ızgarası, uçuş analizleri). Boş başlık+metin satırları gösterilmez. */
function IconCards({ name, items, size, titleMax, textMax }: { name: string; items: { icon: string; title: string; text: string }[]; size: number; titleMax: number; textMax: number }) {
  const rows = [...items, ...Array.from({ length: Math.max(0, size - items.length) }, () => ({ icon: "sparkles", title: "", text: "" }))];
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {rows.map((c, i) => (
        <fieldset key={i} className="grid grid-cols-[minmax(0,10rem)_1fr] gap-2 rounded-lg border border-line p-3">
          <legend className="px-1 text-xs text-muted">{i + 1}. kart</legend>
          <IconSelect name={`${name}.${i}.icon`} value={c.icon} label="Simge" />
          <Input name={`${name}.${i}.title`} value={c.title} label="Başlık" max={titleMax} />
          <Input name={`${name}.${i}.text`} value={c.text} label="Metin" className="col-span-2" max={textMax} />
        </fieldset>
      ))}
    </div>
  );
}

/** Enerji bölümündeki Solar / Wind kartı. */
function EnergyEditor({ name, card, title }: { name: "energy.solar" | "energy.wind"; card: LandingContent["energy"]["solar"]; title: string }) {
  const id = name.replace(".", "-");
  return (
    <Panel title={title} description="Her liste en çok 6 madde; boş satırlar gösterilmez.">
      <div className="grid gap-4">
        <div className="grid grid-cols-[minmax(0,10rem)_1fr] gap-2">
          <IconSelect name={`${name}.icon`} value={card.icon} label="Simge" />
          <Input name={`${name}.title`} value={card.title} label="Başlık" max={40} />
        </div>
        <Txt id={`${id}-x`} name={`${name}.text`} label="Açıklama" value={card.text} max={160} rows={3} />
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="grid gap-1.5">
            <div className="text-[13px] font-medium">Analiz edilen veriler</div>
            <ListInputs name={`${name}.data`} values={card.data} size={6} max={60} label="Veri" />
          </div>
          <div className="grid gap-1.5">
            <div className="text-[13px] font-medium">Kullanım alanları</div>
            <ListInputs name={`${name}.uses`} values={card.uses} size={6} max={60} label="Kullanım alanı" />
          </div>
          <div className="grid gap-1.5">
            <div className="text-[13px] font-medium">Neye yardımcı olur</div>
            <ListInputs name={`${name}.benefits`} values={card.benefits} size={6} max={80} label="Fayda" />
          </div>
        </div>
      </div>
    </Panel>
  );
}

/** Landing simgeleri her cihazda aynı görünsün diye emoji yerine simge seti kullanılır. */
function IconSelect({ name, value, label, className }: { name: string; value: string; label: string; className?: string }) {
  const current = resolveIcon(value);
  return (
    <select name={name} defaultValue={current ?? value} aria-label={label} className={`${selectCls} ${className ?? ""}`}>
      {!current && value && <option value={value}>{value} (eski)</option>}
      {Object.entries(LANDING_ICONS).map(([key, icon]) => (
        <option key={key} value={key}>
          {icon.label}
        </option>
      ))}
    </select>
  );
}

function SceneEditor({ s, accent }: { s: LandingContent["scenes"]["core"]; accent: string }) {
  const cards = [...s.screen2.cards, ...Array.from({ length: 4 - s.screen2.cards.length }, () => ({ title: "", text: "" }))];
  const bubbles = [...s.screen3.bubbles, ...Array.from({ length: 6 - s.screen3.bubbles.length }, () => ({ from: "ai" as const, text: "" }))];
  return (
    <div className="grid gap-5">
      <Panel title="Başlıklar" description="Kaydırırken sırayla görünen 4 başlık. Sayı sabittir; animasyonun aşamalarına bağlıdır.">
        <div className="grid gap-4">
          {s.captions.map((c, i) => (
            <fieldset key={i} className="grid gap-2 rounded-lg border border-line p-3 sm:grid-cols-[180px_1fr_1fr_1fr] sm:items-center">
              <legend className="sr-only">{STAGES[i]}</legend>
              <div className="text-[13px] text-muted">
                <span className="mr-1.5 inline-block size-2 rounded-full" style={{ background: accent }} />
                {i + 1}. {STAGES[i]}
              </div>
              <Input name={`scene.captions.${i}.eyebrow`} value={c.eyebrow} label="Üst etiket" max={60} />
              <Input name={`scene.captions.${i}.title`} value={c.title} label="Başlık" max={80} />
              <Input name={`scene.captions.${i}.sub`} value={c.sub} label="Alt metin" max={140} />
            </fieldset>
          ))}
        </div>
      </Panel>

      <Panel title="Veri çipleri ve 1. ekran hücreleri" description="Her çip, aynı satırdaki telefon hücresine uçar. 6 satır sabittir.">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="text-left text-[11.5px] font-semibold tracking-wide text-muted uppercase">
              <tr>
                <th className="pb-2">#</th>
                <th className="pb-2">Simge</th>
                <th className="pb-2">Çip etiketi</th>
                <th className="pb-2">Değer</th>
                <th className="pb-2">Birim</th>
                <th className="border-l border-line pb-2 pl-3">Hücre etiketi</th>
                <th className="pb-2">Değer</th>
                <th className="pb-2">Birim</th>
              </tr>
            </thead>
            <tbody>
              {s.chips.map((c, i) => (
                <tr key={i}>
                  <td className="tabular pr-2 text-muted">{i + 1}</td>
                  <td className="py-1 pr-2"><IconSelect name={`scene.chips.${i}.icon`} value={c.icon} label="Simge" className="w-40" /></td>
                  <td className="py-1 pr-2"><Input name={`scene.chips.${i}.label`} value={c.label} label="Çip etiketi" max={30} /></td>
                  <td className="py-1 pr-2"><Input name={`scene.chips.${i}.value`} value={c.value} label="Çip değeri" className="w-20" max={14} /></td>
                  <td className="py-1 pr-2"><Input name={`scene.chips.${i}.unit`} value={c.unit} label="Çip birimi" max={30} /></td>
                  <td className="border-l border-line py-1 pr-2 pl-3"><Input name={`scene.screen1.slots.${i}.label`} value={s.screen1.slots[i].label} label="Hücre etiketi" max={20} /></td>
                  <td className="py-1 pr-2"><Input name={`scene.screen1.slots.${i}.value`} value={s.screen1.slots[i].value} label="Hücre değeri" className="w-20" max={12} /></td>
                  <td className="py-1"><Input name={`scene.screen1.slots.${i}.unit`} value={s.screen1.slots[i].unit} label="Hücre birimi" max={20} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <div className="grid gap-5 lg:grid-cols-3">
        <Panel title="1. ekran">
          <div className="grid gap-3">
            <Field label="Konum satırı" htmlFor="s1l"><input id="s1l" name="scene.screen1.location" defaultValue={s.screen1.location} maxLength={50} className={inputCls} /></Field>
            <Field label="Büyük değer" htmlFor="s1t"><input id="s1t" name="scene.screen1.temp" defaultValue={s.screen1.temp} maxLength={8} className={inputCls} /></Field>
            <Field label="Durum" htmlFor="s1c"><input id="s1c" name="scene.screen1.condition" defaultValue={s.screen1.condition} maxLength={60} className={inputCls} /></Field>
          </div>
        </Panel>
        <Panel title="2. ekran" description="Halka isteğe bağlı: değer boşsa gösterilmez.">
          <div className="grid gap-3">
            <Field label="Üst satır" htmlFor="s2h"><input id="s2h" name="scene.screen2.header" defaultValue={s.screen2.header} maxLength={50} className={inputCls} /></Field>
            <div className="grid grid-cols-3 gap-2">
              <Field label="Halka değeri" htmlFor="s2rv"><input id="s2rv" name="scene.screen2.ringValue" defaultValue={s.screen2.ringValue} maxLength={6} className={inputCls} /></Field>
              <Field label="Etiket" htmlFor="s2rl"><input id="s2rl" name="scene.screen2.ringLabel" defaultValue={s.screen2.ringLabel} maxLength={16} className={inputCls} /></Field>
              <Field label="Doluluk %" htmlFor="s2rp"><input id="s2rp" name="scene.screen2.ringPercent" type="number" min={0} max={100} defaultValue={s.screen2.ringPercent} className={inputCls} /></Field>
            </div>
            <Field label="Başlık" htmlFor="s2t"><input id="s2t" name="scene.screen2.title" defaultValue={s.screen2.title} maxLength={40} className={inputCls} /></Field>
            <Field label="Not" htmlFor="s2n"><input id="s2n" name="scene.screen2.note" defaultValue={s.screen2.note} maxLength={120} className={inputCls} /></Field>
            <div className="grid gap-2">
              <div className="text-[13px] font-medium">Kartlar (1–4, boş olanlar gösterilmez)</div>
              {cards.map((c, i) => (
                <div key={i} className="grid gap-1.5 rounded-lg border border-line p-2">
                  <Input name={`scene.screen2.cards.${i}.title`} value={c.title} label={`${i + 1}. kart başlığı`} max={40} />
                  <Input name={`scene.screen2.cards.${i}.text`} value={c.text} label={`${i + 1}. kart metni`} max={140} />
                </div>
              ))}
            </div>
          </div>
        </Panel>
        <Panel title="3. ekran: asistan sohbeti" description="2–6 mesaj. Boş olanlar gösterilmez.">
          <div className="grid gap-3">
            <Field label="Üst satır" htmlFor="s3h"><input id="s3h" name="scene.screen3.header" defaultValue={s.screen3.header} maxLength={40} className={inputCls} /></Field>
            {bubbles.map((b, i) => (
              <div key={i} className="grid grid-cols-[92px_1fr] gap-1.5">
                <select name={`scene.screen3.bubbles.${i}.from`} defaultValue={b.from} aria-label={`${i + 1}. mesajı yazan`} className={selectCls}>
                  <option value="ai">Asistan</option>
                  <option value="me">Kullanıcı</option>
                </select>
                <Input name={`scene.screen3.bubbles.${i}.text`} value={b.text} label={`${i + 1}. mesaj`} max={160} />
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}

export default async function CmsPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdmin("cms");
  const sp = await searchParams;
  // Eski bağlantı: "Modlar ve Asistan" sekmesi (bolumler) artık yalnızca Asistan.
  const requested = param(sp, "bolum") === "bolumler" ? "asistan" : param(sp, "bolum");
  const section = SECTIONS.some((s) => s.id === requested) ? requested : "genel";
  const doc = await getLandingDoc();
  // Okurken güncel biçime dönüştürülmüş taslak (eski emoji simgeleri, eski varsayılan metinler).
  const draft: LandingContent = doc ? await getLanding("draft") : defaultLandingContent();
  const dirty = !doc?.published || JSON.stringify(doc.draft) !== JSON.stringify(doc.published);

  return (
    <>
      <PageHeader
        title="Site sayfaları"
        description="Havamania landing sayfasının metinleri. Değişiklikler taslağa kaydedilir; önizleyip yayınladığınızda sitede görünür."
        actions={
          <>
            <a href="/?onizleme=1" target="_blank" className={btn("secondary")}>
              <ExternalLink className="size-4" /> Taslağı önizle
            </a>
            <form action={publishLanding}>
              <SubmitButton pendingText="Yayınlanıyor…">Yayınla</SubmitButton>
            </form>
          </>
        }
      />
      <Flash sp={sp} />
      <div className="mb-5 flex flex-wrap items-center gap-3 text-sm text-muted">
        {dirty ? <Badge tone="warn">Yayınlanmamış değişiklik var</Badge> : <Badge tone="good">Taslak yayındakiyle aynı</Badge>}
        <span>Son yayın: {fmtDateTime(doc?.publishedAt)}{doc?.publishedBy ? ` · ${doc.publishedBy}` : ""}</span>
        {dirty && doc?.published && (
          <form action={discardDraft} className="ml-auto">
            <ConfirmButton variant="ghost" confirmText="Taslaktaki değişiklikler silinsin mi?">
              Taslağı geri al
            </ConfirmButton>
          </form>
        )}
      </div>
      <Tabs items={SECTIONS.map((s) => ({ href: `/admin/icerik?bolum=${s.id}`, label: s.label, active: section === s.id }))} />

      <form action={saveSection} className="grid gap-5">
        <input type="hidden" name="section" value={section} />

        {section === "genel" && (
          <>
            <Panel title="Arama motorları ve paylaşım">
              <div className="grid gap-4">
                <Field label="Sayfa başlığı" htmlFor="seo-title" hint="En fazla 70 karakter.">
                  <input id="seo-title" name="seo.title" defaultValue={draft.seo.title} maxLength={70} className={inputCls} />
                </Field>
                <Field label="Açıklama" htmlFor="seo-desc" hint="En fazla 170 karakter. Google sonuçlarında görünür.">
                  <textarea id="seo-desc" name="seo.description" rows={2} defaultValue={draft.seo.description} maxLength={170} className={textareaCls} />
                </Field>
                <Field label="Paylaşım görseli adresi" htmlFor="seo-og" hint="Medya kütüphanesinden bir görselin bağlantısını yapıştırın. 1200×630 önerilir.">
                  <input id="seo-og" name="seo.ogImage" defaultValue={draft.seo.ogImage} className={inputCls} placeholder="/api/media/…" />
                </Field>
              </div>
            </Panel>
            <Panel title="Hero">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Üst etiket" htmlFor="h-k"><input id="h-k" name="hero.kicker" defaultValue={draft.hero.kicker} maxLength={40} className={inputCls} /></Field>
                <Field label="Menüdeki buton" htmlFor="n-cta"><input id="n-cta" name="nav.ctaLabel" defaultValue={draft.nav.ctaLabel} maxLength={20} className={inputCls} /></Field>
                <Field label="Başlık" htmlFor="h-t" className="sm:col-span-2"><input id="h-t" name="hero.title" defaultValue={draft.hero.title} maxLength={90} className={inputCls} /></Field>
                <Field label="Alt metin" htmlFor="h-s" className="sm:col-span-2"><textarea id="h-s" name="hero.subtitle" rows={2} defaultValue={draft.hero.subtitle} maxLength={220} className={textareaCls} /></Field>
                <Field label="Kaydırma ipucu" htmlFor="h-h"><input id="h-h" name="hero.hint" defaultValue={draft.hero.hint} maxLength={30} className={inputCls} /></Field>
              </div>
            </Panel>
          </>
        )}

        {section === "core" && (
          <>
            <Notice>
              {SCENE_META.core.label}: parçalar telefondan dışarı savrulur, geri toplanıp hücrelere oturur, ardından telefon ekranı 3 kez kayar. Satır sayıları bu yüzden sabittir.
            </Notice>
            <SceneEditor s={draft.scenes.core} accent={SCENE_META.core.accent} />
          </>
        )}

        {section === "seyahat" && (
          <>
            <Panel title="Akıllı Güzergâh Takibi" description="Panel sahnesinden sonra gelen ilk bölüm. Menüdeki “Seyahat” bağlantısı buraya gider.">
              <div className="grid gap-4 sm:grid-cols-2">
                <Txt id="rt-e" name="route.eyebrow" label="Üst etiket" value={draft.route.eyebrow} max={40} />
                <Txt id="rt-t" name="route.title" label="Başlık" value={draft.route.title} max={80} />
                <Txt id="rt-x" name="route.text" label="Metin" value={draft.route.text} max={260} rows={3} className="sm:col-span-2" />
                <div className="grid gap-1.5 sm:col-span-2">
                  <div className="text-[13px] font-medium">Maddeler (en çok 4; boş olanlar gösterilmez)</div>
                  <ListInputs name="route.bullets" values={draft.route.bullets} size={4} max={100} label="Madde" />
                </div>
              </div>
            </Panel>
            <Panel title="Örnek ekran kartı" description="Rakamlı örnektir; sitede “Örnek ekran” etiketiyle gösterilir. Gerçek veri değildir. 4 durak sabittir.">
              <div className="grid gap-4">
                <div className="grid gap-4 sm:grid-cols-3">
                  <Txt id="sm-l" name="route.sample.label" label="Etiket" value={draft.route.sample.label} max={20} />
                  <Txt id="sm-f" name="route.sample.from" label="Çıkış" value={draft.route.sample.from} max={30} />
                  <Txt id="sm-t" name="route.sample.to" label="Varış" value={draft.route.sample.to} max={30} />
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {draft.route.sample.stops.map((st, i) => (
                    <fieldset key={i} className="grid grid-cols-[1fr_6rem] gap-2 rounded-lg border border-line p-3">
                      <legend className="px-1 text-xs text-muted">{i + 1}. durak</legend>
                      <Input name={`route.sample.stops.${i}.city`} value={st.city} label="Şehir" max={30} />
                      <Input name={`route.sample.stops.${i}.temp`} value={st.temp} label="Sıcaklık" max={8} />
                    </fieldset>
                  ))}
                </div>
                <Txt id="sm-a" name="route.sample.alert" label="Bildirim metni" value={draft.route.sample.alert} max={120} />
              </div>
            </Panel>
            <Panel title="Faz 1 özellik ızgarası" description="En çok 12 kart; boş olanlar gösterilmez. Varsayılan 9 karttır.">
              <div className="grid gap-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Txt id="ft-b" name="features.badge" label="Rozet" value={draft.features.badge} max={30} />
                  <Txt id="ft-t" name="features.title" label="Başlık" value={draft.features.title} max={80} />
                  <Txt id="ft-x" name="features.text" label="Metin" value={draft.features.text} max={220} rows={2} className="sm:col-span-2" />
                </div>
                <IconCards name="features.items" items={draft.features.items} size={12} titleMax={40} textMax={120} />
              </div>
            </Panel>
            <Panel title="Tarla ve bahçe kartı" description="Seyahat bölümünün sonundaki tek kart.">
              <div className="grid gap-4 sm:grid-cols-[minmax(0,12rem)_1fr]">
                <Field label="Simge">
                  <IconSelect name="agroCard.icon" value={draft.agroCard.icon} label="Simge" />
                </Field>
                <Txt id="ag-t" name="agroCard.title" label="Başlık" value={draft.agroCard.title} max={60} />
                <Txt id="ag-x" name="agroCard.text" label="Metin" value={draft.agroCard.text} max={220} rows={2} className="sm:col-span-2" />
              </div>
            </Panel>
          </>
        )}

        {section === "enerji" && (
          <>
            <Panel title="Enerji bölümü" description="Hazır olmayan modül: rozet “Yakında” gibi durumu açıkça söylemeli. Buton, erken erişim formu yayında olduğunda görünür.">
              <div className="grid gap-4 sm:grid-cols-2">
                <Txt id="en-b" name="energy.badge" label="Rozet" value={draft.energy.badge} max={30} />
                <Txt id="en-t" name="energy.title" label="Başlık" value={draft.energy.title} max={80} />
                <Txt id="en-x" name="energy.text" label="Metin" value={draft.energy.text} max={260} rows={3} className="sm:col-span-2" />
                <Txt id="en-c" name="energy.ctaLabel" label="Buton" value={draft.energy.ctaLabel} max={40} />
              </div>
            </Panel>
            <EnergyEditor name="energy.solar" card={draft.energy.solar} title="Solar" />
            <EnergyEditor name="energy.wind" card={draft.energy.wind} title="Wind" />
          </>
        )}

        {section === "ucus" && (
          <>
            <Panel title="Uçuş bölümü" description="Hazır olmayan modül: rozet “Planlanıyor” gibi durumu açıkça söylemeli. Buton, erken erişim formu yayında olduğunda görünür.">
              <div className="grid gap-4 sm:grid-cols-2">
                <Txt id="av-b" name="aviation.badge" label="Rozet" value={draft.aviation.badge} max={30} />
                <Txt id="av-t" name="aviation.title" label="Başlık" value={draft.aviation.title} max={80} />
                <Txt id="av-x" name="aviation.text" label="Metin" value={draft.aviation.text} max={260} rows={3} className="sm:col-span-2" />
                <Txt id="av-n" name="aviation.note" label="Not satırı" value={draft.aviation.note} max={200} rows={2} className="sm:col-span-2" />
                <Txt id="av-c" name="aviation.ctaLabel" label="Buton" value={draft.aviation.ctaLabel} max={40} />
              </div>
            </Panel>
            <Panel title="Planlanan analizler" description="En çok 6 kart; boş olanlar gösterilmez.">
              <IconCards name="aviation.analyses" items={draft.aviation.analyses} size={6} titleMax={40} textMax={120} />
            </Panel>
            <Panel title="Kullanım alanları" description="En çok 6 madde; boş olanlar gösterilmez.">
              <ListInputs name="aviation.uses" values={draft.aviation.uses} size={6} max={60} label="Kullanım alanı" />
            </Panel>
          </>
        )}

        {section === "yol" && (
          <>
            <Panel title="Yol haritası" description="Faz sayısı 4, sabit. Durum rengi seçilen duruma göre belirlenir.">
              <div className="grid gap-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Txt id="rm-e" name="roadmap.eyebrow" label="Üst etiket" value={draft.roadmap.eyebrow} max={40} />
                  <Txt id="rm-t" name="roadmap.title" label="Başlık" value={draft.roadmap.title} max={80} />
                  <Txt id="rm-x" name="roadmap.text" label="Metin" value={draft.roadmap.text} max={220} rows={2} className="sm:col-span-2" />
                </div>
                <div className="grid gap-3 lg:grid-cols-2">
                  {draft.roadmap.phases.map((p, i) => (
                    <fieldset key={i} className="grid gap-2 rounded-lg border border-line p-3 sm:grid-cols-2">
                      <legend className="px-1 text-xs text-muted">{`Faz ${i + 1}`}</legend>
                      <Input name={`roadmap.phases.${i}.label`} value={p.label} label="Faz etiketi" max={20} />
                      <Input name={`roadmap.phases.${i}.name`} value={p.name} label="Faz adı" max={40} />
                      <select name={`roadmap.phases.${i}.state`} defaultValue={p.state} aria-label="Durum" className={selectCls}>
                        {ROADMAP_STATES.map((st) => (
                          <option key={st.value} value={st.value}>
                            {st.label}
                          </option>
                        ))}
                      </select>
                      <Input name={`roadmap.phases.${i}.stateLabel`} value={p.stateLabel} label="Durum etiketi" max={20} />
                      <Input name={`roadmap.phases.${i}.text`} value={p.text} label="Metin" className="sm:col-span-2" max={200} />
                    </fieldset>
                  ))}
                </div>
              </div>
            </Panel>
            <Panel title="Erken erişim" description="Bölüm yalnızca erken erişim formu yayında olduğunda görünür.">
              <div className="grid gap-4">
                <Notice>Form alan adları ve hata mesajları kodda sabittir. Onay kutusu metni her başvuruyla birlikte kayda geçer.</Notice>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Txt id="ea-e" name="earlyAccess.eyebrow" label="Üst etiket" value={draft.earlyAccess.eyebrow} max={40} />
                  <Txt id="ea-t" name="earlyAccess.title" label="Başlık" value={draft.earlyAccess.title} max={80} />
                  <Txt id="ea-x" name="earlyAccess.text" label="Metin" value={draft.earlyAccess.text} max={260} rows={2} className="sm:col-span-2" />
                </div>
                <div className="grid gap-4 sm:grid-cols-3">
                  <Txt id="ea-ms" name="earlyAccess.moduleLabels.solar" label="Modül adı: Solar" value={draft.earlyAccess.moduleLabels.solar} max={40} />
                  <Txt id="ea-mw" name="earlyAccess.moduleLabels.wind" label="Modül adı: Wind" value={draft.earlyAccess.moduleLabels.wind} max={40} />
                  <Txt id="ea-mf" name="earlyAccess.moduleLabels.fly" label="Modül adı: Uçuş" value={draft.earlyAccess.moduleLabels.fly} max={40} />
                </div>
                <Txt id="ea-p" name="earlyAccess.privacyNote" label="Aydınlatma notu" value={draft.earlyAccess.privacyNote} max={400} rows={3} />
                <Txt id="ea-c" name="earlyAccess.consentLabel" label="Onay kutusu metni" value={draft.earlyAccess.consentLabel} max={200} rows={2} />
                <div className="grid gap-4 sm:grid-cols-2">
                  <Txt id="ea-s" name="earlyAccess.submitLabel" label="Gönder butonu" value={draft.earlyAccess.submitLabel} max={30} />
                  <Txt id="ea-o" name="earlyAccess.successText" label="Başarı mesajı" value={draft.earlyAccess.successText} max={200} />
                </div>
              </div>
            </Panel>
          </>
        )}

        {section === "asistan" && (
          <Panel title="Asistan bölümü" description="Uçuş bölümünden sonra gelir; altındaki ton örneği kodda sabittir.">
            <div className="grid gap-3">
              <Field label="Üst etiket" htmlFor="ase"><input id="ase" name="assistant.eyebrow" defaultValue={draft.assistant.eyebrow} maxLength={40} className={inputCls} /></Field>
              <Field label="Başlık" htmlFor="ast"><input id="ast" name="assistant.title" defaultValue={draft.assistant.title} maxLength={80} className={inputCls} /></Field>
              <Field label="Metin" htmlFor="asx"><textarea id="asx" name="assistant.text" rows={4} defaultValue={draft.assistant.text} maxLength={260} className={textareaCls} /></Field>
            </div>
          </Panel>
        )}

        {section === "premium" && (
          <>
            <Panel title="Premium">
              <div className="grid gap-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Başlık" htmlFor="pt"><input id="pt" name="premium.title" defaultValue={draft.premium.title} maxLength={60} className={inputCls} /></Field>
                  <Field label="Buton" htmlFor="pc"><input id="pc" name="premium.ctaLabel" defaultValue={draft.premium.ctaLabel} maxLength={40} className={inputCls} /></Field>
                  <Field label="Metin" htmlFor="px" className="sm:col-span-2"><textarea id="px" name="premium.text" rows={2} defaultValue={draft.premium.text} maxLength={220} className={textareaCls} /></Field>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {draft.premium.cards.map((c, i) => (
                    <fieldset key={i} className="grid grid-cols-[minmax(0,10rem)_1fr] gap-2 rounded-lg border border-line p-3">
                      <legend className="px-1 text-xs text-muted">{i + 1}. kart</legend>
                      <IconSelect name={`premium.cards.${i}.icon`} value={c.icon} label="Simge" />
                      <Input name={`premium.cards.${i}.title`} value={c.title} label="Başlık" max={40} />
                      <Input name={`premium.cards.${i}.text`} value={c.text} label="Metin" className="col-span-2" max={120} />
                    </fieldset>
                  ))}
                </div>
              </div>
            </Panel>
            <Panel title="Alt bilgi">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Slogan" htmlFor="ft"><input id="ft" name="footer.tagline" defaultValue={draft.footer.tagline} maxLength={140} className={inputCls} /></Field>
                <Field label="Telif satırı" htmlFor="fc"><input id="fc" name="footer.copyright" defaultValue={draft.footer.copyright} maxLength={100} className={inputCls} /></Field>
              </div>
            </Panel>
          </>
        )}

        <div className="sticky bottom-0 -mx-4 flex justify-end gap-2 border-t border-line bg-ground/90 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-xl sm:border">
          <SubmitButton pendingText="Kaydediliyor…">Taslağa kaydet</SubmitButton>
        </div>
      </form>
    </>
  );
}
