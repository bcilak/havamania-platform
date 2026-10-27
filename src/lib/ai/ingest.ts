import { embedMany } from "ai";
import { and, eq, inArray, isNull, lt, or } from "drizzle-orm";
import { parse } from "node-html-parser";
import { db } from "@/db";
import { kbChunks, kbSources } from "@/db/schema";
import { beginReprocess } from "@/lib/kb";
import { safeFetchText } from "@/lib/net/safe-fetch";
import { storage } from "@/lib/storage";
import { chunkText } from "./chunking";
import { decodeText, docxToText, nodeToText, pdfPagesToText } from "./extract-text";
import { CLAIMABLE_STATUSES, planIngest, STALE_PROCESSING_MS } from "./ingest-core";
import { embeddingCostOf } from "./embedding-cost";
import { recordEmbeddingUsage } from "./embedding-usage";
import { resolveEmbedding } from "./providers";

type SourceRow = typeof kbSources.$inferSelect;

/** Çıkarılan metin ve panelde uyarı olarak gösterilecek notlar. */
type Extracted = { text: string; notes: (string | null)[] };

async function extractPdf(data: Uint8Array): Promise<Extracted> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(data);
  const { text } = await extractText(pdf, { mergePages: false });
  const { text: joined, warning } = pdfPagesToText(Array.isArray(text) ? text : [text]);
  return { text: joined, notes: [warning] };
}

export async function fetchUrlText(url: string): Promise<{ title: string; text: string }> {
  // SSRF korumalı çekim: özel ağlara bağlanmaz, yönlendirmeleri yeniden doğrular, 5 MB ve 15 sn sınırı vardır.
  const { text: html } = await safeFetchText(url);
  const root = parse(html);
  root.querySelectorAll("script,style,noscript,svg,nav,footer,header,form,iframe").forEach((n) => n.remove());
  const title = root.querySelector("title")?.text.trim() || url;
  const main = root.querySelector("main") ?? root.querySelector("article") ?? root.querySelector("body") ?? root;
  return { title, text: nodeToText(main) };
}

/**
 * Sahiplik koşulu: satır hâlâ bu işleyicinin aldığı `processing` hâlindedir. Alma anındaki
 * `updatedAt` belirteçtir; yeniden işleme (beginReprocess), başka bir işleyicin takılı satırı
 * yeniden alması ya da silme `updatedAt`'i değiştirir ve bu işleyicinin sonucu atılır.
 */
const owned = (sourceId: string, claimedAt: Date) =>
  and(eq(kbSources.id, sourceId), eq(kbSources.status, "processing"), eq(kbSources.updatedAt, claimedAt));

async function extract(source: SourceRow, claimedAt: Date): Promise<Extracted> {
  switch (source.type) {
    case "qa":
    case "correction":
      return { text: `Soru: ${source.question ?? ""}\nCevap: ${source.answer ?? ""}`, notes: [] };
    case "url": {
      if (!source.url) throw new Error("URL eksik.");
      const { title, text } = await fetchUrlText(source.url);
      // Başlık henüz adresin kendisiyse sayfanın gerçek başlığıyla değiştir.
      if (source.title === source.url && title) {
        await db.update(kbSources).set({ title: title.slice(0, 200) }).where(owned(source.id, claimedAt));
      }
      return { text, notes: [] };
    }
    case "cms":
      return { text: source.answer ?? "", notes: [] };
    case "file": {
      if (!source.storageKey) throw new Error("Dosya bulunamadı.");
      const file = await storage.get(source.storageKey);
      if (!file) throw new Error("Dosya depoda bulunamadı.");
      const mt = source.mediaType ?? file.contentType;
      if (mt.includes("pdf")) return extractPdf(file.data);
      if (mt.includes("wordprocessingml")) return { text: await docxToText(file.data), notes: [] };
      if (mt.startsWith("text/")) {
        const { text, note } = decodeText(file.data);
        return { text, notes: [note] };
      }
      throw new Error("Desteklenmeyen dosya türü. PDF, DOCX, TXT veya MD yükleyin.");
    }
  }
}

/**
 * Kaynağı metne çevirir, parçalar, (yapılandırıldıysa) vektörler ve kaydeder.
 * Eski parçalar yalnızca yeni parçalar hazırken, tek transaction'da değişir;
 * hata olursa eski içerik yerinde kalır. Vektörleme hatası kaynağı düşürmez.
 */
