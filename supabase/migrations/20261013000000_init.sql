-- =============================================================================
-- Thumbcade — initial schema (CONTRACT, owned by the lead).
-- Later migrations may only alter tables owned by the migrating stream
-- (see CLAUDE.md -> Ownership). Every table has RLS enabled with explicit policies.
--
-- Identity model: every app install signs in (anonymously at first) through Supabase Auth.
-- Guests are anonymous auth users (auth.jwt()->>'is_anonymous' = 'true'); they can play,
-- record sessions and keep game storage, but cannot like, comment, follow, save, report or
-- appear on leaderboards. Linking Apple/Google/email upgrades the same user id in place.
-- =============================================================================

create extension if not exists pg_trgm with schema extensions;
create extension if not exists pg_cron;

-- -----------------------------------------------------------------------------
-- Enums
-- -----------------------------------------------------------------------------
create type public.user_role as enum ('user', 'creator', 'admin');
create type public.age_band as enum ('under13', '13to15', '16to17', 'adult');
create type public.age_rating as enum ('4+', '9+', '12+', '17+');
create type public.game_status as enum ('draft', 'in_review', 'live', 'rejected', 'removed');
create type public.version_status as enum ('uploaded', 'auto_checking', 'auto_failed', 'pending_review', 'approved', 'rejected');
create type public.comment_status as enum ('visible', 'hidden', 'removed');
create type public.report_target as enum ('game', 'comment', 'user');
create type public.report_status as enum ('open', 'actioned', 'dismissed');
create type public.review_job_status as enum ('queued', 'running', 'done', 'failed');
create type public.notification_type as enum (
  'follow', 'comment_like', 'comment_reply', 'score_beaten', 'new_game',
  'game_approved', 'game_rejected', 'challenge_accepted'
);
create type public.feed_event_type as enum (
  'impression', 'ready', 'play_start', 'play_end', 'skip', 'replay', 'like', 'unlike',
  'save', 'unsave', 'share', 'comment', 'follow', 'open_game_page', 'load_failed', 'custom'
);

-- -----------------------------------------------------------------------------
-- Helpers
-- -----------------------------------------------------------------------------

-- True when the request comes from the service role or a direct database session (seed, cron).
create or replace function public.is_service()
returns boolean language sql stable as $$
  select coalesce(auth.jwt()->>'role', 'service_role') = 'service_role'
$$;

-- True when the caller is a signed-in, non-anonymous user.
create or replace function public.is_member()
returns boolean language sql stable as $$
  select auth.uid() is not null and coalesce((auth.jwt()->>'is_anonymous')::boolean, false) = false
$$;

-- True inside trusted server-side paths: nested trigger updates (counters) and security-definer
-- RPCs that call public.enter_trusted(). Clients cannot set this GUC through PostgREST.
create or replace function public.in_trusted_path()
returns boolean language sql stable as $$
  select pg_trigger_depth() > 1 or coalesce(current_setting('thumbcade.trusted', true), '') = 'on'
$$;

create or replace function public.enter_trusted()
returns void language sql as $$
  select set_config('thumbcade.trusted', 'on', true)
$$;
revoke execute on function public.enter_trusted() from public, anon, authenticated;

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- -----------------------------------------------------------------------------
-- Profiles
-- -----------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  handle text not null unique check (handle ~ '^[a-z0-9_.]{3,24}$'),
  display_name text not null check (char_length(display_name) between 1 and 40),
  avatar_url text,
  avatar_seed text not null,
  bio text not null default '' check (char_length(bio) <= 160),
  age_band public.age_band,
  role public.user_role not null default 'user',
  verified boolean not null default false,
  is_guest boolean not null default true,
  follower_count integer not null default 0,
  following_count integer not null default 0,
  game_count integer not null default 0,
  likes_received integer not null default 0,
  interests text[] not null default '{}',
  dock_coach_shown smallint not null default 0,
  is_seed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index profiles_handle_trgm on public.profiles using gin (handle extensions.gin_trgm_ops);
create index profiles_display_name_trgm on public.profiles using gin (display_name extensions.gin_trgm_ops);
create trigger profiles_touch before update on public.profiles for each row execute function public.touch_updated_at();

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
$$;

create or replace function public.is_creator()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role in ('creator', 'admin'))
$$;

-- Non-service callers can't change privileged columns.
create or replace function public.profiles_protect()
returns trigger language plpgsql as $$
begin
  if public.is_service() or public.is_admin() or public.in_trusted_path() then
    return new;
  end if;
  new.role := old.role;
  new.verified := old.verified;
  new.is_guest := old.is_guest;
  new.follower_count := old.follower_count;
  new.following_count := old.following_count;
  new.game_count := old.game_count;
  new.likes_received := old.likes_received;
  new.is_seed := old.is_seed;
  return new;
