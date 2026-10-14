-- =============================================================================
-- Player Platform (stream A): feed ranking, event ingest, rollups, play sessions + score
-- integrity, leaderboards, social notifications, comment moderation, push dispatch.
--
-- Only touches social / feed / session tables (see CLAUDE.md -> Ownership). Service-only functions
-- check public.is_service() and have EXECUTE revoked from client roles; the edge functions in
-- supabase/functions call them with the service role.
-- =============================================================================

create extension if not exists pg_net;

-- -----------------------------------------------------------------------------
-- Small helpers
-- -----------------------------------------------------------------------------

-- Is score `a` strictly better than `b` under a game's score order? (`b` null => true)
create or replace function public.score_better(p_order text, a double precision, b double precision)
returns boolean language sql immutable as $$
  select case
    when a is null then false
    when b is null then true
    when coalesce(p_order, 'desc') = 'asc' then a < b
    else a > b
  end
$$;

-- Age ratings a viewer may see. Unknown age bands get the teen set.
create or replace function public.allowed_age_ratings(p_band public.age_band)
returns public.age_rating[] language sql immutable as $$
  select case p_band
    when 'under13' then array['4+', '9+']::public.age_rating[]
    when '13to15' then array['4+', '9+', '12+']::public.age_rating[]
    when '16to17' then array['4+', '9+', '12+']::public.age_rating[]
    when 'adult' then array['4+', '9+', '12+', '17+']::public.age_rating[]
    else array['4+', '9+', '12+']::public.age_rating[]
  end
$$;

