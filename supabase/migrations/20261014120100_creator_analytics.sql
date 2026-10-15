-- =============================================================================
-- Creator analytics and milestones (docs/prompts/creator-dashboard.md)
--
-- When someone counts (binding, shared with packages/protocol/src/analytics.ts):
--   play    a run the game ended, or one that reached `qualifiedPlayMs` of active playtime (first wins)
--   player  a distinct user with at least one play; guests (anonymous users) count
--   excluded  sessions by the game's creator or an admin never count anywhere
-- Sessions are the source of truth: `play_sessions.qualified_at` decides plays and players, and
-- `play_sessions.active_ms` (reported by the shell, clamped to wall-clock time) decides playtime.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Config (public read through feed_config; admins can tune without a deploy)
-- -----------------------------------------------------------------------------
-- qualifiedPlayMs mirrors QUALIFIED_PLAY_MS in packages/protocol (scripts/test checks they match).
insert into public.feed_config (key, value) values
  ('analytics', '{"qualifiedPlayMs": 3000, "dailyPlayCap": 100, "benchmarkMinGames": 10, "benchmarkMinViews": 200}'::jsonb
     || jsonb_build_object('playtimeSince', to_char(now() at time zone 'utc', 'YYYY-MM-DD'))),
  ('milestones', '{
    "players": [100, 1000, 10000, 100000, 1000000],
    "playtimeHours": [100, 1000, 10000, 100000],
    "bestDay": {"minDaysLive": 7, "minPlayers": 50, "cooldownDays": 7},
    "takingOff": {"ratio": 3, "minPlayers": 200, "cooldownDays": 7}
  }'::jsonb)
on conflict (key) do nothing;

create or replace function public.analytics_config()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce((select value from public.feed_config where key = 'analytics'), '{}'::jsonb)
$$;

create or replace function public.qualified_play_ms()
returns integer language sql stable security definer set search_path = public as $$
  select coalesce((public.analytics_config()->>'qualifiedPlayMs')::integer, 3000)
$$;

-- -----------------------------------------------------------------------------
-- Columns
-- -----------------------------------------------------------------------------
alter table public.play_sessions
  add column if not exists active_ms integer not null default 0 check (active_ms >= 0),
  add column if not exists qualified_at timestamptz,
  add column if not exists excluded boolean not null default false,
  add column if not exists card_id text check (char_length(card_id) <= 80),
  add column if not exists progress_at timestamptz;
create index if not exists play_sessions_game_played on public.play_sessions (game_id, started_at)
  where qualified_at is not null and not excluded;
create index if not exists play_sessions_progress on public.play_sessions (user_id, progress_at)
  where progress_at is not null;

alter table public.games
  add column if not exists player_count bigint not null default 0,
  add column if not exists play_ms_total bigint not null default 0;

alter table public.game_stats_daily
  add column if not exists players integer not null default 0,
  add column if not exists players_7d integer not null default 0,
  add column if not exists players_28d integer not null default 0,
  add column if not exists new_players integer not null default 0,
  add column if not exists plays integer not null default 0,
  add column if not exists bounced_starts integer not null default 0,
  add column if not exists active_play_ms bigint not null default 0,
  add column if not exists views_started integer not null default 0,
  add column if not exists views_played integer not null default 0,
  add column if not exists views_replayed integer not null default 0,
  add column if not exists left_instantly integer not null default 0,
  add column if not exists left_after_watching integer not null default 0,
  add column if not exists left_mid_run integer not null default 0,
  add column if not exists left_after_run integer not null default 0,
  add column if not exists follows integer not null default 0,
  -- Plays by where they started (session launch_reason), and the version that was live when the day was
  -- last rolled up: versions are compared by the days they were live.
  add column if not exists plays_feed integer not null default 0,
  add column if not exists plays_game_page integer not null default 0,
  add column if not exists plays_challenge integer not null default 0,
  add column if not exists version_id uuid references public.game_versions (id) on delete set null,
  add column if not exists ready_ms_p50 integer,
  add column if not exists ready_ms_p90 integer,
  -- New players of this day who came back on the next day / within 7 days. Null until that window is over.
  add column if not exists returned_d1 integer,
  add column if not exists returned_d7 integer,
  -- Demo rows written by scripts/seed.ts; the rollup only replaces them once real events exist that day.
  add column if not exists is_seed boolean not null default false;

