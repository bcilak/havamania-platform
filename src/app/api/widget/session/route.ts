import { and, asc, desc, eq, gte, inArray, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { appUsers, attachments, conversations, messages, type Platform } from "@/db/schema";
import { getBotByPublicKey, getPublishedVersion } from "@/lib/bot";
import { decryptOrNull } from "@/lib/crypto";
import { allow, clientIp, LIMITS, tooMany } from "@/lib/rate-limit";
import { signedFileUrl, signWidgetToken, verifyAppUserToken } from "@/lib/session";
import { getSetting } from "@/lib/settings";

const err = (error: string, status: number) => NextResponse.json({ error }, { status });

/**
 * Sohbet ekranı açıldığında çağrılır: cihazı/kullanıcıyı tanır, KVKK onayını
 * kontrol eder, widget oturumu verir ve son 7 gündeki konuşmayı döner.
 */
export async function POST(request: Request) {
  if (!allow(`session:${clientIp(request)}`, LIMITS.sessionPerMin)) return tooMany();
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return err("Geçersiz istek.", 400);
  const { botKey, deviceId, userToken, platform, appVersion, locale, consentVersion } = body as Record<string, unknown>;

  const bot = typeof botKey === "string" ? await getBotByPublicKey(botKey) : null;
  if (!bot) return err("Asistan bulunamadı.", 404);
  if (typeof deviceId !== "string" || deviceId.length < 6 || deviceId.length > 200) return err("Cihaz kimliği eksik.", 400);
  const plat: Platform = platform === "ios" || platform === "android" ? platform : "web";

  let externalUserId: string | null = null;
  if (typeof userToken === "string" && userToken) {
    const secret = decryptOrNull(bot.tokenSecretEnc);
    if (!secret) return err("Kullanıcı doğrulaması henüz yapılandırılmadı.", 400);
    const verified = await verifyAppUserToken(userToken, secret);
    if (!verified) return err("Oturum süresi doldu. Uygulamayı yeniden açın.", 401);
    externalUserId = verified.sub.slice(0, 200);
  } else if (!bot.allowAnonymous) {
    return err("Asistanı kullanmak için giriş yapın.", 401);
  }

  const published = await getPublishedVersion(bot);
  if (!published) return err("Asistan henüz yayınlanmadı.", 503);

  // Kimlik = (bot, cihaz, uygulama kullanıcısı). Aynı telefonda hesap değişirse
  // yeni kullanıcı öncekinin konuşmalarını görmez.
  const kvkk = await getSetting("kvkk");
  const now = new Date();
  const identity = and(
    eq(appUsers.botId, bot.id),
    eq(appUsers.deviceId, deviceId),
    externalUserId ? eq(appUsers.externalUserId, externalUserId) : isNull(appUsers.externalUserId),
  );
  const patch = {
    lastSeenAt: now,
    platform: plat,
    ...(typeof appVersion === "string" ? { appVersion: appVersion.slice(0, 40) } : {}),
    ...(typeof locale === "string" ? { locale: locale.slice(0, 20) } : {}),
    ...(consentVersion === kvkk.consentVersion ? { consentVersion: kvkk.consentVersion, consentAt: now } : {}),
  };
  let [user] = await db.select().from(appUsers).where(identity);
  if (user) {
    [user] = await db.update(appUsers).set(patch).where(eq(appUsers.id, user.id)).returning();
  } else {
    try {
      [user] = await db.insert(appUsers).values({ botId: bot.id, deviceId, externalUserId, ...patch }).returning();
    } catch (e) {
      // Aynı anda iki istek: diğeri kaydı oluşturmuş olabilir.
      [user] = await db.select().from(appUsers).where(identity);
      if (!user) throw e;
    }
  }

  if (user.consentVersion !== kvkk.consentVersion) {
    return NextResponse.json({ consentRequired: true, consentText: kvkk.consentText, consentVersion: kvkk.consentVersion });
  }

  const token = await signWidgetToken({ appUserId: user.id, botId: bot.id, platform: plat });

  const [recent] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.appUserId, user.id), gte(conversations.lastMessageAt, new Date(Date.now() - 7 * 86400_000))))
    .orderBy(desc(conversations.lastMessageAt))
    .limit(1);

  let conversation = null;
  if (recent) {
    const msgs = await db.select().from(messages).where(eq(messages.conversationId, recent.id)).orderBy(asc(messages.createdAt)).limit(60);
    const photos = msgs.length ? await db.select().from(attachments).where(inArray(attachments.messageId, msgs.map((m) => m.id))) : [];
    conversation = {
      id: recent.id,
      mode: recent.mode,
      messages: msgs.map((m) => ({
        id: m.id,
        role: m.role,
        parts: [
          ...photos
            .filter((p) => p.messageId === m.id && !p.hidden)
            .map((p) => ({ type: "file", mediaType: p.mediaType, url: signedFileUrl(p.storageKey, 86400) })),
          ...(m.content ? [{ type: "text", text: m.content }] : []),
        ],
      })),
    };
  }

  return NextResponse.json({ consentRequired: false, token, conversation });
}
