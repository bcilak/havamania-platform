import type { LegalSettings } from "./legal";
import type { KvkkSettings } from "./settings";

/*
 * Açık rıza metni tek kaynaktan sunulur: widget oturumu ve mobil köprü (`GET /api/bridge/consent`, 428)
 * aynı fonksiyonla yer tutucuları doldurur. Bu dosya saf tutulur (veritabanı yok); ayarları okuyan
 * kısım `consent-server.ts`'tedir.
 */

/** Hiçbir tarih kaydı yokken `/consent`'in `updated_at` değeri (varsayılan sürüm 2'nin yayın günü). */
export const KVKK_DEFAULT_CONSENT_DATE = "2026-10-27T00:00:00.000Z";

export const CONSENT_TOKENS = ["{{saklama}}", "{{sirket}}", "{{site}}"] as const;

/** `{{saklama}}` (gün), `{{sirket}}` ve `{{site}}` doldurulur. Tanımsız yer tutucu olduğu gibi kalır. */
export function renderConsentText(kvkk: Pick<KvkkSettings, "consentText" | "retentionDays">, legal: Pick<LegalSettings, "company">, siteUrl: string): string {
  return fillTokens(kvkk.consentText, kvkk.retentionDays, legal, siteUrl);
}

/** Sağlık verisi rızası metni (yalnızca mobil): aynı yer tutucular, ayrı metin. */
export function renderHealthConsentText(kvkk: Pick<KvkkSettings, "healthConsentText" | "retentionDays">, legal: Pick<LegalSettings, "company">, siteUrl: string): string {
  return fillTokens(kvkk.healthConsentText, kvkk.retentionDays, legal, siteUrl);
}

function fillTokens(text: string, retentionDays: number, legal: Pick<LegalSettings, "company">, siteUrl: string): string {
  const values: Record<string, string> = {
    "{{saklama}}": String(retentionDays),
    "{{sirket}}": legal.company.trim() || "Altıkod Digital Solutions",
    "{{site}}": siteUrl.replace(/\/$/, ""),
  };
  return text.replace(/\{\{[a-z]+\}\}/g, (t) => (Object.hasOwn(values, t) ? values[t] : t));
}

/** `updated_at` sırası: `consentUpdatedAt`, yoksa ayar satırının kayıt tarihi, o da yoksa sabit varsayılan. Her zaman ISO metin. */
export function resolveConsentUpdatedAt(consentUpdatedAt: string | null | undefined, rowUpdatedAt: Date | null | undefined): string {
  for (const v of [consentUpdatedAt, rowUpdatedAt]) {
    if (!v) continue;
    const d = v instanceof Date ? v : new Date(v);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return KVKK_DEFAULT_CONSENT_DATE;
}

/** Onay metni bu yer tutucuyu içeriyor mu? İçeriyorsa değeri (saklama süresi, şirket adı) değişince sürüm artar. */
export function usesToken(consentText: string, token: (typeof CONSENT_TOKENS)[number]): boolean {
  return consentText.includes(token);
}

/**
 * `/ask` isteğindeki sağlık rızası geçerli mi? Yalnızca `health_consent === true` VE `health_consent_version` güncel sürümle
 * eşleşirse true. Sürüm gönderilmemişse hangi metne rıza verildiği bilinmez, geçersiz sayılır. Hata verilmez: false ise
 * sağlık hassasiyetleri modele gitmez, istek normal sürer.
 */
export function healthConsentGiven(
  input: { health_consent?: boolean | null; health_consent_version?: number | null },
  currentVersion: number,
): boolean {
  return input.health_consent === true && input.health_consent_version === currentVersion;
}
