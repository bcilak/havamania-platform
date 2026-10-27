import { PERSONA_LIMITS, TONES, type ExampleChat, type ToneId } from "./bot-config";

/* Kişilik formunun saf ayrıştırıcıları. Hata dönerse çağıran `fail` ile forma geri yollar. */

export type Parsed<T> = { value: T; error: null } | { value: null; error: string };

const bad = (error: string): { value: null; error: string } => ({ value: null, error });

/** Her satır bir yasak konu. Boş satırlar atılır, tekrarlar (Türkçe büyük/küçük harf duyarsız) tek sayılır. */
export function parseBlockedTopics(raw: string): Parsed<string[]> {
  const { count, chars } = PERSONA_LIMITS.blockedTopics;
  const seen = new Set<string>();
  const topics: string[] = [];
  for (const line of raw.replace(/\r\n/g, "\n").split("\n")) {
    const t = line.trim();
    if (!t) continue;
    if (t.length > chars) return bad(`Her yasak konu en fazla ${chars} karakter olabilir (“${t.slice(0, 20)}…” ${t.length} karakter).`);
    const key = t.toLocaleLowerCase("tr-TR");
    if (seen.has(key)) continue;
    seen.add(key);
    topics.push(t);
  }
  if (topics.length > count) return bad(`En fazla ${count} yasak konu eklenebilir (şu an ${topics.length}).`);
  return { value: topics, error: null };
}

/** Form satırlarından örnek çiftleri: ikisi de boş satır atlanır, yalnızca biri dolu olan hatadır. */
export function pairExamples(rows: { user: string; assistant: string }[]): Parsed<ExampleChat[]> {
  const { count, chars } = PERSONA_LIMITS.examples;
  const out: ExampleChat[] = [];
  for (const [i, r] of rows.entries()) {
    const user = r.user.trim();
    const assistant = r.assistant.trim();
    if (!user && !assistant) continue;
    if (!user || !assistant) return bad(`Örnek ${i + 1} için hem kullanıcı hem asistan metni gerekli.`);
    if (user.length > chars || assistant.length > chars) return bad(`Örnek ${i + 1}: her metin en fazla ${chars} karakter olabilir.`);
    out.push({ user, assistant });
  }
  if (out.length > count) return bad(`En fazla ${count} örnek konuşma eklenebilir.`);
  return { value: out, error: null };
}

/**
 * Ton metinleri formundan `toneOverrides`: boş, varsayılanla aynı ya da "varsayılana dön"
 * işaretli tonlar kayda girmez.
 */
export function buildToneOverrides(
  fields: Partial<Record<ToneId, { text: string; reset: boolean }>>,
): Parsed<Partial<Record<ToneId, string>>> {
  const out: Partial<Record<ToneId, string>> = {};
  for (const t of Object.keys(TONES) as ToneId[]) {
    const f = fields[t];
    if (!f || f.reset) continue;
    const text = f.text.trim();
    if (!text || text === TONES[t].rule) continue;
    if (text.length > PERSONA_LIMITS.toneRule) return bad(`${TONES[t].label} ton metni en fazla ${PERSONA_LIMITS.toneRule} karakter olabilir (şu an ${text.length}).`);
    if (text.length < 10) return bad(`${TONES[t].label} ton metni çok kısa; boş bırakırsanız varsayılan kullanılır.`);
    out[t] = text;
  }
  return { value: out, error: null };
}
