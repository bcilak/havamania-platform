import type { Platform, SourceRecord, ToolCallRecord } from "@/db/schema";

/** Hangi ayarlarla çalışılacağı: taslak, yayındaki sürüm ya da belirli bir sürüm (yalnızca test alanı). */
export type TurnTarget = "draft" | "published" | { versionId: string };

/**
 * Etkin hedef. `target` yalnızca test alanında (platform "playground") dikkate alınır;
 * widget ve köprü istekleri istemciden ne gelirse gelsin yayındaki sürümle çalışır.
 */
export function effectiveTarget(i: { platform: Platform; useDraft: boolean; target?: TurnTarget }): TurnTarget {
  if (i.platform === "playground" && i.target) return i.target;
  return i.useDraft ? "draft" : "published";
}

/**
 * Akışsız cevabın dışarı verilebilen iç verisi. Araç girdi/çıktısı ve kaynaklar
 * (akıştaki redactToolStream ile aynı kural) yalnızca test alanına döner; widget ve
 * köprü yalnızca araç adlarını görür.
 */
export function exposeTurnData(
  platform: Platform,
  data: { toolCalls: ToolCallRecord[]; sources: SourceRecord[] },
): { toolNames: string[]; toolCalls: ToolCallRecord[]; sources: SourceRecord[] } {
  const toolNames = data.toolCalls.map((t) => t.name);
  if (platform !== "playground") return { toolNames, toolCalls: [], sources: [] };
  return { toolNames, ...data };
}

/**
 * İstekteki `target` alanı: yoksa taslak. Geçersiz biçimde null döner (çağıran 400 verir).
 * Sürüm kimliğinin gerçekten bu bota ait olup olmadığı sunucuda `resolveSettings` ile doğrulanır.
 */
export function parseTarget(raw: unknown): TurnTarget | null {
  if (raw === undefined || raw === null || raw === "draft") return "draft";
  if (raw === "published") return "published";
  if (typeof raw === "object" && !Array.isArray(raw)) {
    const id = (raw as { versionId?: unknown }).versionId;
    if (typeof id === "string" && id.length > 0 && id.length <= 64) return { versionId: id };
  }
  return null;
}

/** Karakterden kaba token tahmini (~4 karakter/token). */
export function estimateTokens(chars: number): number {
  return Math.ceil(Math.max(0, chars) / 4);
}

/** Modele giden metnin uzunluğu (talimat + metin mesajları); görseller sayılmaz. */
export function promptChars(instructions: string, messages: { content: unknown }[]): number {
  return instructions.length + JSON.stringify(messages.map((m) => (typeof m.content === "string" ? m.content : ""))).length;
}

/**
 * İptal/zaman aşımında token kullanımı. Sağlayıcı yarım adımın kullanımını bildirmez ama
 * istek yine de faturalanır; bu yüzden bildirilen değer ile karakter tahmininin büyüğü alınır
 * (girdi: prompt uzunluğu, çıktı: o ana kadar üretilen metin). Maliyet sınırı 0 görmesin diye.
 */
export function abortedUsage(o: { promptChars: number; outputChars: number; reportedIn: number; reportedOut: number }): { inTok: number; outTok: number } {
  return {
    inTok: Math.max(o.reportedIn, estimateTokens(o.promptChars)),
    outTok: Math.max(o.reportedOut, estimateTokens(o.outputChars)),
  };
}

/** Kesilmenin nedeni: kullanıcı durdurdu ya da bizim koyduğumuz süre doldu. */
export type AbortKind = "user" | "timeout";

const ABORT_NOTES: Record<AbortKind, string> = {
  user: "(Kullanıcı cevabı durdurdu.)",
  timeout: "(Cevap zaman aşımı nedeniyle yarıda kesildi.)",
};

/**
 * `signal.reason`'dan kesinti türü: yalnızca bizim `AbortSignal.timeout` sinyalimiz "TimeoutError" verir.
 * Web sohbetinde `request.signal` "Durdur" ile bağlantı kopmasını ayırt edemez; o yol (ve belirsiz her neden)
 * kullanıcı durdurması sayılır.
 */
export function abortKind(signal: { reason?: unknown } | null | undefined): AbortKind {
  const name = (signal?.reason as { name?: unknown } | null | undefined)?.name;
  return name === "TimeoutError" ? "timeout" : "user";
}

/**
 * Sohbet hazırlığında fırlatılan, bizim ürettiğimiz hata: `message` sabit Türkçe metindir (kullanıcı girdisi içermez).
 * `turn.ts` buradan yeniden dışa aktarır; saf yardımcıların (`describeEvalError`) test edilebilmesi için burada durur.
 */
export class ChatError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

/* ---------- Model hatası metni ---------- */

const ERROR_CODE_RE = /^[A-Z][A-Z0-9_]{1,39}$/;
/** `describeError`'ın ürettiği biçim; kayıt maskelenirken yalnızca bu biçim korunur. */
const SAFE_ERROR_RE = /^(Model hatası|Sağlayıcı hatası|Hazırlık hatası|Zaman aşımı)( \((HTTP \d{3}|\d{1,4} sn|[A-Z][A-Z0-9_]{1,39})\))?$/;

/**
 * Saklanacak kısa hata metni: sınıf + (varsa) HTTP durumu ya da hata kodu. Sağlayıcı hata mesajları
 * kullanıcı girdisini yansıtabildiği için ham `message` hiçbir zaman saklanmaz (ayrıntı sunucu günlüğündedir).
 */
export function describeError(e: unknown): string {
  for (let cur = e, depth = 0; cur && typeof cur === "object" && depth < 3; depth++) {
    const err = cur as { name?: unknown; statusCode?: unknown; code?: unknown; lastError?: unknown; cause?: unknown };
    if (err.name === "TimeoutError") return "Zaman aşımı";
    if (typeof err.statusCode === "number" && err.statusCode >= 100 && err.statusCode <= 599) return `Sağlayıcı hatası (HTTP ${err.statusCode})`;
    if (typeof err.code === "string" && ERROR_CODE_RE.test(err.code)) return `Model hatası (${err.code})`;
    cur = err.lastError ?? err.cause;
  }
  return "Model hatası";
}

const OWN_ERROR_MAX = 200;

/**
 * Senaryo koşusunda saklanacak hata metni. Kendi `ChatError` mesajlarımız (sistem üretimi, sabit metin) olduğu gibi
 * korunur; yönetici neyin yanlış olduğunu görsün. Sağlayıcı/SDK hataları `describeError` ile genel metne iner.
 */
export function describeEvalError(e: unknown): string {
  if (e instanceof ChatError) {
    const msg = e.message.trim().slice(0, OWN_ERROR_MAX);
    if (msg) return msg;
  }
  return describeError(e);
}

/** Kayıtlı hata metnini maskelemede: `describeError` biçimi kalır, başka her şey (eski ham mesajlar) genel sınıfa iner. */
export function redactErrorText(error: string | null | undefined): string | null {
  if (!error) return null;
  return SAFE_ERROR_RE.test(error) ? error : "Model hatası";
}

/** İptal edilen cevabın kaydedilen metni: kısmi metin + kesinti notu (varsayılan: kullanıcı durdurdu). */
export function abortedContent(partial: string, kind: AbortKind = "user"): string {
  const text = partial.trim();
  const note = ABORT_NOTES[kind];
  return text ? `${text}

${note}` : note;
}
