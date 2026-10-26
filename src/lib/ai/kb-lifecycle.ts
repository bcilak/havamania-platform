/*
 * Bilgi tabanı yaşam döngüsünün saf kuralları (kaynak düzeyinde dondurma).
 * Veritabanı içermez, birim testle doğrulanır; yazan kısım lib/kb.ts'tedir.
 *
 * - Yayındaki sürüm kendi kbSourceIds listesindeki satırları kullanır; satırlar
 *   yayın dışında silinmez ve değiştirilmez.
 * - Silme: sürümlerde geçen kaynak yumuşak silinir (deletedAt), diğerleri fiziksel.
 * - Yeniden işleme: yayındaki kaynak için yeni bir satır (halef) açılır, eskisi
 *   supersededBy ile ona bağlanır. Halef kullanılabilir olunca taslak onu görür.
 */

export type KbRow = {
  id: string;
  deletedAt: Date | null;
  supersededBy: string | null;
  chunkCount: number;
  /** pending | processing | ready | failed (KbStatus). */
  status: string;
};

/** Geri alınabilir tutulan son sürüm sayısı (yayındaki dahil). */
export const KEEP_VERSIONS = 10;

const usable = (r: KbRow | undefined): boolean => Boolean(r && !r.deletedAt && r.chunkCount > 0);

/** İşlenmekte olan satırın parçaları yarım/eski olabilir; yeni bir sürüme girmez. */
const settled = (r: KbRow): boolean => r.status !== "pending" && r.status !== "processing";

/** Yeni sürüme girebilir: silinmemiş, içeriği olan ve işlemi sürmeyen. */
const publishable = (r: KbRow | undefined): boolean => usable(r) && settled(r as KbRow);

/**
 * Taslakta geçerli mi: silinmemiş ve kullanılabilir bir halefi yok. Halef henüz
 * içeriksizse (işleniyor/başarısız) eski satır geçerli kalır. Halef satırı
 * temizlenmişse (kayıp bağ) eski satır da düşmüş sayılır. `isUsable` yayın
 * kuralında halefin "kullanılabilir" tanımını sıkılaştırır.
 */
export function isEffective(row: KbRow, byId: Map<string, KbRow>, isUsable: (r: KbRow | undefined) => boolean = usable): boolean {
  if (row.deletedAt) return false;
  if (!row.supersededBy) return true;
  const next = byId.get(row.supersededBy);
  return next !== undefined && !isUsable(next);
}

const indexRows = (rows: KbRow[]) => new Map(rows.map((r) => [r.id, r]));

/** Taslak aramasının kapsadığı kaynaklar (parçası olmayanlar zaten sonuç vermez). */
export function draftSourceIds(rows: KbRow[]): string[] {
  const byId = indexRows(rows);
  return rows.filter((r) => isEffective(r, byId)).map((r) => r.id);
}

/**
 * Yeni bir sürüme girecek kaynaklar: taslakta geçerli, içeriği olan ve işlemi
 * bitmiş olanlar. Yerinde yeniden işlenen (pending/processing) satır, işlem
 * bitene kadar yayına girmez; halefi işlenen satır eski haliyle girmeye devam eder.
 */
export function publishableSourceIds(rows: KbRow[]): string[] {
  const byId = indexRows(rows);
  return rows.filter((r) => publishable(r) && isEffective(r, byId, publishable)).map((r) => r.id);
}

/**
 * İşlenmeyi bekleyen kaynak sayısı: silinmemiş zincir başlarından `pending`/`processing`
 * olanlar (yeniden indeksleme sürüyor; halefi işlenen kaynağın başı halefidir).
 * Embedding modeli değişmişken bunlar yayına eski vektörleriyle girer ya da girmez.
 */
export function pendingIndexCount(rows: KbRow[]): number {
  return rows.filter((r) => !r.deletedAt && !r.supersededBy && !settled(r)).length;
}

/** Korunan sürümler: yayındaki sürüm ve son `keep` sürüm (geri alınabilir olanlar). */
export function protectedVersions<V extends { id: string; number: number }>(opts: {
  versions: V[];
  publishedVersionId: string | null;
  keep?: number;
}): V[] {
  const keep = opts.keep ?? KEEP_VERSIONS;
  const out = [...opts.versions].sort((a, b) => b.number - a.number).slice(0, keep);
  const published = opts.versions.find((v) => v.id === opts.publishedVersionId);
  if (published && !out.includes(published)) out.push(published);
  return out;
}

