# Decisions

One line each: decision — reason.

## Phase 0 (lead)
- Expo SDK 57 (React Native 0.86, React 19.2, Reanimated 4.5) with versions chosen by `npx expo install` — npm "latest" of RN libs is ahead of what SDK 57 supports.
- TypeScript 6.0.x everywhere — TS 7 (native port) is not yet supported by typescript-eslint (<6.1).
- pnpm 12 with `nodeLinker: hoisted` — Metro/React Native resolve most reliably from a flat node_modules.
- Contract packages are consumed as TypeScript source with explicit `.ts` import extensions — one source of truth for Metro, Next, Vite, Deno and tsx without a build step.
- Guests are Supabase anonymous users — one stable identity for events/sessions/storage; linking upgrades in place; RLS gates social writes with `is_member()`.
- The mobile app stays Expo Go-compatible (no custom native modules; `expo-sqlite/kv-store` instead of MMKV) — lets us drive iOS/Android simulators without native builds or CocoaPods.
- Bridge: the reply to `hello` carries the LaunchContext (what the prompt calls `init`) — one generic `reply` envelope for all requests keeps the SDK tiny.
- `gameplay.start` carries an SDK-observed `trigger` (tap/swipe/key) — lets the shell, simulator and reviewer detect "run started by a swipe" without seeing inside cross-origin frames.
- Added a `FAILED` card phase to the Swipe Contract — loading failures need their own retry state; ownership is the same as LOADING.
- Pause/resume messages are derived by reconciling `shouldRun(state)` after every transition — makes double pause/resume impossible (fuzz-tested).
- Local game host is path-based (`:5555/<slug>/<versionId>/`); production is one origin per game on `thumbcade.gg` — `*.localhost` subdomains don't resolve in simulators/emulators.
- `game-bundles` bucket is public-read locally (unguessable version UUID paths) — production serves from R2 behind the CDN.
- Protect triggers (roles, counters, status, live version) allow nested trigger updates and `enter_trusted()` security-definer RPCs — counters and approve/rollback must update protected columns.
- Review decisions are SQL RPCs (`approve_version`, `reject_version`, `rollback_to_version`, `takedown_game`) — one implementation for the portal, the CLI and the e2e script.
- Docker via Colima (Homebrew) — Docker Desktop needs interactive setup; Colima runs headless.
- Brand assets are generated from code (`scripts/build-brand.ts`) with opentype.js 1.3.4 — 2.0.0 produced NaN glyph coordinates for Mona Sans Display Expanded.
- Logo: a raised arcade button in volt whose engraved ridges form a thumbprint whorl; five bold ridges (not six thin ones) so it survives 29–60 px.