-- Counters stay server-controlled (adds the two new ones to the init migration's list).
create or replace function public.games_protect()
returns trigger language plpgsql as $$
begin
  if public.is_service() or public.is_admin() or public.in_trusted_path() then
    return new;
  end if;
  new.slug := old.slug;
  new.creator_id := old.creator_id;
  new.status := old.status;
  new.live_version_id := old.live_version_id;
  new.featured_rank := old.featured_rank;
  new.play_count := old.play_count;
  new.player_count := old.player_count;
  new.play_ms_total := old.play_ms_total;
  new.like_count := old.like_count;
  new.comment_count := old.comment_count;
  new.share_count := old.share_count;
  new.save_count := old.save_count;
  new.is_seed := old.is_seed;
  new.published_at := old.published_at;
  new.controls := old.controls;
  new.score_config := old.score_config;
  return new;
end $$;

-- -----------------------------------------------------------------------------
-- Per-player aggregates. They hold user ids, so creators never read them: no client policies, only the
-- owner-checked creator_* RPCs below.
-- -----------------------------------------------------------------------------
create table if not exists public.game_players (
  game_id uuid not null references public.games (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  first_played_at timestamptz not null,
  last_played_at timestamptz not null,
  plays integer not null default 0,
  active_ms bigint not null default 0,
  days_played integer not null default 0,
  primary key (game_id, user_id)
);
create index if not exists game_players_first on public.game_players (game_id, first_played_at);
create index if not exists game_players_user on public.game_players (user_id);

create table if not exists public.game_player_days (
  game_id uuid not null references public.games (id) on delete cascade,
  day date not null,
  user_id uuid not null references public.profiles (id) on delete cascade,
  plays integer not null default 0,
  active_ms bigint not null default 0,
  primary key (game_id, day, user_id)
);
create index if not exists game_player_days_user on public.game_player_days (game_id, user_id, day);

alter table public.game_players enable row level security;
alter table public.game_player_days enable row level security;
revoke all on public.game_players from anon, authenticated;
revoke all on public.game_player_days from anon, authenticated;

-- -----------------------------------------------------------------------------
-- Milestones and benchmarks
-- -----------------------------------------------------------------------------
create table if not exists public.creator_milestones (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games (id) on delete cascade,
  creator_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('players', 'playtime', 'first_player', 'first_like', 'first_comment', 'first_challenge', 'best_day', 'taking_off')),
  -- players: the count passed; playtime: hours; best_day/taking_off: the UTC day as YYYYMMDD; firsts: 1.
  threshold bigint not null,
  -- players/playtime: the total when reached; best_day: players that day; taking_off: the ratio.
  value double precision not null,
  detail jsonb not null default '{}',
  reached_at timestamptz not null default now(),
  seen_at timestamptz,
  share_code text unique check (share_code ~ '^[a-z0-9]{8,16}$'),
  is_seed boolean not null default false,
  unique (game_id, kind, threshold)
);
create index if not exists creator_milestones_creator on public.creator_milestones (creator_id, reached_at desc);

alter table public.creator_milestones enable row level security;
create policy creator_milestones_read_own on public.creator_milestones for select using (creator_id = auth.uid() or public.is_admin());
revoke insert, update, delete on public.creator_milestones from anon, authenticated;

create table if not exists public.game_benchmarks (
  game_id uuid primary key references public.games (id) on delete cascade,
  computed_at timestamptz not null default now(),
  games_compared integer not null,
  -- metric -> "better than N % of compared live games" (0-100), or null when the game has too little data.
  metrics jsonb not null
);
alter table public.game_benchmarks enable row level security;
create policy game_benchmarks_read_creator on public.game_benchmarks for select using (
  exists (select 1 from public.games g where g.id = game_id and g.creator_id = auth.uid()) or public.is_admin()
);
revoke insert, update, delete on public.game_benchmarks from anon, authenticated;

-- -----------------------------------------------------------------------------
-- Backfill from existing sessions (before the trigger exists, so nothing is counted twice).
-- Old sessions have no active time: playtime is measured from `analytics.playtimeSince` on, never estimated.
-- -----------------------------------------------------------------------------
update public.play_sessions ps
   set excluded = true
  from public.games g
 where g.id = ps.game_id
   and (ps.user_id = g.creator_id or exists (select 1 from public.profiles p where p.id = ps.user_id and p.role = 'admin'));

update public.play_sessions
   set qualified_at = coalesce(ended_at, started_at)
 where qualified_at is null
   and ((ended_at is not null and reject_reason is distinct from 'stale') or duration_ms >= public.qualified_play_ms());

insert into public.game_player_days (game_id, day, user_id, plays, active_ms)
select game_id, (started_at at time zone 'utc')::date, user_id, count(*), 0
  from public.play_sessions
 where qualified_at is not null and not excluded
 group by 1, 2, 3
on conflict do nothing;

insert into public.game_players (game_id, user_id, first_played_at, last_played_at, plays, active_ms, days_played)
select ps.game_id, ps.user_id, min(ps.started_at), max(ps.started_at), count(*), 0,
       (select count(*) from public.game_player_days d where d.game_id = ps.game_id and d.user_id = ps.user_id)
  from public.play_sessions ps
 where ps.qualified_at is not null and not ps.excluded
 group by ps.game_id, ps.user_id
on conflict do nothing;

update public.games g
   set player_count = (select count(*) from public.game_players p where p.game_id = g.id),
       play_count = (
         select coalesce(sum(least(c, coalesce((public.analytics_config()->>'dailyPlayCap')::integer, 100))), 0)
           from (select count(*) c from public.play_sessions ps
                  where ps.game_id = g.id and ps.qualified_at is not null and not ps.excluded
                  group by ps.user_id, (ps.started_at at time zone 'utc')::date) x
       ),
       play_ms_total = 0;

-- -----------------------------------------------------------------------------
-- Counting: one trigger keeps plays, players and playtime current as sessions qualify and report time.
-- -----------------------------------------------------------------------------
create or replace function public.play_sessions_analytics()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_day date := (new.started_at at time zone 'utc')::date;
  v_day_start timestamptz := (new.started_at at time zone 'utc')::date::timestamp at time zone 'utc';
  v_delta bigint := new.active_ms - case when tg_op = 'UPDATE' then old.active_ms else 0 end;
  v_newly boolean := new.qualified_at is not null and (tg_op = 'INSERT' or old.qualified_at is null);
  v_plays_that_day integer;
  v_day_inserted boolean;
  v_player_inserted boolean;
begin
  if new.excluded then
    return null;
  end if;

  -- The game's total adds each session's growth exactly once.
  if v_delta > 0 then
    update public.games set play_ms_total = play_ms_total + v_delta where id = new.game_id;
  end if;

  if v_newly then
    -- The public play count ignores plays past the daily cap per person.
    select count(*) into v_plays_that_day from public.play_sessions ps
     where ps.user_id = new.user_id and ps.game_id = new.game_id and not ps.excluded and ps.qualified_at is not null
       and ps.started_at >= v_day_start and ps.started_at < v_day_start + interval '1 day';
    if v_plays_that_day <= coalesce((public.analytics_config()->>'dailyPlayCap')::integer, 100) then
      update public.games set play_count = play_count + 1 where id = new.game_id;
    end if;

    insert into public.game_player_days as d (game_id, day, user_id, plays, active_ms)
    values (new.game_id, v_day, new.user_id, 1, 0)
    on conflict (game_id, day, user_id) do update set plays = d.plays + 1
    returning (xmax = 0) into v_day_inserted;

    insert into public.game_players as p (game_id, user_id, first_played_at, last_played_at, plays, active_ms, days_played)
    values (new.game_id, new.user_id, new.started_at, new.started_at, 1, 0, 1)
    on conflict (game_id, user_id) do update set
      plays = p.plays + 1,
      first_played_at = least(p.first_played_at, excluded.first_played_at),
      last_played_at = greatest(p.last_played_at, excluded.last_played_at),
      days_played = p.days_played + case when v_day_inserted then 1 else 0 end
    returning (xmax = 0) into v_player_inserted;

    if v_player_inserted then
      update public.games set player_count = player_count + 1 where id = new.game_id;
    end if;
  end if;

  -- A player's time is recomputed from their sessions (bounced ones included), so it stays right however
  -- sessions arrive: one at a time, or many in one statement.
  if v_delta > 0 or v_newly then
    update public.game_player_days d
       set active_ms = (
         select coalesce(sum(ps.active_ms), 0) from public.play_sessions ps
          where ps.user_id = new.user_id and ps.game_id = new.game_id and not ps.excluded
            and ps.started_at >= v_day_start and ps.started_at < v_day_start + interval '1 day')
     where d.game_id = new.game_id and d.day = v_day and d.user_id = new.user_id;
    update public.game_players p
       set active_ms = (
         select coalesce(sum(ps.active_ms), 0) from public.play_sessions ps
          where ps.user_id = new.user_id and ps.game_id = new.game_id and not ps.excluded)
     where p.game_id = new.game_id and p.user_id = new.user_id;
  end if;
  return null;
end $$;

drop trigger if exists play_sessions_analytics on public.play_sessions;
create trigger play_sessions_analytics after insert or update of active_ms, qualified_at on public.play_sessions
  for each row execute function public.play_sessions_analytics();

-- -----------------------------------------------------------------------------
-- Sessions
-- -----------------------------------------------------------------------------
drop function if exists public.start_play_session(uuid, uuid, uuid, text);
create or replace function public.start_play_session(
  p_user uuid, p_game uuid, p_version uuid, p_reason text default 'feed', p_card text default null
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  sid uuid;
  v_creator uuid;
begin
  if not public.is_service() then
    raise exception 'service only' using errcode = '42501';
  end if;
  perform public.enter_trusted();
  select g.creator_id into v_creator from public.games g where g.id = p_game and g.status = 'live';
  if not found then
    raise exception 'game_not_live' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.game_versions v where v.id = p_version and v.game_id = p_game) then
    raise exception 'version_mismatch' using errcode = 'P0002';
  end if;
  -- The play count moved to qualification (play_sessions_analytics): a run only counts once it's a play.
  insert into public.play_sessions (user_id, game_id, version_id, launch_reason, card_id, excluded)
  values (
    p_user, p_game, p_version, coalesce(p_reason, 'feed'), left(p_card, 80),
    p_user = v_creator or exists (select 1 from public.profiles pr where pr.id = p_user and pr.role = 'admin')
  )
  returning id into sid;
  return sid;
end $$;

-- Progress before the run ends. Clamped to wall-clock time (+2 s) and never lowered; qualifies the run at
-- `qualifiedPlayMs`. Returns what was stored.
create or replace function public.record_session_progress(p_session uuid, p_user uuid, p_active_ms integer)
returns table (stored_ms integer, is_qualified boolean)
language plpgsql security definer set search_path = public as $$
declare
  s public.play_sessions;
  v_new integer;
  v_threshold integer := public.qualified_play_ms();
  v_recent integer;
begin
  if not public.is_service() then
    raise exception 'service only' using errcode = '42501';
  end if;
  perform public.enter_trusted();
  select * into s from public.play_sessions ps where ps.id = p_session for update;
  if not found or s.user_id <> p_user then
    raise exception 'bad_session' using errcode = 'P0002';
  end if;
  if s.ended_at is not null then
    return query select s.active_ms, s.qualified_at is not null;
    return;
  end if;
  if s.progress_at is not null and s.progress_at > now() - interval '2 seconds' then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;
  select count(*) into v_recent from public.play_sessions ps where ps.user_id = p_user and ps.progress_at > now() - interval '1 minute';
  if v_recent >= 60 then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;
  v_new := greatest(
    s.active_ms::bigint,
    least(greatest(p_active_ms, 0)::bigint, floor(extract(epoch from (now() - s.started_at)) * 1000)::bigint + 2000)
  )::integer;
  update public.play_sessions ps
     set active_ms = v_new,
         progress_at = now(),
         qualified_at = case when ps.qualified_at is null and v_new >= v_threshold then now() else ps.qualified_at end
   where ps.id = p_session;
  return query select v_new, (s.qualified_at is not null or v_new >= v_threshold);
end $$;

drop function if exists public.finish_play_session(uuid, uuid, double precision, integer, text);
create or replace function public.finish_play_session(
  p_session uuid, p_user uuid, p_score double precision, p_duration_ms integer, p_outcome text default null, p_active_ms integer default null
)
returns table (accepted boolean, reason text, best double precision, is_new_best boolean, percentile real, daily_rank integer)
language plpgsql security definer set search_path = public as $$
declare
  s public.play_sessions;
  v_order text;
  v_max double precision;
  v_guest boolean;
  v_elapsed double precision;
  v_active integer;
  v_reason text;
  v_prev double precision;
  v_best double precision;
  v_new boolean := false;
  v_pct real;
  v_rank integer;
  v_today date := (now() at time zone 'utc')::date;
begin
  if not public.is_service() then
    raise exception 'service only' using errcode = '42501';
  end if;
  perform public.enter_trusted();

  select * into s from public.play_sessions ps where ps.id = p_session for update;
  if not found or s.user_id <> p_user then
    return query select false, 'bad_token'::text, null::double precision, false, null::real, null::integer;
    return;
  end if;

  select coalesce(g.score_config->>'order', 'desc'), (g.score_config->>'max')::double precision
    into v_order, v_max
  from public.games g where g.id = s.game_id;
  select pr.is_guest into v_guest from public.profiles pr where pr.id = p_user;

  if s.ended_at is not null then
    return query select false, 'already_ended'::text, public.viewer_best(p_user, s.game_id), false, null::real, null::integer;
    return;
  end if;

  v_elapsed := extract(epoch from (now() - s.started_at)) * 1000;
  v_prev := public.viewer_best(p_user, s.game_id);
  v_active := greatest(s.active_ms::bigint, least(greatest(coalesce(p_active_ms, s.active_ms), 0)::bigint, floor(v_elapsed)::bigint + 2000))::integer;

  if p_score is null or p_score = 'NaN'::double precision or p_score < 0 or p_score = 'Infinity'::double precision then
    v_reason := 'invalid_score';
  elsif v_max is not null and p_score > v_max then
    v_reason := 'over_max';
  elsif p_duration_ms is null or p_duration_ms < 0 or p_duration_ms > v_elapsed + 5000 or v_elapsed < 400 then
    v_reason := 'impossible_duration';
  elsif coalesce(v_guest, true) then
    v_reason := 'guest';
  end if;

  -- The game ended the run, so it is a play, unless the score or duration looked forged.
  update public.play_sessions ps
     set ended_at = now(), duration_ms = greatest(0, coalesce(p_duration_ms, 0)),
         active_ms = v_active,
         qualified_at = case when ps.qualified_at is null and (v_reason is null or v_reason = 'guest') then now() else ps.qualified_at end,
         score = case when v_reason in ('invalid_score', 'over_max') then null else p_score end,
         outcome = case when p_outcome in ('win', 'lose', 'quit') then p_outcome else null end,
         accepted = v_reason is null, reject_reason = v_reason
   where ps.id = p_session;

  if v_reason is null then
    -- Ranked member score.
    if public.score_better(v_order, p_score, v_prev) then
      insert into public.best_scores (game_id, user_id, best_score, achieved_at, session_id)
      values (s.game_id, p_user, p_score, now(), p_session)
      on conflict (game_id, user_id) do update
        set best_score = excluded.best_score, achieved_at = excluded.achieved_at, session_id = excluded.session_id;
      v_new := true;

      -- "@you beat their score": mutual follows you just passed.
      insert into public.notifications (user_id, type, actor_id, game_id, payload)
      select b.user_id, 'score_beaten', p_user, s.game_id, jsonb_build_object('score', p_score, 'theirBest', b.best_score)
      from public.best_scores b
      where b.game_id = s.game_id and b.user_id <> p_user
        and exists (select 1 from public.follows f where f.follower_id = p_user and f.followee_id = b.user_id)
        and exists (select 1 from public.follows f where f.follower_id = b.user_id and f.followee_id = p_user)
        and public.score_better(v_order, p_score, b.best_score)
        and (v_prev is null or not public.score_better(v_order, v_prev, b.best_score))
        and not public.is_blocked_between(p_user, b.user_id);
    end if;
    insert into public.daily_scores (game_id, user_id, day, best_score, achieved_at)
    values (s.game_id, p_user, v_today, p_score, now())
    on conflict (game_id, day, user_id) do update
      set best_score = excluded.best_score, achieved_at = excluded.achieved_at
      where public.score_better(v_order, excluded.best_score, daily_scores.best_score);
    v_best := public.viewer_best(p_user, s.game_id);
    v_pct := public.today_percentile(s.game_id, p_score, p_user);
    select 1 + count(*) into v_rank from public.daily_scores d
    where d.game_id = s.game_id and d.day = v_today and d.user_id <> p_user
      and public.score_better(v_order, d.best_score, (select d2.best_score from public.daily_scores d2 where d2.game_id = s.game_id and d2.day = v_today and d2.user_id = p_user));
  elsif v_reason = 'guest' then
    v_new := public.score_better(v_order, p_score, v_prev);
    v_best := public.viewer_best(p_user, s.game_id);
    v_pct := public.today_percentile(s.game_id, p_score, p_user);
    v_rank := null;
  else
    v_best := v_prev;
  end if;

  return query select v_reason is null, v_reason, v_best, v_new, v_pct, v_rank;
end $$;

-- -----------------------------------------------------------------------------
-- Rollup: game_stats_daily is what every dashboard number reads (except medians, sources and versions).
-- -----------------------------------------------------------------------------
create or replace function public.rollup_game_stats(p_days integer default 2)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_today date := (now() at time zone 'utc')::date;
  v_since_day date := (now() at time zone 'utc')::date - (greatest(p_days, 1) - 1);
  since timestamptz := ((now() at time zone 'utc')::date - (greatest(p_days, 1) - 1))::timestamp at time zone 'utc';
  v_cap integer := coalesce((public.analytics_config()->>'dailyPlayCap')::integer, 100);
begin
  with ev as (
    select e.game_id, (e.created_at at time zone 'utc')::date as day,
      count(*) filter (where e.type = 'impression') as impressions,
      count(*) filter (where e.type = 'ready') as ready_count,
      count(*) filter (where e.type = 'play_start') as play_starts,
      count(*) filter (where e.type = 'play_end') as play_ends,
      coalesce(sum(e.duration_ms) filter (where e.type = 'play_end'), 0) as total_play_ms,
      count(*) filter (where e.type = 'replay') as replays,
      count(*) filter (where e.type = 'like') as likes,
      count(*) filter (where e.type = 'share') as shares,
      count(*) filter (where e.type = 'save') as saves,
      count(*) filter (where e.type = 'comment') as comments,
      count(*) filter (where e.type = 'follow') as follows,
      count(*) filter (where e.type = 'skip' and e.state = 'PREVIEW' and coalesce(e.dwell_ms, 999999) < 1500) as fast_skips,
      count(*) filter (where e.type = 'skip' and e.state in ('LOADING', 'PREVIEW') and coalesce(e.dwell_ms, 999999) < 1500) as left_instantly,
      count(*) filter (where e.type = 'skip' and e.state = 'PREVIEW' and coalesce(e.dwell_ms, 0) >= 1500) as left_after_watching,
      count(*) filter (where e.type = 'skip' and e.state in ('PLAYING', 'PAUSED')) as left_mid_run,
      count(*) filter (where e.type = 'skip' and e.state = 'ENDED') as left_after_run,
      count(*) filter (where e.type = 'load_failed') as load_failures,
      count(distinct e.user_id) filter (where e.type = 'play_start') as unique_players,
      count(distinct e.card_id) filter (where e.type = 'play_start' and e.card_id is not null) as views_started,
      percentile_cont(0.5) within group (order by case when jsonb_typeof(e.meta->'ms') = 'number' then (e.meta->>'ms')::double precision end)
        filter (where e.type = 'ready') as ready_p50,
      percentile_cont(0.9) within group (order by case when jsonb_typeof(e.meta->'ms') = 'number' then (e.meta->>'ms')::double precision end)
        filter (where e.type = 'ready') as ready_p90
    from public.feed_events e
    join public.games g on g.id = e.game_id
    where e.created_at >= since and e.game_id is not null
      and e.user_id <> g.creator_id
      and not exists (select 1 from public.profiles a where a.id = e.user_id and a.role = 'admin')
    group by e.game_id, (e.created_at at time zone 'utc')::date
  ),
  per_user as (
    select ps.game_id, (ps.started_at at time zone 'utc')::date as day, ps.user_id,
      count(*) filter (where ps.qualified_at is not null) as q,
      count(*) filter (where ps.qualified_at is null and (ps.ended_at is not null or ps.started_at < now() - interval '10 minutes')) as b,
      coalesce(sum(ps.active_ms), 0) as ms
    from public.play_sessions ps
    where ps.started_at >= since and not ps.excluded
    group by 1, 2, 3
  ),
  ss as (
    select game_id, day, sum(least(q, v_cap)) as plays, sum(b) as bounced, sum(ms) as active_ms
    from per_user group by 1, 2
  ),
  src as (
    select ps.game_id, (ps.started_at at time zone 'utc')::date as day,
      count(*) filter (where ps.launch_reason = 'feed') as feed,
      count(*) filter (where ps.launch_reason = 'gamePage') as game_page,
      count(*) filter (where ps.launch_reason = 'challenge') as challenge
    from public.play_sessions ps
    where ps.started_at >= since and not ps.excluded and ps.qualified_at is not null
    group by 1, 2
  ),
  card_plays as (
    select ps.game_id, (ps.started_at at time zone 'utc')::date as day, ps.card_id, count(*) as n
    from public.play_sessions ps
    where ps.started_at >= since and not ps.excluded and ps.qualified_at is not null and ps.card_id is not null
    group by 1, 2, 3
  ),
  cv as (
    select game_id, day, count(*) as views_played, count(*) filter (where n >= 2) as views_replayed
    from card_plays group by 1, 2
  ),
  pd as (
    select game_id, day, count(*) as players from public.game_player_days where day >= v_since_day group by 1, 2
  ),
  np as (
    select game_id, (first_played_at at time zone 'utc')::date as day, count(*) as new_players
    from public.game_players where first_played_at >= since group by 1, 2
  ),
  keys as (
    select game_id, day from ev
    union
    -- Sessions alone don't replace a seeded demo day; real events do (as before).
    select ss.game_id, ss.day from ss
     where not exists (select 1 from public.game_stats_daily s where s.game_id = ss.game_id and s.day = ss.day and s.is_seed)
  )
  insert into public.game_stats_daily as s (
    game_id, day, impressions, ready_count, play_starts, play_ends, total_play_ms, replays, likes, shares, saves,
    comments, fast_skips, load_failures, unique_players,
    players, players_7d, players_28d, new_players, plays, bounced_starts, active_play_ms,
    views_started, views_played, views_replayed, left_instantly, left_after_watching, left_mid_run, left_after_run,
    follows, ready_ms_p50, ready_ms_p90, plays_feed, plays_game_page, plays_challenge, version_id, is_seed)
  select k.game_id, k.day,
    coalesce(ev.impressions, 0), coalesce(ev.ready_count, 0), coalesce(ev.play_starts, 0), coalesce(ev.play_ends, 0),
    coalesce(ev.total_play_ms, 0), coalesce(ev.replays, 0), coalesce(ev.likes, 0), coalesce(ev.shares, 0),
    coalesce(ev.saves, 0), coalesce(ev.comments, 0), coalesce(ev.fast_skips, 0), coalesce(ev.load_failures, 0),
    coalesce(ev.unique_players, 0),
    coalesce(pd.players, 0),
    (select count(distinct d.user_id) from public.game_player_days d where d.game_id = k.game_id and d.day between k.day - 6 and k.day),
    (select count(distinct d.user_id) from public.game_player_days d where d.game_id = k.game_id and d.day between k.day - 27 and k.day),
    coalesce(np.new_players, 0), coalesce(ss.plays, 0), coalesce(ss.bounced, 0), coalesce(ss.active_ms, 0),
    coalesce(ev.views_started, 0), coalesce(cv.views_played, 0), coalesce(cv.views_replayed, 0),
    coalesce(ev.left_instantly, 0), coalesce(ev.left_after_watching, 0), coalesce(ev.left_mid_run, 0), coalesce(ev.left_after_run, 0),
    coalesce(ev.follows, 0), round(ev.ready_p50)::integer, round(ev.ready_p90)::integer,
    coalesce(src.feed, 0), coalesce(src.game_page, 0), coalesce(src.challenge, 0), g.live_version_id, false
  from keys k
  join public.games g on g.id = k.game_id
  left join ev on ev.game_id = k.game_id and ev.day = k.day
  left join ss on ss.game_id = k.game_id and ss.day = k.day
  left join cv on cv.game_id = k.game_id and cv.day = k.day
  left join pd on pd.game_id = k.game_id and pd.day = k.day
  left join np on np.game_id = k.game_id and np.day = k.day
  left join src on src.game_id = k.game_id and src.day = k.day
  on conflict (game_id, day) do update set
    impressions = excluded.impressions, ready_count = excluded.ready_count, play_starts = excluded.play_starts,
    play_ends = excluded.play_ends, total_play_ms = excluded.total_play_ms, replays = excluded.replays,
    likes = excluded.likes, shares = excluded.shares, saves = excluded.saves, comments = excluded.comments,
    fast_skips = excluded.fast_skips, load_failures = excluded.load_failures, unique_players = excluded.unique_players,
    players = excluded.players, players_7d = excluded.players_7d, players_28d = excluded.players_28d,
    new_players = excluded.new_players, plays = excluded.plays, bounced_starts = excluded.bounced_starts,
    active_play_ms = excluded.active_play_ms, views_started = excluded.views_started, views_played = excluded.views_played,
    views_replayed = excluded.views_replayed, left_instantly = excluded.left_instantly,
    left_after_watching = excluded.left_after_watching, left_mid_run = excluded.left_mid_run,
    left_after_run = excluded.left_after_run, follows = excluded.follows, ready_ms_p50 = excluded.ready_ms_p50,
    ready_ms_p90 = excluded.ready_ms_p90, plays_feed = excluded.plays_feed, plays_game_page = excluded.plays_game_page,
    plays_challenge = excluded.plays_challenge, version_id = coalesce(excluded.version_id, s.version_id), is_seed = false;

  -- Return rates of each day's new players, written once the day's window is over (day 1: the next day has
  -- ended; day 7: the next seven have).
  update public.game_stats_daily s
     set returned_d1 = r.d1,
         returned_d7 = case when r.day <= v_today - 8 then r.d7 else null end
    from (
      select gp.game_id, (gp.first_played_at at time zone 'utc')::date as day,
        count(*) filter (where exists (
          select 1 from public.game_player_days d
           where d.game_id = gp.game_id and d.user_id = gp.user_id and d.day = (gp.first_played_at at time zone 'utc')::date + 1)) as d1,
        count(*) filter (where exists (
          select 1 from public.game_player_days d
           where d.game_id = gp.game_id and d.user_id = gp.user_id
             and d.day between (gp.first_played_at at time zone 'utc')::date + 1 and (gp.first_played_at at time zone 'utc')::date + 7)) as d7
      from public.game_players gp
      where gp.first_played_at >= (v_today - 15)::timestamp at time zone 'utc'
        and gp.first_played_at < (v_today - 1)::timestamp at time zone 'utc'
      group by 1, 2
    ) r
   where s.game_id = r.game_id and s.day = r.day and not s.is_seed;
end $$;

-- Distinct players of a game in the `p_days` days ending on `p_day`: the rollup's stored value, or a live
-- count when that day has no row yet.
create or replace function public.window_players(p_game uuid, p_day date, p_days integer)
returns bigint language sql stable security definer set search_path = public as $$
  select coalesce(
    (select case p_days when 1 then s.players::bigint when 7 then s.players_7d::bigint when 28 then s.players_28d::bigint end
       from public.game_stats_daily s where s.game_id = p_game and s.day = p_day),
    (select count(distinct d.user_id) from public.game_player_days d
      where d.game_id = p_game and d.day between p_day - (p_days - 1) and p_day)
  )
$$;

-- -----------------------------------------------------------------------------
-- Milestones: awarded after each rollup, once per (game, kind, threshold). At most one milestone
-- notification (and so one push) per game per UTC day; the rest still show in the portal and Creator Hub.
-- -----------------------------------------------------------------------------
create or replace function public.award_milestones(p_silent boolean default false)
returns integer language plpgsql security definer set search_path = public as $$
declare
  cfg jsonb := coalesce((select value from public.feed_config where key = 'milestones'), '{}'::jsonb);
  v_today date := (now() at time zone 'utc')::date;
  v_day_key bigint := to_char((now() at time zone 'utc')::date, 'YYYYMMDD')::bigint;
  v_seen timestamptz := case when p_silent then now() end;
  g record;
  v_today_players integer;
  v_prev_max integer;
  v_days integer;
  v_avg double precision;
  v_n integer;
begin
  if not public.is_service() then
    raise exception 'service only' using errcode = '42501';
  end if;
  perform public.enter_trusted();
  create temp table if not exists _awarded (
    id uuid, game_id uuid, creator_id uuid, kind text, threshold bigint, value double precision, detail jsonb, prio integer
  ) on commit drop;
  truncate _awarded;

  for g in
    select ga.id, ga.creator_id, ga.player_count, ga.play_ms_total, ga.published_at
      from public.games ga where ga.status = 'live'
  loop
    with ins as (
      insert into public.creator_milestones (game_id, creator_id, kind, threshold, value, seen_at)
      select g.id, g.creator_id, c.kind, c.threshold, c.value, v_seen
        from (
          select 'players' as kind, t.v as threshold, g.player_count::double precision as value
            from (select (jsonb_array_elements_text(cfg->'players'))::bigint as v) t where t.v <= g.player_count
          union all
          select 'playtime', t.v, floor(g.play_ms_total / 3600000.0)
            from (select (jsonb_array_elements_text(cfg->'playtimeHours'))::bigint as v) t where t.v * 3600000 <= g.play_ms_total
          union all
          select 'first_player', 1, 1 where g.player_count >= 1
          union all
          select 'first_like', 1, 1 where exists (select 1 from public.likes l where l.game_id = g.id and l.user_id <> g.creator_id)
          union all
          select 'first_comment', 1, 1 where exists (
            select 1 from public.comments cm where cm.game_id = g.id and cm.user_id <> g.creator_id and cm.status = 'visible')
          union all
          select 'first_challenge', 1, 1 where exists (
            select 1 from public.shares sh where sh.game_id = g.id and sh.channel = 'challenge' and sh.user_id is distinct from g.creator_id)
        ) c
      on conflict (game_id, kind, threshold) do nothing
      returning id, game_id, creator_id, kind, threshold, value, detail
    )
    insert into _awarded
    select i.*, case i.kind when 'players' then 2 when 'playtime' then 3 when 'first_player' then 5
                            when 'first_challenge' then 6 when 'first_comment' then 7 else 8 end
      from ins i;

    -- Best day and taking off are moments, not totals: never awarded silently.
    continue when p_silent or g.published_at is null;
    select s.players into v_today_players from public.game_stats_daily s where s.game_id = g.id and s.day = v_today;
    v_today_players := coalesce(v_today_players, 0);

    if g.published_at <= now() - make_interval(days => coalesce((cfg->'bestDay'->>'minDaysLive')::integer, 7))
       and v_today_players >= coalesce((cfg->'bestDay'->>'minPlayers')::integer, 50) then
      select max(s.players) into v_prev_max from public.game_stats_daily s where s.game_id = g.id and s.day < v_today;
      if v_today_players > coalesce(v_prev_max, 0)
         and not exists (
           select 1 from public.creator_milestones m where m.game_id = g.id and m.kind = 'best_day'
              and m.reached_at > now() - make_interval(days => coalesce((cfg->'bestDay'->>'cooldownDays')::integer, 7))) then
        with ins as (
          insert into public.creator_milestones (game_id, creator_id, kind, threshold, value, detail)
          values (g.id, g.creator_id, 'best_day', v_day_key, v_today_players, jsonb_build_object('players', v_today_players))
          on conflict (game_id, kind, threshold) do nothing
          returning id, game_id, creator_id, kind, threshold, value, detail
        )
        insert into _awarded select i.*, 4 from ins i;
      end if;
    end if;

    -- Usual = the average over the (up to) 7 previous days since launch, missing days counting as zero.
    v_days := least(7, v_today - (g.published_at at time zone 'utc')::date);
    if v_days >= 1 and v_today_players >= coalesce((cfg->'takingOff'->>'minPlayers')::integer, 200) then
      select coalesce(sum(s.players), 0)::double precision / v_days into v_avg
        from public.game_stats_daily s where s.game_id = g.id and s.day between v_today - v_days and v_today - 1;
      if v_avg > 0 and v_today_players >= coalesce((cfg->'takingOff'->>'ratio')::double precision, 3) * v_avg
         and not exists (
           select 1 from public.creator_milestones m where m.game_id = g.id and m.kind = 'taking_off'
              and m.reached_at > now() - make_interval(days => coalesce((cfg->'takingOff'->>'cooldownDays')::integer, 7))) then
        with ins as (
          insert into public.creator_milestones (game_id, creator_id, kind, threshold, value, detail)
          values (g.id, g.creator_id, 'taking_off', v_day_key, round((v_today_players / v_avg)::numeric, 1),
                  jsonb_build_object('players', v_today_players, 'ratio', round((v_today_players / v_avg)::numeric, 1)))
          on conflict (game_id, kind, threshold) do nothing
          returning id, game_id, creator_id, kind, threshold, value, detail
        )
        insert into _awarded select i.*, 1 from ins i;
      end if;
    end if;
  end loop;

  if not p_silent then
    insert into public.notifications (user_id, type, game_id, payload)
    select distinct on (a.game_id) a.creator_id, 'milestone'::public.notification_type, a.game_id,
      jsonb_build_object('milestoneId', a.id, 'kind', a.kind, 'threshold', a.threshold, 'value', a.value, 'detail', a.detail,
                         'count', (select count(*) from _awarded b where b.game_id = a.game_id))
      from _awarded a
     where not exists (
       select 1 from public.notifications n
        where n.user_id = a.creator_id and n.game_id = a.game_id and n.type = 'milestone'
          and n.created_at >= v_today::timestamp at time zone 'utc')
     order by a.game_id, a.prio, a.threshold desc;
  end if;

  select count(*) into v_n from _awarded;
  return v_n;
end $$;

-- -----------------------------------------------------------------------------
-- Benchmarks (nightly): where each live game ranks among live games with enough card views.
-- -----------------------------------------------------------------------------
create or replace function public.compute_game_benchmarks()
returns void language plpgsql security definer set search_path = public as $$
declare
  cfg jsonb := public.analytics_config();
  v_today date := (now() at time zone 'utc')::date;
  v_min integer := coalesce((cfg->>'benchmarkMinViews')::integer, 200);
  v_min_games integer := coalesce((cfg->>'benchmarkMinGames')::integer, 10);
  v_sample integer := 20;
  v_n integer;
begin
  if not public.is_service() then
    raise exception 'service only' using errcode = '42501';
  end if;
  create temp table if not exists _bm (
    game_id uuid, views bigint, plays bigint, instantly bigint, played bigint, replayed bigint,
    ms bigint, player_days bigint, d1 bigint, d1_cohort bigint
  ) on commit drop;
  truncate _bm;
  insert into _bm
  select s.game_id, sum(s.impressions), sum(s.plays), sum(s.left_instantly), sum(s.views_played), sum(s.views_replayed),
         sum(s.active_play_ms), sum(s.players),
         coalesce(sum(s.returned_d1) filter (where s.returned_d1 is not null), 0),
         coalesce(sum(s.new_players) filter (where s.returned_d1 is not null), 0)
    from public.game_stats_daily s
    join public.games g on g.id = s.game_id and g.status = 'live'
   where s.day between v_today - 27 and v_today
   group by s.game_id
  having sum(s.impressions) >= v_min;

  select count(*) into v_n from _bm;
  delete from public.game_benchmarks;
  if v_n < v_min_games then
    return;
  end if;

  insert into public.game_benchmarks (game_id, games_compared, metrics)
  select b.game_id, v_n, jsonb_build_object(
    'playRate', round(100 * percent_rank() over (order by b.plays::double precision / b.views)),
    'leftInstantly', round(100 * percent_rank() over (order by b.instantly::double precision / b.views desc)),
    'replayRate', case when b.played >= v_sample then
      round(100 * percent_rank() over (partition by b.played >= v_sample order by b.replayed::double precision / greatest(b.played, 1))) end,
    'avgPlaytime', case when b.player_days >= v_sample and b.ms > 0 then
      round(100 * percent_rank() over (partition by b.player_days >= v_sample and b.ms > 0 order by b.ms::double precision / greatest(b.player_days, 1))) end,
    'd1Return', case when b.d1_cohort >= v_sample then
      round(100 * percent_rank() over (partition by b.d1_cohort >= v_sample order by b.d1::double precision / greatest(b.d1_cohort, 1))) end
  )
  from _bm b;
end $$;

-- -----------------------------------------------------------------------------
-- Creator RPCs (owner-checked; the only way creators reach per-player data, and only as aggregates)
-- -----------------------------------------------------------------------------
create or replace function public.milestone_json(m public.creator_milestones, g public.games)
returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object(
    'id', m.id, 'gameId', g.id, 'gameSlug', g.slug, 'gameName', g.name, 'iconUrl', g.icon_url, 'accentColor', g.accent_color,
    'kind', m.kind, 'threshold', m.threshold, 'value', m.value, 'detail', m.detail,
    'reachedAt', m.reached_at, 'seenAt', m.seen_at, 'shareCode', m.share_code)
$$;

create or replace function public.next_milestone(p_players bigint, p_play_ms bigint)
returns jsonb language sql stable security definer set search_path = public as $$
  with cfg as (select value from public.feed_config where key = 'milestones'),
  p as (select min(t.v::bigint) as target from cfg, jsonb_array_elements_text(cfg.value->'players') as t(v) where t.v::bigint > p_players),
  h as (select min(t.v::bigint) as target from cfg, jsonb_array_elements_text(cfg.value->'playtimeHours') as t(v) where t.v::bigint * 3600000 > p_play_ms)
  select case
    when (select target from p) is not null then jsonb_build_object('kind', 'players', 'target', (select target from p), 'current', p_players)
    when (select target from h) is not null then jsonb_build_object('kind', 'playtime', 'target', (select target from h), 'current', floor(p_play_ms / 3600000.0))
  end
$$;

create or replace function public.creator_overview()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_today date := (now() at time zone 'utc')::date;
begin
  if v_uid is null then
    raise exception 'sign in first' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'totals', (
      select jsonb_build_object(
        'players', coalesce(sum(g.player_count), 0), 'plays', coalesce(sum(g.play_count), 0),
        'playMs', coalesce(sum(g.play_ms_total), 0),
        'followers', (select pr.follower_count from public.profiles pr where pr.id = v_uid))
      from public.games g where g.creator_id = v_uid),
    'today', (
      select jsonb_build_object('players', coalesce(sum(s.players), 0), 'plays', coalesce(sum(s.plays), 0))
      from public.game_stats_daily s join public.games g on g.id = s.game_id
      where g.creator_id = v_uid and s.day = v_today),
    'games', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', g.id, 'slug', g.slug, 'name', g.name, 'iconUrl', g.icon_url, 'accentColor', g.accent_color, 'status', g.status,
          'players', g.player_count, 'plays', g.play_count, 'playMs', g.play_ms_total,
          'todayPlayers', coalesce((select s.players from public.game_stats_daily s where s.game_id = g.id and s.day = v_today), 0),
          'spark', (
            select jsonb_agg(jsonb_build_object('day', to_char(d::date, 'YYYY-MM-DD'), 'players', coalesce(s.players, 0)) order by d)
              from generate_series((v_today - 27)::timestamp, v_today::timestamp, interval '1 day') d
              left join public.game_stats_daily s on s.game_id = g.id and s.day = d::date),
          'next', public.next_milestone(g.player_count, g.play_ms_total))
        order by (g.status = 'live') desc, g.player_count desc, g.name)
      from public.games g where g.creator_id = v_uid), '[]'::jsonb),
    'milestones', coalesce((
      select jsonb_agg(public.milestone_json(x.m, x.g) order by (x.m).reached_at desc)
      from (
        select m, g from public.creator_milestones m join public.games g on g.id = m.game_id
         where m.creator_id = v_uid order by m.reached_at desc limit 12
      ) x), '[]'::jsonb),
    'playtimeSince', public.analytics_config()->>'playtimeSince'
  );
