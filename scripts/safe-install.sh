#!/usr/bin/env bash
# Serializes `pnpm install` / `pnpm add` across concurrent agents sharing one hoisted node_modules.
# Usage: bash scripts/safe-install.sh                       (pnpm install)
#        bash scripts/safe-install.sh --filter @thumbcade/sdk add -D tsup
#        bash scripts/safe-install.sh approve-builds sharp
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOCK="$ROOT/.pnpm-install.lock"
for i in $(seq 1 600); do
  if mkdir "$LOCK" 2>/dev/null; then
    trap 'rmdir "$LOCK" 2>/dev/null || true' EXIT
    cd "$ROOT"
    if [ "$#" -eq 0 ]; then pnpm install; else pnpm "$@"; fi
    exit $?
  fi
  # Break stale locks older than 10 minutes.
  if [ -d "$LOCK" ] && [ "$(( $(date +%s) - $(stat -f %m "$LOCK") ))" -gt 600 ]; then rmdir "$LOCK" 2>/dev/null || true; fi
  sleep 1
done
echo "safe-install: timed out waiting for $LOCK" >&2
exit 1
