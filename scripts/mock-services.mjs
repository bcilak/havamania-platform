/*
 * Yerel geliştirme için sahte servisler (port 3199):
 *   POST /v1/chat/completions   OpenAI uyumlu model: akış, araç çağırma, kullanım bilgisi
 *   GET  /__last-chat           Son model isteğinin max_tokens / max_completion_tokens değerleri (testler için)
 *   POST /v1/embeddings         OpenAI biçiminde, kelime-hash tabanlı deterministik vektör
 *   GET  /v1/weather/current    Havamania veri API'si taklitleri
 *   GET  /v1/weather/forecast
 *   GET  /v1/agro/conditions
 *   GET  /v1/fly/route
 * Gerçek API anahtarı olmadan sohbeti uçtan uca denemek içindir. Mesajda "YAVAS"
 * geçerse cevap çok yavaş akar (Durdur düğmesini denemek için).
 * Hata enjeksiyonu: veri API'sinde q (uçuşta origin) __500 / __timeout (10 sn bekler) /
 * __badjson ise ilgili hata üretilir. Sahte model, kullanıcı mesajında "#arac:<ad>:<q>"
 * görürse o aracı o konumla çağırır (q boşsa konumsuz; örn. "#arac:current_weather:__500").
 *   node scripts/mock-services.mjs
 */
import http from "node:http";

const PORT = Number(process.env.MOCK_PORT || 3199);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let lastChat = null;

const DATA = {
  "/v1/weather/current": (q) => ({ location: q.get("q") || "Konum", temp: 24, feels_like: 25, humidity: 58, wind_kmh: 14, uv: 6, visibility_km: 40, pressure_hpa: 1012 }),
  "/v1/weather/forecast": (q) => ({ location: q.get("q") || "Konum", days: [{ day: "Yarın", min: 14, max: 26, precip_prob: 20 }, { day: "Ertesi gün", min: 15, max: 27, precip_prob: 55 }] }),
  "/v1/agro/conditions": (q) => ({ location: q.get("q") || "Tarla", crop: q.get("crop") || null, frost_risk: "düşük", soil_moisture_pct: 31, eto_mm: 3.4, spraying_windows: [{ day: "Salı", from: "06:00", to: "09:00", wind_kmh: 6, precip_prob: 0 }] }),
  "/v1/fly/route": (q) => ({ origin: q.get("origin"), destination: q.get("destination"), turbulence: [{ from: "FL300", to: "FL360", level: "orta" }], jet_stream: { level: "FL340", speed_kt: 115 }, icing: "düşük" }),
};

function pickTool(text, tools) {
  const names = tools.map((t) => t.function?.name).filter(Boolean);
  // "#arac:<ad>:<q>": o aracı o konumla çağır (hata yolu testleri). q boşsa konum verilmez.
  const forced = /#arac:(\w+):(\S*)/.exec(text);
  if (forced) {
    const [, name, q] = forced;
    if (!names.includes(name)) return null;
    if (name === "flight_weather") return { name, args: { origin: q || "LTFM", destination: "LTAC" } };
    return { name, args: q ? { location: q } : {} };
  }
  const want = /türbülans|uçuş|FL\d|rota/i.test(text)
    ? "flight_weather"
    : /ilaç|sula|don|hasat|tarla|ekin/i.test(text)
      ? "agro_conditions"
      : /yarın|hafta|tahmin/i.test(text)
        ? "forecast"
        : /hava|sıcak|yağmur|şemsiye|rüzgâr|rüzgar/i.test(text)
          ? "current_weather"
          : null;
  if (!want || !names.includes(want)) return null;
  const args =
    want === "flight_weather" ? { origin: "LTFM", destination: "LTAC", flightLevel: 350 } : want === "agro_conditions" ? { location: "Konya", crop: "buğday" } : { location: "Balıkesir" };
  return { name: want, args };
}

function textOf(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.filter((p) => p.type === "text").map((p) => p.text).join(" ");
  return "";
}

