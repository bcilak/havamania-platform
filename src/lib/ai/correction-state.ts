/*
 * Düzeltme/SSS kaynaklarının "yayın durumu" ve "bekleyen düzeltmeleri yayına al"
 * kuralı. Yayına girecek kaynak kuralı kb-lifecycle'taki publishableSourceIds ile
 * aynıdır; burada yeni bir kural yoktur. Veritabanı içermez.
 */
import { lineageOf, publishableSourceIds, type KbRow } from "./kb-lifecycle";

export type CorrectionSource = KbRow & { type: string; status: string };

export type CorrectionState = "processing" | "failed" | "published_stale" | "pending" | "published" | "unusable" | "missing";

/** Bekleyen düzeltmeler yalnızca bu türlerden alınır; dosya ve URL kaynakları asla. */
export const CORRECTION_TYPES = ["qa", "correction"];

/**
 * - missing: kaynak yok ya da taslaktan silinmiş
 * - failed / processing: işlem bitmemiş
 * - published_stale: son işlem başarısız ama yayındaki sürüm önceki halini kullanıyor
 * - published: yayındaki sürümün kaynak listesinde
 * - pending: hazır ve yeni yayına girecek ama yayındaki sürümde yok
 * - unusable: hazır görünüyor ama yayına girmeyecek (içeriği yok ya da yerine geçeni var)
 */
export function correctionState(
  src: CorrectionSource | undefined,
  publishedIds: ReadonlySet<string>,
  publishableIds: ReadonlySet<string>,
  staleLiveIds: ReadonlySet<string> = new Set(),
): CorrectionState {
  if (!src || src.deletedAt) return "missing";
  if (src.status === "failed") return staleLiveIds.has(src.id) ? "published_stale" : "failed";
  if (src.status !== "ready") return "processing";
  if (publishedIds.has(src.id)) return "published";
  return publishableIds.has(src.id) ? "pending" : "unusable";
}

export function stateBadge(state: CorrectionState, error?: string | null): { label: string; tone: "good" | "warn" | "bad" | "neutral" } {
  switch (state) {
    case "processing":
      return { label: "İşleniyor", tone: "warn" };
    case "failed":
      return { label: `Hata: ${error || "bilinmeyen hata"}`, tone: "bad" };
    case "published_stale":
      return { label: `Yayında (son işlem başarısız: ${error || "bilinmeyen hata"})`, tone: "warn" };
    case "pending":
      return { label: "Yayın bekliyor", tone: "warn" };
    case "published":
      return { label: "Yayında", tone: "good" };
    case "unusable":
      return { label: "Yayına girmeyecek", tone: "neutral" };
    case "missing":
      return { label: "Kaynak silinmiş", tone: "bad" };
  }
}

/** Kaynak satırlarından id → durum eşlemesi için ortak bağlam. */
export function stateContext(rows: CorrectionSource[], publishedIds: readonly string[]) {
  const published = new Set(publishedIds);
  // Başarısız satırın öncülü yayındaysa yayın eski içeriği kullanmaya devam eder.
  const staleLive = new Set(
    rows
      .filter((r) => r.status === "failed" && !r.deletedAt && lineageOf(r.id, rows).some((id) => id !== r.id && published.has(id)))
      .map((r) => r.id),
  );
  return {
    byId: new Map(rows.map((r) => [r.id, r])),
    published,
    publishable: new Set(publishableSourceIds(rows)),
    staleLive,
  };
}

/** Yayını bekleyen düzeltme/SSS kaynakları (durumu "pending" olanlar). */
export function pendingCorrectionIds(rows: CorrectionSource[], publishedIds: readonly string[]): string[] {
  const ctx = stateContext(rows, publishedIds);
  return rows.filter((r) => CORRECTION_TYPES.includes(r.type) && correctionState(r, ctx.published, ctx.publishable, ctx.staleLive) === "pending").map((r) => r.id);
}

/**
 * Yayındaki liste + bekleyen düzeltmeler. Bir düzeltme yayındaki bir satırın
 * yenilenmiş hâliyse eski satır listeden çıkar (aynı içerik iki kez girmez).
 * Başka hiçbir yayındaki kaynağa dokunulmaz.
 */
export function withPendingCorrections(rows: CorrectionSource[], publishedIds: readonly string[]): { kbSourceIds: string[]; added: string[]; replaced: string[] } {
  const added = pendingCorrectionIds(rows, publishedIds);
  const drop = new Set<string>();
  for (const id of added) for (const old of lineageOf(id, rows)) if (old !== id) drop.add(old);
  const kept = publishedIds.filter((id) => !drop.has(id));
  return { kbSourceIds: [...kept, ...added], added, replaced: publishedIds.filter((id) => drop.has(id)) };
}
