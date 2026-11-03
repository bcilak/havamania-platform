import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import { coerce } from "./coerce";
import { landingToText } from "./flatten";
import { resolveIcon } from "./icons";
import { migrateLanding } from "./migrate";
import { e } from "./render-util";
import { renderLanding } from "./render";
import { defaultLandingContent, landingSchema } from "./schema";
import legacy from "./fixtures/landing-v1.json";

/* landing-v1.json: Agro/Fly sahneleri ve Modlar (phase2) bölümü kaldırılmadan önceki
   varsayılan içeriğin birebir dökümü. Canlıdaki yayın satırı bu biçimdedir. */
type V1 = {
  seo: Record<string, string>;
  nav: unknown;
  hero: { title: string };
  scenes: { core: { captions: { title: string }[] } } & Record<string, unknown>;
  phase2?: unknown;
  route?: unknown;
  energy?: unknown;
  assistant: { title: string; text: string };
  premium: { title: string };
  footer: { tagline: string };
};
const v1 = (): V1 => structuredClone(legacy) as unknown as V1;

const FORBIDDEN = /yüksek doğruluk|güvenlik skoru|karar destek|garanti|%100|\biOS\b|App Store/i;

describe("landingSchema", () => {
  it("varsayılan içerik şemadan geçer", () => {
    assert.doesNotThrow(() => landingSchema.parse(defaultLandingContent()));
  });

  it("varsayılan özellik ızgarası 9 kart; şema 12'ye kadar izin verir, 13'ü reddeder", () => {
    const c = defaultLandingContent();
    assert.equal(c.features.items.length, 9);
    const card = c.features.items[0];
    c.features.items = Array.from({ length: 12 }, () => card);
    assert.ok(landingSchema.safeParse(c).success);
    c.features.items = Array.from({ length: 13 }, () => card);
    assert.ok(!landingSchema.safeParse(c).success);
  });

  it("seo.ogImage: boş, göreli yol ve https kabul; tehlikeli/bozuk adres reddedilir", () => {
    const ok = (v: string) => {
      const c = defaultLandingContent();
      c.seo.ogImage = v;
      return landingSchema.safeParse(c).success;
    };
    for (const v of ["", "/og.png", "/api/media/abc", "https://example.com/og.png"]) assert.ok(ok(v), v);
    for (const v of ["javascript:alert(1)", "http://[", "http://example.com/og.png", "//evil.com/x.png", "/\\evil.com", "data:image/png;base64,AAAA", "og.png", "https://["]) {
      assert.ok(!ok(v), v);
    }
  });

  it("rozet/iddia kuralı: varsayılan içerikte yasak ifadeler yok", () => {
    assert.doesNotMatch(JSON.stringify(defaultLandingContent()), FORBIDDEN);
  });
});

