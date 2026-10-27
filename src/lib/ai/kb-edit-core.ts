/*
 * Kaynak düzenleme planı (saf kural): formdan gelen değerlerden hangi alanların
 * değiştiğini ve yazılacak yamayı çıkarır. Yamanın nasıl uygulanacağı (korunan
 * kaynakta yeni satır, korunmayanda yerinde) lib/kb.ts içindeki beginReprocess'tedir.
 */

export type EditableSource = {
  type: string;
  title: string;
  mode: string;
  question: string | null;
  answer: string | null;
};

export type SourcePatch = {
  title?: string;
  mode?: string;
  question?: string;
  answer?: string;
};

export type EditInput = {
  mode: string;
  /** Dosya, web sayfası ve site içeriği için başlık; SSS ve düzeltmede başlık sorudan türetilir. */
  title?: string;
  question?: string;
  answer?: string;
};

/** SSS ve düzeltmenin başlığı soru metninin başıdır (ekleme akışlarıyla aynı uzunluklar). */
const TITLE_LEN: Record<string, number> = { qa: 160, correction: 120 };

export const isQaLike = (type: string): boolean => type === "qa" || type === "correction";

export const derivedTitle = (type: string, question: string): string => question.slice(0, TITLE_LEN[type] ?? 160);

export type EditPlan = {
  patch: SourcePatch;
  /** Değişen alan adları (denetim kaydı ve mesaj için). */
  changed: (keyof SourcePatch)[];
};

/** Yalnızca gerçekten değişen alanlar yamaya girer; değişiklik yoksa `changed` boştur. */
export function planEdit(src: EditableSource, input: EditInput): EditPlan {
  const patch: SourcePatch = {};
  if (input.mode !== src.mode) patch.mode = input.mode;
  if (isQaLike(src.type)) {
    if (input.question !== undefined && input.question !== (src.question ?? "")) patch.question = input.question;
    if (input.answer !== undefined && input.answer !== (src.answer ?? "")) patch.answer = input.answer;
    const title = derivedTitle(src.type, input.question ?? src.question ?? "");
    if (title !== src.title) patch.title = title;
  } else if (input.title && input.title !== src.title) {
    patch.title = input.title;
  }
  return { patch, changed: Object.keys(patch) as (keyof SourcePatch)[] };
}
