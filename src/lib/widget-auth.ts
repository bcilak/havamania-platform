import { eq } from "drizzle-orm";
import { db } from "@/db";
import { appUsers, bots } from "@/db/schema";
import { normalizeBotConfig } from "./bot-config";
import { verifyWidgetToken } from "./session";

export async function widgetFromRequest(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  const session = await verifyWidgetToken(header.startsWith("Bearer ") ? header.slice(7) : null);
  if (!session) return null;
  const [bot] = await db.select().from(bots).where(eq(bots.id, session.botId));
  const [appUser] = await db.select().from(appUsers).where(eq(appUsers.id, session.appUserId));
  if (!bot || !appUser) return null;
  return { session, bot: { ...bot, draftConfig: normalizeBotConfig(bot.draftConfig) }, appUser };
}

export const isUuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
