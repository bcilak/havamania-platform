import { eq } from "drizzle-orm";
import { cache } from "react";
import { db } from "@/db";
import { cmsDocuments } from "@/db/schema";
import { migrateLanding } from "./migrate";
import { defaultLandingContent, landingSchema, type LandingContent } from "./schema";

export const LANDING_ID = "landing";

/** Kayıtlı içeriği şemaya göre doğrular; eksik alanları varsayılandan tamamlar. */
function coerce(raw: unknown): LandingContent {
  const d = defaultLandingContent();
  if (!raw || typeof raw !== "object") return d;
  const merged = { ...d, ...(raw as object), seo: { ...d.seo, ...((raw as LandingContent).seo ?? {}) } };
  const parsed = landingSchema.safeParse(merged);
  return parsed.success ? migrateLanding(parsed.data) : d;
}

/** Aynı istek içinde (metadata + sayfa) tek sorgu. */
export const getLandingDoc = cache(async () => {
  const [doc] = await db.select().from(cmsDocuments).where(eq(cmsDocuments.id, LANDING_ID));
  return doc ?? null;
});

export async function getLanding(which: "draft" | "published"): Promise<LandingContent> {
  const doc = await getLandingDoc();
  if (!doc) return defaultLandingContent();
  return coerce(which === "draft" ? doc.draft : (doc.published ?? doc.draft));
}
