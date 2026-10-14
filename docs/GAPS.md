# Gaps

What could not be finished or verified, and exactly what a human must do.

## Credentials (needed for production, not for local development)
- Sign in with Apple / Google: implemented behind `EXPO_PUBLIC_AUTH_APPLE_ENABLED` / `EXPO_PUBLIC_AUTH_GOOGLE_ENABLED`. Buttons render only when enabled. Needs an Apple Developer account (Services ID + key) and Google OAuth client IDs configured in Supabase Auth (`supabase/config.toml` → `[auth.external.apple]`, `[auth.external.google]`). Locally, email OTP (Mailpit at :54324) and guest mode work end to end.

## Integration (lead)
- **Game font subsets lack the OFL notice.** `games/_kit/assets/fonts/{display,mono}.woff2` lost their name-table
  license records when subset (the app's TTF/OTF files and the portal are fine, see `docs/THIRD_PARTY.md`). Before
  launch: re-subset with the name table kept (`pyftsubset --name-IDs='*'`), rebuild the games, and publish new versions.
- **Production hosting is not provisioned:** Supabase cloud project, Cloudflare R2 bucket with wildcard DNS for
  `*.thumbcade.gg` (per-game origins), and the portal on a Node host. The production checklist is in the README.
- **Perf numbers come from the iOS simulator** (`docs/PERF.md`). Frame times and memory on a mid-tier physical
  Android phone need a device build (EAS) and a real device.

## Creator & Games (B)
- **Not published to npm.** `@thumbcade/sdk`, `@thumbcade/cli` and `create-thumbcade-game` are publish-ready (MIT, `publishConfig`, `files`, built `dist/`), but `npm create thumbcade-game@latest` only works after publishing with the org's npm credentials. Publish with `pnpm publish` (it applies `publishConfig.exports`, pointing at `dist/`; `npm publish` would ship the in-repo `src/` exports, which aren't in the tarball; checked with `pnpm pack`). Locally: `node packages/create-game/bin/create.js my-game --local <repo path>` (links the local SDK/CLI; verified for all five templates, which install from npm, build, validate and pass the reviewer).
- **Device-code login:** verified end to end against the portal's `/api/cli/device` and `/poll` routes, with the approval step done through the service role (the same write the `/cli/activate` page performs). The browser half (signing in on `/cli/activate`) is the portal's and was not driven by me.
- **`thumbcade dev --device`** prints the QR/deep link `thumbcade://dev?url=…`; opening it needs the app's developer menu (A). Not verified on a physical phone.
- **Reviewer GPU:** on macOS the reviewer's Chromium renders WebGL on the GPU (ANGLE/Metal). On a GPU-less Linux host it falls back to SwiftShader and the 3D games (Stackd, Lane Rush, Helix Fall) will miss the 55 fps budget there. Production reviewers need a GPU host (or a headed Chromium with GPU).
- **Reviewer heuristics, by design:** `insets` passes when the SDK saw the game read its insets and warns otherwise (it can't see CSS-variable layouts or judge "essential UI"; the attract screenshot shows the overlay areas hatched for the human reviewer). `gameplay_end` can't time "within 1 s of game over" from outside the game; it passes when a run ends under scripted play and warns when none does within 95 s.
- **Simulator with a cross-origin URL** (`?game=https://…`): browsers hide pointer events inside cross-origin iframes, so feed swipes on the game surface can't be emulated; the Dock, mouse wheel and ↑/↓ keys still navigate. `thumbcade dev` and the monorepo simulator serve games same-origin, where everything works.
- **Simulator perf numbers** (fps, ready, long tasks, heap) are measured unthrottled on the developer's machine and labelled as such; the throttled mid-tier numbers come from the reviewer.
- **Storage lifecycle:** bundles are immutable; versions that fail review or get rejected keep their files in `game-bundles`. Production needs a lifecycle rule for old non-live versions.

## Player Platform (A)
- **Push notifications need an EAS project + a device build.** Registration, the `push_tokens` table, the `notify` function and the pg_cron → pg_net fan-out are wired and verified (the cron reaches `notify`, which runs). Expo Go cannot receive remote pushes (Android removed it in SDK 53; iOS needs an EAS `projectId`), so the app only loads `expo-notifications` when `extra.eas.projectId` is set. Human: create the EAS project, add `extra.eas.projectId` to `apps/mobile/app.config.ts`, configure APNs/FCM credentials in EAS, set `EXPO_ACCESS_TOKEN` in the functions' secrets, and test on a physical device. Until then the Inbox is fed by Supabase Realtime (verified live).
- **Sign in with Apple / Google** are implemented (expo-apple-authentication + `signInWithIdToken`/`linkIdentity`; Google via expo-auth-session id token) but untested without credentials. Google's id-token flow cannot redirect back into Expo Go; it needs a dev/production build with the client IDs in `.env`.
- **Universal / App Links** for `https://thumbcade.com/g/*` and `/c/*` are configured (`associatedDomains`, Android `intentFilters` with `autoVerify`) but need `apple-app-site-association` and `assetlinks.json` served from thumbcade.com and a native build. In Expo Go the same routes open via `exp://…/--/g/<slug>` and `thumbcade://` (verified with Maestro).
- **Saving the share card to Photos on Android Expo Go:** Expo Go 57.0.9 for Android ships without the `ExpoMediaLibraryNext` native module, so the app falls back to the system share sheet (which offers "Save image"). iOS Expo Go and native builds save directly to Photos.
- **Performance soak:** run by the lead on the iOS simulator (96 swipes, ≤ 3 WebViews, flat memory; `docs/PERF.md`). Not yet repeated on a physical Android phone with a release build.
- **Entry-file warming** uses the app's HTTP stack (`fetch`), which warms DNS/TLS and the CDN edge but not the WebView's own cache (separate process on both platforms). The next card itself is fully preloaded (`OFFSCREEN`, ready, paused) so the landing card is always alive.
- **Haptics in the simulator/emulator** can't be felt; the mapping is unit-tested and matches the design tokens.
- **Maestro on the headless Android emulator** occasionally fails to start its on-device driver ("did not start up in time"); rerun. Use `-gpu host` (see CLAUDE.md); with software rendering the flows time out. `maestro/run.sh` works around adb's phantom `emulator-5554` (see docs/handoff/A.md).
