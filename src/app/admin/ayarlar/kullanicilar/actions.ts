"use server";

import bcrypt from "bcryptjs";
import { and, eq, ne, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { db } from "@/db";
import { adminUsers, type AdminRole } from "@/db/schema";
import { audit } from "@/lib/audit";
import { requireAdmin } from "@/lib/auth";
import { randomToken } from "@/lib/crypto";
import { bool, done, fail, str } from "@/lib/form";
import { ROLES } from "@/lib/roles";

const BACK = "/admin/ayarlar/kullanicilar";

/** Geçici şifreyi URL'ye değil, 2 dakikalık bir çereze koyar; sayfa bir kez gösterir. */
async function revealOnce(email: string, password: string) {
  const jar = await cookies();
  jar.set("hm_temp_pw", JSON.stringify({ email, password }), { httpOnly: true, sameSite: "strict", path: BACK, maxAge: 120 });
}

async function superAdminCount(exceptId?: string) {
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(adminUsers)
    .where(and(eq(adminUsers.role, "super_admin"), eq(adminUsers.active, true), exceptId ? ne(adminUsers.id, exceptId) : undefined));
  return n;
}

export async function createUser(fd: FormData) {
  const admin = await requireAdmin("users");
  const email = str(fd, "email", 200).toLowerCase();
  const name = str(fd, "name", 120);
  const role = str(fd, "role") as AdminRole;
  if (!email.includes("@") || !name) fail(BACK, "Ad ve geçerli bir e-posta girin.");
  if (!ROLES.includes(role)) fail(BACK, "Rol seçin.");
  const [exists] = await db.select({ id: adminUsers.id }).from(adminUsers).where(eq(adminUsers.email, email));
  if (exists) fail(BACK, "Bu e-postayla bir kullanıcı zaten var.");
  const password = randomToken(9);
  await db.insert(adminUsers).values({ email, name, role, passwordHash: await bcrypt.hash(password, 11) });
  await revealOnce(email, password);
  await audit(admin, "user.create", email, { role });
  revalidatePath(BACK);
  done(BACK, `${name} eklendi.`);
}

export async function updateUser(fd: FormData) {
  const admin = await requireAdmin("users");
  const id = str(fd, "id");
  const role = str(fd, "role") as AdminRole;
  const active = bool(fd, "active");
  if (!ROLES.includes(role)) fail(BACK, "Geçersiz rol.");
  const [u] = await db.select().from(adminUsers).where(eq(adminUsers.id, id));
  if (!u) fail(BACK, "Kullanıcı bulunamadı.");
  if (u!.role === "super_admin" && (role !== "super_admin" || !active) && (await superAdminCount(id)) === 0) {
    fail(BACK, "Son aktif süper admin'in rolü değiştirilemez veya devre dışı bırakılamaz.");
  }
  if (id === admin.id && !active) fail(BACK, "Kendi hesabınızı devre dışı bırakamazsınız.");
  await db.update(adminUsers).set({ role, active }).where(eq(adminUsers.id, id));
  await audit(admin, "user.update", u!.email, { role, active });
  revalidatePath(BACK);
  done(BACK, `${u!.name} güncellendi.`);
}

export async function resetPassword(fd: FormData) {
  const admin = await requireAdmin("users");
  const id = str(fd, "id");
  const [u] = await db.select().from(adminUsers).where(eq(adminUsers.id, id));
  if (!u) fail(BACK, "Kullanıcı bulunamadı.");
  const password = randomToken(9);
  await db.update(adminUsers).set({ passwordHash: await bcrypt.hash(password, 11) }).where(eq(adminUsers.id, id));
  await revealOnce(u!.email, password);
  await audit(admin, "user.password_reset", u!.email);
  revalidatePath(BACK);
  done(BACK, `${u!.name} için yeni geçici şifre oluşturuldu.`);
}

export async function reset2fa(fd: FormData) {
  const admin = await requireAdmin("users");
  const id = str(fd, "id");
  const [u] = await db.select().from(adminUsers).where(eq(adminUsers.id, id));
  if (!u) fail(BACK, "Kullanıcı bulunamadı.");
  await db.update(adminUsers).set({ totpEnabled: false, totpSecretEnc: null }).where(eq(adminUsers.id, id));
  await audit(admin, "auth.2fa_disabled", u!.email, { by: "admin" });
  revalidatePath(BACK);
  done(BACK, `${u!.name} için iki adımlı doğrulama sıfırlandı.`);
}
