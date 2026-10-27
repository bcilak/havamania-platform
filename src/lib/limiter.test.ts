import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createLimiter, LimiterBusyError } from "./limiter";

describe("createLimiter", () => {
  it("aynı anda en çok max işlem çalıştırır, hepsini tamamlar", async () => {
    const run = createLimiter(2);
    let active = 0;
    let peak = 0;
    const task = async (n: number) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 10));
      active--;
      return n;
    };
    const out = await Promise.all([1, 2, 3, 4, 5].map((n) => run(() => task(n))));
    assert.deepEqual(out, [1, 2, 3, 4, 5]);
    assert.equal(peak, 2);
  });

  it("hata yuvayı serbest bırakır", async () => {
    const run = createLimiter(1);
    await assert.rejects(run(async () => Promise.reject(new Error("x"))));
    assert.equal(await run(async () => "ok"), "ok");
  });
  it("kuyruk dolunca LimiterBusyError(queue_full) fırlatır, çalışan ve bekleyen işler tamamlanır", async () => {
    const run = createLimiter(1, { maxQueue: 1 });
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const first = run(async () => (await gate, "a"));
    const second = run(async () => "b"); // sırada
    await assert.rejects(run(async () => "c"), (e: unknown) => e instanceof LimiterBusyError && e.reason === "queue_full");
    release();
    assert.deepEqual(await Promise.all([first, second]), ["a", "b"]);
    assert.equal(await run(async () => "d"), "d");
  });

  it("bekleme süresi aşılırsa LimiterBusyError(timeout) fırlatır ve sıradan çıkar", async () => {
    const run = createLimiter(1, { maxQueue: 4, waitMs: 20 });
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const first = run(async () => (await gate, "a"));
    let ran = false;
    await assert.rejects(run(async () => ((ran = true), "b")), (e: unknown) => e instanceof LimiterBusyError && e.reason === "timeout");
    release();
    assert.equal(await first, "a");
    assert.equal(ran, false);
    assert.equal(await run(async () => "c"), "c"); // yuva sızmadı
  });
});
