# THUMBCADE — Build Brief

> Start Claude Code in an empty folder containing this file and send: **"Read THUMBCADE_BUILD_PROMPT.md and execute it end to end."**

---

## 0. Your role

You are the lead engineer and design director of **Thumbcade**. You have full autonomy to build the entire product in this repository in one continuous run.

- Do not stop to ask questions. When something is ambiguous, pick the option that best serves the product vision, log it in `docs/DECISIONS.md` (one line: decision + reason) and keep going.
- Stop only when the Definition of Done (§17) is met, or when a hard blocker (missing credentials, missing hardware) makes progress impossible. In that case finish everything that does not depend on it and write exactly what the human must do in `docs/GAPS.md`.
- You work with **exactly two subagents** (§15, §16). You own the contracts, the integration and the final quality bar. Their work is not done until you have verified it yourself.
- Keep `docs/PROGRESS.md` updated as a checklist of §17 so the state of the build is always visible.

---

## 1. The product

Thumbcade is TikTok for minigames. Open the app and a game is already running full-screen in portrait. Play it for five seconds or five minutes, or swipe up and the next one is there instantly. The feed is infinite and personalized. Every game has a profile picture, a name, a creator, a description and hashtags. Around it is the full social layer people expect from short video: likes, comments, shares, saves, follows, discovery, trending and profiles. Scores turn into challenges: "I scored 412 on Lane Rush, beat me" opens that game straight from the link.

The library grows because anyone can build for it. A web developer runs `npm create thumbcade-game`, builds with any 2D or 3D web tech, tests in a feed simulator that behaves exactly like the phone, and runs `thumbcade publish`. Approved games go live in the feed with no app update.

Three things make or break the product, in this order:

1. **Instant feel.** Swiping must feel like TikTok: 120 Hz-smooth, the next game already alive when the card lands, and never a spinner in the feed.
2. **The Swipe Contract.** A swipe up must never be ambiguous. Some games use vertical swipes as input (runners, 2048, snake). §5 defines a deterministic arbitration model. Implement it exactly.
3. **Taste.** It must look like a design-led studio made it, not a template. §12 is a requirement, not a suggestion.

---

## 2. Non-negotiables

- TypeScript `strict` everywhere. No `any` in shipped code without a comment that explains why.
- **No stubbed features in shipped paths.** If a control is on screen, it works end to end against the local backend. If something can't be finished, remove it from the UI and list it in `docs/GAPS.md`.
- No lorem ipsum, no "Coming soon" screens, no grey placeholder boxes.
- Every asset must be original or permissively licensed (OFL, MIT, BSD, CC0). Do not use the names, art or trademarks of existing games (no "Flappy", "Temple Run", "Fruit Ninja", "Subway Surfers"). Record every license in `THIRD_PARTY.md`.
- Use the **latest stable version** of every dependency at build time. Check with `npm view <pkg> version` and never guess versions from memory. The lockfile pins exact versions.
- No secrets in git. `.env.example` documents every variable.
- Initialize git and commit at the end of every phase with a descriptive message.

---

## 3. Tech stack

| Layer | Choice | Why |
|---|---|---|
| Monorepo | pnpm workspaces + Turborepo, TypeScript everywhere | One language across app, SDK, tooling, backend functions and games |
| Mobile app (iOS + Android) | Expo (latest SDK, New Architecture), Expo Router, React Native Reanimated, React Native Gesture Handler, `react-native-webview`, `@shopify/react-native-skia`, `expo-image`, `expo-haptics`, `expo-secure-store`, `react-native-mmkv`, TanStack Query, Zustand, FlashList | Gestures and 120 Hz animation run on the UI thread. A WebView is the only store-compliant way to hot-load third-party games. |
| Games | HTML5: Canvas 2D, WebGL2, WebGPU optional when available. Any engine: vanilla, Phaser, PixiJS, Three.js, Babylon.js | Apple guideline 4.7 and Google Play policy allow HTML5/JS mini games loaded at runtime in a web view. Native code cannot be hot-loaded. |
| Game SDK | `@thumbcade/sdk`: zero dependencies, ESM, ≤ 8 KB gzipped | The only API a game ever sees |
| Backend | Supabase: Postgres + RLS, Auth (Sign in with Apple, Google, email OTP), Storage, Realtime, Edge Functions (Deno), pg_cron. Runs locally via the Supabase CLI. | A complete social backend with row-level security that runs fully offline for development |
| Game hosting | Static, immutable, versioned bundles on a **separate registrable domain**: `https://<slug>.thumbcade.gg/<versionId>/` in production (Cloudflare R2 + CDN, wildcard cert, one origin per game), strict CSP. Locally: `services/game-host` with path-based URLs. | Untrusted game code is isolated from the app, the API, the portal's cookies and other games. Reviewed bytes are exactly the running bytes. |
| Creator portal + public web | Next.js (App Router), Tailwind CSS, Radix primitives styled from scratch (no stock component-kit look), MDX docs | Creator dashboard, admin review, docs, landing page, share/challenge pages with a web player |
| Feed simulator | Vite + React | What `thumbcade dev` opens. It mirrors the phone exactly. |
| Automated review | Node + Playwright (headless Chromium) | Loads every submitted build and enforces the budgets and the SDK contract |
| Tests | Vitest (logic), jest-expo + Testing Library (RN components), Playwright (web), Maestro (mobile end-to-end) | |

Don't swap any of these without writing the reason in `docs/DECISIONS.md`.

---

## 4. Repository layout and ownership

