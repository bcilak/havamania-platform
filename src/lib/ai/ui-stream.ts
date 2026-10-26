/*
 * Son kullanıcıya (widget, mobil köprü) giden UI akışından iç veriyi ayıklar.
 * Arayüz yalnızca "hangi araç çalışıyor" bilgisini gösterir; araç girdisi,
 * çıktısı, sağlayıcı/araç meta verisi ve iç hata metinleri (ör. veri servisi
 * adresi, ham API yanıtı) istemciye gitmez. Süzgeç allowlist'tir: yalnızca
 * aşağıdaki chunk türleri ve alanları geçer, bilinmeyen tür düşürülür.
 * Test alanı (playground) bu süzgeçten geçmez.
 */

type Chunk = { type: string; [k: string]: unknown };

const GENERIC_ERROR = "Araç çalıştırılamadı.";

/** İzinli chunk türü → istemciye geçebilen alanlar ("type" her zaman geçer). */
const ALLOWED_FIELDS: Record<string, readonly string[]> = {
  start: ["messageId"],
  finish: ["finishReason"],
  abort: [],
  "start-step": [],
  "finish-step": [],
  "text-start": ["id"],
  "text-delta": ["id", "delta"],
  "text-end": ["id"],
  error: ["errorText"],
  "tool-input-start": ["toolCallId", "toolName"],
  "tool-input-available": ["toolCallId", "toolName"],
  "tool-input-error": ["toolCallId", "toolName"],
  "tool-output-available": ["toolCallId"],
  "tool-output-error": ["toolCallId"],
};

/** Allowlist dışındaki türler (akıl yürütme, kaynak, dosya, data-*, tool-input-delta…) düşer. */
export function redactToolChunk<T extends Chunk>(chunk: T): T | null {
  const fields = ALLOWED_FIELDS[chunk.type];
  if (!fields) return null;
  const out: Chunk = { type: chunk.type };
  for (const f of fields) if (f in chunk) out[f] = chunk[f];
  // `start`/`finish` yalnızca bilinen meta alanlarını taşır; messageMetadata gitmez.
  switch (chunk.type) {
    case "tool-input-available":
      out.input = {};
      break;
    case "tool-input-error":
      out.input = {};
      out.errorText = GENERIC_ERROR;
      break;
    case "tool-output-available":
      out.output = null;
      break;
    case "tool-output-error":
      out.errorText = GENERIC_ERROR;
      break;
  }
  return out as T;
}

export function redactToolStream<T extends Chunk>(stream: ReadableStream<T>): ReadableStream<T> {
  return stream.pipeThrough(
    new TransformStream<T, T>({
      transform(chunk, controller) {
        const out = redactToolChunk(chunk);
        if (out) controller.enqueue(out);
      },
    }),
  );
}
