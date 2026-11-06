#!/usr/bin/env bash
# Copies fonts, brand marks, game icons and tokens into studio/assets/ (generated, git-ignored).
# Gameplay frames come from ../trailer/frames: run `bash ../trailer/prepare.sh` first.
set -euo pipefail
cd "$(dirname "$0")"
REPO="$(cd ../.. && pwd)"
GAMES=(duskrail flapjack heatfall kingsnare kneejerk mines neon-chop pairs shortwick snek stackd voltbrick)

mkdir -p assets/icons assets/posters
cp "$REPO"/packages/design-tokens/fonts/web/*.woff2 assets/
cp "$REPO"/packages/design-tokens/brand/{mark.svg,wordmark.svg,wordmark-ink.svg,app-icon.png,lockup.svg} assets/
for g in "${GAMES[@]}"; do
  cp "$REPO/dist/games/$g/bundle/assets/icon.png" "assets/icons/$g.png"
  cp "$REPO/dist/games/$g/bundle/assets/poster.jpg" "assets/posters/$g.jpg"
done
(cd "$REPO/packages/design-tokens" && node --input-type=module -e '
const m = await import("./src/index.ts");
const fs = await import("node:fs");
const avatars = Object.fromEntries(["thumbcade","lowpolyfox","quietmoves","pixelwitch","juicefactory","bitbybit","mira"].map((h) => [h, m.pixelAvatarSvg(h, 64)]));
fs.writeFileSync(process.argv[1], "window.TC = " + JSON.stringify({ icons: m.icons, palette: m.palette, avatars }) + ";\n");
' "$OLDPWD/assets/tokens.js")
echo "assets ready"
