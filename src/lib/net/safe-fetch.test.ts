import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, it } from "node:test";
import { assertPublicUrl, isBlockedIp, parsePublicUrl, pinnedGet, safeFetchText, SafeFetchError, type LookupFn } from "./safe-fetch";

// Ortamdaki gevşetme testleri etkilemesin.
delete (process.env as Record<string, string | undefined>).ALLOW_LOCAL_TARGETS;

const PUBLIC_IP = "93.184.216.34";
const publicLookup: LookupFn = async () => [{ address: PUBLIC_IP, family: 4 }];
const rejects = (p: Promise<unknown>, re?: RegExp) => assert.rejects(p, (e) => e instanceof SafeFetchError && (!re || re.test(e.message)));

describe("isBlockedIp", () => {
  it("özel, loopback, link-local, CGNAT ve metadata IPv4 adreslerini engeller", () => {
    for (const ip of ["127.0.0.1", "127.255.0.9", "10.0.0.5", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "100.127.255.255", "0.0.0.0", "224.0.0.1", "255.255.255.255", "198.18.0.1"]) {
      assert.equal(isBlockedIp(ip), true, ip);
    }
  });

  it("herkese açık IPv4 adreslerine izin verir", () => {
    for (const ip of ["93.184.216.34", "8.8.8.8", "1.1.1.1", "172.15.255.255", "172.32.0.1", "100.63.255.255", "100.128.0.1", "169.253.0.1"]) {
      assert.equal(isBlockedIp(ip), false, ip);
    }
  });

  it("IPv6 loopback, ULA, link-local, multicast ve IPv4-eşlemeli adresleri engeller", () => {
    for (const ip of ["::1", "::", "fc00::1", "fd12:3456::1", "fe80::1", "fe80::1%eth0", "ff02::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:8.8.8.8", "[::1]", "64:ff9b::7f00:1", "2002:7f00:1::1", "::127.0.0.1"]) {
      assert.equal(isBlockedIp(ip), true, ip);
    }
  });

  it("herkese açık IPv6 adreslerine izin verir", () => {
    for (const ip of ["2606:4700:4700::1111", "2001:4860:4860::8888"]) assert.equal(isBlockedIp(ip), false, ip);
  });

  it("geçersiz girdiyi engeller", () => {
    for (const ip of ["", "abc", "999.1.1.1", "1.2.3"]) assert.equal(isBlockedIp(ip), true, ip);
  });
});