end $$;
create trigger profiles_protect before update on public.profiles for each row execute function public.profiles_protect();

-- Every auth user gets a profile. Guests get a generated handle they can change after sign-up.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  base text;
  candidate text;
  n integer := 0;
begin
  base := lower(regexp_replace(coalesce(meta->>'handle', meta->>'preferred_username', split_part(coalesce(new.email, ''), '@', 1), ''), '[^a-z0-9_.]', '', 'g'));
  if char_length(base) < 3 then
    base := 'player';
  end if;
  base := left(base, 18);
  candidate := base;
  if coalesce(new.is_anonymous, false) then
    candidate := 'player' || (floor(random() * 900000) + 100000)::int::text;
  end if;
  while exists (select 1 from public.profiles where handle = candidate) loop
    n := n + 1;
    candidate := base || (floor(random() * 90000) + 10000)::int::text;
    if n > 20 then
      candidate := 'player' || replace(left(new.id::text, 8), '-', '');
      exit;
    end if;
  end loop;

  insert into public.profiles (id, handle, display_name, avatar_seed, is_guest)
  values (
    new.id,
    candidate,
    left(coalesce(nullif(meta->>'display_name', ''), nullif(meta->>'full_name', ''), nullif(meta->>'name', ''), candidate), 40),
    new.id::text,
    coalesce(new.is_anonymous, false)
  );
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- When a guest links an identity, flip is_guest.
create or replace function public.handle_user_upgraded()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(old.is_anonymous, false) and not coalesce(new.is_anonymous, false) then
    update public.profiles set is_guest = false where id = new.id;
  end if;
  return new;
end $$;

create trigger on_auth_user_upgraded after update of is_anonymous on auth.users
  for each row execute function public.handle_user_upgraded();

