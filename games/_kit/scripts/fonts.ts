/**
 * Builds the two fonts every launch game may use:
 *  - mono.woff2     Departure Mono (OFL), copied as is — scores, labels, prompts.
 *  - display.woff2  Mona Sans Display Expanded Black (OFL), subset to printable ASCII + a few symbols — titles.
 * Run: pnpm --filter @thumbcade-games/kit fonts
 */
import { copyFile, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import subsetFont from "subset-font";

const tokens = fileURLToPath(new URL("../../../packages/design-tokens/fonts/", import.meta.url));
const out = fileURLToPath(new URL("../assets/fonts/", import.meta.url));

let ascii = "";
for (let c = 0x20; c <= 0x7e; c++) ascii += String.fromCharCode(c);
const extra = "×·•–—’“”…→←↑↓★♥✓";

await copyFile(`${tokens}web/DepartureMono-Regular.woff2`, `${out}mono.woff2`);
const display = await readFile(`${tokens}native/MonaSansDisplayExpanded-Black.ttf`);
const subset = await subsetFont(display, ascii + extra, { targetFormat: "woff2" });
await writeFile(`${out}display.woff2`, subset);
console.log(`display.woff2 ${subset.length} B, mono.woff2 copied`);
