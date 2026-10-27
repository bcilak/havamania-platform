import Link from "next/link";
import { and, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { BookOpen, FileText, Globe, MessageCircle, PenLine, Search, Sparkles } from "lucide-react";
import { db } from "@/db";
import { kbSources, providers, type ChatMode, type KbSourceType } from "@/db/schema";
import { AutoRefresh } from "@/components/admin/AutoRefresh";
import { SourceForm } from "@/components/admin/SourceForm";
import { ConfirmButton, SubmitButton } from "@/components/client";
import { Badge, btn, EmptyState, Field, Flash, inputCls, Notice, PageHeader, Pagination, Panel, selectCls, TableWrap, Tabs, td, th } from "@/components/ui";
import { effectiveEmbedding, embeddingLabel, sameEmbedding } from "@/lib/ai/embedding-freeze";
import { searchKnowledge } from "@/lib/ai/retrieval";
import { describeMatch } from "@/lib/ai/retrieval-core";
import { requireAdmin } from "@/lib/auth";
import { getMainBot, getPublishedVersion } from "@/lib/bot";
import { purgeSummary } from "@/lib/kb";
import { MODES, MODE_META } from "@/lib/bot-config";
import { param, type SearchParams } from "@/lib/form";
import { fmtInt, fmtRelative } from "@/lib/format";
import { LIST_PAGE_SIZE, pageInfo, parsePage } from "@/lib/pagination";
import { getSetting } from "@/lib/settings";
import { addQa, addUrl, deleteSource, importCms, purge, reprocess, uploadSource } from "./actions";

export const metadata = { title: "Bilgi tabanı" };

const TYPE_META: Record<KbSourceType, { label: string; icon: typeof FileText }> = {
  file: { label: "Dosya", icon: FileText },
  url: { label: "Web sayfası", icon: Globe },
  qa: { label: "SSS", icon: MessageCircle },
  correction: { label: "Düzeltme", icon: PenLine },
  cms: { label: "Site içeriği", icon: Sparkles },
};

const STATUS: Record<string, { label: string; tone: "good" | "warn" | "bad" | "neutral" }> = {
  ready: { label: "Hazır", tone: "good" },
  processing: { label: "İşleniyor", tone: "warn" },
  pending: { label: "Sırada", tone: "neutral" },
  failed: { label: "Hata", tone: "bad" },
};

function ModeSelect({ id, defaultValue }: { id: string; defaultValue?: string }) {
  return (
    <select id={id} name="mode" defaultValue={defaultValue || "all"} className={selectCls}>
      <option value="all">Tüm modlar</option>
      {MODES.map((m) => (
        <option key={m} value={m}>
          Yalnızca {MODE_META[m].label}
        </option>
      ))}
    </select>
  );
}

export default async function KnowledgePage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdmin("training");
  const sp = await searchParams;
  const bot = await getMainBot();
  const published = await getPublishedVersion(bot);
  const inPublished = new Set(published?.kbSourceIds ?? []);
  const typeRaw = param(sp, "tur");
  const type = (typeRaw in TYPE_META ? typeRaw : "") as KbSourceType | "";
  const query = param(sp, "ara");
  const queryMode = (param(sp, "arama_mod") || "genel") as ChatMode;

  // Yerine yenisi geçen ve silinen satırlar listede görünmez; yayında kullanılmaya devam edebilirler.
  const listed = and(eq(kbSources.botId, bot.id), isNull(kbSources.deletedAt), isNull(kbSources.supersededBy));
  const grouped = await db
    .select({ type: kbSources.type, status: kbSources.status, n: sql<number>`count(*)::int` })
    .from(kbSources)
    .where(listed)
    .groupBy(kbSources.type, kbSources.status);
  const counts: Record<string, number> = Object.fromEntries(Object.keys(TYPE_META).map((t) => [t, 0]));
  let total = 0;
  let readyCount = 0;
  let busy = false;
  for (const g of grouped) {
    counts[g.type] += g.n;
    total += g.n;
    if (g.status === "ready") readyCount += g.n;
    if (g.status === "pending" || g.status === "processing") busy = true;
  }
  const pg = pageInfo(type ? counts[type] : total, parsePage(param(sp, "sayfa")), LIST_PAGE_SIZE);
  const rows = await db
    .select()
    .from(kbSources)
    .where(type ? and(listed, eq(kbSources.type, type)) : listed)
    .orderBy(desc(kbSources.updatedAt), desc(kbSources.id))
    .limit(pg.limit)
    .offset(pg.offset);
  const replacedLive = new Set(
    (await db.select({ id: kbSources.id, by: kbSources.supersededBy }).from(kbSources).where(and(eq(kbSources.botId, bot.id), isNotNull(kbSources.supersededBy))))
      .filter((r) => inPublished.has(r.id))
      .map((r) => r.by as string),
  );
  const { stillUsed, purgeable } = await purgeSummary(bot.id);
  const embedding = await getSetting("embedding");
  const providerList = await db.select({ id: providers.id, name: providers.name }).from(providers);
  const liveEmbedding = effectiveEmbedding(published?.embedding, embedding);
  const liveEmbeddingChanged = Boolean(published) && !sameEmbedding(liveEmbedding, embedding);
  const [{ chunks }] = await db.select({ chunks: sql<number>`count(*)::int` }).from(sql`kb_chunks`).where(sql`bot_id = ${bot.id}`);
  const hits = query ? await searchKnowledge({ botId: bot.id, mode: queryMode, query, allowedSourceIds: null,
        topK: 6,
        minSimilarity: bot.draftConfig.retrievalMinSimilarity,
        domainStopwords: bot.draftConfig.domainStopwords,
      }) : [];

  return (
    <>
      <AutoRefresh active={busy} />
      <PageHeader
        title="Bilgi tabanı"
        description="Asistanın cevap verirken aradığı belgeler, web sayfaları ve soru-cevaplar. Eklenen her şey önce taslağa girer; kullanıcılar yayınladıktan sonra görür."
        actions={
          <form action={importCms}>
            <SubmitButton variant="secondary" pendingText="Aktarılıyor…">
              <Sparkles className="size-4" /> Site içeriğini aktar
            </SubmitButton>
          </form>
        }
      />
      <Flash sp={sp} />

      {busy && (
        <div className="mb-5">
          <Notice>
            İşleniyor: {fmtInt(readyCount)} / {fmtInt(total)} kaynak hazır. Yeniden işlenen yayındaki kaynakların eski içeriği, siz yeni sürüm yayınlayana kadar canlıda kullanılır.
          </Notice>
        </div>
      )}

      <div className="mb-5">
        {embedding.providerId && embedding.model ? (
          <Notice>
            Taslakta arama <strong>vektör + Türkçe tam metin</strong> ile yapılıyor ({embedding.model}). Toplam {fmtInt(chunks)} parça.
            {liveEmbeddingChanged && (
              <>
                {" "}
                Canlı asistan yeni sürüm yayınlanana kadar <strong>eski modelle</strong> ({embeddingLabel(liveEmbedding, providerList)}) çalışmaya devam eder.
              </>
            )}
          </Notice>
        ) : (
          <Notice tone="warn">
            Taslakta embedding modeli seçilmediği için yalnızca <strong>Türkçe tam metin araması</strong> yapılıyor. Anlamca yakın ama farklı kelimelerle sorulan
            soruları yakalamak için{" "}
            <a href="/admin/ayarlar/modeller#embedding" className="font-medium text-accent underline">
              bir embedding modeli seçin
            </a>
            ; ardından kaynaklar yeniden işlenir.{" "}
            {liveEmbeddingChanged
              ? `Canlı asistan yeni sürüm yayınlanana kadar eski modelle (${embeddingLabel(liveEmbedding, providerList)}) çalışmaya devam eder.`
              : "Canlı asistan, siz yeni sürüm yayınlayana kadar bu değişiklikten etkilenmez."}
          </Notice>
        )}
      </div>

      <div className="mb-6 grid gap-4 lg:grid-cols-3">
        <Panel title="Dosya yükle" description="PDF, DOCX, TXT veya MD. En fazla 20 MB.">
          <form action={uploadSource} className="grid gap-3">
            <input name="file" type="file" required accept=".pdf,.docx,.txt,.md,application/pdf,text/plain,text/markdown" className="text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-sunken file:px-3 file:py-1.5 file:text-sm" aria-label="Dosya" />
            <Field label="Başlık (isteğe bağlı)" htmlFor="f-title">
              <input id="f-title" name="title" className={inputCls} placeholder="Dosya adı kullanılır" />
            </Field>
            <Field label="Geçerli olduğu mod" htmlFor="f-mode">
              <ModeSelect id="f-mode" />
            </Field>
            <SubmitButton pendingText="Yükleniyor…">Yükle</SubmitButton>
          </form>
        </Panel>
        <Panel title="Web sayfası ekle" description="Sayfanın ana metni alınır; menü ve alt bilgi atlanır.">
          <form action={addUrl} className="grid gap-3">
            <Field label="Adres" htmlFor="u-url">
              <input id="u-url" name="url" type="url" required placeholder="https://havamania.com/sss" className={inputCls} />
            </Field>
            <Field label="Geçerli olduğu mod" htmlFor="u-mode">
              <ModeSelect id="u-mode" />
            </Field>
            <SubmitButton pendingText="Ekleniyor…">Ekle</SubmitButton>
          </form>
        </Panel>
        <Panel id="sss" title="Soru-cevap ekle" description="Sık sorulan sorular aramada öne çıkar.">
          <SourceForm
            key={`${param(sp, "ok")}|${param(sp, "hata")}`}
            action={addQa}
            idPrefix="q"
            initial={{ question: param(sp, "soru"), mode: MODES.some((m) => m === param(sp, "mod")) ? param(sp, "mod") : "all" }}
            answerMax={6000}
            submitLabel="Ekle"
            pendingText="Ekleniyor…"
            resetOnSuccess
          />
        </Panel>
      </div>

      <Tabs
        items={[
          { href: "/admin/egitim/bilgi-tabani", label: "Tümü", active: !type, count: total },
          ...Object.entries(TYPE_META).map(([t, m]) => ({ href: `/admin/egitim/bilgi-tabani?tur=${t}`, label: m.label, active: type === t, count: counts[t] })),
        ]}
      />

      {rows.length ? (
        <TableWrap>
          <thead>
            <tr>
              <th className={th}>Kaynak</th>
              <th className={th}>Mod</th>
              <th className={th}>Durum</th>
              <th className={`${th} text-right`}>Parça</th>
              <th className={th}>Güncellendi</th>
              <th className={th} />
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => {
              const T = TYPE_META[s.type];
              const st = STATUS[s.status];
              const live = inPublished.has(s.id);
              const oldLive = replacedLive.has(s.id);
              return (
                <tr key={s.id}>
                  <td className={td}>
                    <div className="flex items-start gap-2.5">
                      <T.icon className="mt-0.5 size-4 shrink-0 text-muted" />
                      <div className="min-w-0">
                        <Link href={`/admin/egitim/bilgi-tabani/${s.id}`} className="font-medium break-words hover:text-accent hover:underline">
                          {s.title}
                        </Link>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                          <span>{T.label}</span>
                          {s.url && (
                            <a href={s.url} target="_blank" className="truncate text-accent hover:underline">
                              {new URL(s.url).hostname}
                            </a>
                          )}
                          {s.type === "qa" || s.type === "correction" ? <span className="line-clamp-1">· {s.answer}</span> : null}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className={`${td} whitespace-nowrap text-muted`}>{s.mode === "all" ? "Tümü" : MODE_META[s.mode].label}</td>
                  <td className={td}>
                    <div className="flex flex-col items-start gap-1">
                      <Badge tone={st.tone}>{st.label}</Badge>
                      {s.chunkCount > 0 && (
                        <Badge tone={live ? "accent" : "neutral"}>{live ? "Yayında" : oldLive ? "Yayında eski hâli, yeni yayın bekliyor" : "Yayın bekliyor"}</Badge>
                      )}
                      {s.error && <span className="max-w-56 text-xs text-bad">{s.error}</span>}
                      {s.status === "failed" && s.chunkCount > 0 && <span className="max-w-56 text-xs text-muted">Son işlem başarısız; önceki içerik kullanılmaya devam ediyor.</span>}
                      {s.status === "failed" && s.chunkCount === 0 && oldLive && <span className="max-w-56 text-xs text-muted">Yayındaki sürüm önceki içeriği kullanmaya devam ediyor.</span>}
                      {s.warning && <span className="max-w-56 text-xs text-warn">{s.warning}</span>}
                    </div>
                  </td>
                  <td className={`${td} tabular text-right`}>{fmtInt(s.chunkCount)}</td>
                  <td className={`${td} whitespace-nowrap text-muted`}>{fmtRelative(s.updatedAt)}</td>
                  <td className={`${td} text-right`}>
                    <div className="flex justify-end gap-1">
                      {s.type !== "qa" && s.type !== "correction" && (
                        <form action={reprocess}>
                          <input type="hidden" name="id" value={s.id} />
                          <SubmitButton variant="ghost" size="sm">
                            Yeniden işle
                          </SubmitButton>
                        </form>
                      )}
                      <form action={deleteSource}>
                        <input type="hidden" name="id" value={s.id} />
                        <ConfirmButton confirmText={live || oldLive ? "Yayında; yeni yayına kadar canlıda kalır. Silinsin mi?" : "Silinsin mi?"}>Sil</ConfirmButton>
                      </form>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </TableWrap>
      ) : (
        <div className="rounded-xl border border-line bg-surface">
          <EmptyState icon={BookOpen} title="Bu türde kaynak yok">
            Yukarıdan dosya, web sayfası ya da soru-cevap ekleyin.
          </EmptyState>
        </div>
      )}
      <Pagination basePath="/admin/egitim/bilgi-tabani" params={{ tur: type, ara: query, arama_mod: param(sp, "arama_mod") }} page={pg.page} pages={pg.pages} total={pg.total} noun="kaynak" />

      {stillUsed.length > 0 && (
        <Panel
          className="mt-6"
          title="Silinmiş, sürümlerde kayıtlı kaynaklar"
          description="Taslaktan silindi; yayındaki ya da geri dönülebilecek son 10 sürüm hâlâ kullanıyor. Bir sürümde yer almayan kaynaklar kalıcı silinebilir."
        >
          <ul className="mb-3 grid gap-1 text-sm">
            {stillUsed.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-2">
                <span>{s.title}</span>
                {inPublished.has(s.id) && <Badge tone="accent">Yayında kullanılıyor</Badge>}
              </li>
            ))}
          </ul>
          {purgeable > 0 && (
            <form action={purge}>
              <ConfirmButton confirmText={`${purgeable} kaynak kalıcı silinsin mi?`}>Kullanılmayanları temizle ({purgeable})</ConfirmButton>
            </form>
          )}
        </Panel>
      )}
      {stillUsed.length === 0 && purgeable > 0 && (
        <form action={purge} className="mt-6">
          <ConfirmButton confirmText={`${purgeable} eski kayıt kalıcı silinsin mi?`}>Eski kayıtları temizle ({purgeable})</ConfirmButton>
        </form>
      )}

      <Panel className="mt-6" title="Aramayı dene" description="Bir soru yazın; asistanın bu soru için hangi içeriği bulacağını görün. Taslaktaki tüm hazır kaynaklarda arar.">
        <form className="flex flex-wrap gap-2" role="search">
          <input name="ara" defaultValue={query} placeholder="Örn. Çarşamba sulama yapayım mı?" className={`${inputCls} min-w-0 flex-1`} aria-label="Deneme sorusu" />
          <select name="arama_mod" defaultValue={queryMode} className={`${selectCls} w-auto`} aria-label="Mod">
            {MODES.map((m) => (
              <option key={m} value={m}>
                {MODE_META[m].label}
              </option>
            ))}
          </select>
          <button className={btn("secondary")}>
            <Search className="size-4" /> Ara
          </button>
        </form>
        {query && (
          <ol className="mt-4 grid gap-2">
            {hits.length ? (
              hits.map((h, i) => (
                <li key={h.chunkId} className="rounded-lg border border-line p-3">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="tabular text-muted">{i + 1}.</span>
                    <span className="font-medium">{h.title}</span>
                    <Badge>{TYPE_META[h.type as KbSourceType]?.label ?? h.type}</Badge>
                    <span className="tabular ml-auto text-xs text-muted">{describeMatch(h)}</span>
                  </div>
                  <p className="mt-1.5 line-clamp-3 text-[13px] leading-relaxed text-muted">{h.content}</p>
                </li>
              ))
            ) : (
              <li className="text-sm text-muted">Bu soru için içerik bulunamadı. Bir soru-cevap eklemeyi düşünün.</li>
            )}
          </ol>
        )}
      </Panel>
    </>
  );
}