end $$;

create or replace function public.analytics_range(p_game uuid, p_range text, out r_from date, out r_to date, out r_series_from date)
language plpgsql stable security definer set search_path = public as $$
declare
  v_today date := (now() at time zone 'utc')::date;
begin
  r_to := v_today;
  case p_range
    when 'today' then r_from := v_today; r_series_from := v_today - 13;
    when '7d' then r_from := v_today - 6; r_series_from := r_from;
    when '28d' then r_from := v_today - 27; r_series_from := r_from;
    when 'all' then
      -- All time starts at launch; the chart starts at the first day with numbers (at most a year back).
      r_series_from := greatest(
        coalesce((select min(s.day) from public.game_stats_daily s where s.game_id = p_game), v_today), v_today - 364);
      r_from := least(
        coalesce((select (g.published_at at time zone 'utc')::date from public.games g where g.id = p_game), r_series_from),
        r_series_from);
    else
      raise exception 'range must be today, 7d, 28d or all' using errcode = '22023';
  end case;
end $$;

create or replace function public.analytics_period(p_game uuid, p_from date, p_to date, p_players bigint)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'players', p_players,
    'newPlayers', coalesce(sum(s.new_players), 0),
    'plays', coalesce(sum(s.plays), 0),
    'bounced', coalesce(sum(s.bounced_starts), 0),
    'playMs', coalesce(sum(s.active_play_ms), 0),
    'views', coalesce(sum(s.impressions), 0),
    'typicalRunMs', (
      select round(percentile_cont(0.5) within group (order by ps.active_ms))
        from public.play_sessions ps
       where ps.game_id = p_game and ps.qualified_at is not null and not ps.excluded and ps.active_ms > 0
         and ps.started_at >= p_from::timestamp at time zone 'utc' and ps.started_at < (p_to + 1)::timestamp at time zone 'utc'))
  from public.game_stats_daily s
  where s.game_id = p_game and s.day between p_from and p_to
