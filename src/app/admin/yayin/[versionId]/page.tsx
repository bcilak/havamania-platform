import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { ChevronLeft, FlaskConical, Library } from "lucide-react";
import { db } from "@/db";
import { kbSources, providers } from "@/db/schema";
import { CountedTextarea, SubmitButton } from "@/components/client";
import { Badge, btn, cx, EmptyState, Field, Flash, KeyValue, ModeBadge, PageHeader, Panel, selectCls, TableWrap, td, textareaCls, th } from "@/components/ui";
import { embeddingLabel, snapshotEmbedding, type EmbeddingRef } from "@/lib/ai/embedding-freeze";
import { diffSources, indexRows, publishableSourceIds, sourceState, type KbRow, type SourceState } from "@/lib/ai/kb-lifecycle";
import { requireAdmin } from "@/lib/auth";
import { getMainBot, getVersion, listVersionSummaries } from "@/lib/bot";
import { MODES, TONES, TOOLS, toneRule, type BotConfig } from "@/lib/bot-config";
import { diffConfigs, diffEmbeddings, type ConfigChange, type LineOp } from "@/lib/config-diff";
import { param, type SearchParams } from "@/lib/form";
import { VERSION_NOTE_MAX } from "@/lib/form-limits";
import { fmtDateTime, fmtInt } from "@/lib/format";
import { can } from "@/lib/roles";
import { getSetting } from "@/lib/settings";
import { versionCounts } from "@/lib/stats";
import { fmtPct, versionQuality } from "@/lib/trends";
import { saveVersionNote } from "../actions";

