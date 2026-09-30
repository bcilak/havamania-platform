import type { MetadataRoute } from "next";
import { getLandingDoc } from "@/lib/cms/store";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = (process.env.APP_URL || "http://localhost:3110").replace(/\/$/, "");
  const doc = await getLandingDoc().catch(() => null);
  return [{ url: `${base}/`, lastModified: doc?.publishedAt ?? undefined, changeFrequency: "weekly", priority: 1 }];
}