-- Either side blocked the other.
create or replace function public.is_blocked_between(a uuid, b uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select a is not null and b is not null and exists (
    select 1 from public.blocks bl
    where (bl.blocker_id = a and bl.blocked_id = b) or (bl.blocker_id = b and bl.blocked_id = a)
  )
$$;

-- Beta(a, b) sample for Thompson sampling. Exact (order statistic of uniforms) for small counts,
-- normal approximation for large ones.
create or replace function public.beta_sample(a integer, b integer)
returns double precision language plpgsql volatile as $$
declare
  n integer := greatest(a, 1) + greatest(b, 1) - 1;
  aa double precision := greatest(a, 1);
  bb double precision := greatest(b, 1);
  m double precision;
  sd double precision;
  z double precision;
  u double precision;
begin
  if n <= 1500 then
    select s.u into u from (select random() as u from generate_series(1, n)) s order by s.u offset greatest(a, 1) - 1 limit 1;
    return u;
  end if;
  m := aa / (aa + bb);
  sd := sqrt(aa * bb / ((aa + bb) ^ 2 * (aa + bb + 1)));
  z := sqrt(-2 * ln(greatest(random(), 1e-12))) * cos(2 * pi() * random());
  return least(1, greatest(0, m + z * sd));
end $$;

-- The best score a viewer has on a game: ranked best for members, best guest session otherwise.
create or replace function public.viewer_best(p_viewer uuid, p_game uuid)
returns double precision language sql stable security definer set search_path = public as $$
  select coalesce(
    (select b.best_score from public.best_scores b where b.game_id = p_game and b.user_id = p_viewer),
    (select case when coalesce(g.score_config->>'order', 'desc') = 'asc' then min(s.score) else max(s.score) end
       from public.play_sessions s join public.games g on g.id = s.game_id
      where s.user_id = p_viewer and s.game_id = p_game and s.reject_reason = 'guest' and s.score is not null
      group by g.score_config)
  )
$$;

-- All-time top score of a game (respects score order).
create or replace function public.game_top_score(p_game uuid)
returns double precision language sql stable security definer set search_path = public as $$
  select case when coalesce(g.score_config->>'order', 'desc') = 'asc' then min(b.best_score) else max(b.best_score) end
  from public.games g left join public.best_scores b on b.game_id = g.id
  where g.id = p_game group by g.score_config
$$;

-- Percentile (0-100, higher is better) of a score among today's ranked players, excluding one user.
create or replace function public.today_percentile(p_game uuid, p_score double precision, p_exclude uuid)
returns real language sql stable security definer set search_path = public as $$
  with cfg as (select coalesce(score_config->>'order', 'desc') o from public.games where id = p_game),
  others as (
    select d.best_score s from public.daily_scores d
    where d.game_id = p_game and d.day = (now() at time zone 'utc')::date and d.user_id is distinct from p_exclude
  )
  select case when count(*) = 0 or p_score is null then null
    else (100.0 * count(*) filter (where public.score_better((select o from cfg), p_score, others.s)) / count(*))::real end
  from others
$$;

-- -----------------------------------------------------------------------------
-- Notifications: push bookkeeping
-- -----------------------------------------------------------------------------
alter table public.notifications add column if not exists pushed_at timestamptz;
create index if not exists notifications_unpushed on public.notifications (created_at) where pushed_at is null;

-- -----------------------------------------------------------------------------
-- Feed ranking (§9)
-- -----------------------------------------------------------------------------
create or replace function public.rank_feed(
  p_viewer uuid,
  p_cursor jsonb default '{}'::jsonb,
  p_limit integer default 8,
  p_tab text default 'foryou',
  p_tag text default null
)
returns table (game_id uuid, source text, score real)
language plpgsql volatile security definer set search_path = public, extensions as $$
declare
  w jsonb := coalesce((select value from public.feed_config where key = 'weights'), '{}'::jsonb);
  ex jsonb := coalesce((select value from public.feed_config where key = 'exploration'), '{}'::jsonb);
  dd jsonb := coalesce((select value from public.feed_config where key = 'dedupe'), '{}'::jsonb);
  dv jsonb := coalesce((select value from public.feed_config where key = 'diversity'), '{}'::jsonb);
  v_band public.age_band;
  v_interests text[];
  v_seen uuid[] := '{}';
  v_pos integer := 0;
  v_last_creator uuid;
  v_last_tag text;
  v_every integer := greatest(2, coalesce((ex->>'every')::integer, 4));
  v_max_impr integer := coalesce((ex->>'maxImpressions')::integer, 500);
  v_override real := coalesce((dd->>'affinityOverride')::real, 0.85);
  v_dedupe interval := make_interval(hours => coalesce((dd->>'hours')::integer, 24));
  v_session_dedupe boolean := coalesce((dd->>'sessionWindow')::boolean, true);
  v_half real := greatest(0.5, coalesce((w->>'freshnessHalfLifeDays')::real, 10));
  v_no_creator boolean := coalesce((dv->>'noSameCreatorInRow')::boolean, true);
  v_no_tag boolean := coalesce((dv->>'noSamePrimaryTagInRow')::boolean, true);
  v_limit integer := least(greatest(coalesce(p_limit, 8), 1), 30);
  v_tab text := case when p_tab = 'following' then 'following' else 'foryou' end;
  v_src text;
  v_n integer;
  v_avoid integer;
  v_recent uuid[];
  v_explore boolean;
  v_found boolean;
  v_pick record;
  relax integer;
  i integer;
begin
  select pr.age_band, coalesce(pr.interests, '{}') into v_band, v_interests from public.profiles pr where pr.id = p_viewer;
  v_interests := coalesce(v_interests, '{}');

  begin
    v_seen := coalesce(array(select (jsonb_array_elements_text(coalesce(p_cursor->'seen', '[]'::jsonb)))::uuid), '{}');
  exception when others then
    v_seen := '{}';
  end;
  if not v_session_dedupe then v_seen := '{}'; end if;
  begin
    v_pos := greatest(0, coalesce((p_cursor->>'pos')::integer, 0));
    v_last_creator := nullif(p_cursor->>'lastCreator', '')::uuid;
  exception when others then
    v_pos := 0;
    v_last_creator := null;
  end;
  v_last_tag := nullif(p_cursor->>'lastTag', '');

  drop table if exists pg_temp._rank_cand;
  create temp table _rank_cand (
    game_id uuid primary key,
    creator_id uuid,
    primary_tag text,
    impressions integer,
    play_starts integer,
    affinity real,
    total real,
    seen_idx integer,
    last_seen timestamptz,
    recent boolean,
    picked boolean default false
  ) on commit drop;

  insert into _rank_cand (game_id, creator_id, primary_tag, impressions, play_starts, affinity, total, seen_idx, last_seen, recent)
  with stats as (
    select s.game_id,
      sum(s.impressions)::real impr, sum(s.play_starts)::real ps, sum(s.replays)::real rp,
      sum(s.likes)::real lk, sum(s.shares)::real sh, sum(s.fast_skips)::real fs
    from public.game_stats_daily s
    where s.day >= (now() at time zone 'utc')::date - 14
    group by s.game_id
  ),
  aff as (
    select gh.game_id, sum(a.weight)::real wsum
    from public.game_hashtags gh
    join public.user_tag_affinity a on a.tag = gh.tag and a.user_id = p_viewer
    group by gh.game_id
  ),
  imp as (
    select e.game_id, max(e.created_at) last_at
    from public.feed_events e
    where e.user_id = p_viewer and e.type = 'impression' and e.game_id is not null
      and e.created_at > now() - interval '7 days'
    group by e.game_id
  ),
  base as (
    select g.id, g.creator_id, g.primary_tag, g.tags,
      coalesce(g.published_at, g.created_at) published,
      coalesce(st.impr, 0) impr, coalesce(st.ps, 0) ps, coalesce(st.rp, 0) rp,
      coalesce(st.lk, 0) lk, coalesce(st.sh, 0) sh, coalesce(st.fs, 0) fs,
      tanh((coalesce(af.wsum, 0) + 0.6 * cardinality(array(select unnest(g.tags) intersect select unnest(v_interests)))) / 3.0)::real aff_norm,
      exists (select 1 from public.follows f where f.follower_id = p_viewer and f.followee_id = g.creator_id) followed,
      array_position(v_seen, g.id) seen_idx,
      im.last_at
    from public.games g
    left join stats st on st.game_id = g.id
    left join aff af on af.game_id = g.id
    left join imp im on im.game_id = g.id
    where g.status = 'live'
      and g.live_version_id is not null
      and g.age_rating = any (public.allowed_age_ratings(v_band))
      and not exists (
        select 1 from public.blocks bl
        where (bl.blocker_id = p_viewer and bl.blocked_id = g.creator_id) or (bl.blocker_id = g.creator_id and bl.blocked_id = p_viewer)
      )
      and (p_tag is null or p_tag = any (g.tags))
      and (v_tab <> 'following' or exists (select 1 from public.follows f where f.follower_id = p_viewer and f.followee_id = g.creator_id))
  )
  select b.id, b.creator_id, b.primary_tag, b.impr::integer, b.ps::integer, b.aff_norm,
    (
      -- Bayesian-smoothed rates (k = 20 pseudo-observations at the prior), as log-ratios to the prior.
      coalesce((w->>'playStartRate')::real, 2.0) * ln(((b.ps + 0.5 * 20) / (b.impr + 20)) / 0.5)
      + coalesce((w->>'replayRate')::real, 2.5) * ln(((b.rp + 0.15 * 20) / (b.ps + 20)) / 0.15)
      + coalesce((w->>'likeRate')::real, 1.5) * ln(((b.lk + 0.05 * 20) / (b.ps + 20)) / 0.05)
      + coalesce((w->>'shareRate')::real, 2.0) * ln(((b.sh + 0.01 * 20) / (b.ps + 20)) / 0.01) * 0.5
      + coalesce((w->>'fastSkipRate')::real, -2.5) * ln(((b.fs + 0.2 * 20) / (b.impr + 20)) / 0.2)
      + case when v_tab = 'following'
          then 2.0 * exp(-extract(epoch from now() - b.published) / 86400.0 / 7.0)
          else coalesce((w->>'tagAffinity')::real, 1.2) * b.aff_norm * 2
            + case when b.followed then coalesce((w->>'followBoost')::real, 0.8) else 0 end
            + coalesce((w->>'freshness')::real, 0.6) * exp(-ln(2.0) * extract(epoch from now() - b.published) / 86400.0 / v_half)
        end
      + random() * 0.25
    )::real,
    b.seen_idx,
    b.last_at,
    coalesce(b.last_at > now() - v_dedupe, false)
  from base b;

  select count(*) into v_n from _rank_cand;
  if v_n = 0 then
    return;
  end if;

  -- When recycling, never repeat one of the last few cards.
  v_avoid := least(v_n - 1, 6);
  v_recent := case when v_avoid > 0 and cardinality(v_seen) > 0
    then v_seen[greatest(1, cardinality(v_seen) - v_avoid + 1):cardinality(v_seen)]
    else '{}'::uuid[] end;

  for i in 0 .. v_limit - 1 loop
    v_found := false;
    v_explore := v_tab = 'foryou' and p_tag is null and ((v_pos + i + 1) % v_every = 0);

    -- 1) Exploration slot: Thompson sampling over under-exposed games.
    if v_explore then
      for relax in 0 .. 2 loop
        select c.* into v_pick from _rank_cand c
        where not c.picked and c.seen_idx is null and (not c.recent or c.affinity >= v_override)
          and c.impressions < v_max_impr
          and (relax >= 2 or not v_no_creator or v_last_creator is null or c.creator_id <> v_last_creator)
          and (relax >= 1 or not v_no_tag or v_last_tag is null or c.primary_tag is distinct from v_last_tag)
        order by public.beta_sample(c.play_starts + 1, greatest(c.impressions - c.play_starts, 0) + 1) desc
        limit 1;
        if found then
          v_found := true;
          v_src := 'explore';
          exit;
        end if;
      end loop;
    end if;

    -- 2) Best unseen candidate.
    if not v_found then
      for relax in 0 .. 2 loop
        select c.* into v_pick from _rank_cand c
        where not c.picked and c.seen_idx is null and (not c.recent or c.affinity >= v_override)
          and (relax >= 2 or not v_no_creator or v_last_creator is null or c.creator_id <> v_last_creator)
          and (relax >= 1 or not v_no_tag or v_last_tag is null or c.primary_tag is distinct from v_last_tag)
        order by c.total desc
        limit 1;
        if found then
          v_found := true;
          v_src := case when v_tab = 'following' then 'following' when p_tag is not null then 'tag' else 'personal' end;
          exit;
        end if;
      end loop;
    end if;

    -- 3) Recycle: the least recently seen game that is not one of the last few cards. Keeps the feed infinite.
    if not v_found then
      for relax in 0 .. 3 loop
        select c.* into v_pick from _rank_cand c
        where (relax >= 3 or not (c.game_id = any (v_recent)))
          and (relax >= 3 or not c.picked or v_n <= v_avoid + 1)
          and (relax >= 2 or not v_no_creator or v_last_creator is null or c.creator_id <> v_last_creator)
          and (relax >= 1 or not v_no_tag or v_last_tag is null or c.primary_tag is distinct from v_last_tag)
        order by c.picked asc, coalesce(c.seen_idx, 0) asc, c.last_seen asc nulls first, c.total desc
        limit 1;
        if found then
          v_found := true;
          v_src := case when v_tab = 'following' then 'following' when p_tag is not null then 'tag' else 'personal' end;
          exit;
        end if;
      end loop;
    end if;

    exit when not v_found;

    update _rank_cand set picked = true, seen_idx = null where _rank_cand.game_id = v_pick.game_id;
    if v_avoid > 0 then
      v_recent := array_append(v_recent, v_pick.game_id);
      if cardinality(v_recent) > v_avoid then
        v_recent := v_recent[cardinality(v_recent) - v_avoid + 1:cardinality(v_recent)];
      end if;
    end if;
    v_last_creator := v_pick.creator_id;
    v_last_tag := v_pick.primary_tag;

    game_id := v_pick.game_id;
    source := v_src;
    score := v_pick.total;
    return next;
  end loop;
