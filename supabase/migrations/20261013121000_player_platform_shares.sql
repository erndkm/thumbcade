-- Player Platform (stream A): atomic share/challenge resolution for `challenge-resolve`.

create or replace function public.resolve_share(p_code text)
returns table (
  code text, game_id uuid, game_slug text, from_name text, from_handle text, from_guest boolean, score double precision
)
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_service() then
    raise exception 'service only' using errcode = '42501';
  end if;
  return query
  with hit as (
    update public.shares s set open_count = s.open_count + 1
    where s.code = p_code
      and exists (select 1 from public.games g where g.id = s.game_id and g.status = 'live')
    returning s.code, s.game_id, s.user_id, s.challenge_score
  )
  select hit.code, hit.game_id, g.slug, coalesce(pr.display_name, pr.handle), pr.handle, pr.is_guest, hit.challenge_score
  from hit
  join public.games g on g.id = hit.game_id
  left join public.profiles pr on pr.id = hit.user_id;
end $$;

revoke execute on function public.resolve_share(text) from public, anon, authenticated;
grant execute on function public.resolve_share(text) to service_role;
