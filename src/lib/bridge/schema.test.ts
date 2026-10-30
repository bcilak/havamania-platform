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

describe("ask: request_id ve personalization", () => {
  const field = (r: ReturnType<typeof ask>) => (r.ok ? undefined : r.field);

  it("request_id geçerli UUID ve null geçer; küçük harfe çevrilir", () => {
    assert.equal(code(ask({ request_id: UUID })), "ok");
    assert.equal(code(ask({ request_id: null })), "ok");
    const r = ask({ request_id: UUID.toUpperCase() });
    assert.ok(r.ok && r.value.request_id === UUID);
    const none = ask();
    assert.ok(none.ok && none.value.request_id === undefined);
  });

  it("geçersiz request_id 400 ve field=request_id", () => {
    for (const bad of ["abc", "", 5]) {
      const r = ask({ request_id: bad });
      assert.equal(code(r), "invalid_request", String(bad));
      assert.equal(field(r), "request_id");
    }
  });

  it("personalization boolean ya da null; başka tür 400", () => {
    assert.equal(code(ask({ personalization: true })), "ok");
    assert.equal(code(ask({ personalization: false })), "ok");
    assert.equal(code(ask({ personalization: null })), "ok");
    const r = ask({ personalization: "no" });
    assert.equal(code(r), "invalid_request");
    assert.equal(field(r), "personalization");
  });
});

