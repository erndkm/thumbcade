# @thumbcade/sdk

The only API a Thumbcade game ever sees. Zero dependencies, ESM, about 6 KB gzipped.

Thumbcade is a vertical feed of playable HTML5 games. Your game runs full-screen in a WebView (or an
iframe on the web), next to other games, and the player can swipe away at any moment. The SDK tells
you when you're on screen, when to stop, and how much of the screen is covered by the feed's chrome,
and it lets you save a best score and report the end of a run.

```bash
npm create thumbcade-game@latest   # scaffolds a game with the SDK wired in
# or, in an existing project
npm install @thumbcade/sdk
```

## The whole lifecycle in 20 lines

```ts
import { thumbcade as tc } from "@thumbcade/sdk";

const ctx = await tc.init();               // LaunchContext: player, insets, audio, seed, best…
let best = (await tc.storage.get<number>("best")) ?? 0;

drawTitleScreen(ctx.insets.preview);       // keep logo + "tap to play" clear of the overlay
tc.ready();                                // first frame is on screen: the poster crossfades to you

canvas.addEventListener("pointerup", () => {
  if (state !== "title") return;
  state = "playing";
  tc.gameplay.start();                     // on the TAP that starts a run, never on a swipe
});

tc.loop((dt) => {                          // stops by itself on pause, resumes on resume
  update(dt);
  render();
  if (state === "playing" && dead) {
    state = "over";
    tc.gameplay.end({ score, outcome: "lose" });   // within 1 s of game over
    if (score > best) tc.storage.set("best", (best = score));
  }
});

tc.on("pause", () => audio.suspend());     // stop ALL audio on pause
tc.on("resume", () => audio.resume());
tc.on("replay", () => restartRun());       // "Play again" on the result card
```

## API

| Call | What it does |
|---|---|
| `tc.init(options?)` | Connects to the host and resolves with the `LaunchContext`. Call once at boot; repeated calls return the same promise. `options.manifestId` helps the standalone host. |
| `tc.ready()` | Your first meaningful frame is painted. The shell crossfades from your poster to the live game. |
| `tc.gameplay.start()` | A run starts. Call it on the tap that starts the run. The SDK reports whether that input was a tap or a swipe. |
| `tc.gameplay.end({ score, outcome?, stats? })` | The run is over. The shell shows the result card. `outcome`: `"win" \| "lose" \| "quit"`. |
| `tc.on(event, handler)` | `pause`, `resume`, `mute`, `unmute`, `inputCancel`, `replay`, `insets`. Returns an unsubscribe function. |
| `tc.loop((dt, time) => …, { maxDt? })` | `requestAnimationFrame` loop that stops while paused. `dt` is in **seconds**, 0 on the first frame and after a resume, clamped to `maxDt` (default 0.1). Returns `{ start(), stop(), running }`. |
| `tc.storage.get(key)` / `tc.storage.set(key, json)` | Per player, per game, synced server-side. Keys: `A-Za-z0-9_.:-`, up to 64 chars. Values: JSON, up to 16 KB each, 64 KB per game. |
| `tc.leaderboard.top({ scope, limit })` | `scope`: `"daily" \| "allTime" \| "friends"`. Resolves with `{ rank, name, avatarUrl, score, isMe }[]`. |
| `tc.leaderboard.me()` | `{ best, rank, percentile }`. |
| `tc.feedback(kind)` | `"tap" \| "success" \| "fail" \| "impact"`. Semantic: the shell decides on haptics. Only delivered during a run (and for 1.5 s after `gameplay.end`) and never while paused, so attract-mode demos can't buzz someone scrolling past. |
| `tc.share.challenge({ score })` | Opens the challenge share flow ("I scored 412, beat me"). Resolves with `{ shared }`. |
| `tc.analytics.track(name, props?)` | Whitelisted names only: `level_start`, `level_complete`, `level_fail`, `tutorial_complete`, `powerup_used`, `milestone`. Max 10 per second. |
| `tc.log(level, ...args)` | Shows up in the simulator's console. Silent in production. |
| `tc.context`, `tc.insets`, `tc.paused`, `tc.muted`, `tc.host` | Current state. `tc.insets` is the inset rectangle that applies right now. |

