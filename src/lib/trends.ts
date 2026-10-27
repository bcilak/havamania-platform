/*
 * Trend ve kalite hesapları: oranlar, haftalık seriler, araç başarısı, sürüm kalitesi. Saf mantık (veritabanı yok),
 * birim testle doğrulanır; ham sayıları getiren sorgular stats.ts'tedir.
 */

export type WeeklyRow = { day: string; assistant: number; negative: number; unanswered: number };
export type RatePoint = { day: string; label: string; /** Yüzde (0-100), tek ondalık. */ value: number; numerator: number; denominator: number };

/** Oran yüzde olarak; payda 0 ise 0. */
export function pct(numerator: number, denominator: number): number {
  if (!denominator) return 0;
  return Math.round((numerator / denominator) * 1000) / 10;
}

const labelFmt = new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "short", timeZone: "UTC" });

/** Haftalık satırlardan, seçilen oranın grafik noktaları. `day` haftanın pazartesisidir (YYYY-MM-DD). */
export function rateSeries(rows: WeeklyRow[], kind: "negative" | "unanswered"): RatePoint[] {
  return rows.map((r) => ({
    day: r.day,
    label: labelFmt.format(new Date(`${r.day}T00:00:00Z`)),
    value: pct(r[kind], r.assistant),
    numerator: r[kind],
    denominator: r.assistant,
  }));
}

export type ToolCountRow = { name: string; /** output.ok: "true" | "false" | null (kayıtta yok). */ ok: string | null; code: string | null; n: number };
export type ToolStat = { name: string; calls: number; failed: number; failurePct: number; /** En sık hata kodu ve sayısı. */ topCode: { code: string; n: number } | null };

/** Araç adına göre çağrı ve başarısızlık. `ok === "false"` başarısızlıktır; `ok` alanı olmayan eski kayıtlar başarılı sayılır. */
export function summarizeTools(rows: ToolCountRow[]): ToolStat[] {
  const byName = new Map<string, { calls: number; failed: number; codes: Map<string, number> }>();
  for (const r of rows) {
    if (!r.name) continue;
    const s = byName.get(r.name) ?? { calls: 0, failed: 0, codes: new Map() };
    s.calls += r.n;
    if (r.ok === "false") {
      s.failed += r.n;
      const code = r.code || "unknown";
      s.codes.set(code, (s.codes.get(code) ?? 0) + r.n);
    }
    byName.set(r.name, s);
  }
  return [...byName.entries()]
    .map(([name, s]) => {
      const top = [...s.codes.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
      return { name, calls: s.calls, failed: s.failed, failurePct: pct(s.failed, s.calls), topCode: top ? { code: top[0], n: top[1] } : null };
    })
    .sort((a, b) => b.calls - a.calls || a.name.localeCompare(b.name));
}

export type VersionCountRow = { number: number; conversations: number; assistant: number; negative: number; unanswered: number };
export type VersionQuality = VersionCountRow & { negativePct: number; unansweredPct: number };

/** Sürüm başına kalite: olumsuz ve cevapsız oranı cevap sayısına göre; yeni sürüm önde. */
export function versionQuality(rows: VersionCountRow[]): VersionQuality[] {
  return rows
    .map((r) => ({ ...r, negativePct: pct(r.negative, r.assistant), unansweredPct: pct(r.unanswered, r.assistant) }))
    .sort((a, b) => b.number - a.number);
}

/** Yüzdeyi Türkçe biçimde yazar: 12,5 → "%12,5"; tam sayılarda ondalık yok ("%12"). */
export function fmtPct(v: number): string {
  return `%${Number.isInteger(v) ? v : v.toFixed(1).replace(".", ",")}`;
}
