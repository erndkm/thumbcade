# Third-party software and assets

Everything Thumbcade ships is either our own work or used under a permissive license. Nothing in the
apps, games or portal is under a copyleft (GPL/AGPL) or non-commercial license.

## Fonts

| Font | License | Used in | License text |
|---|---|---|---|
| Mona Sans (incl. Display Expanded) by GitHub | SIL Open Font License 1.1 | app, portal, brand assets, games (ASCII subset `games/_kit/assets/fonts/display.woff2`) | `packages/design-tokens/fonts/OFL-MonaSans.txt` |
| Departure Mono by Helena Zhang | SIL Open Font License 1.1 | app, portal, games (`games/_kit/assets/fonts/mono.woff2`) | `packages/design-tokens/fonts/OFL-DepartureMono.txt` |

The OFL allows bundling and subsetting. The fonts are not sold on their own, and the subsets keep their
original family names in the metadata. The license has to travel with the fonts:

- **App:** the bundled TTF/OTF files keep the OFL notice and URL in their name table (IDs 13/14).
- **Portal:** serves the full texts at `/licenses/OFL-*.txt` (copied by `apps/portal/scripts/copy-brand.mjs`).
- **Games:** the two woff2 subsets in `games/_kit` lost their name-table license records when they were
  subset. This is an open pre-launch item in `docs/GAPS.md`.

## Game art, audio and 3D

All 12 launch games draw their graphics in code (Canvas 2D, PixiJS or Three.js primitives) and make their
sounds at runtime with WebAudio. They ship no third-party images, audio, models or textures. Posters
and icons come from the games themselves (`scripts/games-index.ts`) or from the brand generator
(`packages/design-tokens/scripts/build-brand.ts`).

## Runtime libraries

Licenses are read from each package's `package.json` for the direct runtime dependencies of every
workspace package. Dev tooling (TypeScript, ESLint, Vitest, Jest, Vite, tsx, Turborepo) is not distributed.

| License | Packages |
|---|---|
| MIT | react, react-dom, react-native, expo and its `expo-*` modules, expo-router, @expo/metro-runtime, react-native-gesture-handler, react-native-reanimated, react-native-worklets, react-native-screens, react-native-safe-area-context, react-native-svg, react-native-webview, react-native-view-shot, @shopify/flash-list, @shopify/react-native-skia, @tanstack/react-query, zustand, zod, @supabase/supabase-js, @supabase/ssr, next, @next/mdx, @mdx-js/loader, @mdx-js/react, remark-gfm, @radix-ui/react-dialog, @radix-ui/react-dropdown-menu, @radix-ui/react-tabs, @radix-ui/react-tooltip, server-only, three, pixi.js, fflate, qrcode, esbuild, @clack/prompts, opentype.js |
| BSD-2-Clause | chess.js (Gambit's move generation and validation) |
| Apache-2.0 | sharp (brand and poster rasterising, build-time), playwright (the reviewer's headless browser, server-side) |

To regenerate the table after dependency changes, list the direct `dependencies` of every workspace
`package.json` and read `license` from each resolved package's `package.json`.

## Services (not bundled)

Supabase (Postgres, Auth, Storage, Realtime, Edge Functions), Expo/EAS, Apple Push Notification service
and Firebase Cloud Messaging (through Expo push), and Cloudflare R2 (planned for production game hosting).
They are used under their own terms of service.