```
.
├── apps/
│   ├── mobile/            Expo app (the player)                                  [A]
│   ├── portal/            Next.js: landing, creator dashboard, admin, docs,
│   │                      /g/[slug] share + challenge pages, web player            [L]
│   └── simulator/         Vite + React feed simulator used by `thumbcade dev`     [B]
├── packages/
│   ├── protocol/          Bridge messages, manifest schema, LaunchContext,
│   │                      FeedCard DTO, publish API, GamesIndex — CONTRACT         [L]
│   ├── swipe-contract/    Pure TS gesture/session state machine — CONTRACT         [L]
│   ├── design-tokens/     Color/type/space/motion tokens → RN + CSS, fonts — CONTRACT [L]
│   ├── sdk/               @thumbcade/sdk (runs inside games)                       [B]
│   ├── cli/               `thumbcade` CLI: dev, validate, login, publish           [B]
│   └── create-game/       `npm create thumbcade-game` + templates                  [B]
├── games/
│   ├── _kit/              Shared tree-shakable helpers: SFX synth, particles,
│   │                      easing, input, screen shake                             [B]
│   └── <slug>/            One Vite project per launch game                        [B]
├── services/
│   ├── game-host/         Local stand-in for *.thumbcade.gg (CSP, immutable paths) [A]
│   └── reviewer/          Playwright-based automated game review worker           [B]
├── supabase/
│   ├── migrations/        0001_init.sql is CONTRACT [L]; later migrations by table owner
│   ├── functions/         creator-* [B], everything else [A]
│   └── seed.sql                                                                   [A]
├── scripts/               seed, e2e-creator-loop, screenshots                      [A]/[L]
├── docs/                  ARCHITECTURE, DECISIONS, PROGRESS, GAPS, DESIGN_QA, STORE, handoff/
└── CLAUDE.md
```

`L` = lead (you), `A` = Player Platform subagent, `B` = Creator & Games subagent.

---

## 5. The Swipe Contract (gesture arbitration)

**Problem:** the feed navigates with vertical swipes, and some games use vertical swipes or drags as input. A swipe must always go to exactly one owner, the user must always have a way out of any game, and a game must never lose an input it was promised.

**Solution:** four mechanisms. Each card has a session state, each game declares its controls in its manifest, there is a dedicated escape surface (the **Dock**), and the feed cancels game input retroactively when it claims a gesture.

### 5.1 Card session states

| State | Entered when | What the user sees |
|---|---|---|
| `LOADING` | Card mounted, WebView booting | The game's poster with a soft shimmer in the game's accent color. Never a spinner. |
| `PREVIEW` | Game called `ready()` | The game's attract/title screen, animated and alive (demo play or idle animation). Full TikTok-style overlay. |
| `PLAYING` | Game called `gameplay.start()`, which must happen on a **tap** | Overlay recedes. The tab bar morphs into the Dock. |
| `ENDED` | Game called `gameplay.end({ score })` | Result card over the game. Overlay and tab bar return. |
| `PAUSED` | App backgrounded, a sheet opened over the card, Android back pressed during play, or 20 s without any touch during play | Resume pill, overlay and tab bar visible |
| `OFFSCREEN` | Card is not the active card | Game receives `pause` and must stop its loop and audio |

### 5.2 Ownership table

The manifest flag `controls.vertical` is `true` if the game uses **any** vertical motion during play: swipes, drags, joysticks, or dragging pieces.

| Card state | `controls.vertical = false` | `controls.vertical = true` |
|---|---|---|
| `LOADING`, `PREVIEW`, `ENDED`, `PAUSED` | Vertical pan anywhere → feed. Taps and horizontal pans → game. | Same |
| `PLAYING` | A *deliberate* vertical pan anywhere → feed (stricter threshold, §5.4). Game input is cancelled when the feed claims it. | The game surface belongs entirely to the game. The feed is reachable only through the **Dock** or a **two-finger vertical swipe** (disabled if `controls.multitouch`). |
| Dock (any state) | Feed | Feed |

### 5.3 The Dock and the stable viewport

- The game viewport stays the same size for the card's whole life: full width, from the top edge of the screen to the top of the bottom bar (bottom bar = tab bar height + bottom safe area). **The game never resizes** when the state changes.
- In `LOADING`, `PREVIEW`, `ENDED` and `PAUSED`, the bottom bar is the tab bar. On entering `PLAYING` it morphs (shared-element spring, about 280 ms) into the **Dock**: a grabber pill in the center tinted with the game's accent, and mini actions on the sides (like, mute, more).
- A vertical pan that **starts on the Dock** always drives the feed: up = next, down = previous, and the card follows the finger 1:1. This mirrors the iOS home-indicator gesture, so it feels native.
- The Dock's interactive area sits fully above the home indicator / Android gesture zone so it never collides with system gestures.
- The first three times a user plays a `vertical: true` game, the Dock plays a short coach animation ("swipe here for next") with a light haptic. After that, never again.
- In `PREVIEW` the overlay covers the right action rail (about 72 pt) and the bottom-left caption. The SDK reports these areas as `insets.preview` so the title screen keeps its logo and "tap to play" clear of them. In `PLAYING`, `insets.play` is only the status bar.

### 5.4 Thresholds, cancellation, taps

- Feed pan activation in non-`PLAYING` states: |dy| ≥ 10 pt **and** |dy| ≥ 1.2·|dx|.
- In `PLAYING` with `vertical: false`: |dy| ≥ 24 pt **and** |dy| ≥ 2·|dx|.
- Starting on the Dock: |dy| ≥ 6 pt.
- Commit to the next or previous card at a displacement ≥ 20 % of the card height or a fling ≥ 700 pt/s in the same direction. Otherwise spring back. Snap springs are stiff and decisive (start around damping 26, stiffness 260 and tune by feel), and the card tracks the finger with zero lag.
- **Taps are never delayed.** The feed never waits to decide whether a touch is a tap. Games receive touches immediately, and the feed claims the gesture retroactively.
- When the feed claims a gesture, the shell sends `input.cancel`. The SDK dispatches synthetic `pointercancel` and `touchcancel` to the active targets and emits `inputCancel`, so no half-jump or half-move ever registers. The shell then sends `pause`, and `resume` if the card springs back.
- **No double-tap-to-like** on the game surface, because it would steal game input. Like lives on the action rail and the Dock.

### 5.5 Rules for game developers

The simulator flags these live and the reviewer checks them automatically.

1. A run must start with a tap anywhere, never with a swipe.
2. Declare `controls.vertical: true` if play uses any vertical motion.
3. Call `gameplay.start()` on the tap that starts a run, and `gameplay.end()` within 1 s of game over.
4. Respect `insets`: no essential UI under the overlay in attract mode.
5. On `pause`, stop the loop and all audio.

### 5.6 Implementation