describe("coerce: eski yayın kaydı", () => {
  it("fixture gerçekten eski biçimde (agro, fly, phase2 var; yeni anahtarlar yok)", () => {
    const raw = v1();
    assert.deepEqual(Object.keys(raw.scenes), ["core", "agro", "fly"]);
    assert.ok(raw.phase2);
    assert.equal(raw.route, undefined);
    assert.equal(raw.energy, undefined);
  });

  it("varsayılana DÜŞMEZ: mevcut düzenlemeler korunur, yeni anahtarlar varsayılandan dolar", () => {
    const raw = v1();
    raw.hero.title = "Özel hero başlığı";
    raw.scenes.core.captions[0].title = "Özel sahne başlığı";
    raw.assistant.title = "Özel asistan başlığı";
    raw.assistant.text = "Düzenlenmiş asistan metni.";
    raw.premium.title = "Özel premium";
    raw.footer.tagline = "Özel slogan";
    raw.seo.description = "Özel açıklama";

    const c = coerce(raw);
    const d = defaultLandingContent();

    assert.equal(c.hero.title, "Özel hero başlığı");
    assert.equal(c.scenes.core.captions[0].title, "Özel sahne başlığı");
    assert.equal(c.assistant.title, "Özel asistan başlığı");
    assert.equal(c.assistant.text, "Düzenlenmiş asistan metni.");
    assert.equal(c.premium.title, "Özel premium");
    assert.equal(c.footer.tagline, "Özel slogan");
    assert.equal(c.seo.description, "Özel açıklama");

    // Eski anahtarlar atıldı.
    assert.deepEqual(Object.keys(c.scenes), ["core"]);
    assert.ok(!("phase2" in c));

    // Yeni anahtarlar varsayılandan geldi.
    assert.deepEqual(c.route, d.route);
    assert.deepEqual(c.features, d.features);
    assert.deepEqual(c.agroCard, d.agroCard);
    assert.deepEqual(c.energy, d.energy);
    assert.deepEqual(c.aviation, d.aviation);
    assert.deepEqual(c.roadmap, d.roadmap);
    assert.deepEqual(c.earlyAccess, d.earlyAccess);
  });

  it("eksik alanlı eski kayıt (nav: {}, kısmi seo) varsayılana düşmez", () => {
    const raw = v1();
    raw.hero.title = "Özel hero başlığı";
    raw.nav = {};
    raw.seo = { title: "Özel SEO başlığı" };
    const c = coerce(raw);
    assert.equal(c.hero.title, "Özel hero başlığı");
    assert.equal(c.seo.title, "Özel SEO başlığı");
    assert.equal(c.nav.ctaLabel, defaultLandingContent().nav.ctaLabel);
    assert.equal(c.seo.description, defaultLandingContent().seo.description);
  });

  it("sonradan eklenen iç içe alan eksikse (ikinci düzey) içerik varsayılana düşmez", () => {
    const raw = v1() as unknown as Record<string, unknown>;
    raw.earlyAccess = { eyebrow: "Özel erken erişim" };
    raw.energy = { badge: "Özel rozet" };
    const c = coerce(raw);
    assert.equal(c.earlyAccess.eyebrow, "Özel erken erişim");
    assert.equal(c.earlyAccess.successText, defaultLandingContent().earlyAccess.successText);
    assert.equal(c.energy.badge, "Özel rozet");
    assert.deepEqual(c.energy.solar, defaultLandingContent().energy.solar);
    assert.equal(c.hero.title, defaultLandingContent().hero.title);
  });

  it("üst düzey anahtar null/undefined ise yalnızca o anahtar varsayılandan dolar", () => {
    const raw = v1() as unknown as Record<string, unknown>;
    raw.hero = { ...(raw.hero as object), title: "Özel hero başlığı" };
    raw.route = null;
    raw.energy = undefined;
    raw.roadmap = null;
    const c = coerce(raw);
    const d = defaultLandingContent();
    assert.equal(c.hero.title, "Özel hero başlığı");
    assert.deepEqual(c.route, d.route);
    assert.deepEqual(c.energy, d.energy);
    assert.deepEqual(c.roadmap, d.roadmap);
  });

  it("geçersiz kayıt varsayılana düşer ve alan yolu loglanır (değer loglanmaz)", () => {
    const err = mock.method(console, "error", () => {});
    try {
      const raw = v1();
      raw.hero.title = "x".repeat(500);
      const c = coerce(raw);
      assert.deepEqual(c, defaultLandingContent());
      assert.equal(err.mock.callCount(), 1);
      const args = err.mock.calls[0].arguments;
      assert.equal(args[1], "hero.title");
      assert.ok(!args.join(" ").includes("xxxx"));
    } finally {
      err.mock.restore();
    }
  });

  it("kayıt yoksa ya da nesne değilse varsayılan döner", () => {
    assert.deepEqual(coerce(null), defaultLandingContent());
    assert.deepEqual(coerce("x"), defaultLandingContent());
    assert.deepEqual(coerce([]), defaultLandingContent());
  });

  it("eski kayıt bilgi tabanı aktarımında çökmez ve yeni bölümleri içerir", () => {
    const text = landingToText(coerce(v1()));
    assert.match(text, /Havamania Energy/);
  });
});

