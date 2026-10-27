import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { and, asc, eq, sql } from "drizzle-orm";
import { BookOpen, ChevronLeft, FileText, Globe, MessageCircle, PenLine, Search, Sparkles } from "lucide-react";
import { db } from "@/db";
import { botVersions, kbChunks, kbSources, type ChatMode, type KbSourceType } from "@/db/schema";
import { AutoRefresh } from "@/components/admin/AutoRefresh";
import { SourceForm } from "@/components/admin/SourceForm";
import { ConfirmButton, SubmitButton } from "@/components/client";
import { Badge, btn, EmptyState, Flash, inputCls, KeyValue, Notice, PageHeader, Pagination, Panel, selectCls, TableWrap, td, th } from "@/components/ui";
import { chainOf, type KbRow } from "@/lib/ai/kb-lifecycle";
import { isQaLike } from "@/lib/ai/kb-edit-core";
import { searchKnowledgeRanked } from "@/lib/ai/retrieval";
import { describeMatch } from "@/lib/ai/retrieval-core";
import { requireAdmin } from "@/lib/auth";
import { allow, LIMITS } from "@/lib/rate-limit";
import { getMainBot } from "@/lib/bot";
import { MODES, MODE_META } from "@/lib/bot-config";
import { param, type SearchParams } from "@/lib/form";
import { fmtDateTime, fmtInt } from "@/lib/format";
import { sourceUsage } from "@/lib/kb";
import { pageInfo, parsePage } from "@/lib/pagination";
import { deleteSource, reprocess, updateSource } from "../actions";