-- -----------------------------------------------------------------------------
-- Games and versions
-- -----------------------------------------------------------------------------
create table public.games (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$'),
  creator_id uuid not null references public.profiles (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 32),
  description text not null default '' check (char_length(description) <= 120),
  icon_url text,
  poster_url text,
  accent_color text not null default '#D4FF3D' check (accent_color ~ '^#[0-9A-Fa-f]{6}$'),
  tags text[] not null default '{}',
  primary_tag text generated always as (tags[1]) stored,
  age_rating public.age_rating not null default '9+',
  controls jsonb not null default '{"vertical": false, "horizontal": false, "multitouch": false, "inputs": ["tap"]}',
  session_length text not null default 'short' check (session_length in ('short', 'medium', 'long')),
  audio boolean not null default true,
  score_config jsonb not null default '{"order": "desc", "max": 1000000, "format": "integer"}',
  status public.game_status not null default 'draft',
  live_version_id uuid,
  featured_rank integer,
  play_count bigint not null default 0,
  like_count integer not null default 0,
  comment_count integer not null default 0,
  share_count integer not null default 0,
  save_count integer not null default 0,
  is_seed boolean not null default false,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index games_creator on public.games (creator_id);
create index games_status on public.games (status);
create index games_tags on public.games using gin (tags);
create index games_name_trgm on public.games using gin (name extensions.gin_trgm_ops);
create trigger games_touch before update on public.games for each row execute function public.touch_updated_at();

create table public.game_versions (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games (id) on delete cascade,
  semver text not null,
  manifest jsonb not null,
  bundle_path text not null,
  size_bytes bigint not null default 0,
  gzip_bytes bigint not null default 0,
  status public.version_status not null default 'uploaded',
  review_report jsonb,
  review_notes text,
  release_notes text check (char_length(release_notes) <= 500),
  submitted_by uuid references public.profiles (id) on delete set null,
  approved_by uuid references public.profiles (id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (game_id, semver)
);
create index game_versions_game on public.game_versions (game_id, created_at desc);
create index game_versions_status on public.game_versions (status);

alter table public.games
  add constraint games_live_version_fk foreign key (live_version_id) references public.game_versions (id) on delete set null;

-- Creators may edit metadata of their own games; status, live version, counters and slug are
-- controlled by the service role and admins.
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
create trigger games_protect before update on public.games for each row execute function public.games_protect();

-- -----------------------------------------------------------------------------
-- Hashtags
-- -----------------------------------------------------------------------------
create table public.hashtags (
  tag text primary key check (tag ~ '^[a-z0-9_]{1,32}$'),
  game_count integer not null default 0,
  trend_score real not null default 0,
  created_at timestamptz not null default now()
);
create index hashtags_trgm on public.hashtags using gin (tag extensions.gin_trgm_ops);
create index hashtags_trend on public.hashtags (trend_score desc);

create table public.game_hashtags (
  game_id uuid not null references public.games (id) on delete cascade,
  tag text not null references public.hashtags (tag) on delete cascade,
  position smallint not null default 0,
  primary key (game_id, tag)
);
create index game_hashtags_tag on public.game_hashtags (tag);

-- Keep game_hashtags/hashtags in sync with games.tags.
create or replace function public.sync_game_hashtags()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  t text;
  i integer := 0;
begin
  if tg_op = 'UPDATE' and new.tags is not distinct from old.tags then
    return new;
  end if;
  delete from public.game_hashtags where game_id = new.id;
  foreach t in array new.tags loop
    insert into public.hashtags (tag) values (t) on conflict (tag) do nothing;
    insert into public.game_hashtags (game_id, tag, position) values (new.id, t, i) on conflict do nothing;
    i := i + 1;
  end loop;
  update public.hashtags h set game_count = (select count(*) from public.game_hashtags g where g.tag = h.tag)
  where h.tag = any (new.tags) or (tg_op = 'UPDATE' and h.tag = any (old.tags));
  return new;
end $$;
create trigger games_sync_hashtags after insert or update of tags on public.games
  for each row execute function public.sync_game_hashtags();

-- -----------------------------------------------------------------------------
-- Social graph
-- -----------------------------------------------------------------------------
create table public.follows (
  follower_id uuid not null references public.profiles (id) on delete cascade,
  followee_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, followee_id),
  check (follower_id <> followee_id)
);
create index follows_followee on public.follows (followee_id, created_at desc);

create table public.likes (
  user_id uuid not null references public.profiles (id) on delete cascade,
  game_id uuid not null references public.games (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, game_id)
);
create index likes_game on public.likes (game_id);

create table public.saves (
  user_id uuid not null references public.profiles (id) on delete cascade,
  game_id uuid not null references public.games (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, game_id)
);

create table public.blocks (
  blocker_id uuid not null references public.profiles (id) on delete cascade,
  blocked_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
create index blocks_blocked on public.blocks (blocked_id);

-- -----------------------------------------------------------------------------
-- Comments
-- -----------------------------------------------------------------------------
create table public.comments (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  parent_id uuid references public.comments (id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 500),
  like_count integer not null default 0,
  reply_count integer not null default 0,
  score_badge double precision,
  is_pinned boolean not null default false,
  status public.comment_status not null default 'visible',
  is_seed boolean not null default false,
  created_at timestamptz not null default now()
);
create index comments_game on public.comments (game_id, created_at desc) where parent_id is null;
create index comments_parent on public.comments (parent_id, created_at);
create index comments_user on public.comments (user_id);

-- Replies are one level deep.
create or replace function public.comments_validate()
returns trigger language plpgsql as $$
begin
  if new.parent_id is not null and exists (select 1 from public.comments where id = new.parent_id and parent_id is not null) then
    raise exception 'replies are one level deep';
  end if;
  if new.parent_id is not null and not exists (select 1 from public.comments where id = new.parent_id and game_id = new.game_id) then
    raise exception 'reply must belong to the same game';
  end if;
  return new;
end $$;
create trigger comments_validate before insert on public.comments for each row execute function public.comments_validate();

-- Users can only change their own comment's body... no: comments are immutable for users.
-- Game creators may pin/hide comments on their game; admins may do anything.
create or replace function public.comments_protect()
returns trigger language plpgsql as $$
begin
  if public.is_service() or public.is_admin() or public.in_trusted_path() then
    return new;
  end if;
  new.body := old.body;
  new.game_id := old.game_id;
  new.user_id := old.user_id;
  new.parent_id := old.parent_id;
  new.like_count := old.like_count;
  new.reply_count := old.reply_count;
  new.score_badge := old.score_badge;
  new.is_seed := old.is_seed;
  new.created_at := old.created_at;
  if new.status = 'removed' then
    new.status := old.status;
  end if;
  return new;
end $$;
create trigger comments_protect before update on public.comments for each row execute function public.comments_protect();

create table public.comment_likes (
  user_id uuid not null references public.profiles (id) on delete cascade,
  comment_id uuid not null references public.comments (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, comment_id)
);
create index comment_likes_comment on public.comment_likes (comment_id);

-- -----------------------------------------------------------------------------
-- Shares & challenges
-- -----------------------------------------------------------------------------
create table public.shares (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Za-z0-9]{6,12}$'),
  user_id uuid references public.profiles (id) on delete set null,
  game_id uuid not null references public.games (id) on delete cascade,
  channel text not null default 'link' check (channel in ('link', 'challenge', 'card', 'system')),
  challenge_score double precision,
  open_count integer not null default 0,
  created_at timestamptz not null default now()
);
create index shares_game on public.shares (game_id);

-- -----------------------------------------------------------------------------
-- Play sessions & scores
-- -----------------------------------------------------------------------------
create table public.play_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  game_id uuid not null references public.games (id) on delete cascade,
  version_id uuid references public.game_versions (id) on delete set null,
  launch_reason text not null default 'feed',
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  duration_ms integer,
  score double precision,
  outcome text check (outcome in ('win', 'lose', 'quit')),
  accepted boolean,
  reject_reason text
);
create index play_sessions_user on public.play_sessions (user_id, started_at desc);
create index play_sessions_game on public.play_sessions (game_id, started_at desc);

