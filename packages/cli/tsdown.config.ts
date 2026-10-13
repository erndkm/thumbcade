import { defineConfig } from "tsdown";

export default defineConfig({
  entry: { cli: "src/cli.ts", index: "src/index.ts", checks: "src/checks/index.ts", vite: "src/vite.ts" },
  format: "esm",
  fixedExtension: false,
  platform: "node",
  target: "node20",
  dts: false,
  clean: true,
  sourcemap: true,
  // Private workspace contracts are bundled; npm dependencies stay external.
  deps: { alwaysBundle: ["@thumbcade/protocol", "@thumbcade/sdk"], neverBundle: ["vite", "zod", "fflate", "qrcode"] },
});
