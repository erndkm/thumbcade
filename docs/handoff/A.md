# Player Platform (A): handoff

Everything A owns, how to run it, and how it is verified.

| Area | Path |
|---|---|
| Mobile app (Expo SDK 57, Expo Router, Expo Go-compatible) | `apps/mobile` |
| Dev fixture games (speak the bridge directly) | `apps/mobile/dev-fixtures/` |
| Game host (local stand-in for `*.thumbcade.gg`) | `services/game-host` |
| Edge functions | `supabase/functions/{feed,events,session-start,session-end,challenge-resolve,share-create,account-delete,notify,_shared}` |
| Migrations | `supabase/migrations/20261013120000_player_platform.sql`, `…121000_player_platform_shares.sql`, `…122000_player_platform_fixes.sql` |
| Seed | `scripts/seed.ts` (+ `scripts/seed/`), `supabase/seed.sql` |
| Maestro flows | `apps/mobile/maestro/` |

## 1. Backend

```bash
supabase status -o env                                        # stack must be running (shared; never reset/stop it)
supabase migration up --local                                 # applies A's migrations
supabase functions serve --env-file supabase/functions/.env   # functions at http://127.0.0.1:54321/functions/v1/<name>
pnpm --filter @thumbcade/game-host start                      # http://127.0.0.1:5555/<slug>/<versionId>/<path>
pnpm games:build                                              # (B) dist/games/games-index.json
pnpm seed                                                     # idempotent: wipes is_seed rows + their storage first
```

- `pnpm dev` (root) starts functions serve, the game host and Metro together with the rest.
- `supabase start` alone does **not** serve the functions in this setup; `functions serve` must run (hot reload; it
  stops when the stack restarts, so restart it after `supabase start`).
- Secrets: `supabase/functions/.env` (`SESSION_SIGNING_SECRET`, `GAME_HOST_BASE`, `PORTAL_URL`, optional
  `EXPO_ACCESS_TOKEN`). `.env.example` next to it documents them.
- Seed: reads `dist/games/games-index.json` when it exists, else `apps/mobile/dev-fixtures/games-index.json`.
  `pnpm seed --index <path>` overrides, `pnpm seed --with-fixtures` adds the two fixture games to the launch library.
  Creates the six `SEED_CREATORS`, ~40 demo players with written comments, follows, likes, saves, scores, sessions,
  14 days of stats, challenge/link shares from named members, editorial rows and trending hashtags.
  Demo member: `demo@thumbcade.dev` / `thumbcade-demo` (also one tap away in the app's developer menu in dev builds).
- Rebuild the fixtures (icons, posters, index): `npx tsx apps/mobile/dev-fixtures/build-assets.ts`.

## 2. Mobile app

```bash
cd apps/mobile
cp .env.example .env                       # local Supabase keys, game host, share base, auth flags
source ../../scripts/env.sh
REACT_NATIVE_PACKAGER_HOSTNAME=127.0.0.1 npx expo start --port 8081    # Metro (keep it running)
xcrun simctl boot "iPhone 18 Pro"; xcrun simctl openurl booted exp://127.0.0.1:8081
```

- Runs in **Expo Go SDK 57** (iOS: installed by `expo start --ios`; Android: `Expo-Go-57.0.9.apk`). No native build.
- Don't use `--localhost`: Metro then binds IPv6 `::1` only, which the iOS simulator can't reach at 127.0.0.1.
- Android emulator: start it with **`-port 5562`** (the default ADB port 5555 collides with the game host):
  ```bash
  emulator -avd thumbcade_pixel -port 5562 -no-window -no-audio -no-snapshot -memory 4096 -gpu host &
  adb reverse tcp:8081 tcp:8081
  adb shell am start -a android.intent.action.VIEW -d exp://127.0.0.1:8081 host.exp.exponent
  ```
  The app rewrites `127.0.0.1/localhost` to `10.0.2.2` for Supabase, storage and game URLs (`rewriteLocalUrl`).
  adb's emulator discovery also probes TCP 5555 and may list a phantom offline `emulator-5554` (that's the game
  host); `maestro/run.sh` restarts adb with `ADB_LOCAL_TRANSPORT_MAX_PORT=5554` and connects `127.0.0.1:5563`.
- Deep links: `thumbcade://g/<slug>`, `thumbcade://c/<code>`, `thumbcade://dev?url=<encoded>`; in Expo Go use
  `exp://127.0.0.1:8081/--/g/<slug>` etc. Universal/App Links for `https://thumbcade.com/g|c/*` are configured in
  `app.config.ts` (need the domain association files in production).
- Developer menu: Settings → tap the version row 7 times (automatic for creators). Open a game from a LAN URL or
  scan the `thumbcade dev --device` QR. Dev cards show a DEV badge and a live bridge log.
- Bundle check: `npx expo export --platform ios --platform android --output-dir dist-export` (both pass).

## 3. Tests

```bash
pnpm --filter @thumbcade/mobile typecheck && pnpm --filter @thumbcade/mobile lint && pnpm --filter @thumbcade/mobile test
pnpm --filter @thumbcade/game-host typecheck lint test     # 12 tests (path validation, CSP/CORS headers, cache)
pnpm --filter @thumbcade/scripts typecheck lint test       # seed + function helpers (14 tests; tsc also checks the Deno functions)
```

