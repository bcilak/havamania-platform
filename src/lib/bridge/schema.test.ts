import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BRIDGE_LIMITS, parseAsk, parseDeleteUser, parseFeedback, toClientContext } from "./schema";

const base = { user_id: "u-1", question: "Yarın hava nasıl?", consent_version: 2 };
const UUID = "123e4567-e89b-42d3-a456-426614174000";

const ask = (extra: Record<string, unknown> = {}) => parseAsk({ ...base, ...extra });
const code = (r: ReturnType<typeof ask>) => (r.ok ? "ok" : r.code);

describe("ask: yapı (400)", () => {
  it("en küçük geçerli istek varsayılanları doldurur", () => {
    const r = ask();
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.equal(r.value.mode, "genel");
    assert.deepEqual(r.value.client, { platform: "android" });
    assert.equal(r.value.context, undefined);
  });

  it("zorunlu alanlar eksikse 400", () => {
    for (const k of ["user_id", "question", "consent_version"]) {
      const body: Record<string, unknown> = { ...base };
      delete body[k];
      const r = parseAsk(body);
      assert.deepEqual([r.ok, !r.ok && r.code, !r.ok && r.field], [false, "invalid_request", k]);
    }
    assert.equal(code(parseAsk(null)), "invalid_request");
    assert.equal(code(parseAsk("x")), "invalid_request");
    assert.equal(code(parseAsk([])), "invalid_request");
  });

  it("yanlış enum ve tür 400", () => {
    assert.equal(code(ask({ mode: "x" })), "invalid_request");
    assert.equal(code(ask({ tone: "x" })), "invalid_request");
    assert.equal(code(ask({ client: { platform: "web" } })), "invalid_request");
    assert.equal(code(ask({ consent_version: "2" })), "invalid_request");
    assert.equal(code(ask({ consent_version: 0 })), "invalid_request");
    assert.equal(code(ask({ consent_version: 1.5 })), "invalid_request");
    assert.equal(code(ask({ question: 5 })), "invalid_request");
    assert.equal(code(ask({ context: "x" })), "invalid_request");
    assert.equal(code(ask({ context: { weather: 5 } })), "invalid_request");
  });

  it("izinli enum değerleri geçer; tone ve conversation_id null olabilir", () => {
    for (const mode of ["genel", "agro", "fly"]) assert.equal(code(ask({ mode })), "ok");
    for (const tone of ["samimi", "resmi", "dengeli", "kisa", "uzman", null]) assert.equal(code(ask({ tone })), "ok");
    assert.equal(code(ask({ conversation_id: null })), "ok");
    assert.equal(code(ask({ client: { platform: "ios", app_version: "1.2.3" } })), "ok");
  });

  it("boş ya da yalnızca boşluktan oluşan soru 400", () => {
    assert.equal(code(ask({ question: "" })), "invalid_request");
    assert.equal(code(ask({ question: " \n\t " })), "invalid_request");
    // Kırpılmaz: baştaki boşluk korunur.
    const r = ask({ question: "  merhaba " });
    assert.ok(r.ok && r.value.question === "  merhaba ");
  });

  it("language yalnızca tr", () => {
    assert.equal(code(ask({ language: "tr" })), "ok");
    assert.equal(code(ask({ language: "en" })), "invalid_request");
  });

  it("conversation_id UUID olmalı", () => {
    assert.equal(code(ask({ conversation_id: UUID })), "ok");
    assert.equal(code(ask({ conversation_id: "abc" })), "invalid_request");
    assert.equal(code(ask({ conversation_id: "" })), "invalid_request");
  });

  it("user_id: kontrol karakteri, 129 karakter ve boş 400; 128 karakter ve Türkçe geçer", () => {
    assert.equal(code(ask({ user_id: "a\nb" })), "invalid_request");
    assert.equal(code(ask({ user_id: "a\tb" })), "invalid_request");
    assert.equal(code(ask({ user_id: "a​b" })), "invalid_request");
    assert.equal(code(ask({ user_id: "a\u0000b" })), "invalid_request");
    assert.equal(code(ask({ user_id: "" })), "invalid_request");
    assert.equal(code(ask({ user_id: "a".repeat(129) })), "invalid_request");
    assert.equal(code(ask({ user_id: "a".repeat(128) })), "ok");
    assert.equal(code(ask({ user_id: "Şükrü-İ_1" })), "ok");
    // Kırpılmaz: boşluk geçerli karakterdir.
    const r = ask({ user_id: " u " });
    assert.ok(r.ok && r.value.user_id === " u ");
  });

  it("app_version en çok 40 karakter (400)", () => {
    assert.equal(code(ask({ client: { app_version: "v".repeat(40) } })), "ok");
    assert.equal(code(ask({ client: { app_version: "v".repeat(41) } })), "invalid_request");
  });

  it("bilinmeyen alanlar yok sayılır", () => {
    const r = ask({ yeni_alan: 1, context: { city: "Ankara", yeni: 2, profile: { interest: "a", bilinmeyen: "b" } }, client: { x: 1 } });
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.ok(!("yeni_alan" in r.value));
    assert.deepEqual(r.value.context, { city: "Ankara", profile: { interest: "a" } });
    assert.deepEqual(r.value.client, { platform: "android" });
  });
});

