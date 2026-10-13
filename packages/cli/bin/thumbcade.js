#!/usr/bin/env node
// Entry point of the `thumbcade` command (the CLI itself is bundled into dist/).
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const dist = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
if (!existsSync(dist)) {
  console.error("thumbcade: the CLI isn't built. In the Thumbcade repo run: pnpm --filter @thumbcade/cli build");
  process.exit(1);
}
const { main } = await import(dist);
process.exitCode = await main(process.argv.slice(2));
