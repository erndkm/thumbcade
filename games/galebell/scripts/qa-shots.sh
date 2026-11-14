#!/usr/bin/env bash
# Mid-run docs shots from QA builds (never shipped): the pilot plays (VITE_AUTOPLAY) and VITE_WARP starts the run that
# many seconds in, simulated headless at 60 Hz, so each moment is the same every time. Run from the repo root:
#   bash games/galebell/scripts/qa-shots.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
GAME="$ROOT/games/galebell"
OUT="$ROOT/docs/screenshots/games"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
shot() { # name skill warp wait-ms
  VITE_AUTOPLAY=$2 VITE_WARP=$3 "$ROOT/node_modules/.bin/vite" build "$GAME" --outDir "$TMP/$1" --emptyOutDir >/dev/null
  printf '[{"wait":1500},{"tap":[195,560]},{"wait":%s},{"shot":"%s"}]\n' "$4" "$1" >"$TMP/$1.json"
  (cd "$ROOT" && pnpm --silent --filter @thumbcade/reviewer shoot "$TMP/$1" --actions "$TMP/$1.json" --out "$OUT")
}
# The harness seed (1234) gives the expert a run with the high tide at 67.6 s, STORM (extra ball lit) at 74.8 s and
# the extra ball at 80.1 s.
shot tide expert 67.2 700
shot storm expert 74.5 650
shot extra expert 79.8 600
# A casual player's whole run, to its own game over.
VITE_AUTOPLAY=casual "$ROOT/node_modules/.bin/vite" build "$GAME" --outDir "$TMP/summary" --emptyOutDir >/dev/null
(cd "$ROOT" && pnpm --silent --filter @thumbcade/reviewer shoot "$TMP/summary" --actions "$GAME/shoot.qa.json" --out "$OUT")
