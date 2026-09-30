import { cx } from "@/components/ui";
import { fmtInt } from "@/lib/format";

/*
 * Tek serili grafikler (dataviz kuralları): ince çubuklar (<=24px), 4px yuvarlak
 * uç ve düz taban, kılcal gri ızgara, yalnızca en yüksek değer etiketli, her
 * çubukta üzerine gelince/odaklanınca ipucu, altta tablo görünümü.
 * Tek seri olduğu için lejant yok; başlık neyin çizildiğini söyler.
 */

function niceMax(v: number): number {
  if (v <= 4) return 4;
  const exp = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * exp >= v) return m * exp;
  return 10 * exp;
}

export function DailyColumns({ data, unit = "konuşma" }: { data: { day: string; label: string; value: number }[]; unit?: string }) {
  const max = niceMax(Math.max(1, ...data.map((d) => d.value)));
  const ticks = [0, max / 2, max];
  const peak = data.reduce((best, d, i) => (d.value > data[best].value ? i : best), 0);
  const H = 168;

  return (
    <figure className="m-0">
      <div className="flex gap-3">
        {/* y ekseni */}
        <div className="tabular relative w-7 shrink-0 text-right text-[11px] text-faint" style={{ height: H }}>
          {ticks.map((t) => (
            <span key={t} className="absolute right-0 -translate-y-1/2" style={{ top: H - (t / max) * H }}>
              {fmtInt(t)}
            </span>
          ))}
        </div>
        <div className="relative min-w-0 flex-1" style={{ height: H }}>
          {ticks.map((t) => (
            <div key={t} className="absolute inset-x-0 h-px bg-line" style={{ top: H - (t / max) * H }} aria-hidden />
          ))}
          <ol className="relative flex h-full items-end" aria-label={`Günlük ${unit} sayısı`}>
            {data.map((d, i) => {
              const h = (d.value / max) * H;
              return (
                <li key={d.day} className="group relative flex h-full flex-1 items-end justify-center" tabIndex={0} aria-label={`${d.label}: ${d.value} ${unit}`}>
                  {/* geniş, görünmez hedef alanı */}
                  <span className="absolute inset-0" aria-hidden />
                  <span
                    className="relative w-full max-w-6 rounded-t-[4px] bg-chart transition-opacity group-hover:opacity-80 group-focus-visible:opacity-80"
                    style={{ height: Math.max(d.value ? 2 : 0, h), marginInline: 1 }}
                  />
                  {i === peak && d.value > 0 && (
                    <span className="tabular absolute text-[11px] font-medium text-ink" style={{ bottom: h + 4 }}>
                      {d.value}
                    </span>
                  )}
                  <span
                    role="tooltip"
                    className="pointer-events-none absolute bottom-full z-10 mb-1 hidden rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs whitespace-nowrap shadow-lg group-hover:block group-focus-visible:block"
                  >
                    <span className="block text-muted">{d.label}</span>
                    <span className="tabular font-semibold">
                      {fmtInt(d.value)} {unit}
                    </span>
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
      <div className="ml-10 flex text-[11px] text-faint">
        {data.map((d, i) => (
          <span key={d.day} className="tabular flex-1 text-center">
            {i % 2 === data.length % 2 ? "" : d.label.split(" ")[0]}
          </span>
        ))}
      </div>
      <details className="mt-3 text-[13px]">
        <summary className="cursor-pointer text-muted hover:text-ink">Tablo olarak göster</summary>
        <table className="mt-2 w-full max-w-sm text-sm">
          <tbody>
            {data.map((d) => (
              <tr key={d.day} className="border-t border-line">
                <td className="py-1 text-muted">{d.label}</td>
                <td className="tabular py-1 text-right">{d.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}

/** Büyüklük karşılaştırması: tek renk, iz = aynı rengin açık tonu. Kimlik etikette. */
export function BarList({ items, total }: { items: { label: React.ReactNode; value: number; key: string }[]; total?: number }) {
  const sum = total ?? items.reduce((a, b) => a + b.value, 0);
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <ul className="grid gap-3">
      {items.map((it) => (
        <li key={it.key} className="grid gap-1.5">
          <div className="flex items-baseline justify-between gap-2 text-sm">
            <span className="min-w-0 truncate">{it.label}</span>
            <span className="tabular text-muted">
              {fmtInt(it.value)}
              {sum > 0 && <span className="ml-1.5 text-faint">%{Math.round((it.value / sum) * 100)}</span>}
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-chart-track">
            <div className={cx("h-full rounded-full bg-chart")} style={{ width: `${(it.value / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function StatTile({
  label,
  value,
  delta,
  upIsGood = true,
  hint,
}: {
  label: string;
  value: string;
  /** Önceki döneme göre oransal değişim (0.12 = %12 artış). null: kıyas yok. */
  delta?: number | null;
  upIsGood?: boolean;
  hint?: string;
}) {
  const hasDelta = typeof delta === "number" && Number.isFinite(delta);
  const up = hasDelta && delta! > 0;
  const flat = hasDelta && Math.abs(delta!) < 0.005;
  const good = flat ? null : up === upIsGood;
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <div className="text-[13px] text-muted">{label}</div>
      <div className="mt-1.5 text-[28px] leading-none font-semibold tracking-tight">{value}</div>
      <div className="mt-2 text-xs text-muted">
        {hasDelta ? (
          <>
            <span className={cx("font-medium", good === null ? "text-muted" : good ? "text-good" : "text-bad")}>
              {flat ? "değişim yok" : `${up ? "▲" : "▼"} %${Math.abs(Math.round(delta! * 100))}`}
            </span>{" "}
            önceki 7 güne göre
          </>
        ) : (
          (hint ?? " ")
        )}
      </div>
    </div>
  );
}