## Creator & Games (B)
- SDK types are hand-written mirrors of the protocol (type-level equality tests) — the published package needs no dependency, not even type-only; zod-inferred types would drag zod into the d.ts.
- `@thumbcade/sdk/host` validates with the protocol's zod schemas and is published with zod as an optional peer — hosts need validation; games never load it.
- SDK connects its transport at import (not at `init()`) — an offscreen preload can receive `pause` before the game calls init.
- Start trigger = movement of the active/last pointer sequence (≥ 12 px = swipe), key within 1 s = key, else none — the SDK only sees what happens inside the game document.
- After `input.cancel` the SDK swallows the rest of the gesture at window capture (moves, ups, compat mouse events, click) — "no half-jump" has to hold even for games that ignore pointercancel.
- `tc.loop` passes dt in seconds, 0 on the first frame and after a resume, clamped to 0.1 s — paused time must never become physics time.
- Standalone mock host: storage in localStorage, a local best-score "leaderboard", a shadow-DOM dev HUD whose taps are intercepted at window capture so the game never sees them.
- Reviewer harness serves the game from 127.0.0.1 and the harness from localhost (different origins) with the production CSP, gzip, and the real swipe-contract machine — what it measures is what the app would do.
- Reviewer runs Chromium with site isolation disabled — CPU/network throttling must apply to the game iframe, which otherwise lives in its own renderer process.
- "Fast 4G" = Chrome DevTools preset (9 Mbps down, 1.5 Mbps up, 165 ms adjusted latency) + 4× CPU throttle for the ready() budget.
- Launch games share `games/_kit` (session lifecycle, procedural WebAudio SFX, particles, easing, recognizers, shake/hit-stop, fonts); two OFL fonts are bundled per game: Departure Mono (22 KB) and a printable-ASCII subset of Mona Sans Display Expanded Black (25 KB).
- Kit audio suspends the AudioContext whenever the game is muted or paused — pause always means silence, and a muted preview costs no CPU.
- Game icons are SVG artwork in `games/<slug>/art/icon.svg`, rendered to 1024² PNG by the kit's Vite plugin with sharp at build time.
- `tc.feedback` is delivered only during a run (+1.5 s after `gameplay.end`) and never while paused — attract-mode demos must not buzz someone scrolling past; enforced in the SDK so every game gets it.
- Games create their AudioContext while booting when they launch unmuted — creating it inside the first tap measured 120-160 ms (a long task after ready).
- Reviewer WebGL runs on the real GPU (ANGLE/Metal) on macOS — SwiftShader can't hold 60 fps for the 3D games; Linux reviewers need a GPU host (documented in GAPS).
- Reviewer measures long tasks under the 4× CPU throttle (load + the first 2.5 s of attract mode), then unthrottles for fps (GPU) and the interaction script — fps under CPU throttling measures the reviewer's machine, not the game.
- Reviewer: runtime requests to other origins are reported under `static_scan` — ReviewCheckId has no separate network check.
- Reviewer `gameplay_end`: 25 s without input, then up to 70 s of scripted taps/swipes; "warn" (not "fail") when no game over is observed — a human reviewer checks long-session games.
- Reviewer swipe test mimics the feed: a 220 pt vertical swipe in attract mode with FEED_GESTURE_BEGIN dispatched at the first move step; any gameplay.start during it fails `no_swipe_start`.
- Simulator and game share one origin (`thumbcade dev` serves the prebuilt simulator at `/` and the game at `/__game/` through Vite middleware mode with HMR; the monorepo simulator serves launch games at `/__games/`) — the simulator observes input through the probe, whose listeners register before the SDK's, so it can arbitrate drags the SDK swallows after `input.cancel`. Cross-origin URLs load with Dock/keyboard/wheel navigation only.
- Simulator models the 3-slot pool: the dev game's WebView is recycled two cards away and preloaded OFFSCREEN (pause after ready) when it is a neighbor again.
- Simulator chrome is a visual twin of the app; the controls that matter to a game work (like/save/follow toggles, comments/share sheets that SUSPEND the card, Dock mute, result card, resume pill). Everything else on the chrome is inert, not a fake action.
- creator-publish answers pre-upload failures with HTTP 4xx `{error, message, issues}` (contract request B2); the first publish claims the slug and copies the bundle icon (and poster) into game-assets as the game's profile picture.
- CLI auth: `Authorization: Bearer tc_…` first; if the functions gateway rejects a non-JWT bearer, retry with the anon key + `x-thumbcade-token` (until `verify_jwt=false` for creator-publish is live, contract request B1).
- CLI credentials live in the OS keychain (macOS `security`, Linux libsecret `secret-tool`), else `~/.config/thumbcade/credentials.json` (0600), keyed by backend host; `THUMBCADE_TOKEN` wins for CI.
- `thumbcade dev --device` prints a QR for `thumbcade://dev?url=<encoded http://<lan-ip>:<port>/__game/index.html>` — the app's developer menu opens that URL in a DEV card.
- create-thumbcade-game uses opentype.js 1.3.4 (2.0.0 breaks Mona Sans Display Expanded glyph coordinates, same as the brand build) to turn the bundled OFL fonts into SVG paths, rendered with sharp — real icons and posters with no system fonts or browser.
- Template projects use system font stacks and a `release` npm script (not `publish`, which collides with npm's lifecycle).
- `pnpm games:build` captures posters from attract mode through the reviewer harness (preview insets applied, 405×720 at 8/3 DPR = 1080×1920 JPEG) and ships each poster inside its bundle with `manifest.poster` set.
- Launch games are spread across SEED_CREATORS: thumbcade (Flapjack, Lane Rush), lowpolyfox (Stackd, Helix Fall), quietmoves (Gambit, Mines), pixelwitch (Pairs, Merge), juicefactory (Slice, Breakout Neo), bitbybit (Reflex, Snek).
- Pixi games import `pixi.js/unsafe-eval` (it makes Pixi v8 run without eval under the CSP) and stop `Ticker.shared`/`Ticker.system`, driving them from `tc.loop`; Three.js games render inside `tc.loop`, never `setAnimationLoop`.

## Player Platform (A)
- Gesture spike (§5.6) PASSED on iOS 27 (iPhone 18 Pro sim, Expo Go 57) and Android 16 (AVD `thumbcade_pixel`, Expo Go 57.0.9) with the primary approach: RNGH `Gesture.Pan().manualActivation(true)` on the pager (activation decided in `onTouchesMove` from the §5.4 rules held in shared values) composed via `simultaneousWithExternalGesture` with a `Gesture.Native()` wrapping each WebView. Verified by Maestro (`apps/mobile/maestro/spike/`): (a) taps reach the WebView with 0 ms (iOS) / 1 ms (Android) between RNGH `onTouchesDown` and the page's `touchstart` (`Date.now()` on both sides); (b) a vertical swipe in PREVIEW is claimed by the feed and the game is sent `input.cancel`; (c) in PLAYING with `vertical: true` a surface swipe reaches the game (swipe counted, no feed claim) while a pan starting on the Dock moves the feed; plus a `vertical: false` game in PLAYING still yields a deliberate swipe to the feed. The `input.inject` overlay fallback is therefore not needed and not shipped.
- Pan failure rule added on top of the contract's activation rule: the surface pan fails (the game keeps the gesture) once |dx| ≥ 16 pt and |dx| > |dy| — the contract defines when the feed claims, not when it gives up; without this a slow horizontal drag could be claimed late.
- Expo Go on Android shows its developer-menu onboarding once per install; Maestro flows dismiss it conditionally. Android Maestro swipes on the Dock target the element (`swipe from: id`) because a percentage near the bottom lands in the system gesture area.
- Metro runs without `--localhost` (it binds IPv6-only `::1`, which Expo Go on the iOS simulator cannot reach at 127.0.0.1); `REACT_NATIVE_PACKAGER_HOSTNAME=127.0.0.1` keeps the manifest URL local. Android uses `adb reverse tcp:8081 tcp:8081`.
- The Android emulator must not use the default console port 5554: its ADB port 5555 collides with the game-host. Start it with `emulator -avd thumbcade_pixel -port 5562 …` (ADB then uses 5563).
- Edge functions are served by `supabase functions serve --env-file supabase/functions/.env` (the CLI's `supabase start` runtime mounts no functions in this setup and stops serving when the stack restarts). Relative imports of `packages/protocol/src` work inside the edge runtime, so functions validate with the real contract schemas (per-function `deno.json` maps `zod` → `npm:zod@4.6.7`).
- Game host proxies the public `game-bundles` bucket with an in-memory LRU (bundles are immutable), sends the exact §6 CSP plus `frame-ancestors` for the portal and simulator, CORS only for an allowlist (never `*`), ETag/304 and range requests.
- Feed ranking (`rank_feed`) is SQL with weights from `feed_config`; the edge function owns the cursor (`seen` ring, position, last creator/tag) so diversity holds across pages. With a small library the feed recycles least-recently-served games (never the last 6 cards) so it is infinite.
- Exploration slots use Thompson sampling with Beta draws from uniform order statistics in plpgsql; games with < `exploration.maxImpressions` impressions qualify.
- Score integrity: `session-start` issues an HMAC-SHA256 token binding session, user, game and issue time; `session-end` rejects bad tokens, scores over `manifest.score.max`, NaN/negative scores, impossible durations (claimed > server elapsed + 5 s, or elapsed < 400 ms) and double ends. Guests get `accepted:false, reason:"guest"` but still receive their best and today's percentile.
- Push fan-out: pg_cron → pg_net → `notify` every minute; the function base URL and service key live in Vault (`set_runtime_secret`), set by the seed locally and by ops in production.
- Comment filter normalises leetspeak and matches whole words from `public.moderation_words`; 5 comments / 60 s / user; one pinned comment per game.
- Seed deletes seed users one at a time after clearing their social rows in bulk (parallel deletes deadlock on counter triggers). Seed icon/poster URLs carry `?v=<versionId8>` for cache busting.
