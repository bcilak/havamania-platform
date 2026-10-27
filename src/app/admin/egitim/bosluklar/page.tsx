import Link from "next/link";
import { ClipboardCheck, SearchX } from "lucide-react";
import { SubmitButton } from "@/components/client";
import { Badge, btn, checkboxCls, EmptyState, Field, Flash, ModeBadge, Notice, PageHeader, Panel, selectCls, textareaCls } from "@/components/ui";
import { embedGapTexts, GAP_EMBED_MAX } from "@/lib/ai/gap-embed";
import { recordEmbeddingUsage } from "@/lib/ai/embedding-usage";
import { requireAdmin } from "@/lib/auth";
import { getMainBot } from "@/lib/bot";
import { allow, LIMITS } from "@/lib/rate-limit";
import { MODES, MODE_META } from "@/lib/bot-config";
import { EVAL_LIMITS } from "@/lib/eval";
import { param, type SearchParams } from "@/lib/form";
import { fmtInt, fmtRelative } from "@/lib/format";
import { clusterGaps, groupGaps, mergeClustersByEmbedding } from "@/lib/gaps";
import { maskPii } from "@/lib/pii-mask";
import { can } from "@/lib/roles";
import { getSetting } from "@/lib/settings";
import { GAP_MAX_QUESTIONS, gapQuestions } from "@/lib/stats";
import { addCaseFromMessage } from "../../konusmalar/[id]/actions";

export const metadata = { title: "Boşluk analizi" };

const BASE = "/admin/egitim/bosluklar";
const DAY_OPTIONS = [7, 30, 90] as const;
const DEFAULT_DAYS = 30;
/** Sayfada gösterilen en çok grup sayısı (kalanı daha az sorulan konulardır). */
const MAX_GROUPS = 50;

