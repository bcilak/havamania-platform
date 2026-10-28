import { sql } from "drizzle-orm";
import { db } from "@/db";
import { appUsers } from "@/db/schema";
import { ChatError, prepareTurn, runTurnOnce } from "@/lib/ai/turn";
import { isForeignKeyViolation } from "@/lib/ai/turn-core";
import { getBotById, getPublishedVersion } from "@/lib/bot";
import { MODE_DISCLAIMERS } from "@/lib/bot-config";
import { toPlainAnswer } from "@/lib/bridge/answer";
import { pickRecentConversation } from "@/lib/bridge/conversation-db";
import { bridgeError, bridgeJson, fromChatError } from "@/lib/bridge/errors";
import { secondsUntilNextDay } from "@/lib/bridge/daily-cap";
import { readBody, withBridge, withKeyConcurrency } from "@/lib/bridge/guard";
import { BRIDGE_DEVICE_ID } from "@/lib/bridge/keys-core";
import { BRIDGE_LIMITS, parseAsk, toClientContext } from "@/lib/bridge/schema";
import { takeBridgeDailySlot } from "@/lib/bridge/usage-db";
import { healthConsentGiven } from "@/lib/consent";
import { loadConsent } from "@/lib/consent-server";
import { allow, LIMITS, retryAfterFor } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Mobil backend adına asistanla konuşur (akışsız). Uygulama bağlamı yalnızca prompt'a veri olarak girer;
 * veritabanına ve loglara yazılmaz. `profile.health_sensitivities` (özel nitelikli veri) yalnızca ayrı sağlık rızası
 * (`health_consent: true` + güncel `health_consent_version`) varsa girer; yoksa hata verilmeden düşürülür.
 *
 * Maliyet tavanları (sızan anahtar): anahtar başına eşzamanlı istek sınırı (`withKeyConcurrency`) ve bot başına günlük
 * mesaj tavanı (`bridge_usage`, kalıcı sayaç; /delete-user ve saklama temizliği sayacı sıfırlamaz).
 */
export async function POST(request: Request) {
  return withBridge(request, async ({ auth }) => {
    const startedAt = Date.now();
    const body = await readBody(request, parseAsk);
    if (!body.ok) return body.response;
    const input = body.value;

    if (!allow(`bridge-user:${auth.botId}:${input.user_id}`, LIMITS.bridgePerMinPerUser)) {
      return bridgeError("rate_limited", { retryAfter: retryAfterFor(LIMITS.bridgePerMinPerUser) });
    }

    const bot = await getBotById(auth.botId);
    const published = bot ? await getPublishedVersion(bot) : null;
    if (!bot || !published) return bridgeError("not_configured");

    // Onay sürümü zorunlu: eşleşmezse kullanıcı kaydına dokunulmaz.
    const consent = await loadConsent();
    if (input.consent_version !== consent.version) {
      return bridgeError("consent_required", { consent: { version: consent.version, text: consent.text, health: consent.health } });
    }

    return withKeyConcurrency(auth.keyId, async () => {
      // Günlük tavan: konuşma/mesaj tablolarından değil kalıcı sayaçtan; silmeyle sıfırlanmaz. 428 gibi reddedilen istekler saymaz.
      if (!(await takeBridgeDailySlot(bot.id, LIMITS.bridgeDailyPerBot))) {
        return bridgeError("daily_limit", { retryAfter: secondsUntilNextDay(Date.now()) });
      }

      const now = new Date();
      const platform = input.client.platform;
      const [appUser] = await db
        .insert(appUsers)
        .values({
          botId: bot.id,
          deviceId: BRIDGE_DEVICE_ID,
          externalUserId: input.user_id,
          platform,
          appVersion: input.client.app_version ?? null,
          consentVersion: consent.version,
          consentAt: now,
          lastSeenAt: now,
        })
        .onConflictDoUpdate({
          target: [appUsers.botId, appUsers.deviceId, appUsers.externalUserId],
          set: {
            lastSeenAt: now,
            platform,
            ...(input.client.app_version ? { appVersion: input.client.app_version } : {}),
            consentVersion: consent.version,
            consentAt: sql`case when ${appUsers.consentVersion} is distinct from ${consent.version} then now() else ${appUsers.consentAt} end`,
          },
        })
        .returning();

      const conversationId = (input.conversation_id ?? (await pickRecentConversation(bot.id, appUser.id, input.mode)) ?? crypto.randomUUID()).toLowerCase();

      // Model bütçesi dolarsa ya da bağlantı kapanırsa model çağrısı kesilir. Kuyrukta beklenen süre bütçeden düşer:
      // yanıt, kuyruk beklemesiyle birlikte sözleşmedeki süre sınırını aşmaz.
      const budgetMs = Math.max(1000, BRIDGE_LIMITS.timeoutMs - (Date.now() - startedAt));
      const signal = AbortSignal.any([request.signal, AbortSignal.timeout(budgetMs)]);
      try {
        const turn = await prepareTurn({
          bot,
          appUser,
          platform,
          conversationId,
          mode: input.mode,
          text: input.question,
          attachmentIds: [],
          location: null,
          useDraft: false,
          persist: "conversation",
          tone: input.tone ?? undefined,
          clientContext: toClientContext(input.context, { health: healthConsentGiven(input, consent.health.version) }),
          answerFormat: "plain",
          abortSignal: signal,
        });
        const res = await runTurnOnce(turn);
        // Karar turn sonucuna göre: tam cevap kaydedildiyse, sinyal hemen ardından tetiklense de 200 döner.
        if (res.aborted) return bridgeError("timeout");
        if (res.error) return bridgeError("model_error");
        return bridgeJson({
          answer: toPlainAnswer(res.text),
          conversation_id: res.conversationId,
          message_id: res.messageId,
          disclaimer: MODE_DISCLAIMERS[input.mode] ?? null,
        });
      } catch (e) {
        if (signal.aborted) return bridgeError("timeout");
        if (e instanceof ChatError) return fromChatError(e);
        // Kullanıcı ya da konuşma bu arada silindi (KVKK silme): sahipsiz kayıt oluşmaz, FK hatası 409'a çevrilir.
        if (isForeignKeyViolation(e)) return fromChatError({ code: "conversation_not_found" });
        throw e;
      }
    });
  });
}
