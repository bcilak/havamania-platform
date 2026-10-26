import { embed } from "ai";
import { sqlClient } from "@/db";
import type { ChatMode } from "@/db/schema";
import { draftSourceIds } from "@/lib/kb";
import type { EmbeddingRef } from "./embedding-freeze";
import { resolveEmbedding } from "./providers";
import { DEFAULT_DOMAIN_STOPWORDS, DEFAULT_MIN_SIMILARITY, prefixTerms, rankHits, type LexRow, type VecRow } from "./retrieval-core";

export type KnowledgeHit = {
  chunkId: string;
  sourceId: string;
  title: string;
  type: string;
  content: string;
  /** Normalize birleşik puan; yalnızca sıralama içindir. */
  score: number;
  /** Kosinüs benzerliği; vektör araması yapılmadıysa ya da parça vektör listesinde değilse null. */
  similarity: number | null;
  /** Sorgu terimlerinin yeterli kısmı kelime olarak eşleşti. */
  lexical: boolean;
  /** 1'den başlayan sıra. */
  rank: number;
};

export async function searchKnowledge(opts: {
  botId: string;
  mode: ChatMode;
  query: string;
  /** null = taslak/test: silinmemiş ve yerine geçeni olmayan kaynaklar. Dizi = yayındaki sürümün kaynakları (silinmiş olsalar da). */
  allowedSourceIds: string[] | null;
  topK: number;
  /** Bu kosinüs değerinin altındaki vektör sonuçları kelime eşleşmesi yoksa elenir. */
  minSimilarity?: number;
  /** Önek sorgusundan çıkarılan, alanda her yerde geçen kelimeler. */
  domainStopwords?: string[];
  /**
   * Yayındaki sürümün dondurulmuş embedding ayarı: sorgu vektörü bu modelle üretilir ve
   * yalnızca o modelle vektörlenmiş parçalarla karşılaştırılır. Boşsa (taslak/test ya da
   * eski sürüm) güncel ayar kullanılır.
   */
  embedding?: EmbeddingRef | null;
}): Promise<KnowledgeHit[]> {
  const { botId, mode, query, allowedSourceIds, topK } = opts;
  const minSimilarity = opts.minSimilarity ?? DEFAULT_MIN_SIMILARITY;
  // Kaynak durumu aranmaz: parçalar yalnızca başarılı bir işlemin sonunda yazılır,
  // yeniden işleme ya da başarısız deneme sırasında eski parçalar aranabilir kalır.
  const ids = allowedSourceIds ?? (await draftSourceIds(botId));
  if (ids.length === 0) return [];

  const terms = prefixTerms(query, opts.domainStopwords ?? DEFAULT_DOMAIN_STOPWORDS);
  let lexRows: LexRow[] = [];
  let vecRows: VecRow[] = [];

  if (terms.length) {
    const tsq = terms.map((t) => `${t}:*`).join(" | ");
    lexRows = await sqlClient<LexRow[]>`
      select c.id, c.source_id, c.content, s.title, s.type, s.priority,
        (select count(*)::int from unnest(${terms}::text[]) as t(term) where c.tsv @@ to_tsquery('simple', t.term || ':*')) as lex_matches
      from kb_chunks c
      join kb_sources s on s.id = c.source_id
      where c.bot_id = ${botId}
        and c.mode in (${mode}, 'all')
        and c.source_id = any(${ids}::uuid[])
        and c.tsv @@ to_tsquery('simple', ${tsq})
      order by ts_rank_cd(c.tsv, to_tsquery('simple', ${tsq})) desc
      limit 20`;
  }

  const emb = await resolveEmbedding(allowedSourceIds ? (opts.embedding ?? undefined) : undefined).catch(() => null);
  if (emb) {
    try {
      const { embedding } = await embed({ model: emb.model, value: query });
      const vec = `[${embedding.join(",")}]`;
      vecRows = await sqlClient<VecRow[]>`
        select c.id, c.source_id, c.content, s.title, s.type, s.priority,
          (1 - (c.embedding <=> ${vec}::vector))::float8 as similarity
        from kb_chunks c
        join kb_sources s on s.id = c.source_id
        where c.bot_id = ${botId}
          and c.mode in (${mode}, 'all')
          and c.embedding_model = ${emb.id}
          and c.source_id = any(${ids}::uuid[])
        order by c.embedding <=> ${vec}::vector
        limit 20`;
    } catch (e) {
      console.error("[retrieval] vektör araması başarısız, tam metinle devam:", e);
    }
  }

  return rankHits({ lexRows, vecRows, termCount: terms.length, minSimilarity })
    .filter((h) => h.relevant)
    .slice(0, topK)
    .map((h, i) => ({
      chunkId: h.row.id,
      sourceId: h.row.source_id,
      title: h.row.title,
      type: h.row.type,
      content: h.row.content,
      score: h.score,
      similarity: h.similarity,
      lexical: h.lexical,
      rank: i + 1,
    }));
}
