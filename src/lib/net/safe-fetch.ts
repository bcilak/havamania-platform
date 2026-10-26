import dns from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { isLoopbackAddress, isLoopbackHost, localTargetsAllowed } from "./local-targets";

/*
 * Yönetici girdisi bir URL'yi sunucudan çekerken SSRF'e karşı korur: yalnızca
 * herkese açık adreslere bağlanır, bağlantıyı doğrulanan IP'ye sabitler
 * (DNS rebinding), her yönlendirmeyi yeniden doğrular, gövdeyi ve süreyi sınırlar.
 * Hata iletileri Türkçe ve iç ayrıntı sızdırmaz.
 */

/** `kind`: çağıranın hatayı sınıflaması için (iletiyi ayrıştırmadan). */
export class SafeFetchError extends Error {
  constructor(
    message: string,
    readonly kind: "timeout" | "too_large" | "other" = "other",
  ) {
    super(message);
  }
}

export const MAX_BYTES = 5 * 1024 * 1024;
const TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 3;
const ALLOWED_TYPES = ["text/html", "text/plain", "application/xhtml+xml"];
const BLOCKED_NAME_RE = /(^|\.)(localhost|local|internal|localdomain)$/;

/* ---------- IP sınıflandırma (saf) ---------- */

function ipv4ToInt(ip: string): number | null {
  const p = ip.split(".");
  if (p.length !== 4) return null;
  let n = 0;
  for (const part of p) {
    if (!/^\d{1,3}$/.test(part) || Number(part) > 255) return null;
    n = n * 256 + Number(part);
  }
  return n;
}

// [taban, önek uzunluğu]
const BLOCKED_V4: [string, number][] = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10], // CGNAT
  ["127.0.0.0", 8],
  ["169.254.0.0", 16], // link-local, bulut metadata
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // ayrılmış + yayın
];

function ipv6ToBig(ip: string): bigint | null {
  let s = ip.split("%")[0].toLowerCase();
  // Sondaki noktalı IPv4 (::ffff:1.2.3.4) iki gruba çevrilir.
  const tail = s.match(/^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (tail) {
    const v4 = ipv4ToInt(tail[2]);
    if (v4 === null) return null;
    s = `${tail[1]}${(v4 >>> 16).toString(16)}:${(v4 & 0xffff).toString(16)}`;
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 1 ? head.length !== 8 : missing < 1) return null;
  const groups = halves.length === 1 ? head : [...head, ...Array(missing).fill("0"), ...rest];
  let n = BigInt(0);
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    n = (n << BigInt(16)) | BigInt(`0x${g}`);
  }
  return n;
}

const v6 = (ip: string) => ipv6ToBig(ip) as bigint;
const BLOCKED_V6: [bigint, number][] = [
  [v6("::"), 96], // ::, ::1 ve IPv4-uyumlu adresler
  [v6("::ffff:0:0"), 96], // IPv4-eşlemeli
  [v6("64:ff9b::"), 96], // NAT64
  [v6("64:ff9b:1::"), 48],
  [v6("100::"), 64], // discard
  [v6("2001::"), 32], // Teredo
  [v6("2001:db8::"), 32],
  [v6("2002::"), 16], // 6to4
  [v6("fc00::"), 7], // ULA
  [v6("fe80::"), 10], // link-local
  [v6("fec0::"), 10], // site-local
  [v6("ff00::"), 8], // multicast
];

/** IP literal'i iç ağ / özel / ayrılmış bir bloktaysa true. Geçersiz girdi de engellenir. */
export function isBlockedIp(ip: string): boolean {
  const clean = ip.replace(/^\[|\]$/g, "");
  const kind = net.isIP(clean.split("%")[0]);
  if (kind === 4) {
    const n = ipv4ToInt(clean);
    if (n === null) return true;
    return BLOCKED_V4.some(([base, bits]) => {
      const shift = 32 - bits;
      return Math.floor(n / 2 ** shift) === Math.floor((ipv4ToInt(base) as number) / 2 ** shift);
    });
  }
  if (kind === 6) {
    const n = ipv6ToBig(clean);
    if (n === null) return true;
    return BLOCKED_V6.some(([base, bits]) => n >> BigInt(128 - bits) === base >> BigInt(128 - bits));
  }
  return true;
}

