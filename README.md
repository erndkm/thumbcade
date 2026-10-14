<p align="center"><img src="packages/design-tokens/brand/lockup.png" alt="thumbcade" height="72"></p>

# Thumbcade

An endless vertical feed of games you play with one thumb — like short video, but every card is a live HTML5 game. Swipe up for the next one. Creators build games with the Thumbcade SDK and publish them from their terminal; approved games go live without an app update.

## Quickstart

Requirements: Node 22+, pnpm 12, Docker (or Colima), the Supabase CLI. For the app: Xcode (iOS Simulator) and/or the Android SDK.

```bash
bash scripts/safe-install.sh   # pnpm install, serialized
pnpm games:build                # build the launch games → dist/games
pnpm dev                        # Supabase, game host, portal, simulator, reviewer, Metro
pnpm seed                       # in a second terminal: games, creators, players, comments, scores
```

Open http://localhost:3000 for the portal and web player. To open the app in Expo Go on a booted iOS Simulator,
run `xcrun simctl openurl booted exp://127.0.0.1:8081`. On Android, run `adb reverse tcp:8081 tcp:8081`, then open
`exp://127.0.0.1:8081` in Expo Go. `pnpm dev` runs Metro headless. For Expo's interactive keys (`i`, `a`, `r`),
run `pnpm dev --no-mobile` and `pnpm --filter @thumbcade/mobile start` in a second terminal. The first time,
`pnpm --filter @thumbcade/mobile ios` (or `android`) installs Expo Go on the simulator.

The seed includes a demo member, `demo@thumbcade.dev` (password `thumbcade-demo`, local only). In the app, the
hidden developer menu (Settings → About, tap the version row seven times) has a button that signs in as it.

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
pnpm typecheck && pnpm lint && pnpm test           # every workspace (unit, component, integration)
pnpm exec tsx scripts/e2e-creator-loop.ts           # scaffold → publish → review → approve → in a guest's feed
cd apps/mobile
bash maestro/run.sh ios                             # 8 device flows (Swipe Contract, social, auth, deletion)
bash maestro/run.sh android                         # same on the AVD (start it with -port 5562)
bash maestro/perf/soak.sh                           # 100-swipe memory soak → docs/PERF.md
npx expo export --platform ios --platform android   # production bundles
```

The Maestro flows and the soak need the local stack (`pnpm dev`) and a seeded database (`pnpm seed`).
`docs/handoff/A.md` and `docs/handoff/B.md` have the details for each half.

## Going to production

Everything above runs locally with no accounts. Shipping needs a person with these credentials:

1. **Domains:** buy `thumbcade.com` (app, portal, share links) and `thumbcade.gg` (game origins). Both were available
   at naming time.
2. **Supabase:** create the cloud project, `supabase link`, `supabase db push`, `supabase config push`, then
   `supabase functions deploy` and `supabase secrets set` with the keys in `supabase/functions/.env.example`
   (`SESSION_SIGNING_SECRET` of at least 16 random characters, `GAME_HOST_BASE`, `PORTAL_URL`, `CORS_ORIGINS`,
   `SUPABASE_PUBLIC_URL`, `EXPO_ACCESS_TOKEN`). Keep `[auth.email] enable_confirmations = true`.
3. **Game hosting:** a Cloudflare R2 bucket behind wildcard DNS for `*.thumbcade.gg`, so every game gets its own
   origin, with the CSP from `services/game-host` set as a response-header rule. Point `GAME_HOST_BASE` (functions)
   and `NEXT_PUBLIC_GAME_HOST` (portal) at it.
4. **Reviewer:** run `services/reviewer` as a worker on a host with a GPU (WebGL budgets) and the service-role key.
5. **Portal:** deploy `apps/portal` to any Node host and set the env from `apps/portal/.env.example`. Serve
   `/.well-known/apple-app-site-association` and `/.well-known/assetlinks.json` for Universal and App Links.
6. **App:** create the EAS project and add `extra.eas.projectId`, then set up APNs and FCM credentials, the Apple
   Services ID and key, and Google OAuth client IDs (turn on `EXPO_PUBLIC_AUTH_APPLE_ENABLED` /
   `EXPO_PUBLIC_AUTH_GOOGLE_ENABLED`). Then `eas build` and `eas submit`. Listing copy, age rating, privacy labels
   and App Review notes are in `docs/STORE.md`.
7. **Platform programs:** apply to Apple's Mini Apps Partner Program (HTML5 games loaded at runtime, App Review
   guideline 4.7) and file the Thumbcade trademark.
8. **npm:** publish `@thumbcade/sdk`, `@thumbcade/cli` and `create-thumbcade-game` under the org with
   `pnpm --filter <pkg> publish`, not `npm publish`. Only pnpm applies `publishConfig.exports`, which points
   at `dist/`.

`docs/GAPS.md` lists everything that could not be verified without these.
