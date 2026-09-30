import type { LandingContent, SceneContent, SceneKey } from "./schema";

/*
 * Landing sayfasının işaretlemesi. Havamania.dc.html'deki (düzeltilmiş) yapının
 * birebir karşılığıdır; metinler CMS'ten gelir ve her biri HTML'e kaçışlanır.
 * data-* nitelikleri kaydırma motorunun (engine.ts) sözleşmesidir; değiştirmeyin.
 */

const e = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const INK_MUTED = "#5c5c61";

type SceneStyle = {
  id?: string;
  accent: string;
  atmos: string;
  baseVh: number;
  label: string;
  bg: string;
  screens: [string, string, string];
};

const SCENES: Record<SceneKey, SceneStyle> = {
  core: {
    id: "panel",
    accent: "#0071e3",
    atmos: "clear,clear,cloudy,cloudy",
    baseVh: 600,
    label: "Panel",
    bg: "radial-gradient(120% 90% at 50% 0%,#eef4fb,#dbe6f2)",
    screens: ["#3a8fd8,#bfe0f5", "#0e2c1c,#1a4d2e", "#0b2f52,#0f3f68"],
  },
  agro: {
    accent: "#1a7f47",
    atmos: "spring,spring,rain",
    baseVh: 420,
    label: "Agro",
    bg: "radial-gradient(120% 90% at 50% 0%,#eef7ea,#dcecd4)",
    screens: ["#2f7d3f,#a8d9a0", "#0e2c1c,#1a4d2e", "#0b2f52,#0f3f68"],
  },
  fly: {
    accent: "#2b6fb0",
    atmos: "cloudy,storm,storm",
    baseVh: 420,
    label: "Fly",
    bg: "radial-gradient(120% 90% at 50% 0%,#eaf3fb,#d3e6f5)",
    screens: ["#2b6fb0,#bfe0f5", "#0e2c1c,#123b52", "#0b2f52,#0f3f68"],
  },
};

const screenBox = (top: string, grad: string) =>
  `position:absolute;left:0;right:0;top:${top};height:100%;padding:3.2em 1.25em 1.25em;color:#fff;overflow:hidden;display:flex;flex-direction:column;background:linear-gradient(175deg,${grad})`;
const loc = (t: string) => `<div style="font-size:.85em;opacity:.82;letter-spacing:.03em">${e(t)}</div>`;
const glass = "background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.16);border-radius:.9em";

