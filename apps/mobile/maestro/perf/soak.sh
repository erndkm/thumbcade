#!/usr/bin/env bash
# 100-swipe performance soak on the booted iOS simulator (Expo Go). Samples, every 3 s:
#   Expo Go RSS · number and total RSS of WebKit WebContent processes · WebKit GPU process RSS
# and writes .data/perf/soak-<timestamp>.csv plus a summary. Needs the same services as maestro/run.sh.
#   bash maestro/perf/soak.sh
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(cd ../../.. && pwd)"
# shellcheck disable=SC1091
source "$ROOT/scripts/env.sh" >/dev/null
OUT="$ROOT/.data/perf"
mkdir -p "$OUT"
CSV="$OUT/soak-$(date +%Y%m%d-%H%M%S).csv"
ANON_KEY="$(grep EXPO_PUBLIC_SUPABASE_ANON_KEY ../.env | cut -d= -f2)"
DEVICE="${IOS_DEVICE:-$(xcrun simctl list devices booted | awk -F '[()]' '/Booted/{print $2; exit}')}"
[ -n "$DEVICE" ] || { echo "No booted iOS simulator." >&2; exit 1; }

sample() {
  # A grep that matches nothing (no WebView alive yet) must not end the loop.
  set +e +o pipefail
  echo "t,expo_kb,webcontent_n,webcontent_kb,gpu_kb" >"$CSV"
  local t0; t0=$(date +%s)
  while true; do
    local ps_out; ps_out="$(ps -axo rss=,command=)"
    local expo wc gpu
    expo=$(grep -E "Expo-Go-[^/]*\.app/Expo Go$" <<<"$ps_out" | awk '{s+=$1} END{print s+0}')
    wc=$(grep "simruntime" <<<"$ps_out" | grep "com.apple.WebKit.WebContent" | awk '{s+=$1; n++} END{print n+0 "," s+0}')
    gpu=$(grep "simruntime" <<<"$ps_out" | grep "com.apple.WebKit.GPU" | awk '{s+=$1} END{print s+0}')
    echo "$(( $(date +%s) - t0 )),$expo,$wc,$gpu" >>"$CSV"
    sleep 3
  done
}

sample &
SAMPLER=$!
trap 'kill $SAMPLER 2>/dev/null || true' EXIT
START=$(date +%s)
export MAESTRO_CLI_NO_ANALYTICS=1 MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED=true
# A long run can outlive Maestro's on-device driver; summarise whatever was recorded either way.
STATUS=0
maestro --device "$DEVICE" test -e APP_ID="host.exp.Exponent" -e ANON_KEY="$ANON_KEY" \
  --test-output-dir "$OUT/maestro" perf/soak.yaml || STATUS=$?
echo "Soak finished in $(( $(date +%s) - START )) s (maestro exit $STATUS). Samples: $CSV"
kill $SAMPLER 2>/dev/null || true
# Maestro writes each run into its own timestamped folder.
node perf/analyze.mjs "$CSV" "$OUT/maestro/$(ls -t "$OUT/maestro" | head -1)"
exit $STATUS