describe("ask: uzunluk sınırları (413)", () => {
  const L = BRIDGE_LIMITS;
  const at = (n: number, ch = "a") => ch.repeat(n);

  it("soru: 4000 geçer, 4001 too_large (kırpılmaz)", () => {
    assert.equal(code(ask({ question: at(L.question) })), "ok");
    assert.equal(code(ask({ question: at(L.question + 1) })), "too_large");
    // Ham uzunluk: boşluklar da sayılır.
    assert.equal(code(ask({ question: `${at(L.question)} ` })), "too_large");
  });

  it("city, weather, trips ve profil alanları sınırda geçer, +1'de too_large", () => {
    const fields: [string, number][] = [
      ["city", L.city],
      ["weather", L.weather],
      ["trips", L.trips],
    ];
    for (const [f, max] of fields) {
      assert.equal(code(ask({ context: { [f]: at(max) } })), "ok", f);
      assert.equal(code(ask({ context: { [f]: at(max + 1) } })), "too_large", f);
    }
    for (const f of ["interest", "health_sensitivities", "travel_preferences", "activity_types"]) {
      assert.equal(code(ask({ context: { profile: { [f]: at(L.profileField) } } })), "ok", f);
      assert.equal(code(ask({ context: { profile: { [f]: at(L.profileField + 1) } } })), "too_large", f);
    }
  });

  it("tür hatası uzunluk hatasından önce 400 verir", () => {
    assert.equal(code(ask({ question: at(L.question + 1), mode: "x" })), "invalid_request");
  });

  it("bağlam toplamı bayt cinsinden ölçülür (Türkçe karakter 2 bayt)", () => {
    // Her alan kendi karakter sınırının içinde; toplam bayt 8192'yi aşar.
    const wide = { city: at(L.city, "ş"), weather: at(L.weather, "ş"), trips: at(L.trips, "ş") };
    assert.ok(Buffer.byteLength(JSON.stringify(wide)) > L.contextBytes);
    assert.equal(code(ask({ context: wide })), "too_large");
    // Aynı karakter sayısı ASCII ise bayt sınırının altındadır.
    const ascii = { city: at(L.city), weather: at(L.weather), trips: at(L.trips) };
    assert.ok(Buffer.byteLength(JSON.stringify(ascii)) <= L.contextBytes);
    assert.equal(code(ask({ context: ascii })), "ok");
  });

  it("bağlam tam 8192 baytta geçer, +1 bayt too_large", () => {
    // ASCII ile 8192 baytlık sınıra ulaşılamaz (en çok ~6 KB); sınır çok baytlı karakterle denenir.
    const fixed = Buffer.byteLength(JSON.stringify({ city: "", weather: "", trips: "" }));
    const cityBytes = L.contextBytes - fixed - 2 * 2 * L.weather;
    assert.ok(cityBytes > 0 && cityBytes <= 2 * L.city);
    const city = at(Math.floor(cityBytes / 2), "ş") + (cityBytes % 2 ? "a" : "");
    const mk = (c: string) => ({ city: c, weather: at(L.weather, "ş"), trips: at(L.trips, "ş") });
    assert.equal(Buffer.byteLength(JSON.stringify(mk(city))), L.contextBytes);
    assert.equal(code(ask({ context: mk(city) })), "ok");
    assert.equal(code(ask({ context: mk(`${city}a`) })), "too_large");
  });
});

