# Architecture

```
                         ┌──────────────────────────── Phone (Expo app, apps/mobile) ────────────────────────────┐
                         │                                                                                        │
  touch ───────────────▶ │  Gesture layer (RNGH + Reanimated, UI thread)                                         │
                         │    surface pan · Dock pan · two-finger pan   ◀── gestureConfigFor(phase, controls)     │
                         │            │ claims                                     (@thumbcade/swipe-contract)    │
                         │            ▼                                                                           │
                         │  Card state machine  transition(state, event) → effects (send pause/resume/cancel…)   │
                         │            │                                                                           │
                         │  3-slot WebView pool (prev · current · next)                                          │
                         │   ┌──────────────────────────────┐   bridge (Envelope, @thumbcade/protocol)            │
                         │   │ game on its own origin        │ ◀────────────────────────────────▶ shell bridge     │
                         │   │ @thumbcade/sdk inside         │   hello/ready/gameplay.*/storage/…   (zod-validated,│
                         │   └──────────────────────────────┘   pause/resume/input.cancel/…          rate-limited)│
                         └───────────────┬───────────────────────────────────────────────┬──────────────────────┘
                                         │ static bundles (CSP: self only)               │ HTTPS (user JWT)
                                         ▼                                               ▼
              Game host: prod <slug>.thumbcade.gg/<versionId>/      Supabase: Postgres + RLS, Auth (anon → Apple/Google/
              (R2 + CDN) · local services/game-host :5555           email), Storage, Realtime, Edge Functions:
              reads the `game-bundles` bucket                       feed · events · session-start/end · notify ·
                                                                    challenge-resolve · account-delete/export · creator-publish
                                                                    · creator-review-callback · pg_cron rollups
                                         ▲                                               ▲
                                         │                                               │
   Creator laptop                         │ upload (zip)                                  │ review_jobs (poll)
   create-thumbcade-game → thumbcade dev (apps/simulator: same chrome + same state machine) → thumbcade publish
                                                                    │
                                                                    ▼
                                    services/reviewer (Playwright, mid-tier throttling) → report → portal admin
                                    approves (approve_version RPC) → games.live_version_id → in the feed
```

## Packages

| Package | Role |
|---|---|
| `@thumbcade/protocol` | Manifest schema (+ JSON Schema), bridge envelope and message payloads, LaunchContext, feed/session/publish DTOs, URL builders, budgets, formatting helpers. Zod; consumed as TS source. |
| `@thumbcade/swipe-contract` | Pure state machine for card phases (LOADING · PREVIEW · PLAYING · ENDED · PAUSED · OFFSCREEN · FAILED), effects, gesture ownership table, thresholds, release resolution. Worklet-safe. |
| `@thumbcade/design-tokens` | Colors (dark/light), type styles, spacing, radii, springs, durations, layout constants, generative pixel avatars, CSS variables + Tailwind v4 theme, fonts, brand assets. |
| `@thumbcade/sdk` | The only API a game sees. Zero deps, ≤ 8 KB gz. |
| `@thumbcade/cli`, `create-thumbcade-game` | Creator tooling. |

## Identity

Every install signs in anonymously on first launch (Supabase anonymous auth). The anonymous user id is the
stable identity for events, sessions and game storage. Linking Apple/Google/email upgrades the same user in
place (`profiles.is_guest` flips via trigger). RLS: social writes require `public.is_member()`.

## Trust boundaries

- Games run on a separate registrable domain, one origin per game, CSP `connect-src 'self'`; they never see
  tokens or real user ids (the SDK's `player.id` is an opaque per-game id).
- Shell validates every bridge message (zod) and rate-limits per type.
- Privileged columns (roles, counters, game status, live version) are protected by triggers; only the service
  role, admins, nested counter triggers and `enter_trusted()` RPCs may change them.
- Creator API tokens are stored hashed; clients cannot select `token_hash`.
- Scores are only ranked through server-issued play sessions: `session-start` signs an HMAC token,
  `session-end` checks it against the caller, the manifest's `score.max` and the server clock. Challenge links
  can only carry a score at or below the caller's verified best.
- Client analytics (`events`) are capped per user per minute, because trending and ranking signals roll up
  from them. Public play counts come from server sessions, not from events: a session counts once it qualifies (the
  game ended it, or 3 s of active play), capped per person per day, and never for the game's creator or admins.
- Creator analytics: per-player aggregates (`game_players`, `game_player_days`) are server-only; creators read
  owner-checked `creator_*` RPCs (aggregates only). Milestones are private until their creator shares them.