Mobile (jest-expo, 40 tests): `test/controller.test.ts` (bridge + Swipe Contract wiring: hello/LaunchContext, SDK
major check, zod drops, rate limits, PREVIEW/PLAYING/ENDED/PAUSED/FAILED, input.cancel → pause → resume, committed
swipes, idle auto-pause, load timeout incl. hidden host, session start/end, NEW BEST rules, violations, replay),
`test/CardView.test.tsx` (overlay/result/pause/failed rendering per phase), `test/BottomBar.test.tsx` (tab bar vs
Dock, coach), `test/utils.test.ts` (URL rewriting, age bands, event queue, insets, copy helpers, dev links).

### Maestro (needs Metro, functions serve, game host, a seeded DB, Mailpit)

```bash
cd apps/mobile
bash maestro/run.sh ios          # all flows on the booted simulator
bash maestro/run.sh android      # all flows on the emulator (see the adb note above)
bash maestro/run.sh ios 03       # flows whose file name matches "03"
```

| Flow | Covers |
|---|---|
| `01-cold-start-playing` | cold start → onboarding if needed → PREVIEW → tap → PLAYING with the Dock |
| `02-swipe-in-preview` | a vertical swipe in PREVIEW moves to the next card |
| `03-vertical-game-dock` | a `vertical: true` game (Shortwick; `VERTICAL_SLUG`) keeps surface swipes; the Dock pan leaves |
| `04-like-needs-signin` | guest like → sign-up sheet |
| `05-comment` | demo member comments; the comment appears |
| `06-challenge-link` | a challenge link opens its game first |
| `07-email-signup` | guest upgrades in place by email (OTP from Mailpit when confirmations are on), pending like runs |
| `08-delete-account` | sign up, delete the account in-app, land on a fresh guest |

Status (2026-10-14): all eight flows pass on iOS 27 (iPhone 18 Pro, ~1 min each) and Android 16 (`thumbcade_pixel`,
Expo Go 57.0.9, 1–3 min each). Start the emulator with `-gpu host`: with `-gpu swiftshader_indirect` it renders
WebGL in software (qemu at ~550 % CPU), flows take 3–20 minutes, and runs end or idle-pause before Maestro's slow
polls see them.

`maestro/tour/tour.yaml` visits every screen and state for design QA (screenshots in `docs/screenshots/mobile/`).
`maestro/spike/` holds the §5.6 gesture spike flows (`/dev/spike` route).

## 4. Service contracts (A)

| Function | Contract |
|---|---|
| `GET feed?tab&cursor&limit&tag&first` | `FeedResponse`; `first` puts that game first (`rank.source = deeplink`) |
| `POST events` | `EventsRequest` → `{accepted}`; affinity + `challenge_accepted` notifications in `ingest_events` |
| `POST session-start` / `session-end` | `SessionStart*` / `SessionEnd*`; HMAC token; reject reasons = `SessionRejectReason` |
| `GET challenge-resolve?code` | `ChallengeResolveResponse`, bumps `open_count`, 404 unknown |
| `POST share-create` | `ShareCreateRequest` → `ShareCreateResponse`, members only (403 for guests) |
| `POST account-delete` | deletes the caller (cascade) and their avatar objects |
| `POST notify` | service role only; Expo push for unpushed notifications (pg_cron → pg_net every minute) |

Client RPCs: `leaderboard(p_game_id, p_scope, p_limit)`, `leaderboard_me(p_game_id)`, `claim_guest_scores()`.
Cron: partitions (daily), `rollup_game_stats` (10 min), `compute_trending` (hourly), `decay_affinity` (daily),
`cleanup_stale_sessions` (hourly), push fan-out (minute).

## 5. Design QA (mobile, against §12)

Screenshots: `docs/screenshots/mobile/ios/` (iPhone 18 Pro, iOS 27, Expo Go; re-shoot with `maestro/tour/tour.yaml`).
The blue gear in the corner of every shot is Expo Go's developer overlay, not part of the app.

Pass 1 → fixes:
- Caption taller than the 148 pt `captionHeight` inset games are told about → description collapses to one line, tags
  don't wrap, caption capped to the inset; Dynamic Type for the caption capped at 1.12×.
- Result card covered the action rail → card now ends where the rail begins; meta line became a labelled stat row
  (Best / Today / Rank); a first-ever run no longer gets a "NEW BEST" stamp.
- Disabled buttons rendered as muddy 45 % volt → neutral raised key with muted label.
- `paperMute` text measured 3.4–4.0:1 → every readable string moved to `textDim` (≥ 7.2:1); mute is only for
  placeholders, disabled states and decorative glyphs.
- Sheets had no explicit close control (and a scrim-only dismiss is invisible to VoiceOver) → close key in every
  sheet header; navigating away closes sheets.
- Tab bar items stayed in the accessibility tree while hidden behind the Dock (and vice versa) → hidden from a11y.
- Hard-coded rgba/hex values crept into overlays → all derived from tokens (`alpha(c.bg, …)`).
- Guests saw a "Saved" tab they can't use → hidden for guests.

Pass 2 (after fixes) — what was checked: feed (preview, playing/Dock, paused, result, failed), like burst, comments,
share sheet + share card, more sheet, game page + leaderboards, discover, hashtag, search, inbox, own/creator/guest
profiles, create, settings, auth sheet, onboarding, empty Following, scoped feed, developer card with bridge log, and
Dynamic Type at accessibility XL (feed, game page, settings). Remaining notes:
- The game's own HUD can sit under the top tabs while PAUSED (the overlay returns as specified and the game is told
  `insets.current = "preview"`; repositioning its HUD is the game's job, flagged by the simulator/reviewer).
- Today's percentile/rank reflects only seeded rows dated "today" (UTC); re-run `pnpm seed` before demos.
