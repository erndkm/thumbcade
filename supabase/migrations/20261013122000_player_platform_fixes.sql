-- Player Platform (stream A): compute_trending must have a WHERE clause (pg-safeupdate is active
-- for API sessions), and hashtags no longer used by any live game decay to zero.

create or replace function public.compute_trending()
returns void language plpgsql security definer set search_path = public as $$
declare
  today date := (now() at time zone 'utc')::date;
begin
  with act as (
    select gh.tag, s.day,
      sum(s.play_starts + 2 * s.likes + 3 * s.shares + s.saves + s.comments)::real a
    from public.game_stats_daily s
    join public.games g on g.id = s.game_id and g.status = 'live'
    join public.game_hashtags gh on gh.game_id = s.game_id
    where s.day >= today - 9
    group by gh.tag, s.day
  ),
  agg as (
    select tag,
      coalesce(sum(a) filter (where day >= today - 2), 0) / 3.0 recent,
      coalesce(sum(a) filter (where day < today - 2), 0) / 7.0 baseline
    from act group by tag
  )
  update public.hashtags h
     set trend_score = coalesce((
       select (ln(1 + agg.recent) * (agg.recent + 5) / (agg.baseline + 5))::real from agg where agg.tag = h.tag
     ), 0)
   where true;
end $$;

revoke execute on function public.compute_trending() from public, anon, authenticated;
grant execute on function public.compute_trending() to service_role;