- `packages/swipe-contract` is a pure, dependency-free TypeScript state machine: `(state, controls, event) → (nextState, effects[])`, plus a function that returns the gesture-owner configuration (which pans are enabled and their thresholds) for any state. The mobile app and the simulator both import it, so it is the single source of truth. Unit-test every transition and every cell of the ownership table.
- **Mobile pager:** a custom Reanimated vertical pager, not a ScrollView or FlatList. It has a fixed pool of **three card slots** (previous, current, next) whose content is recycled as the index moves, and each slot hosts one WebView.
  - A `Gesture.Pan()` on the pager reads its activation criteria from shared values derived from the state machine, so arbitration runs on the UI thread. It is composed with a `Gesture.Native()` around the WebView via `simultaneousWithExternalGesture`, so the WebView gets touches immediately and the feed claims retroactively.
  - In `PLAYING` with `vertical: true`, the surface pan is disabled through a shared value. Only the Dock pan and the two-finger pan stay active.
- **WebView hardening:** `scrollEnabled={false}`, `bounces={false}`, `overScrollMode="never"`, no pull-to-refresh. The SDK injects `touch-action:none; overscroll-behavior:none; user-select:none; -webkit-touch-callout:none` on `html, body`.
- **Spike first.** Before building anything else on mobile, prove on both iOS and Android with two throwaway WebViews (one tap game, one swipe game) that:
  - (a) taps reach the WebView with no added latency;
  - (b) the feed pan claims vertical swipes in `PREVIEW`;
  - (c) the surface pan is fully off in `PLAYING` with `vertical: true`, while the Dock still works.

  If Gesture Handler can't arbitrate over the native WebView on a platform, fall back to a transparent native overlay owned by the feed in non-`PLAYING` states that forwards taps into the game as synthesized pointer events (`input.inject` bridge message). Record which approach shipped and why.

---

## 6. Game runtime

- **Pool:** never more than 3 live WebViews. On index change, recycle the slot furthest from the current card for the new "next". On a memory warning, destroy the "previous" slot.
- **Preload:**
  - When a card becomes current, the next card's WebView loads immediately in `OFFSCREEN`: it initializes, calls `ready()` and waits paused.
  - Posters for the next 5 cards are prefetched with `expo-image`, and the entry files of the next 3 bundles are warmed in the HTTP cache.
  - Warm one hidden WebView at app start, because Android WebView cold init is slow.
- **Crossfade from poster to live only on `ready()`.** The user never sees a blank WebView. If `ready()` hasn't arrived within 8 s, show the poster with a retry affordance and log `load_failed`.
- **Security:**
  - The WebView loads only from the games origin. `originWhitelist` is restricted to it, and `onShouldStartLoadWithRequest` blocks every navigation off it.
  - No multiple windows, no file access, no `javaScriptCanOpenWindowsAutomatically`, no shared cookies (`incognito` or `sharedCookiesEnabled={false}`).
  - The game origin serves this CSP: `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'; img-src 'self' data: blob:; media-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; worker-src 'self' blob:; frame-src 'none'`. That means no remote code, no trackers and no external network.
  - A game never sees auth tokens, the real user id, email or device identifiers. Player identity in the SDK is an opaque per-game id plus display name and avatar.
  - The shell validates every bridge message with zod and rate-limits each message type. Unknown types are dropped.
- **Audio:** a global mute toggle on the Dock and in Settings, persisted. Games start muted in `PREVIEW` unless the user has unmuted globally. Set `allowsInlineMediaPlayback` and `mediaPlaybackRequiresUserAction={false}`.
- **Budgets** (enforced by the reviewer, shown live in the simulator):
  - Initial payload ≤ 3 MB gzipped. Hard cap: 15 MB total bundle.
  - `ready()` ≤ 2.5 s cold on a mid-range Android profile (Playwright: 4× CPU throttle + Fast 4G).
  - Sustained 60 fps in attract mode. No long tasks over 100 ms after `ready()`.
  - JS heap ≤ 150 MB.
- **Dev mode:** a hidden developer menu (Settings → tap the version 7 times, or automatically for creator accounts) can open a game from a LAN URL or by scanning the QR printed by `thumbcade dev --device`. These cards show a `DEV` badge and a bridge log.

---

## 7. Game SDK and manifest (contracts in `packages/protocol`)

### 7.1 SDK surface

```ts
import { thumbcade as tc } from "@thumbcade/sdk";

const ctx = await tc.init();
// ctx: LaunchContext = {
//   sdkVersion, gameId, versionId,
//   player: { id /* opaque, per game */, name, avatarUrl } | null,
//   locale, reducedMotion, audio: { muted },
//   insets: { preview: Insets, play: Insets },
//   challenge?: { fromName, score },
//   launchReason: "feed" | "gamePage" | "challenge" | "dev",
//   seed: number
// }

tc.ready();                                   // first meaningful frame painted → shell crossfades poster → live
tc.gameplay.start();                          // → PLAYING (call on the tap that starts a run)
tc.gameplay.end({ score, outcome: "lose" });  // → ENDED; shell shows the result card
tc.on("pause" | "resume" | "mute" | "unmute" | "inputCancel" | "replay" | "insets", handler);
tc.loop((dt) => { /* rAF helper that auto-stops on pause and resumes on resume */ });
tc.storage.get(key); tc.storage.set(key, json);           // ≤ 64 KB per player per game, synced server-side
tc.leaderboard.top({ scope: "daily" | "allTime" | "friends", limit });
tc.leaderboard.me();
tc.feedback("tap" | "success" | "fail" | "impact");      // semantic; the shell decides on haptics
tc.share.challenge({ score });                            // opens the shell's challenge share flow
tc.analytics.track("level_complete", { level: 3 });       // whitelisted names, rate-limited
```

- **Envelope:** `{ v: 1, id: string, type: string, payload?: unknown, replyTo?: string }` with request/response correlation by `id`.
- **Game → shell:** `hello`, `ready`, `gameplay.start`, `gameplay.end`, `storage.get`, `storage.set`, `leaderboard.top`, `leaderboard.me`, `feedback`, `share.challenge`, `analytics.track`, `log` (dev only).
- **Shell → game:** `init`, `pause`, `resume`, `mute`, `unmute`, `input.cancel`, `insets`, `replay`, plus replies.
- **Transports:** the SDK auto-detects its host.
  - RN WebView: `window.ReactNativeWebView.postMessage`, plus `injectJavaScript` dispatching a `MessageEvent`.
  - Iframe (simulator, web player): `postMessage` with strict origin checks.
  - Bare browser tab: a "standalone" in-page mock, so developers can open their game directly.
