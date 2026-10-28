"use server";

import { revalidatePath } from "next/cache";
import { audit } from "@/lib/audit";
import { requireAdmin } from "@/lib/auth";
import { usesToken } from "@/lib/consent";
import { bool, done, fail, num, str } from "@/lib/form";
import { getMainBot } from "@/lib/bot";
import { deleteUserData, ReservedIdentifierError, runRetentionCleanup } from "@/lib/kvkk";
import { getSetting, setSetting } from "@/lib/settings";

const BACK = "/admin/ayarlar/kvkk";

export async function saveKvkk(fd: FormData) {
  const admin = await requireAdmin("kvkk");
  const prev = await getSetting("kvkk");
  const consentText = str(fd, "consentText", 4000);
  if (consentText.length < 40) fail(BACK, "Aydınlatma metni çok kısa.");
  // Sağlık verisi rızası ayrı metin ve ayrı sürümdür (KVKK m. 6); yalnızca mobil kullanır.
  const healthConsentText = str(fd, "healthConsentText", 4000);
  if (healthConsentText.length < 40) fail(BACK, "Sağlık verisi rıza metni çok kısa.");
  const retentionDays = num(fd, "retentionDays", 180, 7, 3650);
  // Metin {{saklama}} içeriyorsa kullanıcıya gösterilen süre değişmiştir: onay metni değişmiş sayılır.
  const retentionShown = retentionDays !== prev.retentionDays && usesToken(consentText, "{{saklama}}");
  const bump = bool(fd, "bump") || consentText !== prev.consentText || retentionShown;
  const healthRetentionShown = retentionDays !== prev.retentionDays && usesToken(healthConsentText, "{{saklama}}");
  const healthBump = bool(fd, "bumpHealth") || healthConsentText !== prev.healthConsentText || healthRetentionShown;
  const next = {
    ...prev,
    retentionDays,
    consentText,
    consentVersion: bump ? prev.consentVersion + 1 : prev.consentVersion,
    consentUpdatedAt: bump ? new Date().toISOString() : prev.consentUpdatedAt,
    healthConsentText,
    healthConsentVersion: healthBump ? prev.healthConsentVersion + 1 : prev.healthConsentVersion,
  };
  await setSetting("kvkk", next);
  await audit(admin, "kvkk.update", null, {
    retentionDays: next.retentionDays,
    consentVersion: next.consentVersion,
    healthConsentVersion: next.healthConsentVersion,
  });
  revalidatePath(BACK);
  const notes = [
    bump ? `Onay metni v${next.consentVersion}: widget ve mobil uygulama kullanıcılarından bir sonraki açışlarında yeniden onay istenecek.` : "",
    healthBump ? `Sağlık verisi rızası v${next.healthConsentVersion}: mobil uygulama bu rızayı yeniden isteyene kadar sağlık hassasiyetleri asistana gönderilmez.` : "",
  ].filter(Boolean);
  done(BACK, notes.length ? `Kaydedildi. ${notes.join(" ")}` : "Kaydedildi.");
}

export async function cleanupNow() {
  const admin = await requireAdmin("kvkk");
  const cfg = await getSetting("kvkk");
  const r = await runRetentionCleanup(cfg.retentionDays);
  await setSetting("kvkk", { ...cfg, lastCleanupAt: new Date().toISOString() });
  await audit(admin, "kvkk.cleanup", null, r);
  revalidatePath(BACK);
  done(BACK, `Temizlik tamamlandı: ${r.conversations} konuşma, ${r.photos + r.orphans} fotoğraf silindi.`);
}

export async function handleDeletion(fd: FormData) {
  const admin = await requireAdmin("kvkk");
  const identifier = str(fd, "identifier", 200);
  const type = str(fd, "type") === "external_user" ? "external_user" : "device";
  if (identifier.length < 3) fail(BACK, "Kimliği girin.");
  const bot = await getMainBot();
  let r: Awaited<ReturnType<typeof deleteUserData>>;
  try {
    r = await deleteUserData({ botId: bot.id, identifier, type, requestedBy: admin.email });
  } catch (e) {
    // "bridge" öneki köprü kullanıcılarına ayrılmıştır; cihaz kimliğiyle silme tüm mobil kullanıcıları silerdi.
    if (e instanceof ReservedIdentifierError) fail(BACK, "Bu kimlikle silme yapılamaz; kullanıcı kimliğini kullanın.");
    throw e;
  }
  await audit(admin, "kvkk.delete_user", type, { found: r.found, conversations: r.conversations });
  revalidatePath(BACK);
  if (!r.found) fail(BACK, "Bu kimlikle kayıtlı kullanıcı bulunamadı. Talep 'bulunamadı' olarak kaydedildi.");
  done(BACK, `Silindi: ${r.conversations} konuşma ve ${r.photos} fotoğraf.`);
}
