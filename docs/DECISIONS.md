# Decisions

One line each: decision — reason.

## Phase 0 (lead)
- Expo SDK 57 (React Native 0.86, React 19.2, Reanimated 4.5) with versions chosen by `npx expo install` — npm "latest" of RN libs is ahead of what SDK 57 supports.
- TypeScript 6.0.x everywhere — TS 7 (native port) is not yet supported by typescript-eslint (<6.1).
- pnpm 12 with `nodeLinker: hoisted` — Metro/React Native resolve most reliably from a flat node_modules.
- Contract packages are consumed as TypeScript source with explicit `.ts` import extensions — one source of truth for Metro, Next, Vite, Deno and tsx without a build step.
- Guests are Supabase anonymous users — one stable identity for events/sessions/storage; linking upgrades in place; RLS gates social writes with `is_member()`.
- The mobile app stays Expo Go-compatible (no custom native modules; `expo-sqlite/kv-store` instead of MMKV) — lets us drive iOS/Android simulators without native builds or CocoaPods.
- Bridge: the reply to `hello` carries the LaunchContext (what the prompt calls `init`) — one generic `reply` envelope for all requests keeps the SDK tiny.
- `gameplay.start` carries an SDK-observed `trigger` (tap/swipe/key) — lets the shell, simulator and reviewer detect "run started by a swipe" without seeing inside cross-origin frames.
- Added a `FAILED` card phase to the Swipe Contract — loading failures need their own retry state; ownership is the same as LOADING.
- Pause/resume messages are derived by reconciling `shouldRun(state)` after every transition — makes double pause/resume impossible (fuzz-tested).
- Local game host is path-based (`:5555/<slug>/<versionId>/`); production is one origin per game on `thumbcade.gg` — `*.localhost` subdomains don't resolve in simulators/emulators.
- `game-bundles` bucket is public-read locally (unguessable version UUID paths) — production serves from R2 behind the CDN.
- Protect triggers (roles, counters, status, live version) allow nested trigger updates and `enter_trusted()` security-definer RPCs — counters and approve/rollback must update protected columns.
- Review decisions are SQL RPCs (`approve_version`, `reject_version`, `rollback_to_version`, `takedown_game`) — one implementation for the portal, the CLI and the e2e script.
- Docker via Colima (Homebrew) — Docker Desktop needs interactive setup; Colima runs headless.
- Brand assets are generated from code (`scripts/build-brand.ts`) with opentype.js 1.3.4 — 2.0.0 produced NaN glyph coordinates for Mona Sans Display Expanded.
- Logo: a raised arcade button in volt whose engraved ridges form a thumbprint whorl; five bold ridges (not six thin ones) so it survives 29–60 px.