Request methods reject with a `ThumbcadeError` (`err.code`: `invalid`, `rate_limited`, `unauthorized`,
`quota`, `unavailable`, `unknown`). Guests can play but their scores are not ranked, so always handle a
rejected leaderboard call.

### LaunchContext

```ts
{
  sdkVersion, gameId, versionId,
  player: { id /* opaque, per game */, name, avatarUrl, guest } | null,
  locale, reducedMotion,
  audio: { muted },                       // start silent when true
  insets: { preview: Insets, play: Insets, current: "preview" | "play" },
  challenge?: { fromName, score },        // opened from a challenge link
  launchReason: "feed" | "gamePage" | "challenge" | "dev",
  seed, dailySeed,                        // dailySeed is the same for everyone today (UTC)
  best,                                   // the player's best score, or null
  host: "ios" | "android" | "web" | "simulator" | "standalone",
}
```

## The Swipe Contract (read this)

The feed navigates with vertical swipes, and your game may use vertical swipes too. These rules keep
every swipe unambiguous. The simulator flags violations live and the reviewer checks them before a
human ever sees your build.

1. **Start a run with a tap, never with a swipe.** Start on `pointerup` of a short press, not on
   `pointerdown`, so a swipe that the feed takes over can never start a run.
2. **Declare `controls.vertical: true`** in `thumbcade.json` if play uses any vertical motion (swipes,
   drags, joysticks, dragging pieces). Then the whole surface is yours while playing, and players leave
   through the Dock below your game.
3. **Call `gameplay.start()`** on the tap that starts a run and **`gameplay.end()` within 1 s** of game over.
4. **Respect insets.** In attract mode the feed overlay covers the top tabs, the action rail on the
   right and the caption at the bottom. Keep your logo and "tap to play" inside `insets.preview`.
5. **On `pause`, stop the loop and all audio.** `tc.loop` stops itself; you stop your audio.

When the feed claims a gesture that started on your game, the SDK dispatches synthetic `pointercancel`
and `touchcancel` events to the active targets, swallows the rest of that gesture, and emits
`inputCancel`. Treat a cancelled pointer like a released one that did nothing: no half-jumps.

### Insets as CSS variables

For DOM games the SDK mirrors the insets into CSS custom properties on `<html>`:
`--tc-inset-{top,right,bottom,left}` (the current set), `--tc-preview-inset-*` and `--tc-play-inset-*`,
plus `data-tc-insets="preview" | "play"`.

```css
.title { position: absolute; top: var(--tc-preview-inset-top); right: var(--tc-preview-inset-right); }
```

### Injected CSS

On import the SDK adds one `<style>` that turns the page into a game surface:

```css
html, body { touch-action: none; overscroll-behavior: none; user-select: none;
  -webkit-user-select: none; -webkit-touch-callout: none; -webkit-tap-highlight-color: transparent; }
```

## Hosts and transports

The SDK detects its host automatically:

| Host | Detected by | Messages |
|---|---|---|
| Thumbcade app (React Native WebView) | `window.ReactNativeWebView` | out: `ReactNativeWebView.postMessage(JSON)`; in: `MessageEvent` on `window` |
| Simulator, web player, reviewer (iframe) | `window.parent !== window` | `parent.postMessage(envelope, "*")`; only messages from `window.parent` are accepted |
| A plain browser tab | neither | an in-page mock host with a small dev HUD (pause, mute, replay; best score in localStorage) |

Add `?tc_host=standalone` to the URL to force the standalone host. If an iframe parent never answers
(the game is embedded on some other site), the SDK falls back to standalone after 5 s.

## Budgets

Initial payload ≤ 3 MB gzipped (15 MB total), `ready()` within 2.5 s on a mid-range Android profile,
60 fps in attract mode, no long tasks over 100 ms after `ready()`, JS heap ≤ 150 MB. Games run under a
strict CSP: no remote code, no external network, no `eval`. Bundle your fonts and assets.

## For host authors

`@thumbcade/sdk/host` is a framework-agnostic iframe host (validation, rate limits, request routing,
message log). `@thumbcade/sdk/probe` is the instrumentation the simulator and reviewer inject to
measure fps, long tasks, heap and audio. `/host` needs `zod` (a peer dependency); the game-facing
entry needs nothing.

## License

MIT
