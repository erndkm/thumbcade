-- Intentionally minimal. Static configuration (feed_config weights, moderation words, storage buckets)
-- lives in the migrations so it exists in every environment.
--
-- The realistic local data set — launch games uploaded to storage and approved, creators, ~40 players,
-- follows, likes, comments, scores, stats and editorial rows — is produced by:
--
--   pnpm seed                    (scripts/seed.ts; idempotent, wipes is_seed rows first)
--
-- `supabase db reset` runs this file; run `pnpm seed` afterwards.
select 1;
