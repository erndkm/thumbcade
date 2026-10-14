# Thumbcade

TikTok for minigames: an infinite vertical feed of playable HTML5 games (iOS + Android, Expo), a social
layer on Supabase, and a creator platform (SDK, CLI, simulator, portal, automated review).
The full product spec is `THUMBCADE_BUILD_PROMPT.md`. Its §5 (Swipe Contract) and §12 (design) are binding.

## Commands

```bash
source scripts/env.sh                 # Xcode / Android SDK / JDK paths (no system changes)
bash scripts/safe-install.sh          # ALWAYS use this instead of `pnpm install` (serializes concurrent installs)
bash scripts/safe-install.sh --filter <pkg> add <dep>     # add a dependency
pnpm typecheck | pnpm lint | pnpm test                     # turbo across the workspace
pnpm --filter <pkg> <script>                               # one package
supabase status -o env                # local keys/URLs (stack runs in Docker via Colima)
supabase migration up                 # apply NEW migrations without wiping data
pnpm games:build && pnpm seed         # build launch games, seed local DB + storage
pnpm dev                              # whole platform; Metro runs headless (xcrun simctl openurl booted exp://127.0.0.1:8081)
pnpm exec tsx scripts/e2e-creator-loop.ts            # creator loop end to end
cd apps/mobile && bash maestro/run.sh ios|android    # device flows; bash maestro/perf/soak.sh for the memory soak
```

Local auth requires email confirmation like production: sign-in and guest-upgrade codes arrive in Mailpit.

Never run `supabase db reset` or `supabase stop` while other agents are working — the local stack is
shared. Never `git commit` unless you are the lead.

## Local services

| Service | URL |
|---|---|
| Supabase API / Functions | http://127.0.0.1:54321 (`/functions/v1/<name>`; run `supabase functions serve --env-file supabase/functions/.env` — `pnpm dev` does) |
| Supabase Studio / Mailpit | http://127.0.0.1:54323 / http://127.0.0.1:54324 |
| Game host (`services/game-host`) | http://127.0.0.1:5555/<slug>/<versionId>/index.html |
| Portal (`apps/portal`) | http://localhost:3000 |
| Simulator (`apps/simulator`) | http://localhost:5173 |
| Metro (`apps/mobile`) | http://localhost:8081 |

Android emulator reaches the host at `10.0.2.2` — the mobile app rewrites local hosts in dev. Start the emulator with
`-port 5562` (the default ADB port 5555 collides with the game host) and `-gpu host` (software rendering makes the
WebGL games crawl): `emulator -avd thumbcade_pixel -port 5562 -no-window -no-audio -no-snapshot -memory 4096 -gpu host &`.
iOS: Xcode 27 / iOS 27 simulators (`xcrun simctl list`). Android AVD: `thumbcade_pixel`. Maestro is installed.

## Ownership

`L` = lead, `A` = Player Platform agent, `B` = Creator & Games agent. Only touch what you own.

| Path | Owner |
|---|---|
| `packages/protocol`, `packages/swipe-contract`, `packages/design-tokens` | L (CONTRACT) |
| `supabase/migrations/20261013000000_init.sql` | L (CONTRACT) |
| root config (`package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, `eslint.config.js`), `CLAUDE.md`, `docs/ARCHITECTURE.md` | L |
| `apps/portal` | L |
| `apps/mobile`, `services/game-host`, `supabase/functions/*` except `creator-*`, `supabase/seed.sql`, `scripts/seed.ts` | A |
| `packages/sdk`, `packages/cli`, `packages/create-game`, `apps/simulator`, `services/reviewer`, `supabase/functions/creator-*`, `games/**`, `scripts/games-index.ts` | B |

Contract rules:
- Contracts are read-only for A and B. If one is wrong or missing something, work around it locally with an
  adapter (never a fork) and write the request to `docs/handoff/CONTRACT_REQUESTS.md`.
- New migrations: timestamped files, only for tables you own (A: social/feed/session tables; B: review/creator
  tooling tables). Apply with `supabase migration up`.
- `allowBuilds` entries in `pnpm-workspace.yaml` may be added by anyone via `bash scripts/safe-install.sh approve-builds <pkg>`.

## Conventions

- TypeScript strict; ESM; relative imports inside packages use explicit `.ts` extensions (contract packages are
  consumed as source by Metro, Next, Vite, Deno and tsx).
- Workspace packages extend `../../tsconfig.base.json` and re-export `../../eslint.config.js`.
- Expo-managed libraries use the versions `npx expo install` picks for SDK 57; everything else uses the latest
  stable version (`npm view <pkg> version`). TypeScript stays on 6.0.x (typescript-eslint does not support 7).
- The mobile app must keep running in **Expo Go** (no custom native modules) so it can be driven on simulators
  without native builds.
- Guests are Supabase anonymous users (`auth.jwt()->>'is_anonymous'`). Social writes require `public.is_member()`.
- No stubbed UI: a control on screen works end to end, or it is removed and listed in `docs/GAPS.md`.
- Design rules: `THUMBCADE_BUILD_PROMPT.md` §12. Tokens come from `@thumbcade/design-tokens`; never hardcode colors
  or font names. Brand assets (logo, app icon, splash, favicons, OG card) are in `packages/design-tokens/brand/`
  (regenerate with `pnpm --filter @thumbcade/design-tokens brand`).
- Log decisions in `docs/DECISIONS.md`, gaps in `docs/GAPS.md`. No AI attribution anywhere.
