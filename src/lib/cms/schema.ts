import { z } from "zod";

/*
 * Landing sayfasının içerik şeması. Sayfadaki "patla-topla" animasyonu sabit
 * sayıda parçaya göre kurulu: her sahnede 6 çip, 6 ekran hücresi ve 4 başlık
 * katmanı. Bu sayılar şema tarafından zorunlu tutulur; editör alan eklemez veya
 * silmez. (Landing'deki önceki hataların hepsi bu sayıların uyuşmamasındandı.)
 */

const text = (max = 200) => z.string().trim().max(max);

export const captionSchema = z.object({
  eyebrow: text(60),
  title: text(80),
  sub: text(140),
});

export const chipSchema = z.object({
  icon: text(8),
  label: text(30),
  value: text(14),
  unit: text(30),
});

export const slotSchema = z.object({
  label: text(20),
  value: text(12),
  unit: text(20),
});

export const cardSchema = z.object({
  title: text(40),
  text: text(140),
});

export const bubbleSchema = z.object({
  from: z.enum(["ai", "me"]),
  text: text(160),
});

export const sceneSchema = z.object({
  captions: z.array(captionSchema).length(4),
  chips: z.array(chipSchema).length(6),
  screen1: z.object({
    location: text(50),
    temp: text(8),
    condition: text(60),
    slots: z.array(slotSchema).length(6),
  }),
  screen2: z.object({
    header: text(50),
    ringValue: text(6),
    ringLabel: text(16),
    ringPercent: z.number().min(0).max(100),
    title: text(40),
    note: text(120),
    cards: z.array(cardSchema).min(1).max(4),
  }),
  screen3: z.object({
    header: text(40),
    bubbles: z.array(bubbleSchema).min(2).max(6),
  }),
});

export const landingSchema = z.object({
  seo: z.object({
    title: text(70),
    description: text(170),
    ogImage: text(300),
  }),
  nav: z.object({
    ctaLabel: text(20),
  }),
  hero: z.object({
    kicker: text(40),
    title: text(90),
    subtitle: text(220),
    hint: text(30),
  }),
  scenes: z.object({
    core: sceneSchema,
    agro: sceneSchema,
    fly: sceneSchema,
  }),
  phase2: z.object({
    badge: text(30),
    title: text(80),
    text: text(260),
  }),
  assistant: z.object({
    eyebrow: text(40),
    title: text(80),
    text: text(260),
  }),
  premium: z.object({
    title: text(60),
    text: text(220),
    cards: z
      .array(z.object({ icon: text(8), title: text(40), text: text(120) }))
      .length(4),
    ctaLabel: text(40),
  }),
  footer: z.object({
    tagline: text(140),
    copyright: text(100),
  }),
});

export type LandingContent = z.infer<typeof landingSchema>;
export type SceneKey = keyof LandingContent["scenes"];
export type SceneContent = LandingContent["scenes"][SceneKey];

export const SCENE_META: Record<SceneKey, { label: string; accent: string }> = {
  core: { label: "Panel sahnesi", accent: "#0071e3" },
  agro: { label: "Agro sahnesi", accent: "#1a7f47" },
  fly: { label: "Fly sahnesi", accent: "#2b6fb0" },
};