describe("migrateLanding", () => {
  const OLD_ASSISTANT = "İster tarla ister uçuş — asistan tonunu siz seçersiniz: Samimi, Resmî, Dengeli (önerilen), Kısa ve Net ya da Detaylı Uzman.";

  it("eski varsayılan metinleri yenisine çevirir", () => {
    const c = coerce(v1());
    const d = defaultLandingContent();
    assert.equal(c.assistant.text, d.assistant.text);
    assert.equal(c.seo.title, d.seo.title);
    assert.equal(c.seo.description, d.seo.description);
    assert.equal(c.premium.text, d.premium.text);
    assert.equal(c.premium.cards[0].text, d.premium.cards[0].text);
  });

  it("düzenlenmiş metne dokunmaz", () => {
    const c = defaultLandingContent();
    c.assistant.text = "Benim asistan metnim.";
    c.premium.cards[0].text = "Benim kartım.";
    const m = migrateLanding(c);
    assert.equal(m.assistant.text, "Benim asistan metnim.");
    assert.equal(m.premium.cards[0].text, "Benim kartım.");
  });

  it("eski asistan metnini dönüştürür", () => {
    const c = defaultLandingContent();
    c.assistant.text = OLD_ASSISTANT;
    assert.equal(migrateLanding(c).assistant.text, defaultLandingContent().assistant.text);
  });
});

describe("landingToText", () => {
  const text = landingToText(defaultLandingContent());

  it("hazır olmayan modülleri açıkça işaretler", () => {
    assert.match(text, /yakında/);
    assert.match(text, /planlanıyor/);
    assert.match(text, /henüz kullanıma açık değil/);
  });

  it("Agro/Fly'ı sahne olarak anlatmaz", () => {
    assert.doesNotMatch(text, /^## Agro Modu/m);
    assert.doesNotMatch(text, /^## Fly Modu/m);
  });

  it("form yokken erken erişim cümlesi ve yönlendirmesi yok; earlyAccess:true ile gelir", () => {
    assert.doesNotMatch(text, /erken erişim listesine|#erken-erisim formu/i);
    const withForm = landingToText(defaultLandingContent(), { earlyAccess: true });
    assert.match(withForm, /Erken erişim: sitedeki #erken-erisim formuyla başvurulur./);
    assert.doesNotMatch(landingToText(defaultLandingContent(), { earlyAccess: false }), /#erken-erisim formu/);
  });

  it("örnek güzergâh rakamlarını aktarmaz", () => {
    assert.doesNotMatch(text, /Bursa|Eskişehir|Afyonkarahisar/);
  });
});

describe("sözlük aramaları kalıtılan anahtarlara açık değil", () => {
  it("resolveIcon('constructor') ve benzerleri tanınmaz; gerçek simge/emoji tanınır", () => {
    for (const v of ["constructor", "toString", "__proto__", "hasOwnProperty"]) assert.equal(resolveIcon(v), null, v);
    assert.equal(resolveIcon("sun"), "sun");
    assert.equal(resolveIcon("☀️"), "sun");
  });

  it("eyebrow='constructor' migrate'i ve render'ı çökertmez, metin olduğu gibi kalır", () => {
    const c = defaultLandingContent();
    c.scenes.core.captions[0].eyebrow = "constructor";
    const m = migrateLanding(c);
    assert.equal(m.scenes.core.captions[0].eyebrow, "constructor");
    assert.doesNotThrow(() => renderLanding(m, {}));
  });

  it("eski 'Faz 2' eyebrow'u hâlâ dönüşür", () => {
    const c = defaultLandingContent();
    c.scenes.core.captions[0].eyebrow = "Faz 2 · Agro Modu";
    assert.equal(migrateLanding(c).scenes.core.captions[0].eyebrow, "Agro Modu");
  });

  it("e() string olmayan değerde patlamaz", () => {
    assert.equal(e(undefined), "");
    assert.equal(e(null), "");
    assert.equal(e(42), "42");
    assert.equal(e("<a>"), "&lt;a&gt;");
  });
});