end $$;

-- Everything the feed function needs to build FeedCards for a set of games, in one round trip.
create or replace function public.feed_hydrate(p_viewer uuid, p_game_ids uuid[])
returns table (
  game_id uuid, slug text, name text, description text, icon_url text, poster_url text, accent_color text,
  tags text[], age_rating text, controls jsonb, session_length text, audio boolean, score_config jsonb,
  play_count bigint, like_count integer, comment_count integer, share_count integer, save_count integer,
  version_id uuid, semver text, entry text, sdk text,
  creator_id uuid, creator_handle text, creator_display_name text, creator_avatar_url text, creator_avatar_seed text,
  creator_verified boolean,
  liked boolean, saved boolean, following boolean, viewer_best double precision, top_score double precision,
  allowed boolean
)
language sql stable security definer set search_path = public as $$
  select g.id, g.slug, g.name, g.description, g.icon_url, g.poster_url, g.accent_color,
    g.tags, g.age_rating::text, g.controls, g.session_length, g.audio, g.score_config,
    g.play_count, g.like_count, g.comment_count, g.share_count, g.save_count,
    v.id, v.semver, coalesce(v.manifest->>'entry', 'index.html'), coalesce(v.manifest->>'sdk', '^1.0.0'),
    p.id, p.handle, p.display_name, p.avatar_url, p.avatar_seed, p.verified,
    exists (select 1 from public.likes l where l.user_id = p_viewer and l.game_id = g.id),
    exists (select 1 from public.saves s where s.user_id = p_viewer and s.game_id = g.id),
    exists (select 1 from public.follows f where f.follower_id = p_viewer and f.followee_id = g.creator_id),
    public.viewer_best(p_viewer, g.id),
    public.game_top_score(g.id),
    g.status = 'live'
      and g.age_rating = any (public.allowed_age_ratings((select pr.age_band from public.profiles pr where pr.id = p_viewer)))
      and not public.is_blocked_between(p_viewer, g.creator_id)
  from public.games g
  join public.game_versions v on v.id = g.live_version_id
  join public.profiles p on p.id = g.creator_id
  where g.id = any (p_game_ids)
