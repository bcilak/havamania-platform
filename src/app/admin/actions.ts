"use server";

import { eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { appUsers, attachments, conversations } from "@/db/schema";
import { audit } from "@/lib/audit";
import { requireAdmin } from "@/lib/auth";
import { done } from "@/lib/form";
import { storage } from "@/lib/storage";

/** Seed'in oluşturduğu örnek konuşmaları, kullanıcıları ve fotoğrafları siler. */
export async function deleteDemoData() {
  const admin = await requireAdmin("kvkk");
  const photos = await db.select({ key: attachments.storageKey }).from(attachments).where(eq(attachments.isDemo, true));
  await Promise.all(photos.map((p) => storage.remove(p.key).catch(() => {})));
  await db.delete(attachments).where(eq(attachments.isDemo, true));
  const convs = await db.select({ id: conversations.id }).from(conversations).where(eq(conversations.isDemo, true));
  if (convs.length) await db.delete(conversations).where(inArray(conversations.id, convs.map((c) => c.id)));
  await db.delete(appUsers).where(eq(appUsers.isDemo, true));
  await audit(admin, "demo.delete", null, { conversations: convs.length, photos: photos.length });
  revalidatePath("/admin", "layout");
  done("/admin", `Örnek veriler silindi: ${convs.length} konuşma, ${photos.length} fotoğraf.`);
}