create table public.best_scores (
  game_id uuid not null references public.games (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  best_score double precision not null,
  achieved_at timestamptz not null default now(),
  session_id uuid references public.play_sessions (id) on delete set null,
  primary key (game_id, user_id)
);
create index best_scores_rank on public.best_scores (game_id, best_score desc);

create table public.daily_scores (
  game_id uuid not null references public.games (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  day date not null default (now() at time zone 'utc')::date,
  best_score double precision not null,
  achieved_at timestamptz not null default now(),
  primary key (game_id, day, user_id)
);
create index daily_scores_rank on public.daily_scores (game_id, day, best_score desc);

-- -----------------------------------------------------------------------------
-- Game storage (tc.storage)
-- -----------------------------------------------------------------------------
create table public.game_kv (
  user_id uuid not null references public.profiles (id) on delete cascade,
  game_id uuid not null references public.games (id) on delete cascade,
  key text not null check (key ~ '^[A-Za-z0-9_.:-]{1,64}$'),
  value jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, game_id, key)
);

create or replace function public.game_kv_quota()
returns trigger language plpgsql as $$
declare
  total bigint;
begin
  if octet_length(new.value::text) > 16384 then
    raise exception 'storage value exceeds 16 KB' using errcode = '54000';
  end if;
  select coalesce(sum(octet_length(value::text)), 0) into total
  from public.game_kv where user_id = new.user_id and game_id = new.game_id and key <> new.key;
  if total + octet_length(new.value::text) > 65536 then
    raise exception 'storage quota (64 KB per game) exceeded' using errcode = '54000';
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger game_kv_quota before insert or update on public.game_kv for each row execute function public.game_kv_quota();

-- -----------------------------------------------------------------------------
-- Events (append-only, partitioned by day)
-- -----------------------------------------------------------------------------
create table public.feed_events (
  id bigint generated always as identity,
  user_id uuid not null,
  game_id uuid,
  version_id uuid,
  type public.feed_event_type not null,
  card_id text,
  feed_id text,
  dwell_ms integer,
  state text,
  score double precision,
  duration_ms integer,
  meta jsonb,
  client_ts timestamptz,
  created_at timestamptz not null default now(),
  primary key (id, created_at)
) partition by range (created_at);

create table public.feed_events_default partition of public.feed_events default;

create or replace function public.ensure_feed_event_partitions(days_ahead integer default 7)
returns void language plpgsql security definer set search_path = public as $$
declare
  d date;
  name text;
begin
  for i in 0..days_ahead loop
    d := (now() at time zone 'utc')::date + i;
    name := 'feed_events_' || to_char(d, 'YYYYMMDD');
    if not exists (select 1 from pg_class where relname = name) then
      execute format(
        'create table public.%I partition of public.feed_events for values from (%L) to (%L)',
        name, d::timestamptz, (d + 1)::timestamptz
      );
      execute format('alter table public.%I enable row level security', name);
    end if;
  end loop;
end $$;
select public.ensure_feed_event_partitions(7);

create index feed_events_user on public.feed_events (user_id, created_at desc);
create index feed_events_game on public.feed_events (game_id, created_at desc);

-- -----------------------------------------------------------------------------
-- Ranking inputs
-- -----------------------------------------------------------------------------
create table public.user_tag_affinity (
  user_id uuid not null references public.profiles (id) on delete cascade,
  tag text not null,
  weight real not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, tag)
);

create table public.game_stats_daily (
  game_id uuid not null references public.games (id) on delete cascade,
  day date not null,
  impressions integer not null default 0,
  ready_count integer not null default 0,
  play_starts integer not null default 0,
  play_ends integer not null default 0,
  total_play_ms bigint not null default 0,
  replays integer not null default 0,
  likes integer not null default 0,
  shares integer not null default 0,
  saves integer not null default 0,
  comments integer not null default 0,
  fast_skips integer not null default 0,
  load_failures integer not null default 0,
  unique_players integer not null default 0,
  primary key (game_id, day)
);