$$;

-- -----------------------------------------------------------------------------
-- Event ingest
-- -----------------------------------------------------------------------------
create or replace function public.ingest_events(p_user uuid, p_events jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare
  n integer := 0;
  r record;
  v_owner uuid;
  cscore double precision;
  ord text;
begin
  if not public.is_service() then
    raise exception 'service only' using errcode = '42501';
  end if;
  if p_user is null or jsonb_typeof(p_events) <> 'array' then
    return 0;
  end if;

  drop table if exists pg_temp._ingest;
  create temp table _ingest on commit drop as
  select
    (e->>'type')::public.feed_event_type as type,
    nullif(e->>'gameId', '')::uuid as game_id,
    nullif(e->>'versionId', '')::uuid as version_id,
    left(e->>'cardId', 80) as card_id,
    left(e->>'feedId', 80) as feed_id,
    (e->>'dwellMs')::integer as dwell_ms,
    e->>'state' as state,
    (e->>'score')::double precision as score,
    (e->>'durationMs')::integer as duration_ms,
    case when jsonb_typeof(e->'meta') = 'object' then e->'meta' else null end as meta,
    case when (e->>'ts') ~ '^\d{10,14}$' then to_timestamp((e->>'ts')::bigint / 1000.0) else null end as client_ts
  from jsonb_array_elements(p_events) e
  where e ? 'type';

  delete from _ingest i where i.game_id is not null and not exists (select 1 from public.games g where g.id = i.game_id);

  insert into public.feed_events (user_id, game_id, version_id, type, card_id, feed_id, dwell_ms, state, score, duration_ms, meta, client_ts)
  select p_user, i.game_id, i.version_id, i.type, i.card_id, i.feed_id, i.dwell_ms, i.state, i.score, i.duration_ms, i.meta, i.client_ts
  from _ingest i;
  get diagnostics n = row_count;

  -- Tag affinity (user x hashtag) from engagement signals.
  insert into public.user_tag_affinity as a (user_id, tag, weight, updated_at)
  select p_user, gh.tag, greatest(-5, least(10, sum(d.delta)))::real, now()
  from (
    select i.game_id,
      case i.type
        when 'play_start' then 0.3
        when 'play_end' then case when coalesce(i.duration_ms, 0) >= 20000 then 0.2 else 0 end
        when 'replay' then 0.5
        when 'like' then 1.0
        when 'unlike' then -1.0
        when 'save' then 0.8
        when 'unsave' then -0.5
        when 'share' then 1.0
        when 'comment' then 0.6
        when 'follow' then 0.5
        when 'open_game_page' then 0.2
        when 'skip' then case when i.state = 'PREVIEW' and coalesce(i.dwell_ms, 999999) < 1500 then -0.4 else 0 end
        else 0
      end as delta
    from _ingest i
    where i.game_id is not null
  ) d
  join public.game_hashtags gh on gh.game_id = d.game_id
  where d.delta <> 0
  group by gh.tag
  on conflict (user_id, tag) do update
    set weight = greatest(-5, least(10, a.weight + excluded.weight)), updated_at = now();

  -- Challenge results: tell the challenger someone took them on.
  for r in
    select i.game_id, i.score, i.meta->>'challengeCode' as code
    from _ingest i
    where i.type = 'play_end' and i.score is not null and i.meta ? 'challengeCode'
  loop
    select s.user_id, s.challenge_score, coalesce(g.score_config->>'order', 'desc')
      into v_owner, cscore, ord
    from public.shares s join public.games g on g.id = s.game_id
    where s.code = r.code and s.game_id = r.game_id;
    if v_owner is null or v_owner = p_user or public.is_blocked_between(v_owner, p_user) then
      continue;
    end if;
    if exists (
      select 1 from public.notifications nt
      where nt.user_id = v_owner and nt.type = 'challenge_accepted' and nt.actor_id = p_user
        and nt.payload->>'code' = r.code and nt.created_at > now() - interval '6 hours'
    ) then
      continue;
    end if;
    insert into public.notifications (user_id, type, actor_id, game_id, payload)
    values (v_owner, 'challenge_accepted', p_user, r.game_id, jsonb_build_object(
      'score', r.score, 'challengeScore', cscore, 'beat', public.score_better(ord, r.score, cscore), 'code', r.code));
  end loop;

  return n;
end $$;

-- -----------------------------------------------------------------------------
-- Rollups (pg_cron)
-- -----------------------------------------------------------------------------
create or replace function public.rollup_game_stats(p_days integer default 2)
returns void language plpgsql security definer set search_path = public as $$
declare
  since timestamptz := (((now() at time zone 'utc')::date - (greatest(p_days, 1) - 1))::timestamp at time zone 'utc');
begin
  insert into public.game_stats_daily as s (
    game_id, day, impressions, ready_count, play_starts, play_ends, total_play_ms, replays, likes, shares, saves,
    comments, fast_skips, load_failures, unique_players)
  select e.game_id, (e.created_at at time zone 'utc')::date,
    count(*) filter (where e.type = 'impression'),
    count(*) filter (where e.type = 'ready'),
    count(*) filter (where e.type = 'play_start'),
    count(*) filter (where e.type = 'play_end'),
    coalesce(sum(e.duration_ms) filter (where e.type = 'play_end'), 0),
    count(*) filter (where e.type = 'replay'),
    count(*) filter (where e.type = 'like'),
    count(*) filter (where e.type = 'share'),
    count(*) filter (where e.type = 'save'),
    count(*) filter (where e.type = 'comment'),
    count(*) filter (where e.type = 'skip' and e.state = 'PREVIEW' and coalesce(e.dwell_ms, 999999) < 1500),
    count(*) filter (where e.type = 'load_failed'),
    count(distinct e.user_id) filter (where e.type = 'play_start')
  from public.feed_events e
  where e.created_at >= since and e.game_id is not null
    and exists (select 1 from public.games g where g.id = e.game_id)
  group by e.game_id, (e.created_at at time zone 'utc')::date
  on conflict (game_id, day) do update set
    impressions = excluded.impressions, ready_count = excluded.ready_count, play_starts = excluded.play_starts,
    play_ends = excluded.play_ends, total_play_ms = excluded.total_play_ms, replays = excluded.replays,
    likes = excluded.likes, shares = excluded.shares, saves = excluded.saves, comments = excluded.comments,
    fast_skips = excluded.fast_skips, load_failures = excluded.load_failures, unique_players = excluded.unique_players;
end $$;

-- Trending hashtags by velocity: recent daily activity vs. the prior week's daily average.
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
     ), 0);