export const metadata = { title: "Sürüm ayrıntısı" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Kaynak listesi sayfa boyutu; bir sürümde yüzlerce kaynak olabilir. */
const SOURCE_PAGE = 50;
/** Karşılaştırma seçicisinde sunulan son sürüm sayısı (daha eskisi adresten verilebilir). */
const PICKER_LIMIT = 100;

const TYPE_LABEL: Record<string, string> = { file: "Dosya", url: "Web sayfası", qa: "SSS", correction: "Düzeltme", cms: "Site içeriği" };

const STATE_BADGE: Record<SourceState, { label: string; tone: "good" | "warn" | "bad" | "neutral" } | null> = {
  active: null,
  deleted: { label: "Silindi, bu sürüm hâlâ kullanıyor", tone: "warn" },
  superseded: { label: "Yeniden işlendi, yenisi var", tone: "neutral" },
  missing: { label: "Artık yok", tone: "bad" },
};

type Side = { label: string; config: BotConfig; sourceIds: string[]; embedding: EmbeddingRef | null };

function LineDiffView({ lines }: { lines: LineOp[] }) {
  return (
    <pre className="max-h-72 overflow-auto rounded-lg bg-sunken p-3 font-mono text-[12px] leading-relaxed whitespace-pre-wrap">
      {lines.map((l, i) => (
        <div key={i} className={cx(l.op === "add" && "bg-good-soft text-good", l.op === "del" && "bg-bad-soft text-bad")}>
          {l.op === "add" ? "+ " : l.op === "del" ? "− " : "  "}
          {l.text}
        </div>
      ))}
    </pre>
  );
}

function ChangeList({ changes }: { changes: ConfigChange[] }) {
  if (!changes.length) return <p className="text-sm text-muted">Ayarlarda fark yok.</p>;
  return (
    <ul className="grid gap-2 text-sm">
      {changes.map((c, i) => (
        <li key={i}>
          <div className="flex gap-2">
            <span className="text-accent">•</span>
            {c.summary}
          </div>
          {c.lines && c.lines.some((l) => l.op !== "same") && (
            <details className="mt-1.5 ml-4">
              <summary className="cursor-pointer text-xs text-muted">Satır farkını göster</summary>
              <div className="mt-1.5">
                <LineDiffView lines={c.lines} />
              </div>
            </details>
          )}
        </li>
      ))}
    </ul>
  );
}

function Text({ value }: { value: string }) {
  return <pre className="max-h-64 overflow-auto rounded-lg bg-sunken p-3 font-mono text-[12px] leading-relaxed whitespace-pre-wrap">{value || "—"}</pre>;
}

/** Sürümün dondurulmuş ayarları, salt okunur. */
function ConfigView({ config, providerNames }: { config: BotConfig; providerNames: Map<string, string> }) {
  return (
    <div className="grid gap-4">
      {MODES.map((m) => {
        const c = config.modes[m];
        return (
          <Panel
            key={m}
            title={
              <span className="inline-flex items-center gap-2">
                <ModeBadge mode={m} /> {c.label} {!c.enabled && <Badge>Kapalı</Badge>}
              </span>
            }
          >
            <div className="grid gap-4">
              <KeyValue
                items={[
                  ["Üslup", TONES[c.tone]?.label ?? c.tone],
                  ["Model", c.model ? `${c.providerId ? (providerNames.get(c.providerId) ?? "silinmiş sağlayıcı") : "sağlayıcı yok"} · ${c.model}` : "Seçilmemiş"],
                  ["Temperature", String(c.temperature)],
                  ["En uzun cevap", c.maxOutputTokens === undefined ? "Sınır yok (bu alan eklenmeden yayınlandı)" : `${c.maxOutputTokens} token`],
                  ["Araçlar", c.tools.length ? c.tools.map((t) => TOOLS[t]?.label ?? t).join(", ") : "Yok"],
                  ["Karşılama", c.greeting],
                  ["Öneri soruları", c.suggestions.length ? c.suggestions.join(" · ") : "—"],
                ]}
              />
              <details>
                <summary className="cursor-pointer text-sm font-medium">Talimat</summary>
                <div className="mt-2">
                  <Text value={c.instructions} />
                </div>
              </details>
              <details>
                <summary className="cursor-pointer text-sm font-medium">Örnek konuşmalar ({c.examples.length})</summary>
                <div className="mt-2 grid gap-2">
                  {c.examples.length ? c.examples.map((e, i) => <Text key={i} value={`Kullanıcı: ${e.user}\nAsistan: ${e.assistant}`} />) : <p className="text-sm text-muted">Yok.</p>}
                </div>
              </details>
            </div>
          </Panel>
        );
      })}
      <Panel title="Ortak ayarlar">
        <div className="grid gap-4">
          <KeyValue
            items={[
              ["Yasak konular", config.blockedTopics.length ? config.blockedTopics.join(", ") : "Yok"],
              ["Aramada yok sayılan kelimeler", config.domainStopwords.length ? config.domainStopwords.join(", ") : "Yok"],
              ["Modele giden son mesaj", String(config.historyWindow)],
              ["Günlük mesaj sınırı", String(config.maxMessagesPerDay)],
              ["Fotoğraf", config.photosEnabled ? `Açık (en çok ${config.maxPhotoMb} MB)` : "Kapalı"],
              ["Bilgi tabanından parça", String(config.retrievalTopK)],
              ["İlgililik eşiği", String(config.retrievalMinSimilarity)],
              ["Kaynak başına en çok parça", String(config.retrievalPerSourceMax)],
              ["Hata mesajı", config.fallbackMessage],
            ]}
          />
          <details>
            <summary className="cursor-pointer text-sm font-medium">Ortak kurallar</summary>
            <div className="mt-2">
              <Text value={config.guardrails} />
            </div>
          </details>
          <details>
            <summary className="cursor-pointer text-sm font-medium">Ton metinleri</summary>
            <div className="mt-2 grid gap-2">
              {(Object.keys(TONES) as (keyof typeof TONES)[]).map((t) => (
                <div key={t}>
                  <div className="mb-1 text-xs font-medium text-muted">
                    {TONES[t].label} {config.toneOverrides[t] ? "(düzenlenmiş)" : "(varsayılan)"}
                  </div>
                  <Text value={toneRule(config.toneOverrides, t)} />
                </div>
              ))}
            </div>
          </details>
        </div>
      </Panel>
    </div>
  );
}

export default async function VersionDetailPage({ params, searchParams }: { params: Promise<{ versionId: string }>; searchParams: SearchParams }) {
  const admin = await requireAdmin("publish");
  const { versionId } = await params;
  if (!UUID.test(versionId)) notFound();
  const sp = await searchParams;
  const bot = await getMainBot();
  const version = await getVersion(bot.id, versionId);
  if (!version) notFound();

  const rows = await db
    .select({ id: kbSources.id, title: kbSources.title, type: kbSources.type, mode: kbSources.mode, deletedAt: kbSources.deletedAt, supersededBy: kbSources.supersededBy, chunkCount: kbSources.chunkCount, status: kbSources.status })
    .from(kbSources)
    .where(eq(kbSources.botId, bot.id));
  const providerRows = await db.select({ id: providers.id, name: providers.name }).from(providers);
  const providerNames = new Map(providerRows.map((p) => [p.id, p.name]));
  const byId = indexRows(rows as KbRow[]);
  const info = new Map(rows.map((r) => [r.id, r]));
  const titleOf = (id: string) => info.get(id)?.title ?? "artık yok";
  const embLabel = (e: EmbeddingRef) => embeddingLabel(e, providerRows);

  const [quality] = versionQuality(await versionCounts({ versionNumber: version.number, limit: 1 }));

  const isPublished = version.id === bot.publishedVersionId;
  const canTrain = can(admin.role, "training");
  const self = `/admin/yayin/${version.id}`;

  /* ---------- Karşılaştırma ---------- */
  const cmpParam = param(sp, "karsilastir");
  const mine: Side = { label: `v${version.number}`, config: version.config, sourceIds: version.kbSourceIds, embedding: version.embedding };
  let from: Side | null = null;
  let to: Side | null = null;
  let cmpMissing = false;
  if (cmpParam === "taslak") {
    from = mine;
    to = { label: "Taslak", config: bot.draftConfig, sourceIds: publishableSourceIds(rows as KbRow[]), embedding: snapshotEmbedding(await getSetting("embedding")) };
  } else if (cmpParam && cmpParam !== version.id) {
    const other = UUID.test(cmpParam) ? await getVersion(bot.id, cmpParam) : null;
    if (!other) cmpMissing = true;
    else {
      const o: Side = { label: `v${other.number}`, config: other.config, sourceIds: other.kbSourceIds, embedding: other.embedding };
      [from, to] = other.number < version.number ? [o, mine] : [mine, o];
    }
  }
  const compare =
    from && to
      ? {
          from,
          to,
          changes: diffConfigs(from.config, to.config),
          kb: diffSources(from.sourceIds, to.sourceIds, rows as KbRow[]),
          embedding: diffEmbeddings(from.embedding, to.embedding, embLabel),
        }
      : null;

  const pickerVersions = (await listVersionSummaries(bot.id, { limit: PICKER_LIMIT })).filter((v) => v.id !== version.id);

  /* ---------- Kaynak listesi (sayfalı) ---------- */
  const total = version.kbSourceIds.length;
  const pages = Math.max(1, Math.ceil(total / SOURCE_PAGE));
  const page = Math.min(pages, Math.max(1, Number(param(sp, "kaynak")) || 1));
  const pageIds = version.kbSourceIds.slice((page - 1) * SOURCE_PAGE, page * SOURCE_PAGE);
  const qs = (p: number) => `${self}?${new URLSearchParams({ ...(cmpParam ? { karsilastir: cmpParam } : {}), kaynak: String(p) })}`;

  return (
    <>
      <Link href="/admin/yayin" className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
        <ChevronLeft className="size-4" /> Sürümler
      </Link>
      <PageHeader
        title={
          <span className="inline-flex flex-wrap items-center gap-3">
            v{version.number} {isPublished && <Badge tone="good">Yayında</Badge>}
          </span>
        }
        description="Sürüm yayınlandığı andaki ayarları, bilgi tabanı kaynak listesini ve embedding modelini dondurur. Bu sayfa salt okunurdur; yalnızca not düzenlenebilir."
        actions={
          canTrain && (
            <Link href={`/admin/egitim/test?surum=${version.id}`} className={btn("secondary", "sm")}>
              <FlaskConical className="size-3.5" /> Bu sürümle test alanında dene
            </Link>
          )
        }
      />
      <Flash sp={sp} />

      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <Panel title="Özet">
          <KeyValue
            items={[
              ["Yayınlanma", fmtDateTime(version.publishedAt)],
              ["Yayınlayan", version.publishedBy ?? "—"],
              ["Bilgi tabanı", `${total} kaynak`],
              [
                "Embedding",
                version.embedding ? embLabel(version.embedding) : <span className="text-muted">Yayın anı kaydı yok (güncel embedding ayarıyla çalışır)</span>,
              ],
            ]}
          />
        </Panel>
        <Panel title="Sürüm notu" description="Not yayınlandıktan sonra da düzenlenebilir; eski ve yeni hali denetim kaydına yazılır.">
          <form action={saveVersionNote} className="grid gap-3">
            <input type="hidden" name="versionId" value={version.id} />
            <CountedTextarea name="note" rows={3} max={VERSION_NOTE_MAX} defaultValue={version.note ?? ""} className={textareaCls} aria-label="Sürüm notu" />
            <div>
              <SubmitButton variant="secondary" size="sm" pendingText="Kaydediliyor…">
                Notu kaydet
              </SubmitButton>
            </div>
          </form>
        </Panel>
      </div>

      <Panel
        title="Kalite özeti"
        description="Bu sürümle yapılan gerçek kullanıcı konuşmaları (tüm zamanlar; test alanı ve örnek veri hariç)."
        className="mb-6"
      >
        {quality ? (
          <KeyValue
            items={[
              ["Konuşma", fmtInt(quality.conversations)],
              ["Asistan cevabı", fmtInt(quality.assistant)],
              ["Olumsuz geri bildirim", `${fmtPct(quality.negativePct)} (${fmtInt(quality.negative)} / ${fmtInt(quality.assistant)})`],
              ["Cevapsız", `${fmtPct(quality.unansweredPct)} (${fmtInt(quality.unanswered)} / ${fmtInt(quality.assistant)})`],
            ]}
          />
        ) : (
          <p className="text-sm text-muted">Bu sürümle henüz gerçek kullanıcı cevabı yok.</p>
        )}
      </Panel>

      <Panel title="Başka bir sürümle karşılaştır" description="Ayar farkları, bilgi tabanında eklenen / çıkan / yeniden işlenen kaynaklar ve embedding modeli. Fark eskiden yeniye gösterilir." className="mb-6">
        <form method="get" className="flex flex-wrap items-end gap-2">
          <Field label="Karşılaştırılacak" htmlFor="karsilastir" className="min-w-0 flex-1 sm:max-w-sm">
            <select id="karsilastir" name="karsilastir" defaultValue={cmpParam} className={selectCls}>
              <option value="">Seçin…</option>
              <option value="taslak">Taslak (yayınlanmamış değişiklikler)</option>
              {pickerVersions.map((v) => (
                <option key={v.id} value={v.id}>
                  v{v.number} · {fmtDateTime(v.publishedAt)}
                  {v.id === bot.publishedVersionId ? " · yayında" : ""}
                </option>
              ))}
            </select>
          </Field>
          <button className={btn("secondary")} type="submit">
            Karşılaştır
          </button>
        </form>
        {cmpMissing && <p className="mt-3 text-sm text-warn">Karşılaştırılacak sürüm bulunamadı.</p>}

        {compare && (
          <div className="mt-5 grid gap-5 border-t border-line pt-5">
            <h3 className="text-[15px] font-semibold">
              {`${compare.from.label} → ${compare.to.label}`}
            </h3>
            <section>
              <h4 className="mb-2 text-sm font-semibold">Ayarlar</h4>
              <ChangeList changes={compare.changes} />
            </section>
            <section>
              <h4 className="mb-2 text-sm font-semibold">Bilgi tabanı</h4>
              {compare.kb.added.length || compare.kb.replaced.length || compare.kb.removed.length ? (
                <ul className="grid gap-1.5 text-sm">
                  {compare.kb.added.map((id) => (
                    <li key={`a${id}`} className="flex flex-wrap items-center gap-2">
                      <Badge tone="good">Eklendi</Badge> {titleOf(id)}
                    </li>
                  ))}
                  {compare.kb.replaced.map((r) => (
                    <li key={`r${r.from}`} className="flex flex-wrap items-center gap-2">
                      <Badge tone="accent">Yeniden işlendi</Badge> {titleOf(r.from)} → {titleOf(r.to)}
                    </li>
                  ))}
                  {compare.kb.removed.map((id) => (
                    <li key={`d${id}`} className="flex flex-wrap items-center gap-2">
                      <Badge tone="bad">Çıkarıldı</Badge> {titleOf(id)}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted">Kaynak listesi aynı.</p>
              )}
            </section>
            <section>
              <h4 className="mb-2 text-sm font-semibold">Embedding modeli</h4>
              <p className={cx("text-sm", compare.embedding.status === "unknown" && "text-muted")}>{compare.embedding.text}</p>
            </section>
          </div>
        )}
      </Panel>

      <h2 className="mb-3 text-[15px] font-semibold">Ayarlar (dondurulmuş)</h2>
      <div className="mb-8">
        <ConfigView config={version.config} providerNames={providerNames} />
      </div>

      <h2 className="mb-3 text-[15px] font-semibold">Bilgi tabanı kaynakları ({total})</h2>
      {total === 0 ? (
        <div className="rounded-xl border border-line bg-surface">
          <EmptyState icon={Library} title="Bu sürümde kaynak yok">Sürüm yayınlandığında bilgi tabanında kullanılabilir kaynak yoktu.</EmptyState>
        </div>
      ) : (
        <>
          <TableWrap>
            <thead>
              <tr>
                <th className={th}>Başlık</th>
                <th className={th}>Tür</th>
                <th className={th}>Mod</th>
                <th className={th}>Şu anki durum</th>
              </tr>
            </thead>
            <tbody>
              {pageIds.map((id) => {
                const r = info.get(id);
                const badge = STATE_BADGE[sourceState(id, byId)];
                return (
                  <tr key={id}>
                    <td className={td}>{r?.title ?? <span className="text-muted">Artık yok</span>}</td>
                    <td className={`${td} text-muted`}>{r ? (TYPE_LABEL[r.type] ?? r.type) : "—"}</td>
                    <td className={`${td} text-muted`}>{r ? (r.mode === "all" ? "Tümü" : r.mode) : "—"}</td>
                    <td className={td}>{badge ? <Badge tone={badge.tone}>{badge.label}</Badge> : <span className="text-muted">Etkin</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
          {pages > 1 && (
            <div className="mt-4 flex items-center justify-between text-sm text-muted">
              <span className="tabular">
                {total} kaynak · sayfa {page}/{pages}
              </span>
              <div className="flex gap-2">
                {page > 1 && (
                  <Link className={btn("secondary", "sm")} href={qs(page - 1)}>
                    Önceki
                  </Link>
                )}
                {page < pages && (
                  <Link className={btn("secondary", "sm")} href={qs(page + 1)}>
                    Sonraki
                  </Link>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}
