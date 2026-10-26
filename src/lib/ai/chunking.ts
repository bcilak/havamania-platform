/** Paragraf sınırlarına saygı duyan, ~1000 karakterlik ve 150 karakter örtüşmeli parçalar. */
export function chunkText(text: string, size = 1000, overlap = 150): string[] {
  const clean = text.replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  if (!clean) return [];
  const paras = clean.split(/\n\n/);
  const chunks: string[] = [];
  let current = "";
  for (const p of paras) {
    if (p.length > size) {
      if (current) chunks.push(current);
      current = "";
      for (let i = 0; i < p.length; i += size - overlap) chunks.push(p.slice(i, i + size));
      continue;
    }
    if ((current + "\n\n" + p).length > size && current) {
      chunks.push(current);
      current = current.slice(-overlap) + "\n\n" + p;
    } else {
      current = current ? `${current}\n\n${p}` : p;
    }
  }
  if (current) chunks.push(current);
  return chunks.map((c) => c.trim()).filter(Boolean);
}
