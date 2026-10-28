import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { appUsers } from "@/db/schema";
import { bridgeError } from "@/lib/bridge/errors";
import { readBody, withBridge } from "@/lib/bridge/guard";
import { BRIDGE_DEVICE_ID } from "@/lib/bridge/keys-core";
import { parseFeedback } from "@/lib/bridge/schema";
import { recordFeedback } from "@/lib/feedback";

export const runtime = "nodejs";

/** Bir asistan mesajına beğeni (1) ya da beğenmeme (-1). Mesaj, bu kullanıcının köprü kaydına ait olmalı; değilse 404. */
export async function POST(request: Request) {
  return withBridge(request, async ({ auth }) => {
    const body = await readBody(request, parseFeedback);
    if (!body.ok) return body.response;
    const input = body.value;

    const [user] = await db
      .select({ id: appUsers.id })
      .from(appUsers)
      .where(and(eq(appUsers.botId, auth.botId), eq(appUsers.deviceId, BRIDGE_DEVICE_ID), eq(appUsers.externalUserId, input.user_id)));
    if (!user) return bridgeError("not_found");

    const ok = await recordFeedback({ messageId: input.message_id, appUserId: user.id, botId: auth.botId, rating: input.rating, comment: input.comment });
    if (!ok) return bridgeError("not_found");
    return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
  });
}
