import { embed } from "ai";
import { sqlClient } from "@/db";
import type { ChatMode } from "@/db/schema";
import { draftSourceIds } from "@/lib/kb";
import type { EmbeddingRef } from "./embedding-freeze";
import { chainOf, type KbRow } from "./kb-lifecycle";
import { resolveEmbedding } from "./providers";
import { findSimilar, type SimilarCandidate, type SimilarMatch } from "./similar-core";
import {
  dedupeHits,
  fuseRanked,
  DEFAULT_DOMAIN_STOPWORDS,
  DEFAULT_MIN_SIMILARITY,
  DEFAULT_PER_SOURCE_MAX,
  rankHits,
  searchTerms,
  type DedupeStatus,
  type LexRow,
  type RankedHit,
  type VecRow,
} from "./retrieval-core";

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

/**
 * Aday parça: `relevant` false ise eşik altında kalmıştır ve bağlama girmez (yalnızca önizleme gösterir).
 * `dedup` doluysa parça ilgilidir ama tekilleştirmede elenmiştir (tekrar, kaynak sınırı ya da komşuyla birleşti).
 */
export type RankedKnowledgeHit = KnowledgeHit & { relevant: boolean; dedup?: Exclude<DedupeStatus, "keep"> };

/** Aramanın embedding kullanımı: sorgu vektörü için harcanan token ve model fiyatı. */
export type SearchUsage = { embeddingTokens: number; embeddingModel: string | null; embeddingPricePer1M: number };

type SearchOpts = {
  botId: string;
  mode: ChatMode;
  query: string;
  /**
   * Takip sorusunda mevcut mesajın kendisi: birleşik sorguyla ayrıca aranır ve sonuçlar RRF ile birleştirilir
   * (yanlış birleşme kaynağı kaçırmasın).
   */
  alsoQuery?: string;
  /** null = taslak/test: silinmemiş ve yerine geçeni olmayan kaynaklar. Dizi = yayındaki sürümün kaynakları (silinmiş olsalar da). */
  allowedSourceIds: string[] | null;
  topK: number;
  /** Bu kosinüs değerinin altındaki vektör sonuçları kelime eşleşmesi yoksa elenir. */
  minSimilarity?: number;
  /** Önek sorgusundan çıkarılan, alanda her yerde geçen kelimeler. */
  domainStopwords?: string[];
  /** Aynı kaynaktan bağlama girebilecek en fazla parça (varsayılan 3). */
  perSourceMax?: number;
  /**
   * Yayındaki sürümün dondurulmuş embedding ayarı: sorgu vektörü bu modelle üretilir ve
   * yalnızca o modelle vektörlenmiş parçalarla karşılaştırılır. Boşsa (taslak/test ya da
   * eski sürüm) güncel ayar kullanılır.
   */
  embedding?: EmbeddingRef | null;
};

