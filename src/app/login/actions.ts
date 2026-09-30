"use server";

import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { adminUsers } from "@/db/schema";
import { audit } from "@/lib/audit";
import { getAdmin } from "@/lib/auth";
import { decryptOrNull } from "@/lib/crypto";
import { str } from "@/lib/form";
import { ADMIN_COOKIE, PENDING_2FA_COOKIE, signAdminSession, signPending2fa, verifyPending2fa } from "@/lib/session";
import { verifyTotp } from "@/lib/totp";

/* Basit kaba kuvvet koruması: e-posta başına 15 dakikada 5 hatalı deneme. */
const failures = new Map<string, { count: number; until: number }>();
const WINDOW = 15 * 60 * 1000;

function locked(key: string): boolean {
  const f = failures.get(key);
  return !!f && f.count >= 5 && f.until > Date.now();
}
function recordFailure(key: string) {
  const f = failures.get(key);
  if (!f || f.until < Date.now()) failures.set(key, { count: 1, until: Date.now() + WINDOW });
  else f.count++;
}

function safeNext(next: string): string {
  return next.startsWith("/admin") ? next : "/admin";
}

async function startSession(user: typeof adminUsers.$inferSelect, next: string) {
  const token = await signAdminSession({ sub: user.id, role: user.role, email: user.email, name: user.name });
  const jar = await cookies();
  jar.set(ADMIN_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 12 * 3600,
  });
  jar.delete(PENDING_2FA_COOKIE);
  await db.update(adminUsers).set({ lastLoginAt: new Date() }).where(eq(adminUsers.id, user.id));
  await audit({ id: user.id, email: user.email }, "auth.login");
  redirect(safeNext(next));
}

export async function login(fd: FormData) {
  const email = str(fd, "email", 200).toLowerCase();
  const password = str(fd, "password", 200);
  const next = str(fd, "sonra", 200);
  const back = (msg: string) => redirect(`/login?hata=${encodeURIComponent(msg)}${next ? `&sonra=${encodeURIComponent(next)}` : ""}`);

  if (locked(email)) back("Çok fazla hatalı deneme. 15 dakika sonra tekrar deneyin.");
  const [user] = await db.select().from(adminUsers).where(eq(adminUsers.email, email));
  const ok = user && user.active && (await bcrypt.compare(password, user.passwordHash));
  if (!ok) {
    recordFailure(email);
    back("E-posta ya da şifre hatalı.");
  }
  failures.delete(email);

  if (user!.totpEnabled) {
    const jar = await cookies();
    jar.set(PENDING_2FA_COOKIE, await signPending2fa(user!.id), { httpOnly: true, sameSite: "lax", path: "/", maxAge: 300 });
    redirect(`/login?adim=kod${next ? `&sonra=${encodeURIComponent(next)}` : ""}`);
  }
  await startSession(user!, next);
}

export async function verifyCode(fd: FormData) {
  const code = str(fd, "code", 12);
  const next = str(fd, "sonra", 200);
  const jar = await cookies();
  const userId = await verifyPending2fa(jar.get(PENDING_2FA_COOKIE)?.value);
  if (!userId) redirect("/login?hata=" + encodeURIComponent("Doğrulama süresi doldu. Tekrar giriş yapın."));
  const key = `2fa:${userId}`;
  if (locked(key)) redirect("/login?adim=kod&hata=" + encodeURIComponent("Çok fazla hatalı deneme. 15 dakika sonra tekrar deneyin."));
  const [user] = await db.select().from(adminUsers).where(eq(adminUsers.id, userId!));
  const secret = decryptOrNull(user?.totpSecretEnc);
  if (!user || !user.active || !secret || !verifyTotp(secret, code)) {
    recordFailure(key);
    redirect("/login?adim=kod&hata=" + encodeURIComponent("Kod hatalı. Uygulamadaki güncel 6 haneli kodu girin."));
  }
  failures.delete(key);
  await startSession(user!, next);
}

export async function logout() {
  const admin = await getAdmin();
  const jar = await cookies();
  jar.delete(ADMIN_COOKIE);
  if (admin) await audit(admin, "auth.logout");
  redirect("/login");
}
