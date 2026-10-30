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
import { appUserExists, claimRequest, completeRequest, failRequest, loadReplay, releaseClaim, type ClaimResult } from "@/lib/bridge/request-db";
import { askFingerprint, fingerprintSecret } from "@/lib/bridge/request-id";
import { BRIDGE_LIMITS, parseAsk, toClientContext } from "@/lib/bridge/schema";
import { releaseBridgeDailySlot, takeBridgeDailySlot } from "@/lib/bridge/usage-db";
import { healthConsentGiven } from "@/lib/consent";
import { loadConsent } from "@/lib/consent-server";
import { allow, LIMITS, retryAfterFor } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Yardımcı işlemler (iade, işaretleme) yanıtı bozmaz; yalnızca hata adı loglanır (guard.ts kuralı). */
const logIgnored = (e: unknown) => console.error("[bridge]", e instanceof Error ? e.name : "UnknownError");

/**
 * Mobil backend adına asistanla konuşur (akışsız). Uygulama bağlamı yalnızca prompt'a veri olarak girer;
 * veritabanına ve loglara yazılmaz. `profile.health_sensitivities` (özel nitelikli veri) yalnızca ayrı sağlık rızası
 * (`health_consent: true` + güncel `health_consent_version`) varsa girer; yoksa hata verilmeden düşürülür.
 * `personalization: false` ise profil ve seyahat bilgisi hiç girmez.
 *
 * İşlem sırası (guard.ts 1-4'ten sonra, anahtar eşzamanlılığı içinde): kullanıcı kaydı (upsert) -> `request_id` varsa
 * sahiplenme/yineleme kararı (200 tekrar, 409, 422) -> günlük bot tavanı -> konuşma seçimi ve hazırlık -> model çağrısı.
 *
 * Maliyet tavanları (sızan anahtar): anahtar başına eşzamanlı istek sınırı (`withKeyConcurrency`) ve bot başına günlük
 * mesaj tavanı (`bridge_usage`, kalıcı sayaç; /delete-user ve saklama temizliği sayacı sıfırlamaz). Tavan başta alınır;
 * model çağrılmadan biten istek (reddedilen, hazırlıkta hata alan) `finally`de iade edilir. Model çağrıldıktan sonra
 * biten istek (200, 503 model_error, 504 timeout) sayılmış kalır.
 *
 * `request_id` varken istemci bağlantısı kopsa da model çağrısı sürer (yalnızca bütçe zaman aşımı keser): iş tamamlanır
 * ve yeniden deneme kayıtlı cevabı alır. `request_id` yoksa bağlantı kopması modeli keser (`request.signal`).
 * Kaynak: next/dist/server/web/spec-extension/adapters/next-request.js (`createAbortController`): sinyal, yanıt akışının
 * `close` olayında (`writableFinished` değilse) abort edilir; handler promise'ini iptal etmez, yalnızca bildirir. Yani
 * kopma modeli ancak bu sinyali `generateText`e biz geçirirsek keser; `request_id` varken geçirmiyoruz. smoke-chat (l) ile
 * doğrulanır (kopan istek sürer, sonraki istek 409, bitince kayıtlı cevap).
 *
 * `request_id` + ENCRYPTION_KEY: parmak izi anahtarı eksik/bozuksa istek kullanıcı kaydından ÖNCE 500 internal_error alır
 * (kayıt ve onay güncellemesi yapılmaz, yarım iş kalmaz).
 */
