import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readJsonCapped } from "./request";

const JSON_TYPE = "application/json; charset=utf-8";

function streamOf(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (i < chunks.length) controller.enqueue(chunks[i++]);
      else controller.close();
    },
  });
}

const enc = (s: string) => new TextEncoder().encode(s);

function req(body: Uint8Array | Uint8Array[] | null, headers: Record<string, string> = { "content-type": JSON_TYPE }) {
  const chunks = body === null ? null : Array.isArray(body) ? body : [body];
  return { headers: new Headers(headers), body: chunks ? streamOf(chunks) : null };
}

/** Tam `maxBytes` baytlık geçerli JSON. */
function jsonOfSize(bytes: number): Uint8Array {
  const pad = bytes - enc('{"a":""}').byteLength;
  return enc(`{"a":"${"x".repeat(pad)}"}`);
}

describe("readJsonCapped", () => {
  it("geçerli JSON okunur", async () => {
    const r = await readJsonCapped(req(enc('{"a":"ğ"}')));
    assert.deepEqual(r, { ok: true, value: { a: "ğ" } });
  });

  it("tam sınırda geçer, sınır +1 bayt too_large", async () => {
    const ok = await readJsonCapped(req(jsonOfSize(100)), 100);
    assert.equal(ok.ok, true);
    const over = await readJsonCapped(req(jsonOfSize(101)), 100);
    assert.deepEqual(over, { ok: false, code: "too_large" });
    // Varsayılan 32 KB.
    assert.equal((await readJsonCapped(req(jsonOfSize(32768)))).ok, true);
    assert.deepEqual(await readJsonCapped(req(jsonOfSize(32769))), { ok: false, code: "too_large" });
  });

  it("parçalı akışta toplam bayt sayılır ve akış iptal edilir", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        c.enqueue(new Uint8Array(40));
      },
      cancel() {
        cancelled = true;
      },
    });
    const r = await readJsonCapped({ headers: new Headers({ "content-type": JSON_TYPE }), body }, 100);
    assert.deepEqual(r, { ok: false, code: "too_large" });
    assert.equal(cancelled, true);
  });

  it("yalan content-length (küçük beyan, büyük gövde) too_large", async () => {
    const r = await readJsonCapped(req(jsonOfSize(200), { "content-type": JSON_TYPE, "content-length": "10" }), 100);
    assert.deepEqual(r, { ok: false, code: "too_large" });
  });

  it("büyük content-length gövdeyi hiç okumadan too_large", async () => {
    const request = req(enc("{}"), { "content-type": JSON_TYPE, "content-length": "101" });
    const r = await readJsonCapped(request, 100);
    assert.deepEqual(r, { ok: false, code: "too_large" });
    assert.equal(request.body!.locked, false);
  });

  it("bozuk UTF-8 invalid_request", async () => {
    const bad = new Uint8Array([0x7b, 0x22, 0x61, 0x22, 0x3a, 0x22, 0xff, 0xfe, 0x22, 0x7d]);
    assert.deepEqual(await readJsonCapped(req(bad)), { ok: false, code: "invalid_request" });
  });

  it("bozuk JSON, boş gövde ve gövdesiz istek invalid_request", async () => {
    assert.deepEqual(await readJsonCapped(req(enc("{bozuk"))), { ok: false, code: "invalid_request" });
    assert.deepEqual(await readJsonCapped(req(enc(""))), { ok: false, code: "invalid_request" });
    assert.deepEqual(await readJsonCapped(req(null)), { ok: false, code: "invalid_request" });
  });

  it("text/plain ve içerik türü yok invalid_request", async () => {
    assert.deepEqual(await readJsonCapped(req(enc("{}"), { "content-type": "text/plain" })), { ok: false, code: "invalid_request" });
    assert.deepEqual(await readJsonCapped(req(enc("{}"), {})), { ok: false, code: "invalid_request" });
  });

  it("içerik türü büyük/küçük harfe duyarsızdır", async () => {
    const r = await readJsonCapped(req(enc("{}"), { "content-type": "Application/JSON" }));
    assert.equal(r.ok, true);
  });

  it("çok parçalı gövde birleştirilir", async () => {
    const r = await readJsonCapped(req([enc('{"a":'), enc('"b"'), enc("}")]));
    assert.deepEqual(r, { ok: true, value: { a: "b" } });
  });
});