$$;

create or replace function public.assert_game_owner(p_game uuid)
returns public.games language plpgsql stable security definer set search_path = public as $$
declare
  g public.games;
begin
  select * into g from public.games where id = p_game;
  if not found or not (g.creator_id = auth.uid() or public.is_admin()) then
    raise exception 'not your game' using errcode = '42501';
  end if;
  return g;
end $$;

create or replace function public.creator_game_summary(p_game uuid, p_range text default '7d')
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  g public.games := public.assert_game_owner(p_game);
  r record;
  v_today date := (now() at time zone 'utc')::date;
  v_current jsonb;
  v_previous jsonb;
begin
  select * into r from public.analytics_range(p_game, p_range);

  v_current := public.analytics_period(p_game, r.r_from, r.r_to, case p_range
    when 'today' then public.window_players(p_game, v_today, 1)
    when '7d' then public.window_players(p_game, v_today, 7)
    when '28d' then public.window_players(p_game, v_today, 28)
    else g.player_count end);
  if p_range = 'all' then
    -- All time reads the live counters, which also cover days from before the daily columns existed.
    v_current := v_current || jsonb_build_object('plays', g.play_count, 'playMs', g.play_ms_total);
  end if;
  v_previous := case p_range
    when '7d' then public.analytics_period(p_game, v_today - 13, v_today - 7, public.window_players(p_game, v_today - 7, 7))
    when '28d' then public.analytics_period(p_game, v_today - 55, v_today - 28, public.window_players(p_game, v_today - 28, 28))
  end;

  return jsonb_build_object(
    'range', p_range,
    'from', to_char(r.r_from, 'YYYY-MM-DD'),
    'to', to_char(r.r_to, 'YYYY-MM-DD'),
    'current', v_current,
    'previous', v_previous,
    'series', (
      select jsonb_agg(jsonb_build_object(
          'day', to_char(d::date, 'YYYY-MM-DD'), 'players', coalesce(s.players, 0), 'newPlayers', coalesce(s.new_players, 0),
          'plays', coalesce(s.plays, 0), 'playMs', coalesce(s.active_play_ms, 0)) order by d)
        from generate_series(r.r_series_from::timestamp, r.r_to::timestamp, interval '1 day') d
        left join public.game_stats_daily s on s.game_id = p_game and s.day = d::date),
    'markers', coalesce((
      select jsonb_agg(x.j order by x.day) from (
        select (m.reached_at at time zone 'utc')::date as day,
               jsonb_build_object('day', to_char((m.reached_at at time zone 'utc')::date, 'YYYY-MM-DD'), 'type', 'milestone',
                                  'kind', m.kind, 'threshold', m.threshold, 'value', m.value) as j
          from public.creator_milestones m
         where m.game_id = p_game and (m.reached_at at time zone 'utc')::date between r.r_series_from and r.r_to
        union all
        select (v.approved_at at time zone 'utc')::date,
               jsonb_build_object('day', to_char((v.approved_at at time zone 'utc')::date, 'YYYY-MM-DD'), 'type', 'version', 'semver', v.semver)
          from public.game_versions v
         where v.game_id = p_game and v.status = 'approved' and v.approved_at is not null
           and (v.approved_at at time zone 'utc')::date between r.r_series_from and r.r_to
      ) x), '[]'::jsonb),
    'leave', (
      select jsonb_build_object(
        'views', coalesce(sum(s.impressions), 0), 'instantly', coalesce(sum(s.left_instantly), 0),
        'afterWatching', coalesce(sum(s.left_after_watching), 0), 'midRun', coalesce(sum(s.left_mid_run), 0),
        'afterRun', coalesce(sum(s.left_after_run), 0), 'failed', coalesce(sum(s.load_failures), 0))
      from public.game_stats_daily s where s.game_id = p_game and s.day between r.r_from and r.r_to),
    'engagement', (
      select jsonb_build_object(
        'likes', coalesce(sum(s.likes), 0), 'comments', coalesce(sum(s.comments), 0), 'shares', coalesce(sum(s.shares), 0),
        'saves', coalesce(sum(s.saves), 0), 'follows', coalesce(sum(s.follows), 0))
      from public.game_stats_daily s where s.game_id = p_game and s.day between r.r_from and r.r_to),
    'sources', coalesce((
      select jsonb_agg(jsonb_build_object('reason', x.reason, 'plays', x.n) order by x.n desc)
        from (
          select v.reason, v.n
            from (
              select coalesce(sum(s.plays_feed), 0) as feed, coalesce(sum(s.plays_game_page), 0) as game_page,
                     coalesce(sum(s.plays_challenge), 0) as challenge
                from public.game_stats_daily s where s.game_id = p_game and s.day between r.r_from and r.r_to
            ) t
            cross join lateral (values ('feed', t.feed), ('gamePage', t.game_page), ('challenge', t.challenge)) as v(reason, n)
           where v.n > 0) x), '[]'::jsonb),
    'health', (
      select jsonb_build_object(
        'readyP50', round(sum(s.ready_ms_p50::double precision * s.ready_count) / nullif(sum(s.ready_count) filter (where s.ready_ms_p50 is not null), 0)),
        'readyP90', round(sum(s.ready_ms_p90::double precision * s.ready_count) / nullif(sum(s.ready_count) filter (where s.ready_ms_p90 is not null), 0)),
        'loadFailures', coalesce(sum(s.load_failures), 0), 'views', coalesce(sum(s.impressions), 0))
      from public.game_stats_daily s where s.game_id = p_game and s.day between r.r_from and r.r_to),
    'returns', (
      select jsonb_build_object(
        'd1', jsonb_build_object('returned', coalesce(sum(s.returned_d1), 0), 'cohort', coalesce(sum(s.new_players) filter (where s.returned_d1 is not null), 0)),
        'd7', jsonb_build_object('returned', coalesce(sum(s.returned_d7), 0), 'cohort', coalesce(sum(s.new_players) filter (where s.returned_d7 is not null), 0)))
      from public.game_stats_daily s where s.game_id = p_game and s.day between r.r_from and r.r_to),
    'benchmarks', (
      select b.metrics || jsonb_build_object('gamesCompared', b.games_compared) from public.game_benchmarks b where b.game_id = p_game),
    'next', public.next_milestone(g.player_count, g.play_ms_total),
    'playtimeSince', public.analytics_config()->>'playtimeSince'
  );
