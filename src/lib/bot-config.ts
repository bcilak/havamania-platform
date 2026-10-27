import type { ChatMode } from "@/db/schema";

export const MODES: ChatMode[] = ["genel", "agro", "fly"];

export const MODE_META: Record<ChatMode, { label: string; color: string }> = {
  genel: { label: "Genel", color: "#0071e3" },
  agro: { label: "Agro", color: "#1a7f47" },
  fly: { label: "Fly", color: "#2b6fb0" },
};

export type ToneId = "samimi" | "resmi" | "dengeli" | "kisa" | "uzman";

export const TONES: Record<ToneId, { label: string; rule: string }> = {
  samimi: {
    label: "Samimi",
    rule: "Sıcak ve arkadaşça konuş, kullanıcıya 'sen' diye hitap et. Uygun yerlerde tek bir emoji kullanabilirsin.",
  },
  resmi: {
    label: "Resmî",
    rule: "Kullanıcıya 'siz' diye hitap et. Kurumsal ve saygılı bir dil kullan, emoji kullanma.",
  },
  dengeli: {
    label: "Dengeli (önerilen)",
    rule: "Kullanıcıya 'sen' diye hitap et. Net ve yardımsever ol; ne fazla resmî ne fazla laubali.",
  },
  kisa: {
    label: "Kısa ve Net",
    rule: "En fazla iki üç cümleyle cevap ver. Önce sonucu söyle, gereksiz açıklama yapma.",
  },
  uzman: {
    label: "Detaylı Uzman",
    rule: "Teknik terimleri kullan ve kısaca açıkla. Sayısal değerleri birimleriyle ver ve önerilerini gerekçelendir.",
  },
};

/** Kişilik alanlarının sınırları; form (strStrict), normalize ve prompt aynı değerleri kullanır. */
export const PERSONA_LIMITS = {
  maxOutputTokens: { min: 100, max: 4000 },
  examples: { count: 5, chars: 1500 },
  blockedTopics: { count: 20, chars: 80 },
  toneRule: 500,
} as const;

/** Mod bazlı varsayılan azami çıktı token'ı. */
export const DEFAULT_MAX_OUTPUT: Record<ChatMode, number> = { genel: 700, agro: 800, fly: 900 };

export type ToolId = "current_weather" | "forecast" | "agro_conditions" | "flight_weather";

export const TOOLS: Record<ToolId, { label: string; description: string }> = {
  current_weather: { label: "Anlık hava durumu", description: "Konumdaki sıcaklık, hissedilen, nem, rüzgâr, UV, görüş, basınç." },
  forecast: { label: "Tahmin (saatlik ve günlük)", description: "Önümüzdeki günler için yağış olasılığı ve sıcaklık." },
  agro_conditions: { label: "Tarım koşulları", description: "Don riski, toprak nemi, buharlaşma, ilaçlama ve hasat pencereleri." },
  flight_weather: { label: "Uçuş hava durumu", description: "Rota üzerindeki türbülans, rüzgâr, jet akımı, buzlanma, bulut tabanı." },
};

/**
 * Bu uyarılar bilerek talimat metnine değil koda gömülüdür: panelden silinemez
 * ve modelin "unutması" mümkün değildir. Widget her ilgili cevabın altında gösterir.
 */
export const MODE_DISCLAIMERS: Partial<Record<ChatMode, string>> = {
  fly: "Bu bilgiler uçuş planlaması için resmî METAR, TAF, SIGMET ve NOTAM kaynaklarının yerini tutmaz.",
  agro: "İlaçlama önerileri genel bilgidir. Ürün etiketindeki doz ve bekleme sürelerine uyun.",
};

export type ModeConfig = {
  enabled: boolean;
  label: string;
  instructions: string;
  tone: ToneId;
  providerId: string | null;
  model: string | null;
  temperature: number;
  tools: ToolId[];
  greeting: string;
  suggestions: string[];
  /**
   * Cevabın azami uzunluğu (token). Taslakta ve yeni yayında her zaman dolu; bu alan eklenmeden
   * yayınlanmış eski sürümlerde tanımsızdır (dondurulmuş sürüm: sınır yok). Muhakeme modellerinde
   * gönderilen sınıra düşünme payı eklenir (bkz. `effectiveMaxOutputTokens`).
   */
  maxOutputTokens?: number;
  /** Örnek konuşmalar (few-shot); prompta veri olarak girer, geçmişe eklenmez. */
  examples: ExampleChat[];
};

export type ExampleChat = { user: string; assistant: string };

