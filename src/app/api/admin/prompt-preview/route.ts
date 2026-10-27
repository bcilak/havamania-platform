import { NextResponse } from "next/server";
import { ChatError, previewPrompt } from "@/lib/ai/turn";
import { isJsonContentType, isSameOrigin, parsePreviewRequest, PREVIEW_LIMITS, readBodyLimited } from "@/lib/ai/prompt-preview-core";
import { getAdmin } from "@/lib/auth";
import { getMainBot } from "@/lib/bot";
import { allow, clientIp, LIMITS } from "@/lib/rate-limit";
import { can } from "@/lib/roles";

/*
 * Sistem promptu önizlemesi (test alanı). Prompt içeriği (kurallar, kişilik talimatı, bilgi tabanı
 * parçaları) hassas sayılır: yalnızca `training` yetkisi olan yönetici görür; destek rolü göremez.
 * Yetki kontrolü proxy'ye bırakılmaz, burada yapılır. Model çağrılmaz, veritabanına yazılmaz.
 * Yanıtlar önbelleğe alınmaz.
 */

const NO_STORE = { "cache-control": "no-store, max-age=0", pragma: "no-cache" };
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  NextResponse.json(body, { status, headers: { ...NO_STORE, ...headers } });
const err = (error: string, status: number, headers?: Record<string, string>) => json({ error }, status, headers);

export async function POST(request: Request) {
  const admin = await getAdmin();
  if (!admin) return err("Oturum süresi doldu. Sayfayı yenileyin.", 401);
  if (!can(admin.role, "training")) return err("Bu işlem için yetkiniz yok.", 403);

  // CSRF: çerez SameSite=Lax olsa da ikinci katman olarak aynı-site ve JSON zorunlu.
  if (!isSameOrigin({ origin: request.headers.get("origin"), host: request.headers.get("host"), forwardedHost: request.headers.get("x-forwarded-host") })) {
    return err("İstek kaynağı doğrulanamadı.", 403);
  }
  if (!isJsonContentType(request.headers.get("content-type"))) return err("İçerik türü application/json olmalı.", 415);

  if (!allow(`prompt-preview-ip:${clientIp(request)}`, LIMITS.promptPreviewPerMin) || !allow(`prompt-preview-admin:${admin.id}`, LIMITS.promptPreviewPerMin)) {
    return err("Çok fazla istek gönderildi. Birkaç saniye bekleyip tekrar deneyin.", 429, { "retry-after": "20" });
  }

  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > PREVIEW_LIMITS.maxBodyBytes) return err("İstek çok büyük.", 413);
  // Gövde akış olarak okunur; sınır aşılınca (Content-Length yalan ya da yok olsa da) okuma durur.
  const raw = await readBodyLimited(request.body, PREVIEW_LIMITS.maxBodyBytes);
  if (raw === null) return err("İstek çok büyük.", 413);
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return err("Geçersiz istek.", 400);
  }
  const parsed = parsePreviewRequest(body);
  if (!parsed.ok) return err(parsed.error, 400);

  try {
    const bot = await getMainBot();
    return json(await previewPrompt({ bot, ...parsed.value }));
  } catch (e) {
    if (e instanceof ChatError) return err(e.message, e.status);
    console.error("[api/admin/prompt-preview]", e);
    return err("Beklenmeyen bir hata oluştu.", 500);
  }
}
