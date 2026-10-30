import { deriveKey, hmac, safeEqual } from "@/lib/crypto";
import { BRIDGE_LIMITS, type AskInput } from "./schema";

/*
 * `request_id` yineleme koruması: saf parça (DB yok). İstek gövdesinin parmak izi ve mevcut satır için karar fonksiyonu.
 * DB katmanı `request-db.ts`tedir.
 */

/** Kimliğin geçerlilik süresi; bundan eski satır yeni istek sayılır (günlük cron satırı siler). */
export const REQUEST_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * İşlemdeki isteğin bayat sayıldığı süre: model bütçesi (kuyruk beklemesini de içerir) + kayıt payı.
 * Bundan sonra aynı kimlikle gelen istek işi devralır; eski çalışma `attempt_id` koşulu yüzünden satırı ezemez.
 *
 * Bilinen sınır: süre yalnızca model çağrısını sınırlar (AbortSignal bütçesi). DB beklemeleri (bağlantı havuzu, kilit,
 * `prepareTurn`/kayıt) uzarsa ya da `completeRequest` başarısız olursa satır `updated_at` yüzünden bayatlayıp aynı kimlikle
 * yeniden işlenebilir. Sonuç çift model maliyetidir; veri bozulmaz: tamamlama/başarısızlık/iade `attempt_id` koşulludur, bayat
 * çalışma sonradan gelip yeni sahibin satırını ezemez.
 */
export const REQUEST_STALE_MS = BRIDGE_LIMITS.timeoutMs + 20_000;

/** Parmak izi alan ayrımı etiketi; sürüm değişirse eski özetler eşleşmez. */
const FINGERPRINT_LABEL = "bridge-request:v1\n";

/** HKDF `info` etiketi: parmak izi alt anahtarı yalnızca bu amaca ayrılmıştır (sürüm değişirse eski özetler eşleşmez). */
const FINGERPRINT_KEY_INFO = "bridge-request:v1";

/**
 * Parmak izi HMAC anahtarı: `ENCRYPTION_KEY` baytlarından HKDF-SHA256 ile türetilen alt anahtar (yeni ortam değişkeni yok).
 * Ham ana anahtar şifreleme dışında kullanılmaz. Anahtar eksik ya da 32 bayt değilse hata fırlatır (route bunu
 * kullanıcı kaydından önce 500 internal_error'a çevirir). Türetme önbelleklidir.
 */
export function fingerprintSecret(): Buffer {
  return deriveKey(FINGERPRINT_KEY_INFO);
}

/**
 * Derin anahtar sıralı, null/undefined alanları atılmış kopya. Diziler sırayı korur (dizideki null konumu bozmamak için kalır).
 * `{a:1,b:null}` ile `{a:1}` ve anahtar sırası farkı aynı sonucu verir.
 */
export function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((v) => (v === undefined ? null : canonicalize(v)));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value).sort()) {
      const v = (value as Record<string, unknown>)[k];
      if (v === null || v === undefined) continue;
      out[k] = canonicalize(v);
    }
    return out;
  }
  return value;
}

/** Parmak izine giren etkin bağlamı belirleyen, istemciden gelmeyen bilgi (route hesaplar). */
export type FingerprintEffective = {
  /** Geçerli ayrı sağlık rızası var mı (`healthConsentGiven`)? Yoksa `profile.health_sensitivities` modele gitmez. */
  health: boolean;
};

/**
 * Modele gerçekten giren bağlam: `personalization === false` ise `profile` ve `trips` çıkar; sağlık rızası geçerli değilse
 * `profile.health_sensitivities` çıkar (bkz. `toClientContext`). Böylece modele hiç girmeyen alanın değişmesi (ör. rızasız
 * sağlık metni) aynı `request_id` ile yeniden denemeyi 422'ye çevirmez ve parmak izi kullanılmayan kişisel veriyi içermez.
 */
function effectiveContext(input: AskInput, effective: FingerprintEffective): AskInput["context"] {
  const ctx = input.context;
  if (!ctx) return ctx;
  const { profile, trips, ...rest } = ctx;
  if (input.personalization === false) return rest;
  if (!profile) return { ...rest, trips };
  const { health_sensitivities, ...profileRest } = profile;
  const kept = effective.health ? { ...profileRest, health_sensitivities } : profileRest;
  // Yalnızca elenen alandan oluşan profil, hiç profil gönderilmemiş gibi sayılır (modele giren aynı).
  return { ...rest, trips, profile: Object.values(kept).some((v) => v != null) ? kept : undefined };
}

