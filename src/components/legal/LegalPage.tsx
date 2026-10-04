import type { Metadata } from "next";
import Link from "next/link";
import { Markdown } from "@/components/chat/Markdown";
import { fillLegal, formatLegalDate, LEGAL_PAGES, type LegalSlug } from "@/lib/legal";
import { getSetting } from "@/lib/settings";

const siteUrl = () => (process.env.APP_URL || "http://localhost:3110").replace(/\/$/, "");

export function legalMetadata(slug: LegalSlug): Metadata {
  const page = LEGAL_PAGES[slug];
  return {
    metadataBase: new URL(siteUrl()),
    title: { absolute: `${page.title} · Havamania` },
    description: page.description,
    alternates: { canonical: page.path },
    openGraph: { type: "article", siteName: "Havamania", title: page.title, description: page.description, locale: "tr_TR", url: page.path, images: [{ url: "/og.png", width: 1200, height: 630 }] },
  };
}

/** Google Play ve App Store'un istediği herkese açık yasal sayfalar. Metin panelden (Yasal sayfalar) gelir. */
export async function LegalPage({ slug }: { slug: LegalSlug }) {
  const page = LEGAL_PAGES[slug];
  const [cfg, kvkk] = await Promise.all([getSetting("legal"), getSetting("kvkk")]);
  const body = fillLegal(cfg[slug], cfg, { retentionDays: kvkk.retentionDays, siteUrl: siteUrl() });

  return (
    <div className="min-h-dvh bg-ground text-ink">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-4 sm:px-6">
          <Link href="/" className="flex items-center" aria-label="Havamania ana sayfa">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/assets/havamania-logo.png" alt="Havamania" className="h-7 w-auto" />
          </Link>
          <Link href="/" className="text-sm text-muted hover:text-ink">
            Ana sayfa
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{page.title}</h1>
        <p className="mt-2 text-sm text-muted">Son güncelleme: {formatLegalDate(cfg.updatedAt)}</p>
        <article className="mt-8 text-[15.5px] leading-relaxed text-ink/90 [overflow-wrap:anywhere]">
          <Markdown text={body} headings className="grid gap-3" />
        </article>
      </main>

      <footer className="border-t border-line">
        <nav aria-label="Yasal sayfalar" className="mx-auto flex max-w-3xl flex-wrap gap-x-5 gap-y-2 px-4 py-6 text-sm text-muted sm:px-6">
          {(Object.keys(LEGAL_PAGES) as LegalSlug[]).map((s) => (
            <Link key={s} href={LEGAL_PAGES[s].path} aria-current={s === slug ? "page" : undefined} className={s === slug ? "font-medium text-ink" : "hover:text-ink"}>
              {LEGAL_PAGES[s].title}
            </Link>
          ))}
          <span className="ml-auto">© {new Date().getFullYear()} {cfg.company}</span>
        </nav>
      </footer>
    </div>
  );
}
