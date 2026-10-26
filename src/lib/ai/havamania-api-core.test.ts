import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { API_ERRORS, apiFailure, classifyFetchError, httpFailure, joinApiUrl, locationParams, parseJsonBody, type ApiResult } from "./havamania-api-core";
import { isUnanswered } from "./retrieval-core";

const errorOf = (r: ApiResult) => (r.ok ? "" : r.error);

describe("joinApiUrl", () => {
  it("taban yolu korur", () => {
    assert.equal(joinApiUrl("https://api.x/v2", "/weather"), "https://api.x/v2/weather");
    assert.equal(new URL(joinApiUrl("https://api.x/v2", "/weather")).pathname, "/v2/weather");
  });

  it("fazla ve eksik eğik çizgileri düzeltir", () => {
    assert.equal(joinApiUrl("https://api.x/v2/", "weather"), "https://api.x/v2/weather");
    assert.equal(joinApiUrl("https://api.x//", "//weather/now"), "https://api.x/weather/now");
    assert.equal(joinApiUrl("https://api.x", "/v1/weather/current"), "https://api.x/v1/weather/current");
  });

  it("uç nokta tam URL ise olduğu gibi kullanır", () => {
    assert.equal(joinApiUrl("https://api.x/v2", "https://other.example/data"), "https://other.example/data");
    assert.equal(joinApiUrl("https://api.x/v2", "HTTP://other.example/data"), "HTTP://other.example/data");
  });
});

describe("classifyFetchError", () => {
  it("TimeoutError'ı zaman aşımı sayar", () => {
    const e = new DOMException("The operation was aborted due to timeout", "TimeoutError");
    assert.equal(classifyFetchError(e), "timeout");
  });

  it("bağlantı kurma zaman aşımını (undici cause) zaman aşımı sayar", () => {
    const e = new TypeError("fetch failed", { cause: { code: "UND_ERR_CONNECT_TIMEOUT" } });
    assert.equal(classifyFetchError(e), "timeout");
  });

  it("reddedilen bağlantı ve bilinmeyen hatayı ağ hatası sayar", () => {
    assert.equal(classifyFetchError(new TypeError("fetch failed", { cause: { code: "ECONNREFUSED" } })), "network");
    assert.equal(classifyFetchError(new Error("boom")), "network");
    assert.equal(classifyFetchError("metin"), "network");
    assert.equal(classifyFetchError(null), "network");
  });

  it("kullanıcı iptalini (AbortError) zaman aşımı saymaz", () => {
    assert.equal(classifyFetchError(new DOMException("aborted", "AbortError")), "network");
  });
});

describe("parseJsonBody", () => {
  it("geçerli JSON'u veri olarak döner", () => {
    assert.deepEqual(parseJsonBody('{"temp":24}'), { ok: true, data: { temp: 24 } });
  });

  it("bozuk ya da boş gövdeyi bad_json yapar; bağlantı hatası demez", () => {
    for (const body of ["<html>hata</html>", "", "   ", "{kırık"]) {
      const r = parseJsonBody(body);
      assert.equal(r.ok, false);
      if (!r.ok) {
        assert.equal(r.code, "bad_json");
        assert.equal(r.error, "Veri servisi geçersiz yanıt döndü.");
        assert.ok(!r.error.includes("bağlantı"));
      }
    }
  });
});

describe("apiFailure", () => {
  it("her kod için Türkçe mesaj üretir", () => {
    assert.equal(apiFailure("timeout").ok, false);
    assert.match(errorOf(apiFailure("timeout")), /zaman aşımı/);
    assert.match(errorOf(apiFailure("network")), /bağlantı hatası/);
    assert.equal(errorOf(apiFailure("no_location")), API_ERRORS.no_location);
    assert.match(errorOf(apiFailure("no_location")), /Konum bilinmiyor/);
  });

  it("http kodunu mesaja ve koda yazar", () => {
    const r = apiFailure("http_500");
    assert.deepEqual(r, { ok: false, error: "Veri servisi 500 döndü.", code: "http_500" });
  });

  it("not_configured mesajı modele uydurma yapmamasını söyler", () => {
    assert.match(errorOf(apiFailure("not_configured")), /tahmin uydurma/);
  });

  it("başarısız sonuç F1-2 kuralında cevap sayılmaz (ok !== true)", () => {
    const toolCalls = [{ output: apiFailure("http_500") }];
    assert.equal(isUnanswered({ relevantHits: 0, toolCalls, error: null, aborted: false }), true);
  });
});

describe("locationParams", () => {
  const device = { lat: 39.65, lon: 27.88 };

  it("araç girdisindeki adı önceliklendirir", () => {
    assert.deepEqual(locationParams("Konya", device), { q: "Konya" });
    assert.deepEqual(locationParams("  İzmir ", null), { q: "İzmir" });
  });

  it("ad yoksa cihaz konumunu kullanır", () => {
    assert.deepEqual(locationParams(undefined, device), { lat: 39.65, lon: 27.88 });
    assert.deepEqual(locationParams("   ", device), { lat: 39.65, lon: 27.88 });
  });

  it("ikisi de yoksa null döner (istek atılmaz)", () => {
    assert.equal(locationParams(undefined, null), null);
    assert.equal(locationParams("", undefined), null);
  });
});

describe("httpFailure", () => {
  it("3xx yönlendirme ayrı ve anlaşılır bir hata verir", () => {
    const r = httpFailure(302);
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.code, "http_302");
      assert.match(r.error, /yönlendirme/);
    }
  });

  it("diğer durumlar mevcut sınıflandırmayla aynı", () => {
    assert.deepEqual(httpFailure(500), apiFailure("http_500"));
    assert.deepEqual(httpFailure(404), apiFailure("http_404"));
  });
});
