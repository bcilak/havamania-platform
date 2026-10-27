/** Formdaki bir metin sınırı aşıyorsa kullanıcıya gösterilecek Türkçe mesaj; aşmıyorsa null. */
export function limitMessage(label: string, max: number, length: number): string | null {
  return length > max ? `${label} en fazla ${max} karakter olabilir (şu an ${length}).` : null;
}

/** Sürüm notunun azami uzunluğu (yayın formu, not düzenleme ve sunucu doğrulaması aynı değeri kullanır). */
export const VERSION_NOTE_MAX = 300;
