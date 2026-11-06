// Renders the ad statics and carousel cards to PNG at their exact ad sizes.
//   node render.mjs              all creatives
//   node render.mjs 01- 03-beat  only ids that start with one of the prefixes
import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const MARKETING = path.resolve(HERE, "../..");
const CAMPAIGNS = path.join(MARKETING, "campaigns");
const only = process.argv.slice(2);

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".jpg": "image/jpeg", ".woff2": "font/woff2", ".svg": "image/svg+xml" };
const server = http.createServer((req, res) => {
  const file = path.join(MARKETING, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (!file.startsWith(MARKETING)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": MIME[path.extname(file)] ?? "application/octet-stream" });
    res.end(buf);
  });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;

const browser = await chromium.launch({ args: ["--force-color-profile=srgb"] });
const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
page.on("pageerror", (e) => console.error("pageerror:", e.message));
await page.goto(`http://127.0.0.1:${port}/studio/statics/page.html`, { waitUntil: "load" });

const list = await page.evaluate(() => window.CREATIVES.map((c) => ({ id: c.id, out: c.out, w: c.w, h: c.h, tiles: c.tiles || 0 })));
const todo = list.filter((c) => !only.length || only.some((p) => c.id.startsWith(p)));
let n = 0;
for (const c of todo) {
  await page.setViewportSize({ width: c.w, height: c.h });
  for (let t = 0; t < (c.tiles || 1); t++) {
    await page.evaluate(([id, tile]) => window.renderCreative(id, tile), [c.id, t]);
    const out = path.join(CAMPAIGNS, c.tiles ? c.out.replace("{n}", String(t + 1).padStart(2, "0")) : c.out);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    await page.screenshot({ path: out, clip: { x: 0, y: 0, width: c.w, height: c.h } });
    n++;
  }
  console.log(`${c.id}  ${c.w}x${c.h}${c.tiles ? ` x${c.tiles}` : ""}`);
}
console.log(`${n} images`);
await browser.close();
server.close();
