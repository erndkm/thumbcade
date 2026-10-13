import { defineConfig } from "tsdown";

export default defineConfig({
  entry: { index: "src/index.ts", host: "src/host/index.ts", probe: "src/probe/index.ts" },
  format: "esm",
  platform: "browser",
  target: "es2020",
  dts: true,
  clean: true,
  sourcemap: true,
  // The protocol contract is private to the monorepo: bundle it into dist/host.js. zod stays a peer.
  deps: { alwaysBundle: ["@thumbcade/protocol"], neverBundle: ["zod"] },
});