export const metadata = { title: "Kaynak ayrıntısı" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BACK = "/admin/egitim/bilgi-tabani";
/** Parça listesi sayfa boyutu; büyük bir dosya yüzlerce parça üretebilir. */
const CHUNK_PAGE = 30;
const PREVIEW_CHARS = 400;
/** "Bu kaynakta ara" sorgusunun azami uzunluğu. */
const SEARCH_MAX_CHARS = 1000;

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

const modeLabel = (m: string) => (m === "all" ? "Tüm modlar" : (MODE_META[m as ChatMode]?.label ?? m));

export default async function SourceDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const admin = await requireAdmin("training");
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const sp = await searchParams;
  const bot = await getMainBot();

  const [src] = await db.select().from(kbSources).where(and(eq(kbSources.id, id), eq(kbSources.botId, bot.id)));
  if (!src) notFound();

  // Halef/öncül zinciri (eskiden yeniye) ve her halkanın kullanıldığı sürümler.
  const allRows = await db
    .select({
      id: kbSources.id,
      title: kbSources.title,
      status: kbSources.status,
      chunkCount: kbSources.chunkCount,
      deletedAt: kbSources.deletedAt,
      supersededBy: kbSources.supersededBy,
      createdAt: kbSources.createdAt,
      updatedAt: kbSources.updatedAt,
    })
    .from(kbSources)
    .where(eq(kbSources.botId, bot.id));
  const rowById = new Map(allRows.map((r) => [r.id, r]));
  const chain = chainOf(id, allRows as KbRow[]);
  const headId = chain[chain.length - 1];
  const isHead = headId === id;
  const versionsByChain = new Map(
    await Promise.all(
      chain.map(async (cid) => {
        const used = await db
          .select({ id: botVersions.id, number: botVersions.number })
          .from(botVersions)
          .where(and(eq(botVersions.botId, bot.id), sql`${botVersions.kbSourceIds} @> ${JSON.stringify([cid])}::jsonb`))
          .orderBy(asc(botVersions.number));
        return [cid, used] as const;
      }),
    ),
  );
  const usage = await sourceUsage(bot.id, id);

  // Parçalar (sayfalı).
  const [{ n: chunkTotal }] = await db.select({ n: sql<number>`count(*)::int` }).from(kbChunks).where(eq(kbChunks.sourceId, id));
  const pg = pageInfo(chunkTotal, parsePage(param(sp, "sayfa")), CHUNK_PAGE);
  const chunks = await db
    .select({ id: kbChunks.id, idx: kbChunks.idx, content: kbChunks.content, embeddingModel: kbChunks.embeddingModel, hasVector: sql<boolean>`${kbChunks.embedding} is not null` })
    .from(kbChunks)
    .where(eq(kbChunks.sourceId, id))
    .orderBy(asc(kbChunks.idx))
    .limit(pg.limit)
    .offset(pg.offset);
  const vectorCount = chunkTotal
    ? (await db.select({ n: sql<number>`count(*)::int` }).from(kbChunks).where(and(eq(kbChunks.sourceId, id), sql`${kbChunks.embedding} is not null`)))[0].n
    : 0;

  // "Bu kaynakta ara": yalnızca bu kaynağın parçaları, taslak ayarlarıyla; eşik altındakiler de gösterilir.
  const query = param(sp, "ara").trim().slice(0, SEARCH_MAX_CHARS);
  // Arama embedding çağrısı yapar (maliyetli): yönetici başına hız sınırı.
  const searchLimited = Boolean(query) && !allow(`kb-search:${admin.id}`, LIMITS.kbSearchPerMin);
  const queryMode = (MODES.some((m) => m === param(sp, "arama_mod")) ? param(sp, "arama_mod") : src.mode === "all" ? "genel" : src.mode) as ChatMode;
  const hits = query && !searchLimited
    ? await searchKnowledgeRanked({
        botId: bot.id,
        mode: queryMode,
        query,
        allowedSourceIds: [id],
        topK: 8,
        minSimilarity: bot.draftConfig.retrievalMinSimilarity,
        domainStopwords: bot.draftConfig.domainStopwords,
      })
    : [];

  const T = TYPE_META[src.type];
  const st = STATUS[src.status];
  const qa = isQaLike(src.type);
  const head = rowById.get(headId);
  const editable = isHead && !src.deletedAt;
  const busy = src.status === "pending" || src.status === "processing";
  const publishState = usage.published ? "Yayında" : src.chunkCount > 0 && editable ? "Yayın bekliyor" : null;

  const summary: [ReactNode, ReactNode][] = [
    ["Tür", T.label],
    ["Mod", modeLabel(src.mode)],
    [
      "Durum",
      <span key="st" className="inline-flex flex-wrap items-center gap-1.5">
        <Badge tone={st.tone}>{st.label}</Badge>
        {publishState && <Badge tone={usage.published ? "accent" : "neutral"}>{publishState}</Badge>}
      </span>,
    ],
  ];
  if (src.error) summary.push(["Hata", <span key="e" className="text-bad">{src.error}</span>]);
  if (src.warning) summary.push(["Uyarı", <span key="w" className="text-warn">{src.warning}</span>]);
  summary.push(
    ["Karakter", fmtInt(src.charCount)],
    ["Parça", `${fmtInt(src.chunkCount)} (vektörlü ${fmtInt(vectorCount)})`],
    ["Embedding modeli", src.embeddingModel ?? (chunkTotal ? "Yok (yalnızca tam metin aranır)" : "—")],
  );
  if (src.url) summary.push(["Adres", <a key="u" href={src.url} target="_blank" className="text-accent hover:underline">{src.url}</a>]);
  summary.push(["Oluşturan", src.createdBy ?? "—"], ["Güncellendi", fmtDateTime(src.updatedAt)]);

  return (
    <>
      <AutoRefresh active={busy || head?.status === "pending" || head?.status === "processing"} />
      <Link href={BACK} className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
        <ChevronLeft className="size-4" /> Bilgi tabanı
      </Link>
      <PageHeader
        title={
          <span className="inline-flex flex-wrap items-center gap-3 break-words">
            <T.icon className="size-6 shrink-0 text-muted" />
            {src.title}
          </span>
        }
        actions={
          editable && !qa ? (
            <form action={reprocess}>
              <input type="hidden" name="id" value={src.id} />
              <SubmitButton variant="secondary" pendingText="Başlatılıyor…">
                Yeniden işle
              </SubmitButton>
            </form>
          ) : undefined
        }
      />
      <Flash sp={sp} />

      {src.deletedAt && (
        <div className="mb-5">
          <Notice tone="warn">Bu kaynak taslaktan silindi. Hâlâ bir sürümde kayıtlı olduğu için görüntülenebilir; düzenlenemez.</Notice>
        </div>
      )}
      {!isHead && !src.deletedAt && (
        <div className="mb-5">
          <Notice tone="warn">
            Bu kaydın yerine yenisi geçti. Düzenlemek için{" "}
            <Link href={`${BACK}/${headId}`} className="font-medium text-accent underline">
              güncel kaydı
            </Link>{" "}
            açın.
          </Notice>
        </div>
      )}

      <div className="mb-6 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Panel title="Özet">
          <KeyValue items={summary} />
        </Panel>

        {editable ? (
          <Panel
            title="Düzenle"
            description={qa ? "Soru, cevap ve mod değiştirilebilir." : "Başlık ve mod değiştirilebilir; kaynak yeniden işlenir."}
          >
            {usage.versioned && (
              <div className="mb-4">
                <Notice>
                  {usage.published ? "Bu kaynak yayında." : "Bu kaynak geri alınabilir bir sürümde kayıtlı."} Düzenleme <strong>yeni bir kayıt</strong> olarak işlenir; yayındaki sürüm, yeni sürüm yayınlanana kadar
                  mevcut hâlini kullanmaya devam eder.
                </Notice>
              </div>
            )}
            <SourceForm
              key={`${src.id}|${param(sp, "ok")}|${param(sp, "hata")}`}
              action={updateSource}
              idPrefix="edit"
              hidden={{ id: src.id }}
              showQa={qa}
              showTitle={!qa}
              initial={{ title: src.title, question: src.question ?? "", answer: src.answer ?? "", mode: src.mode }}
              answerLabel={src.type === "correction" ? "Doğru cevap" : "Cevap"}
              answerMax={src.type === "correction" ? 4000 : 6000}
              answerRows={5}
              submitLabel="Kaydet"
              pendingText="Kaydediliyor…"
            />
            <form action={deleteSource} className="mt-4 border-t border-line pt-4">
              <input type="hidden" name="id" value={src.id} />
              <ConfirmButton confirmText={usage.published ? "Yayında; yeni yayına kadar canlıda kalır. Silinsin mi?" : "Silinsin mi?"}>Sil</ConfirmButton>
            </form>
          </Panel>
        ) : (
          <Panel title="Düzenle">
            <p className="text-sm text-muted">Bu kayıt düzenlenemez.</p>
          </Panel>
        )}
      </div>

      {(chain.length > 1 || (versionsByChain.get(id)?.length ?? 0) > 0) && (
        <Panel className="mb-6" title="Sürümler ve geçmiş" description="Bir kaynak yayındayken düzenlenirse yeni bir kayıt açılır; eski kayıt, onu kullanan sürümler için korunur.">
          <TableWrap>
            <thead>
              <tr>
                <th className={th}>Kayıt</th>
                <th className={th}>Durum</th>
                <th className={`${th} text-right`}>Parça</th>
                <th className={th}>Oluşturuldu</th>
                <th className={th}>Kullanıldığı sürümler</th>
              </tr>
            </thead>
            <tbody>
              {chain.map((cid, i) => {
                const r = rowById.get(cid);
                if (!r) return null;
                const used = versionsByChain.get(cid) ?? [];
                const role = cid === id ? "Bu kayıt" : i < chain.indexOf(id) ? "Öncül" : "Halef";
                return (
                  <tr key={cid}>
                    <td className={td}>
                      <div className="flex flex-wrap items-center gap-2">
                        {cid === id ? <span className="font-medium">{r.title}</span> : <Link href={`${BACK}/${cid}`} className="text-accent hover:underline">{r.title}</Link>}
                        <Badge tone={cid === id ? "accent" : "neutral"}>{role}</Badge>
                        {cid === headId && <Badge tone="good">Güncel</Badge>}
                        {r.deletedAt && <Badge tone="warn">Silinmiş</Badge>}
                      </div>
                    </td>
                    <td className={td}>
                      <Badge tone={STATUS[r.status]?.tone ?? "neutral"}>{STATUS[r.status]?.label ?? r.status}</Badge>
                    </td>
                    <td className={`${td} tabular text-right`}>{fmtInt(r.chunkCount)}</td>
                    <td className={`${td} whitespace-nowrap text-muted`}>{fmtDateTime(r.createdAt)}</td>
                    <td className={td}>
                      {used.length ? (
                        <span className="flex flex-wrap gap-1.5">
                          {used.map((v) => (
                            <Link key={v.id} href={`/admin/yayin/${v.id}`} className="text-accent hover:underline">
                              v{v.number}
                            </Link>
                          ))}
                        </span>
                      ) : (
                        <span className="text-muted">Hiçbir sürümde yok</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
        </Panel>
      )}

      <Panel
        className="mb-6"
        title="Bu kaynakta ara"
        description="Yalnızca bu kaynağın parçalarında, taslak ayarlarıyla arar. Eşik altında kalanlar da gösterilir; asistan bunları kullanmaz."
      >
        <form className="flex flex-wrap gap-2" role="search">
          <input name="ara" defaultValue={query} maxLength={SEARCH_MAX_CHARS} placeholder="Örn. Çarşamba sulama yapayım mı?" className={`${inputCls} min-w-0 flex-1`} aria-label="Deneme sorusu" />
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
        {searchLimited && (
          <div className="mt-4">
            <Notice tone="warn">Çok fazla arama yaptınız. Birkaç saniye bekleyip tekrar deneyin.</Notice>
          </div>
        )}
        {query && !searchLimited && (
          <ol className="mt-4 grid gap-2">
            {hits.length ? (
              hits.map((h) => (
                <li key={h.chunkId} className={`rounded-lg border border-line p-3 ${h.relevant ? "" : "opacity-60"}`}>
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="tabular text-muted">{h.rank}.</span>
                    <Badge tone={h.relevant ? "good" : "neutral"}>{h.relevant ? "Bağlama girer" : "Bağlama girmez"}</Badge>
                    <span className="tabular ml-auto text-xs text-muted">{describeMatch(h) ?? "eşleşme yok"}</span>
                  </div>
                  <p className="mt-1.5 line-clamp-3 text-[13px] leading-relaxed text-muted">{h.content}</p>
                </li>
              ))
            ) : (
              <li className="text-sm text-muted">Bu kaynakta bu mod için eşleşen parça yok.</li>
            )}
          </ol>
        )}
      </Panel>

      <h2 className="mb-3 text-[15px] font-semibold">{`Parçalar (${chunkTotal})`}</h2>
      {chunks.length ? (
        <ol className="grid gap-2">
          {chunks.map((c) => (
            <li key={c.id} className="rounded-xl border border-line bg-surface p-4">
              <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted">
                <span className="tabular font-medium text-ink">#{c.idx + 1}</span>
                <span className="tabular">{fmtInt(c.content.length)} karakter</span>
                <Badge tone={c.hasVector ? "good" : "neutral"}>{c.hasVector ? "Vektör var" : "Vektör yok"}</Badge>
                {c.embeddingModel && <span>{c.embeddingModel}</span>}
              </div>
              {c.content.length <= PREVIEW_CHARS ? (
                <p className="text-[13px] leading-relaxed whitespace-pre-wrap">{c.content}</p>
              ) : (
                <details>
                  <summary className="cursor-pointer text-[13px] leading-relaxed whitespace-pre-wrap">
                    {c.content.slice(0, PREVIEW_CHARS)}… <span className="text-accent">tümünü göster</span>
                  </summary>
                  <p className="mt-2 text-[13px] leading-relaxed whitespace-pre-wrap">{c.content}</p>
                </details>
              )}
            </li>
          ))}
        </ol>
      ) : (
        <div className="rounded-xl border border-line bg-surface">
          <EmptyState icon={BookOpen} title="Bu kaynakta parça yok">
            {busy ? "Kaynak işleniyor; parçalar hazır olunca burada görünür." : src.status === "failed" ? "Son işlem başarısız oldu." : "Bu kayıt henüz parçalanmadı."}
          </EmptyState>
        </div>
      )}
      <Pagination basePath={`${BACK}/${id}`} params={{ ara: query, arama_mod: param(sp, "arama_mod") }} page={pg.page} pages={pg.pages} total={pg.total} noun="parça" />
    </>
  );
}