end $$;

create or replace function public.decay_affinity()
returns void language sql security definer set search_path = public as $$
  update public.user_tag_affinity set weight = weight * 0.97, updated_at = now() where abs(weight) >= 0.02;
  delete from public.user_tag_affinity where abs(weight) < 0.02;
$$;

create or replace function public.cleanup_stale_sessions()
returns void language sql security definer set search_path = public as $$
  update public.play_sessions
     set ended_at = now(), outcome = 'quit', accepted = false, reject_reason = 'stale'
   where ended_at is null and started_at < now() - interval '3 hours';
$$;

-- -----------------------------------------------------------------------------
-- Runtime secrets for push dispatch (stored in Vault; set by `pnpm seed` locally, by ops in prod)
-- -----------------------------------------------------------------------------
create or replace function public.set_runtime_secret(p_name text, p_value text)
returns void language plpgsql security definer set search_path = public, vault as $$
declare
  sid uuid;
begin
  if not public.is_service() then
    raise exception 'service only' using errcode = '42501';
  end if;
  if p_name not in ('thumbcade_notify_url', 'thumbcade_service_role_key') then
    raise exception 'unknown secret %', p_name;
  end if;
  select id into sid from vault.secrets where name = p_name;
  if sid is null then
    perform vault.create_secret(p_value, p_name);
  else
    perform vault.update_secret(sid, p_value);
  end if;
end $$;

-- Calls the `notify` edge function when there is something to push.
create or replace function public.dispatch_push()
returns void language plpgsql security definer set search_path = public, extensions as $$
declare
  v_url text;
  v_key text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'thumbcade_notify_url';
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'thumbcade_service_role_key';
  if v_url is null or v_key is null then
    return;
  end if;
  if not exists (
    select 1 from public.notifications n join public.push_tokens t on t.user_id = n.user_id
    where n.pushed_at is null and n.created_at > now() - interval '1 day'
  ) then
    return;
  end if;
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
    body := '{}'::jsonb
  );
end $$;

-- -----------------------------------------------------------------------------
-- Play sessions and score integrity (§9)
-- -----------------------------------------------------------------------------
create or replace function public.start_play_session(p_user uuid, p_game uuid, p_version uuid, p_reason text default 'feed')
returns uuid language plpgsql security definer set search_path = public as $$
declare
  sid uuid;
begin
  if not public.is_service() then
    raise exception 'service only' using errcode = '42501';
  end if;
  perform public.enter_trusted();
  if not exists (select 1 from public.games g where g.id = p_game and g.status = 'live') then
    raise exception 'game_not_live' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.game_versions v where v.id = p_version and v.game_id = p_game) then
    raise exception 'version_mismatch' using errcode = 'P0002';
  end if;
  insert into public.play_sessions (user_id, game_id, version_id, launch_reason)
  values (p_user, p_game, p_version, coalesce(p_reason, 'feed'))
  returning id into sid;
  update public.games set play_count = play_count + 1 where id = p_game;
  return sid;
