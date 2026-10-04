import { ExternalLink } from "lucide-react";
import { ConfirmButton, SubmitButton } from "@/components/client";
import { Badge, btn, Field, Flash, inputCls, Notice, PageHeader, Panel, selectCls, Tabs, textareaCls } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { LANDING_ICONS, resolveIcon } from "@/lib/cms/icons";
import { getLanding, getLandingDoc } from "@/lib/cms/store";
import { defaultLandingContent, SCENE_META, type LandingContent, type SceneKey } from "@/lib/cms/schema";
import { param, type SearchParams } from "@/lib/form";
import { fmtDateTime } from "@/lib/format";
import { discardDraft, publishLanding, saveSection } from "./actions";

export const metadata = { title: "Site sayfaları" };

const SECTIONS = [
  { id: "genel", label: "Genel ve hero" },
  { id: "core", label: "Panel sahnesi" },
  { id: "agro", label: "Agro sahnesi" },
  { id: "fly", label: "Fly sahnesi" },
  { id: "bolumler", label: "Modlar ve Asistan" },
  { id: "premium", label: "Premium ve alt bilgi" },
];

const STAGES = ["Parçalar dağılırken", "Parçalar birleşirken ve 1. ekranda", "2. ekranda", "3. ekranda (asistan)"];

function Input({ name, value, label, max, className }: { name: string; value: string; label?: string; max?: number; className?: string }) {
  return (
    <input name={name} defaultValue={value} maxLength={max} aria-label={label ?? name} className={`${inputCls} ${className ?? ""}`} />
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

function SceneEditor({ s, accent }: { s: LandingContent["scenes"][SceneKey]; accent: string }) {
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
  const section = SECTIONS.some((s) => s.id === param(sp, "bolum")) ? param(sp, "bolum") : "genel";
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

        {(section === "core" || section === "agro" || section === "fly") && (
          <>
            <Notice>
              {SCENE_META[section].label}: parçalar telefondan dışarı savrulur, geri toplanıp hücrelere oturur, ardından telefon ekranı 3 kez kayar. Satır sayıları bu yüzden sabittir.
            </Notice>
            <SceneEditor s={draft.scenes[section]} accent={SCENE_META[section].accent} />
          </>
        )}

        {section === "bolumler" && (
          <div className="grid gap-5 lg:grid-cols-2">
            <Panel title="Modlar bölümü" description="Panel sahnesinden sonra gelen koyu bölüm.">
              <div className="grid gap-3">
                <Field label="Rozet" htmlFor="p2b"><input id="p2b" name="phase2.badge" defaultValue={draft.phase2.badge} maxLength={30} className={inputCls} /></Field>
                <Field label="Başlık" htmlFor="p2t"><input id="p2t" name="phase2.title" defaultValue={draft.phase2.title} maxLength={80} className={inputCls} /></Field>
                <Field label="Metin" htmlFor="p2x"><textarea id="p2x" name="phase2.text" rows={4} defaultValue={draft.phase2.text} maxLength={260} className={textareaCls} /></Field>
              </div>
            </Panel>
            <Panel title="Asistan bölümü" description="Fly sahnesinden sonra gelir.">
              <div className="grid gap-3">
                <Field label="Üst etiket" htmlFor="ase"><input id="ase" name="assistant.eyebrow" defaultValue={draft.assistant.eyebrow} maxLength={40} className={inputCls} /></Field>
                <Field label="Başlık" htmlFor="ast"><input id="ast" name="assistant.title" defaultValue={draft.assistant.title} maxLength={80} className={inputCls} /></Field>
                <Field label="Metin" htmlFor="asx"><textarea id="asx" name="assistant.text" rows={4} defaultValue={draft.assistant.text} maxLength={260} className={textareaCls} /></Field>
              </div>
            </Panel>
          </div>
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
