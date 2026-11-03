import { iconSvg } from "./icons";
import { e, icon, INK_MUTED } from "./render-util";
import type { LandingContent } from "./schema";

/*
 * Landing'in statik bölümleri: Seyahat, Enerji, Uçuş, yol haritası ve erken erişim başlığı.
 * Kaydırmalı sahnelerin aksine bunlar motorun sahne mantığına girmez: data-scene,
 * data-layer ve data-chip KULLANILMAZ; yalnızca data-reveal/data-delay (görününce açılma)
 * ve data-screen-label vardır. Sınıflar (hm-*) LANDING_CSS'te tanımlıdır.
 * Tüm CMS metinleri e() ile kaçışlanır.
 */

const PAD_X = "clamp(18px,5vw,24px)";
const PAD_Y = "clamp(64px,12vh,120px)";
const H2 = "font-size:clamp(26px,6vw,52px);font-weight:600;letter-spacing:-.03em;line-height:1.09;text-wrap:balance";
const H3 = "font-size:clamp(22px,4.6vw,38px);font-weight:600;letter-spacing:-.025em;line-height:1.12;text-wrap:balance";
const LEAD = `font-size:clamp(15px,2.6vw,22px);color:${INK_MUTED};margin-top:16px;line-height:1.4;text-wrap:pretty`;
const EYEBROW = "font-size:13px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:#0066cc;margin-bottom:14px";

/** Kartın simge kutusu (Premium kartlarıyla aynı görünüm). */
const iconBox = (name: string) => `<span class="hm-ico" aria-hidden="true"><span>${icon(name)}</span></span>`;

const bulletList = (items: string[]) =>
  `<ul class="hm-list">${items
    .filter(Boolean)
    .map((i) => `<li>${e(i)}</li>`)
    .join("")}</ul>`;

/** Hazır olmayan modül bölümlerinin üstündeki rozet ("Faz 2 · Yakında"). */
const badge = (label: string) => `<span class="hm-badge">${e(label)}</span>`;

/** Ortalanmış bölüm başlığı: rozet ya da üst etiket, başlık, metin. */
function head(opts: { id: string; kind: "badge" | "eyebrow"; label: string; title: string; text: string }): string {
  const top = opts.kind === "badge" ? `<div data-reveal style="margin-bottom:20px">${badge(opts.label)}</div>` : `<div data-reveal style="${EYEBROW}">${e(opts.label)}</div>`;
  return `
    <div style="max-width:760px;margin:0 auto;text-align:center">
      ${top}
      <h2 id="${opts.id}" data-reveal data-delay="1" style="${H2}">${e(opts.title)}</h2>
      <p data-reveal data-delay="2" style="${LEAD}">${e(opts.text)}</p>
    </div>`;
}

/** Erken erişim formuna giden bağlantı. data-ea-pick: formda işaretlenecek modüller. */
const cta = (label: string, pick: string) => `
    <div style="display:flex;justify-content:center">
      <a href="#erken-erisim" class="hm-cta" data-ea-pick="${pick}" data-reveal style="display:inline-flex;align-items:center;justify-content:center;min-height:48px;background:#0071e3;color:#fff;padding:14px clamp(22px,5vw,30px);border-radius:999px;font-size:clamp(15px,3.2vw,17px);font-weight:500;margin-top:clamp(28px,6vh,44px);transition:transform .2s">${e(label)}</a>
    </div>`;

/* ---------- Seyahat: güzergâh takibi + Faz 1 özellik ızgarası + tarla kartı ---------- */

