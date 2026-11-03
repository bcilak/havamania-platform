import { z } from "zod";

/*
 * Landing sayfasının içerik şeması. Sayfadaki "patla-topla" animasyonu (core sahnesi)
 * sabit sayıda parçaya göre kurulu: 6 çip, 6 ekran hücresi ve 4 başlık katmanı. Bu
 * sayılar şema tarafından zorunlu tutulur; editör alan eklemez veya silmez.
 * (Landing'deki önceki hataların hepsi bu sayıların uyuşmamasındandı.)
 * Statik bölümlerin (route, features, energy, aviation, roadmap, earlyAccess) dizileri
 * sabit üst sınırlıdır; boş satırlar kaydedilirken atılır.
 */

const text = (max = 200) => z.string().trim().max(max);

export const captionSchema = z.object({
  eyebrow: text(60),
  title: text(80),
  sub: text(140),
});

export const chipSchema = z.object({
  /** Simge adı (icons.ts) ya da eski içerikten kalan emoji. */
  icon: text(24),
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

/** Paylaşım görseli: boş (varsayılan /og.png), site içi göreli yol ("//" ve "/\" hariç) ya da https:// adresi. */
const ogImage = text(300).refine((v) => {
  if (v === "") return true;
  if (v.startsWith("/")) return !v.startsWith("//") && !v.startsWith("/\\");
  try {
    return new URL(v).protocol === "https:" && v.toLowerCase().startsWith("https://");
  } catch {
    return false;
  }
});

/** Boş satırlar action'da atılır; en az 1, en çok `n` madde. */
const list = (max: number, n: number) => z.array(text(max)).min(1).max(n);

const energyCard = z.object({
  icon: text(24),
  title: text(40),
  text: text(160),
  data: list(60, 6),
  uses: list(60, 6),
  benefits: list(80, 6),
});

export const landingSchema = z.object({
  seo: z.object({
    title: text(70),
    description: text(170),
    ogImage,
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
  }),
  route: z.object({
    eyebrow: text(40),
    title: text(80),
    text: text(260),
    bullets: list(100, 4),
    sample: z.object({
      label: text(20),
      from: text(30),
      to: text(30),
      stops: z.array(z.object({ city: text(30), temp: text(8) })).length(4),
      alert: text(120),
    }),
  }),
  features: z.object({
    badge: text(30),
    title: text(80),
    text: text(220),
    // 1–12: bugünkü varsayılan 9 kart. Mobil ekip onayladıkça CMS'ten üç yeni kart daha eklenebilir.
    items: z.array(z.object({ icon: text(24), title: text(40), text: text(120) })).min(1).max(12),
  }),
  agroCard: z.object({ icon: text(24), title: text(60), text: text(220) }),
  energy: z.object({
    badge: text(30),
    title: text(80),
    text: text(260),
    ctaLabel: text(40),
    solar: energyCard,
    wind: energyCard,
  }),
  aviation: z.object({
    badge: text(30),
    title: text(80),
    text: text(260),
    analyses: z.array(z.object({ icon: text(24), title: text(40), text: text(120) })).min(1).max(6),
    uses: list(60, 6),
    note: text(200),
    ctaLabel: text(40),
  }),
  roadmap: z.object({
    eyebrow: text(40),
    title: text(80),
    text: text(220),
    phases: z
      .array(
        z.object({
          label: text(20),
          name: text(40),
          state: z.enum(["live", "soon", "planned", "vision"]),
          stateLabel: text(20),
          text: text(200),
        }),
      )
      .length(4),
  }),
  earlyAccess: z.object({
    eyebrow: text(40),
    title: text(80),
    text: text(260),
    moduleLabels: z.object({ solar: text(40), wind: text(40), fly: text(40) }),
    privacyNote: text(400),
    consentLabel: text(200),
    submitLabel: text(30),
    successText: text(200),
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
      .array(z.object({ icon: text(24), title: text(40), text: text(120) }))
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
};

export type RoadmapState = LandingContent["roadmap"]["phases"][number]["state"];

/** Sitenin bugünkü yayındaki içeriği. İlk kurulumda CMS bununla başlar. */
export function defaultLandingContent(): LandingContent {
  return {
    seo: {
      title: "Havamania — Akıllı Hava ve Seyahat Asistanı",
      description:
        "Havamania hava verisini anlamlı bilgiye çevirir: güzergâh boyunca hava, seyahat planlayıcı ve kendi dilinizden konuşan bir asistan. Enerji ve havacılık yolda.",
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
          { icon: "thermometer", label: "Hissedilen", value: "31°", unit: "rüzgâr dahil" },
          { icon: "sun", label: "UV İndeksi", value: "7", unit: "çok yüksek" },
          { icon: "wind", label: "Rüzgâr", value: "17", unit: "km/sa" },
          { icon: "droplets", label: "Nem", value: "%52", unit: "bağıl" },
          { icon: "eye", label: "Görüş", value: "40", unit: "km" },
          { icon: "gauge", label: "Basınç", value: "994", unit: "hPa" },
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
    },
    route: {
      eyebrow: "Akıllı Güzergâh Takibi",
      title: "Sadece varış noktası değil, tüm yolculuk.",
      text: "Rotanızı haritada görün, yol üstündeki şehirlerin hava tahminini tek ekranda izleyin. Yağış, fırtına ya da kuvvetli rüzgâr beklenen noktaları yola çıkmadan fark edin.",
      bullets: [
        "Rota haritada, duraklar sırayla",
        "Güzergâhtaki şehirlerin hava tahmini",
        "Yağış, fırtına ve kuvvetli rüzgâr işaretleri",
        "Yolculuk öncesinde tahmin değişirse bildirim",
      ],
      // Rakamlar örnektir; kartın üstündeki "Örnek ekran" etiketi bunu açıkça söyler.
      sample: {
        label: "Örnek ekran",
        from: "İstanbul",
        to: "Antalya",
        stops: [
          { city: "Bursa", temp: "28°" },
          { city: "Eskişehir", temp: "26°" },
          { city: "Afyonkarahisar", temp: "24°" },
          { city: "Antalya", temp: "31°" },
        ],
        alert: "Antalya güzergâhınızda kuvvetli yağış bekleniyor.",
      },
    },
    features: {
      badge: "Faz 1 · Yayında",
      title: "Seyahat için gereken her şey, tek uygulamada.",
      text: "Havamania Travel bugün Android uygulamasında: hava tahmininden valiz listesine kadar seyahatin her adımında yanınızda.",
      items: [
        { icon: "cloud-sun", title: "Akıllı Hava Tahmini", text: "Saatlik ve günlük tahmin, hissedilen sıcaklık, UV ve rüzgâr tek ekranda." },
        { icon: "sparkles", title: "Yapay Zekâ Asistanı", text: "Hava ve seyahat sorularınıza seçtiğiniz tonda cevap verir." },
        { icon: "calendar", title: "Seyahat Planlayıcı", text: "Tarih ve rotaya göre hava analiziyle planınızı oluşturun." },
        { icon: "luggage", title: "Valiz Asistanı", text: "Gideceğiniz yerin havasına göre yanınıza alacaklarınız için öneriler." },
        { icon: "map-pin", title: "Aktivite Rehberi", text: "Gittiğiniz yerde havaya uygun etkinlik önerileri." },
        { icon: "route", title: "Güzergâh Takibi", text: "Yol üstündeki şehirlerin havası, rota boyunca." },
        { icon: "cloud-lightning", title: "Hava Uyarıları", text: "Yağış, fırtına ve kuvvetli rüzgâr beklenen günler için uyarılar." },
        { icon: "user-round", title: "Profil ve Tercihler", text: "İlgi alanlarınıza ve seyahat tarzınıza göre kişiselleşen öneriler." },
        { icon: "bell", title: "Bildirim Yönetimi", text: "Hangi bildirimi alacağınızı siz seçersiniz." },
      ],
    },
    agroCard: {
      icon: "sprout",
      title: "Tarla ve bahçe için de",
      text: "Asistanın Agro modu; ilaçlama, sulama ve don gibi konulardaki sorularınızda hava verisini yorumlamanıza yardımcı olur.",
    },
    energy: {
      badge: "Faz 2 · Yakında",
      title: "Havamania Energy",
      text: "Güneş ve rüzgâr enerjisi için hava verisine dayalı analizler. Modül geliştirme aşamasında.",
      ctaLabel: "Erken erişim listesine katılın",
      solar: {
        icon: "sun",
        title: "Solar",
        text: "Güneş enerjisi santralleri ve enerji ekipleri için hava verisine dayalı üretim ve planlama desteği.",
        data: ["Güneş radyasyonu", "Bulutluluk", "Sıcaklık", "Rüzgâr", "Atmosferik koşullar"],
        uses: ["GES santralleri", "EPC şirketleri", "Enerji şirketleri", "Enerji verimliliği çalışmaları", "Sigortacılık", "Veri tabanlı enerji yönetimi"],
        benefits: ["Üretim tahmini", "Verimlilik analizi", "Enerji planlaması", "Bakım zamanlaması", "Risk ve sigorta süreçlerinde veri desteği"],
      },
      wind: {
        icon: "wind",
        title: "Wind",
        text: "Rüzgâr enerjisi ve rüzgâra bağlı operasyonlar için saatlik rüzgâr analizi.",
        data: ["Rüzgâr hızı", "Rüzgâr yönü", "Saatlik değişim", "Türbülans yoğunluğu", "Ani rüzgâr artışları"],
        uses: ["RES santralleri", "Enerji firmaları", "Limanlar", "Denizcilik", "Tarım"],
        benefits: ["Üretim planlaması", "Türbin operasyonlarının planlanması", "Operasyon planlaması", "Bakım maliyetlerinin planlanması"],
      },
    },
    aviation: {
      badge: "Faz 3 · Planlanıyor",
      title: "Havamania Fly",
      text: "Havacılık ekipleri için atmosferik analiz katmanı. Modül planlama aşamasında; kapsamı sektörden gelecek geri bildirimlerle şekillenecek.",
      analyses: [
        { icon: "tornado", title: "Atmosferik türbülans", text: "Seviyelere göre türbülans göstergeleri." },
        { icon: "wind", title: "Jet stream", text: "Jet akımının konumu ve şiddeti." },
        { icon: "compass", title: "Rüzgâr kesmesi (wind shear)", text: "Kısa mesafede rüzgâr hızı ve yönündeki değişimler." },
        { icon: "cloud-lightning", title: "Konvektif aktivite (CB)", text: "Kümülonimbus ve oraj gelişimine dair göstergeler." },
        { icon: "gauge", title: "Basınç ve sıcaklık değişimleri", text: "Seviyeler arasındaki değişimlerin izlenmesi." },
        { icon: "archive", title: "Geçmiş türbülans raporları", text: "Analizlere geçmiş raporlarla bağlam." },
      ],
      uses: ["Uçuş rota planlaması", "Yakıt verimliliği çalışmaları", "Yolcu konforu", "Havayolu operasyonları"],
      note: "Planlanan modül, resmî meteoroloji hizmetlerinin ve operasyonel karar süreçlerinin yerini almayı amaçlamaz.",
      ctaLabel: "Erken erişim listesine katılın",
    },
    roadmap: {
      eyebrow: "Yol haritası",
      title: "Seyahatten enerjiye, enerjiden gökyüzüne.",
      text: "Havamania adım adım büyüyor: bugün yayında olan Travel'ın üzerine yeni modüller ekleniyor.",
      phases: [
        { label: "Faz 1", name: "Havamania Travel", state: "live", stateLabel: "Yayında", text: "Hava tahmini, yapay zekâ asistanı, seyahat planlayıcı ve güzergâh takibi Android uygulamasında." },
        { label: "Faz 2", name: "Havamania Energy", state: "soon", stateLabel: "Yakında", text: "Güneş ve rüzgâr enerjisi için hava verisine dayalı analizler." },
        { label: "Faz 3", name: "Havamania Fly", state: "planned", stateLabel: "Planlanıyor", text: "Havacılık ekipleri için türbülans, jet stream ve konvektif aktivite analizi." },
        { label: "Faz 4", name: "Gelecek vizyonu", state: "vision", stateLabel: "Vizyon", text: "Hava verisi, yapay zekâ, enerji ve havacılığı bir araya getiren bir platform; API ve entegrasyonlar." },
      ],
    },
    earlyAccess: {
      eyebrow: "Erken erişim",
      title: "Enerji ve Uçuş modüllerini ilk deneyenlerden olun.",
      text: "İlgilendiğiniz modülü seçin; başvurunuz hakkında sizinle e-postayla iletişime geçelim.",
      moduleLabels: { solar: "Enerji – Solar", wind: "Enerji – Wind", fly: "Uçuş" },
      privacyNote:
        "Formda verdiğiniz ad, şirket, e-posta, modül ve not bilgileri yalnızca başvurunuzu değerlendirmek ve bu konuda sizinle iletişime geçmek için kullanılır; reklam ya da pazarlama iletisi göndermek için kullanılmaz.",
      consentLabel: "KVKK Aydınlatma Metni'ni okudum; başvurum hakkında benimle iletişime geçilmesini kabul ediyorum.",
      submitLabel: "Başvuruyu gönder",
      successText: "Teşekkürler, başvurunuz alındı.",
    },
    assistant: {
      eyebrow: "Havamania Asistan",
      title: "Her modda, sizin dilinizden.",
      text: "İster şehirde ister yolda, asistanın tonunu siz seçersiniz: Samimi, Resmî, Dengeli (önerilen), Kısa ve Net ya da Detaylı Uzman.",
    },
    premium: {
      title: "Sınırları kaldırın.",
      text: "Standart tahminlerin ötesine geçin: size göre kişiselleşen bir hava ve seyahat deneyimi.",
      cards: [
        { icon: "chart-line", title: "Gelişmiş Analizler", text: "Hava ve seyahatleriniz için ayrıntılı raporlar." },
        { icon: "user-round", title: "Tam AI Kişiselleştirme", text: "Tüm iletişim tonları ve sınırsız ilgi alanı." },
        { icon: "archive", title: "Arşiv Özellikleri", text: "Benzersiz seyahat ve sezon hafızası." },
        { icon: "palette", title: "Özel Temalar", text: "Ruh haline ve mevsime göre deneyim." },
      ],
      ctaLabel: "Premium Deneyime Geçiş Yapın",
    },
    footer: {
      tagline: "Bu bir tahmin ekranı değil, günün tadını çıkarma stratejisidir.",
      copyright: "© 2025 Altıkod Digital Solutions · Havamania",
    },
  };
}
