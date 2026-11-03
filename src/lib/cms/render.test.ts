import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LANDING_CSS, renderLanding } from "./render";
import { defaultLandingContent } from "./schema";

const FORBIDDEN = /\biOS\b|App Store|yüksek doğruluk|güvenlik skoru|karar destek|garanti|%100/i;
const withForm = { earlyAccess: { token: "x" } };
const count = (s: string, needle: string) => s.split(needle).length - 1;

describe("renderLanding: bölümler", () => {
  const html = renderLanding(defaultLandingContent(), withForm);

  it("tek kaydırmalı sahne var ve core", () => {
    assert.equal(count(html, "data-scene="), 1);
    assert.ok(html.includes('data-scene="core"'));
    // Çip ve başlık katmanları yalnızca core'dan gelir (6 çip, 4 başlık).
    assert.equal(count(html, "data-chip="), 6);
    assert.equal(count(html, "data-layer="), 4);
  });

  it("yeni bölümler var, agro/fly/modlar/çayır yok", () => {
    for (const id of ["panel", "seyahat", "enerji", "ucus", "asistan", "yol-haritasi", "erken-erisim", "premium"]) {
      assert.ok(html.includes(`id="${id}"`), id);
    }
    for (const id of ["agro", "fly", "modlar"]) assert.ok(!html.includes(`id="${id}"`), id);
    assert.ok(!html.includes("data-meadow"));
  });

  it("menü sırası: Hava, Seyahat, Enerji, Uçuş, Asistan", () => {
    const at = ["#panel", "#seyahat", "#enerji", "#ucus", "#asistan"].map((h) => html.indexOf(`href="${h}"`));
    assert.ok(at.every((i) => i >= 0), at.join());
    assert.deepEqual([...at].sort((a, b) => a - b), at);
    assert.ok(!html.includes('href="#agro"') && !html.includes('href="#fly"'));
  });

  it("bölümler menü sırasını izler", () => {
    const at = ["panel", "seyahat", "enerji", "ucus", "asistan", "yol-haritasi", "erken-erisim", "premium"].map((id) => html.indexOf(`<section id="${id}"`));
    assert.ok(at.every((i) => i >= 0), at.join());
    assert.deepEqual([...at].sort((a, b) => a - b), at);
  });

  it("hazır olmayan modüller ve örnek ekran açıkça etiketli", () => {
    for (const t of ["Yakında", "Planlanıyor", "Örnek ekran", "Faz 1 · Yayında"]) assert.ok(html.includes(t), t);
    assert.doesNotMatch(html, FORBIDDEN);
  });

  it("örnek etiketi boş bırakılsa da rakamlı kart etiketsiz kalmaz", () => {
    const c = defaultLandingContent();
    c.route.sample.label = "";
    assert.ok(renderLanding(c).includes('class="hm-sample-tag" aria-hidden="true">Örnek ekran<'));
  });

  it("Faz 1 ızgarası kart sayısı kadar kart çizer; boş kartlar atlanır", () => {
    const c = defaultLandingContent();
    const base = count(renderLanding(c), 'class="hm-card"');
    c.features.items.push({ icon: "bell", title: "", text: "" });
    assert.equal(count(renderLanding(c), 'class="hm-card"'), base);
    c.features.items.push({ icon: "bell", title: "Yeni kart", text: "Metin" });
    assert.equal(count(renderLanding(c), 'class="hm-card"'), base + 1);
  });

  it("Faz 1 ızgarasında mobil ekip onayı bekleyen üç kart yok", () => {
    for (const t of ["Uçuş Analizi", "Veri Tasarrufu", "Rota Optimizasyonu", "Güvenlik Uyarıları"]) assert.ok(!html.includes(t), t);
    assert.ok(html.includes("Hava Uyarıları"));
  });

  it("yeni bölümler kaydırma motoruna girmez; yalnızca data-reveal kullanır", () => {
    const from = html.indexOf('<section id="seyahat"');
    const to = html.indexOf('<section id="asistan"');
    const mid = html.slice(from, to);
    assert.ok(mid.includes("data-reveal"));
    assert.ok(!/data-scene|data-layer|data-chip|data-pin/.test(mid));
  });

  it("asistan bölümü artık düz zemin: önünde sahne yok, saydam geçiş ve ek üst boşluk gereksiz", () => {
    const html = renderLanding(defaultLandingContent(), withForm);
    const i = html.indexOf('<section id="asistan"');
    const tag = html.slice(i, html.indexOf(">", i));
    assert.ok(!tag.includes("transparent"));
    assert.ok(!html.slice(i, i + 600).includes("+ 12vh"));
  });

  it("yeşil durum rozeti koyu tonda (kontrast), yumuşak kaydırma motor sınıfına bağlı", () => {
    assert.ok(LANDING_CSS.includes('[data-state="live"]{background:rgba(26,127,71,.1);color:#166c3b}'));
    assert.ok(LANDING_CSS.includes("html.hm-ready{scroll-behavior:smooth}"));
    assert.ok(!/html{[^}]*scroll-behavior/.test(LANDING_CSS));
  });

  it("stil: ızgara, rozet ve görünmez metin sınıfları tanımlı", () => {
    for (const cls of [".hm-feature-grid", ".hm-two", ".hm-roadmap", ".hm-badge", ".hm-sr"]) assert.ok(LANDING_CSS.includes(cls), cls);
  });
});