function routeBlock(c: LandingContent): string {
  const r = c.route;
  const s = r.sample;
  // Etiket boş bırakılsa da rakamlı örnek kartı "Örnek ekran" diye işaretli kalır.
  const tag = s.label || "Örnek ekran";
  const stops = s.stops
    .map((st) => `<li><span>${e(st.city)}</span><b>${e(st.temp)}</b></li>`)
    .join("");
  return `
    <div class="hm-two" style="align-items:center">
      <div>
        <div data-reveal style="${EYEBROW}">${e(r.eyebrow)}</div>
        <h2 id="seyahat-baslik" data-reveal data-delay="1" style="${H2}">${e(r.title)}</h2>
        <p data-reveal data-delay="2" style="${LEAD}">${e(r.text)}</p>
        <div data-reveal data-delay="3" style="margin-top:20px">${bulletList(r.bullets)}</div>
      </div>
      <div data-reveal data-delay="2" class="hm-card hm-sample">
        <span class="hm-sr">${e(tag)}: </span>
        <span class="hm-sample-tag" aria-hidden="true">${e(tag)}</span>
        <div class="hm-sample-head">${e(s.from)} → ${e(s.to)}</div>
        <ol class="hm-route">${stops}</ol>
        <div class="hm-alert"><span aria-hidden="true" class="hm-alert-ico">${iconSvg("bell")}</span><span>${e(s.alert)}</span></div>
      </div>
    </div>`;
}

function featuresBlock(c: LandingContent): string {
  const f = c.features;
  const cards = f.items
    .filter((it) => it.title || it.text)
    .map(
      (it) =>
        `<article class="hm-card">${iconBox(it.icon)}<h4 class="hm-card-title">${e(it.title)}</h4><p class="hm-card-text">${e(it.text)}</p></article>`,
    )
    .join("");
  return `
    <div style="margin-top:clamp(56px,10vh,96px)">
      <div style="max-width:760px;margin:0 auto;text-align:center">
        <div data-reveal style="margin-bottom:18px">${badge(f.badge)}</div>
        <h3 data-reveal data-delay="1" style="${H3}">${e(f.title)}</h3>
        <p data-reveal data-delay="2" style="${LEAD}">${e(f.text)}</p>
      </div>
      <div data-reveal data-delay="2" class="hm-feature-grid" style="margin-top:clamp(28px,5vh,44px)">${cards}</div>
    </div>`;
}

function agroCardBlock(c: LandingContent): string {
  const a = c.agroCard;
  return `
    <div data-reveal class="hm-card hm-agro" style="max-width:760px;margin:clamp(20px,4vh,32px) auto 0">
      ${iconBox(a.icon)}
      <div><h4 class="hm-card-title">${e(a.title)}</h4><p class="hm-card-text">${e(a.text)}</p></div>
    </div>`;
}

export function seyahatSection(c: LandingContent): string {
  return `
<section id="seyahat" aria-labelledby="seyahat-baslik" data-screen-label="Seyahat" style="position:relative;z-index:1;background:linear-gradient(180deg,transparent,#fbfbfd 18vh);padding:calc(${PAD_Y} + 12vh) ${PAD_X} ${PAD_Y}">
  <div style="max-width:1040px;margin:0 auto">${routeBlock(c)}${featuresBlock(c)}${agroCardBlock(c)}
  </div>
</section>`;
}

/* ---------- Enerji (Faz 2, yakında) ---------- */

function energyCard(card: LandingContent["energy"]["solar"]): string {
  return `
      <article class="hm-card">
        ${iconBox(card.icon)}
        <h3 class="hm-card-title" style="font-size:clamp(19px,4vw,22px)">${e(card.title)}</h3>
        <p class="hm-card-text">${e(card.text)}</p>
        <h4 class="hm-sub">Analiz edilen veriler</h4>${bulletList(card.data)}
        <h4 class="hm-sub">Kullanım alanları</h4>${bulletList(card.uses)}
        <h4 class="hm-sub">Neye yardımcı olur</h4>${bulletList(card.benefits)}
      </article>`;
}

/** `withCta`: erken erişim formu sayfada varsa bağlantı gösterilir (Teslimat A'da yok). */
export function energySection(c: LandingContent, withCta: boolean): string {
  const en = c.energy;
  return `
<section id="enerji" aria-labelledby="enerji-baslik" data-screen-label="Enerji" style="position:relative;z-index:1;background:#fff;padding:${PAD_Y} ${PAD_X}">
  <div style="max-width:1040px;margin:0 auto">
    ${head({ id: "enerji-baslik", kind: "badge", label: en.badge, title: en.title, text: en.text })}
    <div data-reveal data-delay="2" class="hm-two" style="margin-top:clamp(32px,6vh,52px);align-items:stretch">${energyCard(en.solar)}${energyCard(en.wind)}
    </div>${withCta ? cta(en.ctaLabel, "solar,wind") : ""}
  </div>
</section>`;
}