- The SDK must not ship zod. It uses small hand-written guards. The shell validates with zod schemas from `packages/protocol`.
- The shell supports the current and the previous SDK major version.

### 7.2 Manifest — `thumbcade.json`

```jsonc
{
  "$schema": "https://thumbcade.com/schema/manifest-v1.json",
  "id": "lane-rush",                    // slug, globally unique
  "name": "Lane Rush",
  "version": "1.0.0",
  "sdk": "^1.0.0",
  "entry": "index.html",
  "description": "Three lanes. Zero chill. Swipe to dodge, jump and slide.",   // ≤ 120 chars
  "tags": ["runner", "3d", "reflex"],                                            // 1–5 hashtags
  "accentColor": "#FF6A1A",
  "icon": "assets/icon.png",            // 1024×1024 — the game's profile picture
  "poster": "assets/poster.jpg",        // 1080×1920 still; auto-captured by the reviewer if omitted
  "ageRating": "9+",
  "controls": { "vertical": true, "horizontal": true, "multitouch": false, "inputs": ["swipe"] },
  "session": "short",                   // short (< 60 s) | medium (< 5 min) | long
  "audio": true,
  "orientation": "portrait",
  "score": { "order": "desc", "max": 1000000, "format": "integer" }
}
```

`packages/protocol` exports the zod schema, the generated JSON Schema (the portal serves it at the `$schema` URL), and the types `LaunchContext`, `FeedCard`, `PublishRequest` / `PublishResponse` and `GamesIndex`. `GamesIndex` is the format of `dist/games/games-index.json`, which the seed script consumes.

---

## 8. Player app (apps/mobile)

The app is dark-only in v1. Browsing needs no account: a sign-up sheet appears only when the user tries to like, comment, follow, save or submit a score.

1. **Onboarding:**
   - Animated splash (the logo button press, §12).
   - Neutral age screen (birth year → age band; never store the date of birth).
   - Optional interest picker (tag chips, skippable).
   - Straight into a running game. Time from cold start to a playable game must be under 3 s on a modern device.
2. **Home feed:**
   - Top: `Following | For You` tabs and a search icon.
   - Full-bleed game cards.
   - **Right action rail:** creator avatar with a follow "+", like (count), comment (count), save, share, and at the bottom the spinning **cartridge** (the game's icon, the analogue of TikTok's sound disc), which opens the game page.
   - **Bottom-left caption:** `@creator`, game name, expandable description, tappable `#hashtags`, and a meta line such as `▶ 1.2M plays · best 9,842`.
   - Tab bar: Home · Discover · Create (+) · Inbox · Profile.
3. **Result card** (`ENDED`): score odometer, personal best, a "NEW BEST" stamp, today's percentile, *Play again*, *Challenge a friend*, and a swipe hint.
4. **Comments sheet:**
   - Gesture-driven bottom sheet with likes on comments and one level of replies.
   - Creators can pin a comment.
   - Each comment shows the commenter's best score as a badge.
   - New comments arrive live via Supabase Realtime.
5. **Share sheet:**
   - Custom first row: *Challenge link* (embeds your score), *Copy link*, *Save share card*.
   - Then the system share sheet.
   - The share card is a rendered image with the game icon, the score and the creator.
6. **Game page** (the "sound page" analogue):
   - Big icon, name, creator, plays/likes, a *Play* button, and leaderboards (Today / All-time / Friends).
   - Description, hashtags, "More from @creator", and version notes.
   - Shared-element transition from the cartridge.
7. **Profiles** (user and creator):
   - Generative avatar or photo, handle, bio, followers and following, follow button.
   - Tabs: Games (for creators) / Liked / Saved / Best scores.
   - Grids of 9:16 poster tiles with play counts.
8. **Discover:**
   - Search across games, creators and hashtags.
   - Trending hashtags, categories (Arcade, Puzzle, Brain, 3D, Chill, Reflex), editorial rows ("New this week", "Under 30 seconds").
   - Hashtag pages show a poster grid; tapping a tile opens the feed scoped to that hashtag.
9. **Inbox:** new followers, likes and replies on your comments, "@friend beat your score on Stackd", and new games from creators you follow. Push notifications via Expo Notifications.
10. **Create (+):** Creator Hub. For players it pitches building a game ("Your game in this feed by Friday") and links to the docs and portal. For creators it shows their games, review status and today's stats.
11. **Settings:** account, sound, reduce motion, notifications, blocked users, data export, **account deletion in-app**, legal, and the hidden developer menu.
12. **Auth sheet:** Sign in with Apple, Google, email OTP.
13. **Deep links:** universal links / app links for `thumbcade.com/g/<slug>` and `thumbcade.com/c/<code>` (challenge). Each opens the feed with that game first and passes `ctx.challenge` to the game.

Use TanStack Query with **optimistic updates** for every social action, and MMKV for persisted client state.

---

## 9. Social graph, discovery and ranking

- **Events:** the client batch-uploads every few seconds and on background.
  - Types: `impression`, `ready`, `play_start`, `play_end {durationMs, score}`, `skip {dwellMs, state}`, `replay`, `like`, `unlike`, `save`, `share`, `comment`, `follow`, `open_game_page`, `load_failed`.
  - Each event carries a user id or an anonymous install id.
