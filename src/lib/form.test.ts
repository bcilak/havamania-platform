import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formToObject } from "./form";

const form = (entries: [string, string][]) => {
  const fd = new FormData();
  for (const [k, v] of entries) fd.append(k, v);
  return fd;
};

describe("formToObject", () => {
  it("noktalı adları iç içe nesne ve diziye çevirir, değerleri kırpar", () => {
    const o = formToObject(
      form([
        ["scene.captions.0.title", " A "],
        ["scene.captions.1.title", "B"],
        ["scene.screen1.temp", "21"],
        ["baska.x", "yok sayılır"],
      ]),
      "scene",
    );
    assert.deepEqual(o, { captions: [{ title: "A" }, { title: "B" }], screen1: { temp: "21" } });
    assert.ok(Array.isArray(o.captions));
  });

  it("__proto__ / constructor.prototype denemeleri Object ve Array prototipini kirletmez", () => {
    formToObject(
      form([
        ["x.__proto__.polluted", "1"],
        ["x.constructor.prototype.polluted", "1"],
        ["x.list.0.__proto__.polluted", "1"],
        ["x.list.0.constructor.prototype.polluted", "1"],
        ["x.__proto__.0.polluted", "1"],
      ]),
      "x",
    );
    assert.equal(({} as Record<string, unknown>).polluted, undefined);
    assert.equal(([] as unknown as Record<string, unknown>).polluted, undefined);
    assert.equal(Object.hasOwn(Object.prototype, "polluted"), false);
    assert.equal(Object.hasOwn(Array.prototype, "polluted"), false);
  });

  it("tehlikeli parça içeren alan hiçbir iz bırakmaz; diğer alanlar etkilenmez", () => {
    const o = formToObject(form([["x.a.__proto__.b", "1"], ["x.ok", "tamam"]]), "x");
    assert.deepEqual(o, { ok: "tamam" });
  });

  it("aşırı büyük indeks atlanır (seyrek dev dizi oluşmaz)", () => {
    const o = formToObject(form([["x.captions.4294967294", "z"], ["x.captions.0", "a"]]), "x");
    assert.deepEqual(o, { captions: ["a"] });
    assert.equal((o.captions as unknown[]).length, 1);
    assert.deepEqual(formToObject(form([["x.captions.4294967294", "z"]]), "x"), {});
  });

  it("dizide sayısal olmayan anahtar (length) atlanır; dizi uzunluğu bozulmaz", () => {
    const o = formToObject(
      form([["x.captions.0", "a"], ["x.captions.length", "4294967294"], ["x.captions.length", "abc"], ["x.captions.foo", "b"]]),
      "x",
    );
    assert.deepEqual(o, { captions: ["a"] });
    assert.equal((o.captions as unknown[]).length, 1);
  });

  it("nesne/dizi olmayan ara düğümde alan atlanır, hata atılmaz", () => {
    const o = formToObject(form([["x.a", "s"], ["x.a.b", "t"], ["x.a.0.b", "u"], ["x.c.0", "v"], ["x.c.0.d", "w"]]), "x");
    assert.deepEqual(o, { a: "s", c: ["v"] });
  });
});
