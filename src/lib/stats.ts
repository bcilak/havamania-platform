import { sqlClient } from "@/db";

/* Pano sorguları. Test alanı konuşmaları istatistiklere katılmaz. */

export async function periodStats(days: number, offsetDays = 0) {
  const [row] = await sqlClient<
    { conversations: number; users: number; assistant: number; negative: number; cost: number }[]
  >`
    with win as (
      select now() - make_interval(days => ${days + offsetDays}) as since,
             now() - make_interval(days => ${offsetDays}) as until
    )
    select
      (select count(*)::int from conversations c, win where c.platform <> 'playground' and c.created_at >= win.since and c.created_at < win.until) as conversations,
      (select count(distinct c.app_user_id)::int from conversations c, win where c.platform <> 'playground' and c.last_message_at >= win.since and c.last_message_at < win.until) as users,
      (select count(*)::int from messages m join conversations c on c.id = m.conversation_id, win
         where c.platform <> 'playground' and m.role = 'assistant' and m.created_at >= win.since and m.created_at < win.until) as assistant,
      (select count(*)::int from feedback f join conversations c on c.id = f.conversation_id, win
         where c.platform <> 'playground' and f.rating = -1 and f.created_at >= win.since and f.created_at < win.until) as negative,
      (select coalesce(sum(m.cost_usd), 0)::float from messages m join conversations c on c.id = m.conversation_id, win
         where m.created_at >= win.since and m.created_at < win.until) as cost`;
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

export async function unansweredQuestions(limit = 5) {
  return sqlClient<{ id: string; conversation_id: string; created_at: Date; mode: string; question: string | null }[]>`
    select m.id, m.conversation_id, m.created_at, c.mode,
      (select u.content from messages u
        where u.conversation_id = m.conversation_id and u.role = 'user' and u.created_at <= m.created_at
        order by u.created_at desc limit 1) as question
    from messages m
    join conversations c on c.id = m.conversation_id
    where m.unanswered and c.platform <> 'playground'
    order by m.created_at desc
    limit ${limit}`;
}
