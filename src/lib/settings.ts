import { eq } from "drizzle-orm";
import { db } from "@/db";
import { settings } from "@/db/schema";
import type { ToolId } from "./bot-config";
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
  kvkk: {
    retentionDays: 180,
    consentVersion: 1,
    consentText:
      "Havamania Asistan ile yaptığınız yazışmalar ve gönderdiğiniz fotoğraflar, size cevap verebilmek ve hizmeti iyileştirmek amacıyla Altıkod Digital Solutions tarafından işlenir ve en fazla 180 gün saklanır. Cevap üretmek için mesajlarınız yurt dışında bulunan yapay zekâ hizmet sağlayıcılarına aktarılabilir. Devam ederek bu işlemeye açık rıza vermiş olursunuz.",
    lastCleanupAt: null,
  },
  legal: LEGAL_DEFAULTS,
};

export async function getSetting<K extends keyof SettingsMap>(key: K): Promise<SettingsMap[K]> {
  const [row] = await db.select().from(settings).where(eq(settings.key, key));
  const value = (row?.value ?? {}) as Partial<SettingsMap[K]>;
  return { ...DEFAULTS[key], ...value };
}

export async function setSetting<K extends keyof SettingsMap>(key: K, value: SettingsMap[K]) {
  await db
    .insert(settings)
    .values({ key, value, updatedAt: new Date() })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } });
}
