"use server";

import { revalidatePath } from "next/cache";
import { audit } from "@/lib/audit";
import { requireAdmin } from "@/lib/auth";
import { bool, done, fail, num, str } from "@/lib/form";
import { deleteUserData, runRetentionCleanup } from "@/lib/kvkk";
import { getSetting, setSetting } from "@/lib/settings";

const BACK = "/admin/ayarlar/kvkk";

export async function saveKvkk(fd: FormData) {
  const admin = await requireAdmin("kvkk");
  const prev = await getSetting("kvkk");
  const consentText = str(fd, "consentText", 4000);
  if (consentText.length < 40) fail(BACK, "Aydınlatma metni çok kısa.");
  const bump = bool(fd, "bump") || consentText !== prev.consentText;
  const next = {
    ...prev,
    retentionDays: num(fd, "retentionDays", 180, 7, 3650),
    consentText,
    consentVersion: bump ? prev.consentVersion + 1 : prev.consentVersion,
  };
  await setSetting("kvkk", next);
  await audit(admin, "kvkk.update", null, { retentionDays: next.retentionDays, consentVersion: next.consentVersion });
  revalidatePath(BACK);
  done(BACK, bump ? `Kaydedildi. Onay metni v${next.consentVersion}: kullanıcılardan sohbeti bir sonraki açışlarında yeniden onay istenecek.` : "Kaydedildi.");
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
  const r = await deleteUserData(identifier, type, admin.email);
  await audit(admin, "kvkk.delete_user", type, { found: r.found, conversations: r.conversations });
  revalidatePath(BACK);
  if (!r.found) fail(BACK, "Bu kimlikle kayıtlı kullanıcı bulunamadı. Talep 'bulunamadı' olarak kaydedildi.");
  done(BACK, `Silindi: ${r.conversations} konuşma ve ${r.photos} fotoğraf.`);
}
