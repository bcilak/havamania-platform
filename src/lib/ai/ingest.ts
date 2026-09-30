import { embedMany } from "ai";
import { and, eq } from "drizzle-orm";
import mammoth from "mammoth";
import { parse } from "node-html-parser";
import { db } from "@/db";
import { kbChunks, kbSources } from "@/db/schema";
import { storage } from "@/lib/storage";
import { resolveEmbedding } from "./providers";

type SourceRow = typeof kbSources.$inferSelect;

const MAX_CHARS = 400_000;

async function extractPdf(data: Uint8Array): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(data);
  const { text } = await extractText(pdf, { mergePages: true });
  return Array.isArray(text) ? text.join("\n\n") : text;
}

export async function fetchUrlText(url: string): Promise<{ title: string; text: string }> {
  const res = await fetch(url, {
    headers: { "user-agent": "HavamaniaBot/1.0 (+bilgi tabanı)" },
    signal: AbortSignal.timeout(15000),
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`Sayfa ${res.status} döndü.`);
  const type = res.headers.get("content-type") ?? "";
  if (!type.includes("html") && !type.includes("text")) throw new Error(`Desteklenmeyen içerik türü: ${type}`);
  const root = parse(await res.text());
  root.querySelectorAll("script,style,noscript,svg,nav,footer,header,form,iframe").forEach((n) => n.remove());
  const title = root.querySelector("title")?.text.trim() || url;
  const main = root.querySelector("main") ?? root.querySelector("article") ?? root.querySelector("body") ?? root;
  return { title, text: main.structuredText };
}

async function extract(source: SourceRow): Promise<string> {
  switch (source.type) {
    case "qa":
    case "correction":
      return `Soru: ${source.question ?? ""}\nCevap: ${source.answer ?? ""}`;
    case "url": {
      if (!source.url) throw new Error("URL eksik.");
      const { title, text } = await fetchUrlText(source.url);
      // Başlık henüz adresin kendisiyse sayfanın gerçek başlığıyla değiştir.
      if (source.title === source.url && title) {
        await db.update(kbSources).set({ title: title.slice(0, 200) }).where(eq(kbSources.id, source.id));
      }
      return text;
    }
    case "cms":
      return source.answer ?? "";
    case "file": {
      if (!source.storageKey) throw new Error("Dosya bulunamadı.");
      const file = await storage.get(source.storageKey);
      if (!file) throw new Error("Dosya depoda bulunamadı.");
      const mt = source.mediaType ?? file.contentType;
      if (mt.includes("pdf")) return extractPdf(file.data);
      if (mt.includes("wordprocessingml")) {
        const { value } = await mammoth.extractRawText({ buffer: Buffer.from(file.data) });
        return value;
      }
      if (mt.startsWith("text/")) return new TextDecoder().decode(file.data);
      throw new Error("Desteklenmeyen dosya türü. PDF, DOCX, TXT veya MD yükleyin.");
    }
  }
}

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

/** Kaynağı metne çevirir, parçalar, (yapılandırıldıysa) vektörler ve kaydeder. */
export async function processSource(sourceId: string): Promise<void> {
  const [source] = await db.select().from(kbSources).where(eq(kbSources.id, sourceId));
  if (!source) return;
  await db.update(kbSources).set({ status: "processing", error: null, updatedAt: new Date() }).where(eq(kbSources.id, sourceId));
  try {
    const text = (await extract(source)).slice(0, MAX_CHARS);
    const pieces = source.type === "qa" || source.type === "correction" ? [text] : chunkText(text);
    if (!pieces.length) throw new Error("Kaynaktan metin çıkarılamadı.");

    let vectors: number[][] | null = null;
    let embeddingModel: string | null = null;
    const emb = await resolveEmbedding().catch(() => null);
    if (emb) {
      const { embeddings } = await embedMany({ model: emb.model, values: pieces, maxParallelCalls: 2 });
      vectors = embeddings;
      embeddingModel = emb.id;
    }

    await db.transaction(async (tx) => {
      await tx.delete(kbChunks).where(eq(kbChunks.sourceId, sourceId));
      await tx.insert(kbChunks).values(
        pieces.map((content, idx) => ({
          sourceId,
          botId: source.botId,
          mode: source.mode,
          idx,
          content,
          embedding: vectors?.[idx] ?? null,
          embeddingModel,
        })),
      );
      await tx
        .update(kbSources)
        .set({ status: "ready", charCount: text.length, chunkCount: pieces.length, embeddingModel, updatedAt: new Date() })
        .where(eq(kbSources.id, sourceId));
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await db.update(kbSources).set({ status: "failed", error: message.slice(0, 500), updatedAt: new Date() }).where(eq(kbSources.id, sourceId));
  }
}

/** Embedding modeli değişince tüm kaynakları yeniden işler. */
export async function reindexAll(botId: string): Promise<number> {
  const rows = await db.select({ id: kbSources.id }).from(kbSources).where(and(eq(kbSources.botId, botId)));
  for (const r of rows) await processSource(r.id);
  return rows.length;
}
