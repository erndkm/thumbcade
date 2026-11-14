/**
 * Measures Bungee's advance widths in a real browser and writes src/metrics.ts, so the tests can check that every line
 * of copy fits the plate it is printed on: `pnpm exec tsx scripts/metrics.ts` (uses the workspace's Playwright).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(new URL("../../_kit/package.json", import.meta.url));
interface Page {
  setContent(html: string): Promise<void>;
  evaluate<T, A>(fn: (arg: A) => Promise<T>, arg: A): Promise<T>;
}
const { chromium } = require("playwright") as { chromium: { launch(): Promise<{ newPage(): Promise<Page>; close(): Promise<void> }> } };
const font = readFileSync(new URL("../../_kit/assets/fonts/library/bungee/Bungee-Regular.woff2", import.meta.url)).toString("base64");
const chars: string[] = [];
for (let c = 32; c < 127; c++) chars.push(String.fromCharCode(c));
chars.push("×", "’");

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent(`<style>@font-face{font-family:B;src:url(data:font/woff2;base64,${font})}</style><canvas></canvas>`);
const widths = await page.evaluate(async (cs) => {
  await document.fonts.load("100px B");
  const g = document.querySelector("canvas")!.getContext("2d")!;
  g.font = "100px B";
  return cs.map((c) => Math.round(g.measureText(c).width * 10) / 10);
}, chars);
await browser.close();
const table = Object.fromEntries(chars.map((c, i) => [c, widths[i]]));
writeFileSync(
  new URL("../src/metrics.ts", import.meta.url),
  `/** Bungee advance widths at 100 px, measured in Chromium by scripts/metrics.ts. */\nexport const BUNGEE: Record<string, number> = ${JSON.stringify(table)};\n\n/** Width of \`text\` in Bungee at \`size\` px. */\nexport const bungeeWidth = (text: string, size: number): number => [...text].reduce((w, c) => w + (BUNGEE[c] ?? 70), 0) * (size / 100);\n`,
);
console.log(`src/metrics.ts: ${chars.length} glyphs`);
