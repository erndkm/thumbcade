<p align="center"><img src="packages/design-tokens/brand/lockup.png" alt="thumbcade" height="72"></p>

# Thumbcade

An endless vertical feed of games you play with one thumb — like short video, but every card is a live HTML5 game. Swipe up for the next one. Creators build games with the Thumbcade SDK and publish them from their terminal; approved games go live without an app update.

## Quickstart

Requirements: Node 22+, pnpm 12, Docker (or Colima), the Supabase CLI. For the app: Xcode (iOS Simulator) and/or the Android SDK.

```bash
bash scripts/safe-install.sh   # pnpm install, serialized
pnpm games:build                # build the launch games → dist/games
pnpm dev                        # Supabase, game host, portal, simulator, reviewer, Metro
pnpm seed                       # load games, creators, players, comments, scores
# press i in the Metro pane for the iOS Simulator (Expo Go), or open http://localhost:3000
```

`source scripts/env.sh` first if your Xcode / Android SDK aren't on the default paths.

| | |
|---|---|
| Portal & web player | http://localhost:3000 (`/play`, `/g/<slug>`, `/docs`, `/creator`, `/admin`) |
| Feed simulator | http://localhost:5173 |
| Game host | http://127.0.0.1:5555/&lt;slug&gt;/&lt;versionId&gt;/ |
| Supabase Studio / Mail | http://127.0.0.1:54323 / http://127.0.0.1:54324 |

Admin account for the review queue: `pnpm exec tsx scripts/make-admin.ts you@example.com`, then sign in at `/login` with the emailed code.

## What's in here

```
apps/mobile        Expo app (iOS + Android): the feed, the Swipe Contract, the social layer
apps/portal        Next.js: landing, web player, docs, creator dashboard, admin review, share pages
apps/simulator     The feed simulator `thumbcade dev` opens
packages/protocol  Contracts: manifest, bridge messages, DTOs, budgets
packages/swipe-contract  The gesture/session state machine shared by app and simulator
packages/design-tokens   Colors, type, motion, icons, fonts, brand assets
packages/sdk       @thumbcade/sdk — the only API a game sees (~6 KB gz)
packages/cli       thumbcade dev | validate | login | publish
packages/create-game     npm create thumbcade-game
games/             The launch library (+ games/_kit shared helpers)
services/game-host Local stand-in for <slug>.thumbcade.gg
services/reviewer  Automated review (Playwright)
supabase/          Schema + RLS, edge functions, email templates
```

Read `THUMBCADE_BUILD_PROMPT.md` for the full product spec, `docs/ARCHITECTURE.md` for how the pieces fit, and `docs/DECISIONS.md` / `docs/GAPS.md` for what was decided and what's left.

## Checks

```bash
pnpm typecheck && pnpm lint && pnpm test
```
