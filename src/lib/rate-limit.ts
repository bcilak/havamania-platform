import { NextResponse } from "next/server";

/*
 * Süreç içi token-bucket hız sınırı. Tek sunucu için yeterli; birden çok
 * örnek çalıştırılırsa Redis gibi paylaşılan bir depoya taşınmalı.
 * Anonim modda cihaz kimliği değiştirilerek günlük kullanıcı sınırı aşılabilir;
 * bu sınırlar o istismarın hızını keser. Kesin çözüm: anonim erişimi kapatıp
 * imzalı kullanıcı token'ı istemek (Yayın › Gömme).
 */

type Bucket = { tokens: number; at: number };
const buckets = new Map<string, Bucket>();

const envInt = (name: string, fallback: number) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export const LIMITS = {
  sessionPerMin: envInt("RATE_LIMIT_SESSION_PER_MIN", 20),
  chatPerMinPerIp: envInt("RATE_LIMIT_CHAT_PER_MIN", 30),
  chatPerMinPerUser: envInt("RATE_LIMIT_CHAT_PER_USER_PER_MIN", 8),
  uploadPerMin: envInt("RATE_LIMIT_UPLOAD_PER_MIN", 10),
  feedbackPerMin: envInt("RATE_LIMIT_FEEDBACK_PER_MIN", 30),
};

/** true: istek geçebilir. */
export function allow(key: string, perMinute: number): boolean {
  const now = Date.now();
  const b = buckets.get(key) ?? { tokens: perMinute, at: now };
  b.tokens = Math.min(perMinute, b.tokens + ((now - b.at) / 60_000) * perMinute);
  b.at = now;
  const ok = b.tokens >= 1;
  if (ok) b.tokens -= 1;
  buckets.set(key, b);
  if (buckets.size > 50_000) {
    for (const [k, v] of buckets) if (now - v.at > 10 * 60_000) buckets.delete(k);
  }
  return ok;
}

/** Ters vekil (nginx, Cloudflare) arkasında gerçek istemci IP'si. */
export function clientIp(request: Request): string {
  const xf = request.headers.get("x-forwarded-for");
  return xf?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "yerel";
}

export function tooMany() {
  return NextResponse.json(
    { error: "Çok fazla istek gönderildi. Birkaç saniye bekleyip tekrar deneyin." },
    { status: 429, headers: { "retry-after": "20" } },
  );
}
