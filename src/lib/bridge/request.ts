/*
 * Köprü gövdesini en çok `maxBytes` bayt okuyup JSON'a çevirir. Next'in kendi gövde sınırı
 * route handler'larda yoktur; bu yüzden sınır burada, akış okunurken uygulanır.
 */

export const BODY_MAX_BYTES = 32_768;

export type ReadJsonResult = { ok: true; value: unknown } | { ok: false; code: "invalid_request" | "too_large" };

/**
 * Sıra (API sözleşmesi, "İşlem sırası" 5-7): bildirilen `content-length` sınırı aşıyorsa gövde hiç okunmaz;
 * sonra içerik türü; sonra gerçek bayt sayısı akış okunurken sayılır (yalan `content-length` işe yaramaz).
 */
export async function readJsonCapped(request: { headers: Headers; body: ReadableStream<Uint8Array> | null }, maxBytes = BODY_MAX_BYTES): Promise<ReadJsonResult> {
  const declared = request.headers.get("content-length");
  if (declared !== null && /^\d+$/.test(declared.trim()) && Number(declared) > maxBytes) return { ok: false, code: "too_large" };
  if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) return { ok: false, code: "invalid_request" };
  if (!request.body) return { ok: false, code: "invalid_request" };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        return { ok: false, code: "too_large" };
      }
      chunks.push(value);
    }
  } catch {
    // Bağlantı koptu ya da akış bozuldu.
    return { ok: false, code: "invalid_request" };
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.byteLength;
  }
  try {
    return { ok: true, value: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) };
  } catch {
    return { ok: false, code: "invalid_request" };
  }
}