export type BotConfig = {
  modes: Record<ChatMode, ModeConfig>;
  /** Tüm modlar için geçerli kurallar. */
  guardrails: string;
  fallbackMessage: string;
  /** Modele gönderilen son mesaj sayısı. */
  historyWindow: number;
  maxMessagesPerDay: number;
  photosEnabled: boolean;
  maxPhotoMb: number;
  retrievalTopK: number;
  /** Kosinüs benzerliği bu değerin altındaki parçalar, kelime eşleşmesi yoksa bağlama girmez. */
  retrievalMinSimilarity: number;
  /** Bağlama aynı kaynaktan en fazla bu kadar parça girer (komşu parçalar birleştirilir, aynı metinler teke iner). */
  retrievalPerSourceMax: number;
  /** Alanda her yerde geçtiği için aramada ayırt edici olmayan kelimeler. */
  domainStopwords: string[];
  /** Asistanın yardım etmeyeceği konular (genel kurallara madde olarak eklenir). */
  blockedTopics: string[];
  /** Panelden düzenlenen ton metinleri; olmayan ton varsayılanı (TONES) kullanır. */
  toneOverrides: Partial<Record<ToneId, string>>;
};

/** Tonun etkin kuralı: varsa düzenlenmiş metin, yoksa varsayılan. */
export function toneRule(toneOverrides: BotConfig["toneOverrides"] | undefined, tone: ToneId): string {
  const t = Object.hasOwn(TONES, tone) ? tone : "dengeli";
  return toneOverrides?.[t]?.trim() || TONES[t].rule;
}

export function defaultBotConfig(): BotConfig {
  return {
    modes: {
      genel: {
        enabled: true,
        label: "Havamania Asistan",
        instructions:
          "Sen Havamania'nın hava durumu asistanısın. Kullanıcının konumundaki hava durumunu yorumlar, günlük planlarına ve seyahatlerine göre öneri verirsin: ne giymeli, şemsiye gerekir mi, güneş kremi, dışarıda vakit geçirmek için en uygun saatler. Tahminleri uydurma; güncel veri için araçları kullan, araç yoksa bunu açıkça söyle.",
        tone: "dengeli",
        providerId: null,
        model: null,
        temperature: 0.4,
        maxOutputTokens: DEFAULT_MAX_OUTPUT.genel,
        examples: [],
        tools: ["current_weather", "forecast"],
        greeting: "Merhaba! Bugünün havasını ya da bir seyahat planını birlikte değerlendirelim mi?",
        suggestions: ["Bugün şemsiye gerekir mi?", "Hafta sonu piknik için hangi gün uygun?", "Ne giymeliyim?"],
      },
      agro: {
        enabled: true,
        label: "Agro Asistan",
        instructions:
          "Sen Havamania'nın tarım asistanısın. Çiftçilere hava verisini tarımsal karara çevirirsin: sulama zamanı, ilaçlama penceresi (rüzgâr 8 km/sa altı, yağış yok), don riski ve hasat için en uygun gün. Kullanıcının ürününü ve bölgesini sor, bilmediğin konuda tahmin yürütme. Fotoğraf gönderilirse gördüğünü tarif et ama kesin hastalık teşhisi koyma; bir ziraat mühendisine danışmasını öner.",
        tone: "samimi",
        providerId: null,
        model: null,
        temperature: 0.3,
        maxOutputTokens: DEFAULT_MAX_OUTPUT.agro,
        examples: [],
        tools: ["current_weather", "forecast", "agro_conditions"],
        greeting: "Merhaba! Hangi ürün ve bölge için bakalım?",
        suggestions: ["Bu hafta ilaçlama için en iyi gün?", "Yarın sulama yapmalı mıyım?", "Don riski var mı?"],
      },
      fly: {
        enabled: true,
        label: "Fly Asistan",
        instructions:
          "Sen Havamania'nın uçuş hava durumu asistanısın. Pilotlara ve uçuş meraklılarına rota üzerindeki türbülans, rüzgâr, jet akımı, buzlanma ve bulut tabanını sade bir dille anlatırsın. Seviyeleri FL, rüzgârı knot, mesafeyi km cinsinden ver. Asla resmî brifing yerine geçtiğini ima etme ve kesin 'uçulabilir' kararı verme.",
        tone: "uzman",
        providerId: null,
        model: null,
        temperature: 0.2,
        maxOutputTokens: DEFAULT_MAX_OUTPUT.fly,
        examples: [],
        tools: ["current_weather", "flight_weather"],
        greeting: "Rotanı ve planladığın seviyeyi yazarsan özetleyeyim.",
        suggestions: ["IST → ESB rotasında türbülans var mı?", "FL350'de rüzgâr nasıl?", "Buzlanma riski?"],
      },
    },
    guardrails:
      "Yalnızca hava durumu, tarım ve uçuş hava durumu konularında yardımcı ol; başka konularda kibarca konuya dön. Tıbbi, hukuki veya finansal tavsiye verme. Kişisel veri isteme. Emin olmadığın bilgiyi uydurma. Her zaman Türkçe cevap ver, kullanıcı başka dilde yazarsa onun dilinde cevap ver.",
    fallbackMessage: "Şu anda cevap veremiyorum. Lütfen biraz sonra tekrar deneyin.",
    historyWindow: 12,
    maxMessagesPerDay: 60,
    photosEnabled: true,
    maxPhotoMb: 8,
    retrievalTopK: 6,
    retrievalMinSimilarity: 0.3,
    retrievalPerSourceMax: 3,
    domainStopwords: ["hava", "durumu", "durum", "nasıl", "olacak"],
    blockedTopics: [],
    toneOverrides: {},
  };
}

