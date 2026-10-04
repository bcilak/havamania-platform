import type { MetadataRoute } from "next";
import { getLandingDoc } from "@/lib/cms/store";
import { LEGAL_PAGES } from "@/lib/legal";
import { getSetting } from "@/lib/settings";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = (process.env.APP_URL || "http://localhost:3110").replace(/\/$/, "");
  const doc = await getLandingDoc().catch(() => null);
  const legal = await getSetting("legal").catch(() => null);
  return [
    { url: `${base}/`, lastModified: doc?.publishedAt ?? undefined, changeFrequency: "weekly", priority: 1 },
    ...Object.values(LEGAL_PAGES).map((p) => ({
      url: `${base}${p.path}`,
      lastModified: legal ? new Date(`${legal.updatedAt}T00:00:00Z`) : undefined,
      changeFrequency: "yearly" as const,
      priority: 0.3,
    })),
  ];
}
