#!/usr/bin/env bash
# Regenerates the brand assets and refreshes every app copy of them.
# Usage: bash scripts/brand.sh            (rebuild the current logo variant, see packages/design-tokens/brand/variant.txt)
#        bash scripts/brand.sh bold       (switch the logo variant: classic | bold)
# App icon, adaptive icons and splash reach the native apps on the next native build; Expo Go keeps its own icon.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
pnpm --filter @thumbcade/design-tokens brand "$@"
pnpm --filter @thumbcade/mobile brand
node apps/portal/scripts/copy-brand.mjs
cp packages/design-tokens/brand/favicon.svg apps/simulator/public/favicon.svg