export async function POST(request: Request) {
  return withBridge(request, async ({ auth }) => {
    const startedAt = Date.now();
    const body = await readBody(request, parseAsk);
    if (!body.ok) return body.response;
    const input = body.value;

    // Tekrar istekleri (200/409) de bu sınırlara sayılır: DB okuması yaptıkları için sınırsız yoklama engellenir.
    if (!allow(`bridge-user:${auth.botId}:${input.user_id}`, LIMITS.bridgePerMinPerUser)) {
      return bridgeError("rate_limited", { retryAfter: retryAfterFor(LIMITS.bridgePerMinPerUser) });
    }

    // Parmak izi anahtarı (HKDF alt anahtarı) en başta çözülür: eksik/bozuk ENCRYPTION_KEY, app_users upsert'ünden
    // ve hiçbir yazma yapılmadan önce 500 verir. Yalnızca hata adı loglanır.
    let fingerprintKey: Buffer | null = null;
    if (input.request_id) {
      try {
        fingerprintKey = fingerprintSecret();
      } catch (e) {
        logIgnored(e);
        return bridgeError("internal_error");
      }
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
      // Kullanıcı kaydı tavandan önce: `bridge_requests` bu satıra FK ile bağlanır.
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

      const requestId = input.request_id ?? null;
      const personal = input.personalization !== false;
      const healthOk = healthConsentGiven(input, consent.health.version);

      // Model bütçesi dolarsa model çağrısı kesilir. `request_id` yoksa bağlantı kapanması da keser; varsa kesmez
      // (iş bitsin, yeniden deneme kayıtlı cevabı alsın). Kuyrukta beklenen süre bütçeden düşer:
      // yanıt, kuyruk beklemesiyle birlikte sözleşmedeki süre sınırını aşmaz.
      const budgetMs = Math.max(1000, BRIDGE_LIMITS.timeoutMs - (Date.now() - startedAt));
      const timeout = AbortSignal.timeout(budgetMs);
      const signal = requestId ? timeout : AbortSignal.any([request.signal, timeout]);

      let attemptId: string | null = null; // sahiplenilmiş `request_id` çalışması
      let day: string | null = null; // alınan günlük tavan slotu
      let modelCalled = false;
      let done: { conversationId: string; messageId: string } | null = null;
      try {
        if (requestId && fingerprintKey) {
          // Parmak izi modele giren etkin bağlamdan hesaplanır (rızasız sağlık metni / personalization:false ile elenenler girmez).
          const hash = askFingerprint(input, fingerprintKey, { health: healthOk });
          let claim: ClaimResult = await claimRequest(appUser.id, requestId, hash);
          // Kayıtlı cevap bulunamazsa (konuşma silinmiş) bir kez yeniden işlenmek üzere devralınır.
          // En fazla iki tur: kayıtlı mesaj iki kez üst üste bulunamaz ve yeniden sahiplenme de olmazsa (ör. başka bir istek aynı
          // anda kaydı yeniden yazıyor) döngü `replay` ile biter. O durumda ve yarışı kaybedilen `in_progress` durumunda aşağıda
          // 409 `request_in_progress` döner (Retry-After 2). 409 seçildi çünkü durum geçicidir: kısa süre sonra aynı kimlikle
          // yeniden denendiğinde ya kayıtlı cevap gelir ya da istek sahiplenilir. 500 istemciyi gereksiz hata moduna sokardı;
          // 422 ise gövdenin değiştiği anlamına gelirdi (burada değişmedi).
          for (let i = 0; claim.kind === "replay" && i < 2; i++) {
            const replay = await loadReplay(appUser.id, bot.id, claim.messageId);
            if (replay) {
              return bridgeJson(
                { answer: toPlainAnswer(replay.content), conversation_id: replay.conversationId, message_id: claim.messageId, disclaimer: MODE_DISCLAIMERS[input.mode] ?? null },
                200,
                { "idempotent-replayed": "true" },
              );
            }
            claim = await claimRequest(appUser.id, requestId, hash, { missingMessageId: claim.messageId });
          }
          if (claim.kind === "reused") return bridgeError("request_id_reused");
          if (claim.kind !== "owned") return bridgeError("request_in_progress", { retryAfter: claim.kind === "in_progress" ? claim.retryAfter : 2 });
          attemptId = claim.attemptId;
        }

        // Günlük tavan: konuşma/mesaj tablolarından değil kalıcı sayaçtan; silmeyle sıfırlanmaz. 428 gibi reddedilen istekler saymaz.
        day = await takeBridgeDailySlot(bot.id, LIMITS.bridgeDailyPerBot);
        if (day === null) return bridgeError("daily_limit", { retryAfter: secondsUntilNextDay(Date.now()) });

        const conversationId = (input.conversation_id ?? (await pickRecentConversation(bot.id, appUser.id, input.mode)) ?? crypto.randomUUID()).toLowerCase();
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
          clientContext: toClientContext(input.context, { health: personal && healthOk, personal }),
          answerFormat: "plain",
          abortSignal: signal,
        });
        modelCalled = true;
        const res = await runTurnOnce(turn);
        // Karar turn sonucuna göre: tam cevap kaydedildiyse, sinyal hemen ardından tetiklense de 200 döner.
        if (res.aborted) return bridgeError("timeout");
        if (res.error) return bridgeError("model_error");
        done = { conversationId: res.conversationId, messageId: res.messageId };
        return bridgeJson({
          answer: toPlainAnswer(res.text),
          conversation_id: res.conversationId,
          message_id: res.messageId,
          disclaimer: MODE_DISCLAIMERS[input.mode] ?? null,
        });
      } catch (e) {
        if (signal.aborted) return bridgeError("timeout");
        // Kullanıcı ya da konuşma bu arada silindi: sahipsiz kayıt oluşmaz. Kullanıcı satırı duruyorsa konuşma sorunudur,
        // yoksa KVKK silmesi kullanıcıyı da götürmüştür (en iyi çaba: silmenin konuşma aşamasında conflict de görülebilir).
        if ((e instanceof ChatError && e.code === "conversation_not_found") || isForeignKeyViolation(e)) {
          return (await appUserExists(appUser.id)) ? bridgeError("conversation_conflict") : bridgeError("user_deleted");
        }
        if (e instanceof ChatError) return fromChatError(e);
        throw e;
      } finally {
        // Yanıt dönmeden önce tamamlanır; hata yanıtı değiştirmez.
        if (day !== null && !modelCalled) await releaseBridgeDailySlot(bot.id, day).catch(logIgnored);
        if (requestId && attemptId) {
          if (done) await completeRequest(appUser.id, requestId, attemptId, done.conversationId, done.messageId).catch(logIgnored);
          else if (modelCalled) await failRequest(appUser.id, requestId, attemptId).catch(logIgnored);
          else await releaseClaim(appUser.id, requestId, attemptId).catch(logIgnored);
        }
      }
    });
  });
}
