import { eq } from "drizzle-orm";
import { cache } from "react";
import { db } from "@/db";
import { cmsDocuments } from "@/db/schema";
import { coerce } from "./coerce";
import { defaultLandingContent, type LandingContent } from "./schema";

export const LANDING_ID = "landing";

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
