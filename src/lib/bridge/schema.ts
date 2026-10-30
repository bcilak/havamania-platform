import { z } from "zod";
import type { ClientContext, WeatherData } from "@/lib/ai/prompt";

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
  /** `weather_data` metin alanları (condition, location.name, source). */
  weatherText: 100,
  forecastDays: 10,
  /** `weather_data` için ayrı bayt bütçesi (null'lar hariç JSON); `contextBytes` bunu saymaz. */
  weatherDataBytes: 4096,
  /** Model bütçesi; kayıtla birlikte yanıt 45 sn içinde dönsün diye varsayılan 43 sn. */
  timeoutMs: envInt("BRIDGE_TIMEOUT_MS", 43_000),
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 1-128 karakter, hiçbir denetim/biçim karakteri yok (`\p{C}`: satır sonu, sıfır genişlikli, vb.); kırpılmaz. */
const userId = z.string().regex(/^[^\p{C}]{1,128}$/u);
const uuid = z.string().regex(UUID_RE);

/** Geçerli bir takvim günü mü (ör. 2026-02-30 değil)? `Date.parse` taşan günleri sessizce kaydırdığı için ayrıca denetlenir. */
function isRealDate(y: number, m: number, d: number): boolean {
  const dt = new Date(0);
  dt.setUTCFullYear(y, m - 1, d);
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const isDate = (s: string) => {
  const m = DATE_RE.exec(s);
  return !!m && isRealDate(+m[1], +m[2], +m[3]);
};
const DAY_MS = 86_400_000;
/** Geçerli YYYY-MM-DD için UTC gün numarası (ardışıklık kontrolü); geçersizse null. `Date.UTC` 0-99 yıllarını kaydırdığı için `setUTCFullYear` kullanılır. */
const dayNumber = (s: string): number | null => {
  const m = DATE_RE.exec(s);
  if (!m || !isRealDate(+m[1], +m[2], +m[3])) return null;
  return new Date(0).setUTCFullYear(+m[1], +m[2] - 1, +m[3]) / DAY_MS;
};

// ISO 8601, offset (Z ya da ±HH:MM) zorunlu; saniye ve kesir isteğe bağlı.
const OBSERVED_AT_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(Z|[+-](\d{2}):(\d{2}))$/;
const isObservedAt = (s: string) => {
  const m = OBSERVED_AT_RE.exec(s);
  if (!m) return false;
  const [, y, mo, d, h, mi, sec, , oh, om] = m;
  if (!isRealDate(+y, +mo, +d) || +h > 23 || +mi > 59 || (sec !== undefined && +sec > 59)) return false;
  if (oh !== undefined && (+oh > 23 || +om > 59)) return false;
  return Number.isFinite(Date.parse(s));
};

const TIMEZONE_RE = /^[A-Za-z_]+(?:\/[A-Za-z0-9_+\-]+){0,2}$/;
const isTimezone = (s: string) => {
  if (s.length > 64 || !TIMEZONE_RE.test(s)) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: s });
    return true;
  } catch {
    return false;
  }
};

/** Sayı alanı: sonlu, aralıklı, null olabilir. Aralık dışı 400 olur. */
const num = (min: number, max: number) => z.number().finite().min(min).max(max).nullish();

