#!/usr/bin/env node
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const dist = fileURLToPath(new URL("../dist/index.js", import.meta.url));
if (!existsSync(dist)) {
  console.error("create-thumbcade-game isn't built. In the Thumbcade repo run: pnpm --filter create-thumbcade-game build");
  process.exit(1);
}
const { main } = await import(dist);
process.exitCode = await main(process.argv.slice(2));
