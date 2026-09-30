import { desc, eq, sql } from "drizzle-orm";
import { BookOpen, FileText, Globe, MessageCircle, PenLine, Search, Sparkles } from "lucide-react";
import { db } from "@/db";
import { kbSources, type ChatMode, type KbSourceType } from "@/db/schema";
import { AutoRefresh } from "@/components/admin/AutoRefresh";
import { ConfirmButton, SubmitButton } from "@/components/client";
import { Badge, btn, EmptyState, Field, Flash, inputCls, Notice, PageHeader, Panel, selectCls, TableWrap, Tabs, td, textareaCls, th } from "@/components/ui";
import { searchKnowledge } from "@/lib/ai/retrieval";
import { requireAdmin } from "@/lib/auth";
import { getMainBot, getPublishedVersion } from "@/lib/bot";
import { MODES, MODE_META } from "@/lib/bot-config";
import { param, type SearchParams } from "@/lib/form";
import { fmtInt, fmtRelative } from "@/lib/format";
import { getSetting } from "@/lib/settings";
import { addQa, addUrl, deleteSource, importCms, reprocess, uploadSource } from "./actions";

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
  const type = param(sp, "tur") as KbSourceType | "";
  const query = param(sp, "ara");
  const queryMode = (param(sp, "arama_mod") || "genel") as ChatMode;

  const all = await db.select().from(kbSources).where(eq(kbSources.botId, bot.id)).orderBy(desc(kbSources.updatedAt));
  const rows = type ? all.filter((s) => s.type === type) : all;
  const counts = Object.fromEntries(Object.keys(TYPE_META).map((t) => [t, all.filter((s) => s.type === t).length]));
  const busy = all.some((s) => s.status === "pending" || s.status === "processing");
  const embedding = await getSetting("embedding");
  const [{ chunks }] = await db.select({ chunks: sql<number>`count(*)::int` }).from(sql`kb_chunks`).where(sql`bot_id = ${bot.id}`);
  const hits = query ? await searchKnowledge({ botId: bot.id, mode: queryMode, query, allowedSourceIds: null, topK: 6 }) : [];

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

      <div className="mb-5">
        {embedding.providerId && embedding.model ? (
          <Notice>
            Arama <strong>vektör + Türkçe tam metin</strong> ile yapılıyor ({embedding.model}). Toplam {fmtInt(chunks)} parça.
          </Notice>
        ) : (
          <Notice tone="warn">
            Embedding modeli seçilmediği için yalnızca <strong>Türkçe tam metin araması</strong> yapılıyor. Anlamca yakın ama farklı kelimelerle sorulan
            soruları yakalamak için{" "}
            <a href="/admin/ayarlar/modeller#embedding" className="font-medium text-accent underline">
              bir embedding modeli seçin
            </a>
            ; ardından kaynaklar kendiliğinden yeniden işlenir.
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
          <form action={addQa} className="grid gap-3">
            <Field label="Soru" htmlFor="q-question">
              <input id="q-question" name="question" required defaultValue={param(sp, "soru")} className={inputCls} />
            </Field>
            <Field label="Cevap" htmlFor="q-answer">
              <textarea id="q-answer" name="answer" rows={3} required className={textareaCls} />
            </Field>
            <Field label="Geçerli olduğu mod" htmlFor="q-mode">
              <ModeSelect id="q-mode" defaultValue={param(sp, "mod")} />
            </Field>
            <SubmitButton pendingText="Ekleniyor…">Ekle</SubmitButton>
          </form>
        </Panel>
      </div>

      <Tabs
        items={[
          { href: "/admin/egitim/bilgi-tabani", label: "Tümü", active: !type, count: all.length },
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
              return (
                <tr key={s.id}>
                  <td className={td}>
                    <div className="flex items-start gap-2.5">
                      <T.icon className="mt-0.5 size-4 shrink-0 text-muted" />
                      <div className="min-w-0">
                        <div className="font-medium break-words">{s.title}</div>
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
                      {s.status === "ready" && <Badge tone={inPublished.has(s.id) ? "accent" : "neutral"}>{inPublished.has(s.id) ? "Yayında" : "Yayın bekliyor"}</Badge>}
                      {s.error && <span className="max-w-56 text-xs text-bad">{s.error}</span>}
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
                        <ConfirmButton confirmText="Silinsin mi?">Sil</ConfirmButton>
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
                    <span className="tabular ml-auto text-xs text-muted">benzerlik {Math.round(h.score * 100)}</span>
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
