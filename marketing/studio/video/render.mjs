// Renders one ad spot.
//   node render.mjs <spot> stills <w> <h> <outDir> <t1,t2,...> [--cut 6]
//   node render.mjs <spot> video  <w> <h> <out.mp4> [--audio a.wav] [--cut 6] [--sub 6] [--crf 18] [--from s --to s]
//   --brand <name> swaps the brand on screen for marketing/<name>/brand/brand.json (e.g. --brand swipesu)
import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import ffmpegPath from "ffmpeg-static";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const STUDIO = path.resolve(HERE, "..");
const FRAMES = path.resolve(STUDIO, "../trailer/frames");
const [spot, mode, w, h, out, ...rest] = process.argv.slice(2);
const W = Number(w), H = Number(h);
const opt = { audio: "", from: 0, to: -1, q: 95, sub: 6, crf: 18, cut: "", brand: "" };
const positional = [];
for (let i = 0; i < rest.length; i++) {
  if (rest[i].startsWith("--")) opt[rest[i].slice(2)] = rest[++i];
  else positional.push(rest[i]);
}

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".woff2": "font/woff2", ".svg": "image/svg+xml" };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (p === "/") p = "/index.html";
  const file = p.startsWith("/frames/") ? path.join(FRAMES, p.slice(8)) : p.startsWith("/assets/") ? path.join(STUDIO, p) : path.join(HERE, "comp", p);
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": MIME[path.extname(file)] ?? "application/octet-stream", "cache-control": "max-age=3600" });
    res.end(buf);
  });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;

const frames = {};
for (const d of fs.readdirSync(FRAMES)) {
  const full = path.join(FRAMES, d);
  if (fs.statSync(full).isDirectory()) frames[d] = fs.readdirSync(full).filter((f) => f.endsWith(".jpg")).length;
}

const browser = await chromium.launch({ args: ["--disable-gpu-vsync", "--force-color-profile=srgb"] });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
page.setDefaultTimeout(180000);
page.on("pageerror", (e) => console.error("pageerror:", e.message));
page.on("console", (m) => m.type() === "error" && console.error("console:", m.text()));
await page.addInitScript(`window.FRAMES = ${JSON.stringify(frames)};`);
if (opt.brand) await page.addInitScript(`window.BRAND = ${fs.readFileSync(path.resolve(STUDIO, "..", opt.brand, "brand/brand.json"), "utf8")};`);
await page.goto(`http://127.0.0.1:${port}/?spot=${spot}&w=${W}&h=${H}${opt.cut ? `&cut=${opt.cut}` : ""}`, { waitUntil: "load" });
await page.evaluate(() => window.AD.init());
const DUR = await page.evaluate(() => window.AD.DURATION);
const BLUR = await page.evaluate(() => window.AD.BLUR);
const inBlur = (t) => BLUR.some(([a, b]) => t >= a && t <= b);
const FPS = 60;

async function shot(t, type = "jpeg") {
  // A frame can time out when the machine is briefly starved; retry it rather than leave a truncated file.
  for (let attempt = 1; ; attempt++) {
    try {
      await page.evaluate((x) => window.AD.frame(x), t);
      return await page.screenshot({ type, quality: type === "jpeg" ? Number(opt.q) : undefined, clip: { x: 0, y: 0, width: W, height: H } });
    } catch (e) {
      if (attempt >= 3) throw e;
      console.error(`\nframe ${t.toFixed(3)}s failed (${e.name}), retrying`);
    }
  }
}

if (mode === "stills") {
  fs.mkdirSync(out, { recursive: true });
  for (const t of positional[0].split(",").map(Number)) {
    const buf = await shot(t, "png");
    fs.writeFileSync(path.join(out, `${spot}-${W}x${H}${opt.cut ? `-c${opt.cut}` : ""}-t${t.toFixed(2).padStart(5, "0")}.png`), buf);
  }
  console.log("stills done");
} else if (mode === "cover") {
  // A single PNG frame at time positional[0].
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, await shot(Number(positional[0]), "png"));
  console.log(`wrote ${out}`);
} else {
  const SUB = Number(opt.sub);
  const from = Number(opt.from);
  const to = Number(opt.to) > 0 ? Number(opt.to) : DUR;
  const n = Math.round((to - from) * FPS);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const args = ["-y", "-hide_banner", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(FPS * SUB), "-c:v", "mjpeg", "-i", "-"];
  if (opt.audio) args.push("-ss", String(from), "-t", String(to - from), "-i", opt.audio);
  const vf = SUB > 1 ? `tmix=frames=${SUB},select='eq(mod(n\\,${SUB})\\,${SUB - 1})',setpts=N/${FPS}/TB,format=yuv420p` : "format=yuv420p";
  args.push("-vf", vf, "-r", String(FPS), "-c:v", "libx264", "-preset", "medium", "-crf", String(opt.crf), "-profile:v", "high", "-pix_fmt", "yuv420p", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-movflags", "+faststart");
  if (opt.audio) args.push("-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-shortest");
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
      for (let k = 0; k < SUB; k++) await write(await shot(t + ((k + 0.5) / SUB - 0.5) * (0.75 / FPS)));
    } else {
      const buf = await shot(t);
      for (let k = 0; k < SUB; k++) await write(buf);
    }
    if (f % 120 === 0) process.stdout.write(`\r${spot} ${W}x${H}: ${t.toFixed(1)}s / ${to}s  (${((Date.now() - t0) / 1000).toFixed(0)}s elapsed)`);
  }
  ff.stdin.end();
  const code = await new Promise((r) => ff.on("close", r));
  if (code !== 0) throw new Error(`ffmpeg exited with ${code}, ${part} is incomplete`);
  fs.renameSync(part, out);
  console.log(`\nwrote ${out} in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}
await browser.close();
server.close();
