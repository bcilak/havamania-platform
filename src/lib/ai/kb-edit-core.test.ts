import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { derivedTitle, planEdit, type EditableSource } from "./kb-edit-core";

const qa: EditableSource = { type: "qa", title: "Sulama ne zaman?", mode: "all", question: "Sulama ne zaman?", answer: "Sabah." };
const file: EditableSource = { type: "file", title: "Rehber", mode: "agro", question: null, answer: null };

describe("planEdit", () => {
  it("değişiklik yoksa yama boştur", () => {
    const p = planEdit(qa, { mode: "all", question: "Sulama ne zaman?", answer: "Sabah." });
    assert.deepEqual(p.changed, []);
    assert.deepEqual(p.patch, {});
  });

  it("yalnızca cevap değişirse başlık ve soru yamaya girmez", () => {
    const p = planEdit(qa, { mode: "all", question: "Sulama ne zaman?", answer: "Akşam." });
    assert.deepEqual(p.patch, { answer: "Akşam." });
  });

  it("soru değişince başlık sorudan yeniden türetilir", () => {
    const p = planEdit(qa, { mode: "all", question: "Sulama kaç gün arayla?", answer: "Sabah." });
    assert.deepEqual(p.patch, { question: "Sulama kaç gün arayla?", title: "Sulama kaç gün arayla?" });
  });

  it("düzeltmede başlık 120, SSS'de 160 karakterle sınırlanır", () => {
    const long = "a".repeat(300);
    assert.equal(derivedTitle("correction", long).length, 120);
    assert.equal(derivedTitle("qa", long).length, 160);
  });

  it("mod her türde değişir", () => {
    assert.deepEqual(planEdit(qa, { mode: "fly", question: qa.question!, answer: qa.answer! }).patch, { mode: "fly" });
    assert.deepEqual(planEdit(file, { mode: "all" }).patch, { mode: "all" });
  });

  it("dosyada başlık formdan gelir; boşsa mevcut kalır; soru/cevap yok sayılır", () => {
    assert.deepEqual(planEdit(file, { mode: "agro", title: "Yeni ad" }).patch, { title: "Yeni ad" });
    assert.deepEqual(planEdit(file, { mode: "agro", title: "" }).changed, []);
    assert.deepEqual(planEdit(file, { mode: "agro", question: "x", answer: "y" }).changed, []);
  });
});
