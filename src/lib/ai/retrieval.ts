import { embed } from "ai";
import { sqlClient } from "@/db";
import type { ChatMode } from "@/db/schema";
import { draftSourceIds } from "@/lib/kb";
import type { EmbeddingRef } from "./embedding-freeze";
import { chainOf, type KbRow } from "./kb-lifecycle";
import { resolveEmbedding } from "./providers";
import { findSimilar, type SimilarCandidate, type SimilarMatch } from "./similar-core";
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

/** Aday parça: `relevant` false ise eşik altında kalmıştır ve bağlama girmez (yalnızca önizleme gösterir). */
export type RankedKnowledgeHit = KnowledgeHit & { relevant: boolean };

type SearchOpts = {
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
};

export async function searchKnowledge(opts: SearchOpts): Promise<KnowledgeHit[]> {
  return (await searchKnowledgeRanked(opts))
    .filter((h) => h.relevant)
    .slice(0, opts.topK)
    .map(
      (h, i): KnowledgeHit => ({
        chunkId: h.chunkId,
        sourceId: h.sourceId,
        title: h.title,
        type: h.type,
        content: h.content,
        score: h.score,
        similarity: h.similarity,
        lexical: h.lexical,
        rank: i + 1,
      }),
    );
}

/** Eşik altındakiler dahil tüm adaylar, puana göre sıralı (rank 1'den başlar). Prompt önizleme kalibrasyon için kullanır. */
export async function searchKnowledgeRanked(opts: SearchOpts): Promise<RankedKnowledgeHit[]> {
  const { botId, mode, query, allowedSourceIds } = opts;
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

  return rankHits({ lexRows, vecRows, termCount: terms.length, minSimilarity }).map((h, i) => ({
      chunkId: h.row.id,
      sourceId: h.row.source_id,
      title: h.row.title,
      type: h.row.type,
      content: h.row.content,
      score: h.score,
      similarity: h.similarity,
      lexical: h.lexical,
      relevant: h.relevant,
      rank: i + 1,
    }));
}

type QaRow = SimilarCandidate & { deleted_at: Date | null; superseded_by: string | null; chunk_count: number; status: string };

/**
 * Tekrar kontrolü: aynı kapsamdaki (aynı mod ya da "all") SSS/düzeltmeler arasında aynı ya da
 * çok benzer soruyu bulur (en fazla 3). Soru eşitliği ve kelime örtüşmesi kaynak satırlarından,
 * anlamsal benzerlik (embedding açıksa) kayıtlı parçaların vektörlerinden hesaplanır; eşikler
 * similar-core.ts içindedir. `excludeSourceId` düzenlenen kaydın kendisidir (eski halleriyle
 * birlikte aday olmaz). Vektör araması başarısız olursa yalnızca soru karşılaştırmasıyla devam eder.
 */
export async function findSimilarQa(opts: {
  botId: string;
  question: string;
  answer?: string;
  mode: ChatMode | "all";
  excludeSourceId?: string;
}): Promise<SimilarMatch[]> {
  const rows = await sqlClient<QaRow[]>`
    select id, title, question, mode, type, deleted_at, superseded_by, chunk_count, status
    from kb_sources
    where bot_id = ${opts.botId} and type in ('qa', 'correction') and question is not null`;
  const life: KbRow[] = rows.map((r) => ({ id: r.id, deletedAt: r.deleted_at, supersededBy: r.superseded_by, chunkCount: r.chunk_count, status: r.status }));
  const exclude = new Set(opts.excludeSourceId ? chainOf(opts.excludeSourceId, life) : []);
  // Kayıt başına tek satır: zincirin başı (eski halleri ve silinmişler hariç).
  const heads = rows.filter((r) => !r.deleted_at && !r.superseded_by && !exclude.has(r.id));
  if (!heads.length) return [];

  const vectorScores = new Map<string, number>();
  const emb = await resolveEmbedding().catch(() => null);
  if (emb) {
    try {
      const { embedding } = await embed({ model: emb.model, value: `Soru: ${opts.question}\nCevap: ${opts.answer ?? ""}` });
      const vec = `[${embedding.join(",")}]`;
      const ids = heads.map((h) => h.id);
      const hits = await sqlClient<{ source_id: string; similarity: number }[]>`
        select c.source_id, max(1 - (c.embedding <=> ${vec}::vector))::float8 as similarity
        from kb_chunks c
        where c.bot_id = ${opts.botId}
          and c.embedding_model = ${emb.id}
          and c.source_id = any(${ids}::uuid[])
        group by c.source_id`;
      for (const h of hits) vectorScores.set(h.source_id, h.similarity);
    } catch (e) {
      console.error("[retrieval] tekrar kontrolünde vektör araması başarısız, soru karşılaştırmasıyla devam:", e);
    }
  }
  return findSimilar({
    question: opts.question,
    mode: opts.mode,
    candidates: heads.map((h) => ({ id: h.id, title: h.title, question: h.question, mode: h.mode, type: h.type })),
    vectorScores,
  });
}
