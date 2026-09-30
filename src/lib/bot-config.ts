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
};

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
};

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
  };
}

/** Eski kayıtlarda eksik kalan alanları varsayılanlarla tamamlar. */
export function normalizeBotConfig(input: Partial<BotConfig> | null | undefined): BotConfig {
  const d = defaultBotConfig();
  if (!input) return d;
  const modes = { ...d.modes };
  for (const m of MODES) modes[m] = { ...d.modes[m], ...(input.modes?.[m] ?? {}) };
  return { ...d, ...input, modes };
}
