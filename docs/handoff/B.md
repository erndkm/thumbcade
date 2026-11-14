# Handoff — Creator & Games (B)

Everything stream B owns, how to run it, and the APIs other streams consume.

| Path | What |
|---|---|
| `packages/sdk` | `@thumbcade/sdk` (games), `@thumbcade/sdk/host` (iframe host), `@thumbcade/sdk/probe` (runtime instrumentation) |
| `apps/simulator` | Feed simulator (Vite + React), http://localhost:5173 |
| `packages/cli` | `thumbcade` CLI + `@thumbcade/cli/checks` + `@thumbcade/cli/vite` |
| `packages/create-game` | `create-thumbcade-game` + 5 templates |
| `supabase/functions/creator-publish`, `creator-review-callback` | Publish API + review callback (Deno) |
| `services/reviewer` | Automated review (Playwright) + `review_jobs` worker + screenshot/poster tooling |
| `games/_kit`, `games/<slug>` | Shared game kit + 56 games (12 launch, 14 added 2026-10-17, 3 on 2026-10-24, 15 on 2026-11-06, 8 on 2026-11-07, 4 on 2026-11-14) |
| `scripts/games-index.ts` | `pnpm games:build` → `dist/games/` + `games-index.json` |

## Quick commands

```bash
# SDK / host / probe
pnpm --filter @thumbcade/sdk test                  # 71 tests incl. size budget (≈6.3 KB gz)
pnpm --filter @thumbcade/sdk build                 # dist/ (index, host, probe + d.ts)

# Simulator (monorepo): lists every built launch game (games/*/dist or dist/games/*/bundle)
pnpm --filter @thumbcade/simulator dev             # http://localhost:5173  (?slug=flapjack, or ?game=<url>)
pnpm --filter @thumbcade/simulator exec tsx scripts/screenshots.ts   # design-QA screenshots (dev server running)

# CLI (build once: it bundles the prebuilt simulator)
pnpm --filter @thumbcade/cli build
node packages/cli/bin/thumbcade.js --help          # or: pnpm --filter @thumbcade/cli exec tsx src/run.ts <cmd>
TOKEN=$(pnpm --filter @thumbcade/cli dev-token mycreator | tail -1)   # local only: creator + fresh tc_ token

# create-thumbcade-game (unpublished: link the local SDK/CLI)
pnpm --filter create-thumbcade-game build
node packages/create-game/bin/create.js /tmp/my-game --name "My Game" --template canvas --yes --local "$PWD"

# Reviewer
pnpm --filter @thumbcade/reviewer review ../../games/flapjack/dist --out /tmp/review   # paths are relative to services/reviewer
pnpm --filter @thumbcade/reviewer worker            # polls review_jobs (add --once to process one job)

# Launch games
pnpm games:build                                    # turbo build + posters + games-index.json (~30 s)
npx tsx scripts/games-index.ts --review             # same, plus the full reviewer on every game (after the turbo build)
```

## 1. `@thumbcade/sdk/host` — iframe host (portal web player, admin review player, simulator, reviewer)

Workspace import (consumed as TS source like the contracts): `import { createIframeHost } from "@thumbcade/sdk/host";`
It validates inbound messages with the zod schemas from `@thumbcade/protocol` (exact `event.origin` match +
`event.source === iframe.contentWindow`, per-type rate limits from `BRIDGE_RATE_LIMITS`, unknown types and bad
payloads dropped), answers `hello` with the LaunchContext, routes requests to handlers, and logs everything.

```ts
import { createIframeHost, createLaunchContext, feedInsets, memoryHandlers, HostError } from "@thumbcade/sdk/host";

const iframe = document.querySelector("iframe")!;
// Create the host BEFORE setting iframe.src (the SDK re-sends hello every 250 ms anyway).
const host = createIframeHost({
  iframe,
  gameOrigin: new URL(card.version.entryUrl).origin,       // exact origin; never "*"
  context: (hello) => createLaunchContext({                 // object or (hello) => ctx | Promise<ctx>
    gameId: card.game.id,
    versionId: card.version.id,
    player: { id: opaquePlayerId, name: "Ines", avatarUrl: null, guest: false },
    insets: feedInsets(statusBarHeight),                    // preview: top tabs + rail + caption; play: status bar
    audio: { muted: true },
    launchReason: "gamePage",
    best: viewer.best,
    host: "web",
  }),
  handlers: {                                               // optional; defaults = memoryHandlers()
    "storage.get": async ({ key }) => ({ value: await kvGet(key) }),
    "storage.set": async ({ key, value }) => { await kvSet(key, value); return { ok: true }; },
    "leaderboard.top": async ({ scope, limit }) => ({ entries: await top(scope, limit) }),
    "leaderboard.me": async () => ({ best, rank, percentile }),
    "share.challenge": async ({ score }) => { openShare(score); return { shared: true }; },
    // throw new HostError("unauthorized", "Sign in to rank") to reply with an error
  },
  // rateLimits?: Record<string, number>   (default BRIDGE_RATE_LIMITS)
});
iframe.src = card.version.entryUrl;

host.on("ready", () => crossfadePosterToLive());
host.on("gameplay.start", ({ trigger } = {}) => dispatch({ type: "GAMEPLAY_START", trigger }));
host.on("gameplay.end", ({ score, outcome }) => dispatch({ type: "GAMEPLAY_END", score }));
host.on("feedback", ({ kind }) => haptic(kind));
host.subscribe((entry) => log.push(entry));  // { at, dir: "in"|"out", type, id, replyTo?, payload?, dropped? }

host.send("pause", { reason: "offscreen" });  // payload validated against ShellToGamePayloads (throws on mismatch)
host.send("resume");
host.send("mute"); host.send("unmute");
host.send("input.cancel");
host.send("insets", feedInsets(statusBarHeight, "play"));
host.send("replay");
host.send("input.inject", { kind: "tap", x, y }); // cross-origin web players: forward taps outside PLAYING

host.connected;   // true once the current document said hello (resets on iframe load)
host.sdkVersion;  // from hello
host.destroy();   // removes listeners
```

| Export | Use |
|---|---|
| `createLaunchContext(partial)` | Complete `LaunchContext` with defaults (`audio.muted: true`, `launchReason: "feed"`, `host: "web"`, `dailySeed: dailySeedFor()`, random `seed`). |
| `feedInsets(statusBar, current?)` | The inset set a feed card reports (preview = status bar + 44 top tabs, 72 rail, 148 caption; play = status bar only). Mirrors `layout` in design-tokens (tested). |
| `DEVICES`, `gameViewport(device)`, `FEED_LAYOUT` | Phone profiles used by the simulator/reviewer (iPhone 6.1″ 390×844, Pro Max 430×932, Android 360×800) and the game viewport (screen − 56 bottom bar − home indicator). |
| `memoryHandlers(initial?)` | In-memory storage + local "leaderboard"; `.recordScore(score, order)` feeds it. |
| `observeFrameInput(iframe, listener)` | Pointer/wheel observation inside a **same-origin** game iframe (reads the probe when present: lossless during feed drags). Cross-origin: `attached === false` → Dock/keyboard navigation. |
| `HostError(code, message)` | Throw from a handler to reply `{ ok: false, error }`. |

Wire it to the Swipe Contract: feed host events into `transition()` and execute its `send` effects with `host.send(...)`.
After every transition, send `insets` with `gestureConfigFor(phase).insets` as `current` when it changes. The
reference implementations are `apps/simulator/src/lib/sim.ts` (full feed) and `services/reviewer/src/harness/client.ts` (minimal shell).

