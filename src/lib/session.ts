import { SignJWT, jwtVerify } from "jose";
import type { AdminRole, Platform } from "@/db/schema";
import { hmac, safeEqual } from "./crypto";

/*
 * Bu dosya veritabanına dokunmaz; proxy.ts de kullandığı için hafif kalmalı.
 */

export const ADMIN_COOKIE = "hm_admin";
export const PENDING_2FA_COOKIE = "hm_2fa";

function rawSecret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("SESSION_SECRET en az 32 karakter olmalı.");
  return s;
}
const key = () => new TextEncoder().encode(rawSecret());

export type AdminSession = { sub: string; role: AdminRole; email: string; name: string };

export async function signAdminSession(s: AdminSession): Promise<string> {
  return new SignJWT({ role: s.role, email: s.email, name: s.name })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(s.sub)
    .setAudience("admin")
    .setIssuedAt()
    .setExpirationTime("12h")
    .sign(key());
}

export async function verifyAdminSession(token: string | undefined): Promise<AdminSession | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(), { audience: "admin" });
    return {
      sub: String(payload.sub),
      role: payload.role as AdminRole,
      email: String(payload.email),
      name: String(payload.name),
    };
  } catch {
    return null;
  }
}

/** Şifre doğru, iki adımlı doğrulama kodu bekleniyor. 5 dakika geçerli. */
export async function signPending2fa(userId: string): Promise<string> {
  return new SignJWT({}).setProtectedHeader({ alg: "HS256" }).setSubject(userId).setAudience("admin-2fa").setExpirationTime("5m").sign(key());
}

export async function verifyPending2fa(token: string | undefined): Promise<string | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(), { audience: "admin-2fa" });
    return String(payload.sub);
  } catch {
    return null;
  }
}

/* ---------- Widget oturumu ---------- */

export type WidgetSession = { appUserId: string; botId: string; platform: Platform };

export async function signWidgetToken(s: WidgetSession): Promise<string> {
  return new SignJWT({ botId: s.botId, platform: s.platform })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(s.appUserId)
    .setAudience("widget")
    .setIssuedAt()
    .setExpirationTime("24h")
    .sign(key());
}

export async function verifyWidgetToken(token: string | undefined | null): Promise<WidgetSession | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(), { audience: "widget" });
    return { appUserId: String(payload.sub), botId: String(payload.botId), platform: payload.platform as Platform };
  } catch {
    return null;
  }
}

/**
 * Havamania uygulamasının backend'inin imzaladığı kullanıcı token'ı.
 * HS256, bot'un token anahtarıyla. `sub` = uygulamadaki kullanıcı kimliği.
 */
export async function verifyAppUserToken(token: string, secret: string): Promise<{ sub: string } | null> {
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret));
    if (!payload.sub) return null;
    return { sub: String(payload.sub) };
  } catch {
    return null;
  }
}

/* ---------- İmzalı dosya linkleri ---------- */

export function signedFileUrl(storageKey: string, ttlSeconds = 3600): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const sig = hmac(`${storageKey}:${exp}`, rawSecret());
  return `/api/files/${storageKey}?exp=${exp}&sig=${sig}`;
}

export function verifyFileSignature(storageKey: string, exp: string | null, sig: string | null): boolean {
  if (!exp || !sig) return false;
  if (Number(exp) < Math.floor(Date.now() / 1000)) return false;
  return safeEqual(hmac(`${storageKey}:${exp}`, rawSecret()), sig);
}