describe("parsePublicUrl", () => {
  const bad = (url: string, re?: RegExp) =>
    assert.throws(() => parsePublicUrl(url, []), (e) => e instanceof SafeFetchError && (!re || re.test(e.message)), url);

  it("iç ağ adreslerini reddeder", () => {
    for (const u of [
      "http://127.0.0.1",
      "http://localhost",
      "http://LOCALHOST./x",
      "http://foo.localhost",
      "http://169.254.169.254/latest/meta-data",
      "http://[::1]",
      "http://10.0.0.5",
      "http://0x7f000001",
      "http://2130706433",
      "http://127.1",
      "http://[::ffff:127.0.0.1]",
      "http://[fd00::1]/",
      "http://100.64.0.1",
      "http://intranet.internal",
    ]) {
      bad(u, /iç ağa/);
    }
  });

  it("kimlik bilgisi, şema ve bağlantı noktasını reddeder", () => {
    bad("http://user:pass@example.com", /kullanıcı adı/);
    bad("http://user@example.com", /kullanıcı adı/);
    bad("http://example.com:8080", /bağlantı noktaları/);
    bad("ftp://example.com", /http ve https/);
    bad("file:///etc/passwd", /http ve https/);
    bad("javascript:alert(1)", /http ve https/);
    bad("not a url", /Geçerli bir web adresi/);
  });

  it("genel adreslere izin verir", () => {
    assert.equal(parsePublicUrl("https://example.com/a?b=1", []).hostname, "example.com");
    assert.equal(parsePublicUrl("http://example.com:80/", []).hostname, "example.com");
    assert.equal(parsePublicUrl("https://example.com:443/", []).hostname, "example.com");
    assert.equal(parsePublicUrl("http://93.184.216.34/", []).hostname, "93.184.216.34");
  });

  it("izin listesi yalnızca verilen ana makineyi açar", () => {
    assert.doesNotThrow(() => parsePublicUrl("http://127.0.0.1:3199/x", ["127.0.0.1"]));
    assert.throws(() => parsePublicUrl("http://127.0.0.2:3199/x", ["127.0.0.1"]), SafeFetchError);
  });

  it("port kuralı: yerel gevşetme kapalıyken 127.0.0.1:3199 reddedilir, açıkken loopback için gevşer", () => {
    assert.throws(() => parsePublicUrl("http://127.0.0.1:3199/x", [], false), /bağlantı noktaları/);
    assert.doesNotThrow(() => parsePublicUrl("http://127.0.0.1:3199/x", [], true));
    assert.doesNotThrow(() => parsePublicUrl("http://localhost:3199/x", [], true));
    assert.doesNotThrow(() => parsePublicUrl("http://[::1]:3199/x", [], true));
    // loopback dışı hedefler gevşetmeden etkilenmez
    assert.throws(() => parsePublicUrl("http://example.com:3199/", [], true), /bağlantı noktaları/);
    assert.throws(() => parsePublicUrl("http://10.0.0.5/", [], true), /iç ağa/);
    assert.throws(() => parsePublicUrl("http://intranet.internal/", [], true), /iç ağa/);
  });

  it("gevşetme açıkken bile metadata/link-local ve şema kuralı geçerli", () => {
    assert.throws(() => parsePublicUrl("http://169.254.169.254/latest/meta-data", [], true), /iç ağa/);
    assert.throws(() => parsePublicUrl("http://169.254.169.254:3199/", [], true), /bağlantı noktaları/);
    assert.throws(() => parsePublicUrl("http://[fe80::1]/", [], true), /iç ağa/);
    assert.throws(() => parsePublicUrl("ftp://127.0.0.1/", [], true), /http ve https/);
    assert.throws(() => parsePublicUrl("file:///etc/passwd", [], true), /http ve https/);
    assert.throws(() => parsePublicUrl("http://u:p@127.0.0.1/", [], true), /kullanıcı adı/);
  });

  it("ortam: değişken + localhost APP_URL ile varsayılan gevşer; değişken yoksa veya APP_URL canlıysa katı", () => {
    const env = process.env as Record<string, string | undefined>;
    const before = { f: env.ALLOW_LOCAL_TARGETS, a: env.APP_URL };
    try {
      env.APP_URL = "http://localhost:3110";
      env.ALLOW_LOCAL_TARGETS = "1";
      assert.doesNotThrow(() => parsePublicUrl("http://127.0.0.1:3199/x"));
      delete env.ALLOW_LOCAL_TARGETS;
      assert.throws(() => parsePublicUrl("http://127.0.0.1:3199/x"), SafeFetchError);
      env.ALLOW_LOCAL_TARGETS = "1";
      env.APP_URL = "https://havamania.com";
      assert.throws(() => parsePublicUrl("http://127.0.0.1:3199/x"), SafeFetchError);
      assert.throws(() => parsePublicUrl("http://localhost/x"), SafeFetchError);
    } finally {
      for (const [k, v] of [["ALLOW_LOCAL_TARGETS", before.f], ["APP_URL", before.a]] as const) {
        if (v === undefined) delete env[k];
        else env[k] = v;
      }
    }
  });
});

describe("DNS doğrulaması", () => {
  it("adlardan biri bile özel adrese çözülürse reddeder (DNS rebinding)", async () => {
    const mixed: LookupFn = async () => [
      { address: PUBLIC_IP, family: 4 },
      { address: "169.254.169.254", family: 4 },
    ];
    await rejects(assertPublicUrl("https://evil.example.com", { lookup: mixed, allowHosts: [] }), /iç ağa/);
    await rejects(assertPublicUrl("https://evil.example.com", { lookup: async () => [{ address: "::ffff:10.0.0.1", family: 6 }], allowHosts: [] }), /iç ağa/);
  });

  it("çözümlenemeyen adı sızıntısız mesajla reddeder", async () => {
    const fail: LookupFn = async () => {
      throw new Error("getaddrinfo ENOTFOUND secret.internal 10.1.2.3");
    };
    await assert.rejects(
      assertPublicUrl("https://x.example.com", { lookup: fail, allowHosts: [] }),
      (e: Error) => e instanceof SafeFetchError && !/10\.1\.2\.3|ENOTFOUND/.test(e.message),
    );
  });

  it("yerel gevşetme: localhost yalnızca loopback'e çözülürse geçer, iç ağa çözülürse reddedilir", async () => {
    const to = (address: string): LookupFn => async () => [{ address, family: address.includes(":") ? 6 : 4 }];
    const o = { allowHosts: [], allowLocal: true };
    assert.equal((await assertPublicUrl("http://localhost:3199/x", { ...o, lookup: to("127.0.0.1") })).hostname, "localhost");
    assert.equal((await assertPublicUrl("http://127.0.0.1:3199/x", o)).hostname, "127.0.0.1");
    await rejects(assertPublicUrl("http://app.localhost:3199/", { ...o, lookup: to("169.254.169.254") }), /iç ağa/);
    await rejects(assertPublicUrl("http://app.localhost:3199/", { ...o, lookup: to("10.0.0.5") }), /iç ağa/);
    await rejects(assertPublicUrl("http://localhost:3199/", { allowHosts: [], allowLocal: false, lookup: to("127.0.0.1") }), /bağlantı noktaları/);
  });

  it("herkese açık adrese çözülen ana makineyi kabul eder", async () => {
    const u = await assertPublicUrl("https://example.com/x", { lookup: publicLookup, allowHosts: [] });
    assert.equal(u.hostname, "example.com");
  });
});

