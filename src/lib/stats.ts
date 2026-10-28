import { sqlClient } from "@/db";
import type { GapQuestion } from "@/lib/gaps";
import type { ToolCountRow, VersionCountRow, WeeklyRow } from "@/lib/trends";

/*
 * Pano sorguları. Test alanı konuşmaları istatistiklere katılmaz.
 * Maliyet = model + arama (mesaj başına sorgu embedding'i) + vektörleme (kaynak işlenirken embedding; olay anına göre
 * kb_embedding_usage'dan; tablonun ilk kaydından önceki dönem için kb_sources.updated_at yedeği). Mesaj cost_usd'si arama maliyetini içerir.
 */

export async function periodStats(days: number, offsetDays = 0) {
  const [row] = await sqlClient<
    { conversations: number; users: number; assistant: number; negative: number; cost: number; model_cost: number; search_cost: number; ingest_cost: number }[]
  >`
    with win as (
      select now() - make_interval(days => ${days + offsetDays}) as since,
             now() - make_interval(days => ${offsetDays}) as until
    ), ing as (
      select (select coalesce(sum(u.cost_usd), 0)::float from kb_embedding_usage u, win where u.created_at >= win.since and u.created_at < win.until)
           + (select coalesce(sum(s.embedding_cost_usd), 0)::float from kb_sources s, win
                where s.updated_at >= win.since and s.updated_at < win.until
                  and s.updated_at < coalesce((select min(u.created_at) from kb_embedding_usage u), 'infinity'::timestamptz)) as v
    )
    select
      (select count(*)::int from conversations c, win where c.platform <> 'playground' and c.created_at >= win.since and c.created_at < win.until) as conversations,
      (select count(distinct c.app_user_id)::int from conversations c, win where c.platform <> 'playground' and c.last_message_at >= win.since and c.last_message_at < win.until) as users,
      (select count(*)::int from messages m join conversations c on c.id = m.conversation_id, win
         where c.platform <> 'playground' and m.role = 'assistant' and m.created_at >= win.since and m.created_at < win.until) as assistant,
      (select count(*)::int from feedback f join conversations c on c.id = f.conversation_id, win
         where c.platform <> 'playground' and f.rating = -1 and f.created_at >= win.since and f.created_at < win.until) as negative,
      (select coalesce(sum(m.cost_usd), 0)::float from messages m join conversations c on c.id = m.conversation_id, win
         where c.platform <> 'playground' and m.created_at >= win.since and m.created_at < win.until)
       + (select v from ing) as cost,
      (select coalesce(sum(m.cost_usd - coalesce(m.embedding_cost_usd, 0)), 0)::float from messages m join conversations c on c.id = m.conversation_id, win
         where c.platform <> 'playground' and m.created_at >= win.since and m.created_at < win.until) as model_cost,
      (select coalesce(sum(m.embedding_cost_usd), 0)::float from messages m join conversations c on c.id = m.conversation_id, win
         where c.platform <> 'playground' and m.created_at >= win.since and m.created_at < win.until) as search_cost,
      (select v from ing) as ingest_cost`;
  return row;
}

export async function dailyConversations(days = 14) {
  const rows = await sqlClient<{ day: string; n: number }[]>`
    with days as (
      select generate_series(
        (now() at time zone 'Europe/Istanbul')::date - ${days - 1}::int,
        (now() at time zone 'Europe/Istanbul')::date,
        interval '1 day'
      )::date as day
    )
    select to_char(d.day, 'YYYY-MM-DD') as day, count(c.id)::int as n
    from days d
    left join conversations c
      on (c.created_at at time zone 'Europe/Istanbul')::date = d.day and c.platform <> 'playground'
    group by d.day
    order by d.day`;
  const fmt = new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "short", timeZone: "UTC" });
  return rows.map((r) => ({ day: r.day, label: fmt.format(new Date(`${r.day}T00:00:00Z`)), value: r.n }));
}

export async function breakdown(days: number) {
  const modes = await sqlClient<{ key: string; n: number }[]>`
    select mode as key, count(*)::int as n from conversations
    where platform <> 'playground' and created_at >= now() - make_interval(days => ${days})
    group by mode`;
  const platforms = await sqlClient<{ key: string; n: number }[]>`
    select platform as key, count(*)::int as n from conversations
    where platform <> 'playground' and created_at >= now() - make_interval(days => ${days})
    group by platform`;
  return { modes, platforms };
}

/** Boşluk analizi için üst sınırlar: ne kadar geriye ve en çok kaç soru okunur. */
export const GAP_MAX_DAYS = 90;
export const GAP_MAX_QUESTIONS = 1000;

/*
 * Boşluk analizinin ham verisi: cevapsız (bilgi tabanında karşılık yok, araç yok) ya da olumsuz geri bildirimli
 * asistan cevaplarının kullanıcı soruları, en yeniden eskiye, en çok `limit` tane. Test alanı, örnek veri ve
 * anonimleştirilmiş konuşmalar ile sağlık bilgisi içerebilen (health_context) konuşmalar katılmaz: sorular senaryo/düzeltme olarak kopyalanabildiği için. Yalnızca metni olan sorular alınır (fotoğraf-only gruplanamaz).
 */