export async function processSource(sourceId: string): Promise<void> {
  // Tek işleyici: durum geçişi atomiktir. Aynı kaynak için ikinci eşzamanlı çağrı
  // satırı `processing` görür, hiçbir şey almadan çıkar (parçalar çiftlenmez).
  // Uzun süredir güncellenmeyen `processing` satırı takılı sayılır ve yeniden alınır.
  // Alma anındaki `updatedAt` sahiplik belirtecidir (bkz. owned): işlem sırasında satır
  // yeniden işlemeye alınır ya da takılı sayılıp başkası tarafından alınırsa bu işleyicinin
  // yazmaları ve hata durumu yok sayılır. Bu yüzden 15 dk eşiği güvenlidir; belirteç
  // yenileme (heartbeat) gerekmez, eşiği aşan iş en kötü ihtimalle boşa çalışmış olur.
  const claimedAt = new Date();
  const stale = new Date(claimedAt.getTime() - STALE_PROCESSING_MS);
  const [source] = await db
    .update(kbSources)
    .set({ status: "processing", error: null, warning: null, updatedAt: claimedAt })
    .where(
      and(
        eq(kbSources.id, sourceId),
        or(inArray(kbSources.status, [...CLAIMABLE_STATUSES]), and(eq(kbSources.status, "processing"), lt(kbSources.updatedAt, stale))),
      ),
    )
    .returning();
  if (!source) return;
  try {
    const { text: rawText, notes } = await extract(source, claimedAt);
    const emb = await resolveEmbedding().catch(() => null);
    const single = source.type === "qa" || source.type === "correction";
    // Vektörleme kullanımı: token (AI SDK usage) × sağlayıcıdaki embedding fiyatı.
    let embeddingTokens = 0;
    const plan = await planIngest({
      rawText,
      notes,
      chunk: (t) => (single ? [t] : chunkText(t)),
      embed: emb
        ? async (values) => {
            const res = await embedMany({ model: emb.model, values, maxParallelCalls: 2 });
            embeddingTokens = res.usage?.tokens ?? 0;
            return res.embeddings;
          }
        : null,
    });
    const { text, pieces, vectors, warning } = plan;
    const embeddingModel = vectors && emb ? emb.id : null;
    const tokens = vectors && emb ? embeddingTokens : 0;
    // Harcama olay anında kaydedilir (sonuç sahiplik kaybıyla atılsa da para harcandı).
    if (tokens && emb) await recordEmbeddingUsage({ botId: source.botId, sourceId, kind: "ingest", tokens, costUsd: embeddingCostOf(tokens, emb.pricePer1M) });

    await db.transaction(async (tx) => {
      // Kaynak satırı sahiplik koşuluyla kilitlenir: parça silme + ekleme sırayla çalışır ve
      // yalnızca satırı hâlâ tutan işleyici yazar. Kilit beklerken koşul yeniden değerlendirilir;
      // arada yeniden işleme/başka bir alma olduysa satır dönmez.
      const [locked] = await tx.select({ id: kbSources.id }).from(kbSources).where(owned(sourceId, claimedAt)).for("update");
      if (!locked) return; // sahiplik kaybedildi ya da kaynak kalıcı silindi: sonuç atılır
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
        .set({
          status: "ready",
          warning,
          charCount: text.length,
          chunkCount: pieces.length,
          embeddingModel,
          embeddingTokens: tokens || null,
          embeddingCostUsd: tokens && emb ? embeddingCostOf(tokens, emb.pricePer1M) : null,
          updatedAt: new Date(),
        })
        .where(owned(sourceId, claimedAt));
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    // Sahiplik kaybedildiyse (ör. başkası bu arada başarıyla bitirdi) hata durumu yazılmaz.
    await db.update(kbSources).set({ status: "failed", error: message.slice(0, 500), updatedAt: new Date() }).where(owned(sourceId, claimedAt));
  }
}

/**
 * Embedding modeli değişince tüm kaynakları yeniden işler. Yayındaki kaynaklar
 * yeni satırlarda işlenir (bkz. beginReprocess); yeni yayına kadar canlıya girmez.
 */
export async function reindexAll(botId: string): Promise<number> {
  const rows = await db
    .select({ id: kbSources.id })
    .from(kbSources)
    .where(and(eq(kbSources.botId, botId), isNull(kbSources.deletedAt), isNull(kbSources.supersededBy)));
  for (const r of rows) {
    try {
      const id = await beginReprocess(botId, r.id);
      if (id) await processSource(id);
    } catch (e) {
      console.error("[ingest] yeniden işleme başlatılamadı:", e);
    }
  }
  return rows.length;
}
