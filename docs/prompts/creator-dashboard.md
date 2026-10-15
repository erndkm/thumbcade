# Build prompt: creator analytics and milestones

You are implementing creator analytics and milestone rewards in the Thumbcade monorepo. Thumbcade is a
TikTok-style feed of HTML5 games (Expo app, Supabase backend, Next.js creator portal). Creators publish games
through the CLI and the portal. Today they see a thin 14-day stats strip. After this work they understand how
their game is doing, and they feel it when a game takes off.

Read these first, in this order: `CLAUDE.md`, `THUMBCADE_BUILD_PROMPT.md` §9 (events and ranking), §10.4
(portal), §11 (backend) and §12 (design, binding), then `docs/ARCHITECTURE.md` and `docs/DECISIONS.md`.

You act as the lead for this task. You may change contract packages (`packages/protocol`) and every app and
function involved. Log each decision in `docs/DECISIONS.md` (one line: decision — reason) and anything you
can't finish in `docs/GAPS.md`. Never run `supabase db reset` or `supabase stop`, because the local stack is
shared. Don't commit unless you're asked to.

## 1. What exists today, and what is wrong with it

Build on the existing pipeline; don't replace it. Fix these problems along the way:

| Problem | Where |
| --- | --- |
| The public play count goes up when a run *starts*, so a tap followed by an instant swipe counts as a play. | `start_play_session` in `supabase/migrations/20261013120000_player_platform.sql` (`play_count = play_count + 1`) |
| All-time unique players can't be computed. `game_stats_daily.unique_players` holds distinct users per day, and summing days overcounts returning players. | `rollup_game_stats` in the same file |
| Playtime only counts runs that ended (`play_end`), and it is wall-clock time from start to end, so paused time (sheets, background) is included and abandoned runs count as zero. | `CardController.onRunEnded` in `apps/mobile/src/feed/controller.ts`, `total_play_ms` in the rollup |
| The game's own creator, and admins playing it, are counted like any player. | `ingest_events`, `start_play_session` |
| The game page says "Updated hourly", but the rollup runs every 10 minutes. | `apps/portal/src/app/(app)/creator/games/[slug]/page.tsx`, the `thumbcade-stats-rollup` cron |
| The seed invents `unique_players` as 68% of starts. | `scripts/seed.ts` |

Useful data that already exists:
- The `skip` event fires on every card deactivation with `state` (the phase the card was in) and `dwellMs`.
- `play_sessions` rows carry `launch_reason` and `version_id`.
- `ready` events carry `meta.ms` (time to ready).
- `game_stats_daily` has impressions, likes, shares, saves, comments, fast skips and load failures.

## 2. Binding definitions: when someone counts

These definitions decide every number on the dashboard, the public play count and the milestones. Put the
threshold in `packages/protocol/src/constants.ts` as `QUALIFIED_PLAY_MS = 3000`. Mirror it in SQL as a row in a
config table, and add a test that fails if the two values differ.

| Term | Definition |
| --- | --- |
| Card view | The card became the active card (the existing `impression` event). |
| Run start | The game called `gameplay.start()` on a tap. |
| **Play** (qualified run) | A run that the game ended (`gameplay.end`), **or** one that reached `QUALIFIED_PLAY_MS` of active playtime, whichever comes first. |
| Bounced start | A run start that never qualified: the player tapped, then left within 3 s of play without the game ending the run. |
| **Player** | A distinct person (Supabase user id; guests are anonymous users and count) with at least one play in the game. All-time players count each person once per game. Daily players count each person once per UTC day. |
| New player / returning player | On a given day: their first play ever in this game happened that day / earlier. |
| **Active playtime** | Time a run spent in `PLAYING` while the game was running: not paused, not under a feed drag, not offscreen. Wall-clock time doesn't count. |
| Total playtime | The sum of active playtime over all runs, bounced starts included (they are under 3 s each). |
| Avg playtime per player | Active playtime ÷ players, over the selected range. |
| Typical run | The median active playtime of plays in the range. Means are skewed by a few marathon runs. |
| Swiped away | A `skip` event, split by the phase the card was in: *instantly* (LOADING or PREVIEW, dwell < 1.5 s, the existing fast skip), *after watching* (PREVIEW, dwell ≥ 1.5 s), *mid-run* (PLAYING or PAUSED), *after a run* (ENDED), *failed to load* (FAILED). |
| Replay | A second or later run on the same card view. |
| Day-1 / day-7 return | The share of one day's new players who played again on the next day / within the next 7 days. Shown only for days whose window has closed. |
| Excluded traffic | Sessions by the game's creator or by admins. They never count toward any stat, public count or milestone. Mark them when the session starts. |

