/** Formdaki bir metin sınırı aşıyorsa kullanıcıya gösterilecek Türkçe mesaj; aşmıyorsa null. */
export function limitMessage(label: string, max: number, length: number): string | null {
  return length > max ? `${label} en fazla ${max} karakter olabilir (şu an ${length}).` : null;
}

/** Sürüm notunun azami uzunluğu (yayın formu, not düzenleme ve sunucu doğrulaması aynı değeri kullanır). */
export const VERSION_NOTE_MAX = 300;

/**
 * Formdan gelen dönüş yolu (`back`) yalnızca panel içi göreli yol olabilir: "/admin/" ile başlar;
 * protokol, "//" (protokolsüz dış adres), ters eğik çizgi ve denetim karakteri içeremez. Geçersizse `fallback`.
 */
export function safeAdminPath(raw: string, fallback: string): string {
  if (!raw.startsWith("/admin/") || raw.length > 500) return fallback;
  if (raw.includes("//") || raw.includes("\\") || /[\u0000-\u001f\u007f]/.test(raw)) return fallback;
  return raw;
}
