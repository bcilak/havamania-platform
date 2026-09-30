/** Web siteleri için gömme betiği: <script src=".../widget.js" data-bot="hm_pk_..." defer></script> */
export function GET() {
  const js = `(function(){
  if (window.__havamaniaWidget) return; window.__havamaniaWidget = true;
  var s = document.currentScript; if (!s) return;
  var bot = s.getAttribute("data-bot"); if (!bot) { console.warn("Havamania: data-bot eksik"); return; }
  var origin = new URL(s.src).origin;
  var id = null;
  try { id = localStorage.getItem("hm_device"); if (!id) { id = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : "w" + Date.now() + Math.random().toString(16).slice(2); localStorage.setItem("hm_device", id); } }
  catch (e) { id = "w" + Date.now() + Math.random().toString(16).slice(2); }
  var mode = s.getAttribute("data-mode") || "genel";
  var label = s.getAttribute("data-label") || "Havamania Asistan";
  var btn = document.createElement("button");
  btn.type = "button"; btn.setAttribute("aria-label", label); btn.setAttribute("aria-expanded", "false"); btn.title = label;
  btn.style.cssText = "position:fixed;right:20px;bottom:20px;z-index:2147483000;width:56px;height:56px;border-radius:50%;border:0;background:#0071e3;color:#fff;box-shadow:0 10px 30px rgba(0,60,140,.35);cursor:pointer;display:grid;place-items:center;transition:transform .15s";
  var ICON_CHAT = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
  var ICON_CLOSE = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  btn.innerHTML = ICON_CHAT;
  var frame = null;
  function isOpen() { return frame && frame.style.display !== "none"; }
  function open() {
    if (!frame) {
      frame = document.createElement("iframe");
      frame.title = label;
      frame.allow = "clipboard-write";
      frame.src = origin + "/w/" + encodeURIComponent(bot) + "?platform=web&mode=" + encodeURIComponent(mode) + "&deviceId=" + encodeURIComponent(id);
      frame.style.cssText = "position:fixed;right:20px;bottom:88px;z-index:2147483000;width:min(400px,calc(100vw - 40px));height:min(640px,calc(100vh - 120px));border:0;border-radius:18px;box-shadow:0 20px 60px rgba(10,30,60,.3);background:#f5f5f7";
      document.body.appendChild(frame);
    } else { frame.style.display = "block"; }
    btn.innerHTML = ICON_CLOSE; btn.setAttribute("aria-expanded", "true");
    try { frame.focus(); } catch (e) {}
  }
  function close() {
    if (frame) frame.style.display = "none";
    btn.innerHTML = ICON_CHAT; btn.setAttribute("aria-expanded", "false");
    btn.focus();
  }
  btn.addEventListener("click", function(){ if (isOpen()) close(); else open(); });
  document.addEventListener("keydown", function(e){ if (e.key === "Escape" && isOpen()) close(); });
  window.addEventListener("message", function(e){ if (e.origin === origin && e.data && e.data.source === "havamania-chat" && e.data.type === "close") close(); });
  document.body.appendChild(btn);
})();`;
  return new Response(js, {
    headers: { "content-type": "application/javascript; charset=utf-8", "cache-control": "public, max-age=300" },
  });
}
