import Link from "next/link";
import type { ComponentType, ReactNode } from "react";
import { CircleAlert, CircleCheck } from "lucide-react";
import type { ChatMode } from "@/db/schema";
import { MODE_META } from "@/lib/bot-config";

export function cx(...c: (string | false | null | undefined)[]): string {
  return c.filter(Boolean).join(" ");
}

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

export function btn(variant: Variant = "secondary", size: Size = "md"): string {
  return cx(
    "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium whitespace-nowrap transition-colors",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:pointer-events-none disabled:opacity-50",
    size === "sm" ? "h-8 px-3 text-[13px]" : "h-9 px-4 text-sm",
    {
      primary: "bg-accent text-white hover:bg-accent-hover",
      secondary: "border border-line-strong bg-surface text-ink hover:bg-sunken",
      ghost: "text-muted hover:bg-sunken hover:text-ink",
      danger: "border border-line-strong bg-surface text-bad hover:bg-bad-soft",
    }[variant],
  );
}

export const inputCls =
  "w-full h-9 rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink placeholder:text-faint focus:outline-2 focus:-outline-offset-1 focus:outline-accent";
export const textareaCls =
  "w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm leading-relaxed text-ink placeholder:text-faint focus:outline-2 focus:-outline-offset-1 focus:outline-accent";
export const selectCls = `${inputCls} pr-8`;
export const checkboxCls = "size-4 rounded border-line-strong accent-[var(--color-accent)]";

export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  eyebrow?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0 max-w-3xl">
        {eyebrow && <div className="mb-1 text-xs font-semibold tracking-wide text-muted uppercase">{eyebrow}</div>}
        <h1 className="text-[26px] leading-tight font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1.5 text-[15px] leading-relaxed text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function Panel({
  title,
  description,
  actions,
  children,
  className,
  bodyClassName,
  id,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  id?: string;
}) {
  return (
    <section id={id} className={cx("rounded-xl border border-line bg-surface", className)}>
      {(title || actions) && (
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            {title && <h2 className="text-[15px] font-semibold">{title}</h2>}
            {description && <p className="mt-0.5 text-[13px] leading-relaxed text-muted">{description}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={cx("p-5", bodyClassName)}>{children}</div>
    </section>
  );
}

export function Field({
  label,
  hint,
  htmlFor,
  children,
  className,
}: {
  label: ReactNode;
  hint?: ReactNode;
  htmlFor?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("grid gap-1.5", className)}>
      <label htmlFor={htmlFor} className="text-[13px] font-medium">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs leading-relaxed text-muted">{hint}</p>}
    </div>
  );
}

type Tone = "neutral" | "accent" | "good" | "warn" | "bad";

export function Badge({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span
      className={cx(
        "inline-flex h-5 items-center gap-1 rounded-full px-2 text-[11.5px] font-medium whitespace-nowrap",
        {
          neutral: "bg-sunken text-muted",
          accent: "bg-accent-soft text-accent",
          good: "bg-good-soft text-good",
          warn: "bg-warn-soft text-warn",
          bad: "bg-bad-soft text-bad",
        }[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

const MODE_DOT: Record<ChatMode, string> = {
  genel: "bg-mode-genel",
  agro: "bg-mode-agro",
  fly: "bg-mode-fly",
};

/** Mod kimliği: renkli nokta + yazı. Renk tek başına anlam taşımaz. */
export function ModeBadge({ mode }: { mode: ChatMode }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[13px] whitespace-nowrap">
      <span className={cx("size-2 rounded-full", MODE_DOT[mode])} aria-hidden />
      {MODE_META[mode].label}
    </span>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  children,
  action,
}: {
  icon: ComponentType<{ className?: string }>;
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      <div className="mb-3 grid size-10 place-items-center rounded-full bg-sunken text-muted">
        <Icon className="size-5" />
      </div>
      <h3 className="text-[15px] font-semibold">{title}</h3>
      {children && <p className="mt-1 max-w-md text-sm leading-relaxed text-muted">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** Server action'ların ?ok= / ?hata= mesajları. */
export function Flash({ sp }: { sp: Record<string, string | string[] | undefined> }) {
  const ok = typeof sp.ok === "string" ? sp.ok : null;
  const error = typeof sp.hata === "string" ? (sp.hata === "yetki" ? "Bu sayfa için yetkiniz yok." : sp.hata) : null;
  if (!ok && !error) return null;
  return (
    <div
      role={error ? "alert" : "status"}
      className={cx(
        "mb-5 flex items-start gap-2.5 rounded-xl px-4 py-3 text-sm",
        error ? "bg-bad-soft text-bad" : "bg-good-soft text-good",
      )}
    >
      {error ? <CircleAlert className="mt-0.5 size-4 shrink-0" /> : <CircleCheck className="mt-0.5 size-4 shrink-0" />}
      <span className="text-ink">{error ?? ok}</span>
    </div>
  );
}

export function Notice({ tone = "accent", children, icon: Icon = CircleAlert }: { tone?: "accent" | "warn"; children: ReactNode; icon?: ComponentType<{ className?: string }> }) {
  return (
    <div className={cx("flex items-start gap-2.5 rounded-xl px-4 py-3 text-sm leading-relaxed", tone === "warn" ? "bg-warn-soft" : "bg-accent-soft")}>
      <Icon className={cx("mt-0.5 size-4 shrink-0", tone === "warn" ? "text-warn" : "text-accent")} />
      <div className="min-w-0 text-ink">{children}</div>
    </div>
  );
}

export function Tabs({ items }: { items: { href: string; label: ReactNode; active: boolean; count?: number }[] }) {
  return (
    <nav className="mb-5 flex gap-1 overflow-x-auto border-b border-line" aria-label="Sekmeler">
      {items.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          aria-current={t.active ? "page" : undefined}
          className={cx(
            "-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm whitespace-nowrap transition-colors",
            t.active ? "border-accent font-medium text-ink" : "border-transparent text-muted hover:text-ink",
          )}
        >
          {t.label}
          {typeof t.count === "number" && <span className="tabular rounded-full bg-sunken px-1.5 text-[11px] text-muted">{t.count}</span>}
        </Link>
      ))}
    </nav>
  );
}

/** Tablo hücreleri için ortak sınıflar. */
export const th = "px-4 py-2.5 text-left text-[11.5px] font-semibold tracking-wide text-muted uppercase whitespace-nowrap";
export const td = "px-4 py-3 align-top text-sm";

export function TableWrap({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-surface">
      <table className="w-full min-w-[640px] border-collapse [&_tbody_tr]:border-t [&_tbody_tr]:border-line [&_thead]:bg-sunken">
        {children}
      </table>
    </div>
  );
}

export function KeyValue({ items }: { items: [ReactNode, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[minmax(110px,auto)_1fr] gap-x-4 gap-y-2 text-sm">
      {items.map(([k, v], i) => (
        <div key={i} className="contents">
          <dt className="text-muted">{k}</dt>
          <dd className="min-w-0 break-words">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