/**
 * Yanıtı etkileyen alanların kanonik JSON'u (sürüm alanlı). Zod ayrıştırması ve varsayılanlar uygulanmış girdi beklenir.
 * `context` ham değil etkin bağlamdır (`effectiveContext`).
 * Hariç: `user_id` (zaten anahtarda), `request_id`, `consent_version` (onay alınıp aynı kimlikle yeniden denenebilsin),
 * `client` ve `language` (cevabı etkilemez).
 */
export function canonicalAsk(input: AskInput, effective: FingerprintEffective): string {
  return JSON.stringify(
    canonicalize({
      v: 1,
      question: input.question,
      mode: input.mode,
      conversation_id: input.conversation_id ? input.conversation_id.toLowerCase() : null,
      tone: input.tone ?? null,
      health_consent: input.health_consent === true,
      health_consent_version: input.health_consent_version ?? null,
      personalization: input.personalization !== false,
      context: effectiveContext(input, effective) ?? null,
    }),
  );
}

/** Anahtarlı HMAC-SHA256 parmak izi (base64url). Soru/bağlam düşük entropili kişisel veri olabileceği için düz özet kullanılmaz. */
export function askFingerprint(input: AskInput, secret: string | Buffer, effective: FingerprintEffective): string {
  return hmac(FINGERPRINT_LABEL + canonicalAsk(input, effective), secret);
}

export type RequestRow = {
  status: "in_progress" | "completed" | "failed";
  bodyHash: string;
  messageId?: string | null;
};

export type RequestAges = {
  /** `now() - created_at` (ms), DB saatiyle. */
  createdMs: number;
  /** `now() - updated_at` (ms), DB saatiyle. */
  updatedMs: number;
};

export type RequestDecision =
  | { kind: "replay" }
  | { kind: "in_progress"; retryAfter: number }
  | { kind: "reused" }
  | { kind: "reclaim" };

/**
 * Mevcut satır için karar. Öncelik sırası:
 *  1) işlemdeki (bayat olmayan) satır dışında 24 saatten eski -> reclaim (yeni istek; farklı özet de 422 vermez)
 *  2) özet farklı -> reused (422)
 *  3) completed -> replay (kayıtlı cevap; `opts.missingMessageId` bu satırın mesajıysa ve artık yoksa reclaim)
 *  4) in_progress ve bayat değil -> in_progress (409, Retry-After 1-10)
 *  5) failed ya da bayat in_progress -> reclaim
 *
 * TTL dalı bayat olmayan `in_progress` satırlara uygulanmaz: TTL sınırında işlemdeki bir isteğin başkası tarafından
 * devralınıp modelin ikinci kez çağrılması (çift maliyet, iki cevap) önlenir. Bu satır 4. adımda 409 alır; çalışma
 * bitince (ya da bayatlayınca) bir sonraki istek normal akışa girer.
 *
 * Her devralmada (`reclaim`) `created_at` sıfırlanır (db katmanı): 24 saatlik geçerlilik ve günlük temizlik her zaman
 * satırın SON sahiplenmesinden sayılır. Böylece devralınan bir çalışma, ilk denemenin yaşı yüzünden hemen TTL'e
 * düşüp tekrar devralınmaz ve tamamlanan cevap devralmadan sonra tam süre boyunca tekrar edilebilir.
 */
export function decideExisting(row: RequestRow, hash: string, ages: RequestAges, opts: { missingMessageId?: string } = {}): RequestDecision {
  const inFlight = row.status === "in_progress" && ages.updatedMs < REQUEST_STALE_MS;
  if (!inFlight && ages.createdMs >= REQUEST_TTL_MS) return { kind: "reclaim" };
  if (!safeEqual(row.bodyHash, hash)) return { kind: "reused" };
  if (row.status === "completed") {
    if (opts.missingMessageId && row.messageId === opts.missingMessageId) return { kind: "reclaim" };
    return { kind: "replay" };
  }
  if (inFlight) return { kind: "in_progress", retryAfter: staleRetryAfter(ages.updatedMs) };
  return { kind: "reclaim" };
}

/** Kalan bayatlık süresinden Retry-After: 1-10 sn arasına sıkışır. */
export function staleRetryAfter(updatedMs: number): number {
  return Math.min(10, Math.max(1, Math.ceil((REQUEST_STALE_MS - updatedMs) / 1000)));
}