end $$;

create or replace function public.creator_game_funnel(p_game uuid, p_range text default '7d')
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  g public.games := public.assert_game_owner(p_game);
  r record;
begin
  select * into r from public.analytics_range(g.id, p_range);
  return (
    select jsonb_build_object(
      'views', coalesce(sum(s.impressions), 0), 'started', coalesce(sum(s.views_started), 0),
      'played', coalesce(sum(s.views_played), 0), 'playedAgain', coalesce(sum(s.views_replayed), 0))
    from public.game_stats_daily s where s.game_id = p_game and s.day between r.r_from and r.r_to);
end $$;

-- Versions compared by the days each was live (the version live when a day was rolled up). Release days are
-- attributed to whichever version was live at the day's last rollup.
create or replace function public.creator_version_compare(p_game uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  g public.games := public.assert_game_owner(p_game);
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
        'versionId', v.id, 'semver', v.semver, 'isLive', v.id = g.live_version_id, 'releasedAt', v.approved_at,
        'days', coalesce(x.days, 0), 'plays', coalesce(x.plays, 0), 'playMs', coalesce(x.play_ms, 0),
        'd1', jsonb_build_object('returned', coalesce(x.d1, 0), 'cohort', coalesce(x.d1_cohort, 0)),
        'views', coalesce(x.views, 0), 'leftInstantly', coalesce(x.instantly, 0))
      order by v.approved_at desc nulls last)
    from (
      select gv.id, gv.semver, gv.approved_at
        from public.game_versions gv
       where gv.game_id = p_game and gv.status = 'approved'
       order by gv.approved_at desc nulls last limit 6
    ) v
    left join lateral (
      select count(*) as days, sum(s.plays) as plays, sum(s.active_play_ms) as play_ms, sum(s.impressions) as views,
             sum(s.left_instantly) as instantly,
             sum(s.returned_d1) filter (where s.returned_d1 is not null) as d1,
             sum(s.new_players) filter (where s.returned_d1 is not null) as d1_cohort
        from public.game_stats_daily s where s.game_id = p_game and s.version_id = v.id
    ) x on true
  ), '[]'::jsonb);
