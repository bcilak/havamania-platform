import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { askFingerprint, canonicalAsk, canonicalize, decideExisting, fingerprintSecret, REQUEST_STALE_MS, REQUEST_TTL_MS, staleRetryAfter, type RequestRow } from "./request-id";
import { askSchema, type AskInput } from "./schema";

const SECRET = "test-secret-1";
/** Geçerli sağlık rızası var (health_sensitivities modele girer). */
const OK = { health: true };
const NO_HEALTH = { health: false };

function ask(extra: Record<string, unknown> = {}): AskInput {
  return askSchema.parse({
    user_id: "u1",
    question: "Yarın Ankara'da hava nasıl?",
    consent_version: 3,
    request_id: "6F1C0000-0000-4000-8000-000000000001",
    ...extra,
  });
}

const withWeather = (maxC: number) => ({
  context: {
    city: "Ankara",
    weather_data: {
      observed_at: "2026-10-28T14:30:00+03:00",
      timezone: "Europe/Istanbul",
      forecast: [{ date: "2026-10-28", min_c: 10, max_c: maxC }],
    },
  },
});

describe("canonicalize", () => {
  it("anahtarları derin sıralar ve null/undefined alanları atar", () => {
    assert.equal(JSON.stringify(canonicalize({ b: 1, a: { d: null, c: 2, e: undefined } })), '{"a":{"c":2},"b":1}');
  });

  it("dizi sırasını korur; dizideki null konumunu bozmaz", () => {
    assert.equal(JSON.stringify(canonicalize({ a: [{ z: 1, y: null }, null, 3] })), '{"a":[{"z":1},null,3]}');
    assert.notEqual(JSON.stringify(canonicalize([1, 2])), JSON.stringify(canonicalize([2, 1])));
  });

  it("ilkel değerleri olduğu gibi döner", () => {
    assert.equal(canonicalize("x"), "x");
    assert.equal(canonicalize(5), 5);
    assert.equal(canonicalize(false), false);
  });
});

