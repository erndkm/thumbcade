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
| `games/_kit`, `games/<slug>` | Shared game kit + 12 launch games |
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
| manifest, size, static_scan | `@thumbcade/cli/checks` (same rules as `thumbcade validate`) + gzip bytes actually requested before `ready()` + runtime off-origin requests (blocked and recorded) |
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

## 9. Launch games

| # | Game | Slug | Tech | Input | `vertical` | Accent | Creator |
|---|---|---|---|---|---|---|---|
| 1 | Flapjack | `flapjack` | Canvas 2D | tap | false | #FFB23F | thumbcade |
| 2 | Stackd | `stackd` | Three.js | tap | false | #3DE0FF | lowpolyfox |
| 3 | Lane Rush | `lane-rush` | Three.js | 4-way swipe | **true** | #FF6A1A | thumbcade |
| 4 | Gambit | `gambit` | DOM + chess.js | drag / tap-tap | **true** | #5CF2B8 | quietmoves |
| 5 | Pairs | `pairs` | DOM + CSS 3D | tap | false | #FF6FB5 | pixelwitch |
| 6 | Merge | `merge` | Canvas 2D | 4-way swipe | **true** | #B48CFF | pixelwitch |
| 7 | Snek | `snek` | Canvas 2D | 4-way swipe | **true** | #4DFF88 | bitbybit |
| 8 | Slice | `slice` | PixiJS | drag | **true** | #FF3D6E | juicefactory |
| 9 | Breakout Neo | `breakout-neo` | PixiJS | horizontal drag | false | #4D8DFF | juicefactory |
| 10 | Helix Fall | `helix-fall` | Three.js | horizontal drag | false | #FFE14D | lowpolyfox |
| 11 | Reflex | `reflex` | Canvas 2D | tap | false | #00E5C7 | bitbybit |
| 12 | Mines | `mines` | DOM | tap / long-press | false | #7CC4FF | quietmoves |

All 12 pass `thumbcade validate` and the full reviewer with no failed checks (ready 0.7–1.2 s under the mid-tier
profile, 60 fps, no long tasks, 4–13 MB heap, 15–152 KB gzipped before ready). Screenshots (attract + mid-run):
`docs/screenshots/games/`. Adding a game: copy the shape of `games/flapjack` (package `@thumbcade-games/<slug>`,
`vite.config.ts` → `defineGame()`, `thumbcade.json`, `art/icon.svg`, `shoot.json`), use `@thumbcade-games/kit`
(`createSession` for the run lifecycle, `createAudio`, particles, shake, recognizers, fonts), and assign a creator in
`scripts/games-index.ts`. `pnpm --filter @thumbcade/reviewer shoot ../../games/<slug>/dist --actions ../../games/<slug>/shoot.json --out ../../docs/screenshots/games`.

## 10. Tests

| Package | Tests |
|---|---|
| sdk | 71: transports (RN/iframe/standalone), input.cancel → pointercancel/touchcancel + swallowing, injected CSS, loop, requests/errors, feedback gating, standalone HUD, host validation/rate limits/handlers, probe, contract parity (types + constants), ≤ 8 KB gz |
| cli | 20: bundle checks (manifest, assets, budgets, static scan), credentials store, zip, device link, entry, Vite plugin |
| create-game | 11: slugs/accents, every template scaffolds a complete valid project with real 1024²/1080×1920 art |
| simulator | 8: controller in happy-dom with a fake frame + probe (handshake, retroactive claim, spring-back, vertical games + Dock, violations, result card, sheets) |
| reviewer | 4: static server (CSP/gzip/paths), full Playwright review of a good and a deliberately bad fixture game |
| kit | 17: rng, easing/springs, particles, shake/hit-stop, counter, colors, recognizers |
| gambit | 65: every puzzle verified with chess.js (unique mating move, forced mate, legal position) |

## Status

- [x] SDK + host + probe
- [x] Simulator
- [x] create-thumbcade-game (5 templates) + CLI (dev, dev --device, validate, login, publish, whoami, logout)
- [x] creator-publish / creator-review-callback + reviewer (all §10.3 checks, §6 budgets, §5.5 rules) + worker
- [x] 12 launch games + `pnpm games:build` (bundles, icons, posters, games-index.json)
