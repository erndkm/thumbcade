-- Data retention promised in the Privacy Policy (@thumbcade/legal RETENTION; a test keeps the numbers equal):
--   * raw feed events are kept for 90 days; daily per-game rollups (game_stats_daily, creator analytics) stay,
--   * guest (anonymous) accounts nobody has opened for 12 months are deleted with everything in them.

-- Drops whole daily partitions older than the window (cheap, no vacuum debt) and trims the default partition.
create or replace function public.purge_feed_events(p_keep_days integer default 90)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_cutoff date := (now() at time zone 'utc')::date - p_keep_days;
  v_part text;
  v_dropped integer := 0;
begin
  for v_part in
    select c.relname
      from pg_inherits i
      join pg_class c on c.oid = i.inhrelid
     where i.inhparent = 'public.feed_events'::regclass
       and c.relname ~ '^feed_events_[0-9]{8}$'
       and to_date(substr(c.relname, 13), 'YYYYMMDD') < v_cutoff
  loop
    execute format('drop table public.%I', v_part);
    v_dropped := v_dropped + 1;
  end loop;
  delete from public.feed_events_default where created_at < v_cutoff::timestamptz;
  return v_dropped;
end $$;

-- A guest's last activity is its newest sign-in, session refresh or token rotation (the app refreshes hourly
-- while open). Deleting the auth user cascades to the profile and every row hanging off it.
create or replace function public.purge_inactive_guests(p_months integer default 12)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_deleted integer;
begin
  with stale as (
    select u.id
      from auth.users u
     where u.is_anonymous
       and greatest(u.created_at, u.updated_at, u.last_sign_in_at) < now() - make_interval(months => p_months)
       and not exists (
         select 1 from auth.sessions s
          where s.user_id = u.id
            and greatest(s.created_at, s.updated_at, s.refreshed_at at time zone 'utc') >= now() - make_interval(months => p_months)
       )
       and not exists (
         select 1 from auth.sessions s
           join auth.refresh_tokens rt on rt.session_id = s.id
          where s.user_id = u.id and rt.updated_at >= now() - make_interval(months => p_months)
       )
     limit 5000
  )
  delete from auth.users u using stale where u.id = stale.id;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end $$;

revoke execute on function public.purge_feed_events(integer) from public, anon, authenticated;
revoke execute on function public.purge_inactive_guests(integer) from public, anon, authenticated;

select cron.schedule('thumbcade-retention', '20 4 * * *', $$select public.purge_feed_events(90); select public.purge_inactive_guests(12);$$);