describe("toClientContext", () => {
  const parsed = () => {
    const r = ask({ context: { city: "Ankara", profile: { health_sensitivities: "polen", interest: "bağ" } } });
    assert.ok(r.ok);
    return r.ok ? r.value.context : undefined;
  };

  it("sağlık rızası varsa (health: true) sağlık hassasiyetleri dahil profil alanlarını taşır", () => {
    assert.deepEqual(toClientContext(parsed(), { health: true }), {
      city: "Ankara",
      weather: undefined,
      trips: undefined,
      profile: { interest: "bağ", health_sensitivities: "polen", travel_preferences: undefined, activity_types: undefined },
    });
    assert.equal(toClientContext(undefined, { health: true }), undefined);
  });

  it("sağlık rızası yoksa (varsayılan) health_sensitivities hata vermeden düşer", () => {
    for (const out of [toClientContext(parsed()), toClientContext(parsed(), { health: false })]) {
      assert.equal(out?.city, "Ankara");
      assert.equal(out?.profile?.interest, "bağ");
      assert.ok(!("health_sensitivities" in (out?.profile ?? {})));
      assert.ok(!JSON.stringify(out).includes("polen"));
    }
  });
});

describe("ask: sağlık rızası alanları ve null değerler", () => {
  it("health_consent ve health_consent_version isteğe bağlı; yoksa, null ya da true/false geçerli", () => {
    assert.equal(code(ask({})), "ok");
    assert.equal(code(ask({ health_consent: true, health_consent_version: 1 })), "ok");
    assert.equal(code(ask({ health_consent: false })), "ok");
    assert.equal(code(ask({ health_consent: null, health_consent_version: null })), "ok");
    assert.equal(code(ask({ health_consent: "evet" })), "invalid_request");
    assert.equal(code(ask({ health_consent_version: 0 })), "invalid_request");
  });

  it("context.* ve profile.* alanları null olabilir; null alan yok sayılır", () => {
    const r = ask({ context: { city: null, weather: "güneşli", trips: null, profile: { interest: null, health_sensitivities: null, travel_preferences: "doğa", activity_types: null } } });
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.deepEqual(toClientContext(r.value.context, { health: true }), {
      city: undefined,
      weather: "güneşli",
      trips: undefined,
      profile: { interest: undefined, health_sensitivities: undefined, travel_preferences: "doğa", activity_types: undefined },
    });
    assert.equal(code(ask({ context: { profile: null } })), "ok");
    assert.equal(code(ask({ context: null })), "ok");
  });

  it("null alanlar bayt sınırına ve uzunluk denetimine sayılmaz, çökmez", () => {
    assert.equal(code(ask({ context: { city: null, profile: { interest: null } } })), "ok");
    assert.equal(code(ask({ context: { profile: { interest: "a".repeat(BRIDGE_LIMITS.profileField + 1), health_sensitivities: null } } })), "too_large");
  });
});

describe("delete-user ve feedback şemaları", () => {
  it("delete-user: user_id kuralları aynı", () => {
    assert.equal(parseDeleteUser({ user_id: "u" }).ok, true);
    assert.equal(parseDeleteUser({}).ok, false);
    assert.equal(parseDeleteUser({ user_id: "a\nb" }).ok, false);
    assert.equal(parseDeleteUser({ user_id: "a".repeat(129) }).ok, false);
  });

  it("feedback: rating 1 ya da -1, message_id UUID", () => {
    const f = (o: Record<string, unknown>) => parseFeedback({ user_id: "u", message_id: UUID, rating: 1, ...o });
    assert.equal(f({}).ok, true);
    assert.equal(f({ rating: -1 }).ok, true);
    for (const rating of [0, 2, "1", null]) {
      const r = f({ rating });
      assert.ok(!r.ok && r.code === "invalid_request", String(rating));
    }
    assert.ok(!f({ message_id: "x" }).ok);
  });

  it("feedback: comment 1000 geçer, 1001 too_large (kırpılmaz)", () => {
    const f = (comment: string) => parseFeedback({ user_id: "u", message_id: UUID, rating: -1, comment });
    assert.equal(f("a".repeat(1000)).ok, true);
    const over = f("a".repeat(1001));
    assert.ok(!over.ok && over.code === "too_large");
  });
});