/* ---------- URL doğrulama ---------- */

export type LookupFn = (hostname: string) => Promise<{ address: string; family: number }[]>;

const defaultLookup: LookupFn = (hostname) => dns.lookup(hostname, { all: true, verbatim: true });

export type SafeFetchOptions = {
  maxBytes?: number;
  timeoutMs?: number;
  maxRedirects?: number;
  userAgent?: string;
  /** Ana makine adı çözümleyici (testte sahte). */
  lookup?: LookupFn;
  /** Engelden muaf ana makineler (yalnızca test). Ortamdan okunmaz. */
  allowHosts?: string[];
  /** Loopback hedeflere izin. Varsayılan: local-targets.ts kararı (ALLOW_LOCAL_TARGETS + localhost APP_URL). */
  allowLocal?: boolean;
  /** Yalnızca test: doğrulanan IP yerine gerçekte bağlanılacak adres. */
  dialAddress?: (pinned: string) => string;
};

const hostOf = (u: URL) => u.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();

/** Adresin şekli: şema, kimlik bilgisi, bağlantı noktası, yerel isim. Ağa çıkmaz. */
export function parsePublicUrl(raw: string, allow: string[] = [], allowLocal: boolean = localTargetsAllowed()): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SafeFetchError("Geçerli bir web adresi girin (https://…).");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new SafeFetchError("Yalnızca http ve https adresleri eklenebilir.");
  if (url.username || url.password) throw new SafeFetchError("Adreste kullanıcı adı veya parola olamaz.");
  const host = hostOf(url);
  if (!host) throw new SafeFetchError("Geçerli bir web adresi girin (https://…).");
  if (allow.includes(host)) return url;
  // Gevşetme açıkken yalnızca loopback; port ve http serbest. Metadata/özel ağ engelli kalır.
  if (allowLocal && isLoopbackHost(host)) return url;
  if (url.port && url.port !== "80" && url.port !== "443") {
    throw new SafeFetchError("Yalnızca standart bağlantı noktaları (80, 443) kullanılabilir.");
  }
  if (net.isIP(host) ? isBlockedIp(host) : BLOCKED_NAME_RE.test(host)) {
    throw new SafeFetchError("Bu adres iç ağa işaret ediyor, eklenemez.");
  }
  return url;
}

/** Ana makineyi çözer; adreslerden biri bile engelliyse reddeder. Bağlanılacak IP'yi döner. */
export async function resolvePublicHost(url: URL, opts: Pick<SafeFetchOptions, "lookup" | "allowHosts" | "allowLocal"> = {}): Promise<{ address: string; family: 4 | 6 }> {
  const host = hostOf(url);
  const allowed = (opts.allowHosts ?? []).includes(host);
  const local = (opts.allowLocal ?? localTargetsAllowed()) && isLoopbackHost(host);
  const literal = net.isIP(host);
  let addrs: { address: string; family: number }[];
  if (literal) {
    addrs = [{ address: host, family: literal }];
  } else {
    try {
      addrs = await (opts.lookup ?? defaultLookup)(host);
    } catch {
      throw new SafeFetchError("Adres çözümlenemedi.");
    }
  }
  if (!addrs.length) throw new SafeFetchError("Adres çözümlenemedi.");
  // Loopback izni yalnızca gerçekten loopback'e çözülen adlar için geçerlidir (ad -> iç ağ kaçışı yok).
  if (local && !addrs.every((a) => isLoopbackAddress(a.address))) throw new SafeFetchError("Bu adres iç ağa işaret ediyor, eklenemez.");
  if (!allowed && !local && addrs.some((a) => isBlockedIp(a.address))) throw new SafeFetchError("Bu adres iç ağa işaret ediyor, eklenemez.");
  const first = addrs[0];
  return { address: first.address, family: first.family === 6 ? 6 : 4 };
}

