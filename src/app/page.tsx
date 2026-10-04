import type { Metadata, Viewport } from "next";
import { LandingMount } from "@/components/landing/LandingMount";
import { getAdmin } from "@/lib/auth";
import { getLanding } from "@/lib/cms/store";
import { LANDING_CSS, renderLanding } from "@/lib/cms/render";
import { can } from "@/lib/roles";
import { getSetting } from "@/lib/settings";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

async function content(sp: Record<string, string | string[] | undefined>) {
  // ?onizleme=1: CMS yetkisi olan admin taslağı görür, herkes yayındakini.
  if (sp.onizleme === "1") {
    const admin = await getAdmin();
    if (admin && can(admin.role, "cms")) return { c: await getLanding("draft"), preview: true };
  }
  return { c: await getLanding("published"), preview: false };
}

export const viewport: Viewport = { themeColor: "#ffffff", colorScheme: "light" };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { c, preview } = await content(await searchParams);
  const images = c.seo.ogImage ? [{ url: c.seo.ogImage, width: 1200, height: 630 }] : undefined;
  return {
    metadataBase: new URL(process.env.APP_URL || "http://localhost:3110"),
    title: { absolute: c.seo.title },
    description: c.seo.description,
    alternates: { canonical: "/" },
    robots: preview ? { index: false, follow: false } : undefined,
    openGraph: { type: "website", siteName: "Havamania", title: c.seo.title, description: c.seo.description, images, locale: "tr_TR", url: "/" },
    twitter: { card: images ? "summary_large_image" : "summary", title: c.seo.title, description: c.seo.description, images: images?.map((i) => i.url) },
  };
}

export default async function Home({ searchParams }: Props) {
  const { c, preview } = await content(await searchParams);
  const legal = await getSetting("legal");
  const base = (process.env.APP_URL || "http://localhost:3110").replace(/\/$/, "");
  // Arama motorları için kurum ve site bilgisi (sayfada görünmez).
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "Organization", "@id": `${base}/#org`, name: legal.company, url: base, logo: `${base}/assets/havamania-logo.png` },
      { "@type": "WebSite", name: "Havamania", url: base, inLanguage: "tr-TR", publisher: { "@id": `${base}/#org` } },
    ],
  };
  return (
    <>
      <style>{LANDING_CSS}</style>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      {/* JS varsa reveal öğeleri baştan gizli başlar; yoksa (JS kapalı) içerik görünür kalır. Açılıştaki yanıp sönmeyi önler. */}
      <script dangerouslySetInnerHTML={{ __html: "document.documentElement.classList.add('hm-js')" }} />
      {preview && (
        <div style={{ position: "fixed", bottom: 16, left: "50%", transform: "translateX(-50%)", zIndex: 300, background: "#1d1d1f", color: "#fff", borderRadius: 999, padding: "8px 16px", fontSize: 13, boxShadow: "0 8px 24px rgba(0,0,0,.25)" }}>
          Taslak önizleme · yayında değil
        </div>
      )}
      <LandingMount html={renderLanding(c)} />
    </>
  );
}
