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
  /** Oturumsuz (imzalı bağlantılı) dosya istekleri: IP başına ve dosya anahtarı başına. Fotoğraf sunumu yeniden kodlama yapabilir. */
  fileSignedPerMinPerIp: envInt("RATE_LIMIT_FILE_SIGNED_PER_MIN", 120),
  fileSignedPerMinPerKey: envInt("RATE_LIMIT_FILE_SIGNED_PER_KEY_PER_MIN", 30),
  feedbackPerMin: envInt("RATE_LIMIT_FEEDBACK_PER_MIN", 30),
  /** Prompt önizleme embedding çağrısı yapar (maliyetli); IP ve yönetici başına ayrı sayılır. */
  promptPreviewPerMin: envInt("RATE_LIMIT_PROMPT_PREVIEW_PER_MIN", 20),
  /** Bilgi tabanı kaynağında deneme araması (embedding çağrısı yapar); yönetici başına. */
  kbSearchPerMin: envInt("RATE_LIMIT_KB_SEARCH_PER_MIN", 20),
  /** Boşluk analizinde anlamsal birleştirme (embedding çağrısı yapar); yönetici başına. */
  gapSemanticPerMin: envInt("RATE_LIMIT_GAP_SEMANTIC_PER_MIN", 6),
  /** Mobil backend köprüsü: kullanıcı başına, anahtar başına ve IP başına başarısız kimlik denemesi. */
  bridgePerMinPerUser: envInt("RATE_LIMIT_BRIDGE_PER_USER_PER_MIN", 8),
  bridgePerMinPerKey: envInt("RATE_LIMIT_BRIDGE_PER_KEY_PER_MIN", 120),
  bridgeAuthFailPerMin: envInt("RATE_LIMIT_BRIDGE_AUTH_FAIL_PER_MIN", 20),
  /** /ask: anahtar başına aynı anda çalışan istek, bekleyen kuyruk ve kuyrukta en uzun bekleme (ms). Dolunca 429. */
  bridgeConcurrencyPerKey: envInt("RATE_LIMIT_BRIDGE_CONCURRENCY", 16),
  bridgeQueuePerKey: envInt("RATE_LIMIT_BRIDGE_QUEUE", 32),
  bridgeQueueWaitMs: envInt("RATE_LIMIT_BRIDGE_QUEUE_WAIT_MS", 10_000),
  /** /ask: bot başına günlük köprü mesajı tavanı (maliyet). Kalıcı sayaçtan (bridge_usage) sayılır; silmeyle sıfırlanmaz. */
  bridgeDailyPerBot: envInt("BRIDGE_DAILY_MESSAGES_PER_BOT", 5000),
};

/** Dakikalık sınır aşıldığında istemcinin beklemesi gereken süre (sn): bir jeton dolana kadar. */
export function retryAfterFor(perMinute: number): number {
  return Math.max(1, Math.ceil(60 / perMinute));
}

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

/**
 * Ters vekil (Apache) arkasında gerçek istemci IP'si. Vekil, gördüğü IP'yi listenin SONUNA ekler;
 * baştaki değerleri istemci uydurabilir, bu yüzden en sağdaki alınır.
 */
export function clientIp(request: Request): string {
  const xf = request.headers.get("x-forwarded-for");
  return xf?.split(",").at(-1)?.trim() || request.headers.get("x-real-ip") || "yerel";
}

export function tooMany() {
  return NextResponse.json(
    { error: "Çok fazla istek gönderildi. Birkaç saniye bekleyip tekrar deneyin." },
    { status: 429, headers: { "retry-after": "20" } },
  );
}