// Uzunluk sınırları (413) `checkLimits`te. Koordinatlar (lat/lon) bilerek tanımlı değil: gönderilirse zod sessizce atar
// (veri minimizasyonu, KVKK); köprüde araçlar zaten yalnızca şehir adıyla çalışır.
const weatherDataSchema = z.object({
  observed_at: z.string().refine(isObservedAt),
  timezone: z.string().refine(isTimezone),
  location: z.object({ name: z.string().min(1) }).nullish(),
  current: z
    .object({
      temp_c: num(-90, 60),
      feels_like_c: num(-90, 70),
      condition: z.string().nullish(),
      humidity_pct: num(0, 100),
      wind_kmh: num(0, 500),
      precip_mm: num(0, 2000),
    })
    .nullish(),
  forecast: z
    .array(
      z.object({
        date: z.string().refine(isDate),
        min_c: num(-90, 60),
        max_c: num(-90, 70),
        condition: z.string().nullish(),
        precip_prob_pct: num(0, 100),
      }),
    )
    .superRefine((days, ctx) => {
      if (new Set(days.map((d) => d.date)).size !== days.length) {
        ctx.addIssue({ code: "custom", message: "duplicate date" });
        return;
      }
      // Ardışık günler: sıralandıktan sonra her biri öncekinin ertesi günü olmalı. Aksi hâlde "ilk – son (N gün)" aralığı
      // aradaki boş günleri de kapsıyormuş gibi görünür ve model olmayan güne tahmin uydurur. Gönderim sırası serbesttir
      // (sunucu sıralar). Geçersiz tarihler öğe şemasında zaten raporlanır; burada atlanır.
      const nums = days.map((d) => dayNumber(d.date));
      if (nums.some((n) => n === null)) return;
      const sorted = (nums as number[]).sort((a, b) => a - b);
      if (sorted.some((n, i) => i > 0 && n - sorted[i - 1] !== 1)) ctx.addIssue({ code: "custom", message: "forecast days must be consecutive" });
    })
    .nullish(),
  stale: z.boolean().nullish(),
  source: z.string().nullish(),
});

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
  /** Yineleme koruması kimliği (UUID; küçük harfe çevrilir). */
  request_id: uuid.transform((s) => s.toLowerCase()).nullish(),
  /** false: profil (sağlık dahil) ve seyahat bilgisi modele girmez. Yok/null = true. */
  personalization: z.boolean().nullish(),
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
      weather_data: weatherDataSchema.nullish(),
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
  // `weather_data` bu bütçeye girmez (kendi bütçesi aşağıda); eski istemciler sınırı aynen görür.
  const dropNull = (_k: string, v: unknown) => (v === null ? undefined : v);
  const json = JSON.stringify({ ...ctx, weather_data: undefined }, dropNull);
  if (Buffer.byteLength(json, "utf8") > L.contextBytes) return "too_large";
  const w = ctx.weather_data;
  if (w) {
    if ((w.location?.name.length ?? 0) > L.weatherText) return "too_large";
    if ((w.source?.length ?? 0) > L.weatherText) return "too_large";
    if ((w.current?.condition?.length ?? 0) > L.weatherText) return "too_large";
    if ((w.forecast?.length ?? 0) > L.forecastDays) return "too_large";
    for (const day of w.forecast ?? []) if ((day.condition?.length ?? 0) > L.weatherText) return "too_large";
    if (Buffer.byteLength(JSON.stringify(w, dropNull), "utf8") > L.weatherDataBytes) return "too_large";
  }
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
 * vermeden düşürülür. `opts.personal === false` ise `profile` ve `trips` hiç girmez (varsayılan true).
 * Hiçbiri veritabanına yazılmaz.
 */
export function toClientContext(ctx: AskInput["context"], opts: { health: boolean; personal?: boolean } = { health: false }): ClientContext | undefined {
  if (!ctx) return undefined;
  const personal = opts.personal !== false;
  const p = personal ? ctx.profile : undefined;
  const weatherData = toWeatherData(ctx.weather_data);
  return {
    city: ctx.city ?? undefined,
    weather: ctx.weather ?? undefined,
    trips: personal ? (ctx.trips ?? undefined) : undefined,
    profile: p
      ? {
          interest: p.interest ?? undefined,
          ...(opts.health ? { health_sensitivities: p.health_sensitivities ?? undefined } : {}),
          travel_preferences: p.travel_preferences ?? undefined,
          activity_types: p.activity_types ?? undefined,
        }
      : undefined,
    ...(weatherData ? { weatherData } : {}),
  };
}

/** `weather_data` -> camelCase prompt türü: null'lar atılır, tahmin tarihe göre sıralanır. */
function toWeatherData(w: NonNullable<AskInput["context"]>["weather_data"]): WeatherData | undefined {
  if (!w) return undefined;
  const out: WeatherData = { observedAt: w.observed_at, timezone: w.timezone };
  if (w.location) out.location = { name: w.location.name };
  const c = w.current;
  if (c) {
    const current = {
      ...(c.temp_c != null ? { tempC: c.temp_c } : {}),
      ...(c.feels_like_c != null ? { feelsLikeC: c.feels_like_c } : {}),
      ...(c.condition != null ? { condition: c.condition } : {}),
      ...(c.humidity_pct != null ? { humidityPct: c.humidity_pct } : {}),
      ...(c.wind_kmh != null ? { windKmh: c.wind_kmh } : {}),
      ...(c.precip_mm != null ? { precipMm: c.precip_mm } : {}),
    };
    if (Object.keys(current).length) out.current = current;
  }
  if (w.forecast?.length) {
    out.forecast = w.forecast
      .map((d) => ({
        date: d.date,
        ...(d.min_c != null ? { minC: d.min_c } : {}),
        ...(d.max_c != null ? { maxC: d.max_c } : {}),
        ...(d.condition != null ? { condition: d.condition } : {}),
        ...(d.precip_prob_pct != null ? { precipProbPct: d.precip_prob_pct } : {}),
      }))
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  }
  if (w.stale != null) out.stale = w.stale;
  if (w.source != null) out.source = w.source;
  return out;
}