/* ---------- Uçuş (Faz 3, planlanıyor) ---------- */

export function aviationSection(c: LandingContent, withCta: boolean): string {
  const av = c.aviation;
  const cards = av.analyses
    .filter((a) => a.title || a.text)
    .map(
      (a) =>
        `<article class="hm-card">${iconBox(a.icon)}<h4 class="hm-card-title">${e(a.title)}</h4><p class="hm-card-text">${e(a.text)}</p></article>`,
    )
    .join("");
  const uses = av.uses
    .filter(Boolean)
    .map((u) => `<li>${e(u)}</li>`)
    .join("");
  return `
<section id="ucus" aria-labelledby="ucus-baslik" data-screen-label="Uçuş" style="position:relative;z-index:1;background:#fbfbfd;padding:${PAD_Y} ${PAD_X}">
  <div style="max-width:1040px;margin:0 auto">
    ${head({ id: "ucus-baslik", kind: "badge", label: av.badge, title: av.title, text: av.text })}
    <h3 data-reveal class="hm-sub" style="text-align:center;margin-top:clamp(32px,6vh,52px)">Planlanan analizler</h3>
    <div data-reveal data-delay="1" class="hm-feature-grid" style="margin-top:16px">${cards}</div>
    <h3 data-reveal class="hm-sub" style="text-align:center;margin-top:clamp(28px,5vh,40px)">Kullanım alanları</h3>
    <ul data-reveal data-delay="1" class="hm-pills">${uses}</ul>
    <p data-reveal data-delay="2" class="hm-note">${e(av.note)}</p>${withCta ? cta(av.ctaLabel, "fly") : ""}
  </div>
</section>`;
}

/* ---------- Yol haritası (Faz 1–4) ---------- */

export function roadmapSection(c: LandingContent): string {
  const rm = c.roadmap;
  const phases = rm.phases
    .map(
      (p) => `
      <li class="hm-card hm-phase" data-state="${e(p.state)}">
        <div class="hm-phase-top"><span class="hm-phase-label">${e(p.label)}</span><span class="hm-badge" data-state="${e(p.state)}">${e(p.stateLabel)}</span></div>
        <h3 class="hm-card-title">${e(p.name)}</h3>
        <p class="hm-card-text">${e(p.text)}</p>
      </li>`,
    )
    .join("");
  return `
<section id="yol-haritasi" aria-labelledby="yol-haritasi-baslik" data-screen-label="Yol haritası" style="position:relative;z-index:1;background:#fff;padding:${PAD_Y} ${PAD_X}">
  <div style="max-width:1040px;margin:0 auto">
    ${head({ id: "yol-haritasi-baslik", kind: "eyebrow", label: rm.eyebrow, title: rm.title, text: rm.text })}
    <ol data-reveal data-delay="3" class="hm-roadmap" style="margin-top:clamp(32px,6vh,52px)">${phases}
    </ol>
  </div>
</section>`;
}

/* ---------- Erken erişim ---------- */

/** Bu teslimatta yalnızca başlık ve metin; form işaretlemesi ayrı adımda eklenir. */
export function earlyAccessSection(c: LandingContent): string {
  const ea = c.earlyAccess;
  return `
<section id="erken-erisim" aria-labelledby="erken-erisim-baslik" data-screen-label="Erken erişim" style="position:relative;z-index:1;background:#fbfbfd;padding:${PAD_Y} ${PAD_X}">
  <div style="max-width:1040px;margin:0 auto">
    ${head({ id: "erken-erisim-baslik", kind: "eyebrow", label: ea.eyebrow, title: ea.title, text: ea.text })}
  </div>
</section>`;
}
