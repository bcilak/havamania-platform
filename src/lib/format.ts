import type { Platform } from "@/db/schema";

const TZ = "Europe/Istanbul";

export function fmtDateTime(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short", timeZone: TZ }).format(new Date(d));
}

export function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeZone: TZ }).format(new Date(d));
}

export function fmtTime(d: Date | string): string {
  return new Intl.DateTimeFormat("tr-TR", { timeStyle: "short", timeZone: TZ }).format(new Date(d));
}

export function fmtRelative(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const diff = (Date.now() - new Date(d).getTime()) / 1000;
  if (diff < 60) return "az önce";
  if (diff < 3600) return `${Math.floor(diff / 60)} dk önce`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} sa önce`;
  if (diff < 172800) return "dün";
  if (diff < 7 * 86400) return `${Math.floor(diff / 86400)} gün önce`;
  return fmtDate(d);
}

export function fmtInt(n: number | null | undefined): string {
  return new Intl.NumberFormat("tr-TR").format(n ?? 0);
}

export function fmtUsd(n: number | null | undefined): string {
  const v = Number(n ?? 0);
  if (v === 0) return "$0";
  if (v < 0.01) return `$${v.toFixed(4)}`;
  return `$${v.toFixed(2)}`;
}

export function fmtPercent(n: number): string {
  return `%${Math.round(n * 100)}`;
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function maskId(s: string | null | undefined): string {
  if (!s) return "—";
  if (s.length <= 6) return "••••";
  return `${s.slice(0, 4)}…${s.slice(-2)}`;
}

export function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

export const PLATFORM_LABEL: Record<Platform, string> = {
  ios: "iOS",
  android: "Android",
  web: "Web",
  playground: "Test alanı",
};

/** Europe/Istanbul takvimine göre bugünün başlangıcı. */
export function startOfTodayTR(): Date {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  return new Date(`${parts}T00:00:00+03:00`);
}