## 2. `@thumbcade/sdk/probe` — runtime instrumentation

`PROBE_SOURCE` (a JS string) instruments rAF, Web Audio, media elements, long tasks, errors/CSP violations,
foreign requests and raw input (`onInput`, registered before any game/SDK listener). Inject it before any game
script: Playwright `addInitScript`, `injectProbe(html)` in a dev server, or `<script data-thumbcade-probe>`.
Read it with `readProbe(frameWindow)` (same origin) or `frame.evaluate(() => window.__tcProbe.snapshot())`.
Pass page-evaluate code as plain functions/strings: tsx-transpiled named inner functions get `__name` helpers.

## 3. Game SDK facts the shell relies on

Full reference: `packages/sdk/README.md` (publish-ready).

- Transport detection at import: `window.ReactNativeWebView` → RN; `window.parent !== window` → iframe; else the
  standalone mock (forced with `?tc_host=`). RN inbound: `MessageEvent` on `window` **or** `document`, `data` = envelope
  object or JSON string. Because the SDK connects at import, a `pause` sent to an offscreen preload before `init()` is honored.
- `hello` is re-sent every 250 ms with the same id until answered (no timeout in RN; iframe falls back to standalone after 5 s).
- `gameplay.start` always carries `trigger`: `swipe` if the active/last pointer sequence moved ≥ 12 px, `tap` if not,
  `key` for a key press within 1 s, `none` otherwise (e.g. after `replay`).
- `input.cancel` → synthetic `pointercancel` (pointer-capture target, else the down target) and `touchcancel` (grouped
  by target), then the rest of the gesture (moves, ups, compat mouse events, click) is swallowed at window capture.
  `input.inject {kind:"tap",x,y}` dispatches pointerdown/pointerup/click at `elementFromPoint(x, y)` (counts as a tap).
- `tc.feedback` is only sent during a run (and 1.5 s after `gameplay.end`) and never while paused. **Shell (A):** you
  may still gate haptics by phase, but no launch game can buzz from attract mode anymore.
- Insets are mirrored as CSS variables `--tc-inset-*`, `--tc-preview-inset-*`, `--tc-play-inset-*` and
  `html[data-tc-insets]`; the SDK marks `html[data-tc-insets-read]` when the game reads insets (reviewer heuristic).

## 4. Dev-card deep link (for the app's developer menu, A)

`thumbcade dev --device` serves the game on the LAN and prints a QR whose payload is

```
thumbcade://dev?url=<encodeURIComponent("http://<lan-ip>:<port>/__game/index.html")>
```

Open `url` in a DEV card (bridge log, DEV badge). The page contains the injected probe (harmless) and Vite's HMR
client; reloads on save are full page reloads of that WebView. The dev server binds `0.0.0.0` only with `--device`.

## 5. Simulator (`apps/simulator`)

- Monorepo: `pnpm --filter @thumbcade/simulator dev` → http://localhost:5173. A dev-only Vite plugin serves the
  launch games same-origin at `/__games/<slug>/` (from `dist/games/<slug>/bundle` or `games/<slug>/dist`) with the
  probe injected, and lists them at `/__thumbcade/config.json` (picker in the header). `?game=<url>` loads anything.
- `thumbcade dev` serves the **built** simulator (`packages/cli/dist/simulator`) and the creator's game on one origin.
- What it does: phone frame (3 devices), real feed chrome (top tabs, rail, caption, tab bar → Dock morph, result card,
  resume pill, poster → live scanline, FAILED retry, Dock coach for vertical games), neighbor cards so swiping is
  real, the Swipe Contract machine, the 3-slot pool (recycle/preload), sheets that suspend the card, simulated
  background / Android back / 20 s idle, the bridge log, contract violations (start by swipe, start without tap,
  loop or audio after pause, no `gameplay.end` after 10 s idle, slow ready, long tasks, low fps, heap, CSP blocks,
  off-origin requests, dropped/rate-limited messages, insets never read), and a perf HUD.
- Input: drag on the screen = finger; Alt-drag = two fingers; wheel and ↑/↓ = next/previous (click outside the phone
  first if the game has focus).
- Screenshots: `docs/screenshots/simulator/` (1440 preview/playing/ended/swipe/neighbor/paused+insets/empty, 390 views, CLI dev).

## 6. CLI (`packages/cli`)

See `packages/cli/README.md`. Endpoints default to `LOCAL_ENDPOINTS`; override with `THUMBCADE_PORTAL_URL`,
`THUMBCADE_FUNCTIONS_URL`; `THUMBCADE_TOKEN` for CI; `THUMBCADE_CONFIG_DIR` and `THUMBCADE_NO_KEYCHAIN=1` for tests.
Verified: `dev` (simulator + HMR + probe from a scaffolded project), `validate` (all 12 launch games + 5 templates),
`login --token`, device-code `login` against the portal's routes, `whoami`, `publish` (+ error paths: duplicate
version, bad token, slug owned by someone else), `publish --wait`.

## 7. Publish API (`supabase/functions/creator-*`)

- `POST /functions/v1/creator-publish` (multipart: `manifest`, `bundle` zip, `notes`) with `Authorization: Bearer tc_…`
  (or anon-key bearer + `x-thumbcade-token: tc_…`, see contract request B1). Validates token (sha256 hex lookup,
  revoked, creator role), zip (paths, ≤ 2000 files, ≤ 15 MB zipped and unzipped), manifest (schema; form and zip agree;
  entry/icon/poster present), slug ownership, duplicate semver, ≤ 20 publishes/hour/game. Creates the game on first
  publish (`in_review`, metadata from the manifest), uploads every file to `game-bundles/<slug>/<versionId>/…`,
  inserts `game_versions` (`auto_checking`, size + gzip bytes) and `review_jobs`, copies the icon (and poster) to
  `game-assets/<slug>/` as the game's profile picture on first publish. → `201 PublishResponse`.
  Pre-upload failures → `4xx { error, message, issues? }` (contract request B2).
- `GET /functions/v1/creator-publish` → `{ handle, displayName, role, games[] }`;
  `GET …?versionId=<id>` → `{ versionId, slug, semver, status, reviewUrl, reviewNotes, report: { passed, checks } | null }`.
- `POST /functions/v1/creator-review-callback` (bearer = service-role key) with `ReviewCallbackRequest`: stores the
  report, moves the version to `pending_review` / `auto_failed` (never overrides `approved`/`rejected`), closes the job,
  sets `games.poster_url` from `posterPath` when the game has none. Screenshot URLs must point under `game-assets/<slug>/`.
- Env: `SUPABASE_PUBLIC_URL` (default `http://127.0.0.1:54321`, for public storage URLs; contract request B3) and
  `PORTAL_URL` (review links: `${PORTAL_URL}/creator/games/<slug>/versions/<versionId>`).

## 8. Reviewer (`services/reviewer`)

`runReview({ dir })` → `ReviewReport` (+ screenshots `attract` (overlay areas hatched), `playing`, `ended`, and a
1080×1920 JPEG poster when the manifest has none). The bundle is served like the game host (immutable path, the §6
CSP, gzip) on 127.0.0.1; the harness (real `@thumbcade/sdk/host` + Swipe Contract machine) on localhost, so the game
is cross-origin. Chromium: 390×844, DPR 3, touch, site isolation off (throttling reaches the game frame), WebGL on
the GPU on macOS.

