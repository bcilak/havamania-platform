import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AI_PROVIDERS_FALLBACK, fillLegal, formatAiProviders, LEGAL_BODY_DEFAULTS, LEGAL_DEFAULTS, LEGAL_PAGES, LEGAL_TOKENS } from "./legal";

const ctx = { retentionDays: 180, siteUrl: "https://havamania.com/" };

describe("LEGAL_BODY_DEFAULTS", () => {
  it("gizlilik: şifre cümlesi kalktı, gerçek veri toplamayı anlatır", () => {
    const p = LEGAL_BODY_DEFAULTS.privacy;
    assert.ok(!p.includes("geri döndürülemez"));
    for (const t of ["Firebase Authentication", "Firestore", "Crashlytics", "profil fotoğraf", "seyahat", "{{site}}/kvkk", "sağlık hassasiyet", "{{yz_saglayicilar}}"]) {
      assert.ok(p.includes(t), t);
    }
    assert.ok(!p.includes("hangi ekranların"));
  });

  it("gizlilik ve kvkk: sağlık rızası ayrı ve isteğe bağlı; bağlam alanları için saklama ifadesi netleşti", () => {
    const p = LEGAL_BODY_DEFAULTS.privacy;
    assert.ok(!p.includes("asistan platformunda saklanmaz"));
    assert.match(p, /ayrıca saklanmaz; ancak asistanın cevabı bu bilgilere değinebilir ve cevap konuşma kaydında yer alabilir/);
    for (const text of [p, LEGAL_BODY_DEFAULTS.kvkk]) {
      assert.match(text, /ayrı, isteğe bağlı ikinci bir onay/);
      assert.match(text, /Vermezseniz sağlık hassasiyetleriniz asistana gönderilmez/);
    }
  });

  it("hesap silme: Firestore ve profil fotoğrafı silinenler arasında", () => {
    const d = LEGAL_BODY_DEFAULTS.deletion;
    assert.ok(d.includes("Firestore"));
    assert.ok(d.includes("profil fotoğraf"));
  });

  it("kvkk: m. 10 başlıkları, m. 11 hakları, sağlık verisi ve sağlayıcı yer tutucusu", () => {
    const k = LEGAL_BODY_DEFAULTS.kvkk;
    for (const t of ["Veri sorumlusu", "11.", "{{yz_saglayicilar}}", "m. 6", "Crashlytics", "Firestore", "Storage"]) assert.ok(k.includes(t), t);
  });

  it("her sayfanın yolu ve varsayılan gövdesi var; kvkk en sonda", () => {
    const slugs = Object.keys(LEGAL_PAGES);
    assert.equal(slugs.at(-1), "kvkk");
    assert.equal(LEGAL_PAGES.kvkk.path, "/kvkk");
    for (const s of slugs) assert.ok(LEGAL_BODY_DEFAULTS[s as keyof typeof LEGAL_BODY_DEFAULTS].length > 200);
  });

  it("metinlerde geçen her yer tutucu LEGAL_TOKENS'ta tanımlı", () => {
    const known = new Set(LEGAL_TOKENS.map(([t]) => t));
    for (const body of Object.values(LEGAL_BODY_DEFAULTS)) for (const t of body.match(/\{\{[a-z_]+\}\}/g) ?? []) assert.ok(known.has(t), t);
  });
});

describe("fillLegal", () => {
  const cfg = { ...LEGAL_DEFAULTS, address: "Ankara", email: "kvkk@ornek.com" };

  it("tüm sayfalarda yer tutucular dolar ({{ kalmaz)", () => {
    for (const body of Object.values(LEGAL_BODY_DEFAULTS)) {
      const out = fillLegal(body, cfg, { ...ctx, aiProviders: "Anthropic (ABD)" });
      assert.ok(!out.includes("{{"), out.match(/\{\{[^}]*\}\}/)?.[0]);
    }
  });

  it("sağlayıcı listesi boşken yedek ifade yazılır", () => {
    assert.ok(fillLegal("Sağlayıcılar: {{yz_saglayicilar}}", cfg, ctx).includes(AI_PROVIDERS_FALLBACK));
    assert.ok(fillLegal("Sağlayıcılar: {{yz_saglayicilar}}", cfg, { ...ctx, aiProviders: "  " }).includes(AI_PROVIDERS_FALLBACK));
  });

  it("verilen sağlayıcı listesi aynen yazılır, adres boşsa satırı çıkar", () => {
    assert.ok(fillLegal("- {{yz_saglayicilar}}", cfg, { ...ctx, aiProviders: "OpenAI (ABD)" }).includes("OpenAI (ABD)"));
    assert.ok(!fillLegal(LEGAL_BODY_DEFAULTS.kvkk, { ...cfg, address: "" }, ctx).includes("**Adres:**"));
  });
});

describe("formatAiProviders", () => {
  it("tekrarsız etiketler, virgülle ayrılmış", () => {
    const out = formatAiProviders([
      { kind: "anthropic", name: "A1" },
      { kind: "anthropic", name: "A2" },
      { kind: "openai", name: "O" },
      { kind: "openai_compatible", name: "Yerel" },
    ]);
    assert.equal(out, "Anthropic (ABD), OpenAI (ABD), Yerel (OpenAI uyumlu servis)");
  });

  it("boş listede yedek ifade", () => {
    assert.equal(formatAiProviders([]), AI_PROVIDERS_FALLBACK);
  });
});