end $$;

create or replace function public.share_milestone(p_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_code text;
begin
  update public.creator_milestones m
     set share_code = coalesce(m.share_code, substr(md5(gen_random_uuid()::text), 1, 12))
   where m.id = p_id and (m.creator_id = auth.uid() or public.is_admin())
  returning m.share_code into v_code;
  if v_code is null then
    raise exception 'not your milestone' using errcode = '42501';
  end if;
  return v_code;
end $$;

create or replace function public.mark_milestones_seen(p_ids uuid[])
returns void language sql security definer set search_path = public as $$
  update public.creator_milestones set seen_at = now()
   where id = any(p_ids) and creator_id = auth.uid() and seen_at is null
$$;

-- Public: only milestones their creator chose to share, and only for live games.
create or replace function public.milestone_card(p_code text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'code', m.share_code, 'kind', m.kind, 'threshold', m.threshold, 'value', m.value, 'detail', m.detail, 'reachedAt', m.reached_at,
    'game', jsonb_build_object('slug', g.slug, 'name', g.name, 'iconUrl', g.icon_url, 'accentColor', g.accent_color, 'description', g.description),
    'creator', jsonb_build_object('handle', p.handle, 'displayName', p.display_name))
    from public.creator_milestones m
    join public.games g on g.id = m.game_id and g.status = 'live'
    join public.profiles p on p.id = m.creator_id
   where m.share_code = p_code
$$;

-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------
revoke execute on function public.start_play_session(uuid, uuid, uuid, text, text) from public, anon, authenticated;
revoke execute on function public.finish_play_session(uuid, uuid, double precision, integer, text, integer) from public, anon, authenticated;
revoke execute on function public.record_session_progress(uuid, uuid, integer) from public, anon, authenticated;
revoke execute on function public.award_milestones(boolean) from public, anon, authenticated;
revoke execute on function public.compute_game_benchmarks() from public, anon, authenticated;
revoke execute on function public.window_players(uuid, date, integer) from public, anon, authenticated;
revoke execute on function public.analytics_period(uuid, date, date, bigint) from public, anon, authenticated;
revoke execute on function public.analytics_range(uuid, text) from public, anon, authenticated;
revoke execute on function public.next_milestone(bigint, bigint) from public, anon, authenticated;
revoke execute on function public.play_sessions_analytics() from public, anon, authenticated;
revoke execute on function public.assert_game_owner(uuid) from public, anon;
grant execute on function public.start_play_session(uuid, uuid, uuid, text, text) to service_role;
grant execute on function public.finish_play_session(uuid, uuid, double precision, integer, text, integer) to service_role;
grant execute on function public.record_session_progress(uuid, uuid, integer) to service_role;
grant execute on function public.award_milestones(boolean) to service_role;
grant execute on function public.compute_game_benchmarks() to service_role;
grant execute on function public.creator_overview() to authenticated;
grant execute on function public.creator_game_summary(uuid, text) to authenticated;
grant execute on function public.creator_game_funnel(uuid, text) to authenticated;
grant execute on function public.creator_version_compare(uuid) to authenticated;
grant execute on function public.share_milestone(uuid) to authenticated;
grant execute on function public.mark_milestones_seen(uuid[]) to authenticated;
grant execute on function public.milestone_card(text) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- Backfill the daily columns for the last 60 days, then milestones (silently: no inbox flood on deploy).
-- -----------------------------------------------------------------------------
update public.game_stats_daily s
   set players = (select count(*) from public.game_player_days d where d.game_id = s.game_id and d.day = s.day),
       players_7d = (select count(distinct d.user_id) from public.game_player_days d where d.game_id = s.game_id and d.day between s.day - 6 and s.day),
       players_28d = (select count(distinct d.user_id) from public.game_player_days d where d.game_id = s.game_id and d.day between s.day - 27 and s.day),
       new_players = (select count(*) from public.game_players p where p.game_id = s.game_id and (p.first_played_at at time zone 'utc')::date = s.day),
       plays = (select count(*) from public.play_sessions ps
                 where ps.game_id = s.game_id and ps.qualified_at is not null and not ps.excluded
                   and (ps.started_at at time zone 'utc')::date = s.day),
       plays_feed = (select count(*) from public.play_sessions ps
                      where ps.game_id = s.game_id and ps.qualified_at is not null and not ps.excluded and ps.launch_reason = 'feed'
                        and (ps.started_at at time zone 'utc')::date = s.day),
       plays_game_page = (select count(*) from public.play_sessions ps
                           where ps.game_id = s.game_id and ps.qualified_at is not null and not ps.excluded and ps.launch_reason = 'gamePage'
                             and (ps.started_at at time zone 'utc')::date = s.day),
       plays_challenge = (select count(*) from public.play_sessions ps
                           where ps.game_id = s.game_id and ps.qualified_at is not null and not ps.excluded and ps.launch_reason = 'challenge'
                             and (ps.started_at at time zone 'utc')::date = s.day),
       -- Best guess for old days: the version live now.
       version_id = (select g.live_version_id from public.games g where g.id = s.game_id)
 where s.day >= (now() at time zone 'utc')::date - 60;

select public.rollup_game_stats(2);
select public.award_milestones(true);

-- -----------------------------------------------------------------------------
-- Schedules: milestones right after each rollup; benchmarks nightly.
-- -----------------------------------------------------------------------------
select cron.schedule('thumbcade-stats-rollup', '*/10 * * * *', $$select public.rollup_game_stats(2); select public.award_milestones();$$);
select cron.schedule('thumbcade-benchmarks', '40 3 * * *', $$select public.compute_game_benchmarks()$$);