| Check | How |
|---|---|
| manifest, size, static_scan | `@thumbcade/cli/checks` (same rules as `thumbcade validate`): allowed file types and no native executables (`bundleFileProblem`/`executableKind` in the protocol; `creator-publish` refuses both at upload), remote loads, `eval`, WebRTC, obfuscator/packer fingerprints (fail), page navigation (warn) + gzip bytes actually requested before `ready()` |
| network | runtime off-origin requests, frame navigations included (blocked and recorded by the reviewer's routing), and WebRTC calls recorded by the probe (hooked on `RTCPeerConnection.prototype`, reported from same-origin child frames too) |
| flashes | CDP screencast of the page at 60 fps (3 s of attract mode, up to 30 s of the run) → `src/flashes.ts`: WCAG 2.3.1 general and red flashes per 10 px cell, a quarter of a 320 px field (10° at 30 cm) in the same second; more than 3 fails |
| loads, ready_budget | hello / ready under 4× CPU + Fast 4G (9 Mbps / 1.5 Mbps / 165 ms) |
| long_tasks | PerformanceObserver in the game frame, everything after `ready()` (throttled while in attract) |
| fps | rAF frames over 3 s of attract mode, unthrottled on the GPU (≥ 55, warn 45–54) |
| no_swipe_start | a 220 pt vertical swipe in attract with the feed's FEED_GESTURE_BEGIN mid-gesture; any `gameplay.start` fails |
| pause_stops_loop / _audio | DEACTIVATE (attract) and PAUSE (mid-run) through the machine; frames after pause and audible sources from the probe (unmuted session) |
| tap_starts | taps in the attract safe area; `trigger` must be `tap` |
| gameplay_end | 25 s idle, then scripted taps/swipes up to 95 s |
| no_uncaught_errors, heap, insets | page errors + probe errors/CSP; `performance.memory` (precise); insets read marker |

Worker env: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (falls back to `supabase status` locally),
`SUPABASE_FUNCTIONS_URL`, `REVIEWER_POLL_MS` (2000). Jobs are claimed with an optimistic `status=queued` update,
stale `running` jobs (15 min) are requeued, a job that crashes 3× fails the version with an explanatory report.
Screenshots → `game-assets/<slug>/reviews/<versionId>/<name>.png`, captured posters → `game-assets/<slug>/posters/<versionId>.jpg`.

### E2E creator loop (for `scripts/e2e-creator-loop.ts`)

```bash
REPO=$PWD; TMP=$(mktemp -d)
pnpm --filter @thumbcade/cli build && pnpm --filter create-thumbcade-game build
node packages/create-game/bin/create.js "$TMP/e2e-game" --name "E2E Game" --template canvas --yes --local "$REPO"
TOKEN=$(pnpm --filter @thumbcade/cli dev-token e2ecreator | tail -1)
(cd "$TMP/e2e-game" && THUMBCADE_TOKEN=$TOKEN THUMBCADE_NO_KEYCHAIN=1 npx thumbcade publish --notes "e2e")   # prints versionId
pnpm --filter @thumbcade/reviewer worker --once                     # -> pending_review
# then: rpc approve_version(versionId) as admin/service role -> the game is live in `feed`
```

Verified by hand on the local stack (scaffold → publish → worker → callback → `pending_review`, screenshots in
storage, status endpoint), then cleaned up.

## 9. Games

Rows 1–15, Laddersnap, Curlwall, Rimflare, Weavefire, Clatterlane, Rowlock, Galebell and Hotband are in the house style (Thumbcade Studio); 16–30, Brinebop, Halftune, Spotfall, Lintstorm, Pinchbake, Clackwood, Overstamp, Frostwhisk, Tumbledoodle, Lumphop, Galley Proof, Pittermoon, Saltbend, Platterbang, Snapwad, Scootpurr, Rattlepile and Scribbledelve are creator games (Lanternline excepted: its own look, published by the studio), each creator with a look of their own (see "Library expansion" in `docs/DECISIONS.md`).

| # | Game | Slug | Tech | Input | `vertical` | Accent | Creator |
|---|---|---|---|---|---|---|---|
| 1 | Flapjack | `flapjack` | Canvas 2D | tap | false | #FFB23F | thumbcade |
| 2 | Stackd | `stackd` | Three.js | tap | false | #3DE0FF | thumbcade |
| 3 | Duskrail | `duskrail` | Three.js | 4-way swipe | **true** | #FF6A1A | thumbcade |
| 4 | Kingsnare | `kingsnare` | DOM + chess.js | drag / tap-tap | **true** | #5CF2B8 | thumbcade |
| 5 | Pairs | `pairs` | DOM + CSS 3D | tap | false | #FF6FB5 | thumbcade |
| 6 | Shortwick | `shortwick` | Canvas 2D | 4-way swipe | **true** | #B48CFF | thumbcade |
| 7 | Snek | `snek` | Canvas 2D | 4-way swipe | **true** | #4DFF88 | thumbcade |
| 8 | Neon Chop | `neon-chop` | PixiJS | drag | **true** | #FF3D6E | thumbcade |
| 9 | Voltbrick | `voltbrick` | PixiJS | horizontal drag | false | #4D8DFF | thumbcade |
| 10 | Heatfall | `heatfall` | Three.js | horizontal drag | false | #FFE14D | thumbcade |
| 11 | Kneejerk | `kneejerk` | Canvas 2D | tap | false | #00E5C7 | thumbcade |
| 12 | Mines | `mines` | DOM | tap / long-press | false | #7CC4FF | thumbcade |
| 13 | Clearcut | `clearcut` | Canvas 2D | drag | **true** | #A6F23D | thumbcade |
| 14 | Spindart | `spindart` | Three.js | tap | false | #EE55FF | thumbcade |
| 15 | Six Seven | `six-seven` | Canvas 2D | tap (two thumbs) | false | #8C6CFF | thumbcade |
| 16 | Stirabout | `stirabout` | Canvas 2D (pixel art) | horizontal drag | false | #E8893C | pixelwitch |
| 17 | Bobberlight | `bobberlight` | Canvas 2D (pixel art) | tap | false | #8CC7B8 | pixelwitch |
| 18 | Foxbend | `foxbend` | Three.js (voxel, isometric) | tap | false | #F68A4A | lowpolyfox |
| 19 | Paddlefox | `paddlefox` | Three.js (voxel, isometric) | horizontal drag | false | #4FB6D9 | lowpolyfox |
| 20 | Every Square | `every-square` | Canvas 2D | tap | false | #B9432C | quietmoves |
| 21 | Unbroken | `unbroken` | Canvas 2D | drag | **true** | #B9432C | quietmoves |
| 22 | Thunkfest | `thunkfest` | Three.js (cel shaded) | tap | false | #FF4A38 | juicefactory |
| 23 | Wobble Up | `wobble-up` | Canvas 2D | horizontal drag | false | #FF7CC6 | juicefactory |
| 24 | Lanternline | `lanternline` | Canvas 2D | hold | false | #F2A65E | thumbcade |
| 25 | Squishputt | `squishputt` | Three.js (clay, 12 fps) | drag | **true** | #F2A08A | softbake |
| 26 | Doodlebow | `doodlebow` | Canvas 2D | drag | **true** | #2747B5 | marginalia |
| 27 | Leapwater | `leapwater` | Canvas 2D (riso print) | hold | false | #FF48B0 | bitbybit |
| 28 | Longhop | `longhop` | Canvas 2D (riso print) | hold | false | #FF6C2F | bitbybit |
| 29 | Pagewing | `pagewing` | Canvas 2D | hold | false | #D7392F | marginalia |
| 30 | Fair Copy | `fair-copy` | Canvas 2D | drag | **true** | #4D6584 | quietmoves |
| 31 | Laddersnap | `laddersnap` | Canvas 2D | tap | false | #7A86FF | thumbcade |
| 32 | Curlwall | `curlwall` | Three.js | flick (swipe) | **true** | #E4FF3A | thumbcade |
| 33 | Brinebop | `brinebop` | Canvas 2D | drag / tap-tap | **true** | #2ED3E6 | juicefactory |
| 34 | Rimflare | `rimflare` | Three.js | flick (swipe) | **true** | #EC1380 | thumbcade |
| 35 | Halftune | `halftune` | Canvas 2D (riso print) | tap / hold | false | #0078BF | bitbybit |
| 36 | Spotfall | `spotfall` | Canvas 2D (riso print) | drag (aim) / tap | **true** | #00873A | bitbybit |
| 37 | Lintstorm | `lintstorm` | Canvas 2D | drag (relative) | **true** | #B13DFF | juicefactory |
| 38 | Weavefire | `weavefire` | PixiJS | drag (relative) | **true** | #38FFD0 | thumbcade |
| 39 | Pinchbake | `pinchbake` | Canvas 2D (clay sprites) | horizontal drag / tap | **true** | #E86F87 | softbake |
| 40 | Clackwood | `clackwood` | Three.js (voxel, near top-down) | drag (aim + pull back) / tap | **true** | #D2C3F3 | lowpolyfox |
| 41 | Clatterlane | `clatterlane` | Three.js | flick (swipe) | **true** | #08A0F0 | thumbcade |
| 42 | Frostwhisk | `frostwhisk` | Canvas 2D (pixel art) | drag | **true** | #C6E6F5 | pixelwitch |
| 43 | Tumbledoodle | `tumbledoodle` | Canvas 2D | drag (relative) | **true** | #54BF66 | marginalia |
| 44 | Overstamp | `overstamp` | Canvas 2D | tap | false | #7D5BA6 | quietmoves |
| 45 | Rowlock | `rowlock` | Canvas 2D | tap | false | #C6AA39 | thumbcade |
| 46 | Lumphop | `lumphop` | Canvas 2D (clay sprites) | tap | false | #B8704A | softbake |
| 47 | Galley Proof | `galley-proof` | Canvas 2D | tap (on-screen keyboard) | false | #8F6A2F | quietmoves |
| 48 | Pittermoon | `pittermoon` | Canvas 2D (pixel art) | tap / horizontal swipe | false | #F2B0C0 | pixelwitch |
| 49 | Saltbend | `saltbend` | Canvas 2D (riso print) | hold | false | #00838A | bitbybit |
| 50 | Platterbang | `platterbang` | Canvas 2D | tap | false | #14A87D | juicefactory |
| 51 | Snapwad | `snapwad` | Canvas 2D + planck.js | drag (pull back, let go) | **true** | #12A4A0 | marginalia |
| 52 | Galebell | `galebell` | PixiJS | hold (two thumbs) / tap | false | #C48600 | thumbcade |
| 53 | Hotband | `hotband` | Canvas 2D | drag / tap / flick down | **true** | #C9C4B8 | thumbcade |
| 54 | Scootpurr | `scootpurr` | Canvas 2D (pixel art) | tap | false | #9B5F7C | pixelwitch |
| 55 | Rattlepile | `rattlepile` | Canvas 2D | drag (pull back or point, let go) | **true** | #3B74FF | juicefactory |
| 56 | Scribbledelve | `scribbledelve` | Canvas 2D | 4-way swipe | **true** | #E0A21B | marginalia |

All 26 pass `thumbcade validate` and the full reviewer with no failed checks (ready 0.4–1.1 s under the mid-tier
profile, 60 fps, no long tasks, 5–18 MB heap, 15–172 KB gzipped before ready; 2026-10-17); Leapwater, Longhop and
Pagewing likewise on 2026-10-24 (ready 0.75–0.77 s, 60 fps, 6–9 MB heap, 28–32 KB gzipped); Fair Copy and Laddersnap on
2026-11-06 (ready 0.89 / 0.75 s, 60 fps, 13 / 5 MB heap, 38 / 23 KB gzipped; Fair Copy's 468 KB gz dictionary loads after
`ready()`); Curlwall and Brinebop the same day (ready 1.0–1.3 / 0.77 s, 60 fps, 10 / 6 MB heap, 162 / 34 KB gzipped).
Lintstorm likewise on 2026-11-06 (ready 0.72–0.78 s, 60 fps, no long tasks, 6.5 MB heap, 36 KB gzipped, 0 flashes).
Weavefire likewise on 2026-11-06 (ready 1.27 s, 60 fps, no long tasks, 15.5 MB heap, 177 KB gzipped, 0 flashes; at most 1 a
second across a whole autoplayed run); it tests its simulation (waves, hitbox and sweeps, grazes, the chain, upgrades and
the gun level you can catch back, scoring, the Loom, determinism, pilot run lengths) and the Swipe Contract, and has a
headless `pilot`.
Rimflare likewise on 2026-11-06 (ready 1.03–1.15 s, 60 fps, no long tasks, 11–13 MB heap, 162 KB gzipped, 0 flashes; also 0
across 33 s of an autoplayed run with fire, swishes and tier-ups, `VITE_AUTOPLAY=good`); it tests its camera framing, flick
reading, aim assist (monotonic, moving-hoop lead), shot physics (swish/rim/bank/miss windows, determinism), run economy
(clock, refills, streak tiers, frenzy, buzzer beater, stages, bonus balls) and pilot bands, plus the Swipe Contract (30
tests), and has a headless `pilot`.
Clackwood likewise on 2026-11-06 (ready 0.95 s, 60 fps, no long tasks, 10.5–10.8 MB heap, 161 KB gzipped, 0 flashes; also 0
across 33 s of an autoplayed run with pots and a rack clear, `VITE_AUTOPLAY=good`); it tests its table (no ball ever leaves
the cloth unpotted, corner and side pockets, jaws, cushions), ball physics (head-on, the ghost-ball cut rule, banks and
combos, determinism), the guide against real first contacts, racks (legal layouts, escalation, cue respawn), the pilot's
planned pots, the run economy (pots, streak tiers, multi-pots, banks/combos/long pots, rack clear, scratch, clutch, cap,
drain, buzzer) and pacing, plus the Swipe Contract (27 tests), and has a headless `pilot`. Its mid-run docs shots come from
an autoplay build with `shoot.qa.json`; `pnpm --filter @thumbcade-games/clackwood icon` regenerates its iso-voxel icon.
Overstamp likewise on 2026-11-06 (ready 0.74–0.78 s, 60 fps, no long tasks, 5.6–6.1 MB heap, 29 KB gzipped, 0 flashes; at most
1 a second across 33 s of an autoplayed run with four cleared sheets, `VITE_AUTOPLAY=expert`; the idle run's bell rings after
21 s); it tests its heaps (exact slip counts, one slip per spot, upper slips resting on the layer below, mirroring, cover and
free), dealing (960 dealt sheets whose witness clears them with the real tray, the solver on small sheets and on a heap it must
refuse, the dealer's tray cap, the riffle keeping the kinds and leaving a clearable heap, determinism), the run (covered taps,
seals, the multiplier tiers and window, grouping in the tray, sheet clears with the clock waiting, the grace, the paper clip
and the end on a full tray, the early forgiveness, the clock's burn and the idle end, layers, determinism, both helpers by
hand), its pilots and the Swipe Contract (31 tests), has a headless `playtest`, and `scripts/shoot-plan.ts` writes its
`shoot.json`.
Frostwhisk likewise on 2026-11-06 (ready 0.53–0.56 s, 60 fps, no long tasks, 6.7–7.2 MB heap, 32 KB gzipped, 0 flashes; also 0
across 33 s of an autoplayed run with goals, blocks and three knockouts, `VITE_AUTOPLAY=expert`; the idle run ends after 30 s);
it tests its rink (1,500 full-speed shots with moving mallets at 1/240 and 1/30 s steps that never leave the ice and never
need the safety net, no shot passing through a mallet, swing speed to puck speed and the cap, board angles, posts and mouths,
mallet halves and corners, a pinned puck, determinism), the critters (saves, reaction time, personalities, all beatable), the
run (clock and burn, goal time, mouths, zingers, knockouts and bouts, the lost-bout penalty and its grace, comebacks, the
final seconds, the buzzer, the champion ending, drift, determinism), pilot run lengths, copy and game-over lines that fit
their plates, HUD lanes that never touch (130-188 px screens) and the Swipe Contract (37 tests), and has a headless `pilot`. Its mid-run docs shots (`frostwhisk-ladder`, `-late`) come from an
autoplay build with `shoot.qa.json`.
Clatterlane likewise on 2026-11-06 (ready 1.03–1.05 s, 60 fps, no long tasks, 9.3–10.4 MB heap, 163 KB gzipped, 0 flashes;
also 0 across 33 s of an autoplayed run with strikes and a turkey, `VITE_AUTOPLAY=expert`; the idle run's buzzer sounds after
20 s); it tests its rack and split rule, the ball's late hook, the pin solver (frame-for-frame determinism, pocket carry
against head-on splits, chain reactions, no pin ending inside another, what stands stands upright on its spot, a leave counts
only what stood, the clatter's impact count, cost per throw), flick reading (direction, speed, bow and hook sign, the ghost
finger), the aiming view on five screen shapes, the assist (monotonic end to end, tightening by rack, the pocket and the
spare's key pin, balls landing where it sends them), the run (clock, drain, cap, strikes and named chains, leaves, spares,
open frames, splits and the 7-10, bumpers, the free re-roll, glow racks, the clutch, the buzzer ball, hints), pilot run
lengths and the Swipe Contract (46 tests), and has a headless `pilot`. Its mid-run docs shots (`clatterlane-split`, `-glow`,
`-summary`) come from a `VITE_AUTOPLAY=expert` build with `shoot.qa.json` (each run draws from its own seed, so they repeat).
Tumbledoodle likewise on 2026-11-06 (ready 0.81–0.82 s, 60 fps, no long tasks, 6.4–7.1 MB heap, 37–38 KB gzipped, 0 flashes; also 0
across 33 s of an autoplayed run with feasts, tier-ups and an eraser eaten, `VITE_AUTOPLAY=good`; the idle run ends
after 34 s); it tests its sizes (the fit rule, growth inside a tier and the burst at a tier-up, every kind unlocked by its
own tier and no earlier, each eraser edible one or two tiers after it appears), swallowing (tipping in, the pull over the
rim, the swept test for a fast hole, too-big doodles that only wobble, determinism), growing and the tier cap, combos and
feasts (×2/×3/×4, the burp, dust that doesn't count), the erasers (walking in, chasing, the scrub's cost and the back-off,
rubbing out small doodles only, fleeing once you're bigger, being eaten, the next one waiting for a bigger hole), the page
drawing itself back in, the last bites and the final gulp, the starting page and the hints, pilot run lengths and skill
bands, hints that quote the real rules, and the Swipe Contract (36 tests), and has a headless `pilot`. Its mid-run docs shots (`tumbledoodle-combo`,
`-bigger`, `-late`, `-results`) come from a `VITE_AUTOPLAY=good` build with `shoot.qa.json`.
Spotfall likewise on 2026-11-06 (ready 0.73–0.77 s, 58–60 fps, no long tasks, 6–9 MB heap, 29 KB gzipped, at most 1 flash a
second; 0 across 33 s of an autoplayed run with 13-dot drops, `VITE_AUTOPLAY=good`); it tests its sheet (hex neighbours, the
press feed, wall bounces, ~800 traced shots that never pass through a dot and land touching where they stopped), the run
(press meter, warm-up, idle jam inside 25 s, pops, escalating drops, combo, specials, clean sheet, swap), its pilots and the
Swipe Contract (37 tests), has a headless `pilot`, and `scripts/shoot-plan.ts` writes its `shoot.json`.
Halftune likewise on 2026-11-06 (ready 0.75–0.77 s, 60 fps, no long tasks, 10–12 MB heap, 26 KB gzipped, at most 1 flash a
second across 30 s of an autoplayed run, `VITE_AUTOPLAY=expert`); it tests its transcriptions (every bar against its time
signature, chords, range), the chart (one tile per note, lanes, spacing, holds, the finale's speed-up, determinism), judging
(windows, timing at the touch, lane and neighbour forgiveness), lives, holds, tune clears and the encore, pilot run lengths
and the manifest (45 tests), has a headless `playtest`, and `scripts/shoot-plan.ts` writes its `shoot.json`.
Pinchbake likewise on 2026-11-06 (ready 0.76 s, 60 fps, no long tasks, 7 MB heap, 33 KB gzipped, 0 flashes); it tests its
circle solver (resting piles settle with no jitter or creep, no tunnelling, swelling merges lift the pile without throwing
it, the rising floor, determinism), the run (merges at the contact point, chains, the party cake and the showstopper, the
starter's rise and knock-back, the rim grace and spill, the opening drops, cooldown and aim), its pilots and the Swipe
Contract (31 tests), and has a headless `playtest`.
Rowlock likewise on 2026-11-06 (ready 0.76–0.80 s, 60 fps, no long tasks, 5.3–6.8 MB heap, 29 KB gzipped, 0 flashes; also 0
across 33 s of an autoplayed run with locks, double locks and filled grids, `VITE_AUTOPLAY=expert`; the idle run ends after
27 s); it tests its grid geometry and exact solution counter, the human-technique solver (last gaps, box and line singles, a key
with one digit left, never a wrong digit, the nudge always right), dealing (1,710 dealt grids across the six specs, each with
exactly one solution, filled by logic alone and graded; harder grids through a run; determinism however the work is split over
frames; today's grid the same for everyone; time per dig), the run (scoring and tiers, wrong digits that never stick and the
early grace, unit locks, double and triple locks, the spark and the lamp, filled grids and the held clock, drain and cap, the idle
end, the nudge and the pencil marks), both input orders through `Controls`, pilot run lengths and skill bands, play and attract
layouts on three phones (48 px keys at 360 px), copy that fits its plates and names no other puzzle, and the Swipe Contract
(61 tests), and has a headless `pilot`. Its mid-run docs shots (`rowlock-play`, `-locked`, `-late`, `-over`) come from a
`VITE_AUTOPLAY=expert` build with `shoot.qa.json`; `shoot.json` shoots attract, the first-run finger (`-teach`) and an idle game
over (`-idle`).
Lumphop likewise on 2026-11-06 (ready 0.76 s, 60 fps, no long tasks, 8.8 MB heap, 35 KB gzipped, 0 flashes; also 0 across 33 s of an autoplayed run with three tidied levels, `VITE_AUTOPLAY=expert`; the idle run's timer runs out after 23.6 s); it tests its rules (runs that stop at a covered lump, moves that carry as many as fit, lumps keeping their identity, uncovering, sealing only four shown alike in a full-size pot, refused and idle moves), its deals (1,200 dealt levels whose witnesses tidy them with the real rules, each plan's contents, no pot starting with three alike, escalation, determinism), the solver (small positions, covered lumps, dead ends with and without moves), the run (clock and burn, the idle end, lift, put back, re-target and nope through taps, seals and streak tiers, a late seal breaking the streak, a tidied level's refund, spare pot and still clock, the grace rewind, the spare pot stepping in, the paid rewind, the spare by hand, determinism, the attract demo), its pilots, copy and layout that fit 360-430 px phones, and the Swipe Contract (44 tests), has a headless `playtest`, and `scripts/shoot-plan.ts` writes its `shoot.json`; its late-level docs shot (`lumphop-late`) comes from a `VITE_AUTOPLAY=expert` build with `shoot.qa.json`.
Galley Proof likewise on 2026-11-06 (ready 0.76-0.83 s, 60 fps, no long tasks, 8.2-11.9 MB heap, 35 KB gzipped before ready, its 20 KB gz guess list after; 0 flashes, and at most 1 a second across 33 s of an autoplayed run, `VITE_AUTOPLAY=expert`; the idle run's bell rings after 23 s); it tests its marking (every duplicate-letter case, the keyboard's best marks, marks as text), its word lists (five letters, sorted, every answer accepted, the packed search, no blocked, soft or hand-excluded answer, no plain plurals or inflections) and today's word (the same all day and a day either side, the shell's seed, no repeat in 900 days, a stray seed), the run (gap typing and whole-word typing over the known places, unknown and waiting words, first-time rings and letters, solves by lines, the shrinking refund, misses, the named tiers, the pencil, the clock's burn, pauses and idle end, the bell, today's slip first, determinism), pilot run lengths and skill bands, the attract pilot keeping today's word unspoken, the keyboard's hit areas and dead band on four screen sizes, every summary line, message and note against Instrument Serif's own metrics on a 360 pt phone, and the Swipe Contract (56 tests), and has a headless `playtest`. `scripts/shoot-plan.ts` writes its `shoot.json` for the day it is run (today's word comes first).
Pittermoon likewise on 2026-11-07: ready 0.55–0.69 s, 60 fps, no long tasks, 5.8–13.2 MB heap, 35 KB gzipped (113 KB total), 0 flashes, and 0 across 33 s of an autoplayed expert run (`VITE_AUTOPLAY=expert`). The idle run ends 19 s in. It has 49 tests:
- the hill: determinism, the doorstep, an arch every 25 rows, at most four lanes without safe ground, things in the way kept apart and no dead ends, clear cells above toadstools and above a brook's edges, the toadstool wave (a neighbour always up when one sinks, half the caps up at any moment), street gaps the cat fits through (seam included), seamless loops past the widest screen, hitboxes, fish and moonfish placement, opposite fast lanes, speed-up;
- solvability: every one of 433 lane groups crossed by a perfect player from three arrival times, and a perfect-timing pilot climbing 160 rows of eight seeds;
- input: crouch on press, hop on release, a cancelled press never moves the cat, sidesteps and bumps, the kept tap;
- bumps: knock-back to safe ground, daze and grace, the deferred bump and its escape, the brook (riding, scrambling, splashing, the edge), the bog;
- the economy: rows × tier, zoomies tiers and cooling, whisker-close, fish and the broom ride, stretches and milestones, the best row;
- first light: grace, speed-up, the idle end, the leash, the fumble and its 12 s grace, the end;
- determinism, pilot run-length bands and skill ordering, copy and banners that fit their plates (chunky glyph coverage included), HUD lanes on 130–205 px screens, and the Swipe Contract.
Saltbend likewise on 2026-11-07 (ready 0.75 s, 60 fps, no long tasks, 7.4-10.5 MB heap, 34 KB gzipped, 0 flashes; also 0
across 33 s of an autoplayed expert run and at most 1 a second across 33 s of an autoplayed night run, `VITE_AUTOPLAY=expert`
with `VITE_WARP=78`; 60 fps across 30 s of autoplayed play at 4× CPU throttle; the reviewer's script reaches
`gameplay.end` after 39 s); it tests its road (one continuous ribbon, never turning south or touching itself over 5 km on 24
seeds, projection back to the exact distance and offset, the warm-up and the open bends before the first gate, tightening
with distance, every gate on a straight, lemons on the inside line, the bend a press swings into, determinism), the hold
(into the bend ahead either way and fixed for the press, a little tighter than the bend and never past the cap, tucking to
the inside, straightening up both ways, the warm-up driving itself), lines and the streak (grades by the gap, tiers at
2/5/9/14, every line paid times the multiplier with the streak counted and ended by a wide line or the gravel, drift banked
on letting go and spilled on the gravel), the edges (the gravel's slowdown and scrape, a crash without a crate and a save
with one on both sides, wide vs inside), the run (a point a metre, speed, gate crates only after a clean line, lemons,
determinism and the same result at 30/60/120 Hz, idle runs ending on their own), pilot run lengths in their bands, the
first-run coach, copy that fits its plates (tips, the stat line, banners, the title card, measured with Jost's real
advance widths) and the Swipe Contract (44 tests), and has a headless `pilot`. `scripts/shoot-plan.ts` writes its
`shoot.json`; its mid-run docs shots (`saltbend-gate`, `-ribbon`, `-save`, `-night`) come from `scripts/qa-shots.sh`
(expert autoplay builds warped to fixed seconds).
Platterbang likewise on 2026-11-06 (ready 0.76-0.80 s, 60 fps, no long tasks, 7.3-8.7 MB heap, 40 KB gzipped, 0 red flashes and at most 1 flash a second; also across 33 s of an autoplayed run with smashes, tier-ups and cleared walls, `VITE_AUTOPLAY=expert`; the idle run ends at closing time after 21.8 s); it tests its dish shapes (exact distances, outlines, closed-form masses against a fine grid, hanging poses with the weight straight below the peg), the wall (pegs a multiple of three, inside their dish and a finger apart, same-layer dishes apart, every hanging pose on the wall, no peg within 0.07 units of a covering edge in any pose, the cover table, growth by wall, determinism), the swing (pinned dishes never move, every dish settles from every peg exactly into the dealer's pose and never creeps, the pivot holds, swings die down, drops keep their spin and land on the counter, determinism), dealing (480 witnesses through the count rules, 240 through the real run with real swings, the count rules against a peg-by-peg simulation, the solver on dealt walls and on a wall it must refuse, the dealer's shelf cap, stepwise dealing equal to dealing at once), the run (covered taps, jars and the shelf, swings and drops, shipping and docking, the early forgiveness, the grace, the magnet and the end on a full shelf, the rushed jar, the magnet by hand, multiplier tiers and the spare cup, the clock's burn and the idle end, cleared walls and the magnet every second wall, determinism with dealing ahead of time), pilot run lengths and bands, copy that fits its plates (Bungee measured in Chromium) and the Swipe Contract (52 tests), and has a headless `pilot`. `scripts/shoot-plan.ts` writes its `shoot.json`; its `platterbang-late` shot comes from a `VITE_AUTOPLAY=expert` build with `shoot.qa.json`.
Snapwad likewise on 2026-11-07 (ready 0.90-0.93 s, 60 fps, no long tasks, 8.3-10.9 MB heap, 83 KB gzipped before ready, 0 flashes; also 0 across 33 s of an autoplayed expert run with chains, snapped pencils and cleared pages, `VITE_AUTOPLAY=expert`; the idle run ends after 20.6 s); it tests its physics (every page's fort standing exactly still and asleep after settling, no doodle knocked out by a page standing there, no tunnelling through a pencil edge-on or a ruler from above at full pull and at three times that, pencils snapping into halves that keep their motion, direct hits that knock out and nudges that don't, the stepped flight matching the preview, determinism), the pages (every piece on its books, inside the page and below the HUD, no overlaps across 30 pages × 40 seeds, escalation in doodles, hidden doodles, size and piles, one new desk thing a page, determinism), the run (aiming and the cancel zone, reload, a pull let go while the page draws, the direct-hit refund, the knock-out meter, chain refunds and names, the big topple, the cap, one-shot pages and the tape ball, the star and the ruler, idle drains and the idle end, the ending after the last wad settles, a whole scripted run to the bit, the hints), pilot run lengths and skill bands with random swipes ending inside 95 s, copy that fits its plates on a 360 px phone (Caveat advance widths), and the Swipe Contract (40 tests), and has a headless `pilot`. Its mid-run docs shots (`snapwad-clear`, `-aim`, `-topple`, `-late`, `-results`) come from a `VITE_AUTOPLAY=good` build with `shoot.qa.json`.
Galebell likewise on 2026-11-07 (ready 1.18-1.20 s, 60 fps, no long tasks, 9.7-11.2 MB heap, 172 KB gzipped before ready, 0 flashes; also 0 across 33 s of an autoplayed expert run, `VITE_AUTOPLAY=expert`; the reviewer's idle run ended 34.8-38.9 s in, after its random taps had begun at 25 s; `thumbcade validate`: 886 KB total, 428 KB gzipped). It tests (51 tests):
- the table: 1,500 full-speed shots at 1/480 s with the flippers swinging and at 1/60 s with them parked, whose centre never crosses a wall's centreline or sinks into a rubber, with the safety net never acting; 900 full-speed shots at a swinging flipper that never pass through; riding drift under 0.15 units; the rubber's lever; flips from rest; cradles on both sides; the tap pass; no dead spots in 400 random drops; the plunger and the one-way gate; buoy and breakwater kicks; determinism;
- the run: the plunger and the tide, the first ball never lost inside 10 s, the idle run ending inside 20-35 s, random taps ending it inside 95 s, the lifeboat and its flip rule, three balls, the storm ladder and its multiplier and speed, the extra ball at STORM, the speed creep and cap, flags → locks → high tide → jackpots → super through real physics, the tide going out, full orbits only, combos, lamp lanes and the lane shift, the gold buoy, the cradle slip, determinism;
- pilot run-length bands; the cradle aim table; copy that fits its plates, and hints from the run;
- two-thumb input; and the Swipe Contract against the shipped manifest (multitouch, no two-finger escape, the Dock and a deliberate swipe still work).
Hotband likewise on 2026-11-14 (ready 0.71-0.72 s, 60 fps, no task over 50 ms, 8.7-8.9 MB heap, 24 KB gzipped before ready, 0 flashes and 0 red flashes; also 0 across 33 s of an autoplayed expert run, `VITE_AUTOPLAY=expert`; the idle run ends without input after 21.8 s; `thumbcade validate`: 236 KB total, 190 KB gzipped). It tests (65 tests):
- the pieces (the set of seven and no other, four quarter turns back to the start, segments edge to edge, poses, the mirror pair, where a piece arrives) and the grid (walls, floor and lit segments, the straight drop, placing, full rows and what drops when they go, noise from the floor, band heights, covered gaps, a clipped and a dark meter);
- the run: the opening pieces and the bag of nine, slides to the walls, turns with their sidesteps and a turn with no room, the slam and its points, fall speed by level and under a pull, the lock delay and its limit, cuts of one, two and three rows, the red and noise bonuses, silence, gain tiers and the one-piece grace, levels by rows and by time, the noise floor's warning, schedule and dark band, a piece lifted with the stack, clipping, the breaker (a played run tripped, an untouched one not), the idle end inside 10-24 s over 30 seeds, random flailing ending inside 70 s over 60 seeds, and the same run at 30, 60 and 120 frames a second;
- one thumb (`test/gesture.test.ts`): tap, tap that wandered or lingered, drag there and back, the slop, the wall, the flick and the rest of its touch, a sideways swipe with drift, the slow pull, a new piece under a held thumb, a cancelled touch;
- pilots (what they prefer, every resting place of a piece, the demo player, run-length bands and their order, rewards per skill), the layout on three phones (the meter, the HUD's lanes, the attract screen inside the preview insets, the game-over panel), copy (the hint picked, hints quoting the real rules and fitting the panel, the game-over lines, banner lengths, no other game named) and the Swipe Contract against the shipped manifest (the flick never reaches the feed in PLAYING; the Dock and a two-finger swipe do).
It has a headless `pilot`. Its docs shots: `shoot.json` (attract, `-teach`, `-idle`) from the normal build, `shoot.qa.json` (`-play`, `-chain`, `-late`, `-over`) from a `VITE_AUTOPLAY=expert` build.
Scootpurr likewise on 2026-11-14 (ready 0.49-0.52 s, 60 fps, no task over 50 ms, 5.2-5.5 MB heap, 24 KB gzipped before ready, 0 flashes and 0 red flashes; also 0 across 33 s of an autoplayed expert run, after which the heap was 13.7 MB; the idle run ends without input after 16.4 s; `thumbcade validate`: 83 KB total, 30 KB gzipped). It tests (42 tests):
- the rug: where a cat lies, what is ahead of it (free squares, the edge, a cat, a basket), who can go, the rounds a rug takes and a rug that cannot be cleared;
- dealing: 1,050 dealt rugs (150 per level) inside their edges with nothing overlapping and baskets off the rim, each cleared by its witness without a bump and the witch's cat last, 420 more cleared in random order, no cat facing a basket, somebody always able to go first, the cats and the rounds asked for, the first rug, the same seed dealing the same rug, a deal under 40 ms;
- the run: a clear tap and what it pays, a bump (stays, ends the streak, costs candle, at most once in 0.6 s, cheap in the first ten seconds so no run ends there), purr tiers, a cleared rug's pay with the clean and witch's-cat-last bonuses, the held candle and the next rug, the cap and the shrinking refund, the idle end inside 14-21 s, random tapping ending inside 70 s over 60 seeds, determinism and rugs that depend only on the seed and their number;
- pilots (the demo never bumps and keeps the witch's cat for last, run-length bands and their order, rewards per skill), the layout on three phones in art pixels (every rug under the HUD and the hearth, 44 pt squares, the demo rugs inside the preview insets, the HUD's lanes), copy (the tip picked, every tip and game-over line inside its 74 px panel, plates and banners, chunky glyph coverage, no other game named), the sprites (cat sizes for one to three squares in five poses, the head at the front, the paws and the flattened ears, five coats in the palette, the other maps) and the Swipe Contract against the shipped manifest (tap only; the feed keeps a deliberate swipe in PLAYING).
It has a headless `pilot` and `pnpm --filter @thumbcade-games/scootpurr icon`. Its docs shots: `shoot.json` (attract, `-teach`, `-idle`) from the normal build, `shoot.qa.json` (`-play`, `-tangle`, `-clear`, `-over`) from a `VITE_AUTOPLAY=good` build.

Rattlepile likewise on 2026-11-14 (ready 0.71-0.73 s, 60 fps, no long tasks, 5.5-5.6 MB heap, 28 KB gzipped before ready, at most 1 flash a second and 0 red; 0 flashes across 33 s of an autoplayed expert run, `VITE_AUTOPLAY=expert`, 6.5 MB heap, whose `gameplay.end` arrived after 80.9 s with the score the headless replay predicted; the reviewer's idle run ended by itself after 17.5 s; `thumbcade validate`: 292 KB total, 242 KB gzipped). It tests (37 tests):
- the mat: over 50,000 ticks of marbles against thick piles that never leave the mat, never sit inside a block and never overlap one; speed kept through every bounce; a head-on knock; two blocks side by side as one flat face (a marble on the seam bounces straight back); a lone corner deflecting; the flattest shots still landing, every marble fired and landed; the two speed-ups and the recall; the guide against the real first marble; the cannon staying on the mat; the aim limits; determinism and the same run at 30, 60 and 120 frames a second;
- the pile: the opening three rows, every row with a gap, 2-6 blocks, at most one +1 and one zapper, numbers that grow; the run ending only when a block is on the last row as the pile comes down;
- the run: a point a knock, smashes paying by their place in the chain up to the cap, knocks conserved, the close call, the streak tiers and a dud volley, +1 rings and the bag's cap, the zapper, the creep (once after 7 s, then every 1.9 s, ending a streak; never in the demo);
- reading the thumb (`test/aim.test.ts`): taps, pulling back, pointing, the lock, the cancel zone;
- pilots: nobody out inside 20 s, the idle end inside 14-23 s, run-length bands, score and rows ordered by skill; and the Swipe Contract against the shipped manifest.

It has a headless `pilot` and `scripts/shoot-plan.ts`, which replays the harness seed's expert run and writes `shoot.qa.json` (`rattlepile-rattle`, `-streak`, `-late`, `-over`, from a `VITE_AUTOPLAY=expert` build made outside the package); `shoot.json` shoots `-attract`, `-teach`, `-play` and `-idle` from the normal build. `pnpm --filter @thumbcade-games/rattlepile icon` regenerates its icon.

Scribbledelve likewise on 2026-11-14 (ready 0.75-0.76 s, 60 fps, no long tasks, 5.3 MB heap, 29 KB gzipped before ready, 0 flashes; also 0 across 33 s of an autoplayed expert run, `VITE_AUTOPLAY=expert`, 5.9 MB heap and no long task through two floor changes, whose `gameplay.end` arrived after 78.8 s with the score the headless replay predicted; the reviewer's idle run ended by itself after 22.8 s; `thumbcade validate`: 252 KB total, 194 KB gzipped). It tests (46 tests):
- the map: 400 mazes that are connected, with no dead ends, no gaps off the sheet, no open 2 × 2 room and six or more loops; the start, the holes and the two swords well apart; one maze a seed; step counts through gaps only;
- the knight: never crossing a pen line or leaving the sheet (nor a scribble) under random steering; setting off at once, bonking into a line, the buffered turn and its expiry, doubling back on the spot, the late turn and a too-late one, no steering outside play;
- coins: the reach, once each, the streak tiers and the gap, a full floor's coins and swords, the cleared floor (bonus, fresh maze, grace, the heart back on even floors);
- the scribbles: escalation by floor, being drawn in one after another, never turning back on themselves while hunting, catching an idle knight (the pause, the reset, the grace, three catches ending the run), the grace itself, the close shave;
- the sword: scribbles turning tail, 200 then 400, the redraw at the hole, running out, running away, a wasted sword;
- whole runs: the score equal to the sum of what the events paid, the gold star (once a floor, on an empty square far away, not staying), determinism and the same run at 30, 60 and 120 frames a second;
- reading the thumb (`test/swipe.test.ts`), the copy (line lengths, lowercase, no other game named, nine hints each reachable), pilots (nobody steering out inside 12 s, the idle end, random swipes ending inside the reviewer's window, run-length bands, score and floors ordered by skill, every scribble catching somebody) and the Swipe Contract against the shipped manifest.

It has a headless `pilot` and `scripts/shoot-plan.ts`, which replays the harness seed's expert run and writes `shoot.qa.json` (`scribbledelve-streak`, `-sword`, `-poof`, `-floor2`, `-late`, `-over`, from a `VITE_AUTOPLAY=expert` build made outside the package); `shoot.json` shoots `-attract`, `-teach`, `-play` and `-idle` from the normal build.
Fair Copy and Laddersnap have unit tests for their boards, dictionary filtering, solver and scoring
(`pnpm --filter @thumbcade-games/<slug> test`) and a headless `playtest` script; Curlwall tests its ball flight, curl,
aim assist, keeper and economy plus the Swipe Contract (`test/contract.test.ts`), Brinebop its board (matches,
specials, combos, cascades, dead boards and reshuffles), run (clock, frenzy, cash-out) and pilots, and both have a
headless pilot (`pilot` / `playtest`). Brinebop's `shoot.json` is written by `scripts/shoot-plan.ts`. Screenshots (attract + mid-run):
`docs/screenshots/games/`. Adding a game: copy the shape of `games/flapjack` (package `@thumbcade-games/<slug>`,
`vite.config.ts` → `defineGame()`, `thumbcade.json`, `art/icon.svg`, `shoot.json`), use `@thumbcade-games/kit`
(`createSession` for the run lifecycle, `createAudio`, particles, shake, recognizers, fonts), and assign a creator in
`scripts/games-index.ts`. `pnpm --filter @thumbcade/reviewer shoot ../../games/<slug>/dist --actions ../../games/<slug>/shoot.json --out ../../docs/screenshots/games`.
A game by a creator other than the studio must not look like the house: it imports only the kit's non-visual
modules by subpath (`kit/session`, `kit/audio`, `kit/input`, `kit/particles`, …; never the package root, `kit/ui` or
`kit/fonts`) and loads a library font (`games/_kit/assets/fonts/library/`, `pnpm --filter @thumbcade-games/kit
fonts:library`) through `kit/font-faces`; the kit plugin adds its `licenses/OFL-<family>.txt`.

## 10. Tests

| Package | Tests |
|---|---|
| sdk | 71: transports (RN/iframe/standalone), input.cancel → pointercancel/touchcancel + swallowing, injected CSS, loop, requests/errors, feedback gating, standalone HUD, host validation/rate limits/handlers, probe, contract parity (types + constants), ≤ 8 KB gz |
| cli | 20: bundle checks (manifest, assets, budgets, static scan), credentials store, zip, device link, entry, Vite plugin |
| create-game | 11: slugs/accents, every template scaffolds a complete valid project with real 1024²/1080×1920 art |
| simulator | 8: controller in happy-dom with a fake frame + probe (handshake, retroactive claim, spring-back, vertical games + Dock, violations, result card, sheets) |
| reviewer | 4: static server (CSP/gzip/paths), full Playwright review of a good and a deliberately bad fixture game |
| kit | 17: rng, easing/springs, particles, shake/hit-stop, counter, colors, recognizers |
| kingsnare | 65: every puzzle verified with chess.js (unique mating move, forced mate, legal position) |

## Status

- [x] SDK + host + probe
- [x] Simulator
- [x] create-thumbcade-game (5 templates) + CLI (dev, dev --device, validate, login, publish, whoami, logout)
- [x] creator-publish / creator-review-callback + reviewer (all §10.3 checks, §6 budgets, §5.5 rules) + worker
- [x] 12 launch games + `pnpm games:build` (bundles, icons, posters, games-index.json)
