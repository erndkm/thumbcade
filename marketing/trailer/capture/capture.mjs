// Frame-by-frame capture of a built game under a virtual clock.
// node capture.mjs <game> <outDir> [--w 360 --h 640 --dpr 3 --fps 60 --attract 2.5 --play 4.5 --q 90 --taps "x,y@t;..."]
import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const [game, outDir, ...rest] = process.argv.slice(2);
const opt = { w: 360, h: 640, dpr: 3, fps: 60, attract: 2.5, play: 4.5, q: 90, warm: 0.5, taps: "", gpu: "1", every: 1, shotFrom: 0, autoOff: -1 };
for (let i = 0; i < rest.length; i += 2) opt[rest[i].replace(/^--/, "")] = rest[i + 1];
for (const k of ["w", "h", "dpr", "fps", "attract", "play", "q", "warm", "every", "shotFrom", "autoOff"]) opt[k] = Number(opt[k]);

const ROOT = new URL("../games-built/", import.meta.url).pathname;
const MIME = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".woff2": "font/woff2", ".css": "text/css", ".svg": "image/svg+xml", ".webp": "image/webp", ".wasm": "application/wasm", ".mp3": "audio/mpeg", ".ogg": "audio/ogg" };
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(new URL(req.url, "http://x").pathname));
  fs.readFile(p, (err, buf) => {
    if (err) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": MIME[path.extname(p)] ?? "application/octet-stream" });
    res.end(buf);
  });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;

const args = opt.gpu === "1" ? ["--enable-gpu", "--use-angle=metal", "--ignore-gpu-blocklist", "--enable-webgl"] : [];
const browser = await chromium.launch({ args });
const ctx = await browser.newContext({ viewport: { width: opt.w, height: opt.h }, deviceScaleFactor: opt.dpr, hasTouch: true, isMobile: true });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
const insets = opt.insets ? JSON.parse(opt.insets) : { preview: { top: 64, right: 66, bottom: 168, left: 0 }, play: { top: 28, right: 0, bottom: 52, left: 0 } };
await page.addInitScript({ path: new URL("./virtual-time.js", import.meta.url).pathname });
await page.addInitScript(`globalThis.__TC_AUTO = true; globalThis.__TC_INSETS = ${JSON.stringify(insets)}; try { localStorage.clear(); } catch {}`);
await page.goto(`http://127.0.0.1:${port}/${game}/index.html`, { waitUntil: "load" });
await page.evaluate(() => document.fonts.ready);
// Let async module work (fetches, font decode) settle while the clock steps.
const dt = 1000 / opt.fps;
for (let i = 0; i < opt.warm * opt.fps; i++) {
  await page.evaluate((d) => window.__vt.step(d), dt);
  if (i % 10 === 0) await new Promise((r) => setTimeout(r, 15));
}
fs.mkdirSync(outDir, { recursive: true });
const taps = opt.taps ? opt.taps.split(";").map((s) => { const [xy, t] = s.split("@"); const [x, y] = xy.split(",").map(Number); return { x, y, t: Number(t), done: false }; }) : [{ x: opt.w / 2, y: opt.h * 0.62, t: opt.attract, done: false }];
const total = Math.round((opt.attract + opt.play) * opt.fps);
let n = 0;
const t0 = Date.now();
for (let f = 0; f < total; f++) {
  const t = f / opt.fps;
  for (const tap of taps) if (!tap.done && t >= tap.t) { tap.done = true; await page.touchscreen.tap(tap.x, tap.y); }
  if (opt.autoOff >= 0 && t >= opt.autoOff) await page.evaluate(() => { globalThis.__TC_AUTO = false; });
  await page.evaluate((d) => window.__vt.step(d), dt);
  if (t >= opt.shotFrom && f % opt.every === 0) {
    await page.screenshot({ path: path.join(outDir, `f${String(n).padStart(5, "0")}.jpg`), type: "jpeg", quality: opt.q, animations: "allow", caret: "hide", scale: "device" });
    n++;
  }
}
console.log(`${game}: ${n} frames in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
if (errors.length) console.log("errors:", errors.slice(0, 5).join("\n"));
await browser.close();
server.close();
