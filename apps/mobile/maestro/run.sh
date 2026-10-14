#!/usr/bin/env bash
# Runs the Maestro flows against Expo Go. Requires Metro on :8081, the local Supabase stack,
# the functions server, the game host and a seeded database (see docs/handoff/A.md).
#   bash maestro/run.sh ios                 # all flows on the booted iOS simulator
#   bash maestro/run.sh android 03          # flows matching 03 on the Android emulator
set -euo pipefail
cd "$(dirname "$0")"
PLATFORM="${1:-ios}"
FILTER="${2:-}"
ANON_KEY="$(grep EXPO_PUBLIC_SUPABASE_ANON_KEY ../.env | cut -d= -f2)"
VERTICAL_SLUG="${VERTICAL_SLUG:-merge}"
if [ "$PLATFORM" = "android" ]; then
  APP_ID="host.exp.exponent"
  # adb's emulator discovery probes TCP 5555, finds the game host there and lists a phantom offline
  # "emulator-5554" that breaks Maestro. Run adb without port scanning and attach the AVD (started with
  # `-port 5562`, so its adb port is 5563) explicitly.
  if adb devices | grep -q "emulator-5554"; then
    adb kill-server
    ADB_LOCAL_TRANSPORT_MAX_PORT=5554 adb start-server >/dev/null 2>&1
  fi
  adb connect "${ANDROID_ADB_ADDR:-127.0.0.1:5563}" >/dev/null || true
  DEVICE="${ANDROID_DEVICE:-${ANDROID_ADB_ADDR:-127.0.0.1:5563}}"
  adb -s "$DEVICE" reverse tcp:8081 tcp:8081 >/dev/null
else
  APP_ID="host.exp.Exponent"
  DEVICE="${IOS_DEVICE:-$(xcrun simctl list devices booted | awk -F '[()]' '/Booted/{print $2; exit}')}"
fi
FLOWS=$(ls [0-9][0-9]-*.yaml | grep -- "${FILTER}" || true)
export MAESTRO_CLI_NO_ANALYTICS=1 MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED=true
# One Maestro session for all flows (re-creating the on-device driver per flow is flaky on the emulator).
echo "== $PLATFORM: $(echo $FLOWS | tr '\n' ' ')"
maestro --device "$DEVICE" test -e APP_ID="$APP_ID" -e ANON_KEY="$ANON_KEY" -e VERTICAL_SLUG="$VERTICAL_SLUG" \
  --test-output-dir "../../../.data/maestro/$PLATFORM" $FLOWS
