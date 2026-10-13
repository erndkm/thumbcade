import { defineConfig } from "vite";
import { thumbcade } from "@thumbcade/cli/vite";

// thumbcade() sets a relative base (bundles live under /<versionId>/), keeps every script
// external (the game CSP blocks inline scripts) and ships thumbcade.json with the build.
export default defineConfig({
  plugins: [thumbcade()],
});
