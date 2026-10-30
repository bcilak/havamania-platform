import crypto from "node:crypto";

function encryptionKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) throw new Error("ENCRYPTION_KEY tanımlı değil.");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("ENCRYPTION_KEY 32 baytın base64 hali olmalı.");
  return key;
}

/** AES-256-GCM. Çıktı: v1:<iv>:<tag>:<şifreli metin> (base64). */
export function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), data.toString("base64")].join(":");
}

export function decrypt(payload: string): string {
  const [version, iv, tag, data] = payload.split(":");
  if (version !== "v1") throw new Error("Bilinmeyen şifreleme biçimi.");
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
}

export function decryptOrNull(payload: string | null | undefined): string | null {
  if (!payload) return null;
  try {
    return decrypt(payload);
  } catch {
    return null;
  }
}

/** Ekranda gösterim için: yalnızca son 4 karakter. */
export function maskSecret(secret: string | null | undefined): string {
  if (!secret) return "";
  return `••••${secret.slice(-4)}`;
}

export function randomToken(bytes = 24): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

const derivedCache = new Map<string, { raw: string; key: Buffer }>();

/**
 * `ENCRYPTION_KEY` baytlarından HKDF-SHA256 ile `info` etiketli alt anahtar (32 bayt). Ana anahtarı doğrudan başka
 * amaçla (HMAC) kullanmak yerine amaç başına ayrı anahtar türetilir: biri sızsa ya da kötüye kullanılsa diğerleri etkilenmez.
 * Anahtar eksik/bozuksa `encryptionKey()` gibi hata fırlatır. Sonuç `info` başına önbelleklenir (ortam değişkeni değişirse yenilenir).
 */
export function deriveKey(info: string): Buffer {
  const raw = process.env.ENCRYPTION_KEY ?? "";
  const cached = derivedCache.get(info);
  if (cached && cached.raw === raw) return cached.key;
  const key = Buffer.from(crypto.hkdfSync("sha256", encryptionKey(), Buffer.alloc(0), info, 32));
  derivedCache.set(info, { raw, key });
  return key;
}

export function hmac(data: string, secret: string | Buffer): string {
  return crypto.createHmac("sha256", secret).update(data).digest("base64url");
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}