end $$;

create or replace function public.finish_play_session(
  p_session uuid, p_user uuid, p_score double precision, p_duration_ms integer, p_outcome text default null
)
returns table (accepted boolean, reason text, best double precision, is_new_best boolean, percentile real, daily_rank integer)
language plpgsql security definer set search_path = public as $$
declare
  s public.play_sessions;
  v_order text;
  v_max double precision;
  v_guest boolean;
  v_elapsed double precision;
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

  if p_score is null or p_score = 'NaN'::double precision or p_score < 0 or p_score = 'Infinity'::double precision then
    v_reason := 'invalid_score';
  elsif v_max is not null and p_score > v_max then
    v_reason := 'over_max';
  elsif p_duration_ms is null or p_duration_ms < 0 or p_duration_ms > v_elapsed + 5000 or v_elapsed < 400 then
    v_reason := 'impossible_duration';
  elsif coalesce(v_guest, true) then
    v_reason := 'guest';
  end if;

  update public.play_sessions
     set ended_at = now(), duration_ms = greatest(0, coalesce(p_duration_ms, 0)),
         score = case when v_reason in ('invalid_score', 'over_max') then null else p_score end,
         outcome = case when p_outcome in ('win', 'lose', 'quit') then p_outcome else null end,
         accepted = v_reason is null, reject_reason = v_reason
   where id = p_session;

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
-- Leaderboards (client RPCs)
-- -----------------------------------------------------------------------------
create or replace function public.leaderboard(p_game_id uuid, p_scope text default 'allTime', p_limit integer default 20)
returns table (
  rank integer, user_id uuid, handle text, display_name text, avatar_url text, avatar_seed text,
  score double precision, is_me boolean
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_order text;
  v_me uuid := auth.uid();
  v_scope text := case when p_scope in ('daily', 'allTime', 'friends') then p_scope else 'allTime' end;
begin
  select coalesce(g.score_config->>'order', 'desc') into v_order from public.games g where g.id = p_game_id and g.status = 'live';
  if v_order is null then
    return;
  end if;
  return query
  with base as (
    select b.user_id uid, b.best_score s from public.best_scores b
    where b.game_id = p_game_id and v_scope in ('allTime', 'friends')
    union all
    select d.user_id, d.best_score from public.daily_scores d
    where d.game_id = p_game_id and d.day = (now() at time zone 'utc')::date and v_scope = 'daily'
  ),
  filtered as (
    select base.uid, base.s from base
    join public.profiles pr on pr.id = base.uid
    where not pr.is_guest
      and not public.is_blocked_between(v_me, base.uid)
      and (
        v_scope <> 'friends' or base.uid = v_me or (
          exists (select 1 from public.follows f where f.follower_id = v_me and f.followee_id = base.uid)
          and exists (select 1 from public.follows f where f.follower_id = base.uid and f.followee_id = v_me)
        )
      )
  ),
  ranked as (
    select f.uid, f.s,
      (rank() over (order by case when v_order = 'asc' then f.s end asc nulls last,
                             case when v_order <> 'asc' then f.s end desc nulls last))::integer r
    from filtered f
  )
  select rk.r, rk.uid, pr.handle, pr.display_name, pr.avatar_url, pr.avatar_seed, rk.s, rk.uid = v_me
  from ranked rk join public.profiles pr on pr.id = rk.uid
  order by rk.r, pr.handle
  limit least(greatest(coalesce(p_limit, 20), 1), 100);
end $$;

create or replace function public.leaderboard_me(p_game_id uuid)
returns table (best double precision, rank integer, percentile real)
language plpgsql stable security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_order text;
  v_best double precision;
  v_member boolean;
  v_others integer;
  v_worse integer;
  v_better integer;
begin
  select coalesce(g.score_config->>'order', 'desc') into v_order from public.games g where g.id = p_game_id;
  if v_me is null or v_order is null then
    return query select null::double precision, null::integer, null::real;
    return;
  end if;
  v_best := public.viewer_best(v_me, p_game_id);
  if v_best is null then
    return query select null::double precision, null::integer, null::real;
    return;
  end if;
  select not pr.is_guest into v_member from public.profiles pr where pr.id = v_me;
  select count(*),
         count(*) filter (where public.score_better(v_order, v_best, b.best_score)),
         count(*) filter (where public.score_better(v_order, b.best_score, v_best))
    into v_others, v_worse, v_better
  from public.best_scores b join public.profiles pr on pr.id = b.user_id
  where b.game_id = p_game_id and b.user_id <> v_me and not pr.is_guest;
  return query select
    v_best,
    case when coalesce(v_member, false) then 1 + v_better else null end,
    case when v_others = 0 then null else (100.0 * v_worse / v_others)::real end;
end $$;

-- After a guest signs up, their best guest runs become ranked scores.
create or replace function public.claim_guest_scores()
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  n integer := 0;
begin
  if not public.is_member() then
    raise exception 'sign in to claim scores' using errcode = '42501';
  end if;
  perform public.enter_trusted();

  with runs as (
    select s.id, s.game_id, s.score, s.ended_at, coalesce(g.score_config->>'order', 'desc') o
    from public.play_sessions s join public.games g on g.id = s.game_id
    where s.user_id = v_me and s.reject_reason = 'guest' and s.score is not null
  ),
  best as (
    select distinct on (game_id) game_id, score, id, ended_at
    from runs order by game_id, case when o = 'asc' then score end asc, case when o <> 'asc' then score end desc
  ),
  up as (
    insert into public.best_scores as b (game_id, user_id, best_score, achieved_at, session_id)
    select best.game_id, v_me, best.score, coalesce(best.ended_at, now()), best.id from best
    on conflict (game_id, user_id) do update
      set best_score = excluded.best_score, achieved_at = excluded.achieved_at, session_id = excluded.session_id
      where public.score_better(
        (select coalesce(g.score_config->>'order', 'desc') from public.games g where g.id = b.game_id),
        excluded.best_score, b.best_score)
    returning 1
  )
  select count(*) into n from up;

  insert into public.daily_scores as d (game_id, user_id, day, best_score, achieved_at)
  select r.game_id, v_me, (r.ended_at at time zone 'utc')::date,
    case when r.o = 'asc' then min(r.score) else max(r.score) end, max(r.ended_at)
  from (
    select s.game_id, s.score, s.ended_at, coalesce(g.score_config->>'order', 'desc') o
    from public.play_sessions s join public.games g on g.id = s.game_id
    where s.user_id = v_me and s.reject_reason = 'guest' and s.score is not null and s.ended_at is not null
  ) r
  group by r.game_id, (r.ended_at at time zone 'utc')::date, r.o
  on conflict (game_id, day, user_id) do update
    set best_score = excluded.best_score, achieved_at = excluded.achieved_at
    where public.score_better(
      (select coalesce(g.score_config->>'order', 'desc') from public.games g where g.id = d.game_id),
      excluded.best_score, d.best_score);

  update public.play_sessions set accepted = true, reject_reason = null
   where user_id = v_me and reject_reason = 'guest';
  return n;
end $$;

-- -----------------------------------------------------------------------------
-- Social notifications (triggers)
-- -----------------------------------------------------------------------------
create or replace function public.notify_on_follow()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.is_blocked_between(new.follower_id, new.followee_id) then
    return null;
  end if;
  if exists (
    select 1 from public.notifications n
    where n.user_id = new.followee_id and n.type = 'follow' and n.actor_id = new.follower_id
      and n.created_at > now() - interval '1 day'
  ) then
    return null;
  end if;
  insert into public.notifications (user_id, type, actor_id) values (new.followee_id, 'follow', new.follower_id);
  return null;
end $$;
create trigger follows_notify after insert on public.follows for each row execute function public.notify_on_follow();

create or replace function public.notify_on_comment_like()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  c public.comments;
begin
  select * into c from public.comments where id = new.comment_id;
  if not found or c.user_id = new.user_id or public.is_blocked_between(c.user_id, new.user_id) then
    return null;
  end if;
  if exists (
    select 1 from public.notifications n
    where n.user_id = c.user_id and n.type = 'comment_like' and n.actor_id = new.user_id and n.comment_id = c.id
  ) then
    return null;
  end if;
  insert into public.notifications (user_id, type, actor_id, game_id, comment_id, payload)
  values (c.user_id, 'comment_like', new.user_id, c.game_id, c.id, jsonb_build_object('excerpt', left(c.body, 80)));
  return null;
end $$;
create trigger comment_likes_notify after insert on public.comment_likes for each row execute function public.notify_on_comment_like();

create or replace function public.notify_on_comment_reply()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  parent_author uuid;
begin
  if new.parent_id is null then
    return null;
  end if;
  select user_id into parent_author from public.comments where id = new.parent_id;
  if parent_author is null or parent_author = new.user_id or public.is_blocked_between(parent_author, new.user_id) then
    return null;
  end if;
  insert into public.notifications (user_id, type, actor_id, game_id, comment_id, payload)
  values (parent_author, 'comment_reply', new.user_id, new.game_id, new.id,
    jsonb_build_object('excerpt', left(new.body, 80), 'parentId', new.parent_id));
  return null;
end $$;
create trigger comments_notify_reply after insert on public.comments for each row execute function public.notify_on_comment_reply();

-- -----------------------------------------------------------------------------
-- Comment moderation: word filter, rate limit, score badge, single pin per game
-- -----------------------------------------------------------------------------
create table public.moderation_words (
  word text primary key check (word ~ '^[a-z0-9 ]{2,40}$'),
  kind text not null default 'abuse' check (kind in ('abuse', 'spam', 'self_harm')),
  created_at timestamptz not null default now()
);
alter table public.moderation_words enable row level security;
create policy moderation_words_admin on public.moderation_words for all using (public.is_admin()) with check (public.is_admin());

insert into public.moderation_words (word, kind) values
  ('kys', 'self_harm'), ('kill yourself', 'self_harm'), ('go die', 'self_harm'),
  ('nigger', 'abuse'), ('nigga', 'abuse'), ('faggot', 'abuse'), ('fag', 'abuse'), ('retard', 'abuse'),
  ('tranny', 'abuse'), ('kike', 'abuse'), ('spic', 'abuse'), ('chink', 'abuse'),
  ('free robux', 'spam'), ('free vbucks', 'spam'), ('free v bucks', 'spam'), ('onlyfans', 'spam'),
  ('crypto giveaway', 'spam'), ('dm me for promo', 'spam'), ('buy followers', 'spam'), ('telegram me', 'spam'),
  ('click my link', 'spam'), ('check my bio', 'spam')
on conflict do nothing;

create or replace function public.comments_moderate()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  normalized text;
begin
  if not public.is_service() then
    normalized := regexp_replace(translate(lower(new.body), '013457@$!|', 'oieastasii'), '\s+', ' ', 'g');
    if exists (select 1 from public.moderation_words m where normalized ~ ('\m' || m.word || '\M')) then
      raise exception 'comment_filtered' using errcode = 'P0001', hint = 'The comment matched the community filter.';
    end if;
    if (select count(*) from public.comments c where c.user_id = new.user_id and c.created_at > now() - interval '60 seconds') >= 5 then
      raise exception 'comment_rate_limited' using errcode = 'P0001', hint = 'Slow down: 5 comments per minute.';
    end if;
    new.score_badge := (select b.best_score from public.best_scores b where b.game_id = new.game_id and b.user_id = new.user_id);
    new.is_pinned := false;
  elsif new.score_badge is null then
    new.score_badge := (select b.best_score from public.best_scores b where b.game_id = new.game_id and b.user_id = new.user_id);
  end if;
  return new;
end $$;
create trigger comments_moderate before insert on public.comments for each row execute function public.comments_moderate();

create or replace function public.comments_single_pin()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.is_pinned and new.parent_id is not null then
    update public.comments set is_pinned = false where id = new.id;
    return null;
  end if;
  if new.is_pinned and not coalesce(old.is_pinned, false) then
    perform public.enter_trusted();
    update public.comments set is_pinned = false where game_id = new.game_id and id <> new.id and is_pinned;
  end if;
  return null;
end $$;
create trigger comments_single_pin after update of is_pinned on public.comments for each row execute function public.comments_single_pin();

-- -----------------------------------------------------------------------------
-- Indexes
-- -----------------------------------------------------------------------------
create index if not exists feed_events_user_type on public.feed_events (user_id, type, created_at desc);
create index if not exists play_sessions_open on public.play_sessions (started_at) where ended_at is null;
create index if not exists play_sessions_guest on public.play_sessions (user_id, game_id) where reject_reason = 'guest';
create index if not exists shares_user on public.shares (user_id);
create index if not exists comments_user_recent on public.comments (user_id, created_at desc);
create index if not exists game_stats_daily_day on public.game_stats_daily (day);
create index if not exists follows_follower on public.follows (follower_id);

-- -----------------------------------------------------------------------------
-- Grants: service-only functions are not callable by clients
-- -----------------------------------------------------------------------------
revoke execute on function public.rank_feed(uuid, jsonb, integer, text, text) from public, anon, authenticated;
revoke execute on function public.feed_hydrate(uuid, uuid[]) from public, anon, authenticated;
revoke execute on function public.ingest_events(uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.rollup_game_stats(integer) from public, anon, authenticated;
revoke execute on function public.compute_trending() from public, anon, authenticated;
revoke execute on function public.decay_affinity() from public, anon, authenticated;
revoke execute on function public.cleanup_stale_sessions() from public, anon, authenticated;
revoke execute on function public.set_runtime_secret(text, text) from public, anon, authenticated;
revoke execute on function public.dispatch_push() from public, anon, authenticated;
revoke execute on function public.start_play_session(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public.finish_play_session(uuid, uuid, double precision, integer, text) from public, anon, authenticated;
revoke execute on function public.viewer_best(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.beta_sample(integer, integer) from public, anon, authenticated;
revoke execute on function public.is_blocked_between(uuid, uuid) from public, anon, authenticated;

grant execute on function public.rank_feed(uuid, jsonb, integer, text, text) to service_role;
grant execute on function public.feed_hydrate(uuid, uuid[]) to service_role;
grant execute on function public.ingest_events(uuid, jsonb) to service_role;
grant execute on function public.rollup_game_stats(integer) to service_role;
grant execute on function public.compute_trending() to service_role;
grant execute on function public.decay_affinity() to service_role;
grant execute on function public.cleanup_stale_sessions() to service_role;
grant execute on function public.set_runtime_secret(text, text) to service_role;
grant execute on function public.dispatch_push() to service_role;
grant execute on function public.start_play_session(uuid, uuid, uuid, text) to service_role;
grant execute on function public.finish_play_session(uuid, uuid, double precision, integer, text) to service_role;
grant execute on function public.viewer_best(uuid, uuid) to service_role;
grant execute on function public.beta_sample(integer, integer) to service_role;

grant execute on function public.leaderboard(uuid, text, integer) to anon, authenticated;
grant execute on function public.leaderboard_me(uuid) to anon, authenticated;
grant execute on function public.claim_guest_scores() to authenticated;
revoke execute on function public.claim_guest_scores() from anon;

-- -----------------------------------------------------------------------------
-- pg_cron schedules (named jobs are upserted)
-- -----------------------------------------------------------------------------
select cron.schedule('thumbcade-feed-partitions', '5 0 * * *', $$select public.ensure_feed_event_partitions(7)$$);
select cron.schedule('thumbcade-stats-rollup', '*/10 * * * *', $$select public.rollup_game_stats(2)$$);
select cron.schedule('thumbcade-trending', '7 * * * *', $$select public.compute_trending()$$);
select cron.schedule('thumbcade-affinity-decay', '30 3 * * *', $$select public.decay_affinity()$$);
select cron.schedule('thumbcade-stale-sessions', '15 * * * *', $$select public.cleanup_stale_sessions()$$);
select cron.schedule('thumbcade-push-dispatch', '* * * * *', $$select public.dispatch_push()$$);