function scene(key: SceneKey, s: SceneContent): string {
  const st = SCENES[key];
  const layers = s.captions
    .map(
      (c, i) => `
        <div data-layer="${i}" style="grid-area:1/1;opacity:0;visibility:hidden;transform:translateY(8px);transition:opacity .3s ease,transform .3s ease,visibility 0s linear .3s">
          <div data-ey style="font-size:clamp(10px,2.4vw,12px);font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:${st.accent}">${e(c.eyebrow)}</div>
          <h2 data-capt style="font-size:clamp(20px,4.4vw,38px);font-weight:600;letter-spacing:-.02em;line-height:1.12;margin-top:7px;text-wrap:balance">${e(c.title)}</h2>
          <p data-caps style="font-size:clamp(12px,2.5vw,14px);color:${INK_MUTED};margin-top:6px">${e(c.sub)}</p>
        </div>`,
    )
    .join("");

  const chips = s.chips
    .map(
      (c, i) => `
      <div data-chip="${i}" style="position:absolute;left:50%;top:50%;z-index:4;background:rgba(255,255,255,.92);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);border:1px solid rgba(0,0,0,.06);border-radius:14px;padding:clamp(7px,1.6vw,11px) clamp(9px,1.9vw,13px);min-width:clamp(84px,22vw,118px);box-shadow:0 20px 40px rgba(20,40,70,.14);opacity:0;will-change:transform,opacity">
        <span data-ic aria-hidden="true" style="position:absolute;top:-9px;right:-9px;width:clamp(20px,5vw,26px);height:clamp(20px,5vw,26px);border-radius:50%;background:${st.accent};color:#fff;display:grid;place-items:center;font-size:clamp(10px,2.6vw,13px)">${e(c.icon)}</span>
        <div style="font-size:clamp(8px,2vw,10px);text-transform:uppercase;letter-spacing:.08em;color:${INK_MUTED}">${e(c.label)}</div>
        <div style="font-size:clamp(15px,4vw,21px);font-weight:700;letter-spacing:-.02em;margin-top:2px">${e(c.value)}</div>
        <div style="font-size:clamp(8px,2vw,10px);color:${INK_MUTED}">${e(c.unit)}</div>
      </div>`,
    )
    .join("");

  const slots = s.screen1.slots
    .map(
      (x, i) =>
        `<div data-slot="${i}" style="${glass};padding:.55em .7em;transition:background .3s,box-shadow .3s"><div style="font-size:.7em;text-transform:uppercase;letter-spacing:.06em;opacity:.7">${e(x.label)}</div><div style="font-size:1.15em;font-weight:600">${e(x.value)}</div><div style="font-size:.7em;opacity:.6">${e(x.unit)}</div></div>`,
    )
    .join("");

  const s2 = s.screen2;
  const hasRing = Boolean(s2.ringValue);
  const ring = hasRing
    ? `<div style="width:6.5em;height:6.5em;position:relative;display:grid;place-items:center;margin:.3em auto .6em">
          <svg viewBox="0 0 100 100" style="position:absolute;inset:0;transform:rotate(-90deg)"><circle cx="50" cy="50" r="43" fill="none" stroke="rgba(255,255,255,.2)" stroke-width="8"></circle><circle cx="50" cy="50" r="43" fill="none" stroke="#7dffb0" stroke-width="8" stroke-linecap="round" stroke-dasharray="270" stroke-dashoffset="${(270 * (1 - s2.ringPercent / 100)).toFixed(1)}"></circle></svg>
          <div style="text-align:center"><div style="font-size:1.75em;font-weight:700">${e(s2.ringValue)}</div><div style="font-size:.62em;letter-spacing:.1em;text-transform:uppercase;opacity:.7">${e(s2.ringLabel)}</div></div>
        </div>`
    : "";
  const cards = s2.cards
    .map(
      (c) =>
        `<div style="${glass};padding:.6em .85em;margin-top:.55em"><b style="font-size:.92em">${e(c.title)}</b><p style="font-size:.85em;opacity:.8;margin-top:2px;line-height:1.3">${e(c.text)}</p></div>`,
    )
    .join("");

  const bubbles = s.screen3.bubbles
    .map((b) =>
      b.from === "ai"
        ? `<div style="max-width:84%;padding:.6em .85em;border-radius:1.1em;border-bottom-left-radius:.3em;font-size:.88em;line-height:1.35;background:rgba(255,255,255,.16);border:1px solid rgba(255,255,255,.14);align-self:flex-start">${e(b.text)}</div>`
        : `<div style="max-width:84%;padding:.6em .85em;border-radius:1.1em;border-bottom-right-radius:.3em;font-size:.88em;line-height:1.35;background:#fff;color:#0b2f52;align-self:flex-end">${e(b.text)}</div>`,
    )
    .join("");

  return `
<section${st.id ? ` id="${st.id}"` : ""} data-scene="${key}" data-accent="${st.accent}" data-atmos="${st.atmos}" data-base-vh="${st.baseVh}" data-screen-label="${st.label}" style="position:relative;z-index:1;height:${st.baseVh}vh;background:${st.bg}">
  <div data-pin style="position:sticky;top:0;height:100svh;overflow:hidden;display:flex;align-items:center;justify-content:center">
    <div data-stage style="position:relative;width:min(1100px,96vw);height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:clamp(12px,2.4vh,28px);padding:clamp(58px,9vh,86px) 12px clamp(30px,5vh,52px)">
      <div data-cap style="position:relative;display:grid;width:min(700px,94vw);text-align:center;pointer-events:none;z-index:9;flex:0 0 auto">${layers}
      </div>
${chips}
      <div data-phone style="position:relative;flex:0 0 auto;width:min(46vw,270px,calc((63svh - 12px) * 270 / 558));height:auto;aspect-ratio:270/558;container-type:inline-size;background:#0b1b2b;border-radius:clamp(28px,6vw,40px);padding:clamp(8px,1.8vw,12px);box-shadow:0 40px 90px rgba(10,30,60,.35);z-index:5;font-size:clamp(8px,4.8cqw,13px);will-change:transform">
        <div style="position:absolute;top:clamp(8px,1.8vw,12px);left:50%;transform:translateX(-50%);width:7.4em;height:1.7em;background:#0b1b2b;border-radius:0 0 1em 1em;z-index:6"></div>
        <div style="position:relative;width:100%;height:100%;border-radius:clamp(20px,4.6vw,30px);overflow:hidden;background:#0e2033">
          <div data-reel style="position:absolute;inset:0;will-change:transform">
            <div style="${screenBox("0", st.screens[0])}">
              ${loc(s.screen1.location)}
              <div style="font-size:3.85em;font-weight:600;letter-spacing:-.03em;line-height:1;margin:.06em 0 .02em">${e(s.screen1.temp)}</div>
              <div style="font-size:.92em;opacity:.85;margin-bottom:.9em">${e(s.screen1.condition)}</div>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:.55em">${slots}</div>
            </div>
            <div style="${screenBox("100%", st.screens[1])}">
              ${loc(s2.header)}
              ${ring}
              <div style="text-align:center;font-weight:600;font-size:1.08em${hasRing ? "" : ";margin-top:.9em"}">${e(s2.title)}</div>
              ${s2.note ? `<div style="font-size:.85em;opacity:.85;text-align:center;margin:.4em .3em .8em;line-height:1.3">${e(s2.note)}</div>` : ""}
              ${cards}
            </div>
            <div style="${screenBox("200%", st.screens[2])}">
              ${loc(s.screen3.header)}
              <div style="display:flex;flex-direction:column;gap:.55em;margin-top:.5em">${bubbles}</div>
            </div>
          </div>
        </div>
      </div>
      <div data-dots style="display:flex;gap:8px;z-index:8;flex:0 0 auto">
        <i style="width:22px;height:7px;border-radius:4px;background:${st.accent};transition:all .3s"></i>
        <i style="width:7px;height:7px;border-radius:50%;background:#d2d2d7;transition:all .3s"></i>
        <i style="width:7px;height:7px;border-radius:50%;background:#d2d2d7;transition:all .3s"></i>
      </div>
    </div>
  </div>
</section>`;
}

