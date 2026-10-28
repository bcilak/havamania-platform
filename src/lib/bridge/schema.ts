import { z } from "zod";
import type { ClientContext } from "@/lib/ai/prompt";

/*
 * Köprü istek şemaları. Tür ve enum hataları 400, uzunluk aşımları 413 olur. Bu ayrımı zod'un
 * hata türünden tahmin etmek yerine iki aşama yapar: önce uzunluk içermeyen yapı şeması
 * (`safeParse`), sonra ayrı bir `checkLimits`. Bilinmeyen alanlar yok sayılır (ileriye dönük uyum).
 */

const envInt = (name: string, fallback: number) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export const BRIDGE_LIMITS = {
  bodyBytes: 32_768,
  question: 4000,
  city: 100,
  weather: 2000,
  trips: 2000,
  profileField: 500,
  contextBytes: 8192,
  userId: 128,
  comment: 1000,
  appVersion: 40,
  /** Model bütçesi; kayıtla birlikte yanıt 45 sn içinde dönsün diye varsayılan 43 sn. */
  timeoutMs: envInt("BRIDGE_TIMEOUT_MS", 43_000),
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 1-128 karakter, hiçbir denetim/biçim karakteri yok (`\p{C}`: satır sonu, sıfır genişlikli, vb.); kırpılmaz. */
const userId = z.string().regex(/^[^\p{C}]{1,128}$/u);
const uuid = z.string().regex(UUID_RE);

export const MODES = ["genel", "agro", "fly"] as const;
export const TONE_IDS = ["samimi", "resmi", "dengeli", "kisa", "uzman"] as const;

export const askSchema = z.object({
  user_id: userId,
  question: z.string().refine((s) => s.trim().length > 0),
  conversation_id: uuid.nullish(),
  mode: z.enum(MODES).default("genel"),
  tone: z.enum(TONE_IDS).nullish(),
  language: z.literal("tr").optional(),
  consent_version: z.int().min(1),
  /** Sağlık verisi için ayrı, isteğe bağlı rıza (KVKK m. 6). true ve güncel `health_consent_version` yoksa sağlık hassasiyetleri modele gitmez. */
  health_consent: z.boolean().nullish(),
  health_consent_version: z.int().min(1).nullish(),
  client: z
    .object({
      platform: z.enum(["android", "ios"]).default("android"),
      app_version: z.string().max(BRIDGE_LIMITS.appVersion).optional(),
    })
    .default({ platform: "android" }),
  // null değer "alan yok" demektir (mobil istemciler boş alanı null gönderebilir).
  context: z
    .object({
      city: z.string().nullish(),
      weather: z.string().nullish(),
      trips: z.string().nullish(),
      profile: z
        .object({
          interest: z.string().nullish(),
          health_sensitivities: z.string().nullish(),
          travel_preferences: z.string().nullish(),
          activity_types: z.string().nullish(),
        })
        .nullish(),
    })
    .nullish(),
});
export type AskInput = z.infer<typeof askSchema>;

export const deleteUserSchema = z.object({ user_id: userId });
export type DeleteUserInput = z.infer<typeof deleteUserSchema>;

export const feedbackSchema = z.object({
  user_id: userId,
  message_id: uuid,
  rating: z.union([z.literal(1), z.literal(-1)]),
  comment: z.string().optional(),
});
export type FeedbackInput = z.infer<typeof feedbackSchema>;

/** `/ask` uzunluk sınırları; aşım `too_large` (413) olur. Metinler kırpılmaz. */
export function checkLimits(input: AskInput): "too_large" | null {
  const L = BRIDGE_LIMITS;
  if (input.question.length > L.question) return "too_large";
  const ctx = input.context;
  if (!ctx) return null;
  if ((ctx.city?.length ?? 0) > L.city) return "too_large";
  if ((ctx.weather?.length ?? 0) > L.weather) return "too_large";
  if ((ctx.trips?.length ?? 0) > L.trips) return "too_large";
  for (const v of Object.values(ctx.profile ?? {})) if ((v?.length ?? 0) > L.profileField) return "too_large";
  // Toplam bayt cinsinden ölçülür (Türkçe karakterler 2 bayttır). null alanlar yok sayılır.
  const json = JSON.stringify(ctx, (_k, v) => (v === null ? undefined : v));
  if (Buffer.byteLength(json, "utf8") > L.contextBytes) return "too_large";
  return null;
}

export function checkFeedbackLimits(input: FeedbackInput): "too_large" | null {
  return (input.comment?.length ?? 0) > BRIDGE_LIMITS.comment ? "too_large" : null;
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; code: "invalid_request" | "too_large"; field?: string };

function parseWith<T>(schema: z.ZodType<T>, raw: unknown, limits?: (v: T) => "too_large" | null): ParseResult<T> {
  const r = schema.safeParse(raw);
  if (!r.success) {
    const path = r.error.issues[0]?.path.map(String).join(".");
    return { ok: false, code: "invalid_request", ...(path ? { field: path } : {}) };
  }
  const over = limits?.(r.data);
  return over ? { ok: false, code: over } : { ok: true, value: r.data };
}

export const parseAsk = (raw: unknown) => parseWith(askSchema, raw, checkLimits);
export const parseDeleteUser = (raw: unknown) => parseWith(deleteUserSchema, raw);
export const parseFeedback = (raw: unknown) => parseWith(feedbackSchema, raw, checkFeedbackLimits);

/**
 * Şema çıktısından prompt bağlamı (null alanlar yok sayılır). `health_sensitivities` (özel nitelikli veri)
 * yalnızca `opts.health` true ise (geçerli ayrı sağlık rızası, bkz. `healthConsentGiven`) girer; aksi hâlde hata
 * vermeden düşürülür. Hiçbiri veritabanına yazılmaz.
 */
export function toClientContext(ctx: AskInput["context"], opts: { health: boolean } = { health: false }): ClientContext | undefined {
  if (!ctx) return undefined;
  const p = ctx.profile;
  return {
    city: ctx.city ?? undefined,
    weather: ctx.weather ?? undefined,
    trips: ctx.trips ?? undefined,
    profile: p
      ? {
          interest: p.interest ?? undefined,
          ...(opts.health ? { health_sensitivities: p.health_sensitivities ?? undefined } : {}),
          travel_preferences: p.travel_preferences ?? undefined,
          activity_types: p.activity_types ?? undefined,
        }
      : undefined,
  };
}
