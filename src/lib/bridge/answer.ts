/*
 * Mobil uygulama düz metin ister: yalnızca satır sonu, **kalın** ve "- " madde. Panelde saklanan metin
 * özgün markdown'dır; dönüşüm yalnızca köprü yanıtında yapılır. Atıflar ([n]) kayıt sırasında zaten
 * temizlenmiş gelir (turn.ts `persistAssistant`).
 */
export function toPlainAnswer(md: string): string {
  return (
    md
      .replace(/\r\n?/g, "\n")
      // Kod çitleri kalkar, içerik kalır.
      .replace(/^[ \t]*```[^\n]*\n?/gm, "")
      // HTML etiketleri atılır; "<5 km" gibi etiket olmayan ifadeler (harfle başlamayan) korunur.
      .replace(/<\/?[a-z][^>]*>/gi, "")
      // Başlık → kalın satır.
      .replace(/^[ \t]*#{1,6}[ \t]+(.+?)[ \t]*$/gm, (_m, t: string) => (/^\*\*.+\*\*$/.test(t) ? t : `**${t}**`))
      // [metin](url) ve ![alt](url) → "metin (url)"
      .replace(/!?\[([^\]\n]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, "$1 ($2)")
      // "* " ve "+ " madde işaretleri → "- "
      .replace(/^([ \t]*)[*+][ \t]+/gm, "$1- ")
      // __kalın__ → **kalın**
      .replace(/(?<![\w_])__(?=\S)([^_\n]+?)(?<=\S)__(?![\w_])/g, "**$1**")
      // Üç ya da daha fazla boş satır ikiye iner.
      .replace(/\n(?:[ \t]*\n){2,}/g, "\n\n")
      .trim()
  );
}