/*
 * Yerel sunucu 127.0.0.1'de dinler. Sahte DNS ana makineyi herkese açık bir IP'ye
 * çözer (doğrulama bu IP'yi görür), `dialAddress` ise soketi yerel sunucuya yönlendirir.
 * "public.test" izin listesine yalnızca standart olmayan test portu için eklenir;
 * yönlendirme hedefleri (127.0.0.1) listede olmadığından engellenir.
 */
describe("safeFetchText (yerel sunucuyla)", () => {
  let server: http.Server | undefined;
  afterEach(() => new Promise<void>((r) => (server ? server.close(() => r()) : r())));

  const serve = async (handler: http.RequestListener) => {
    server = http.createServer(handler);
    await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
    return (server.address() as AddressInfo).port;
  };
  const opts = (over: Record<string, unknown> = {}) => ({
    lookup: publicLookup,
    allowHosts: ["public.test"],
    dialAddress: () => "127.0.0.1",
    timeoutMs: 3000,
    ...over,
  });

  it("herkese açık IP'ye çözülüp 302 ile 127.0.0.1'e yönlenen adresi reddeder", async () => {
    let hits = 0;
    const port = await serve((_req, res) => {
      hits++;
      res.writeHead(302, { location: "http://127.0.0.1/secret" });
      res.end();
    });
    await rejects(safeFetchText(`http://public.test:${port}/`, opts()), /iç ağa/);
    assert.equal(hits, 1, "yönlendirme hedefine istek atılmamalı");
  });

  it("metadata adresine yönlendirmeyi reddeder", async () => {
    const port = await serve((_req, res) => {
      res.writeHead(307, { location: "http://169.254.169.254/latest/meta-data/" });
      res.end();
    });
    await rejects(safeFetchText(`http://public.test:${port}/`, opts()), /iç ağa/);
  });

  it("DNS rebinding: doğrulanan IP'ye bağlanır, ikinci çözümleme yapılmaz", async () => {
    let lookups = 0;
    const port = await serve((_req, res) => {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end("<html><title>Merhaba</title></html>");
    });
    const seen: string[] = [];
    const out = await safeFetchText(
      `http://public.test:${port}/`,
      opts({
        lookup: async () => {
          lookups++;
          return [{ address: PUBLIC_IP, family: 4 }];
        },
        dialAddress: (pinned: string) => {
          seen.push(pinned);
          return "127.0.0.1";
        },
      }),
    );
    assert.ok(out.text.includes("Merhaba"));
    assert.equal(lookups, 1);
    assert.deepEqual(seen, [PUBLIC_IP]);
  });

  it("yönlendirmeyi en fazla 3 adım izler", async () => {
    const port = await serve((req, res) => {
      const n = Number(new URL(req.url!, "http://x").searchParams.get("n") ?? 0);
      res.writeHead(302, { location: `/?n=${n + 1}` });
      res.end();
    });
    await rejects(safeFetchText(`http://public.test:${port}/`, opts()), /yönlendirme/);
  });

  it("izinli yönlendirmeyi izler ve içeriği döner", async () => {
    const port = await serve((req, res) => {
      if (req.url === "/a") {
        res.writeHead(301, { location: "/b" });
        return res.end();
      }
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("hedef sayfa");
    });
    const out = await safeFetchText(`http://public.test:${port}/a`, opts());
    assert.equal(out.text, "hedef sayfa");
    assert.ok(out.finalUrl.endsWith("/b"));
  });

  it("6 MB gövdeyi 5 MB sınırında keser ve hata verir", async () => {
    const port = await serve((_req, res) => {
      res.writeHead(200, { "content-type": "text/html" });
      const chunk = Buffer.alloc(64 * 1024, 97);
      let sent = 0;
      const write = () => {
        while (sent < 6 * 1024 * 1024) {
          sent += chunk.length;
          if (!res.write(chunk)) return void res.once("drain", write);
        }
        res.end();
      };
      write();
    });
    await rejects(safeFetchText(`http://public.test:${port}/`, opts({ timeoutMs: 8000 })), /5 MB/);
  });

  it("Content-Length 5 MB'ı aşıyorsa gövde okunmadan reddeder", async () => {
    const port = await serve((_req, res) => {
      res.writeHead(200, { "content-type": "text/html", "content-length": String(6 * 1024 * 1024) });
      res.write("x");
    });
    await rejects(safeFetchText(`http://public.test:${port}/`, opts()), /5 MB/);
  });

  it("desteklenmeyen içerik türünü ve 404'ü reddeder", async () => {
    const port = await serve((req, res) => {
      if (req.url === "/img") {
        res.writeHead(200, { "content-type": "image/png" });
        return res.end("x");
      }
      res.writeHead(404, { "content-type": "text/html" });
      res.end("yok");
    });
    await rejects(safeFetchText(`http://public.test:${port}/img`, opts()), /içerik türü/);
    await rejects(safeFetchText(`http://public.test:${port}/yok`, opts()), /404/);
  });

  it("yanıt vermeyen sunucuda zaman aşımı verir", async () => {
    const port = await serve(() => {
      /* yanıt yok */
    });
    await rejects(safeFetchText(`http://public.test:${port}/`, opts({ timeoutMs: 300 })), /zamanında/);
  });

  it("sıkıştırılmış yanıtı reddeder", async () => {
    const port = await serve((_req, res) => {
      res.writeHead(200, { "content-type": "text/html", "content-encoding": "gzip" });
      res.end("x");
    });
    await rejects(safeFetchText(`http://public.test:${port}/`, opts()), /sıkıştırılmış/);
  });
});