function toHits(ranked: RankedKnowledgeHit[], topK: number): KnowledgeHit[] {
  return ranked
    .filter((h) => h.relevant && !h.dedup)
    .slice(0, topK)
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

export async function searchKnowledge(opts: SearchOpts): Promise<KnowledgeHit[]> {
  return toHits((await searchKnowledgeFull(opts)).ranked, opts.topK);
}

/** Sohbet turu için: bağlama giren parçalar ve sorgu embedding'inin kullanımı (maliyet kaydı). */
export async function searchKnowledgeWithUsage(opts: SearchOpts): Promise<{ hits: KnowledgeHit[]; usage: SearchUsage }> {
  const { ranked, usage } = await searchKnowledgeFull(opts);
  return { hits: toHits(ranked, opts.topK), usage };
}

/** Eşik altındakiler dahil tüm adaylar, puana göre sıralı (rank 1'den başlar). Prompt önizleme kalibrasyon için kullanır. */
export async function searchKnowledgeRanked(opts: SearchOpts): Promise<RankedKnowledgeHit[]> {
  return (await searchKnowledgeFull(opts)).ranked;
}

async function searchKnowledgeFull(opts: SearchOpts): Promise<{ ranked: RankedKnowledgeHit[]; usage: SearchUsage }> {
  const { botId, mode, query, allowedSourceIds } = opts;
  const minSimilarity = opts.minSimilarity ?? DEFAULT_MIN_SIMILARITY;
  const usage: SearchUsage = { embeddingTokens: 0, embeddingModel: null, embeddingPricePer1M: 0 };
  // Kaynak durumu aranmaz: parçalar yalnızca başarılı bir işlemin sonunda yazılır,
  // yeniden işleme ya da başarısız deneme sırasında eski parçalar aranabilir kalır.
  const ids = allowedSourceIds ?? (await draftSourceIds(botId));
  if (ids.length === 0) return { ranked: [], usage };

  const domainStopwords = opts.domainStopwords ?? DEFAULT_DOMAIN_STOPWORDS;
  const emb = await resolveEmbedding(allowedSourceIds ? (opts.embedding ?? undefined) : undefined).catch(() => null);

  const runOne = async (q: string): Promise<RankedHit[]> => {
    const terms = searchTerms(q, domainStopwords);
    let lexRows: LexRow[] = [];
    let vecRows: VecRow[] = [];

    if (terms.length) {
      // Önek terimleri 'simple' ile (sula:*), kısaltmalar tam eşleşme olarak 'turkish' ile (dizin Türkçe kök kullanır:
      // "NOTAM" parçada "nota" olarak durur). Tek birleşik sorgu GIN dizinini kullanır; lex_matches terim başınadır.
      const exactTerms = terms.filter((t) => t.exact).map((t) => t.term);
      const prefixTerms = terms.filter((t) => !t.exact).map((t) => t.term);
      lexRows = await sqlClient<LexRow[]>`
        with q as (
          select to_tsquery('turkish', t) as tq from unnest(${exactTerms}::text[]) as t
          union all
          select to_tsquery('simple', t || ':*') as tq from unnest(${prefixTerms}::text[]) as t
        ), live as (
          select tq from q where numnode(tq) > 0
        ), full_q as (
          select string_agg(tq::text, ' | ')::tsquery as tsq from live
        )
        select c.id, c.source_id, c.idx, c.content, s.title, s.type, s.priority,
          (select count(*)::int from live where c.tsv @@ live.tq) as lex_matches
        from kb_chunks c
        join kb_sources s on s.id = c.source_id, full_q
        where c.bot_id = ${botId}
          and c.mode in (${mode}, 'all')
          and c.source_id = any(${ids}::uuid[])
          and c.tsv @@ full_q.tsq
        order by ts_rank_cd(c.tsv, full_q.tsq) desc
        limit 20`;
    }

    if (emb) {
      try {
        const { embedding, usage: embUsage } = await embed({ model: emb.model, value: q });
        usage.embeddingTokens += embUsage?.tokens ?? 0;
        usage.embeddingModel = emb.id;
        usage.embeddingPricePer1M = emb.pricePer1M;
        const vec = `[${embedding.join(",")}]`;
        vecRows = await sqlClient<VecRow[]>`
          select c.id, c.source_id, c.idx, c.content, s.title, s.type, s.priority,
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
    return rankHits({ lexRows, vecRows, termCount: terms.length, minSimilarity });
  };

  const main = await runOne(query);
  const extra = opts.alsoQuery?.trim();
  const merged = extra && extra !== query ? fuseRanked([main, await runOne(extra)]) : main;
  const ranked = merged.map((h, i) => ({
    chunkId: h.row.id,
    sourceId: h.row.source_id,
    idx: h.row.idx,
    title: h.row.title,
    type: h.row.type,
    content: h.row.content,
    score: h.score,
    similarity: h.similarity,
    lexical: h.lexical,
    relevant: h.relevant,
    rank: i + 1,
  }));
  // Tekilleştirme: komşu parçalar birleşir, tekrarlar ve kaynak başına fazlalık elenir.
  const deduped = dedupeHits(ranked, opts.perSourceMax ?? DEFAULT_PER_SOURCE_MAX).map(({ item, status }): RankedKnowledgeHit => {
    return status === "keep" ? item : { ...item, dedup: status };
  });
  return { ranked: deduped, usage };
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
