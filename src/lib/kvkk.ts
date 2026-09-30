import { and, eq, inArray, lt, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { appUsers, attachments, conversations, deletionRequests } from "@/db/schema";
import { storage } from "@/lib/storage";

async function removeConversations(ids: string[]): Promise<{ conversations: number; photos: number }> {
  if (!ids.length) return { conversations: 0, photos: 0 };
  const photos = await db.select({ key: attachments.storageKey }).from(attachments).where(inArray(attachments.conversationId, ids));
  await Promise.all(photos.map((p) => storage.remove(p.key).catch(() => {})));
  await db.delete(conversations).where(inArray(conversations.id, ids));
  return { conversations: ids.length, photos: photos.length };
}

/** Saklama süresi dolan konuşmaları ve fotoğraflarını kalıcı olarak siler. */
export async function runRetentionCleanup(retentionDays: number) {
  const expired = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(lt(conversations.lastMessageAt, sql`now() - make_interval(days => ${retentionDays})`));
  const res = await removeConversations(expired.map((c) => c.id));
  // Konuşmaya bağlanmamış (yüklenip gönderilmemiş) eski fotoğraflar
  const orphans = await db
    .select({ id: attachments.id, key: attachments.storageKey })
    .from(attachments)
    .where(and(sql`${attachments.messageId} is null`, lt(attachments.createdAt, sql`now() - interval '1 day'`)));
  await Promise.all(orphans.map((o) => storage.remove(o.key).catch(() => {})));
  if (orphans.length) await db.delete(attachments).where(inArray(attachments.id, orphans.map((o) => o.id)));
  return { ...res, orphans: orphans.length };
}

export async function countExpired(retentionDays: number): Promise<number> {
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(conversations)
    .where(lt(conversations.lastMessageAt, sql`now() - make_interval(days => ${retentionDays})`));
  return n;
}

/** Bir kişinin tüm verisini siler (KVKK md. 11 silme talebi). */
export async function deleteUserData(identifier: string, type: "device" | "external_user", requestedBy: string) {
  const users = await db
    .select({ id: appUsers.id })
    .from(appUsers)
    .where(type === "device" ? eq(appUsers.deviceId, identifier) : or(eq(appUsers.externalUserId, identifier)));
  const userIds = users.map((u) => u.id);
  let result = { conversations: 0, photos: 0 };
  if (userIds.length) {
    const convs = await db.select({ id: conversations.id }).from(conversations).where(inArray(conversations.appUserId, userIds));
    result = await removeConversations(convs.map((c) => c.id));
    const loose = await db.select({ key: attachments.storageKey }).from(attachments).where(inArray(attachments.appUserId, userIds));
    await Promise.all(loose.map((p) => storage.remove(p.key).catch(() => {})));
    await db.delete(attachments).where(inArray(attachments.appUserId, userIds));
    await db.delete(appUsers).where(inArray(appUsers.id, userIds));
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