/*
 * pinnedGet: veri API'si için doğrulanmış IP'ye sabitli tek istek. Adres hiç çözülmez
 * ("api.test" çözümlenemez bir ad); soket verilen IP'ye gider.
 */
describe("pinnedGet", () => {
  let server: http.Server | undefined;
  afterEach(() => new Promise<void>((r) => (server ? server.close(() => r()) : r())));

  const serve = async (handler: http.RequestListener) => {
    server = http.createServer(handler);
    await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
    return (server.address() as AddressInfo).port;
  };

  it("adı çözmeden verilen IP'ye bağlanır; özel başlığı taşır ve JSON gövdeyi döner", async () => {
    let seen: http.IncomingHttpHeaders = {};
    const port = await serve((req, res) => {
      seen = req.headers;
      res.writeHead(200, { "content-type": "application/json" });
      res.end('{"ok":true}');
    });
    const out = await pinnedGet(new URL(`http://api.invalid:${port}/v1/x?q=a`), "127.0.0.1", { headers: { "X-Api-Key": "gizli", Accept: "application/json" } });
    assert.deepEqual(out, { status: 200, text: '{"ok":true}' });
    assert.equal(seen["x-api-key"], "gizli");
    assert.equal(seen.accept, "application/json");
    assert.equal(seen.host, `api.invalid:${port}`);
  });

  it("yönlendirmeyi izlemez, 2xx dışı durumları hatasız döner", async () => {
    let hits = 0;
    const port = await serve((req, res) => {
      hits++;
      if (req.url === "/moved") res.writeHead(302, { location: "http://127.0.0.1:1/baska" });
      else res.writeHead(503);
      res.end();
    });
    assert.deepEqual(await pinnedGet(new URL(`http://api.invalid:${port}/moved`), "127.0.0.1"), { status: 302, text: "" });
    assert.deepEqual(await pinnedGet(new URL(`http://api.invalid:${port}/down`), "127.0.0.1"), { status: 503, text: "" });
    assert.equal(hits, 2);
  });

  it("gövde sınırını aşınca too_large, yanıtsızlıkta timeout türünde hata verir", async () => {
    const port = await serve((req, res) => {
      if (req.url === "/big") {
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(Buffer.alloc(4096, 97));
      }
      // /slow: yanıt hiç gelmez
    });
    await assert.rejects(pinnedGet(new URL(`http://api.invalid:${port}/big`), "127.0.0.1", { maxBytes: 1024 }), (e) => e instanceof SafeFetchError && e.kind === "too_large");
    await assert.rejects(pinnedGet(new URL(`http://api.invalid:${port}/slow`), "127.0.0.1", { timeoutMs: 200 }), (e) => e instanceof SafeFetchError && e.kind === "timeout");
  });
});
