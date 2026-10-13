# Gaps

What could not be finished or verified, and exactly what a human must do.

## Credentials (needed for production, not for local development)
- Sign in with Apple / Google: implemented behind `EXPO_PUBLIC_AUTH_APPLE_ENABLED` / `EXPO_PUBLIC_AUTH_GOOGLE_ENABLED`. Buttons render only when enabled. Needs an Apple Developer account (Services ID + key) and Google OAuth client IDs configured in Supabase Auth (`supabase/config.toml` → `[auth.external.apple]`, `[auth.external.google]`). Locally, email OTP (Mailpit at :54324) and guest mode work end to end.

## Creator & Games (B)
- **`verify_jwt = false` for `creator-publish` needs a functions restart.** It's in `supabase/config.toml` (contract request B1), but the running `supabase functions serve` picks config up only on restart. Until then the CLI falls back to the anon key as bearer plus `x-thumbcade-token` (works today, verified). Human/lead: restart `supabase functions serve --env-file supabase/functions/.env` once.
- **Not published to npm.** `@thumbcade/sdk`, `@thumbcade/cli` and `create-thumbcade-game` are publish-ready (MIT, `publishConfig`, `files`, built `dist/`), but `npm create thumbcade-game@latest` only works after `npm publish` with the org's npm credentials. Locally: `node packages/create-game/bin/create.js my-game --local <repo path>` (links the local SDK/CLI; verified for all five templates, which install from npm, build, validate and pass the reviewer).
- **Device-code login:** verified end to end against the portal's `/api/cli/device` and `/poll` routes, with the approval step done through the service role (the same write the `/cli/activate` page performs). The browser half (signing in on `/cli/activate`) is the portal's and was not driven by me.
- **`thumbcade dev --device`** prints the QR/deep link `thumbcade://dev?url=…`; opening it needs the app's developer menu (A). Not verified on a physical phone.
- **Reviewer GPU:** on macOS the reviewer's Chromium renders WebGL on the GPU (ANGLE/Metal). On a GPU-less Linux host it falls back to SwiftShader and the 3D games (Stackd, Lane Rush, Helix Fall) will miss the 55 fps budget there. Production reviewers need a GPU host (or a headed Chromium with GPU).
- **Reviewer heuristics, by design:** `insets` passes when the SDK saw the game read its insets and warns otherwise (it can't see CSS-variable layouts or judge "essential UI"; the attract screenshot shows the overlay areas hatched for the human reviewer). `gameplay_end` can't time "within 1 s of game over" from outside the game; it passes when a run ends under scripted play and warns when none does within 95 s.
- **Simulator with a cross-origin URL** (`?game=https://…`): browsers hide pointer events inside cross-origin iframes, so feed swipes on the game surface can't be emulated; the Dock, mouse wheel and ↑/↓ keys still navigate. `thumbcade dev` and the monorepo simulator serve games same-origin, where everything works.
- **Simulator perf numbers** (fps, ready, long tasks, heap) are measured unthrottled on the developer's machine and labelled as such; the throttled mid-tier numbers come from the reviewer.
- **Reviewer worker** isn't part of `pnpm dev` (root script, lead): run `pnpm --filter @thumbcade/reviewer worker` next to the stack to process `review_jobs`.
- **Storage lifecycle:** bundles are immutable; versions that fail review or get rejected keep their files in `game-bundles`. Production needs a lifecycle rule for old non-live versions.
