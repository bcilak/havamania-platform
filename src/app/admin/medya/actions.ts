"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { media } from "@/db/schema";
import { audit } from "@/lib/audit";
import { requireAdmin } from "@/lib/auth";
import { done, fail, str } from "@/lib/form";
import { extFor, newStorageKey, storage } from "@/lib/storage";

const BACK = "/admin/medya";
const TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml", "application/pdf", "image/x-icon"];

export async function uploadMedia(fd: FormData) {
  const admin = await requireAdmin("media");
  const files = fd.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (!files.length) fail(BACK, "Dosya seçin.");
  for (const f of files) {
    if (!TYPES.includes(f.type)) fail(BACK, `${f.name}: desteklenmeyen tür. PNG, JPG, WEBP, GIF, SVG, ICO veya PDF yükleyin.`);
    if (f.size > 10 * 1024 * 1024) fail(BACK, `${f.name}: en fazla 10 MB.`);
  }
  for (const f of files) {
    const key = newStorageKey("media", extFor(f.type, f.name));
    await storage.put(key, new Uint8Array(await f.arrayBuffer()), f.type);
    await db.insert(media).values({ storageKey: key, filename: f.name, mediaType: f.type, size: f.size, uploadedBy: admin.email });
  }
  await audit(admin, "media.upload", null, { count: files.length });
  revalidatePath(BACK);
  done(BACK, `${files.length} dosya yüklendi.`);
}

export async function updateAlt(fd: FormData) {
  await requireAdmin("media");
  await db.update(media).set({ alt: str(fd, "alt", 300) || null }).where(eq(media.id, str(fd, "id")));
  revalidatePath(BACK);
  done(BACK, "Açıklama kaydedildi.");
}

export async function deleteMedia(fd: FormData) {
  const admin = await requireAdmin("media");
  const [m] = await db.select().from(media).where(eq(media.id, str(fd, "id")));
  if (!m) fail(BACK, "Dosya bulunamadı.");
  await storage.remove(m!.storageKey).catch(() => {});
  await db.delete(media).where(eq(media.id, m!.id));
  await audit(admin, "media.delete", m!.filename);
  revalidatePath(BACK);
  done(BACK, `${m!.filename} silindi. Kullanıldığı yerlerde görünmeyecek.`);
}
