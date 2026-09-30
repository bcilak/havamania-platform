"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  BookOpen,
  Cpu,
  ExternalLink,
  FileText,
  FlaskConical,
  Image as ImageIcon,
  Images,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Menu,
  MessagesSquare,
  PenLine,
  Plug,
  Rocket,
  ScrollText,
  ShieldCheck,
  SlidersHorizontal,
  ThumbsDown,
  Users,
  X,
} from "lucide-react";
import { cx } from "@/components/ui";

const ICONS = {
  dashboard: LayoutDashboard,
  cms: FileText,
  media: ImageIcon,
  conversations: MessagesSquare,
  photos: Images,
  feedback: ThumbsDown,
  kb: BookOpen,
  persona: SlidersHorizontal,
  corrections: PenLine,
  test: FlaskConical,
  publish: Rocket,
  models: Cpu,
  integration: Plug,
  users: Users,
  kvkk: ShieldCheck,
  audit: ScrollText,
} as const;

export type NavItem = { href: string; label: string; icon: keyof typeof ICONS; badge?: number };
export type NavGroup = { label: string | null; items: NavItem[] };

export function Sidebar({
  groups,
  user,
  logout,
}: {
  groups: NavGroup[];
  user: { name: string; roleLabel: string };
  logout: () => Promise<void>;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [pathname]);

  const isActive = (href: string) => (href === "/admin" ? pathname === "/admin" : pathname === href || pathname.startsWith(href + "/"));

  const nav = (
    <nav className="flex flex-col gap-5 px-3 py-4" aria-label="Panel menüsü">
      {groups.map((g, gi) => (
        <div key={gi}>
          {g.label && <div className="mb-1.5 px-2.5 text-[11px] font-semibold tracking-wider text-faint uppercase">{g.label}</div>}
          <ul className="grid gap-0.5">
            {g.items.map((item) => {
              const Icon = ICONS[item.icon];
              const active = isActive(item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={cx(
                      "flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-[13.5px] transition-colors",
                      active ? "bg-accent-soft font-medium text-accent" : "text-ink/80 hover:bg-sunken hover:text-ink",
                    )}
                  >
                    <Icon className="size-4 shrink-0" />
                    <span className="truncate">{item.label}</span>
                    {!!item.badge && (
                      <span className="tabular ml-auto rounded-full bg-bad-soft px-1.5 text-[11px] font-semibold text-bad">{item.badge}</span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );

  const footer = (
    <div className="border-t border-line px-3 py-3">
      <div className="px-2.5 pb-2">
        <div className="truncate text-[13.5px] font-medium">{user.name}</div>
        <div className="text-xs text-muted">{user.roleLabel}</div>
      </div>
      <div className="grid gap-0.5">
        <Link href="/admin/hesabim" className="flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-[13.5px] text-ink/80 hover:bg-sunken hover:text-ink">
          <KeyRound className="size-4" /> Hesabım
        </Link>
        <a href="/" target="_blank" className="flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-[13.5px] text-ink/80 hover:bg-sunken hover:text-ink">
          <ExternalLink className="size-4" /> Siteyi aç
        </a>
        <form action={logout}>
          <button type="submit" className="flex h-8 w-full items-center gap-2.5 rounded-lg px-2.5 text-[13.5px] text-ink/80 hover:bg-sunken hover:text-ink">
            <LogOut className="size-4" /> Çıkış yap
          </button>
        </form>
      </div>
    </div>
  );

  const brand = (
    <Link href="/admin" className="flex items-center gap-2.5">
      <span className="rounded-md bg-white px-1.5 py-1 ring-1 ring-line">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/assets/havamania-logo.png" alt="Havamania" className="h-5 w-auto" />
      </span>
      <span className="text-[13px] font-semibold tracking-wide text-muted">Panel</span>
    </Link>
  );

  return (
    <>
      {/* Mobil üst çubuk */}
      <div className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-line bg-surface/90 px-4 backdrop-blur lg:hidden">
        {brand}
        <button type="button" onClick={() => setOpen((v) => !v)} className="grid size-9 place-items-center rounded-lg hover:bg-sunken" aria-expanded={open} aria-label="Menüyü aç">
          {open ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
      </div>
      {open && (
        <div className="fixed inset-x-0 top-14 bottom-0 z-30 overflow-y-auto bg-surface lg:hidden">
          {nav}
          {footer}
        </div>
      )}

      {/* Masaüstü yan menü */}
      <aside className="sticky top-0 hidden h-dvh flex-col border-r border-line bg-surface lg:flex">
        <div className="flex h-16 shrink-0 items-center px-5">{brand}</div>
        <div className="min-h-0 flex-1 overflow-y-auto">{nav}</div>
        {footer}
      </aside>
    </>
  );
}