Why 3 s and "ended" (keep this reasoning in `docs/DECISIONS.md`):
- **Not instantly:** a tap on a card that is followed by a swipe isn't a play.
- **Not a long threshold:** a Flapjack run can legitimately end after 2 s, and that is a real play.
- "Ended or 3 s" counts both the quick death and the real attempt, and drops the accidental tap. 3 s is twice
  the existing 1.5 s fast-skip window.

## 3. Data pipeline

### 3.1 Client: measure active playtime (`apps/mobile`)

- In `CardController`, keep a per-run stopwatch that runs only while `phase === "PLAYING"` and the game is running
  (`shouldRun`). Use `deps.now()` and `deps.setTimer` so it stays unit-testable without React Native.
- When the stopwatch crosses `QUALIFIED_PLAY_MS`, call a new `deps.sessionProgress({ sessionId, token, activeMs })`
  once. Use a timer armed for the remaining milliseconds, re-armed on every resume.
- When the run is interrupted (card deactivated, app backgrounded, sheet opened) and active time grew since the
  last report, send progress again. Send at most one progress call per session every 5 s.
- `session-end` gets a new `activeMs` field. Keep `durationMs` as wall-clock time, because the existing
  impossible-duration check uses it.
- `session-start` gets an optional `cardId`, so sessions can be joined to card views for the funnel.
- Update the request and response schemas in `packages/protocol/src/api.ts`.

### 3.2 Server: sessions decide what counts (`supabase/`)

Add one new timestamped migration, applied with `supabase migration up`.

- `play_sessions`: add `active_ms integer not null default 0`, `qualified_at timestamptz`, `excluded boolean not
  null default false` and `card_id text`.
- New edge function `session-progress`. It verifies the session token like `session-end` does, then calls an RPC
  `record_session_progress(session, user, active_ms)`, which:
  - stores `greatest(stored, least(sent, wall-clock ms since started_at + 2000))`, so the value only grows and
    never exceeds real time;
  - sets `qualified_at` when the stored value reaches the threshold;
  - rejects sessions the caller doesn't own;
  - is rate-limited per session and per user.
- `finish_play_session` takes `p_active_ms` (same clamp) and sets `qualified_at` when the game ended the run.
  Stale cleanup (`cleanup_stale_sessions`) does not qualify a session; it keeps whatever `active_ms` was reported.
