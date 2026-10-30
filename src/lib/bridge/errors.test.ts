import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ChatErrorCode } from "@/lib/ai/turn-core";
import { ChatError } from "@/lib/ai/turn-core";
import { BRIDGE_MESSAGES, BRIDGE_STATUS, bridgeError, bridgeJson, fromChatError, type BridgeErrorCode } from "./errors";

async function parts(res: Response) {
  return { status: res.status, body: (await res.json()) as Record<string, unknown>, headers: res.headers };
}

describe("bridgeError", () => {
  it("gövde {error, message}, ortak başlıklar var, CORS yok", async () => {
    const r = await parts(bridgeError("unauthorized"));
    assert.equal(r.status, 401);
    assert.deepEqual(r.body, { error: "unauthorized", message: BRIDGE_MESSAGES.unauthorized });
    assert.equal(r.headers.get("content-type"), "application/json; charset=utf-8");
    assert.equal(r.headers.get("cache-control"), "no-store");
    assert.equal(r.headers.get("access-control-allow-origin"), null);
    assert.equal(r.headers.get("retry-after"), null);
  });

  it("her kod sözleşmedeki HTTP durumunu verir", () => {
    const expected: Record<BridgeErrorCode, number> = {
      invalid_request: 400,
      unauthorized: 401,
      not_found: 404,
      mode_disabled: 409,
      conversation_conflict: 409,
      request_in_progress: 409,
      request_id_reused: 422,
      user_deleted: 409,
      too_large: 413,
      consent_required: 428,
      rate_limited: 429,
      daily_limit: 429,
      not_configured: 503,
      model_error: 503,
      timeout: 504,
      internal_error: 500,
    };
    assert.deepEqual(BRIDGE_STATUS, expected);
    for (const code of Object.keys(expected) as BridgeErrorCode[]) {
      assert.ok(BRIDGE_MESSAGES[code].length > 0, code);
    }
    assert.equal(BRIDGE_MESSAGES.not_configured, "Asistan şu anda hizmet veremiyor.");
  });

  it("field, consent ve Retry-After eklenir (en az 1, yukarı yuvarlanır)", async () => {
    const a = await parts(bridgeError("invalid_request", { field: "context.city" }));
    assert.equal(a.body.field, "context.city");
    const b = await parts(bridgeError("consent_required", { consent: { version: 2, text: "metin" } }));
    assert.deepEqual(b.body.consent, { version: 2, text: "metin" });
    assert.equal(b.status, 428);
    const h = await parts(bridgeError("consent_required", { consent: { version: 2, text: "metin", health: { version: 1, text: "sağlık" } } }));
    assert.deepEqual(h.body.consent, { version: 2, text: "metin", health: { version: 1, text: "sağlık" } });
    const c = await parts(bridgeError("rate_limited", { retryAfter: 7.2 }));
    assert.equal(c.headers.get("retry-after"), "8");
    const d = await parts(bridgeError("rate_limited", { retryAfter: 0 }));
    assert.equal(d.headers.get("retry-after"), "1");
  });

  it("request_in_progress 409 + Retry-After; request_id_reused 422; user_deleted 409", async () => {
    const a = await parts(bridgeError("request_in_progress", { retryAfter: 3 }));
    assert.equal(a.status, 409);
    assert.equal(a.headers.get("retry-after"), "3");
    assert.deepEqual(a.body, { error: "request_in_progress", message: BRIDGE_MESSAGES.request_in_progress });
    const b = await parts(bridgeError("request_id_reused"));
    assert.equal(b.status, 422);
    assert.equal(b.headers.get("retry-after"), null);
    const c = await parts(bridgeError("user_deleted"));
    assert.equal(c.status, 409);
    assert.equal(c.body.message, "Kullanıcı verileri silindi; bu istek tamamlanamadı.");
  });
});

describe("fromChatError", () => {
  const cases: [ChatErrorCode, BridgeErrorCode, number][] = [
    ["mode_disabled", "mode_disabled", 409],
    ["not_configured", "not_configured", 503],
    ["version_not_found", "not_configured", 503],
    ["daily_limit", "daily_limit", 429],
    ["conversation_not_found", "conversation_conflict", 409],
    ["conversation_mode_mismatch", "conversation_conflict", 409],
    ["empty", "invalid_request", 400],
    ["photos_disabled", "internal_error", 500],
  ];

  for (const [code, error, status] of cases) {
    it(`${code} -> ${status} ${error}`, async () => {
      const r = await parts(fromChatError(new ChatError("iç ayrıntı", 418, code, 120)));
      assert.equal(r.status, status);
      assert.equal(r.body.error, error);
      // ChatError metni (iç bilgi içerebilir) yanıta girmez.
      assert.equal(r.body.message, BRIDGE_MESSAGES[error]);
    });
  }

  it("daily_limit yanıtında Retry-After var (kod yoksa 60)", async () => {
    assert.equal((await parts(fromChatError(new ChatError("x", 429, "daily_limit", 3600)))).headers.get("retry-after"), "3600");
    assert.equal((await parts(fromChatError(new ChatError("x", 429, "daily_limit")))).headers.get("retry-after"), "60");
  });

  it("kodsuz ChatError 500 internal_error olur", async () => {
    const r = await parts(fromChatError(new ChatError("x", 404)));
    assert.equal(r.status, 500);
    assert.equal(r.body.error, "internal_error");
  });
});

describe("bridgeJson", () => {
  it("ek başlıklar ortak başlıklara eklenir", () => {
    const r = bridgeJson({ ok: true }, 200, { "idempotent-replayed": "true" });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("idempotent-replayed"), "true");
    assert.equal(r.headers.get("cache-control"), "no-store");
  });

  it("ek başlık yoksa yalnızca ortak başlıklar vardır", () => {
    assert.equal(bridgeJson({ ok: true }).headers.get("idempotent-replayed"), null);
  });
});