/** Sitenin bugünkü yayındaki içeriği. İlk kurulumda CMS bununla başlar. */
export function defaultLandingContent(): LandingContent {
  return {
    seo: {
      title: "Havamania — Akıllı Hava, Tarım & Uçuş Asistanı",
      description:
        "Havamania, dağınık atmosferik veriyi tek panelde anlama dönüştürür. Seyahat planlayıcı, Agro Modu, Fly Modu ve size kendi dilinizden konuşan bir asistan.",
      ogImage: "",
    },
    nav: { ctaLabel: "Premium" },
    hero: {
      kicker: "Havamania",
      title: "Dağınık veri, tek dokunuşta anlam kazanır.",
      subtitle:
        "Hava durumunu akıllıca takip et, seyahatlerini akıllıca planla. Kaydırmaya başla — parçaların nasıl birleştiğini gör.",
      hint: "↓ kaydır",
    },
    scenes: {
      core: {
        captions: [
          { eyebrow: "Gelişmiş Atmosferik Panel", title: "Dağınık ham veri.", sub: "Onlarca metrik, her yerde." },
          { eyebrow: "Birleşme", title: "Tek panelde toplanır.", sub: "Her parça yerini bulur, ekranda yanar." },
          { eyebrow: "Seyahat Planlayıcı", title: "Veriden konfora.", sub: "%87 konfor skoru otomatik hesaplanır." },
          { eyebrow: "Havamania Asistan", title: "Ve seninle konuşur.", sub: "Sizin dilinizden bir meteorolog." },
        ],
        chips: [
          { icon: "🌡️", label: "Hissedilen", value: "31°", unit: "rüzgâr dahil" },
          { icon: "☀️", label: "UV İndeksi", value: "7", unit: "çok yüksek" },
          { icon: "💨", label: "Rüzgâr", value: "17", unit: "km/sa" },
          { icon: "💧", label: "Nem", value: "%52", unit: "bağıl" },
          { icon: "👁️", label: "Görüş", value: "40", unit: "km" },
          { icon: "📊", label: "Basınç", value: "994", unit: "hPa" },
        ],
        screen1: {
          location: "BALIKESİR · Az Bulutlu",
          temp: "29°",
          condition: "Hissedilen 31°",
          slots: [
            { label: "Hissedilen", value: "31°", unit: "rüzgâr dahil" },
            { label: "UV", value: "7", unit: "çok yüksek" },
            { label: "Rüzgâr", value: "17", unit: "km/sa" },
            { label: "Nem", value: "%52", unit: "bağıl" },
            { label: "Görüş", value: "40", unit: "km" },
            { label: "Basınç", value: "994", unit: "hPa" },
          ],
        },
        screen2: {
          header: "SEYAHAT · İzmir",
          ringValue: "%87",
          ringLabel: "Konfor",
          ringPercent: 87,
          title: "30 Haz – 10 Tem",
          note: "“Pırıl pırıl gökyüzü... powerbank'i unutma.”",
          cards: [
            { title: "🧳 Valiz", text: "Pamuklu kıyafet, güneş gözlüğü, krem." },
            { title: "📍 Yerel", text: "Kordon'da gün batımı yürüyüşü." },
          ],
        },
        screen3: {
          header: "HAVAMANIA ASİSTAN",
          bubbles: [
            { from: "ai", text: "Bugün Balıkesir az bulutlu, 29°. UV yüksek ☀️" },
            { from: "me", text: "Dışarı çıksam olur mu?" },
            { from: "ai", text: "Olur! İnce pamuklu giy, kremi unutma. 16:00 sonrası UV düşüyor." },
            { from: "me", text: "Akşam yağmur var mı?" },
            { from: "ai", text: "Yok, olasılık %0. Gökyüzü açık kalıyor 🌙" },
          ],
        },
      },
      agro: {
        captions: [
          { eyebrow: "Faz 2 · Agro Modu", title: "Tarlanın ham verisi.", sub: "Toprak, rüzgâr, don riski — dağınık." },
          { eyebrow: "Birleşme", title: "Tarımsal karara dönüşür.", sub: "Her metrik ürününe göre anlam kazanır." },
          { eyebrow: "Zamanlama", title: "Doğru gün, doğru saat.", sub: "İlaçlama ve hasat penceresi hazır." },
          { eyebrow: "Agro Asistan", title: "Ve tarlanla konuşur.", sub: "Ürününü bilen bir tarım danışmanı." },
        ],
        chips: [
          { icon: "❄️", label: "Don Riski", value: "Düşük", unit: "min 4°C" },
          { icon: "🌱", label: "Toprak Nemi", value: "%38", unit: "kök bölgesi" },
          { icon: "💧", label: "Buharlaşma", value: "3.2", unit: "mm · ETo" },
          { icon: "🌧️", label: "Yağış 48s", value: "%65", unit: "sulamayı ertele" },
          { icon: "🧴", label: "İlaçlama", value: "06–09", unit: "rüzgâr <8" },
          { icon: "🌾", label: "Hasat Skoru", value: "7/10", unit: "Perşembe" },
        ],
        screen1: {
          location: "TARLA · Buğday · Konya Ovası",
          temp: "14°",
          condition: "Toprak nemi %38 · Don: Düşük",
          slots: [
            { label: "Don", value: "Düşük", unit: "min 4°" },
            { label: "Toprak", value: "%38", unit: "nem" },
            { label: "ETo", value: "3.2", unit: "mm" },
            { label: "Yağış", value: "%65", unit: "48s" },
            { label: "İlaçlama", value: "06–09", unit: "saat" },
            { label: "Hasat", value: "7/10", unit: "skor" },
          ],
        },
        screen2: {
          header: "AGRO · Takvim",
          ringValue: "",
          ringLabel: "",
          ringPercent: 0,
          title: "Bu Haftanın Planı",
          note: "",
          cards: [
            { title: "🧴 Salı 06:00", text: "İlaçlama için ideal: rüzgâr 6 km/sa, yağış yok." },
            { title: "🚿 Çarşamba", text: "Yağış bekleniyor — sulamayı ertele." },
            { title: "🌾 Perşembe", text: "Hasat için en düşük riskli gün (7/10)." },
            { title: "❄️ Cuma gece", text: "Sıcaklık 4°'ye iner — don koruması öneririz." },
          ],
        },
        screen3: {
          header: "AGRO ASİSTAN",
          bubbles: [
            { from: "ai", text: "Bu hafta buğday için ilaçlama penceresi Salı sabahı 🌱" },
            { from: "me", text: "Çarşamba sulasam?" },
            { from: "ai", text: "Gerek yok — %65 yağış var. Su ve gübreden tasarruf edersin." },
            { from: "me", text: "Don riski?" },
            { from: "ai", text: "Cuma gecesi 4°. Hassas parseller için örtü öneririm ❄️" },
          ],
        },
      },
      fly: {
        captions: [
          { eyebrow: "Faz 2 · Fly Modu", title: "Gökyüzünün ham verisi.", sub: "Rüzgâr, türbülans, buzlanma — dağınık." },
          { eyebrow: "Birleşme", title: "Uçuş radarına dönüşür.", sub: "Rota boyunca seviye seviye analiz." },
          { eyebrow: "Konfor", title: "En pürüzsüz irtifa.", sub: "Jet akımına göre rota önerisi." },
          { eyebrow: "Fly Asistan", title: "Ve rotanı anlatır.", sub: "Kokpit verisi, sade bir dille." },
        ],
        chips: [
          { icon: "🌀", label: "Türbülans", value: "Orta", unit: "FL300–360" },
          { icon: "🧭", label: "Rüzgâr", value: "120", unit: "kt · baş" },
          { icon: "✈️", label: "Jet Akımı", value: "Aktif", unit: "FL340" },
          { icon: "❄️", label: "Buzlanma", value: "Düşük", unit: "tırmanış" },
          { icon: "👁️", label: "Görüş", value: "10", unit: "km" },
          { icon: "☁️", label: "Bulut Tabanı", value: "4000", unit: "ft" },
        ],
        screen1: {
          location: "UÇUŞ · IST → ESB · FL350",
          temp: "−54°",
          condition: "Türbülans: Orta · Jet aktif",
          slots: [
            { label: "Türbülans", value: "Orta", unit: "FL300+" },
            { label: "Rüzgâr", value: "120", unit: "kt" },
            { label: "Jet", value: "Aktif", unit: "FL340" },
            { label: "Buzlanma", value: "Düşük", unit: "-" },
            { label: "Görüş", value: "10", unit: "km" },
            { label: "Taban", value: "4000", unit: "ft" },
          ],
        },
        screen2: {
          header: "FLY · Rota Radarı",
          ringValue: "",
          ringLabel: "",
          ringPercent: 0,
          title: "IST → ESB",
          note: "Tahmini süre 1s 05dk · 3 türbülans bölgesi",
          cards: [
            { title: "🟢 Kalkış–FL200", text: "Sakin. Hafif rüzgâr, sorunsuz tırmanış." },
            { title: "🟡 FL300–360", text: "Orta türbülans. Kemer uyarısı önerilir." },
            { title: "🟢 İniş fazı", text: "Görüş 10 km, bulut tabanı 4000 ft." },
          ],
        },
        screen3: {
          header: "FLY ASİSTAN",
          bubbles: [
            { from: "ai", text: "IST → ESB rotanda orta türbülans var: FL300–360 🌀" },
            { from: "me", text: "Daha rahat irtifa var mı?" },
            { from: "ai", text: "FL380'de jet akımı zayıflıyor, rüzgâr 70 kt'a düşüyor. Daha pürüzsüz." },
            { from: "me", text: "Buzlanma?" },
            { from: "ai", text: "Risk düşük, sadece tırmanışta hafif. Endişe yok ✈️" },
          ],
        },
      },
    },
    phase2: {
      badge: "Faz 2 · Yolda",
      title: "Aynı zekâ, iki yeni dünya.",
      text: "Havamania'nın motoru şimdi tarlanın ve gökyüzünün diline çevriliyor: Agro Modu ve Fly Modu. Aynı patla-topla, yeni veriler.",
    },
    assistant: {
      eyebrow: "Havamania Asistan",
      title: "Her modda, sizin dilinizden.",
      text: "İster tarla ister uçuş — asistan tonunu siz seçersiniz: Samimi, Resmî, Dengeli (önerilen), Kısa ve Net ya da Detaylı Uzman.",
    },
    premium: {
      title: "Sınırları kaldırın.",
      text: "Standart tahminlerin ötesine geçin — %100 kişiselleştirilmiş bir hava, tarım ve uçuş deneyimi.",
      cards: [
        { icon: "📈", title: "Gelişmiş Analizler", text: "Hava, tarla ve uçuş için özelleştirilmiş raporlar." },
        { icon: "👤", title: "Tam AI Kişiselleştirme", text: "Tüm iletişim tonları ve sınırsız ilgi alanı." },
        { icon: "🗂️", title: "Arşiv Özellikleri", text: "Benzersiz seyahat ve sezon hafızası." },
        { icon: "🎨", title: "Özel Temalar", text: "Ruh haline ve mevsime göre deneyim." },
      ],
      ctaLabel: "Premium Deneyime Geçiş Yapın",
    },
    footer: {
      tagline: "Bu bir tahmin ekranı değil, günün tadını çıkarma stratejisidir.",
      copyright: "© 2025 Altıkod Digital Solutions · Havamania",
    },
  };
}
