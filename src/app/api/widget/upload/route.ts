import { NextResponse } from "next/server";
import { db } from "@/db";
import { attachments } from "@/db/schema";
import { getAdmin } from "@/lib/auth";
import { getMainBot, getPublishedVersion } from "@/lib/bot";
import { allow, clientIp, LIMITS, tooMany } from "@/lib/rate-limit";
import { can } from "@/lib/roles";
import { extFor, newStorageKey, storage } from "@/lib/storage";
import { widgetFromRequest } from "@/lib/widget-auth";

const TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif"];

/** Sohbet ekranından fotoğraf yükleme. Widget token'ı ya da (test alanı için) admin oturumu gerekir. */
export async function POST(request: Request) {
  if (!allow(`upload:${clientIp(request)}`, LIMITS.uploadPerMin)) return tooMany();
  const widget = await widgetFromRequest(request);
  let appUserId: string | null = null;
  let maxMb = 8;
  if (widget) {
    appUserId = widget.appUser.id;
    if (!allow(`upload-user:${appUserId}`, LIMITS.uploadPerMin)) return tooMany();
    const v = await getPublishedVersion(widget.bot);
    if (!v?.config.photosEnabled) return NextResponse.json({ error: "Fotoğraf gönderimi kapalı." }, { status: 400 });
    maxMb = v.config.maxPhotoMb;
  } else {
    const admin = await getAdmin();
    if (!admin || !can(admin.role, "training")) return NextResponse.json({ error: "Oturum süresi doldu. Sohbeti yeniden açın." }, { status: 401 });
    maxMb = (await getMainBot()).draftConfig.maxPhotoMb;
  }

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File) || !file.size) return NextResponse.json({ error: "Dosya yok." }, { status: 400 });
  if (!TYPES.includes(file.type)) return NextResponse.json({ error: "Yalnızca fotoğraf gönderebilirsiniz." }, { status: 400 });
  if (file.size > maxMb * 1024 * 1024) return NextResponse.json({ error: `En fazla ${maxMb} MB.` }, { status: 400 });

  const key = newStorageKey("photos", extFor(file.type, file.name));
  await storage.put(key, new Uint8Array(await file.arrayBuffer()), file.type);
  const [row] = await db.insert(attachments).values({ appUserId, storageKey: key, mediaType: file.type, size: file.size }).returning();
  return NextResponse.json({ id: row.id });
}
