/*
 * Landing doğrulama hatalarını editörün gördüğü adlarla yazar. "use server" dosyaları yalnızca
 * async fonksiyon dışa aktarabildiği için actions.ts'ten ayrıldı; birim testi de buradan yapılır.
 */

/* Doğrulama hatasındaki alan yolunu editörün gördüğü adlarla yazmak için. */
export const LABELS: Record<string, string> = {
  scenes: "",
  core: "Panel sahnesi",
  seo: "Arama motorları",
  hero: "Hero",
  nav: "Menü",
  route: "Güzergâh bölümü",
  features: "Özellik ızgarası",
  items: "kartlar",
  agroCard: "Tarla kartı",
  energy: "Enerji",
  solar: "Solar",
  wind: "Wind",
  data: "analiz edilen veriler",
  uses: "kullanım alanları",
  benefits: "faydalar",
  aviation: "Uçuş",
  analyses: "analizler",
  roadmap: "Yol haritası",
  phases: "fazlar",
  earlyAccess: "Erken erişim",
  bullets: "maddeler",
  sample: "örnek ekran",
  stops: "duraklar",
  city: "şehir",
  alert: "bildirim",
  from: "çıkış",
  to: "varış",
  badge: "rozet",
  name: "ad",
  state: "durum",
  stateLabel: "durum etiketi",
  moduleLabels: "modül adları",
  privacyNote: "aydınlatma notu",
  consentLabel: "onay metni",
  submitLabel: "gönder butonu",
  successText: "başarı mesajı",
  assistant: "Asistan bölümü",
  premium: "Premium",
  footer: "Alt bilgi",
  captions: "Başlıklar",
  chips: "Çipler",
  screen1: "1. ekran",
  screen2: "2. ekran",
  screen3: "3. ekran",
  slots: "hücreler",
  cards: "kartlar",
  bubbles: "mesajlar",
  eyebrow: "üst etiket",
  title: "başlık",
  sub: "alt metin",
  subtitle: "alt metin",
  text: "metin",
  icon: "ikon",
  label: "etiket",
  value: "değer",
  unit: "birim",
  header: "üst satır",
  location: "konum satırı",
  temp: "büyük değer",
  condition: "durum",
  note: "not",
  ringValue: "halka değeri",
  ringLabel: "halka etiketi",
  description: "açıklama",
  ogImage: "paylaşım görseli",
  ctaLabel: "buton",
};

/** zod v4 sorunundan, ihtiyaç duyulan alanlar. origin: hatanın geldiği değer türü ("array", "string"...). */
export type Issue = {
  code: string;
  message: string;
  path: PropertyKey[];
  origin?: string;
  maximum?: unknown;
  minimum?: unknown;
  exact?: boolean;
};

export function describeIssue(issue: Issue): string {
  const where = issue.path
    .map((p) => (typeof p === "number" ? `${p + 1}.` : (LABELS[String(p)] ?? String(p))))
    .filter(Boolean)
    .join(" › ");
  // Sınır dizi uzunluğundan geliyorsa "karakter" değil "tane" denir (ör. en fazla 6 madde).
  const unit = issue.origin === "array" ? "tane" : issue.origin === "string" ? "karakter" : "";
  let what = "geçersiz";
  if (issue.code === "too_big") {
    what = issue.exact && unit ? `tam ${String(issue.maximum)} ${unit} olmalı` : `en fazla ${String(issue.maximum)}${unit ? ` ${unit}` : ""} olabilir`;
  } else if (issue.code === "too_small") {
    what =
      issue.exact && unit
        ? `tam ${String(issue.minimum)} ${unit} olmalı`
        : Number(issue.minimum) > 1
          ? `en az ${String(issue.minimum)}${unit ? ` ${unit}` : ""} olmalı`
          : "boş bırakılamaz";
  }
  return `${where}: ${what}`;
}