describe("ask: context.weather_data", () => {
  const L = BRIDGE_LIMITS;
  const wd = (extra: Record<string, unknown> = {}) => ({ observed_at: "2026-10-28T14:30:00+03:00", timezone: "Europe/Istanbul", ...extra });
  const askW = (extra: Record<string, unknown> = {}) => ask({ context: { weather_data: wd(extra) } });
  const days = (n: number) => Array.from({ length: n }, (_, i) => ({ date: `2026-11-${String(i + 1).padStart(2, "0")}`, min_c: 5, max_c: 12 }));
  const fieldOf = (r: ReturnType<typeof ask>) => (r.ok ? undefined : r.field);

  it("yalnızca zorunlu alanlarla geçer; tam sözleşme örneği geçer", () => {
    assert.equal(code(askW()), "ok");
    const full = askW({
      location: { name: "Ankara" },
      current: { temp_c: 18.5, feels_like_c: 16, condition: "parçalı bulutlu", humidity_pct: 60, wind_kmh: 12, precip_mm: 0 },
      forecast: [{ date: "2026-10-28", min_c: 10, max_c: 19, condition: "güneşli", precip_prob_pct: 10 }],
      stale: false,
      source: "MGM",
    });
    assert.equal(code(full), "ok");
    assert.equal(code(ask({ context: { weather_data: null } })), "ok");
  });

  it("null alanlar kabul edilir", () => {
    const r = askW({
      location: null,
      current: { temp_c: null, feels_like_c: null, condition: null, humidity_pct: null, wind_kmh: null, precip_mm: null },
      forecast: [{ date: "2026-10-28", min_c: null, max_c: null, condition: null, precip_prob_pct: null }],
      stale: null,
      source: null,
    });
    assert.equal(code(r), "ok");
  });

  it("observed_at: offset'siz, tarihsiz ve geçersiz değerler 400", () => {
    for (const bad of ["2026-10-28T14:30:00", "2026-10-28", "2026-10-28 14:30:00+03:00", "2026-02-30T10:00:00Z", "2026-10-28T25:00:00Z", "2026-10-28T10:60:00Z", "2026-10-28T10:00:00+24:00", "dün", ""]) {
      const r = askW({ observed_at: bad });
      assert.equal(code(r), "invalid_request", bad);
      assert.equal(fieldOf(r), "context.weather_data.observed_at", bad);
    }
    for (const good of ["2026-10-28T14:30Z", "2026-10-28T14:30:15Z", "2026-10-28T14:30:15.123+03:00", "2026-10-28T14:30:00-05:30"]) {
      assert.equal(code(askW({ observed_at: good })), "ok", good);
    }
    assert.equal(fieldOf(ask({ context: { weather_data: { timezone: "UTC" } } })), "context.weather_data.observed_at");
  });

  it("timezone: bilinmeyen ya da biçimsiz ad 400", () => {
    for (const bad of ["Mars/Olympus", "", "Europe/Istanbul; drop", "+03:00", "a".repeat(65), "Europe/Istanbul\n"]) {
      const r = askW({ timezone: bad });
      assert.equal(code(r), "invalid_request", JSON.stringify(bad));
      assert.equal(fieldOf(r), "context.weather_data.timezone");
    }
    for (const good of ["Europe/Istanbul", "UTC", "America/Argentina/Buenos_Aires"]) assert.equal(code(askW({ timezone: good })), "ok", good);
  });

  it("sayı aralıkları 400: sınırda geçer, dışında hata", () => {
    const cur = (o: Record<string, unknown>) => askW({ current: o });
    for (const [k, min, max] of [
      ["temp_c", -90, 60],
      ["feels_like_c", -90, 70],
      ["humidity_pct", 0, 100],
      ["wind_kmh", 0, 500],
      ["precip_mm", 0, 2000],
    ] as const) {
      assert.equal(code(cur({ [k]: min })), "ok", k);
      assert.equal(code(cur({ [k]: max })), "ok", k);
      const lo = cur({ [k]: min - 0.5 });
      const hi = cur({ [k]: max + 0.5 });
      assert.equal(code(lo), "invalid_request", k);
      assert.equal(code(hi), "invalid_request", k);
      assert.equal(fieldOf(hi), `context.weather_data.current.${k}`);
    }
    assert.equal(fieldOf(cur({ humidity_pct: 150 })), "context.weather_data.current.humidity_pct");
    assert.equal(code(cur({ temp_c: "18" })), "invalid_request");
    const day = (o: Record<string, unknown>) => askW({ forecast: [{ date: "2026-10-28", ...o }] });
    assert.equal(code(day({ precip_prob_pct: 101 })), "invalid_request");
    assert.equal(code(day({ min_c: -91 })), "invalid_request");
    assert.equal(code(day({ max_c: 71 })), "invalid_request");
  });

  it("forecast.date: geçersiz takvim günü ve biçim 400; tekrarlı tarih 400 (field=forecast)", () => {
    for (const bad of ["2026-02-30", "2026-13-01", "28.10.2026", "2026-10-28T00:00:00Z", ""]) {
      assert.equal(code(askW({ forecast: [{ date: bad }] })), "invalid_request", bad);
    }
    assert.equal(fieldOf(askW({ forecast: [{ date: "2026-02-30" }] })), "context.weather_data.forecast.0.date");
    assert.equal(code(askW({ forecast: [{ date: "2028-02-29" }] })), "ok");
    const dup = askW({ forecast: [{ date: "2026-10-28" }, { date: "2026-10-29" }, { date: "2026-10-28" }] });
    assert.equal(code(dup), "invalid_request");
    assert.equal(fieldOf(dup), "context.weather_data.forecast");
  });

  it("forecast: boşluklu tarih 400 (field=forecast); ay/yıl sınırı ve artık gün ardışık sayılır", () => {
    const gap = askW({ forecast: [{ date: "2026-10-28" }, { date: "2026-10-30" }] });
    assert.equal(code(gap), "invalid_request");
    assert.equal(fieldOf(gap), "context.weather_data.forecast");
    // Sırasız gönderimde de boşluk yakalanır; tek gün ve ardışık günler geçer.
    assert.equal(code(askW({ forecast: [{ date: "2026-10-31" }, { date: "2026-10-28" }, { date: "2026-10-30" }] })), "invalid_request");
    assert.equal(code(askW({ forecast: [{ date: "2026-10-28" }] })), "ok");
    assert.equal(code(askW({ forecast: [{ date: "2026-10-31" }, { date: "2026-11-01" }] })), "ok");
    assert.equal(code(askW({ forecast: [{ date: "2026-12-31" }, { date: "2027-01-01" }] })), "ok");
    assert.equal(code(askW({ forecast: [{ date: "2028-02-28" }, { date: "2028-02-29" }, { date: "2028-03-01" }] })), "ok");
    assert.equal(code(askW({ forecast: [{ date: "2026-02-28" }, { date: "2026-03-01" }] })), "ok");
    // Geçersiz tarih hâlâ öğe yolunda raporlanır (boşluk denetimi onu atlar).
    assert.equal(fieldOf(askW({ forecast: [{ date: "2026-10-28" }, { date: "2026-02-30" }] })), "context.weather_data.forecast.1.date");
  });

  it("forecast: ardışık ama sırasız gönderim kabul edilir ve sıralı çıkar", () => {
    const r = askW({ forecast: [{ date: "2026-10-30", max_c: 3 }, { date: "2026-10-28", max_c: 1 }, { date: "2026-10-29", max_c: 2 }] });
    assert.equal(code(r), "ok");
    if (!r.ok) return;
    assert.deepEqual(
      toClientContext(r.value.context, { health: false })?.weatherData?.forecast?.map((d) => d.date),
      ["2026-10-28", "2026-10-29", "2026-10-30"],
    );
  });

  it("location.name zorunlu ve boş olamaz; stale boolean olmalı", () => {
    assert.equal(code(askW({ location: {} })), "invalid_request");
    assert.equal(code(askW({ location: { name: "" } })), "invalid_request");
    assert.equal(code(askW({ stale: "evet" })), "invalid_request");
    assert.equal(code(ask({ context: { weather_data: "x" } })), "invalid_request");
  });

  it("forecast: 10 gün geçer, 11 gün too_large", () => {
    assert.equal(code(askW({ forecast: days(L.forecastDays) })), "ok");
    assert.equal(code(askW({ forecast: days(L.forecastDays + 1) })), "too_large");
  });

  it("metin alanları: 100 karakter geçer, 101 too_large", () => {
    const at = (n: number) => "a".repeat(n);
    const cases: Record<string, (s: string) => Record<string, unknown>> = {
      "current.condition": (s) => ({ current: { condition: s } }),
      "forecast.condition": (s) => ({ forecast: [{ date: "2026-10-28", condition: s }] }),
      "location.name": (s) => ({ location: { name: s } }),
      source: (s) => ({ source: s }),
    };
    for (const [name, mk] of Object.entries(cases)) {
      assert.equal(code(askW(mk(at(L.weatherText)))), "ok", name);
      assert.equal(code(askW(mk(at(L.weatherText + 1)))), "too_large", name);
    }
  });

  it("weather_data bayt bütçesi: tam 4096 geçer, 4097 too_large", () => {
    const euro = "€"; // 3 bayt
    const build = (source: string) => ({
      location: { name: "Ankara" },
      current: { condition: euro.repeat(100) },
      forecast: Array.from({ length: 10 }, (_, i) => ({ date: `2026-11-${String(i + 1).padStart(2, "0")}`, condition: euro.repeat(100) })),
      source,
    });
    const bytes = (source: string) => Buffer.byteLength(JSON.stringify(wd(build(source))));
    const need = L.weatherDataBytes - bytes("");
    assert.ok(need >= 0 && need <= 3 * L.weatherText, String(need));
    // `need` bayt: 100 karakter sınırı içinde ASCII (1 bayt), "ş" (2) ve "€" (3) karışımı.
    const extra = Math.max(0, need - 100);
    const make = (n: number) => (n <= 100 ? "a".repeat(n) : "a".repeat(100 - Math.ceil(extra / 2)) + euro.repeat(Math.floor(extra / 2)) + "ş".repeat(extra % 2));
    const exact = make(need);
    assert.ok(exact.length <= L.weatherText);
    assert.equal(bytes(exact), L.weatherDataBytes);
    assert.equal(code(askW(build(exact))), "ok");
    assert.equal(code(askW(build(`${exact}a`))), "too_large");
  });

  it("weather_data eski 8192 baytlık bağlam bütçesine girmez", () => {
    const fixed = Buffer.byteLength(JSON.stringify({ city: "", weather: "", trips: "" }));
    const cityBytes = L.contextBytes - fixed - 2 * 2 * L.weather;
    const city = "ş".repeat(Math.floor(cityBytes / 2)) + (cityBytes % 2 ? "a" : "");
    const legacy = { city, weather: "ş".repeat(L.weather), trips: "ş".repeat(L.trips) };
    assert.equal(Buffer.byteLength(JSON.stringify(legacy)), L.contextBytes);
    assert.equal(code(ask({ context: legacy })), "ok");
    assert.equal(code(ask({ context: { ...legacy, weather_data: wd({ forecast: days(10), current: { condition: "güneşli" } }) } })), "ok");
    assert.equal(code(ask({ context: { ...legacy, city: `${city}a`, weather_data: wd() } })), "too_large");
  });

  it("lat/lon (konum ve kök) çıktıda yok", () => {
    const r = askW({ location: { name: "Ankara", lat: 39.92512, lon: 32.8 }, lat: 39.9, lon: 32.8 });
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.deepEqual(r.value.context?.weather_data?.location, { name: "Ankara" });
    assert.ok(!JSON.stringify(r.value).includes("39.9"));
    assert.ok(!JSON.stringify(toClientContext(r.value.context, { health: false })).includes("39.9"));
  });
});