describe("renderLanding: erken erişim yalnızca form varsa", () => {
  it("opts verilmezse bölüm ve CTA'lar çıkmaz", () => {
    const html = renderLanding(defaultLandingContent());
    assert.ok(!html.includes('id="erken-erisim"'));
    assert.ok(!html.includes("data-ea-pick"));
    assert.ok(!html.includes('href="#erken-erisim"'));
    assert.ok(html.includes('id="yol-haritasi"'));
  });

  it("form yokken hiçbir metin erken erişime yönlendirmez", () => {
    const html = renderLanding(defaultLandingContent());
    assert.doesNotMatch(html, /erken erişim|erken-erisim/i);
  });

  it("opts.earlyAccess null ise de çıkmaz", () => {
    assert.ok(!renderLanding(defaultLandingContent(), { earlyAccess: null }).includes('id="erken-erisim"'));
  });

  it("form varsa CTA'lar doğru modülleri taşır", () => {
    const html = renderLanding(defaultLandingContent(), withForm);
    assert.ok(html.includes('data-ea-pick="solar,wind"'));
    assert.ok(html.includes('data-ea-pick="fly"'));
  });
});

describe("renderLanding: kaçışlama (XSS)", () => {
  const payload = "<img src=x onerror=alert(1)>";

  it("route.title kaçışlanır", () => {
    const c = defaultLandingContent();
    c.route.title = payload;
    const html = renderLanding(c, withForm);
    assert.ok(!html.includes("<img src=x"));
    assert.ok(html.includes("&lt;img"));
  });

  it("yeni bölümlerdeki her metin alanı kaçışlanır", () => {
    const c = defaultLandingContent();
    c.route.eyebrow = c.route.text = c.route.bullets[0] = payload;
    c.route.sample = { ...c.route.sample, label: payload, from: payload, to: payload, alert: payload };
    c.route.sample.stops[0] = { city: payload, temp: payload };
    c.features.badge = c.features.title = c.features.text = payload;
    c.features.items[0] = { icon: payload, title: payload, text: payload };
    c.agroCard = { icon: payload, title: payload, text: payload };
    c.energy.badge = c.energy.title = c.energy.text = c.energy.ctaLabel = payload;
    for (const card of [c.energy.solar, c.energy.wind]) {
      card.icon = card.title = card.text = payload;
      card.data[0] = card.uses[0] = card.benefits[0] = payload;
    }
    c.aviation.badge = c.aviation.title = c.aviation.text = c.aviation.note = c.aviation.ctaLabel = payload;
    c.aviation.analyses[0] = { icon: payload, title: payload, text: payload };
    c.aviation.uses[0] = payload;
    c.roadmap.eyebrow = c.roadmap.title = c.roadmap.text = payload;
    c.roadmap.phases[0] = { ...c.roadmap.phases[0], label: payload, name: payload, stateLabel: payload, text: payload };
    c.earlyAccess.eyebrow = c.earlyAccess.title = c.earlyAccess.text = payload;
    const html = renderLanding(c, withForm);
    assert.ok(!html.includes("<img src=x"), "kaçışlanmamış etiket");
    assert.ok(!html.includes("onerror=alert(1)>"));
  });
});