export const LANDING_CSS = `
  .hm-landing *{margin:0;padding:0;box-sizing:border-box}
  html{-webkit-text-size-adjust:100%;scroll-behavior:smooth}
  body{margin:0;overflow-x:hidden;-webkit-font-smoothing:antialiased;background:#fff;color:#1d1d1f;line-height:1.5;
       font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","Segoe UI",Helvetica,Arial,sans-serif;color-scheme:light}
  .hm-landing a{color:#0071e3;text-decoration:none}
  .hm-landing ::selection{background:rgba(0,113,227,.18)}
  .hm-nav-link:hover{opacity:1!important}
  .hm-nav-cta:hover,.hm-cta:hover{background:#0059b8!important;color:#fff!important}
  .hm-cta:hover{transform:scale(1.03)}
  /* JS açıksa reveal öğeleri ilk karede gizli başlar (motor sonra açar); böylece
     sunucudan gelen içerik görünüp kaybolup yeniden belirmez. */
  .hm-js .hm-landing [data-reveal]{opacity:0;transform:translateY(30px)}
  @media (prefers-reduced-motion:reduce){.hm-js .hm-landing [data-reveal]{opacity:1;transform:none}}
  @keyframes bob{0%,100%{transform:translateY(0)}50%{transform:translateY(8px)}}
  @keyframes breeze{0%,100%{rotate:-4deg}50%{rotate:4deg}}
  @media (prefers-reduced-motion:reduce){.hm-landing *{animation-duration:.001s!important}}
  @media (max-width:600px){
    [data-celestial]{top:8%!important;right:5%!important;width:clamp(52px,13vw,84px)!important;height:clamp(52px,13vw,84px)!important}
  }
  @media (max-height:560px){
    [data-stage]{padding-top:46px!important;padding-bottom:14px!important;gap:8px!important}
    [data-capt]{font-size:clamp(17px,3.4vw,22px)!important}
    [data-caps]{font-size:11px!important}
    [data-ey]{font-size:10px!important}
    [data-phone]{width:min(46vw,270px,calc((100svh - 152px) * 270 / 558))!important}
  }
`;