describe("toClientContext: personal ve weatherData", () => {
  const parsed = () => {
    const r = ask({
      context: {
        city: "Ankara",
        weather: "güneşli",
        trips: "Antalya 3 gün",
        profile: { interest: "bağ", health_sensitivities: "polen" },
        weather_data: {
          observed_at: "2026-10-28T14:30:00+03:00",
          timezone: "Europe/Istanbul",
          location: { name: "Ankara" },
          current: { temp_c: 18.5, condition: "açık", humidity_pct: null },
          forecast: [
            { date: "2026-10-30", max_c: 20, min_c: null },
            { date: "2026-10-29", min_c: 8, condition: "yağmurlu", precip_prob_pct: 70 },
          ],
          stale: null,
          source: "MGM",
        },
      },
    });
    assert.ok(r.ok);
    return r.ok ? r.value.context : undefined;
  };

  it("personal: false -> profile ve trips yok; city, weather, weatherData var", () => {
    const out = toClientContext(parsed(), { health: true, personal: false });
    assert.equal(out?.profile, undefined);
    assert.equal(out?.trips, undefined);
    assert.equal(out?.city, "Ankara");
    assert.equal(out?.weather, "güneşli");
    assert.ok(out?.weatherData);
    const json = JSON.stringify(out);
    assert.ok(!json.includes("polen") && !json.includes("Antalya") && !json.includes("bağ"));
  });

  it("personal verilmezse ya da true ise eski sonuç", () => {
    for (const out of [toClientContext(parsed(), { health: true }), toClientContext(parsed(), { health: true, personal: true })]) {
      assert.equal(out?.trips, "Antalya 3 gün");
      assert.equal(out?.profile?.health_sensitivities, "polen");
    }
  });

  it("weatherData camelCase, null'lar atılmış, tahmin tarihe göre sıralı", () => {
    assert.deepEqual(toClientContext(parsed(), { health: false })?.weatherData, {
      observedAt: "2026-10-28T14:30:00+03:00",
      timezone: "Europe/Istanbul",
      location: { name: "Ankara" },
      current: { tempC: 18.5, condition: "açık" },
      forecast: [
        { date: "2026-10-29", minC: 8, condition: "yağmurlu", precipProbPct: 70 },
        { date: "2026-10-30", maxC: 20 },
      ],
      source: "MGM",
    });
  });

  it("weather_data yoksa ya da null ise çıktıda weatherData anahtarı yok", () => {
    const a = ask({ context: { city: "Ankara", weather_data: null } });
    assert.ok(a.ok);
    if (!a.ok) return;
    assert.ok(!("weatherData" in (toClientContext(a.value.context, { health: false }) ?? {})));
  });

  it("boş current ve forecast atlanır", () => {
    const r = ask({ context: { weather_data: { observed_at: "2026-10-28T14:30Z", timezone: "UTC", current: { temp_c: null }, forecast: [] } } });
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.deepEqual(toClientContext(r.value.context, { health: false })?.weatherData, { observedAt: "2026-10-28T14:30Z", timezone: "UTC" });
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
