// Screenshot helper for design QA.
// Usage: node scripts/shoot.mjs <url> <out.png> [width=1440] [height=900] [fullPage=1] [waitMs=800]
import { chromium } from "playwright";

const [url, out, w = "1440", h = "900", full = "1", wait = "800"] = process.argv.slice(2);
if (!url || !out) {
  console.error("usage: node scripts/shoot.mjs <url> <out.png> [width] [height] [fullPage] [waitMs]");
  process.exit(1);
}
const browser = await chromium.launch();
const page = await browser.newPage({ ...(process.env.STATE ? { storageState: process.env.STATE } : {}), viewport: { width: Number(w), height: Number(h) }, deviceScaleFactor: 2, reducedMotion: process.env.MOTION === "1" ? "no-preference" : "reduce" });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
await page.goto(url, { waitUntil: "networkidle" });
await page.waitForTimeout(Number(wait));
await page.screenshot({ path: out, fullPage: full === "1" });
await browser.close();
if (errors.length) console.log("page errors:\n" + errors.slice(0, 10).join("\n"));
console.log(`saved ${out}`);