- `start_play_session` sets `excluded` (the caller is the game's creator or an admin) and stops incrementing
  `play_count`.
- When a non-excluded session becomes qualified (a trigger on `qualified_at` going from null to set):
  - increment `games.play_count`, capped per user, per game, per UTC day (start at 100; keep the cap in config);
  - upsert the aggregate rows in §3.3.
- When `active_ms` grows on any non-excluded session, add the delta to the aggregates.

### 3.3 Aggregates

- `game_players (game_id, user_id, first_played_at, last_played_at, plays, active_ms, days_played)`: one row
  per person per game. It is the source for all-time players and new versus returning players.
- `game_player_days (game_id, day, user_id, plays, active_ms)`: the source for daily players and return rates.
- `game_stats_daily`: add `players`, `new_players`, `plays`, `bounced_starts`, `active_play_ms`,
  `left_instantly`, `left_after_watching`, `left_mid_run`, `left_after_run`, `ready_ms_p50`, `ready_ms_p90`.
  Keep every existing column. Extend `rollup_game_stats` to fill them; the swiped-away columns come from `skip`
  events, and the per-player columns from the tables above.
- `games`: add `player_count` and `play_ms_total`, maintained by the triggers, for all-time totals that need no scan.
- A nightly job, `compute_game_benchmarks`: for each rate the dashboard shows, where each live game with
  ≥ 200 card views in the last 28 days ranks among those games. Store each game's percentile.

**Privacy:** `game_players` and `game_player_days` hold per-user rows.
- Creators must never read them directly. Give these tables RLS with no select policy for creators.
- Expose only aggregates, through security-definer RPCs that check `games.creator_id = auth.uid()` or an admin
  role. Write these RPCs:
  - `creator_overview()`
  - `creator_game_summary(game, from, to)`
  - `creator_game_funnel(game, from, to)`
  - `creator_version_compare(game)`

### 3.4 Backfill and freshness

- Backfill `game_players`, `game_player_days`, `games.player_count` and `games.play_count` from existing
  `play_sessions`. Treat a session as qualified if it ended without `reject_reason = 'stale'`, or if its
  `duration_ms ≥ 3000`.
- Existing sessions have no active time, so the dashboard starts measuring playtime from the migration date.
  Show the start date in a footnote; never estimate playtime.
- Rollup stays on the 10-minute cron. The dashboard says "Updated every 10 minutes".
- Days are UTC; label them "UTC".

## 4. The dashboard (`apps/portal`)

### 4.1 Overview (`/creator`)

- **Totals across all the creator's games:** all-time players, total playtime (in hours), plays, followers.
- **Today so far:** players and plays.
- **Milestones:** the latest milestones, plus progress toward the next one for each game (for example,
  "7,412 / 10K players"). Progress toward a goal is the most motivating number on the page.
- **Games list:** each game with its status, all-time players and a 28-day players sparkline.

### 4.2 Game page (`/creator/games/[slug]`)

Range switch: Today · 7 days · 28 days · All time. Sections, top to bottom:

1. **Headline:** players, plays, total playtime, avg playtime per player, typical run, day-1 return, each
   compared with the previous period of the same length.
2. **Players per day:** new and returning, stacked. Milestones and version releases are marked on the time axis.
3. **Funnel**, per card view: viewed → started a run → played → played again → came back another day, with the
   drop-off between each step.
4. **Where people leave:** the swiped-away split from §2, as shares of card views.
5. **How people found it:** plays by `launch_reason` (feed, game page, challenge).
6. **Engagement:** likes, comments, shares, saves, follows gained.
7. **Versions:** for each version, players, typical run, day-1 return and the instant swipe-away rate, so an
   update's effect is visible.
8. **Health:** time to ready (p50 and p90) and load failure rate.

Rules for every number:
- Every metric has a short definition behind an info control. Keep these strings in one place
  (`packages/protocol`, for example `METRIC_DEFINITIONS`) and use the same text in a new docs page,
  `/docs/analytics` ("How we count players"). Creators trust numbers they can check.
- Benchmarks appear as a quiet line under a tile ("better than 72% of live games"), only when ≥ 10 games qualify.
- A rate whose denominator is under 20 shows "Needs 20 plays", not a noisy percentage.
- Designed empty state for a game with no players yet, with copy in the §12.3 voice and a copy-link action.
  Loading states use skeletons in the final layout. Errors get a designed state too.
- Tokens from `@thumbcade/design-tokens` only. Numbers use Departure Mono, formatted with the existing
  `formatCount`. Extend `components/daily-chart.tsx` rather than adding a chart library.
- The layout works at 390 px wide without horizontal overflow.

## 5. Making success feel like success

### 5.1 Milestones

Keep thresholds in a config table so they can change without a deploy.

| Kind | Fires when |
| --- | --- |
| Players | All-time players pass 100, 1K, 10K, 100K, 1M |
| Playtime | Total playtime passes 100, 1K, 10K, 100K hours |
| Firsts | First player who isn't the creator, first like, first comment, first challenge link shared |
| Best day | A new all-time high in daily players. Only after 7 days live, with ≥ 50 players that day, at most once a week |
| Taking off | Daily players ≥ 3× the trailing 7-day average and ≥ 200 players |

- `award_milestones()` runs after each rollup. It is idempotent (unique on game, kind and threshold) and stores
  the value and the time it was reached.
- Add a `milestone` value to `notification_type`. Each new milestone creates an inbox notification and a push
  through the existing `dispatch_push`. Send at most one push per game per day, batching several milestones
  into one message.
- Copy is short, confident and a little playful. Examples: "Lane Rush just passed 10K players." / "1,000 hours
  played in Stackd. That's six weeks, nonstop." / "Snek is taking off: 3.4× your usual players today."

### 5.2 Where it shows up

- **Portal:** the first visit after an unseen milestone opens with a celebration at the top of the overview.
  - It shows the game icon in its accent color and the number rolling up like the result card's odometer, with a
    stamp in the style of "NEW BEST".
  - Actions: **Share** and dismiss. Dismissing marks it seen.
  - With Reduce Motion it fades instead. No confetti, no emoji (§12.3).
- **Share card:** **Share** creates a public page `/m/[code]` with a dynamic Open Graph image (reuse
  `lib/og.ts`): game icon, game name, the milestone, the creator's handle, and a play link. A milestone becomes
  public only when the creator shares it.
- **Mobile:**
  - Inbox renders the milestone notification with the game icon; tapping it opens the Creator Hub.
  - The Creator Hub (`apps/mobile/app/(tabs)/create.tsx`) shows today's players and plays, the latest
    milestone, and progress to the next one, using the new columns and RPCs.

### 5.3 Honesty rules

- Milestones count only qualified plays and players from non-excluded traffic.
- Never round up: "10K" appears only at 10,000 or more.
- No negative pushes. A drop in players shows in the dashboard with neutral wording, never as an alarm.

## 6. Seed data

Update `scripts/seed.ts` so every new table and column holds coherent demo data:
- Daily players never exceed all-time players, and new plus returning players equals players.
- Playtime matches plays.
- Some past milestones exist for demo creators, with one left unseen so the celebration shows on first visit.

Extend `scripts/test/seed-data.test.ts` with these invariants.

## 7. Tests and verification

- **Controller unit tests** (fake timers through `CardDeps`):
  - active time stops during each pause reason, feed drags and offscreen;
  - qualification fires exactly once at 3 s;
  - a run ended before 3 s qualifies through `session-end`;
  - progress is sent on deactivation and throttled to one call per 5 s.
- **Database tests:**
  - progress is clamped to wall-clock time and never decreases;
  - nobody can report progress on someone else's session;
  - creator and admin sessions never count;
  - `play_count` rises once per qualified play and respects the daily cap;
  - the aggregates match a hand-computed fixture;
  - `award_milestones` is idempotent;
  - a creator can't read another creator's summary or any per-user row.
- **Portal:**
  - unit-test the pure data-shaping helpers;
  - screenshot the overview and game page (empty, normal, celebration) at 1440 and 390 px with
    `scripts/portal-login.mjs` and `scripts/shoot.mjs`, then look at the screenshots and fix what's wrong.
- **End to end:**
  1. In the iOS simulator, play a game past 3 s, swipe away mid-run on another card, then run
     `select public.rollup_game_stats(2)`.
  2. Check the numbers on the dashboard.
- Regenerate `apps/portal/src/lib/database.types.ts` with `supabase gen types typescript --local`.
- `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm exec tsx scripts/e2e-creator-loop.ts` pass.

## 8. Out of scope

- Earnings and payouts. Monetization isn't built, and the no-stubbed-UI rule applies.
- Multiplayer metrics.
- Plays in the portal's web player. It creates no sessions; list it in `docs/GAPS.md`.
- Creator-local time zones.

## Definition of done

- [ ] The definitions in §2 are implemented once and shared by client, server, portal and docs.
- [ ] The public play count and every dashboard number follow those definitions; creator and admin traffic is excluded.
- [ ] The overview and game page show every section in §4 with empty, loading and error states, at 1440 and 390 px.
- [ ] Milestones fire once, reach the inbox, push and portal, and can be shared as a card.
- [ ] Per-user rows are unreadable by creators; the summaries are reachable only through owner-checked RPCs.
- [ ] Seed, tests and the checks in §7 are green; decisions and gaps are logged.