export function renderLanding(c: LandingContent): string {
  const navLink = (href: string, label: string) =>
    `<a href="${href}" class="hm-nav-link" style="color:#1d1d1f;font-size:clamp(11px,2.7vw,13px);opacity:.85;white-space:nowrap">${e(label)}</a>`;

  return `
<div style="position:fixed;inset:0;z-index:0;opacity:0;transition:opacity .8s ease;pointer-events:none" data-atmos-root>
  <div data-sky style="position:absolute;inset:0;background:linear-gradient(to bottom,#7ec8f0,#d7f0ff);transition:background 1.2s ease"></div>
  <div data-ambient style="position:absolute;inset:0;background:rgba(255,255,255,0);transition:background 1.2s ease"></div>
  <div data-celestial style="position:absolute;top:12%;right:14%;width:clamp(64px,12vw,120px);height:clamp(64px,12vw,120px);border-radius:50%;background:#fff3b0;box-shadow:0 0 60px 20px rgba(255,240,150,.6);transition:all 1.2s ease"></div>
  <canvas data-particles aria-hidden="true" style="position:absolute;inset:0;width:100%;height:100%"></canvas>
  <div data-flash style="position:absolute;inset:0;background:#fff;opacity:0;transition:opacity .08s linear"></div>
  <svg data-meadow viewBox="0 0 1200 320" preserveAspectRatio="xMidYMax slice" aria-hidden="true" style="position:absolute;bottom:0;left:0;width:100%;height:min(32vh,280px);opacity:0;transform:translateY(40px);transition:opacity 1.4s ease,transform 1.4s cubic-bezier(.22,1,.36,1)"></svg>
</div>

<nav style="position:fixed;top:0;left:0;right:0;z-index:200;min-height:52px;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px clamp(12px,4vw,40px);background:rgba(255,255,255,.72);backdrop-filter:saturate(180%) blur(20px);-webkit-backdrop-filter:saturate(180%) blur(20px);border-bottom:1px solid rgba(0,0,0,.06)">
  <div style="display:flex;align-items:center;gap:clamp(7px,1.6vw,11px);min-width:0">
    <img src="/assets/havamania-logo.png" alt="Havamania" style="height:clamp(20px,5vw,28px);width:auto;display:block;flex:0 0 auto">
    <span style="width:1px;height:20px;background:#d2d2d7;flex:0 0 auto"></span>
    <img src="/assets/altikod-logo.png" alt="Altıkod Digital Solutions" style="height:clamp(18px,4.4vw,25px);width:auto;display:block;border-radius:6px;flex:0 0 auto;box-shadow:0 2px 8px rgba(240,80,60,.28)">
  </div>
  <div style="display:flex;align-items:center;gap:clamp(10px,2.6vw,24px);flex:0 0 auto">
    ${navLink("#panel", "Panel")}
    ${navLink("#faz2", "Faz 2")}
    <a href="#premium" class="hm-nav-cta" style="background:#0071e3;color:#fff;padding:6px clamp(11px,3vw,15px);border-radius:999px;font-size:clamp(11px,2.7vw,13px);font-weight:500;white-space:nowrap">${e(c.nav.ctaLabel)}</a>
  </div>
</nav>

<header style="position:relative;z-index:1;min-height:100svh;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:clamp(96px,16vh,130px) clamp(18px,5vw,24px) clamp(48px,8vh,70px);background:linear-gradient(180deg,#fbfbfd,#eef3f8)">
  <div data-reveal style="color:#0071e3;font-size:clamp(16px,2.4vw,24px);font-weight:600;margin-bottom:6px">${e(c.hero.kicker)}</div>
  <h1 data-reveal data-delay="1" style="font-size:clamp(31px,8.4vw,86px);font-weight:600;letter-spacing:-.03em;line-height:1.06;max-width:15ch;text-wrap:balance;background:linear-gradient(180deg,#1d1d1f,#3a3a3c);-webkit-background-clip:text;background-clip:text;color:transparent">${e(c.hero.title)}</h1>
  <p data-reveal data-delay="2" style="font-size:clamp(15px,2.6vw,25px);color:${INK_MUTED};margin-top:14px;max-width:34ch;text-wrap:pretty">${e(c.hero.subtitle)}</p>
  <div data-reveal data-delay="3" style="margin-top:clamp(28px,6vh,44px);color:${INK_MUTED};font-size:13px;animation:bob 2s infinite">${e(c.hero.hint)}</div>
</header>
${scene("core", c.scenes.core)}

<section id="faz2" data-screen-label="Faz 2" style="position:relative;z-index:1;min-height:70svh;display:flex;align-items:center;justify-content:center;text-align:center;padding:clamp(64px,12vh,90px) clamp(18px,5vw,24px);background:linear-gradient(180deg,#0b1b2b,#132a44);color:#fff">
  <div style="max-width:760px;margin:0 auto">
    <div data-reveal style="display:inline-block;background:rgba(125,180,255,.16);color:#7db4ff;border:1px solid rgba(125,180,255,.3);padding:5px 14px;border-radius:999px;font-size:clamp(12px,2.6vw,13px);font-weight:600;margin-bottom:20px">${e(c.phase2.badge)}</div>
    <h2 data-reveal data-delay="1" style="font-size:clamp(26px,6vw,52px);font-weight:600;letter-spacing:-.03em;line-height:1.09;color:#fff;max-width:16ch;margin:0 auto;text-wrap:balance">${e(c.phase2.title)}</h2>
    <p data-reveal data-delay="2" style="font-size:clamp(15px,2.6vw,24px);color:rgba(255,255,255,.72);max-width:44ch;margin:18px auto 0;line-height:1.4;text-wrap:pretty">${e(c.phase2.text)}</p>
  </div>
</section>
${scene("agro", c.scenes.agro)}
${scene("fly", c.scenes.fly)}

<section style="position:relative;z-index:1;background:#f5f5f7">
  <div style="padding:clamp(64px,12vh,140px) clamp(18px,5vw,24px);max-width:760px;margin:0 auto;text-align:center">
    <div data-reveal style="font-size:13px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:#0071e3;margin-bottom:14px">${e(c.assistant.eyebrow)}</div>
    <h2 data-reveal data-delay="1" style="font-size:clamp(26px,6vw,52px);font-weight:600;letter-spacing:-.03em;line-height:1.09;text-wrap:balance">${e(c.assistant.title)}</h2>
    <p data-reveal data-delay="2" style="font-size:clamp(15px,2.6vw,24px);color:${INK_MUTED};margin-top:18px;line-height:1.4;text-wrap:pretty">${e(c.assistant.text)}</p>
  </div>
</section>

<section id="premium" data-screen-label="Premium" style="position:relative;z-index:1;padding:clamp(72px,14vh,150px) clamp(18px,5vw,24px);text-align:center;background:linear-gradient(180deg,#f5f5f7,#ebebef)">
  <div style="max-width:760px;margin:0 auto">
    <h2 data-reveal style="font-size:clamp(26px,6vw,52px);font-weight:600;letter-spacing:-.03em;line-height:1.09">${e(c.premium.title)}</h2>
    <p data-reveal data-delay="1" style="font-size:clamp(15px,2.6vw,24px);color:${INK_MUTED};margin-top:18px;line-height:1.4;text-wrap:pretty">${e(c.premium.text)}</p>
  </div>
  <div data-reveal data-delay="2" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(220px,100%),1fr));gap:clamp(12px,2.5vw,18px);max-width:900px;margin:clamp(32px,6vh,50px) auto 0">
    ${c.premium.cards
      .map(
        (p) =>
          `<div style="background:#fff;border:1px solid #d2d2d7;border-radius:20px;padding:clamp(20px,4vw,26px) clamp(18px,4vw,24px);text-align:left"><span aria-hidden="true" style="font-size:26px;display:block;margin-bottom:12px">${e(p.icon)}</span><h3 style="font-size:clamp(16px,3.4vw,18px);font-weight:600;margin-bottom:6px">${e(p.title)}</h3><p style="font-size:clamp(13px,2.6vw,14px);color:${INK_MUTED}">${e(p.text)}</p></div>`,
      )
      .join("\n    ")}
  </div>
  <div style="display:flex;justify-content:center">
    <a href="#premium" class="hm-cta" data-reveal data-delay="3" style="display:inline-flex;align-items:center;justify-content:center;min-height:48px;background:#0071e3;color:#fff;padding:14px clamp(22px,5vw,30px);border-radius:999px;font-size:clamp(15px,3.2vw,17px);font-weight:500;margin-top:clamp(28px,6vh,44px);transition:transform .2s">${e(c.premium.ctaLabel)}</a>
  </div>
</section>

<footer style="position:relative;z-index:1;background:#f5f5f7;padding:clamp(32px,6vh,44px) clamp(18px,5vw,24px);text-align:center;border-top:1px solid #d2d2d7">
  <div style="display:flex;align-items:center;justify-content:center;gap:11px;margin-bottom:14px;flex-wrap:wrap">
    <img src="/assets/havamania-logo.png" alt="Havamania" style="height:clamp(24px,6vw,34px);width:auto;display:block">
    <span style="width:1px;height:20px;background:#d2d2d7"></span>
    <img src="/assets/altikod-logo.png" alt="Altıkod Digital Solutions" style="height:clamp(22px,5.4vw,31px);width:auto;display:block;border-radius:7px;box-shadow:0 2px 8px rgba(240,80,60,.28)">
  </div>
  <p style="font-size:clamp(12px,2.6vw,13px);color:${INK_MUTED};max-width:52ch;margin:0 auto 6px;text-wrap:pretty">${e(c.footer.tagline)}</p>
  <p style="font-size:11px;color:${INK_MUTED};opacity:.7;margin-top:14px">${e(c.footer.copyright)}</p>
</footer>`;
}
