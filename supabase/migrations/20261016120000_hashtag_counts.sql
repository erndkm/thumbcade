-- hashtags.game_count only moved when a game's tags were written, so deleting a game (or its game_hashtags rows
-- through the cascade) left the count behind. Recount the touched tags after every delete and fix existing rows.

create or replace function public.recount_deleted_hashtags()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.hashtags h set game_count = (select count(*) from public.game_hashtags g where g.tag = h.tag)
  where h.tag in (select distinct tag from gone);
  return null;
end $$;

create trigger game_hashtags_recount after delete on public.game_hashtags
  referencing old table as gone
  for each statement execute function public.recount_deleted_hashtags();

update public.hashtags h set game_count = (select count(*) from public.game_hashtags g where g.tag = h.tag)
where h.game_count is distinct from (select count(*) from public.game_hashtags g where g.tag = h.tag);
