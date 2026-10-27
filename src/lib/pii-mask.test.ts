import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { maskPii, maskToolPayload, piiPayload, piiText } from "./pii-mask";

describe("maskPii", () => {
  it("telefon, e-posta ve uzun numaraları maskeler, kısa sayıları bırakır", () => {
    assert.equal(maskPii("Beni 0532 123 45 67 arayın, ali@example.com"), "Beni •••• arayın, •••@•••");
    assert.equal(maskPii("Yarın 25 derece, FL350, 12 kt"), "Yarın 25 derece, FL350, 12 kt");
  });

  it("koordinat çiftini, etiketli enlem/boylamı ve derece-dakikayı maskeler", () => {
    assert.equal(maskPii("Konumum 39.93, 32.85 civarı"), "Konumum •••• civarı");
    assert.equal(maskPii("41,0082;28,9784 neresi"), "•••• neresi");
    assert.equal(maskPii("https://maps.example/?q=40.1234,29.5678"), "https://maps.example/?q=••••");
    assert.equal(maskPii("enlem: 39.9 boylam 32.8 için"), "enlem •••• boylam •••• için");
    assert.equal(maskPii("Lat=41.0 lon=28.9"), "Lat •••• lon ••••");
    assert.equal(maskPii("39°55'N 32°51'E"), "•••• ••••");
  });

  it("ham koordinat sızmaz", () => {
    for (const s of ["39.925533, 32.866287", "x 39.925533 y", "-33.8688,151.2093", "Konum 38.4237 27.1428"]) {
      assert.ok(!/\d{2}\.\d{2}/.test(maskPii(s)), `${s} -> ${maskPii(s)}`);
    }
  });

  it("fiyat/ölçü gibi sıradan ondalıkları bozmaz", () => {
    assert.equal(maskPii("Domates 3.5 TL, nem %45.5, 12.5 mm yağış"), "Domates 3.5 TL, nem %45.5, 12.5 mm yağış");
  });

  it("uzun girdilerde her biri 500 ms altında", () => {
    const inputs = ["1.".repeat(200_000), "12.34,".repeat(100_000), "lat ".repeat(100_000), `${"9".repeat(300_000)}.`, "1°".repeat(200_000), "1.1234".repeat(100_000)];
    for (const input of inputs) {
      const t0 = performance.now();
      maskPii(input);
      assert.ok(performance.now() - t0 < 500, `${Math.round(performance.now() - t0)} ms`);
    }
  });
});

describe("maskToolPayload", () => {
  const payload = {
    name: "current_weather",
    input: { lat: 39.925533, lon: 32.866287, location: "Çankaya, Ankara", q: "Ankara", days: 3 },
    output: { ok: true, data: { city: "Ankara", coords: { latitude: 39.9, longitude: 32.8 }, temp: 21.4, note: "Ara: 0532 123 45 67" } },
  };

  it("konum alanlarını ve metindeki kişisel veriyi maskeler, diğer değerleri korur", () => {
    const out = JSON.stringify(maskToolPayload(payload));
    for (const raw of ["39.925533", "32.866287", "Çankaya", "Ankara", "39.9", "0532"]) assert.ok(!out.includes(raw), raw);
    const o = maskToolPayload(payload) as typeof payload;
    assert.equal(o.input.days, 3);
    assert.equal(o.output.data.temp, 21.4);
    assert.equal(o.name, "current_weather");
  });

  it("Türkçe anahtarlar ve koordinat benzeri sayılar maskelenir, sıradan sayılar kalır", () => {
    assert.deepEqual(maskToolPayload({ enlem: 41.0082 }), { enlem: "••••" });
    assert.deepEqual(maskToolPayload({ merkez: [41.0082, 28.9784] }), { merkez: ["••••", "••••"] });
    assert.deepEqual(maskToolPayload({ il: "İstanbul" }), { il: "••••" });
    assert.deepEqual(maskToolPayload({ sicaklik: 21.5 }), { sicaklik: 21.5 });
    assert.deepEqual(maskToolPayload({ İLÇE: "Kadıköy", Mahalle: { ad: "x" }, "e-posta": "a@b.co" }), { İLÇE: "••••", Mahalle: "••••", "e-posta": "••••" });
    assert.deepEqual(maskToolPayload({ konum: [1, 2], koordinat: { a: 3 }, ad: 7 }), { konum: "••••", koordinat: "••••", ad: "••••" });
  });

  it("girdiyi değiştirmez, null/dizi/derin yapıyı kaldırır", () => {
    const before = JSON.stringify(payload);
    maskToolPayload(payload);
    assert.equal(JSON.stringify(payload), before);
    assert.equal(maskToolPayload(null), null);
    assert.deepEqual(maskToolPayload([{ lat: 1 }, "a"]), [{ lat: "••••" }, "a"]);
    let deep: unknown = "x";
    for (let i = 0; i < 100; i++) deep = { a: deep };
    assert.doesNotThrow(() => maskToolPayload(deep));
  });

  it("piiText/piiPayload yetkiliye ham, yetkisize maskeli döner", () => {
    assert.equal(piiText(true, "0532 123 45 67"), "0532 123 45 67");
    assert.equal(piiText(false, "0532 123 45 67"), "••••");
    assert.equal(piiPayload(true, payload), payload);
    assert.notEqual(piiPayload(false, payload), payload);
  });
});
