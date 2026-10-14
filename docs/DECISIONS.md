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

## Integration (lead, Phase 2)
- Challenge share codes only carry a score the caller reached (`share-create` checks `best_scores`, respecting `score.order`) — otherwise anyone could post "beat my 999,999" under their name.
- Events ingest is capped at 600 per user per minute (`events` → 429; the app's bounded queue retries) — trending and ranking signals roll up from client events, so one install must not be able to steer them.
- Session tokens fail verification when `SESSION_SIGNING_SECRET` is under 16 characters, mirroring signing — a missing secret would otherwise accept empty-key HMACs.
- The WebView message origin check is exact (the origin itself, or anything under `origin + "/"`), not a bare prefix — a prefix also matches `https://slug.thumbcade.gg.evil.example`. iOS reports the page URL, Android's WebMessageListener the bare origin; both are unit-tested.
- A card's WebView is keyed by its controller instance as well as its reload counter — a replaced controller (pool reload, Fast Refresh) never saw the old page's hello/ready, so it needs its own page load.
- `create-thumbcade-game --local` writes `link:` dependencies under pnpm and `file:` elsewhere — pnpm copies `file:` directories with only their published files, and the in-repo SDK exports point at `src/`.
- `pnpm dev` stops its children with SIGINT and a 5 s SIGKILL fallback — the Supabase CLI ignores SIGTERM and was left running.
- The seed derives creator-dashboard social numbers from the real seeded rows (60 % of all-time over the last 14 days) and seeds yesterday too — independent synthetic rates showed more likes in 14 days than all time, and an empty yesterday read as a dead game.
- A paused run is dimmed (55 % ink) under the returning chrome — the spec brings the overlay and tab bar back in PAUSED, and without a dim the game's own HUD competes with them.
- The feed caption keeps its natural height (bottom-anchored, tighter rows under Dynamic Type) instead of a max height — at accessibility sizes the cap clipped the meta line; a few points over the preview inset beats losing content.
- Local auth runs with `enable_confirmations = true`, like production — `supabase config push` would otherwise ship the insecure setting, and the guest-upgrade code path gets exercised every day.
- `scripts/shoot.mjs` waits for `load` plus an optional quiet moment, not `networkidle` alone — pages with live game iframes may never go fully idle.
- The Android emulator runs with `-gpu host` (Metal), not SwiftShader — software WebGL kept qemu at ~550 % CPU, and Maestro taps took minutes; with the GPU all eight flows pass in 1–3 min each.
- Maestro's cold-start flow accepts PLAYING, ENDED or PAUSED after the tap — all three are only reachable through PLAYING, and a slow poll can land after a short run ends or after the 20 s idle pause.

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
- Each card is a `CardController` (plain TS) that owns the contract state, executes every `transition()` effect, terminates the bridge (zod + per-type rate limits) and the session lifecycle; React only subscribes (`useSyncExternalStore`). It is unit-tested without React Native.
- The pager keeps a pool of three slots; slot k hosts the card whose index ≡ k (mod 3), so a forward swipe recycles the slot furthest behind. Slot positions are `feedIndex·H − scrollY` on the UI thread; the commit decision runs in the release worklet (`resolveRelease`) and only the activation bookkeeping hops to JS.
- Rules for the surface, two-finger and Dock pans are pushed into one shared value from `gestureConfigFor(phase, controls)` whenever the active card's phase changes; the worklets call the contract's `claims()`/`resolveRelease()` directly (the contract functions are worklet-annotated and transform fine from the workspace package).
- WebView budget: only the focused pager mounts game WebViews; a pushed scoped feed claims the budget and the home feed falls back to posters until it is focused again. The `ready()` timeout pauses while the hosting screen is hidden (hidden WKWebViews stop rAF).
- Shared WebView data store (not incognito) with `sharedCookiesEnabled={false}`/`thirdPartyCookiesEnabled={false}`: keeps the HTTP cache warm between plays; production isolates games by origin (`<slug>.thumbcade.gg`). Navigation is locked to the version's base path, not just the origin.
- Global sound defaults to off; games start muted in previews until the user turns sound on (Dock or Settings); the setting is persisted.
- Idle auto-pause (20 s) means unattended runs never end on their own; the resume pill brings them back.
- Age screen stores only the band, computed from the lower bound of the possible age (birthday may not have passed) so the boundary errs on the protective side. Under-13 players can play age-appropriate games but social features stay locked.
- Comments, likes, saves, follows, reports, blocks go straight to PostgREST under RLS with optimistic cache patches across every query that shows the same game or person; edge functions are only used where a trusted server step is required (ranking, sessions, shares, deletion, push).
- Share codes are members-only (protocol); guests share the plain game URL. The seed's challenges come from named demo members and carry that member's real best.
- `paperMute`/`textMute` (3.4–4.0:1 on ink) is used only for placeholders, disabled states and decorative glyphs; all readable text uses `textDim` or brighter (≥ 7.2:1).
- Dynamic Type: text scales up to ~1.35× (display sizes less); the feed caption is capped at 1.12× because it must fit the fixed `captionHeight` inset that games are told about.
- Cartridge → game page "shared element" is implemented by measuring the cartridge and animating a floating icon into the hero slot (Reanimated 4's shared element transitions need a native feature flag that Expo Go doesn't have).
- Brand marks are rendered from the design-tokens SVG files (embedded verbatim by `scripts/gen-brand.mjs` for `SvgXml`), never redrawn.
- iOS-only WebView props (`dataDetectorTypes`, `textInteractionEnabled`, `keyboardDisplayRequiresUserAction`) are passed only on iOS: on Android/Fabric, `dataDetectorTypes` crashes the RNCWebView props parser.
- `expo-notifications` and `expo-media-library` are loaded lazily: Expo Go for Android logs an error on importing the former and lacks the latter's native module.
- App Store guideline 4.7 (read 2026-10-14 at developer.apple.com/app-store/review/guidelines): HTML5/JS mini games may be offered outside the binary if the app takes responsibility for them and meets 4.7.1–4.7.5. How the player complies: **4.7.1** privacy rules apply to games too (games never see tokens, email, device ids or the real user id; per-game opaque player id), objectionable-content filtering (human review before live, age ratings, comment word filter), report (games, comments, users) and block are in the app, with a moderation queue in the portal; no digital goods in v1 (3.1 untouched). **4.7.2** games get no native APIs: the bridge exposes only lifecycle, score, storage, leaderboards, a share flow and *semantic* feedback that the shell maps to haptics itself. **4.7.3** no data or permission is shared with a game without consent: games get display name/avatar only, no permissions (camera, location, photos) are ever forwarded. **4.7.4** the index of software is the games table/feed with full metadata, and every game has a universal link (`https://thumbcade.com/g/<slug>`, wired as associated domain). **4.7.5** declared-age gate on first launch stores an age band; the feed filters by each game's age rating, and the game page shows the rating.
