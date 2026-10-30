import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { appUsers, bridgeRequests, conversations, messages } from "@/db/schema";
import { decideExisting } from "./request-id";

/*
 * `request_id` yineleme koruması: DB katmanı. Karar mantığı saf `decideExisting`tedir. Yaşlar uygulama saatiyle değil
 * DB saatiyle (`now() - created_at`) hesaplanır. Satırda kişisel içerik yoktur (bkz. `bridgeRequests`).
 * Tamamlama/başarısızlık/iade güncellemeleri `attempt_id` koşulludur: bayat bir çalışma başkasının satırını ezemez.
 */

export type ClaimResult =
  | { kind: "owned"; attemptId: string }
  | { kind: "replay"; conversationId: string; messageId: string }
  | { kind: "in_progress"; retryAfter: number }
  | { kind: "reused" };

/** Yarışta başka bir isteğin satırı aldığı durumda istemciye söylenen bekleme (sn). */
const RACE_RETRY_AFTER_S = 2;

const pk = (appUserId: string, requestId: string) => and(eq(bridgeRequests.appUserId, appUserId), eq(bridgeRequests.requestId, requestId));

/**
 * İsteği sahiplenmeyi dener: `INSERT … ON CONFLICT DO NOTHING`; satır zaten varsa okunur, `decideExisting` karar verir,
 * `reclaim` koşullu atomik güncellemeyle yapılır (yarışta yalnızca biri kazanır, kaybeden `in_progress` alır).
 * `opts.missingMessageId`: tekrar için aranan mesaj bulunamadı (konuşma silinmiş); o kayıt yeniden işlenir.
 * Kullanıcı bu arada silindiyse FK hatası fırlatır (çağıran `user_deleted`e çevirir).
 */
export async function claimRequest(appUserId: string, requestId: string, hash: string, opts: { missingMessageId?: string } = {}): Promise<ClaimResult> {
  // Okuma ile ekleme arasında satır silinebilir (temizlik, iade); birkaç kez yeniden dener.
  for (let i = 0; i < 3; i++) {
    const attemptId = crypto.randomUUID();
    const inserted = await db
      .insert(bridgeRequests)
      .values({ appUserId, requestId, bodyHash: hash, attemptId, status: "in_progress" })
      .onConflictDoNothing()
      .returning({ attemptId: bridgeRequests.attemptId });
    if (inserted.length) return { kind: "owned", attemptId };

    const [row] = await db
      .select({
        status: bridgeRequests.status,
        bodyHash: bridgeRequests.bodyHash,
        attemptId: bridgeRequests.attemptId,
        conversationId: bridgeRequests.conversationId,
        messageId: bridgeRequests.messageId,
        createdMs: sql<number>`(extract(epoch from (now() - ${bridgeRequests.createdAt})) * 1000)::float8`,
        updatedMs: sql<number>`(extract(epoch from (now() - ${bridgeRequests.updatedAt})) * 1000)::float8`,
      })
      .from(bridgeRequests)
      .where(pk(appUserId, requestId));
    if (!row) continue;

    const decision = decideExisting(row, hash, { createdMs: Number(row.createdMs), updatedMs: Number(row.updatedMs) }, opts);
    switch (decision.kind) {
      case "replay":
        if (row.conversationId && row.messageId) return { kind: "replay", conversationId: row.conversationId, messageId: row.messageId };
        // Tamamlanmış ama kimlikleri yok (olmaması gereken durum): yeniden işle.
        break;
      case "in_progress":
        return decision;
      case "reused":
        return { kind: "reused" };
      case "reclaim":
        break;
    }

    const reclaimed = await db
      .update(bridgeRequests)
      .set({
        status: "in_progress",
        attemptId,
        bodyHash: hash,
        conversationId: null,
        messageId: null,
        updatedAt: sql`now()`,
        // Her devralmada sıfırlanır: TTL ve temizlik son sahiplenmeden sayılır (bkz. decideExisting).
        createdAt: sql`now()`,
      })
      .where(and(pk(appUserId, requestId), eq(bridgeRequests.attemptId, row.attemptId), eq(bridgeRequests.status, row.status)))
      .returning({ attemptId: bridgeRequests.attemptId });
    // 0 satır: başkası aldı.
    return reclaimed.length ? { kind: "owned", attemptId } : { kind: "in_progress", retryAfter: RACE_RETRY_AFTER_S };
  }
  return { kind: "in_progress", retryAfter: RACE_RETRY_AFTER_S };
}

/**
 * Kayıtlı cevabı yükler. Mesaj yok, cevap hatalı ya da konuşma bu kullanıcı/bota ait değilse null
 * (çağıran yeniden işlemeyi dener). Sahiplik kontrolü kimlik sızıntısına karşı ikinci güvencedir.
 */
export async function loadReplay(appUserId: string, botId: string, messageId: string): Promise<{ content: string; conversationId: string } | null> {
  const [row] = await db
    .select({ content: messages.content, conversationId: conversations.id })
    .from(messages)
    .innerJoin(conversations, eq(conversations.id, messages.conversationId))
    .where(and(eq(messages.id, messageId), eq(messages.role, "assistant"), sql`${messages.error} is null`, eq(conversations.appUserId, appUserId), eq(conversations.botId, botId)))
    .limit(1);
  return row ?? null;
}

/** Model cevabı kaydedildi: satırı `completed` yapar. */
export async function completeRequest(appUserId: string, requestId: string, attemptId: string, conversationId: string, messageId: string): Promise<void> {
  await db
    .update(bridgeRequests)
    .set({ status: "completed", conversationId, messageId, updatedAt: sql`now()` })
    .where(and(pk(appUserId, requestId), eq(bridgeRequests.attemptId, attemptId)));
}

/** Model çağrıldı ama cevap alınamadı (hata/zaman aşımı): satırı `failed` yapar; aynı kimlikle yeniden deneme modeli tekrar çağırır. */
export async function failRequest(appUserId: string, requestId: string, attemptId: string): Promise<void> {
  await db
    .update(bridgeRequests)
    .set({ status: "failed", updatedAt: sql`now()` })
    .where(and(pk(appUserId, requestId), eq(bridgeRequests.attemptId, attemptId)));
}

/** Model çağrılmadan biten istek: satır silinir, istek hiç görülmemiş gibi olur. */
export async function releaseClaim(appUserId: string, requestId: string, attemptId: string): Promise<void> {
  await db.delete(bridgeRequests).where(and(pk(appUserId, requestId), eq(bridgeRequests.attemptId, attemptId)));
}

/** Kullanıcı satırı hâlâ var mı? Silme yarışında `user_deleted` ile `conversation_conflict` ayrımı için. */
export async function appUserExists(id: string): Promise<boolean> {
  const rows = await db.select({ id: appUsers.id }).from(appUsers).where(eq(appUsers.id, id)).limit(1);
  return rows.length > 0;
}