export async function gapQuestions(opts: { days: number; mode?: string | null; limit?: number }): Promise<GapQuestion[]> {
  const days = Math.min(GAP_MAX_DAYS, Math.max(1, Math.floor(opts.days)));
  const limit = Math.min(GAP_MAX_QUESTIONS, Math.max(1, Math.floor(opts.limit ?? GAP_MAX_QUESTIONS)));
  const mode = opts.mode ?? null;
  const rows = await sqlClient<
    { id: string; conversation_id: string; at_ms: number; mode: string; question: string; unanswered: boolean; negative: boolean }[]
  >`
    select m.id, m.conversation_id, (extract(epoch from m.created_at) * 1000)::float8 as at_ms, c.mode, q.content as question,
      m.unanswered, coalesce(f.rating = -1, false) as negative
    from messages m
    join conversations c on c.id = m.conversation_id
    left join feedback f on f.message_id = m.id
    join lateral (
      select u.content from messages u
      where u.conversation_id = m.conversation_id and u.role = 'user' and u.created_at <= m.created_at
      order by u.created_at desc limit 1
    ) q on true
    where m.role = 'assistant'
      and (m.unanswered or f.rating = -1)
      and c.platform <> 'playground' and not c.is_demo and c.anonymized_at is null
      and not c.health_context
      and m.created_at >= now() - make_interval(days => ${days})
      and (${mode}::text is null or c.mode = ${mode})
      and btrim(q.content) <> ''
    order by m.created_at desc
    limit ${limit}`;
  return rows.map((r) => ({
    messageId: r.id,
    conversationId: r.conversation_id,
    question: r.question,
    mode: r.mode,
    at: new Date(r.at_ms),
    unanswered: r.unanswered,
    negative: r.negative,
  }));
}

/*
 * Haftalık kalite serisi (pazartesi başlangıçlı, Europe/Istanbul): asistan cevabı, olumsuz geri bildirimli ve
 * cevapsız cevap sayıları. Boş haftalar 0 ile dolar. Test alanı ve örnek veri katılmaz.
 */
export async function weeklyQuality(weeks = 8): Promise<WeeklyRow[]> {
  const n = Math.min(26, Math.max(1, Math.floor(weeks)));
  return sqlClient<WeeklyRow[]>`
    with weeks as (
      select generate_series(
        date_trunc('week', now() at time zone 'Europe/Istanbul')::date - ${(n - 1) * 7}::int,
        date_trunc('week', now() at time zone 'Europe/Istanbul')::date,
        interval '7 days'
      )::date as week
    ),
    base as (
      select (m.created_at at time zone 'Europe/Istanbul')::date as d, m.unanswered, coalesce(f.rating = -1, false) as neg
      from messages m
      join conversations c on c.id = m.conversation_id
      left join feedback f on f.message_id = m.id
      where m.role = 'assistant' and c.platform <> 'playground' and not c.is_demo
        and m.created_at >= now() - make_interval(days => ${n * 7 + 7})
    )
    select to_char(w.week, 'YYYY-MM-DD') as day,
      count(b.d)::int as assistant,
      count(b.d) filter (where b.neg)::int as negative,
      count(b.d) filter (where b.unanswered)::int as unanswered
    from weeks w
    left join base b on b.d >= w.week and b.d < w.week + 7
    group by w.week
    order by w.week`;
}

/*
 * Araç çağrıları: `messages.tool_calls[].output` bir `ApiResult`'tır ({ ok, data } ya da { ok: false, code, error }).
 * Araç adı, ok değeri ve hata koduna göre sayılır; toplama trends.summarizeTools'tadır. jsonb açma son `days` günle sınırlıdır; dizi olmayan (null, string, nesne) değerler boş sayılır.
 */
export async function toolCounts(days = 30): Promise<ToolCountRow[]> {
  return sqlClient<ToolCountRow[]>`
    select x.call->>'name' as name, x.call->'output'->>'ok' as ok, x.call->'output'->>'code' as code, count(*)::int as n
    from messages m
    join conversations c on c.id = m.conversation_id
    cross join lateral jsonb_array_elements(case when jsonb_typeof(m.tool_calls) = 'array' then m.tool_calls else '[]'::jsonb end) as x(call)
    where m.role = 'assistant' and m.created_at >= now() - make_interval(days => ${days})
      and c.platform <> 'playground' and not c.is_demo    group by 1, 2, 3`;
}

/*
 * Sürüm başına kalite (`conversations.version_number`): konuşma, asistan cevabı, olumsuz ve cevapsız sayıları.
 * `days` verilirse yalnızca o aralıktaki cevaplar sayılır; `versionNumber` verilirse tek sürüm.
 */
export async function versionCounts(opts: { days?: number | null; versionNumber?: number; limit?: number } = {}): Promise<VersionCountRow[]> {
  const days = opts.days ?? null;
  const only = opts.versionNumber ?? null;
  const limit = Math.min(50, Math.max(1, opts.limit ?? 10));
  return sqlClient<VersionCountRow[]>`
    select c.version_number as number,
      count(distinct c.id)::int as conversations,
      count(m.id)::int as assistant,
      count(m.id) filter (where f.rating = -1)::int as negative,
      count(m.id) filter (where m.unanswered)::int as unanswered
    from conversations c
    join messages m on m.conversation_id = c.id and m.role = 'assistant'
    left join feedback f on f.message_id = m.id
    where c.version_number is not null and c.platform <> 'playground' and not c.is_demo
      and (${days}::int is null or m.created_at >= now() - make_interval(days => ${days}::int))
      and (${only}::int is null or c.version_number = ${only}::int)
    group by c.version_number
    order by c.version_number desc
    limit ${limit}`;
}
