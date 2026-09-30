import { embed } from "ai";
import { sqlClient } from "@/db";
import type { ChatMode } from "@/db/schema";
import { resolveEmbedding } from "./providers";

export type KnowledgeHit = {
  chunkId: string;
  sourceId: string;
  title: string;
  type: string;
  content: string;
  score: number;
};

const STOPWORDS = new Set(
  "ve ile bir bu şu o da de mi mı mu mü için gibi ama fakat çok daha en ne neden nasıl hangi var yok olur olsun ben sen biz siz onlar benim senin bana sana bunu şunu ise ki ya veya hem her şey kadar sonra önce göre".split(
    " ",
  ),
);

/**
 * Türkçe sondan eklemeli; Postgres'in Türkçe kök bulucusu "sulasam" ile
 * "sulama"yı eşleştiremiyor. Bu yüzden her kelimenin ilk 4 harfiyle önek
 * araması yapılır (sula:*), sonuçlar sıralamayla ayıklanır.
 */
export function buildPrefixQuery(text: string): string | null {
  const words = text
    .toLocaleLowerCase("tr-TR")
    .normalize("NFC")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
  const terms = [...new Set(words.map((w) => w.slice(0, Math.min(w.length, w.length <= 4 ? w.length : 4))))];
  if (!terms.length) return null;
  return terms.map((t) => `${t}:*`).join(" | ");
}

type Row = { id: string; source_id: string; content: string; title: string; type: string; priority: number };

export async function searchKnowledge(opts: {
  botId: string;
  mode: ChatMode;
  query: string;
  /** null = taslak/test: hazır olan tüm kaynaklar. Dizi = yayındaki sürümün kaynakları. */
  allowedSourceIds: string[] | null;
  topK: number;
}): Promise<KnowledgeHit[]> {
  const { botId, mode, query, allowedSourceIds, topK } = opts;
  if (allowedSourceIds && allowedSourceIds.length === 0) return [];
  const ids = allowedSourceIds ?? null;

  const lists: Row[][] = [];

  const tsq = buildPrefixQuery(query);
  if (tsq) {
    const rows = await sqlClient<Row[]>`
      select c.id, c.source_id, c.content, s.title, s.type, s.priority
      from kb_chunks c
      join kb_sources s on s.id = c.source_id
      where c.bot_id = ${botId}
        and c.mode in (${mode}, 'all')
        and s.status = 'ready'
        and (${ids}::uuid[] is null or c.source_id = any(${ids}::uuid[]))
        and c.tsv @@ to_tsquery('simple', ${tsq})
      order by ts_rank_cd(c.tsv, to_tsquery('simple', ${tsq})) desc
      limit 20`;
    lists.push(rows);
  }

  const emb = await resolveEmbedding().catch(() => null);
  if (emb) {
    try {
      const { embedding } = await embed({ model: emb.model, value: query });
      const vec = `[${embedding.join(",")}]`;
      const rows = await sqlClient<Row[]>`
        select c.id, c.source_id, c.content, s.title, s.type, s.priority
        from kb_chunks c
        join kb_sources s on s.id = c.source_id
        where c.bot_id = ${botId}
          and c.mode in (${mode}, 'all')
          and s.status = 'ready'
          and c.embedding_model = ${emb.id}
          and (${ids}::uuid[] is null or c.source_id = any(${ids}::uuid[]))
        order by c.embedding <=> ${vec}::vector
        limit 20`;
      lists.push(rows);
    } catch (e) {
      console.error("[retrieval] vektör araması başarısız, tam metinle devam:", e);
    }
  }

  // Reciprocal rank fusion + öncelik (düzeltmeler ve SSS öne çıkar).
  const scores = new Map<string, { row: Row; score: number }>();
  for (const list of lists) {
    list.forEach((row, rank) => {
      const prev = scores.get(row.id);
      const add = 1 / (60 + rank);
      scores.set(row.id, { row, score: (prev?.score ?? 0) + add });
    });
  }
  const max = 2 / 60;
  return [...scores.values()]
    .map(({ row, score }) => ({ row, score: score + row.priority * 0.004 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map(({ row, score }) => ({
      chunkId: row.id,
      sourceId: row.source_id,
      title: row.title,
      type: row.type,
      content: row.content,
      score: Math.min(1, score / max),
    }));
}