/** Yayındaki sürümün ve son `keep` sürümün kaynakları; bunlar fiziksel silinmez. */
export function protectedSourceIds(opts: {
  versions: { id: string; number: number; kbSourceIds: string[] }[];
  publishedVersionId: string | null;
  keep?: number;
}): Set<string> {
  const out = new Set<string>();
  for (const v of protectedVersions(opts)) for (const id of v.kbSourceIds) out.add(id);
  return out;
}

/** Bir satırın sürekli halefine kadar zincirdeki en son (baş) satırı. */
export function headOf(id: string, rows: KbRow[]): string {
  const byId = indexRows(rows);
  const seen = new Set<string>();
  let cur = id;
  while (!seen.has(cur)) {
    seen.add(cur);
    const next = byId.get(cur)?.supersededBy;
    if (!next || !byId.has(next)) break;
    cur = next;
  }
  return cur;
}

/** Satırın kendisi ve ona giden tüm öncekiler (halef zinciri geriye doğru). */
export function lineageOf(id: string, rows: KbRow[]): string[] {
  const out = [id];
  const seen = new Set(out);
  for (let i = 0; i < out.length; i++) {
    for (const r of rows) {
      if (r.supersededBy === out[i] && !seen.has(r.id)) {
        seen.add(r.id);
        out.push(r.id);
      }
    }
  }
  return out;
}

export type RemovalPlan = {
  /** Korunan satırlar: deletedAt yazılır, yayında kullanılmaya devam eder. */
  soft: string[];
  /** Hiçbir sürümde olmayanlar: fiziksel silinir. */
  hard: string[];
  /** Yumuşak silinenlerden biri şu an yayındaki sürümde mi. */
  live: boolean;
};

/** Kaynağı ve eski halini (zincir) siler; sürümlerde geçenler yumuşak silinir. */
export function planRemoval(opts: {
  id: string;
  rows: KbRow[];
  protectedIds: Set<string>;
  publishedIds: Set<string>;
}): RemovalPlan {
  const byId = indexRows(opts.rows);
  const plan: RemovalPlan = { soft: [], hard: [], live: false };
  for (const id of lineageOf(opts.id, opts.rows)) {
    if (opts.protectedIds.has(id)) {
      if (byId.get(id)?.deletedAt) continue;
      plan.soft.push(id);
      if (opts.publishedIds.has(id)) plan.live = true;
    } else {
      plan.hard.push(id);
    }
  }
  return plan;
}

/** "Temizle": taslakta geçerli olmayan ve hiçbir korunan sürümde yer almayan satırlar. */
export function planPurge(rows: KbRow[], protectedIds: Set<string>): string[] {
  const byId = indexRows(rows);
  return rows.filter((r) => !isEffective(r, byId) && !protectedIds.has(r.id)).map((r) => r.id);
}

export type SourceDiff = {
  /** Yeni eklenecek (bir kaynağın yenilenmiş hali olmayan). */
  added: string[];
  /** Yeniden işlenmiş: yayındaki eski satır → taslaktaki halef. */
  replaced: { from: string; to: string }[];
  /** Yayından çıkacak (silinmiş ya da içeriği kalmamış). */
  removed: string[];
};

/** Yayındaki sürümün kaynak listesi ile bir sonraki yayının listesi arasındaki fark. */
export function diffSources(publishedIds: string[], nextIds: string[], rows: KbRow[]): SourceDiff {
  const pub = new Set(publishedIds);
  const next = new Set(nextIds);
  const replaced: SourceDiff["replaced"] = [];
  const replacedTo = new Set<string>();
  const removed: string[] = [];
  for (const id of publishedIds) {
    if (next.has(id)) continue;
    const to = headOf(id, rows);
    if (to !== id && next.has(to) && !pub.has(to)) {
      replaced.push({ from: id, to });
      replacedTo.add(to);
    } else {
      removed.push(id);
    }
  }
  const added = nextIds.filter((id) => !pub.has(id) && !replacedTo.has(id));
  return { added, replaced, removed };
}
