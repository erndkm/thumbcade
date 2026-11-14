#!/usr/bin/env bash
# The mid-run docs screenshots, from autoplay builds: each one lets the expert pilot drive the harness seed's first run
# headless for VITE_WARP seconds (deterministic at 60 Hz), then shows it, frame-stepped, and shoots a moment later.
#   bash games/saltbend/scripts/qa-shots.sh [out-dir]      (default docs/screenshots/games)
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
repo="$(cd "$here/../.." && pwd)"
out="${1:-$repo/docs/screenshots/games}"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
# name   warp (s)   wait after the tap (ms)   what it shows
shots=(
  "gate   19.6 1700"   # the first gate: bunting, the stage's name on the road and its banner, a spare crate loaded
  "ribbon 42.0 1250"   # ×4 ribbon on an "on the paint" line, skid marks, drift banked
  "save   54.0 1150"   # off the road with a crate on the back: saved by the crate
  "night  90.8 1500"   # night on the road to moon harbour: the headlamp, a gate ahead
)
for entry in "${shots[@]}"; do
  read -r name warp wait <<<"$entry"
  (cd "$here" && VITE_AUTOPLAY=expert VITE_WARP="$warp" pnpm exec vite build --outDir "$tmp/$name" --emptyOutDir >/dev/null)
  printf '[{"wait":1500},{"tap":[195,520]},{"wait":%s},{"shot":"%s"}]\n' "$wait" "$name" >"$tmp/$name.json"
  (cd "$repo" && pnpm --filter @thumbcade/reviewer shoot "$tmp/$name" --actions "$tmp/$name.json" --out "$out" | tail -1)
done