export function clampMaxOutputTokens(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? Math.round(value) : Number.NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(PERSONA_LIMITS.maxOutputTokens.max, Math.max(PERSONA_LIMITS.maxOutputTokens.min, n));
}

function cleanExamples(value: unknown): ExampleChat[] {
  if (!Array.isArray(value)) return [];
  const max = PERSONA_LIMITS.examples.chars;
  return value
    .filter((e): e is ExampleChat => !!e && typeof e.user === "string" && typeof e.assistant === "string")
    .map((e) => ({ user: e.user.trim().slice(0, max), assistant: e.assistant.trim().slice(0, max) }))
    .filter((e) => e.user && e.assistant)
    .slice(0, PERSONA_LIMITS.examples.count);
}

function cleanTopics(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const topics = value.filter((t): t is string => typeof t === "string").map((t) => t.trim().slice(0, PERSONA_LIMITS.blockedTopics.chars)).filter(Boolean);
  return [...new Set(topics)].slice(0, PERSONA_LIMITS.blockedTopics.count);
}

function cleanToneOverrides(value: unknown): BotConfig["toneOverrides"] {
  const out: BotConfig["toneOverrides"] = {};
  if (!value || typeof value !== "object") return out;
  for (const t of Object.keys(TONES) as ToneId[]) {
    const v = (value as Record<string, unknown>)[t];
    if (typeof v === "string" && v.trim()) out[t] = v.trim().slice(0, PERSONA_LIMITS.toneRule);
  }
  return out;
}

/**
 * Eski kayıtlarda eksik kalan alanları varsayılanlarla tamamlar.
 * `frozen: true` (yayınlanmış sürümler): sürüm yayınlandığı gibi kalır; sonradan eklenen
 * `maxOutputTokens` eski sürümde tanımsız kalır (varsayılan uygulanmaz, sınır yok).
 * Taslak ve yeni yayın varsayılanlarla tamamlanır.
 */
export function normalizeBotConfig(input: Partial<BotConfig> | null | undefined, opts: { frozen?: boolean } = {}): BotConfig {
  const d = defaultBotConfig();
  if (!input) return d;
  const modes = { ...d.modes };
  for (const m of MODES) {
    const merged = { ...d.modes[m], ...(input.modes?.[m] ?? {}) };
    const stored = input.modes?.[m]?.maxOutputTokens;
    const hasStored = typeof stored === "number" && Number.isFinite(stored);
    modes[m] = {
      ...merged,
      maxOutputTokens: opts.frozen && !hasStored ? undefined : clampMaxOutputTokens(merged.maxOutputTokens, DEFAULT_MAX_OUTPUT[m]),
      examples: cleanExamples(merged.examples),
    };
  }
  const merged = { ...d, ...input, modes };
  // null/boş/geçersiz → varsayılan (Number(null) 0 olurdu ve 1'e sıkıştırılırdı).
  const perSource = merged.retrievalPerSourceMax == null || (merged.retrievalPerSourceMax as unknown) === "" ? Number.NaN : Number(merged.retrievalPerSourceMax);
  return {
    ...merged,
    retrievalPerSourceMax: Number.isFinite(perSource) ? Math.min(10, Math.max(1, Math.round(perSource))) : d.retrievalPerSourceMax,
    blockedTopics: cleanTopics(merged.blockedTopics), toneOverrides: cleanToneOverrides(merged.toneOverrides) };
}
