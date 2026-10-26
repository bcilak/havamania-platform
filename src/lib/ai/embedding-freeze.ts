/*
 * Yayındaki sürümün embedding ayarını dondurma kuralları (saf mantık, veritabanı yok).
 *
 * - Sürüm yayınlandığı andaki embedding ayarını (sağlayıcı + model) saklar; sorgu
 *   vektörü yayın boyunca o modelle üretilir. Böylece sürümün kaynakları, yayın
 *   sonrası embedding değişse de eski vektörleriyle bulunmaya devam eder.
 * - Sütun boşsa (bu özellikten önce yayınlanmış sürüm) güncel ayar kullanılır; bu
 *   yüzden embedding ayarı değişmeden (ve sağlayıcı silinmeden) önce korunan
 *   sürümlerin boş sütunu o anki ayarla doldurulur (tembel dondurma, bkz. versionsToFreeze).
 * - Korunan sürümlerin (yayındaki + geri alınabilir son sürümler) dondurulmuş
 *   sağlayıcıları silinemez.
 */

import { protectedVersions } from "./kb-lifecycle";

export type EmbeddingRef = { providerId: string | null; model: string | null };

/** Vektör araması açık mı (sağlayıcı ve model birlikte seçili). */
export const isVectorOn = (e: EmbeddingRef | null | undefined): boolean => Boolean(e?.providerId && e?.model);

/** Sağlayıcı/model çifti aynı mı (ikisi de boşsa "kapalı" olarak eşit). */
export function sameEmbedding(a: EmbeddingRef, b: EmbeddingRef): boolean {
  return (a.providerId ?? null) === (b.providerId ?? null) && (a.model ?? null) === (b.model ?? null);
}

/** Yayında geçerli ayar: dondurulmuş varsa o, yoksa (eski sürüm) güncel ayar. */
export function effectiveEmbedding(frozen: EmbeddingRef | null | undefined, current: EmbeddingRef): EmbeddingRef {
  return frozen ? { providerId: frozen.providerId ?? null, model: frozen.model ?? null } : current;
}

/** Panelde gösterilecek ad: "Sağlayıcı · model" ya da "Vektör araması kapalı". */
export function embeddingLabel(e: EmbeddingRef, providers: { id: string; name: string }[]): string {
  if (!e.providerId || !e.model) return "Vektör araması kapalı (yalnızca tam metin)";
  const name = providers.find((p) => p.id === e.providerId)?.name ?? "silinmiş sağlayıcı";
  return `${name} · ${e.model}`;
}

/** Yayın anında sürüme yazılacak değer (güncel ayarın anlık görüntüsü). */
export const snapshotEmbedding = (current: EmbeddingRef): EmbeddingRef => ({ providerId: current.providerId ?? null, model: current.model ?? null });

/**
 * Tembel dondurma: embedding ayarı değişmeden ya da sağlayıcı silinmeden önce, korunan
 * sürümlerden sütunu boş olanlar (bu özellikten önce yayınlananlar) hâlâ güncel ayarla
 * çalışıyordur. Bunların id'leri döner; çağıran onlara o anki (eski) ayarı yazar.
 * Böylece değişiklikten sonra canlı sessizce yeni modele geçmez.
 */
export function versionsToFreeze(opts: {
  versions: { id: string; number: number; embedding: EmbeddingRef | null }[];
  publishedVersionId: string | null;
  keep?: number;
}): string[] {
  return protectedVersions(opts)
    .filter((v) => !v.embedding)
    .map((v) => v.id);
}

/**
 * Silinemeyen sağlayıcılar: yayındaki sürümün ve geri alınabilir son sürümlerin
 * dondurulmuş embedding sağlayıcısı. Boş sütunlu sürümler önce versionsToFreeze ile
 * doldurulmalıdır; aksi halde bu kümeye girmezler.
 */
export function protectedEmbeddingProviders(opts: {
  versions: { id: string; number: number; embedding: EmbeddingRef | null }[];
  publishedVersionId: string | null;
  keep?: number;
}): Map<string, number[]> {
  const out = new Map<string, number[]>();
  for (const v of protectedVersions(opts)) {
    const id = v.embedding?.providerId;
    if (!id) continue;
    out.set(id, [...(out.get(id) ?? []), v.number].sort((a, b) => a - b));
  }
  return out;
}

/**
 * Yalnızca düzeltme yayınında: yayındaki sürümün dondurulmuş modeli güncel ayardan
 * farklıysa yeni düzeltmeler (güncel modelle vektörlenmiş) eski modelle bulunamaz.
 */
export function correctionsNeedFullPublish(frozen: EmbeddingRef | null | undefined, current: EmbeddingRef): boolean {
  return frozen ? !sameEmbedding(frozen, current) : false;
}

/**
 * Yayın kapısı: yayın embedding modelini değiştirecekse (yayındaki sürümün dondurulmuş
 * modeli güncel ayardan farklı) ve işlenmeyi bekleyen kaynak varsa o sayıyı döner; bu
 * kaynaklar yeni modelle vektörlenmediği için canlıda yalnızca tam metinle bulunur.
 * 0 = kapı yok. İlk yayında (yayındaki sürüm yok) kapı yoktur.
 */
export function pendingIndexOnModelSwitch(opts: { hasPublished: boolean; frozen: EmbeddingRef | null | undefined; current: EmbeddingRef; pending: number }): number {
  if (!opts.hasPublished || opts.pending <= 0) return 0;
  return sameEmbedding(effectiveEmbedding(opts.frozen, opts.current), opts.current) ? 0 : opts.pending;
}
