import { NextResponse } from "next/server";
import { db } from "@/db";
import { attachments } from "@/db/schema";
import { getAdmin } from "@/lib/auth";
import { getMainBot, getPublishedVersion } from "@/lib/bot";
import { IMAGE_LIMITS, ImageRejectedError, sanitizeImage } from "@/lib/image-sanitize";
import { IMAGE_RETRY_AFTER, runImageWork } from "@/lib/image-limiter";
import { LimiterBusyError } from "@/lib/limiter";
import { allow, clientIp, LIMITS, tooMany } from "@/lib/rate-limit";
import { can } from "@/lib/roles";
import { newStorageKey, storage } from "@/lib/storage";
import { widgetFromRequest } from "@/lib/widget-auth";

// HEIC/HEIF kabul edilmez: sharp'ın hazır ikilileri HEVC çözemez, temizlenemeyen dosya saklanmaz.
const TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const HEIC_TYPES = ["image/heic", "image/heif"];

const REJECT_MESSAGES = {
  format: "Yalnızca fotoğraf gönderebilirsiniz.",
  heic: "HEIC fotoğraflar desteklenmiyor; JPEG olarak gönderin.",
  pixels: `Fotoğrafın çözünürlüğü çok yüksek (en fazla ${IMAGE_LIMITS.maxPixels / 1_000_000} MP).`,
  decode: "Fotoğraf okunamadı.",
} as const;

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
  if (HEIC_TYPES.includes(file.type)) return NextResponse.json({ error: REJECT_MESSAGES.heic }, { status: 400 });
  if (!TYPES.includes(file.type)) return NextResponse.json({ error: "Yalnızca fotoğraf gönderebilirsiniz." }, { status: 400 });
  if (file.size > maxMb * 1024 * 1024) return NextResponse.json({ error: `En fazla ${maxMb} MB.` }, { status: 400 });

  // Gerçek biçim magic byte ile doğrulanır, görsel meta verisiz yeniden kodlanır. Anahtar uzantısı çıktı biçiminden gelir, dosya adından değil.
  let out;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    // Paylaşılan görsel işleme sınırı: eşzamanlı yeniden kodlama sınırlı, kuyruk ve bekleme süresi üst sınırlı.
    out = await runImageWork(() => sanitizeImage(bytes));
  } catch (err) {
    if (err instanceof LimiterBusyError) {
      return NextResponse.json({ error: "Sunucu meşgul. Birkaç saniye sonra tekrar deneyin." }, { status: 503, headers: { "retry-after": IMAGE_RETRY_AFTER } });
    }
    const code = err instanceof ImageRejectedError ? err.code : "decode";
    return NextResponse.json({ error: REJECT_MESSAGES[code] }, { status: 400 });
  }
  const key = newStorageKey("photos", out.ext);
  await storage.put(key, out.data, out.mediaType);
  const [row] = await db.insert(attachments).values({ appUserId, storageKey: key, mediaType: out.mediaType, size: out.data.byteLength }).returning();
  return NextResponse.json({ id: row.id });
}