create table public.feed_config (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
insert into public.feed_config (key, value) values
  ('weights', '{
    "playStartRate": 2.0,
    "replayRate": 2.5,
    "likeRate": 1.5,
    "shareRate": 2.0,
    "tagAffinity": 1.2,
    "followBoost": 0.8,
    "freshness": 0.6,
    "fastSkipRate": -2.5,
    "freshnessHalfLifeDays": 10
  }'),
  ('exploration', '{"every": 4, "maxImpressions": 500}'),
  ('dedupe', '{"sessionWindow": true, "hours": 24, "affinityOverride": 0.85}'),
  ('diversity', '{"noSameCreatorInRow": true, "noSamePrimaryTagInRow": true}');

-- -----------------------------------------------------------------------------
-- Notifications, reports, push tokens
-- -----------------------------------------------------------------------------
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  type public.notification_type not null,
  actor_id uuid references public.profiles (id) on delete cascade,
  game_id uuid references public.games (id) on delete cascade,
  comment_id uuid references public.comments (id) on delete cascade,
  payload jsonb not null default '{}',
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user on public.notifications (user_id, created_at desc);

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles (id) on delete cascade,
  target_type public.report_target not null,
  target_id uuid not null,
  reason text not null check (reason in ('spam', 'harassment', 'hate', 'sexual', 'violence', 'self_harm', 'age_inappropriate', 'broken', 'ip_violation', 'other')),
  details text check (char_length(details) <= 1000),
  status public.report_status not null default 'open',
  resolved_by uuid references public.profiles (id) on delete set null,
  resolved_at timestamptz,
  resolution_note text,
  created_at timestamptz not null default now()
);
create index reports_status on public.reports (status, created_at desc);

create table public.push_tokens (
  user_id uuid not null references public.profiles (id) on delete cascade,
  token text not null,
  platform text not null check (platform in ('ios', 'android')),
  created_at timestamptz not null default now(),
  primary key (user_id, token)
);

