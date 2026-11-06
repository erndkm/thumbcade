// Renders the teaser.
//   node render.mjs stills <w> <h> <outDir> <t1,t2,...>
//   node render.mjs video  <w> <h> <out.mp4> [--audio a.wav] [--from s --to s] [--q 95] [--cut 15]
//   --brand <name> swaps the brand on screen for marketing/<name>/brand/brand.json (e.g. --brand swipesu)
import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import ffmpegPath from "ffmpeg-static";

const ROOT = path.dirname(new URL(import.meta.url).pathname);
const [mode, w, h, out, ...rest] = process.argv.slice(2);
const W = Number(w), H = Number(h);
const opt = { audio: "", from: 0, to: -1, q: 95, sub: 8, cut: "", brand: "" };
for (let i = 0; i < rest.length; i++) if (rest[i].startsWith("--")) opt[rest[i].slice(2)] = rest[++i];

// Motion-blurred spans: every output frame here averages `sub` sub-frames across 75 % of a frame interval.
const BLUR_15 = [[0.5, 1.02], [2.55, 6.3], [7.5, 8.1], [8.38, 11.6], [14.1, 14.6]];
const BLUR_FULL = [[0.5, 1.02], [2.55, 8.3], [9.5, 10.1], [10.38, 10.9], [10.9, 11.4], [11.4, 11.9], [11.9, 12.4], [12.4, 12.9], [12.9, 13.42], [13.42, 13.9], [13.95, 14.5], [15.38, 16.08], [16.15, 16.45], [25.1, 25.6], [18.1, 18.6], [19.85, 20.4], [21.8, 22.6]];
const BLUR = opt.cut === "15" ? BLUR_15 : BLUR_FULL;
const inBlur = (t) => BLUR.some(([a, b]) => t >= a && t <= b);

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".woff2": "font/woff2", ".svg": "image/svg+xml" };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (p === "/") p = "/index.html";
  const file = p.startsWith("/frames/") ? path.join(ROOT, p) : path.join(ROOT, "comp", p);
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": MIME[path.extname(file)] ?? "application/octet-stream", "cache-control": "max-age=3600" });
    res.end(buf);
  });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;

const frames = {};
for (const d of fs.readdirSync(path.join(ROOT, "frames"))) {
  const full = path.join(ROOT, "frames", d);
  if (fs.statSync(full).isDirectory()) frames[d] = fs.readdirSync(full).filter((f) => f.endsWith(".jpg")).length;
}

const browser = await chromium.launch({ args: ["--disable-gpu-vsync", "--force-color-profile=srgb"] });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
page.on("pageerror", (e) => console.error("pageerror:", e.message));
page.on("console", (m) => m.type() === "error" && console.error("console:", m.text()));
await page.addInitScript(`window.FRAMES = ${JSON.stringify(frames)};`);
if (opt.brand) await page.addInitScript(`window.BRAND = ${fs.readFileSync(path.join(ROOT, "..", opt.brand, "brand/brand.json"), "utf8")};`);
await page.goto(`http://127.0.0.1:${port}/?w=${W}&h=${H}${opt.cut ? `&cut=${opt.cut}` : ""}`, { waitUntil: "load" });
await page.evaluate(() => window.TRAILER.init());
const DUR = await page.evaluate(() => window.TRAILER.DURATION);
const FPS = 60;

async function shot(t, type = "jpeg") {
  await page.evaluate((x) => window.TRAILER.frame(x), t);
  return page.screenshot({ type, quality: type === "jpeg" ? Number(opt.q) : undefined, clip: { x: 0, y: 0, width: W, height: H } });
}

if (mode === "stills") {
  fs.mkdirSync(out, { recursive: true });
  for (const t of rest[0].split(",").map(Number)) {
    const buf = await shot(t, "png");
    fs.writeFileSync(path.join(out, `t${t.toFixed(2).padStart(6, "0")}.png`), buf);
  }
  console.log("stills done");
} else {
  const SUB = Number(opt.sub);
  const from = Number(opt.from);
  const to = Number(opt.to) > 0 ? Number(opt.to) : DUR;
  const n = Math.round((to - from) * FPS);
  const args = ["-y", "-hide_banner", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(FPS * SUB), "-c:v", "mjpeg", "-i", "-"];
  if (opt.audio) args.push("-ss", String(from), "-t", String(to - from), "-i", opt.audio);
  const vf = SUB > 1 ? `tmix=frames=${SUB},select='eq(mod(n\\,${SUB})\\,${SUB - 1})',setpts=N/${FPS}/TB,format=yuv420p` : "format=yuv420p";
  args.push("-vf", vf, "-r", String(FPS), "-c:v", "libx264", "-preset", "slow", "-crf", "15", "-profile:v", "high", "-tune", "film", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-movflags", "+faststart");
  if (opt.audio) args.push("-c:a", "aac", "-b:a", "320k", "-ar", "48000", "-shortest");
  // ffmpeg writes beside the target and the file is renamed once it succeeds: an mp4 only plays after ffmpeg writes
  // its index at the very end, so a half-rendered file never sits under the final name.
  const part = out.replace(/(\.mp4)?$/, ".rendering.mp4");
  args.push(part);
  const ff = spawn(ffmpegPath, args, { stdio: ["pipe", "inherit", "inherit"] });
  const write = (buf) => new Promise((r) => (ff.stdin.write(buf) ? r() : ff.stdin.once("drain", r)));
  const t0 = Date.now();
  for (let f = 0; f < n; f++) {
    const t = from + f / FPS;
    if (SUB > 1 && inBlur(t)) {
      // Sub-frames centred on t across 75 % of the frame interval.
      for (let k = 0; k < SUB; k++) await write(await shot(t + ((k + 0.5) / SUB - 0.5) * (0.75 / FPS)));
    } else {
      const buf = await shot(t);
      for (let k = 0; k < SUB; k++) await write(buf);
    }
    if (f % 60 === 0) process.stdout.write(`\r${(t).toFixed(1)}s / ${to}s  (${((Date.now() - t0) / 1000).toFixed(0)}s elapsed)`);
  }
  ff.stdin.end();
  const code = await new Promise((r) => ff.on("close", r));
  if (code !== 0) throw new Error(`ffmpeg exited with ${code}, ${part} is incomplete`);
  fs.renameSync(part, out);
  console.log(`\nwrote ${out} in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}
await browser.close();
server.close();