- **Feed ranking v1** (SQL function `rank_feed(viewer, cursor, limit)` with weights in a `feed_config` table so tuning doesn't need a deploy):
  - **Candidates:** live games, filtered by age band, blocks and recently seen games (de-duplicated within the session and over the last 24 h unless affinity is high).
  - **Score:** Bayesian-smoothed play-start rate + replay rate + like rate + share rate + tag affinity (user × hashtag weights updated from events) + follow boost + freshness decay − fast-skip rate (skip from `PREVIEW` within 1.5 s).
  - **Exploration:** every 4th slot is drawn by Thompson sampling over games with fewer than N impressions, so new games get a fair shot.
  - **Diversity:** never two consecutive cards from the same creator or the same primary tag.
  - The **Following** tab ranks games from followed creators by recency and quality.
- **Trending:** pg_cron rolls up `game_stats_daily` hourly and computes trending hashtags (velocity, not totals).
- **Leaderboards:** best score per user per game, with all-time and daily views and a friends view (mutual follows).
- **Score integrity (light):**
  - `session-start` issues a signed session token.
  - `session-end` rejects scores that exceed `manifest.score.max`, arrive with an impossible duration, or come without a token.

---

## 10. Creator platform

### 10.1 CLI and templates

| Command | What it does |
|---|---|
| `npm create thumbcade-game@latest` | Prompts for name, template (Canvas 2D · Phaser · PixiJS · Three.js · Blank HTML) and control style. Generates a Vite + TS project with the SDK wired in, a manifest, a README, and a **small but complete** sample game for that template (attract mode, start on tap, score, end, best score). Also generates a real icon and poster from the name and accent color. |
| `thumbcade dev` | Vite dev server with HMR. Opens the simulator with the game loaded. |
| `thumbcade dev --device` | Serves on the LAN and prints a QR code for the app's developer menu. |
| `thumbcade validate` | Builds, then checks the manifest schema, budgets and static rules. Fix-it messages are human-readable. |
| `thumbcade login` | Device-code flow through the portal. Stores a creator token in the OS keychain (or `~/.config/thumbcade` as fallback). |
| `thumbcade publish` | Build → validate → zip → upload to `creator-publish`. Prints the review URL. |

### 10.2 Feed simulator (apps/simulator)

This is a creator's first impression of the platform, so it must look as good as the app.

- A phone frame (6.1″ iPhone, Pro Max, mid-range Android) running the **real** feed chrome: overlay, tab bar → Dock morph, result card. It uses `packages/design-tokens` and `packages/swipe-contract`, with fake previous/next cards so swiping is real.
- **Panels:**
  - Live bridge message log and current state-machine state.
  - Contract violations, for example "run started by a swipe", "audio still playing after pause", "gameplay.end not called after 10 s of inactivity".
  - Perf HUD: FPS, long tasks, heap, time-to-ready against budget.
  - Insets overlay toggle and a mute toggle.

### 10.3 Publish pipeline

1. The `creator-publish` edge function verifies the creator token, manifest and size. It stores the bundle immutably at `games/<gameId>/<versionId>/`, creates a `game_versions` row with status `auto_checking`, and inserts a `review_jobs` row. (Polling a table is enough; no extra queue infra.)
2. `services/reviewer` claims the job and loads the build in headless Chromium at 390×844 with mid-tier throttling. It checks:
   - manifest validity and size budget;
   - a static scan for remote URLs, `eval` and network calls (CSP blocks them anyway);
   - `ready()` arriving within budget;
   - that a synthetic tap triggers `gameplay.start()`;
   - pause handling (audio and rAF stop);
   - no uncaught errors;
   - fps and long tasks.

   It writes a report with pass/fail per check, metrics, console output and 3 screenshots, and captures the poster if it is missing. The version moves to `pending_review` or `auto_failed`.
3. An admin plays the build inline in the portal and approves or rejects it with a reason. On approval the version becomes `live`, `games.live_version_id` is updated, and the game enters the feed. Creators can roll back to any earlier approved version.

### 10.4 Portal (apps/portal)

- **Public:**
  - **Landing page** as a showpiece: the hero is a live phone frame running the real feed through the web player, and visitors can swipe and play. Scroll-driven sections show the creator flow (code → simulator → feed).
  - `/g/[slug]` and `/c/[code]` share/challenge pages with a playable web version, a "Get the app" CTA and dynamic Open Graph images.
  - `/docs` (MDX):
    - quickstart
    - SDK reference
    - **the Swipe Contract explained with diagrams**
    - manifest reference
    - budgets
    - review guidelines
    - game design guidelines (attract mode, start on tap, insets, session length)
  - Serves the manifest JSON Schema.
- **Creator dashboard:**
  - Onboarding to become a creator (handle, terms).
  - Game list.
  - Metadata editor: name, icon upload with crop, description, hashtags with autocomplete, accent color with a contrast check.
  - Versions with review reports.
  - Analytics: plays per day, play-start rate, average session, replay rate, likes, shares, top hashtags.
  - API tokens for the CLI.
- **Admin** (role-gated): review queue with an inline player in a simulator frame and the reviewer report, a reports queue (games, comments, users), one-click takedown, and feature/editorial row management.
- The portal supports dark (default) and light themes.

---

## 11. Backend (supabase/)

**Tables** (all with RLS; every policy is written explicitly and tested):

| Table | Holds |
|---|---|
| `profiles` | id = auth user id, handle, display_name, avatar_url, bio, age_band, role (`user` / `creator` / `admin`), `is_seed` |
| `games` | slug, creator_id, name, description, icon_url, poster_url, accent_color, tags, age_rating, controls, status, live_version_id, denormalized counters |
| `game_versions` | semver, manifest, bundle_path, size, status, review_report, approved_by |
| `hashtags`, `game_hashtags` | Hashtags and their links to games |
| `follows`, `likes`, `saves`, `blocks` | Social graph and per-user actions |
| `comments`, `comment_likes` | parent_id for one level of replies, score badge, pinned flag, moderation status |
| `shares` | Including challenge codes and scores |
| `play_sessions` | Session token, duration, score, outcome |
| `best_scores` | Plus daily and all-time leaderboard views |
| `game_kv` | SDK storage |
| `feed_events` | Append-only, partitioned by day |
| `user_tag_affinity`, `game_stats_daily`, `feed_config` | Ranking inputs and tunable weights |
| `notifications` | Inbox items |
| `reports` | User reports for moderation |
| `review_jobs` | Queue for the reviewer service |
| `creator_tokens` | Stored hashed |

**Edge functions:**
- [A] `feed`, `events`, `session-start`, `session-end`, `notify` (fan-out + push), `challenge-resolve`, `account-delete`
- [B] `creator-publish`, `creator-review-callback`

**pg_cron jobs:** stats rollup, trending, affinity decay, stale-session cleanup.

**Seed data:**
- All launch games (from `dist/games/games-index.json`).
- An official `@thumbcade` studio account and about 6 demo creator accounts with distinct identities.
- About 40 demo users with realistic, written comments (with personality, never lorem), likes, follows and scores.
- Everything is flagged `is_seed` so it can be wiped in one command.

---

## 12. Design direction

**Concept: "midnight arcade, editorial restraint."** The games bring the color. The chrome is ink, paper and one electric accent. Take the interaction model from TikTok, the hardware-like restraint from Teenage Engineering, and the playfulness from the Nintendo Switch UI. Every surface should look designed for this product and nowhere else.

### 12.1 Tokens (`packages/design-tokens` → RN theme + CSS variables)

- **Color**
  - `ink.0 #000000` feed backdrop (OLED) · `ink.1 #0D0D10` surfaces · `ink.2 #17171C` raised · `ink.3 #24242B` lines
  - `paper #F3F0E8` primary text (warm, never pure white) · `paper.dim #A7A3AE` · `paper.mute #6E6A78`
  - `volt #D4FF3D`: the signature accent. Use it for the primary CTA, active states, your own score and focus rings, at most one volt element per region of a screen.
  - `heat #FF4A3D`: likes, hearts, live indicators.
  - `game.accent`: comes from each game's manifest. It tints the Dock grabber, caption chips, the progress line and the result card for that card only. Check contrast and fall back to `paper` below 3:1 on ink.
- **Type** (all OFL, bundled as static font files)
  - Display: **Mona Sans Expanded** (Bold/Black) for game names, screen titles and hero text.
  - UI: **Mona Sans** (Regular/Medium/SemiBold).
  - Numbers and meta: **Departure Mono** for counters, scores, ranks, hashtags and timestamps. Scores roll like an odometer.
  - Scale: 11 / 13 / 15 / 17 / 22 / 28 / 40 / 56. Tracking −2 % on display sizes, +4 % on uppercase mono labels.
- **Space and shape:** 4-pt grid. Radii: 6 (chips), 14 (sheet internals), 22 continuous-corner squircles (game icons), 999 (pills). Not everything is a rounded card.
- **Motion:** every spatial movement uses springs. Card snap is stiff and decisive, overlay recession takes 220 ms, the tab bar → Dock morph is a shared element, and sheets rubber-band. Reduce Motion swaps springs for 120 ms fades.
- **Haptics:** soft on card snap, light on like, success on a new best, medium when the result card appears. Never on every touch.
- **Icons:** draw a custom 24-pt SVG set for the core actions (home, discover, create, inbox, profile, like, comment, save, share, mute, more, search). Use a 1.75 px stroke, squared terminals, and a filled variant for the active state. Phosphor is the fallback for secondary icons only. No emoji as icons, and not the stock Lucide look.
- **Default avatars:** generative and deterministic from the user id, e.g. 8×8 symmetric pixel sprites from a curated palette. Never initials in a circle.

### 12.2 Signature moments

People screenshot these, so polish them hardest.

1. **Like burst:** a Skia particle burst in heat plus the game's accent, with a scatter of tiny pixel hearts.
2. **The cartridge:** the game's icon rotating slowly at the bottom of the action rail, with a shared-element transition into the game page.
3. **Tab bar → Dock morph** when play starts.
4. **Result card:** score odometer, a "NEW BEST" stamp in volt, the percentile, the challenge CTA.
5. **Poster → live:** a crossfade with a one-pass scanline wipe in the game's accent color.
6. **App icon and splash:** a top-down arcade button in volt whose concentric rings form a thumbprint whorl. The splash animates the press.

### 12.3 Anti-slop rules (violations are bugs)

- No purple/blue gradients, no gradient text, no glassmorphism panels, no neon glow on everything, no generic drop-shadow cards, no "centered hero + three feature cards" web layout.
- No stock component-library look (default shadcn, Material, Paper). Build components on primitives with these tokens.
- No emoji in UI, no stock illustrations, no grey placeholder boxes.
- **Copy has a voice:** short, confident, a little playful.
  - Empty saves: "Nothing saved. Hit ★ on a game you'd replay at 2am."
  - Load error: "That game tripped over a cable. Retry?"
  - Format numbers (1.2K, 3.4M) and use relative dates.
- Every screen has a designed empty state, a loading state and an error state. Loading uses skeletons in the final layout. There is never a spinner in the feed.
- Hit targets ≥ 44 pt, text contrast ≥ 4.5:1, Dynamic Type up to XL without broken layouts, VoiceOver/TalkBack labels on every control.

### 12.4 Design QA loop (mandatory, Phase 2)

1. Screenshot every screen and state:
   - iOS Simulator: `xcrun simctl io booted screenshot`
   - Android emulator: `adb exec-out screencap -p`
   - Every portal and simulator page with Playwright at 390 px and 1440 px.
2. Look at each screenshot and judge it against this section like a demanding design director.
3. Log the issues in `docs/DESIGN_QA.md`, fix them, and re-shoot.

Do at least two full passes. Keep the final screenshots in `docs/screenshots/`.

---

## 13. Launch library (games/)

| # | Name | Game | Tech | Input | `vertical` |
|---|---|---|---|---|---|
| 1 | Flapjack | One-tap flyer through gaps | Canvas 2D | tap | false |
| 2 | Stackd | 3D tower stacking, overhang slices off | Three.js | tap | false |
| 3 | Lane Rush | 3-lane endless runner: dodge, jump, slide | Three.js | 4-way swipe | **true** |
| 4 | Gambit | Chess puzzles, mate in 1–3, with a daily puzzle | DOM/Canvas + chess.js (BSD) | drag or tap-tap | **true** |
| 5 | Pairs | Timed memory card flip | DOM + CSS 3D | tap | false |
| 6 | Merge | 2048-style sliding merge | Canvas 2D | 4-way swipe | **true** |
| 7 | Snek | Snake with heavy juice | Canvas 2D | 4-way swipe | **true** |
| 8 | Slice | Slash neon fruit, avoid bombs | PixiJS | drag | **true** |
| 9 | Breakout Neo | Brick breaker with power-ups | PixiJS | horizontal drag | false |
| 10 | Helix Fall | Ball drops through a rotating helix | Three.js | horizontal drag | false |
| 11 | Reflex | Reaction-time and color-match micro rounds | Canvas 2D | tap | false |
| 12 | Mines | Minesweeper, 8×12 portrait board, long-press to flag | DOM | tap / long-press | false |

**Quality bar for every game:**
- Attract mode is alive (an AI demo or idle animation) and a run starts on a tap.
- Juice: easing, particles, screen shake and hit-stop where it fits.
- Procedural SFX via WebAudio (jsfxr-style, no samples needed). Music is optional, procedural and quiet.
- An honest difficulty curve and runs of 20–90 s.
- Best score persisted through `tc.storage`. Respects `insets` and `pause`. Passes every budget.
- Its own 1024² icon: the set reads as one cohesive family without looking samey.
- A poster, a description of ≤ 120 chars, 3–5 hashtags and an accent color.

The list deliberately mixes 2D and 3D and both values of `controls.vertical`, because the launch library is also the test suite for the Swipe Contract. Shared code goes in `games/_kit`.

`pnpm games:build` outputs all bundles, icons and posters into `dist/games/` in the layout `game-host` serves, plus `games-index.json`.

**Priority:** quality beats count. The target is 12, the minimum is 10, and every shipped game must feel finished.

---

## 14. Store compliance and safety

- **Apple guideline 4.7 (HTML5 mini apps and games):**
  - Only HTML5/JS is loaded at runtime.
  - We maintain an index of every game with metadata, filter content by age rating, offer reporting, and review every build before it goes live.
  - Games get **no native platform APIs**, only our own platform services (score, storage, lifecycle). The shell maps semantic `feedback` events to haptics itself.
  - Read the current guideline text when you implement this and log your reading in `docs/DECISIONS.md`.
  - Apple's Mini Apps Partner Program (reduced commission for in-mini-game purchases) is out of scope for v1, but don't design it out.
- **Guideline 1.2 (UGC):** report games, comments and users; block users; a comment filter (word list + rate limits); a moderation queue; one-click takedown; a published contact.
- **Guideline 4.8:** Sign in with Apple is offered alongside Google.
- **Guideline 5.1.1(v):** account deletion inside the app.
- **Age:**
  - A neutral age screen, or Apple's Declared Age Range API and Google Play's Age Signals API where available.
  - Store only an age band.
  - Filter the feed by game age rating.
- **Google Play:** JavaScript running in a WebView is allowed under the Device and Network Abuse policy. No dynamic native code.
- **Privacy:** an iOS privacy manifest via Expo config, no third-party trackers or ad SDKs, and analytics events tied only to the user id or an anonymous install id.
- **`docs/STORE.md`:**
  - store listing copy for both stores
  - age-rating questionnaire answers
  - privacy nutrition label / Data Safety answers
  - App Review notes that explain the mini-game model and how to test it

---

## 15. Execution plan

### Phase 0 — Lead, solo: contracts first

The goal is to let three streams work in parallel without talking to each other.

1. Check the toolchain: Node LTS, pnpm, Docker (for local Supabase), Xcode + iOS Simulator, Android SDK + emulator, Maestro. Log anything missing in `docs/GAPS.md` and continue.
2. Scaffold the monorepo (§4) with root scripts: `pnpm dev` (Supabase + game-host + Metro + portal + simulator), `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm seed`, `pnpm games:build`.
3. Write `packages/protocol` (§7) — every type and zod schema, the generated JSON Schema, and `GamesIndex`.
4. Write `packages/swipe-contract` (§5) with exhaustive unit tests.
5. Write `packages/design-tokens` (§12), with the fonts downloaded into the package.
6. Write `supabase/migrations/0001_init.sql` (§11): the full schema plus RLS. Start Supabase locally and confirm the migration applies.
7. Write `CLAUDE.md` (commands, conventions, ownership table, contract rules) and `docs/ARCHITECTURE.md` (with a diagram of app ↔ WebView ↔ SDK ↔ backend ↔ game host).
8. Commit.

### Phase 1 — Parallel: two subagents, plus the lead on the portal

- Launch **both subagents in a single message**: two `Agent` tool calls (called `Task` in older Claude Code versions) in the same turn, `subagent_type: "general-purpose"`, so they run concurrently.
  - Use the briefs in §16 verbatim, plus any Phase 0 decisions they need.
  - They share this working tree with disjoint ownership. Do **not** use worktree isolation.
- While they work, **you build `apps/portal`** (§10.4) against the protocol and the schema. Don't sit idle and don't duplicate their work.
- When a subagent reports back, review its work at once. Send follow-ups (SendMessage, if available) or fix things yourself.

**Contract rules during Phase 1:**
- The contracts (`packages/protocol`, `packages/swipe-contract`, `packages/design-tokens`, `0001_init.sql`) are read-only for subagents. If a contract is missing something, the subagent works around it locally with an adapter (never a fork) and writes the request to `docs/handoff/CONTRACT_REQUESTS.md`. The lead resolves these at integration.
- New migrations are allowed only for tables the agent owns, as timestamped files.
- Each subagent leaves its area green: typecheck, lint and tests pass.

### Phase 2 — Lead: integration, proof, polish

1. Review both subagents' code critically: read the code, don't trust summaries. Resolve the contract requests.
2. Prove the creator loop with `scripts/e2e-creator-loop.ts`: scaffold a game with `create-thumbcade-game` → `thumbcade publish` to local → reviewer passes → approve via the admin API → the game appears in the `feed` response for a fresh user.
3. Run all tests, the Maestro flows, and `npx expo export` for iOS and Android (this proves both bundle). Build and launch the app on the simulator and the emulator if they are available.
4. Run the Design QA loop (§12.4), at least two passes.
5. Performance soak:
   - 100 swipes across all launch games.
   - Memory stays flat, never more than 3 WebViews, no dropped frames during the snap (Perf Monitor, `adb shell dumpsys gfxinfo`).
   - Log the results in `docs/PERF.md`.
6. Write a `README.md` with a quickstart of at most 5 commands, finish the docs, and commit.

---

## 16. Subagent briefs (pass verbatim)

### Agent A — "Player Platform"

> You are the Player Platform engineer for Thumbcade, working in the current repository alongside a lead and one other agent.
>
> **Read first:**
> - `THUMBCADE_BUILD_PROMPT.md` in full; your focus is §1, §5, §6, §8, §9, §11, §12, §14.
> - `CLAUDE.md`.
> - The contracts in `packages/protocol`, `packages/swipe-contract`, `packages/design-tokens` and `supabase/migrations/0001_init.sql`. These are read-only for you; follow the contract rules in §15.
>
> **You own:** `apps/mobile`, `services/game-host`, `supabase/functions/*` except `creator-*`, new migrations for your tables, `supabase/seed.sql` and the seed scripts. Touch nothing else.
>
> **Build in this order:**
> 1. The gesture spike from §5.6 on iOS and Android. Record the outcome in `docs/DECISIONS.md`.
> 2. `services/game-host`: immutable versioned paths, the CSP from §6, strict CORS.
> 3. The feed pager: 3-slot WebView pool, preloading, poster → live crossfade, the full Swipe Contract, the Dock and the result card. Until the real SDK lands, test against fixture games in `apps/mobile/dev-fixtures/` that speak the protocol directly: one tap game and one vertical-swipe game.
> 4. Edge functions and SQL: `rank_feed`, events ingest, session start/end with score checks, notifications fan-out, challenge links, account deletion.
> 5. Every screen in §8, wired to Supabase with TanStack Query and optimistic updates, following §12 exactly. Build the signature moments in §12.2 with care.
> 6. Auth (Apple, Google, email OTP, guest mode), the age screen, report/block and deep links.
> 7. A seed script that consumes `dist/games/games-index.json` (the format is in `packages/protocol`) and produces the realistic data from §11.
> 8. Tests: hooks and utils (Vitest/jest-expo), components for overlay/Dock state rendering, and Maestro flows:
>    - cold start → a game is playing;
>    - swipe in preview;
>    - play a `vertical: true` game and leave via the Dock;
>    - like → sign-in prompt;
>    - comment;
>    - a challenge link opens its game.
>
> **Standards:** no stubs on screen, typecheck/lint/tests green, latest stable dependencies (verify with `npm view`), no AI attribution anywhere.
>
> **When done, report:**
> - what is built
> - how to run it
> - every deviation from the contracts
> - your contract requests
> - known gaps (also written to `docs/GAPS.md`)

### Agent B — "Creator & Games"

> You are the Creator & Games engineer for Thumbcade, working in the current repository alongside a lead and one other agent.
>
> **Read first:**
> - `THUMBCADE_BUILD_PROMPT.md` in full; your focus is §1, §5, §6, §7, §10, §12, §13.
> - `CLAUDE.md`.
> - The contracts in `packages/protocol`, `packages/swipe-contract`, `packages/design-tokens` and `supabase/migrations/0001_init.sql`. These are read-only for you; follow the contract rules in §15.
>
> **You own:** `packages/sdk`, `packages/cli`, `packages/create-game`, `apps/simulator`, `services/reviewer`, `supabase/functions/creator-*` and `games/**`. Touch nothing else.
>
> **Build in this order:**
> 1. `@thumbcade/sdk` (§7.1) with tests:
>    - all three transports;
>    - `input.cancel` → synthetic `pointercancel`/`touchcancel`;
>    - the injected CSS;
>    - the `loop` helper;
>    - publish-ready package metadata, types and README.
> 2. `apps/simulator` (§10.2), using `swipe-contract` and `design-tokens`. It must look as polished as the app.
> 3. `create-thumbcade-game` with all five templates, each containing a small complete game, and the `thumbcade` CLI (`dev`, `dev --device`, `validate`, `login`, `publish`).
> 4. The `creator-publish` and `creator-review-callback` edge functions, and `services/reviewer` with every automated check from §10.3, the budgets from §6 and the rules from §5.5.
> 5. The launch library (§13) in priority order 1→12, built on `games/_kit`. Every game must pass `thumbcade validate` and the reviewer. Quality beats count: the target is 12, the minimum is 10, and each one must feel finished, juicy and original.
> 6. `pnpm games:build` → `dist/games/` + `games-index.json` (the format is in `packages/protocol`).
>
> **Standards:** no stubs, typecheck/lint/tests green, latest stable dependencies (verify with `npm view`), only original or permissively licensed assets (recorded in `THIRD_PARTY.md`), no AI attribution anywhere.
>
> **When done, report:**
> - what is built
> - how to run it
> - every deviation from the contracts
> - your contract requests
> - known gaps (also written to `docs/GAPS.md`)

---

## 17. Definition of Done

- [ ] `pnpm install && pnpm dev && pnpm seed` brings up the backend, the game host, the portal, the simulator and Metro. The README documents it.
- [ ] The app runs on iOS and Android: a game is playing within 3 s of a cold start, and swiping is smooth with the next game alive on landing.
- [ ] The Swipe Contract is implemented exactly as specified, with unit tests for every transition and table cell and Maestro flows that cover it.
- [ ] ≤ 3 WebViews at all times. The 100-swipe soak shows flat memory.
- [ ] The full social layer works against local Supabase: auth, profiles, follow, like, comment (live), save, share + challenge links, discover/search/hashtags, inbox, leaderboards, report/block and account deletion.
- [ ] Ranked For You and Following feeds, with exploration and diversity.
- [ ] Creator loop proven by `scripts/e2e-creator-loop.ts`: create → dev → validate → publish → auto-review → approve → live in the feed.
- [ ] Portal: landing with a live phone, docs, creator dashboard, admin review, `/g` and `/c` pages.
- [ ] ≥ 10 polished launch games (target 12), at least 3 of them 3D, mixing both `vertical` modes, all passing the reviewer.
- [ ] Two Design QA passes done and logged, with final screenshots in `docs/screenshots/`.
- [ ] `pnpm typecheck`, `pnpm lint` and `pnpm test` are all green, and `npx expo export` succeeds for both platforms.
- [ ] `docs/STORE.md`, `docs/DECISIONS.md`, `docs/GAPS.md`, `docs/PERF.md` and `THIRD_PARTY.md` are complete.

## 18. Final report to the human

When you finish, report:

- what was built
- how to run it
- where the screenshots are
- what is verified and what isn't (be explicit)
- every known gap
- the production checklist:
  - Supabase cloud project and env vars
  - Cloudflare R2 + wildcard DNS for `*.thumbcade.gg`
  - Apple Developer + Google Play accounts
  - EAS Build/Submit
  - OAuth app credentials
  - Universal/App Links domain files
  - Apple Mini Apps Partner Program application
  - trademark filing for "Thumbcade"