describe("askFingerprint", () => {
  const base = askFingerprint(ask(withWeather(19)), SECRET, OK);

  it("kanonik biçim sürüm alanını içerir ve sıralıdır", () => {
    assert.ok(canonicalAsk(ask(), OK).endsWith(',"v":1}'));
    assert.ok(canonicalAsk(ask(), OK).startsWith('{"health_consent":false,'));
  });

  it("aynı girdi aynı özeti verir", () => {
    assert.equal(askFingerprint(ask(withWeather(19)), SECRET, OK), base);
  });

  it("anahtar sırası ve null/eksik alan farkı özeti değiştirmez", () => {
    const a = askSchema.parse({ user_id: "u1", consent_version: 3, question: "Merhaba", context: { city: "Ankara", weather: null, profile: null } });
    const b = askSchema.parse({ context: { city: "Ankara" }, question: "Merhaba", consent_version: 3, user_id: "u1", tone: null, conversation_id: null });
    assert.equal(askFingerprint(a, SECRET, OK), askFingerprint(b, SECRET, OK));
  });

  it("varsayılanlar açıkça verilenle aynı özeti verir (mode, personalization, health_consent)", () => {
    assert.equal(askFingerprint(ask(), SECRET, OK), askFingerprint(ask({ mode: "genel", personalization: true, health_consent: false }), SECRET, OK));
    assert.equal(askFingerprint(ask(), SECRET, OK), askFingerprint(ask({ personalization: null, health_consent: null }), SECRET, OK));
  });

  it("conversation_id büyük/küçük harf farkı özeti değiştirmez", () => {
    const id = "AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE";
    assert.equal(askFingerprint(ask({ conversation_id: id }), SECRET, OK), askFingerprint(ask({ conversation_id: id.toLowerCase() }), SECRET, OK));
  });

  it("yanıtı etkileyen alanlar özeti değiştirir (ikişer ikişer farklı)", () => {
    const changed: Record<string, Record<string, unknown>> = {
      question: { question: "Başka soru" },
      mode: { mode: "agro" },
      conversation_id: { conversation_id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee" },
      tone: { tone: "resmi" },
      personalization: { personalization: false },
      health_consent: { health_consent: true },
      health_consent_version: { health_consent_version: 2 },
      "context.weather_data.forecast[0].max_c": withWeather(20),
      "context.city": { context: { city: "İzmir" } },
      "context.trips": { context: { trips: "Antalya 3 gün" } },
    };
    const seen = new Set([base]);
    for (const [name, extra] of Object.entries(changed)) {
      const h = askFingerprint(ask(extra), SECRET, OK);
      assert.notEqual(h, base, `${name} özeti değiştirmeli`);
      assert.ok(!seen.has(h), `${name} özeti başka bir değişiklikle çakışmamalı`);
      seen.add(h);
    }
  });

  describe("etkin bağlam (modele giren)", () => {
    const withProfile = (profile: Record<string, unknown>) => ask({ context: { city: "Ankara", profile } });
    const fp = (input: AskInput, eff = OK) => askFingerprint(input, SECRET, eff);

    it("sağlık rızası geçerli değilse health_sensitivities değişince parmak izi aynı kalır", () => {
      const a = withProfile({ interest: "bağ", health_sensitivities: "polen" });
      const b = withProfile({ interest: "bağ", health_sensitivities: "astım" });
      const c = withProfile({ interest: "bağ" });
      assert.equal(fp(a, NO_HEALTH), fp(b, NO_HEALTH));
      assert.equal(fp(a, NO_HEALTH), fp(c, NO_HEALTH));
      // Rıza geçerliyse model sağlık metnini görür: parmak izi değişir.
      assert.notEqual(fp(a, OK), fp(b, OK));
      assert.notEqual(fp(a, OK), fp(c, OK));
      // Aynı gövde rızalı/rızasız farklı etkin bağlam üretir (rıza sürümü arada değişirse tekrar 422 olur).
      assert.notEqual(fp(a, OK), fp(a, NO_HEALTH));
    });

    it("rızasız parmak izi sağlık metnini içermez; diğer profil alanları yine sayılır", () => {
      const a = withProfile({ interest: "bağ", health_sensitivities: "polen" });
      assert.ok(!canonicalAsk(a, NO_HEALTH).includes("polen"));
      assert.ok(canonicalAsk(a, OK).includes("polen"));
      assert.notEqual(fp(withProfile({ interest: "bağ" }), NO_HEALTH), fp(withProfile({ interest: "bahçe" }), NO_HEALTH));
    });

    it("yalnızca sağlık alanından oluşan profil, profil hiç yokmuş gibi sayılır (rızasız)", () => {
      const only = withProfile({ health_sensitivities: "polen" });
      const none = ask({ context: { city: "Ankara" } });
      assert.equal(fp(only, NO_HEALTH), fp(none, NO_HEALTH));
      assert.notEqual(fp(only, OK), fp(none, OK));
    });

    it("personalization:false iken profile ve trips değişince parmak izi aynı kalır; city/weather_data yine sayılır", () => {
      const mk = (profile: Record<string, unknown>, trips: string, city = "Ankara", personalization: boolean | null = false) =>
        ask({ personalization, context: { city, trips, profile } });
      const base = mk({ interest: "bağ", health_sensitivities: "polen" }, "Antalya 3 gün");
      assert.equal(fp(base, OK), fp(mk({ interest: "bahçe", health_sensitivities: "astım" }, "İzmir"), OK));
      assert.ok(!canonicalAsk(base, OK).includes("Antalya") && !canonicalAsk(base, OK).includes("polen") && !canonicalAsk(base, OK).includes("bağ"));
      assert.notEqual(fp(base, OK), fp(mk({ interest: "bağ" }, "Antalya 3 gün", "İzmir"), OK));
      // personalization açıkken (varsayılan) profil ve trips sayılır.
      assert.notEqual(fp(mk({ interest: "bağ" }, "Antalya 3 gün", "Ankara", null), OK), fp(mk({ interest: "bahçe" }, "Antalya 3 gün", "Ankara", null), OK));
      assert.notEqual(fp(mk({ interest: "bağ" }, "Antalya", "Ankara", true), OK), fp(mk({ interest: "bağ" }, "İzmir", "Ankara", true), OK));
    });

    it("context yoksa ya da profilsiz bağlamda eski davranış", () => {
      assert.equal(fp(ask(), NO_HEALTH), fp(ask(), OK));
      assert.equal(fp(ask({ context: { city: "Ankara", trips: "x" } }), NO_HEALTH), fp(ask({ context: { city: "Ankara", trips: "x" } }), OK));
    });
  });

  it("question ham metin olarak sayılır (boşluk farkı özeti değiştirir)", () => {
    assert.notEqual(askFingerprint(ask({ question: "Merhaba" }), SECRET, OK), askFingerprint(ask({ question: "Merhaba " }), SECRET, OK));
  });

  it("yanıtı etkilemeyen alanlar özeti değiştirmez", () => {
    assert.equal(askFingerprint(ask({ ...withWeather(19), client: { platform: "ios", app_version: "9.9.9" } }), SECRET, OK), base);
    assert.equal(askFingerprint(ask({ ...withWeather(19), consent_version: 4 }), SECRET, OK), base);
    assert.equal(askFingerprint(ask({ ...withWeather(19), language: "tr" }), SECRET, OK), base);
    assert.equal(askFingerprint(ask({ ...withWeather(19), user_id: "baska", request_id: "6f1c0000-0000-4000-8000-000000000002" }), SECRET, OK), base);
  });

  it("koordinatlar şemada atıldığı için özete girmez", () => {
    const withCoords = withWeather(19);
    (withCoords.context.weather_data as Record<string, unknown>).location = { name: "Ankara", lat: 39.92512, lon: 32.8 };
    const noCoords = withWeather(19);
    (noCoords.context.weather_data as Record<string, unknown>).location = { name: "Ankara" };
    assert.equal(askFingerprint(ask(withCoords), SECRET, OK), askFingerprint(ask(noCoords), SECRET, OK));
  });

  it("farklı secret farklı özet üretir; özet soru metnini içermez", () => {
    assert.notEqual(askFingerprint(ask(withWeather(19)), "baska-secret", OK), base);
    assert.ok(!base.includes("Ankara"));
    assert.match(base, /^[A-Za-z0-9_-]{43}$/);
  });
});

describe("decideExisting", () => {
  const H = "hash-a";
  const row = (status: RequestRow["status"], bodyHash = H, messageId: string | null = "m1"): RequestRow => ({ status, bodyHash, messageId });
  const young = { createdMs: 1000, updatedMs: 1000 };

  it("1) 24 saatten eski satır reclaim (created_at sıfırlanır); farklı özet reused değil", () => {
    const old = { createdMs: REQUEST_TTL_MS, updatedMs: REQUEST_TTL_MS };
    assert.deepEqual(decideExisting(row("completed"), H, old), { kind: "reclaim" });
    assert.deepEqual(decideExisting(row("completed", "baska"), H, old), { kind: "reclaim" });
    assert.deepEqual(decideExisting(row("in_progress"), H, old), { kind: "reclaim" });
  });

  it("süre dolmadan bir ms önce hâlâ geçerlidir", () => {
    assert.deepEqual(decideExisting(row("completed", "baska"), H, { createdMs: REQUEST_TTL_MS - 1, updatedMs: 0 }), { kind: "reused" });
  });

  it("2) özet farklıysa reused (durumdan bağımsız)", () => {
    for (const s of ["completed", "in_progress", "failed"] as const) {
      assert.deepEqual(decideExisting(row(s, "baska"), H, young), { kind: "reused" }, s);
    }
  });

  it("3) completed -> replay", () => {
    assert.deepEqual(decideExisting(row("completed"), H, young), { kind: "replay" });
  });

  it("3b) completed ama kayıtlı mesaj yok -> reclaim; başka mesaj için bildirim replay'i bozmaz", () => {
    assert.deepEqual(decideExisting(row("completed"), H, young, { missingMessageId: "m1" }), { kind: "reclaim" });
    assert.deepEqual(decideExisting(row("completed"), H, young, { missingMessageId: "eski" }), { kind: "replay" });
  });

  it("4) taze in_progress -> in_progress", () => {
    assert.equal(decideExisting(row("in_progress"), H, { createdMs: 5000, updatedMs: 5000 }).kind, "in_progress");
  });

  it("4) Retry-After: kalan 3 sn -> 3; yeni başlamış -> 10'a sıkışır; sınırda 1", () => {
    assert.equal(staleRetryAfter(REQUEST_STALE_MS - 3000), 3);
    assert.deepEqual(decideExisting(row("in_progress"), H, { createdMs: 0, updatedMs: REQUEST_STALE_MS - 3000 }), { kind: "in_progress", retryAfter: 3 });
    assert.deepEqual(decideExisting(row("in_progress"), H, { createdMs: 0, updatedMs: 10_000 }), { kind: "in_progress", retryAfter: 10 });
    assert.equal(staleRetryAfter(0), 10);
    assert.equal(staleRetryAfter(REQUEST_STALE_MS - 1), 1);
  });

  it("TTL sınırında işlemdeki (bayat olmayan) in_progress devralınmaz: 409; farklı özet 422", () => {
    const fresh = { createdMs: REQUEST_TTL_MS + 5000, updatedMs: 5000 };
    assert.equal(decideExisting(row("in_progress"), H, fresh).kind, "in_progress");
    assert.equal(decideExisting(row("in_progress"), H, { createdMs: REQUEST_TTL_MS, updatedMs: REQUEST_STALE_MS - 1 }).kind, "in_progress");
    assert.deepEqual(decideExisting(row("in_progress", "baska"), H, fresh), { kind: "reused" });
    // Bayatlayınca TTL dalı yeniden geçerli: devralınır.
    assert.deepEqual(decideExisting(row("in_progress"), H, { createdMs: REQUEST_TTL_MS + 5000, updatedMs: REQUEST_STALE_MS }), { kind: "reclaim" });
    // TTL'i geçmiş completed/failed satırlar eskisi gibi devralınır.
    for (const st of ["completed", "failed"] as const) assert.deepEqual(decideExisting(row(st), H, { createdMs: REQUEST_TTL_MS, updatedMs: 1000 }), { kind: "reclaim" }, st);
  });

  it("5) bayat in_progress -> reclaim", () => {
    assert.deepEqual(decideExisting(row("in_progress"), H, { createdMs: REQUEST_STALE_MS, updatedMs: REQUEST_STALE_MS }), { kind: "reclaim" });
  });

  it("5) failed -> reclaim", () => {
    assert.deepEqual(decideExisting(row("failed"), H, young), { kind: "reclaim" });
  });

  it("öncelik: failed + farklı özet reused, süresi dolmuş failed reclaim", () => {
    assert.deepEqual(decideExisting(row("failed", "baska"), H, young), { kind: "reused" });
    assert.deepEqual(decideExisting(row("failed", "baska"), H, { createdMs: REQUEST_TTL_MS + 1, updatedMs: 1 }), { kind: "reclaim" });
  });
});

describe("fingerprintSecret", () => {
  const original = process.env.ENCRYPTION_KEY;
  afterEach(() => {
    if (original === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = original;
  });

  it("ana anahtarın kendisi değil, HKDF alt anahtarıdır (32 bayt, Buffer)", () => {
    const master = Buffer.alloc(32, 9);
    process.env.ENCRYPTION_KEY = master.toString("base64");
    const k = fingerprintSecret();
    assert.ok(Buffer.isBuffer(k));
    assert.equal(k.length, 32);
    assert.ok(!k.equals(master) && !k.toString("base64").includes(master.toString("base64")));
    assert.ok(fingerprintSecret().equals(k));
  });

  it("özet alt anahtarla hesaplanır: ana anahtarla hesaplanandan farklıdır, ana anahtar değişince özet değişir", () => {
    const master = Buffer.alloc(32, 9);
    process.env.ENCRYPTION_KEY = master.toString("base64");
    const withDerived = askFingerprint(ask(), fingerprintSecret(), OK);
    assert.notEqual(withDerived, askFingerprint(ask(), master, OK));
    process.env.ENCRYPTION_KEY = Buffer.alloc(32, 10).toString("base64");
    assert.notEqual(askFingerprint(ask(), fingerprintSecret(), OK), withDerived);
  });

  it("anahtar eksik ya da 32 bayt değilse hata fırlatır", () => {
    delete process.env.ENCRYPTION_KEY;
    assert.throws(() => fingerprintSecret(), /ENCRYPTION_KEY/);
    process.env.ENCRYPTION_KEY = Buffer.alloc(8).toString("base64");
    assert.throws(() => fingerprintSecret(), /32 bayt/);
  });
});