/** Ekleme anında hızlı doğrulama: şekil + DNS. */
export async function assertPublicUrl(raw: string, opts: SafeFetchOptions = {}): Promise<URL> {
  const allow = opts.allowHosts ?? [];
  const allowLocal = opts.allowLocal ?? localTargetsAllowed();
  const url = parsePublicUrl(raw, allow, allowLocal);
  await resolvePublicHost(url, { lookup: opts.lookup, allowHosts: allow, allowLocal });
  return url;
}

/* ---------- İstek ---------- */

type Hop = { status: number; location: string | null; type: string; charset?: string; body: Buffer };

type RequestOpts = Required<Pick<SafeFetchOptions, "maxBytes" | "userAgent">> & {
  signal: AbortSignal;
  dial: string;
  /** Ek istek başlıkları (küçük harfe çevrilip varsayılanların üzerine yazar). */
  headers?: Record<string, string>;
  /** İçerik türü denetimi yok (JSON API). */
  anyType?: boolean;
  /** 2xx dışı durumlar hata atmaz; gövdesiz döner (yönlendirmeler dahil, izlenmez). */
  passStatus?: boolean;
};

function requestOnce(url: URL, o: RequestOpts): Promise<Hop> {
  return new Promise((resolve, reject) => {
    const mod = url.protocol === "https:" ? https : http;
    const req = mod.request(
      url,
      {
        method: "GET",
        signal: o.signal,
        headers: {
          "user-agent": o.userAgent,
          accept: "text/html,text/plain,application/xhtml+xml",
          "accept-encoding": "identity",
          ...Object.fromEntries(Object.entries(o.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v])),
        },
        // Bağlantı, doğrulanmış IP'ye sabit: ikinci bir DNS sorgusu yapılmaz (rebinding).
        lookup: (_host, options, cb) => {
          const entry = { address: o.dial, family: net.isIP(o.dial) };
          if (options && (options as { all?: boolean }).all) (cb as unknown as (e: null, a: unknown) => void)(null, [entry]);
          else cb(null, entry.address, entry.family);
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const location = typeof res.headers.location === "string" ? res.headers.location : null;
        const ctype = String(res.headers["content-type"] ?? "");
        const type = ctype.split(";")[0].trim().toLowerCase();
        const charset = /charset=([^;\s]+)/i.exec(ctype)?.[1]?.replace(/["']/g, "");
        if (o.passStatus && (status < 200 || status >= 300)) {
          res.resume();
          return resolve({ status, location, type, body: Buffer.alloc(0) });
        }
        if (status >= 300 && status < 400 && location) {
          res.resume();
          return resolve({ status, location, type, body: Buffer.alloc(0) });
        }
        if (status < 200 || status >= 300) {
          res.resume();
          return reject(new SafeFetchError(`Sayfa ${status} döndü.`));
        }
        if (!o.anyType && !ALLOWED_TYPES.includes(type)) {
          res.resume();
          return reject(new SafeFetchError("Desteklenmeyen içerik türü. Yalnızca HTML ve düz metin sayfaları eklenebilir."));
        }
        const enc = String(res.headers["content-encoding"] ?? "identity").toLowerCase();
        if (enc !== "identity") {
          res.resume();
          return reject(new SafeFetchError("Sayfa desteklenmeyen biçimde sıkıştırılmış."));
        }
        const len = Number(res.headers["content-length"]);
        if (Number.isFinite(len) && len > o.maxBytes) {
          res.destroy();
          return reject(new SafeFetchError("Sayfa 5 MB sınırını aşıyor.", "too_large"));
        }
        const chunks: Buffer[] = [];
        let total = 0;
        res.on("data", (c: Buffer) => {
          total += c.length;
          if (total > o.maxBytes) {
            reject(new SafeFetchError("Sayfa 5 MB sınırını aşıyor.", "too_large"));
            req.destroy();
            return;
          }
          chunks.push(c);
        });
        res.on("end", () => resolve({ status, location: null, type, charset, body: Buffer.concat(chunks) }));
        res.on("error", () =>
          reject(o.signal.aborted ? new SafeFetchError("Sayfa zamanında yanıt vermedi.", "timeout") : new SafeFetchError("Sayfa okunurken bağlantı koptu.")),
        );
      },
    );
    req.on("error", (e) => {
      if (e instanceof SafeFetchError) return reject(e);
      if (o.signal.aborted) return reject(new SafeFetchError("Sayfa zamanında yanıt vermedi.", "timeout"));
      reject(new SafeFetchError("Adrese ulaşılamadı."));
    });
    req.end();
  });
}

function decode(body: Buffer, charset?: string): string {
  try {
    return new TextDecoder(charset || "utf-8").decode(body);
  } catch {
    return new TextDecoder("utf-8").decode(body);
  }
}

/**
 * Sayfayı güvenli biçimde metin olarak çeker. Yönlendirmeler elle izlenir ve her
 * adımda yeniden doğrulanır. Dönen `finalUrl` son adrestir.
 */
export async function safeFetchText(rawUrl: string, opts: SafeFetchOptions = {}): Promise<{ text: string; finalUrl: string }> {
  const maxBytes = opts.maxBytes ?? MAX_BYTES;
  const maxRedirects = opts.maxRedirects ?? MAX_REDIRECTS;
  const allow = opts.allowHosts ?? [];
  const allowLocal = opts.allowLocal ?? localTargetsAllowed();
  const signal = AbortSignal.timeout(opts.timeoutMs ?? TIMEOUT_MS);
  let current = rawUrl;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const url = parsePublicUrl(current, allow, allowLocal);
    const pinned = await resolvePublicHost(url, { lookup: opts.lookup, allowHosts: allow, allowLocal });
    const res = await requestOnce(url, {
      maxBytes,
      userAgent: opts.userAgent ?? "HavamaniaBot/1.0 (+bilgi tabani)",
      signal,
      dial: opts.dialAddress ? opts.dialAddress(pinned.address) : pinned.address,
    }).catch((e) => {
      throw e instanceof SafeFetchError ? e : new SafeFetchError("Adrese ulaşılamadı.");
    });
    if (res.location) {
      try {
        current = new URL(res.location, url).toString();
      } catch {
        throw new SafeFetchError("Geçersiz yönlendirme.");
      }
      continue;
    }
    return { text: decode(res.body, res.charset), finalUrl: url.toString() };
  }
  throw new SafeFetchError("Çok fazla yönlendirme.");
}

/**
 * Veri API'si için tek istek: bağlantı, çağıranın zaten doğruladığı IP'ye (`dial`) sabitlenir;
 * ikinci bir DNS sorgusu yapılmaz (rebinding). Yönlendirme izlenmez (3xx durum olarak döner,
 * özel başlık ve anahtar başka adrese gitmez), içerik türü denetlenmez, gövde `maxBytes`
 * ile ve tüm istek `timeoutMs` ile sınırlıdır. 2xx dışı durumlar hata atmaz.
 */
export async function pinnedGet(
  url: URL,
  dial: string,
  opts: { headers?: Record<string, string>; timeoutMs?: number; maxBytes?: number; userAgent?: string } = {},
): Promise<{ status: number; text: string }> {
  const res = await requestOnce(url, {
    maxBytes: opts.maxBytes ?? MAX_BYTES,
    userAgent: opts.userAgent ?? "HavamaniaPlatform/1.0",
    signal: AbortSignal.timeout(opts.timeoutMs ?? TIMEOUT_MS),
    dial,
    headers: opts.headers,
    anyType: true,
    passStatus: true,
  }).catch((e) => {
    throw e instanceof SafeFetchError ? e : new SafeFetchError("Adrese ulaşılamadı.");
  });
  return { status: res.status, text: decode(res.body, res.charset) };
}