/** Aynı kelimeleri (ilk 4 harf) paylaşan metinler yüksek kosinüs alır; paylaşmayanlar ~0. */
const EMBED_DIM = 512;
const EMBED_SKIP = new Set("ve ile bir bu şu için gibi ama çok daha ne nasıl var yok mı mi mu mü".split(" "));
function embedText(text) {
  const v = new Array(EMBED_DIM).fill(0);
  const words = String(text).toLocaleLowerCase("tr-TR").split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3 && !EMBED_SKIP.has(w));
  for (const w of words) {
    let h = 2166136261;
    for (const ch of w.slice(0, 4)) h = Math.imul(h ^ ch.codePointAt(0), 16777619) >>> 0;
    v[h % EMBED_DIM] += 1;
  }
  const norm = Math.hypot(...v) || 1;
  return v.map((x) => x / norm);
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    // URL kaynağı akışını (SSRF korumalı çekim dahil) denemek için basit bir HTML sayfası.
    if (req.method === "GET" && url.pathname === "/kb-test.html") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return res.end("<html><head><title>Sahte bilgi sayfası</title></head><body><main><p>Zeytin ağaçlarında zeytinsineği mücadelesi eylül ayında başlar.</p></main></body></html>");
    }
    if (req.method === "GET" && url.pathname === "/__last-chat") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify(lastChat));
    }
    if (req.method === "GET" && DATA[url.pathname]) {
      // Hata enjeksiyonu: q (uçuşta origin) = __500 | __timeout | __badjson
      const fault = url.searchParams.get("q") ?? url.searchParams.get("origin");
      if (fault === "__500") {
        res.writeHead(500, { "content-type": "application/json" });
        return res.end(JSON.stringify({ error: "sahte sunucu hatası" }));
      }
      if (fault === "__timeout") {
        await sleep(10_000);
        if (res.destroyed) return;
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify({ late: true }));
      }
      if (fault === "__badjson") {
        res.writeHead(200, { "content-type": "application/json" });
        return res.end("<html>bakımdayız</html>");
      }
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify(DATA[url.pathname](url.searchParams)));
    }
    if (req.method === "POST" && url.pathname === "/v1/embeddings") {
      let rawEmb = "";
      for await (const c of req) rawEmb += c;
      const input = JSON.parse(rawEmb || "{}").input;
      const values = (Array.isArray(input) ? input : [input]).map((x) => (typeof x === "string" ? x : ""));
      const tokens = values.reduce((n, t) => n + Math.max(1, Math.ceil(t.length / 4)), 0);
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(
        JSON.stringify({
          object: "list",
          model: "mock-embed",
          data: values.map((t, index) => ({ object: "embedding", index, embedding: embedText(t) })),
          usage: { prompt_tokens: tokens, total_tokens: tokens },
        }),
      );
    }
    if (req.method !== "POST" || url.pathname !== "/v1/chat/completions") {
      res.writeHead(404);
      return res.end("{}");
    }
    let raw = "";
    for await (const c of req) raw += c;
    const body = JSON.parse(raw || "{}");
    lastChat = { model: body.model ?? null, max_tokens: body.max_tokens ?? null, max_completion_tokens: body.max_completion_tokens ?? null, cites: true, at: Date.now() };
    const msgs = body.messages || [];
    const last = msgs[msgs.length - 1] || {};
    const lastUser = [...msgs].reverse().find((m) => m.role === "user");
    const userText = textOf(lastUser?.content);
    const hasImage = Array.isArray(lastUser?.content) && lastUser.content.some((p) => p.type === "image_url");
    const system = textOf(msgs.find((m) => m.role === "system")?.content);
    const usage = { prompt_tokens: 420 + Math.round(system.length / 4), completion_tokens: 0, total_tokens: 0 };

    let toolCall = null;
    let reply;
    if (last.role === "tool") {
      let data = {};
      try {
        data = JSON.parse(textOf(last.content) || "{}");
      } catch {}
      reply = `Veriye baktım (**${data?.data?.location ?? data?.data?.origin ?? "konum"}**). Özet:\n- Değerler test servisinden geldi\n- Ayrıntı: https://havamania.com/sss`;
    } else {
      toolCall = body.tools?.length ? pickTool(userText, body.tools) : null;
      reply = `Test cevabı: “${userText.slice(0, 80)}” sorusunu aldım.${hasImage ? " Fotoğrafı da gördüm." : ""}\n\n1. Bu bir sahte modeldir\n2. Akış kelime kelime gelir`;
    }
    const slow = /YAVAS/.test(userText);
    // Bilgi tabanı parçası verilmişse sahte model [1] ile atıf yapar; atıf akışta bölünür ("[", "1", "].").
    const citeTail = !toolCall && last.role !== "tool" && system.includes('<kaynak no="1"') ? ["Bilgi tabanından [", "1", "]."] : [];
    const fullReply = citeTail.length ? `${reply}\n\n${citeTail.join("")}` : reply;

    const id = `mock-${Date.now()}`;
    const base = { id, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model: body.model };
    if (!body.stream) {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ ...base, object: "chat.completion", choices: [{ index: 0, message: { role: "assistant", content: fullReply }, finish_reason: "stop" }], usage: { ...usage, completion_tokens: 12 } }));
    }
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
    const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
    let closed = false;
    req.on("close", () => (closed = true));

    if (toolCall) {
      send({ ...base, choices: [{ index: 0, delta: { role: "assistant", content: null, tool_calls: [{ index: 0, id: `call_${Date.now()}`, type: "function", function: { name: toolCall.name, arguments: JSON.stringify(toolCall.args) } }] }, finish_reason: null }] });
      send({ ...base, choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] });
      usage.completion_tokens = 18;
    } else {
      const words = (slow ? `${reply} ${"uzun bir cevap devam ediyor ".repeat(12)}` : reply).split(/(\s+)/);
      send({ ...base, choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }] });
      for (const w of words) {
        if (closed) return;
        send({ ...base, choices: [{ index: 0, delta: { content: w }, finish_reason: null }] });
        usage.completion_tokens++;
        await sleep(slow ? 250 : 25);
      }
      for (const piece of citeTail.length ? ["\n\n", ...citeTail] : []) {
        if (closed) return;
        send({ ...base, choices: [{ index: 0, delta: { content: piece }, finish_reason: null }] });
        usage.completion_tokens++;
        await sleep(25);
      }
      send({ ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
    }
    usage.total_tokens = usage.prompt_tokens + usage.completion_tokens;
    send({ ...base, choices: [], usage });
    res.end("data: [DONE]\n\n");
  })
  .listen(PORT, () => console.log(`Sahte servisler http://localhost:${PORT} üzerinde`));
