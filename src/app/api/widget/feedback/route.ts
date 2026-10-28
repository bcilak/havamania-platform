import { NextResponse } from "next/server";
import { recordFeedback } from "@/lib/feedback";
import { allow, clientIp, LIMITS, tooMany } from "@/lib/rate-limit";
import { isUuid, widgetFromRequest } from "@/lib/widget-auth";

export async function POST(request: Request) {
  if (!allow(`feedback:${clientIp(request)}`, LIMITS.feedbackPerMin)) return tooMany();
  const widget = await widgetFromRequest(request);
  if (!widget) return NextResponse.json({ error: "Oturum süresi doldu. Sohbeti yeniden açın." }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const { messageId, rating, comment } = body as Record<string, unknown>;
  if (!isUuid(messageId) || (rating !== 1 && rating !== -1)) return NextResponse.json({ error: "Geçersiz istek." }, { status: 400 });

  const ok = await recordFeedback({ messageId, appUserId: widget.appUser.id, rating, comment: typeof comment === "string" ? comment : null });
  if (!ok) return NextResponse.json({ error: "Mesaj bulunamadı." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
