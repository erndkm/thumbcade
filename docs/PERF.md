# Performance

## 100-swipe soak (iOS simulator)

`apps/mobile/maestro/perf/soak.sh` drives the feed with Maestro and samples memory every 3 s. Each round
swipes away a card in PREVIEW, then taps the next game to start it and leaves it from PLAYING via the Dock
(or from the surface if the run already ended). Half the swipes go through a running game, which exercises
`input.cancel`, pause and resume, and the WebView pool.

**Setup:** iPhone 18 Pro simulator, iOS 27, Expo Go 57 running the development bundle from Metro, local
Supabase and game host, the 12 seeded launch games (3 of them WebGL). Run on 14 Oct 2026 for 46 min.

| | Result |
|---|---|
| Feed swipes | **96** (64 on the surface, 32 from the Dock). Maestro's iOS driver then crashed ("Timed out while requesting screenshot"). The app kept running. |
| Game WebViews alive | **≤ 3 the whole run** (WebKit WebContent processes, max 3, median 3) |
| Expo Go memory | 922 MB (first quarter) → 878 MB (last quarter), peak 1,078 MB, trend −30 MB / 10 min |
| WebContent memory (all three) | 970 MB → 950 MB, peak 1,079 MB, trend −9 MB / 10 min |
| WebKit GPU process | 177 MB → 171 MB, peak 199 MB, trend −2 MB / 10 min |
| Landed card → PREVIEW | median 179 ms, p90 272 ms, max 424 ms; **95 of 96 cards were already live on landing** |

The first 60 s are excluded as warm-up, while the first card and its neighbours load. Memory is flat:
nothing grows with the number of swipes. The absolute numbers are inflated by the development setup
(Expo Go with the dev bundle, source maps and the JS debugger hooks, plus simulator WebKit). A release build
on a device will be much smaller. The trend and the WebView count are what this run proves.

"Landed card → PREVIEW" is wall time from the end of a swipe until the card reported PREVIEW, and it includes
Maestro's ~0.2 s polling. The true number is lower. It stays small because the next card is preloaded in
`OFFSCREEN` (loaded, `ready()` received, paused) before you swipe.

## Game load to `ready()`

From the `ready` events the app sends (`meta.ms`, measured from the WebView's load start). These cover 98
loads during the soak, mostly preloads of the next card.

| Game | Median | p90 |
|---|---|---|
| all games | 2.1 s | 3.1 s |
| Voltbrick / Flapjack / Shortwick / Pairs / Stackd / Kneejerk | 1.8–1.9 s | 2.3–2.8 s |
| Kingsnare / Mines / Neon Chop / Snek | 2.1–2.2 s | 2.9–3.7 s |
| Heatfall / Duskrail (WebGL) | 3.2 s | 3.4–4.0 s |

That is under the 8 s load timeout with a wide margin. Because loads happen one card ahead, they don't show
up as waiting. A cold start of the development app (Metro bundle download included) is not representative
and is not reported here.

## Not measured here

- **Frame times on a mid-tier Android phone.** This needs a release build (EAS) on real hardware. The headless
  emulator renders WebGL in software. The reviewer enforces per-game budgets (fps, ready time, long tasks, bundle
  size) on publish; see `docs/handoff/B.md`.
- **Release-build memory and cold start.** Measure with Xcode Instruments and Android Studio's profiler once there
  are store builds.

## Re-running

```bash
cd apps/mobile
bash maestro/perf/soak.sh   # needs pnpm dev + pnpm seed and a booted iOS simulator; ~45 min
```

Samples go to `.data/perf/soak-<time>.csv`, and `maestro/perf/analyze.mjs` prints the summary above.
