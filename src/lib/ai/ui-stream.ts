/*
 * Son kullanıcıya (widget, mobil köprü) giden UI akışından iç veriyi ayıklar.
 * Arayüz yalnızca "hangi araç çalışıyor" bilgisini gösterir; araç girdisi,
 * çıktısı, sağlayıcı/araç meta verisi ve iç hata metinleri (ör. veri servisi
 * adresi, ham API yanıtı) istemciye gitmez. Süzgeç allowlist'tir: yalnızca
 * aşağıdaki chunk türleri ve alanları geçer, bilinmeyen tür düşürülür.
 * Test alanı (playground) bu süzgeçten geçmez.
 */

import { CitationStripper } from "./citations";

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

/**
 * Son kullanıcıya giden metinden kaynak atıflarını ([1], [2][3]) siler; kaynaklar kullanıcıya gösterilmez.
 * Atıf parçalar arasında bölünebilir ("[" + "1]"): metin akışı id başına bekletilir, atıf tamamlanınca silinir,
 * tamamlanmazsa metin bitince atılır. `sourceCount` kaynak sayısıdır: yalnızca 1..sourceCount numaralı, atıf biçimli işaretler
 * silinir, kaynak yoksa (0) süzgeç atlanır. Test alanı (playground) bu süzgeçten geçmez; orada atıflar görünür.
 */
export function stripCitationStream<T extends Chunk>(stream: ReadableStream<T>, sourceCount?: number): ReadableStream<T> {
  const strippers = new Map<string, CitationStripper>();
  const forId = (id: string) => {
    let s = strippers.get(id);
    if (!s) strippers.set(id, (s = new CitationStripper(sourceCount)));
    return s;
  };
  return stream.pipeThrough(
    new TransformStream<T, T>({
      transform(chunk, controller) {
        if (chunk.type === "text-delta" && typeof chunk.id === "string" && typeof chunk.delta === "string") {
          const out = forId(chunk.id).push(chunk.delta);
          if (out) controller.enqueue({ ...chunk, delta: out });
          return;
        }
        if (chunk.type === "text-end" && typeof chunk.id === "string") {
          const tail = forId(chunk.id).flush();
          strippers.delete(chunk.id);
          if (tail) controller.enqueue({ type: "text-delta", id: chunk.id, delta: tail } as unknown as T);
        }
        controller.enqueue(chunk);
      },
    }),
  );
}
