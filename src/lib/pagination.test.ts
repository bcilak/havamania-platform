import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pageInfo, parsePage } from "./pagination";

describe("sayfalama", () => {
  it("parsePage geçersiz değerlerde 1 verir", () => {
    assert.equal(parsePage(undefined), 1);
    assert.equal(parsePage(""), 1);
    assert.equal(parsePage("abc"), 1);
    assert.equal(parsePage("0"), 1);
    assert.equal(parsePage("-3"), 1);
    assert.equal(parsePage("2.5"), 1);
    assert.equal(parsePage("3"), 3);
  });

  it("sayfa sayısı ve ofset hesaplanır", () => {
    assert.deepEqual(pageInfo(120, 2, 50), { page: 2, pages: 3, offset: 50, limit: 50, total: 120 });
    assert.equal(pageInfo(100, 2, 50).pages, 2);
    assert.equal(pageInfo(101, 3, 50).offset, 100);
  });

  it("boş listede tek sayfa; son sayfadan öteye gidilmez", () => {
    assert.deepEqual(pageInfo(0, 5, 50), { page: 1, pages: 1, offset: 0, limit: 50, total: 0 });
    assert.equal(pageInfo(60, 99, 50).page, 2);
  });
});