export default async function GapsPage({ searchParams }: { searchParams: SearchParams }) {
  const admin = await requireAdmin("training");
  const sp = await searchParams;
  const pii = can(admin.role, "pii");

  const daysRaw = Number(param(sp, "gun"));
  const days = DAY_OPTIONS.find((d) => d === daysRaw) ?? DEFAULT_DAYS;
  const modeRaw = param(sp, "mod");
  const mode = MODES.find((m) => m === modeRaw) ?? "";
  const semantic = param(sp, "anlamsal") === "1";

  const embeddingCfg = await getSetting("embedding");
  const embeddingReady = Boolean(embeddingCfg.providerId && embeddingCfg.model);

  const questions = await gapQuestions({ days, mode: mode || null, limit: GAP_MAX_QUESTIONS });
  let clusters = clusterGaps(questions);
  let semanticNote: string | null = null;
  if (semantic) {
    if (!allow(`gap-semantic:${admin.id}`, LIMITS.gapSemanticPerMin)) semanticNote = "Anlamsal birleştirme çok sık istendi; birkaç dakika sonra tekrar deneyin. Sözcüksel gruplama gösteriliyor.";
    else if (!embeddingReady) semanticNote = "Anlamsal birleştirme için Modeller sayfasında bir embedding modeli seçilmeli. Sözcüksel gruplama gösteriliyor.";
    else {
      const emb = await embedGapTexts(clusters.map((c) => c.leader));
      if (!emb) semanticNote = "Embedding çağrısı başarısız oldu; sözcüksel gruplama gösteriliyor.";
      else {
        // Harcama olay anında kaydedilir (pano maliyetine vektörleme olarak girer).
        await recordEmbeddingUsage({ botId: (await getMainBot()).id, kind: "gap_semantic", tokens: emb.tokens, costUsd: emb.costUsd });
        const before = clusters.length;
        clusters = mergeClustersByEmbedding(clusters, emb.vectors);
        semanticNote = `Anlamsal birleştirme uygulandı: ${before} grup ${clusters.length} gruba indi. Vektörler yalnızca bu istek sırasında bellekte tutuldu, kaydedilmedi.`;
      }
    }
  }
  const all = groupGaps(questions, { clusters });
  const groups = all.slice(0, MAX_GROUPS);
  const show = (text: string) => (pii ? text : maskPii(text));
  // `anlamsal` taşınmaz: dönüş bağlantısı her açılışta yeniden embedding çağrısı (maliyet) tetiklemesin.
  const self = `${BASE}?${new URLSearchParams({ gun: String(days), ...(mode ? { mod: mode } : {}) })}`;

  return (
    <>
      <PageHeader
        title="Boşluk analizi"
        description="Bilgi tabanında karşılığı bulunamayan ya da beğenilmeyen cevapların soruları, benzer olanlar bir araya getirilerek sık sorulan konulara göre sıralanır. Test alanı ve örnek veriler dahil değildir."
      />
      <Flash sp={sp} />

      <form className="mb-5 flex flex-wrap items-end gap-3" role="search" aria-label="Boşlukları süz">
        <Field label="Dönem" htmlFor="gun">
          <select id="gun" name="gun" defaultValue={String(days)} className={`${selectCls} w-auto`}>
            {DAY_OPTIONS.map((d) => (
              <option key={d} value={d}>
                Son {d} gün
              </option>
            ))}
          </select>
        </Field>
        <Field label="Mod" htmlFor="mod">
          <select id="mod" name="mod" defaultValue={mode} className={`${selectCls} w-auto`}>
            <option value="">Tüm modlar</option>
            {MODES.map((m) => (
              <option key={m} value={m}>
                {MODE_META[m].label}
              </option>
            ))}
          </select>
        </Field>
        <label className="flex h-9 items-center gap-2 text-[13px]" title={embeddingReady ? undefined : "Önce Modeller sayfasında bir embedding modeli seçin."}>
          <input type="checkbox" name="anlamsal" value="1" defaultChecked={semantic} disabled={!embeddingReady} className={checkboxCls} />
          Anlamsal birleştir (embedding, küçük bir maliyeti var)
        </label>
        <button className={btn("secondary")} type="submit">
          Uygula
        </button>
      </form>

      {!pii && (
        <div className="mb-5">
          <Notice>
            Sorular e-posta, telefon/uzun numara ve konum/koordinat için maskelenir; maske en iyi çabayla çalışır, ad ya da adres gibi bilgiler görünebilir. Maskeli metinden SSS ya da
            senaryo oluşturulmaz: bu işlemler kişisel veri yetkisi olan rollere açıktır.
          </Notice>
        </div>
      )}
      {semanticNote && (
        <div className="mb-5">
          <Notice>{semanticNote}</Notice>
        </div>
      )}
      {questions.length >= GAP_MAX_QUESTIONS && (
        <div className="mb-5">
          <Notice tone="warn">
            Dönemde çok soru var; performans için en yeni {fmtInt(GAP_MAX_QUESTIONS)} soru gruplandı. Daha kısa bir dönem seçebilirsiniz.
            {semantic && ` Anlamsal birleştirme en fazla ${GAP_EMBED_MAX} grup lideri için çalışır.`}
          </Notice>
        </div>
      )}

      {groups.length === 0 ? (
        <div className="rounded-xl border border-line bg-surface">
          <EmptyState icon={SearchX} title="Bu dönemde boşluk bulunmadı">
            Asistan kaynak bulamadığında ya da kullanıcı bir cevabı beğenmediğinde sorular burada toplanır. Gerçek kullanıcı verisi biriktikçe liste dolar; ilk
            haftalarda boş olması normaldir.
          </EmptyState>
        </div>
      ) : (
        <>
          <p className="mb-3 text-sm text-muted">
            {fmtInt(questions.length)} soru, {fmtInt(all.length)} grup{all.length > groups.length ? ` (en sık ${groups.length} tanesi gösteriliyor)` : ""}.
          </p>
          <ol className="grid gap-4" aria-label="Boşluk grupları">
            {groups.map((g, gi) => {
              const topMode = g.modes[0]?.mode;
              const sssMode = MODES.find((m) => m === topMode) ?? "all";
              return (
                <li key={g.target.messageId}>
                  <Panel
                    title={<span className="line-clamp-2">{show(g.question)}</span>}
                    actions={
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone="accent">{fmtInt(g.count)} soru</Badge>
                        {g.negative > 0 && <Badge tone="bad">{fmtInt(g.negative)} olumsuz</Badge>}
                        {g.unanswered > 0 && <Badge tone="warn">{fmtInt(g.unanswered)} karşılıksız</Badge>}
                        <span className="text-xs text-muted">son: {fmtRelative(g.lastAt)}</span>
                      </div>
                    }
                  >
                    <div className="grid gap-4">
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
                        {g.modes.map((m) => (
                          <span key={m.mode} className="inline-flex items-center gap-1.5">
                            {MODES.some((x) => x === m.mode) ? <ModeBadge mode={m.mode as (typeof MODES)[number]} /> : m.mode}
                            <span className="tabular">{fmtInt(m.count)}</span>
                          </span>
                        ))}
                      </div>

                      <ul className="grid gap-1.5 text-sm">
                        {g.samples.map((s) => (
                          <li key={s.messageId} className="flex items-start gap-2">
                            <span className="text-faint" aria-hidden>
                              •
                            </span>
                            <span className="min-w-0 flex-1 break-words">{show(s.question)}</span>
                            <Link href={`/admin/konusmalar/${s.conversationId}#m-${s.messageId}`} className="shrink-0 text-xs text-accent hover:underline">
                              Konuşma
                            </Link>
                          </li>
                        ))}
                      </ul>

                      <div className="flex flex-wrap items-start gap-2">
                        {pii && (
                          <Link href={`/admin/egitim/bilgi-tabani?soru=${encodeURIComponent(g.question)}&mod=${sssMode}#sss`} className={btn("secondary", "sm")}>
                            SSS&apos;ye ekle
                          </Link>
                        )}
                        <Link href={`/admin/konusmalar/${g.target.conversationId}#m-${g.target.messageId}`} className={btn("ghost", "sm")}>
                          Konuşmalara git
                        </Link>
                        {pii && (
                          <details className="w-full rounded-lg border border-line">
                            <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 text-[13px] text-accent">
                              <ClipboardCheck className="size-3.5" /> Senaryoya ekle
                            </summary>
                            <form action={addCaseFromMessage} className="grid gap-3 border-t border-line p-3">
                              <input type="hidden" name="conversationId" value={g.target.conversationId} />
                              <input type="hidden" name="messageId" value={g.target.messageId} />
                              <input type="hidden" name="back" value={self} />
                              <label className="grid gap-1.5 text-[13px] font-medium" htmlFor={`case-${gi}`}>
                                Soru
                                <textarea
                                  id={`case-${gi}`}
                                  name="question"
                                  rows={2}
                                  required
                                  maxLength={EVAL_LIMITS.questionMax}
                                  defaultValue={g.question.slice(0, EVAL_LIMITS.questionMax)}
                                  className={textareaCls}
                                />
                                <span className="text-xs font-normal text-muted">Test senaryosu olarak kaydedilir. Beklenen ölçütleri sonraki adımda belirlersiniz.</span>
                              </label>
                              <label className="flex items-start gap-2 text-[13px]">
                                <input type="checkbox" name="piiOk" required className={`${checkboxCls} mt-0.5`} />
                                <span>Kişisel veri içermediğinden emin oldum (ad, telefon, adres gibi bilgiler soruda yok). Kaynak konuşma silinse de senaryo kalır.</span>
                              </label>
                              <div>
                                <SubmitButton variant="secondary" size="sm" pendingText="Ekleniyor…">
                                  Senaryo oluştur
                                </SubmitButton>
                              </div>
                            </form>
                          </details>
                        )}
                      </div>
                    </div>
                  </Panel>
                </li>
              );
            })}
          </ol>
        </>
      )}
    </>
  );
}