-- -----------------------------------------------------------------------------
-- Creator tooling: review queue, API tokens, CLI device codes, editorial rows
-- -----------------------------------------------------------------------------
create table public.review_jobs (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.game_versions (id) on delete cascade,
  status public.review_job_status not null default 'queued',
  attempts smallint not null default 0,
  locked_by text,
  locked_at timestamptz,
  error text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index review_jobs_queue on public.review_jobs (status, created_at);

create table public.creator_tokens (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.profiles (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  token_hash text not null unique,
  token_prefix text not null,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index creator_tokens_creator on public.creator_tokens (creator_id);

create table public.cli_device_codes (
  device_code_hash text primary key,
  user_code text not null unique,
  creator_id uuid references public.profiles (id) on delete cascade,
  token_id uuid references public.creator_tokens (id) on delete cascade,
  token_plain_once text,
  expires_at timestamptz not null,
  approved_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.editorial_rows (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  subtitle text,
  game_ids uuid[] not null default '{}',
  position integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Issues a creator API token for the caller. Returns the plaintext token exactly once.
create or replace function public.create_creator_token(token_name text)
returns table (id uuid, token text, token_prefix text)
language plpgsql security definer set search_path = public, extensions as $$
declare
  raw text := 'tc_' || encode(extensions.gen_random_bytes(24), 'hex');
  new_id uuid;
begin
  if not public.is_creator() then
    raise exception 'only creators can create tokens' using errcode = '42501';
  end if;
  insert into public.creator_tokens (creator_id, name, token_hash, token_prefix)
  values (auth.uid(), token_name, encode(extensions.digest(raw, 'sha256'), 'hex'), left(raw, 11))
  returning creator_tokens.id into new_id;
  return query select new_id, raw, left(raw, 11);
end $$;

-- Lets a signed-in member become a creator.
create or replace function public.become_creator()
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.enter_trusted();
  if not public.is_member() then
    raise exception 'sign in to become a creator' using errcode = '42501';
  end if;
  update public.profiles set role = 'creator' where id = auth.uid() and role = 'user';
end $$;

-- -----------------------------------------------------------------------------
-- Counter triggers
-- -----------------------------------------------------------------------------
create or replace function public.bump_counter()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  delta integer := case when tg_op = 'INSERT' then 1 else -1 end;
  r record := case when tg_op = 'INSERT' then new else old end;
begin
  case tg_table_name
    when 'likes' then
      update public.games set like_count = greatest(0, like_count + delta) where id = r.game_id;
      update public.profiles p set likes_received = greatest(0, likes_received + delta)
        from public.games g where g.id = r.game_id and p.id = g.creator_id;
    when 'saves' then
      update public.games set save_count = greatest(0, save_count + delta) where id = r.game_id;
    when 'follows' then
      update public.profiles set follower_count = greatest(0, follower_count + delta) where id = r.followee_id;
      update public.profiles set following_count = greatest(0, following_count + delta) where id = r.follower_id;
    when 'comment_likes' then
      update public.comments set like_count = greatest(0, like_count + delta) where id = r.comment_id;
    when 'comments' then
      if r.parent_id is null then
        update public.games set comment_count = greatest(0, comment_count + delta) where id = r.game_id;
      else
        update public.comments set reply_count = greatest(0, reply_count + delta) where id = r.parent_id;
        update public.games set comment_count = greatest(0, comment_count + delta) where id = r.game_id;
      end if;
    when 'shares' then
      update public.games set share_count = greatest(0, share_count + delta) where id = r.game_id;
  end case;
  return null;
end $$;

create trigger likes_count after insert or delete on public.likes for each row execute function public.bump_counter();
create trigger saves_count after insert or delete on public.saves for each row execute function public.bump_counter();
create trigger follows_count after insert or delete on public.follows for each row execute function public.bump_counter();
create trigger comment_likes_count after insert or delete on public.comment_likes for each row execute function public.bump_counter();
create trigger comments_count after insert or delete on public.comments for each row execute function public.bump_counter();
create trigger shares_count after insert on public.shares for each row execute function public.bump_counter();

create or replace function public.games_count_live()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.profiles set game_count = (select count(*) from public.games where creator_id = new.creator_id and status = 'live')
  where id = new.creator_id;
  return null;
end $$;
create trigger games_count_live after insert or update of status on public.games for each row execute function public.games_count_live();

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.games enable row level security;
alter table public.game_versions enable row level security;
alter table public.hashtags enable row level security;
alter table public.game_hashtags enable row level security;
alter table public.follows enable row level security;
alter table public.likes enable row level security;
alter table public.saves enable row level security;
alter table public.blocks enable row level security;
alter table public.comments enable row level security;
alter table public.comment_likes enable row level security;
alter table public.shares enable row level security;
alter table public.play_sessions enable row level security;
alter table public.best_scores enable row level security;
alter table public.daily_scores enable row level security;
alter table public.game_kv enable row level security;
alter table public.feed_events enable row level security;
alter table public.feed_events_default enable row level security;
alter table public.user_tag_affinity enable row level security;
alter table public.game_stats_daily enable row level security;
alter table public.feed_config enable row level security;
alter table public.notifications enable row level security;
alter table public.reports enable row level security;
alter table public.push_tokens enable row level security;
alter table public.review_jobs enable row level security;
alter table public.creator_tokens enable row level security;
alter table public.cli_device_codes enable row level security;
alter table public.editorial_rows enable row level security;

-- profiles: public read (guests hidden from listings by queries, not RLS); self update.
create policy profiles_read on public.profiles for select using (true);
create policy profiles_update_self on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());
create policy profiles_admin on public.profiles for all using (public.is_admin()) with check (public.is_admin());

-- games: live games are public; creators see and edit their own; admins everything.
create policy games_read on public.games for select using (status = 'live' or creator_id = auth.uid() or public.is_admin());
create policy games_insert on public.games for insert with check (public.is_creator() and creator_id = auth.uid());
create policy games_update_own on public.games for update using (creator_id = auth.uid()) with check (creator_id = auth.uid());
create policy games_delete_own_draft on public.games for delete using (creator_id = auth.uid() and status = 'draft');
create policy games_admin on public.games for all using (public.is_admin()) with check (public.is_admin());

-- versions: the live version of a live game is public; creators see their own; writes via service role.
create policy versions_read on public.game_versions for select using (
  exists (select 1 from public.games g where g.id = game_id and (g.live_version_id = game_versions.id and g.status = 'live'))
  or exists (select 1 from public.games g where g.id = game_id and g.creator_id = auth.uid())
  or public.is_admin()
);
create policy versions_admin on public.game_versions for all using (public.is_admin()) with check (public.is_admin());

create policy hashtags_read on public.hashtags for select using (true);
create policy game_hashtags_read on public.game_hashtags for select using (true);

-- follows: public read; members manage their own.
create policy follows_read on public.follows for select using (true);
create policy follows_insert on public.follows for insert with check (follower_id = auth.uid() and public.is_member());
create policy follows_delete on public.follows for delete using (follower_id = auth.uid());

-- likes: public read; members manage their own.
create policy likes_read on public.likes for select using (true);
create policy likes_insert on public.likes for insert with check (user_id = auth.uid() and public.is_member());
create policy likes_delete on public.likes for delete using (user_id = auth.uid());

-- saves: private.
create policy saves_read on public.saves for select using (user_id = auth.uid());
create policy saves_insert on public.saves for insert with check (user_id = auth.uid() and public.is_member());
create policy saves_delete on public.saves for delete using (user_id = auth.uid());

-- blocks: private.
create policy blocks_read on public.blocks for select using (blocker_id = auth.uid());
create policy blocks_insert on public.blocks for insert with check (blocker_id = auth.uid() and public.is_member());
create policy blocks_delete on public.blocks for delete using (blocker_id = auth.uid());

-- comments: visible comments on live games are public (minus authors who blocked/were blocked by
-- the viewer); authors see their own; game creators can pin/hide on their game.
create policy comments_read on public.comments for select using (
  (status = 'visible'
    and exists (select 1 from public.games g where g.id = game_id and g.status = 'live')
    and not exists (select 1 from public.blocks b where b.blocker_id = auth.uid() and b.blocked_id = comments.user_id))
  or user_id = auth.uid()
  or exists (select 1 from public.games g where g.id = game_id and g.creator_id = auth.uid())
  or public.is_admin()
);
create policy comments_insert on public.comments for insert with check (
  user_id = auth.uid() and public.is_member()
  and exists (select 1 from public.games g where g.id = game_id and g.status = 'live')
  and not exists (
    select 1 from public.blocks b join public.games g on g.id = game_id
    where b.blocker_id = g.creator_id and b.blocked_id = auth.uid()
  )
);
create policy comments_delete_own on public.comments for delete using (user_id = auth.uid());
create policy comments_moderate_own_game on public.comments for update using (
  exists (select 1 from public.games g where g.id = game_id and g.creator_id = auth.uid())
);
create policy comments_admin on public.comments for all using (public.is_admin()) with check (public.is_admin());

create policy comment_likes_read on public.comment_likes for select using (true);
create policy comment_likes_insert on public.comment_likes for insert with check (user_id = auth.uid() and public.is_member());
create policy comment_likes_delete on public.comment_likes for delete using (user_id = auth.uid());

-- shares: written and resolved through edge functions; owners can list their own.
create policy shares_read_own on public.shares for select using (user_id = auth.uid());

-- sessions: written through edge functions; owners can read their own.
create policy play_sessions_read_own on public.play_sessions for select using (user_id = auth.uid());

-- scores: public read; written through session-end.
create policy best_scores_read on public.best_scores for select using (true);
create policy daily_scores_read on public.daily_scores for select using (true);

-- game storage: private to the player. (The shell writes via the user's own session.)
create policy game_kv_read on public.game_kv for select using (user_id = auth.uid());
create policy game_kv_insert on public.game_kv for insert with check (user_id = auth.uid());
create policy game_kv_update on public.game_kv for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy game_kv_delete on public.game_kv for delete using (user_id = auth.uid());

-- events, affinity, stats: service role only (no client policies). Creators read stats of their games.
create policy game_stats_read_creator on public.game_stats_daily for select using (
  exists (select 1 from public.games g where g.id = game_id and g.creator_id = auth.uid()) or public.is_admin()
);
create policy affinity_read_own on public.user_tag_affinity for select using (user_id = auth.uid());

create policy feed_config_read on public.feed_config for select using (true);
create policy feed_config_admin on public.feed_config for all using (public.is_admin()) with check (public.is_admin());

create policy notifications_read on public.notifications for select using (user_id = auth.uid());
create policy notifications_mark_read on public.notifications for update using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy reports_insert on public.reports for insert with check (reporter_id = auth.uid() and public.is_member());
create policy reports_read_own on public.reports for select using (reporter_id = auth.uid() or public.is_admin());
create policy reports_admin on public.reports for update using (public.is_admin()) with check (public.is_admin());

create policy push_tokens_own on public.push_tokens for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy review_jobs_admin on public.review_jobs for select using (public.is_admin());

create policy creator_tokens_read_own on public.creator_tokens for select using (creator_id = auth.uid());
create policy creator_tokens_revoke_own on public.creator_tokens for update using (creator_id = auth.uid()) with check (creator_id = auth.uid());

create policy editorial_read on public.editorial_rows for select using (active or public.is_admin());
create policy editorial_admin on public.editorial_rows for all using (public.is_admin()) with check (public.is_admin());

-- Hide token hashes from clients entirely: column-level grants only.
revoke all on public.creator_tokens from anon, authenticated;
grant select (id, creator_id, name, token_prefix, last_used_at, revoked_at, created_at) on public.creator_tokens to authenticated;
grant update (revoked_at, name) on public.creator_tokens to authenticated;
revoke all on public.cli_device_codes from anon, authenticated;

-- -----------------------------------------------------------------------------
-- Review decisions (portal admin + CLI rollback)
-- -----------------------------------------------------------------------------

-- Approves a version and makes it the live version of its game.
create or replace function public.approve_version(p_version_id uuid, p_notes text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v public.game_versions;
  g public.games;
begin
  perform public.enter_trusted();
  if not (public.is_admin() or public.is_service()) then
    raise exception 'admins only' using errcode = '42501';
  end if;
  select * into v from public.game_versions where id = p_version_id for update;
  if not found then raise exception 'version not found'; end if;
  if v.status not in ('pending_review', 'approved', 'auto_failed') then
    raise exception 'version is %, not reviewable', v.status;
  end if;
  update public.game_versions
     set status = 'approved', approved_by = auth.uid(), approved_at = now(), review_notes = coalesce(p_notes, review_notes)
   where id = p_version_id;
  update public.games
     set live_version_id = p_version_id,
         status = 'live',
         published_at = coalesce(published_at, now()),
         controls = coalesce(v.manifest->'controls', controls),
         score_config = coalesce(v.manifest->'score', score_config),
         session_length = coalesce(v.manifest->>'session', session_length),
         audio = coalesce((v.manifest->>'audio')::boolean, audio),
         age_rating = coalesce((v.manifest->>'ageRating')::public.age_rating, age_rating)
   where id = v.game_id
   returning * into g;
  insert into public.notifications (user_id, type, game_id, payload)
  values (g.creator_id, 'game_approved', g.id, jsonb_build_object('versionId', p_version_id, 'semver', v.semver));
  -- Fan out "new game" to followers on first publish only.
  if g.published_at >= now() - interval '5 seconds' then
    insert into public.notifications (user_id, type, actor_id, game_id)
    select f.follower_id, 'new_game', g.creator_id, g.id from public.follows f where f.followee_id = g.creator_id;
  end if;
end $$;

create or replace function public.reject_version(p_version_id uuid, p_notes text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v public.game_versions;
  creator uuid;
begin
  perform public.enter_trusted();
  if not (public.is_admin() or public.is_service()) then
    raise exception 'admins only' using errcode = '42501';
  end if;
  update public.game_versions set status = 'rejected', review_notes = p_notes where id = p_version_id returning * into v;
  if not found then raise exception 'version not found'; end if;
  select creator_id into creator from public.games where id = v.game_id;
  update public.games set status = 'rejected' where id = v.game_id and status in ('draft', 'in_review');
  insert into public.notifications (user_id, type, game_id, payload)
  values (creator, 'game_rejected', v.game_id, jsonb_build_object('versionId', p_version_id, 'semver', v.semver, 'notes', p_notes));
end $$;

-- Creators roll back to any earlier approved version of their own game.
create or replace function public.rollback_to_version(p_version_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v public.game_versions;
begin
  perform public.enter_trusted();
  select * into v from public.game_versions where id = p_version_id;
  if not found or v.status <> 'approved' then raise exception 'only approved versions can go live'; end if;
  if not exists (select 1 from public.games where id = v.game_id and (creator_id = auth.uid() or public.is_admin())) then
    raise exception 'not your game' using errcode = '42501';
  end if;
  update public.games set live_version_id = v.id where id = v.game_id;
end $$;

-- Takedown (admin): removes a game from the feed immediately.
create or replace function public.takedown_game(p_game_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.enter_trusted();
  if not public.is_admin() then raise exception 'admins only' using errcode = '42501'; end if;
  update public.games set status = 'removed' where id = p_game_id;
  update public.reports set status = 'actioned', resolved_by = auth.uid(), resolved_at = now(), resolution_note = p_reason
   where target_type = 'game' and target_id = p_game_id and status = 'open';
end $$;

-- -----------------------------------------------------------------------------
-- Realtime
-- -----------------------------------------------------------------------------
alter publication supabase_realtime add table public.comments;
alter publication supabase_realtime add table public.notifications;

-- -----------------------------------------------------------------------------
-- Storage buckets
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values
  ('avatars', 'avatars', true, 5242880),
  ('game-assets', 'game-assets', true, 10485760),
  ('game-bundles', 'game-bundles', true, 15728640)
on conflict (id) do nothing;

create policy avatars_upload_own on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy avatars_update_own on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy avatars_delete_own on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- Creators upload icons/posters under their game's slug folder.
create policy game_assets_upload_creator on storage.objects for insert to authenticated
  with check (
    bucket_id = 'game-assets'
    and exists (select 1 from public.games g where g.slug = (storage.foldername(name))[1] and g.creator_id = auth.uid())
  );
create policy game_assets_update_creator on storage.objects for update to authenticated
  using (
    bucket_id = 'game-assets'
    and exists (select 1 from public.games g where g.slug = (storage.foldername(name))[1] and g.creator_id = auth.uid())
  );
