import { and, eq, inArray, isNull, lt, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { appUsers, attachments, bridgeRequests, conversations, deletionRequests } from "@/db/schema";
import { isReservedDeviceId } from "@/lib/bridge/keys-core";
import { REQUEST_STALE_MS } from "@/lib/bridge/request-id";
import { storage } from "@/lib/storage";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Bir seferde tek transaction'da işlenen konuşma/fotoğraf sayısı (transaction S3 silme boyunca açık kalır). */
const CHUNK = 100;

/** Köprüye ayrılmış cihaz kimliğiyle silme istendi (tüm mobil kullanıcıları siler); kullanıcı kimliği kullanılmalı. */
export class ReservedIdentifierError extends Error {
  constructor() {
    super("reserved");
    this.name = "ReservedIdentifierError";
  }
}

/**
 * Fotoğraf satırlarını `for update` ile kilitler, sonra dosyalarını depodan siler. Geçiş betiği
 * (`scripts/sanitize-photos.mts`) satırı aynı kilitle okuyup dosyayı yeniden yazdığı için, kilit olmadan
 * silinen bir dosya yeniden oluşabilirdi. Satır silme çağıranın aynı transaction'ında yapılır (kilit
 * transaction sonuna kadar sürer). Dosya silinemezse yutulur ama sayısı loglanır; anahtar loglanmaz.
 * Çok satırlı kilitler her zaman `order by id` ile alınır: eşzamanlı iki silme aynı satırları aynı sırayla
 * kilitler, ters sırada beklemekten doğan kilitlenme (deadlock) olmaz.
 */
export async function deleteAttachmentFiles(tx: Tx, where: SQL | undefined): Promise<{ ids: string[] }> {
  const rows = await tx.select({ id: attachments.id, key: attachments.storageKey }).from(attachments).where(where).orderBy(attachments.id).for("update");
  let failed = 0;
  await Promise.all(
    rows.map((r) =>
      storage.remove(r.key).catch(() => {
        failed++;
      }),
    ),
  );
  if (failed) console.error("[kvkk] dosya silinemedi", failed);
  return { ids: rows.map((r) => r.id) };
}

/** Bir transaction içinde: konuşmaların fotoğraf dosyaları kilitli silinir, sonra konuşmalar (mesajlar ve fotoğraf satırları cascade ile). */
async function removeConversationsTx(tx: Tx, ids: string[]): Promise<{ conversations: number; photos: number }> {
  if (!ids.length) return { conversations: 0, photos: 0 };
  const files = await deleteAttachmentFiles(tx, inArray(attachments.conversationId, ids));
  const gone = await tx.delete(conversations).where(inArray(conversations.id, ids)).returning({ id: conversations.id });
  return { conversations: gone.length, photos: files.ids.length };
}

async function removeConversations(ids: string[]): Promise<{ conversations: number; photos: number }> {
  const total = { conversations: 0, photos: 0 };
  for (let i = 0; i < ids.length; i += CHUNK) {
    const part = ids.slice(i, i + CHUNK);
    const r = await db.transaction((tx) => removeConversationsTx(tx, part));
    total.conversations += r.conversations;
    total.photos += r.photos;
  }
  return total;
}

/** Saklama süresi dolan konuşmaları ve fotoğraflarını kalıcı olarak siler; 24 saati geçen köprü `request_id` kayıtlarını da temizler. */
export async function runRetentionCleanup(retentionDays: number) {
  const expired = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(lt(conversations.lastMessageAt, sql`now() - make_interval(days => ${retentionDays})`));
  const res = await removeConversations(expired.map((c) => c.id));
  // Konuşmaya bağlanmamış (yüklenip gönderilmemiş) eski fotoğraflar
  const orphanCond = and(isNull(attachments.messageId), lt(attachments.createdAt, sql`now() - interval '1 day'`));
  const orphanIds = (await db.select({ id: attachments.id }).from(attachments).where(orphanCond)).map((o) => o.id);
  let orphans = 0;
  for (let i = 0; i < orphanIds.length; i += CHUNK) {
    const part = orphanIds.slice(i, i + CHUNK);
    // Koşul kilit altında yeniden sınanır: bu arada mesaja bağlanan fotoğraf silinmez.
    orphans += await db.transaction(async (tx) => {
      const { ids } = await deleteAttachmentFiles(tx, and(inArray(attachments.id, part), orphanCond));
      if (ids.length) await tx.delete(attachments).where(inArray(attachments.id, ids));
      return ids.length;
    });
  }
  const requests = await purgeExpiredBridgeRequests();
  return { ...res, orphans, requests };
}

/**
 * Köprü `request_id` kayıtları (kişisel içerik yok, yalnızca özet): 24 saatlik geçerlilik süresi dolanlar silinir
 * (kullanıcıdan bağımsız, genel çalışır). Silinen satır sayısını döndürür.
 * İşlemdeki (bayat olmayan) satır silinmez: model çağrısı sürerken satır giderse aynı kimlikle gelen yeniden deneme
 * yeni istek sayılıp modeli ikinci kez çağırırdı. Bayatlık süresi `REQUEST_STALE_MS` ile tutarlıdır (bkz. decideExisting).
 */
export async function purgeExpiredBridgeRequests(): Promise<number> {
  return (
    await db
      .delete(bridgeRequests)
      .where(
        and(
          lt(bridgeRequests.createdAt, sql`now() - interval '24 hours'`),
          sql`(${bridgeRequests.status} <> 'in_progress' or ${bridgeRequests.updatedAt} < now() - make_interval(secs => ${REQUEST_STALE_MS / 1000}))`,
        ),
      )
      .returning({ id: bridgeRequests.requestId })
  ).length;
}

export async function countExpired(retentionDays: number): Promise<number> {
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(conversations)
    .where(lt(conversations.lastMessageAt, sql`now() - make_interval(days => ${retentionDays})`));
  return n;
}

/**
 * Bir kişinin tüm verisini siler (KVKK md. 11 silme talebi). Kapsam yalnızca verilen bottur.
 * Kapsam dışı: konuşmadan kopyalanıp kaydedilmiş test senaryoları (eval_cases) ve koşu sonuçları
 * (eval_results) kullanıcıya bağlı değildir; gerekiyorsa panelden elle silinmelidir
 * (senaryo silinince sonuçlardaki soru/cevap da temizlenir; "Koşuyu sil" koşuyu tümüyle siler).
 *
 * `device` türünde köprüye ayrılmış kimlik ("bridge…") reddedilir (`ReservedIdentifierError`).
 */
export async function deleteUserData(opts: { botId: string; identifier: string; type: "device" | "external_user"; requestedBy: string }) {
  const { botId, identifier, type, requestedBy } = opts;
  if (type === "device" && isReservedDeviceId(identifier)) throw new ReservedIdentifierError();

  const users = await db
    .select({ id: appUsers.id })
    .from(appUsers)
    .where(and(eq(appUsers.botId, botId), type === "device" ? eq(appUsers.deviceId, identifier) : eq(appUsers.externalUserId, identifier)));
  const userIds = users.map((u) => u.id);
  const result = { conversations: 0, photos: 0 };
  if (userIds.length) {
    const convs = await db.select({ id: conversations.id }).from(conversations).where(inArray(conversations.appUserId, userIds));
    const bulk = await removeConversations(convs.map((c) => c.id));
    result.conversations += bulk.conversations;
    result.photos += bulk.photos;
    // Tek transaction: bu arada açılmış konuşma, gevşek fotoğraflar ve kullanıcı satırı. Önce kilit, sonra dosya, sonra satır.
    // (Kullanıcı satırı silinince konuşmanın app_user_id'si boşalırdı; geç gelen konuşma burada temizlenir.)
    const rest = await db.transaction(async (tx) => {
      // İlk adım: kullanıcı satırlarını kilitle. Geç gelen bir /ask konuşma eklerken bu satıra FK ile bağlanır
      // (key share); kilit onu silme bitene kadar bekletir, silme bitince FK hatası alır. Böylece
      // `on delete set null` yüzünden sahipsiz (app_user_id null) konuşma kalmaz.
      await tx.select({ id: appUsers.id }).from(appUsers).where(inArray(appUsers.id, userIds)).orderBy(appUsers.id).for("update");
      const late = await tx.select({ id: conversations.id }).from(conversations).where(inArray(conversations.appUserId, userIds));
      const lateRes = await removeConversationsTx(tx, late.map((c) => c.id));
      const loose = await deleteAttachmentFiles(tx, inArray(attachments.appUserId, userIds));
      if (loose.ids.length) await tx.delete(attachments).where(inArray(attachments.id, loose.ids));
      await tx.delete(appUsers).where(inArray(appUsers.id, userIds));
      return { conversations: lateRes.conversations, photos: lateRes.photos + loose.ids.length };
    });
    result.conversations += rest.conversations;
    result.photos += rest.photos;
  }
  await db.insert(deletionRequests).values({
    identifier: identifier.length > 8 ? `${identifier.slice(0, 4)}…${identifier.slice(-4)}` : "••••",
    identifierType: type,
    status: userIds.length ? "completed" : "not_found",
    deletedConversations: result.conversations,
    deletedPhotos: result.photos,
    requestedBy,
  });
  return { found: userIds.length > 0, ...result };
}
