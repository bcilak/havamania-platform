import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { appUsers, type ChatMode } from "@/db/schema";
import { ChatError, handleChat } from "@/lib/ai/chat";
import { parseLocation } from "@/lib/ai/location";
import { parseTarget } from "@/lib/ai/turn-core";
import { getAdmin } from "@/lib/auth";
import { getMainBot } from "@/lib/bot";
import { MODES } from "@/lib/bot-config";
import { allow, clientIp, LIMITS, tooMany } from "@/lib/rate-limit";
import { can } from "@/lib/roles";
import { isUuid, widgetFromRequest } from "@/lib/widget-auth";

export const maxDuration = 60;

const err = (error: string, status: number) => NextResponse.json({ error }, { status });

export async function POST(request: Request) {
  if (!allow(`chat:${clientIp(request)}`, LIMITS.chatPerMinPerIp)) return tooMany();
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return err("Geçersiz istek.", 400);

  const { conversationId, mode, text, attachmentIds, location, playground } = body;
  if (!isUuid(conversationId)) return err("Geçersiz konuşma.", 400);
  if (typeof mode !== "string" || !MODES.includes(mode as ChatMode)) return err("Geçersiz mod.", 400);
  const ids = Array.isArray(attachmentIds) ? attachmentIds.filter(isUuid).slice(0, 4) : [];
  const loc = parseLocation(location);

  try {
    if (playground === true) {
      const admin = await getAdmin();
      if (!admin || !can(admin.role, "training")) return err("Oturum süresi doldu. Sayfayı yenileyin.", 401);
      // Hedef (taslak / yayındaki / belirli sürüm) yalnızca test alanında geçerlidir; sürümün bu bota
      // ait olduğu handleChat içinde doğrulanır (değilse 404). Widget isteklerinde alan yok sayılır.
      const target = parseTarget(body.target);
      if (!target) return err("Geçersiz hedef.", 400);
      return await handleChat({
        bot: await getMainBot(),
        appUser: null,
        platform: "playground",
        conversationId,
        mode: mode as ChatMode,
        text: typeof text === "string" ? text : "",
        attachmentIds: ids,
        location: loc,
        useDraft: true,
        target,
        abortSignal: request.signal,
      });
    }

    const widget = await widgetFromRequest(request);
    if (!widget) return err("Oturum süresi doldu. Sohbeti yeniden açın.", 401);
    if (!allow(`chat-user:${widget.appUser.id}`, LIMITS.chatPerMinPerUser)) return tooMany();
    await db.update(appUsers).set({ lastSeenAt: new Date() }).where(eq(appUsers.id, widget.appUser.id));
    return await handleChat({
      bot: widget.bot,
      appUser: widget.appUser,
      platform: widget.session.platform,
      conversationId,
      mode: mode as ChatMode,
      text: typeof text === "string" ? text : "",
      attachmentIds: ids,
      location: loc,
      useDraft: false,
      abortSignal: request.signal,
    });
  } catch (e) {
    if (e instanceof ChatError) return err(e.message, e.status);
    console.error("[api/chat]", e);
    return err("Beklenmeyen bir hata oluştu.", 500);
  }
}
