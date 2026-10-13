# @thumbcade/cli

The `thumbcade` command: develop in a phone-accurate feed simulator, check budgets and the Swipe
Contract before upload, and publish for review.

```bash
npm i -D @thumbcade/cli          # create-thumbcade-game adds it for you
npx thumbcade dev                # simulator + hot reload
npx thumbcade dev --device       # play on your phone (QR for the app's developer menu)
npx thumbcade validate           # build, then manifest + budgets + static rules
npx thumbcade login              # device-code login through the portal (or --token tc_…)
npx thumbcade publish --wait     # build → validate → zip → upload → watch the automated review
```

| Command | What it does |
|---|---|
| `dev [--port 5173] [--device] [--no-open]` | One local origin serves the feed simulator at `/` and your game at `/__game/` (your Vite config, with HMR). Same origin lets the simulator watch input, measure fps/long tasks/heap, and catch contract violations live. `--device` binds to your LAN and prints a QR for `thumbcade://dev?url=<game url>`. |
| `validate [--no-build]` | Builds with your Vite config, copies `thumbcade.json` into the bundle and checks: manifest schema, entry, 1024² icon, 1080×1920 poster (if declared), 15 MB cap, 3 MB gzipped first load, and a static scan (inline scripts, remote code/fonts, root-relative paths, `eval`, off-origin requests). Every problem comes with a fix. |
| `login [--token tc_…]` | Device-code flow through the portal. The token goes to the OS keychain (macOS Keychain, libsecret on Linux) or `~/.config/thumbcade/credentials.json` (0600). |
| `publish [--notes "…"] [--wait]` | Validates, zips the bundle and uploads it. Prints the review link; `--wait` polls until the automated review finishes and prints each check. |
| `whoami`, `logout` | Who the stored token belongs to (and your games); forget it. |

Environment: `THUMBCADE_PORTAL_URL`, `THUMBCADE_FUNCTIONS_URL` (default: the local stack),
`THUMBCADE_TOKEN` (CI), `THUMBCADE_CONFIG_DIR`, `THUMBCADE_NO_KEYCHAIN=1`.

The Vite plugin every game uses is exported as `@thumbcade/cli/vite`:

```ts
import { defineConfig } from "vite";
import { thumbcade } from "@thumbcade/cli/vite";
export default defineConfig({ plugins: [thumbcade()] }); // relative base, no inline scripts, ships thumbcade.json
```

## License

MIT
