/** Ships the prebuilt feed simulator inside the CLI (dist/simulator), which `thumbcade dev` serves. */
import { cp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const from = fileURLToPath(new URL("../../../apps/simulator/dist/", import.meta.url));
const to = fileURLToPath(new URL("../dist/simulator/", import.meta.url));
if (!existsSync(`${from}index.html`)) {
  console.error("apps/simulator/dist is missing: build the simulator first (pnpm --filter @thumbcade/simulator build).");
  process.exit(1);
}
await rm(to, { recursive: true, force: true });
await cp(from, to, { recursive: true });
console.log("simulator copied into dist/simulator");
