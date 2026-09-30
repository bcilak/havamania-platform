"use server";

import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { adminUsers } from "@/db/schema";
import { audit } from "@/lib/audit";
import { requireAdmin } from "@/lib/auth";
import { decryptOrNull, encrypt } from "@/lib/crypto";
import { done, fail, str } from "@/lib/form";
import { generateTotpSecret, verifyTotp } from "@/lib/totp";

const BACK = "/admin/hesabim";

export async function changePassword(fd: FormData) {
  const admin = await requireAdmin();
  const current = str(fd, "current", 200);
  const next = str(fd, "next", 200);
  if (next.length < 10) fail(BACK, "Yeni şifre en az 10 karakter olmalı.");
  if (next !== str(fd, "repeat", 200)) fail(BACK, "Yeni şifreler eşleşmiyor.");
  const [u] = await db.select().from(adminUsers).where(eq(adminUsers.id, admin.id));
  if (!u || !(await bcrypt.compare(current, u.passwordHash))) fail(BACK, "Mevcut şifre hatalı.");
  await db.update(adminUsers).set({ passwordHash: await bcrypt.hash(next, 11) }).where(eq(adminUsers.id, admin.id));
  await audit(admin, "user.update", admin.email, { password: true });
  done(BACK, "Şifreniz değiştirildi.");
}

export async function start2fa() {
  const admin = await requireAdmin();
  await db.update(adminUsers).set({ totpSecretEnc: encrypt(generateTotpSecret()), totpEnabled: false }).where(eq(adminUsers.id, admin.id));
  revalidatePath(BACK);
  done(BACK, "Anahtarı doğrulama uygulamanıza ekleyin ve oluşan kodu girin.");
}

export async function confirm2fa(fd: FormData) {
  const admin = await requireAdmin();
  const [u] = await db.select().from(adminUsers).where(eq(adminUsers.id, admin.id));
  const secret = decryptOrNull(u?.totpSecretEnc);
  if (!secret || !verifyTotp(secret, str(fd, "code", 12))) fail(BACK, "Kod hatalı. Uygulamadaki güncel kodu girin.");
  await db.update(adminUsers).set({ totpEnabled: true }).where(eq(adminUsers.id, admin.id));
  await audit(admin, "auth.2fa_enabled");
  done(BACK, "İki adımlı doğrulama açıldı. Bir sonraki girişte kod istenecek.");
}

export async function disable2fa(fd: FormData) {
  const admin = await requireAdmin();
  const [u] = await db.select().from(adminUsers).where(eq(adminUsers.id, admin.id));
  const secret = decryptOrNull(u?.totpSecretEnc);
  if (!secret || !verifyTotp(secret, str(fd, "code", 12))) fail(BACK, "Kod hatalı.");
  await db.update(adminUsers).set({ totpEnabled: false, totpSecretEnc: null }).where(eq(adminUsers.id, admin.id));
  await audit(admin, "auth.2fa_disabled");
  done(BACK, "İki adımlı doğrulama kapatıldı.");
}
