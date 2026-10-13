import { defineConfig } from "tsdown";

export default defineConfig({
  entry: { index: "src/index.ts" },
  format: "esm",
  fixedExtension: false,
  platform: "node",
  target: "node20",
  dts: false,
  clean: true,
  // The protocol contract is private to the monorepo; bundle it (and zod) so the package installs alone.
  deps: { alwaysBundle: ["@thumbcade/protocol", "zod"], neverBundle: ["sharp", "opentype.js", "@clack/prompts"] },
});
