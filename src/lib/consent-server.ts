import { eq } from "drizzle-orm";
import { db } from "@/db";
import { settings } from "@/db/schema";
import { renderConsentText, renderHealthConsentText, resolveConsentUpdatedAt } from "./consent";
import { getSetting } from "./settings";

export const appUrl = () => (process.env.APP_URL || "http://localhost:3110").replace(/\/$/, "");

export type CurrentConsent = { version: number; text: string; updatedAt: string; health: { version: number; text: string } };

/** Güncel açık rıza metni (yer tutucuları doldurulmuş) ve sürümü. Widget oturumu ve köprü aynı kaynağı kullanır. */
export async function loadConsent(): Promise<CurrentConsent> {
  const [kvkk, legal] = await Promise.all([getSetting("kvkk"), getSetting("legal")]);
  const [row] = await db.select({ updatedAt: settings.updatedAt }).from(settings).where(eq(settings.key, "kvkk"));
  return {
    version: kvkk.consentVersion,
    text: renderConsentText(kvkk, legal, appUrl()),
    updatedAt: resolveConsentUpdatedAt(kvkk.consentUpdatedAt, row?.updatedAt),
    health: { version: kvkk.healthConsentVersion, text: renderHealthConsentText(kvkk, legal, appUrl()) },
  };
}
