#!/usr/bin/env bash
# Builds the private game copies, captures 60 fps footage and copies brand assets for the compositor.
# Everything it writes (games-built/, frames/, comp/assets/) is generated and git-ignored.
set -euo pipefail
cd "$(dirname "$0")"
REPO="$(cd ../.. && pwd)"
GAMES=(duskrail flapjack heatfall kingsnare kneejerk mines neon-chop pairs shortwick snek stackd voltbrick)

node capture/build-games.mjs

mkdir -p comp/assets/icons
cp "$REPO"/packages/design-tokens/fonts/web/*.woff2 comp/assets/
cp "$REPO"/packages/design-tokens/brand/wordmark.svg comp/assets/
for g in "${GAMES[@]}"; do cp "games-built/$g/assets/icon.png" "comp/assets/icons/$g.png"; done
(cd "$REPO/packages/design-tokens" && node --input-type=module -e '
const m = await import("./src/index.ts");
const fs = await import("node:fs");
const avatars = { thumbcade: m.pixelAvatarSvg("thumbcade", 64), mira: m.pixelAvatarSvg("mira", 64) };
fs.writeFileSync(process.argv[1], "window.TC = " + JSON.stringify({ icons: m.icons, palette: m.palette, avatars }) + ";\n");
' "$OLDPWD/comp/assets/tokens.js")

bash capture/run-captures.sh
