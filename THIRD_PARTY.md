# Third-party assets and licenses

| Asset | License | Source | Used in |
|---|---|---|---|
| Mona Sans 2.0.27 (static + variable) | SIL OFL 1.1 | https://github.com/github/mona-sans | design-tokens fonts (app, portal, simulator, brand) |
| Departure Mono 1.500 | SIL OFL 1.1 | https://github.com/rektdeckard/departure-mono | design-tokens fonts (numbers, scores, labels) |
| chess.js 1.4.0 | BSD-2-Clause | https://github.com/jhlywa/chess.js | games/gambit (move generation and validation; puzzle generator/verifier) |

| Mona Sans Display Expanded Black, printable-ASCII subset | SIL OFL 1.1 | https://github.com/github/mona-sans | `games/_kit/assets/fonts/display.woff2` (titles in every launch game; license text alongside); `packages/create-game/assets/fonts` (icon/poster generation) |
| Departure Mono 1.500 (copy) | SIL OFL 1.1 | https://github.com/rektdeckard/departure-mono | `games/_kit/assets/fonts/mono.woff2` (scores/labels in every launch game); `packages/create-game/assets/fonts` |
| three.js 0.186.1 | MIT | https://github.com/mrdoob/three.js | bundled into Stackd, Lane Rush, Helix Fall; the Three.js template |
| PixiJS 8.22.0 | MIT | https://github.com/pixijs/pixijs | bundled into Slice, Breakout Neo; the PixiJS template |
| Phaser 4.2.1 | MIT | https://github.com/phaserjs/phaser | the Phaser template (installed by creators; not part of any launch game) |
| subset-font 2.9.0 (harfbuzzjs) | BSD-3-Clause (harfbuzz: MIT) | https://github.com/papandreou/subset-font | build-time font subsetting for the kit (`pnpm --filter @thumbcade-games/kit fonts`) |
| opentype.js 1.3.4 | MIT | https://github.com/opentypejs/opentype.js | create-thumbcade-game: text to SVG paths for generated icons and posters |

All launch-game art (icons, sprites, chess pieces, card faces, posters) and every sound effect are original to this repository: drawn in code or SVG, synthesized with WebAudio at runtime. No samples, sprite sheets or third-party art.

npm dependencies are listed in each package.json under their own licenses.
