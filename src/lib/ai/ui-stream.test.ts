import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { redactToolChunk, redactToolStream } from "./ui-stream";

describe("widget akışı süzgeci", () => {
  it("araç girdisi, çıktısı ve hata metni istemciye gitmez", () => {
    assert.equal(redactToolChunk({ type: "tool-input-delta", toolCallId: "1", inputTextDelta: "{\"q\":\"x\"}" }), null);
    assert.deepEqual(redactToolChunk({ type: "tool-input-available", toolCallId: "1", toolName: "forecast", input: { q: "x" } }), {
      type: "tool-input-available",
      toolCallId: "1",
      toolName: "forecast",
      input: {},
    });
    const out = redactToolChunk({ type: "tool-output-available", toolCallId: "1", output: { ok: false, error: "http://iç-adres hata" } });
    assert.deepEqual(out, { type: "tool-output-available", toolCallId: "1", output: null });
    const err = redactToolChunk({ type: "tool-output-error", toolCallId: "1", errorText: "ECONNREFUSED 10.0.0.5" });
    assert.ok(!JSON.stringify(err).includes("10.0.0.5"));
  });

  it("araç adı ve metin akışı korunur", () => {
    const start = { type: "tool-input-start", toolCallId: "1", toolName: "forecast" };
    const text = { type: "text-delta", id: "t", delta: "Merhaba" };
    assert.deepEqual(redactToolChunk(start), start);
    assert.deepEqual(redactToolChunk(text), text);
  });

  it("allowlist: meta alanları silinir, bilinmeyen türler düşer", () => {
    const meta = redactToolChunk({
      type: "tool-input-start",
      toolCallId: "1",
      toolName: "forecast",
      providerMetadata: { x: { key: "s" } },
      toolMetadata: { url: "http://10.0.0.5" },
      providerExecuted: true,
    });
    assert.deepEqual(meta, { type: "tool-input-start", toolCallId: "1", toolName: "forecast" });
    const text = redactToolChunk({ type: "text-delta", id: "t", delta: "a", providerMetadata: { openai: { itemId: "x" } } });
    assert.deepEqual(text, { type: "text-delta", id: "t", delta: "a" });
    const start = redactToolChunk({ type: "start", messageId: "m", messageMetadata: { secret: 1 } });
    assert.deepEqual(start, { type: "start", messageId: "m" });
    for (const type of ["reasoning-delta", "source-url", "source-document", "file", "data-debug", "custom", "tool-approval-request", "message-metadata", "yeni-bir-tur"]) {
      assert.equal(redactToolChunk({ type, id: "1", delta: "gizli" }), null, type);
    }
  });

  it("akış üzerinde çalışır", async () => {
    const chunks = [
      { type: "tool-input-start", toolCallId: "1", toolName: "forecast" },
      { type: "tool-input-delta", toolCallId: "1", inputTextDelta: "{}" },
      { type: "tool-output-available", toolCallId: "1", output: { secret: 1 } },
      { type: "text-delta", id: "t", delta: "x" },
    ];
    const rs = new ReadableStream({
      start(c) {
        chunks.forEach((x) => c.enqueue(x));
        c.close();
      },
    });
    const got: unknown[] = [];
    const reader = redactToolStream(rs).getReader();
    for (let r = await reader.read(); !r.done; r = await reader.read()) got.push(r.value);
    assert.equal(got.length, 3);
    assert.ok(!JSON.stringify(got).includes("secret"));
  });
});
