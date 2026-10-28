import { eq } from "drizzle-orm";
import { db } from "@/db";
import { settings } from "@/db/schema";
import type { ToolId } from "./bot-config";
import { KVKK_DEFAULTS } from "./kvkk-defaults";
import { LEGAL_DEFAULTS, type LegalSettings } from "./legal";

export type IntegrationSettings = {
  baseUrl: string;
  apiKeyEnc: string | null;
  authHeader: string;
  endpoints: Record<ToolId, string>;
  timeoutMs: number;
};

export type EmbeddingSettings = {
  providerId: string | null;
  model: string | null;
};

export type KvkkSettings = {
  retentionDays: number;
  consentVersion: number;
  consentText: string;
  /** Onay metni/sürümü en son ne zaman değişti (ISO). Kayıtlı değer yoksa `/consent` ayarın kayıt tarihine döner. */
  consentUpdatedAt: string | null;
  /**
   * Sağlık verisi (özel nitelikli, KVKK m. 6) için AYRI açık rıza metni ve sürümü. Yalnızca mobil uygulama kullanır
   * (widget sağlık verisi toplamaz). Sürüm, metin değişince artar. Şema değişikliği gerekmez (ayar JSON'u).
   */
  healthConsentText: string;
  healthConsentVersion: number;
  lastCleanupAt: string | null;
};

type SettingsMap = {
  integration: IntegrationSettings;
  embedding: EmbeddingSettings;
  kvkk: KvkkSettings;
  legal: LegalSettings;
};

const DEFAULTS: SettingsMap = {
  integration: {
    baseUrl: "",
    apiKeyEnc: null,
    authHeader: "Authorization",
    endpoints: {
      current_weather: "/v1/weather/current",
      forecast: "/v1/weather/forecast",
      agro_conditions: "/v1/agro/conditions",
      flight_weather: "/v1/fly/route",
    },
    timeoutMs: 8000,
  },
  embedding: { providerId: null, model: null },
  kvkk: KVKK_DEFAULTS,
  legal: LEGAL_DEFAULTS,
};

/** `db` ya da bir transaction (ayar, başka yazmalarla aynı transaction'da okunup yazılabilsin). */
type Executor = Pick<typeof db, "select" | "insert">;

export async function getSetting<K extends keyof SettingsMap>(key: K, ex: Executor = db): Promise<SettingsMap[K]> {
  const [row] = await ex.select().from(settings).where(eq(settings.key, key));
  const value = (row?.value ?? {}) as Partial<SettingsMap[K]>;
  return { ...DEFAULTS[key], ...value };
}

export async function setSetting<K extends keyof SettingsMap>(key: K, value: SettingsMap[K], ex: Executor = db) {
  await ex
    .insert(settings)
    .values({ key, value, updatedAt: new Date() })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } });
}
