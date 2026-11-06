// Verifies every playable build in headless Chromium and shoots the screens for the overview page.
//
//   node marketing/studio/playable/verify.mjs
//
// For each network build, portrait (390x844, touch) and landscape (844x390):
//   - zero network requests beyond the document (the network's own SDK script is served as a stub);
//   - no page errors or console errors;
//   - a tap starts game 1, a swipe up reaches game 2 and 3, a swipe on the last game reaches the end card;
//   - the end card's CTA calls the network's click-through (FbPlayableAd.onCTAClick, mraid.open,
//     window.openAppStore, ExitApi.exit, or the preview toast).
// Screens go to marketing/campaigns/05-the-ad-is-the-game/screens/.
import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const REPO = path.resolve(HERE, "../../..");
const OUT = path.join(REPO, "marketing/campaigns/05-the-ad-is-the-game");
const SCREENS = path.join(OUT, "screens");
fs.mkdirSync(SCREENS, { recursive: true });

const BUILDS = {
  meta: path.join(OUT, "thumbcade-playable-meta.html"),
  mraid: path.join(OUT, "thumbcade-playable-mraid.html"),
  tiktok: path.join(HERE, ".cache/tiktok/index.html"),
  google: path.join(HERE, ".cache/google/index.html"),
  preview: path.join(OUT, "thumbcade-playable-preview.html"),
};

// Stand-ins for what each network injects. Each records the click-through on window.__clicks.
const STUBS = {
  "mraid.js": `window.__clicks = [];
window.mraid = (function () {
  var l = {}; var state = "loading";
  setTimeout(function () { state = "default"; (l.ready || []).forEach(function (f) { f(); }); }, 50);
  return {
    getVersion: function () { return "3.0"; }, getState: function () { return state; }, isViewable: function () { return true; },
    addEventListener: function (e, f) { (l[e] = l[e] || []).push(f); }, removeEventListener: function (e, f) { l[e] = (l[e] || []).filter(function (x) { return x !== f; }); },
    open: function (url) { window.__clicks.push("mraid.open " + url); },
  };
})();`,
  "Playable-sdk.js": `window.__clicks = []; window.openAppStore = function () { window.__clicks.push("openAppStore"); };`,
  "exitapi.js": `window.__clicks = []; window.ExitApi = { exit: function () { window.__clicks.push("ExitApi.exit"); } };`,
};
const META_STUB = `window.__clicks = []; window.FbPlayableAd = { onCTAClick: function () { window.__clicks.push("FbPlayableAd.onCTAClick"); } };`;

const server = http.createServer((req, res) => {
  const name = decodeURIComponent(new URL(req.url, "http://x").pathname.slice(1));
  const file = BUILDS[name.replace(/\.html$/, "")];
  if (!file) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(fs.readFileSync(file));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({ args: ["--enable-webgl", "--ignore-gpu-blocklist", "--use-angle=metal", "--autoplay-policy=user-gesture-required"] });
const results = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function run(network, view, opts = {}) {
  const [w, h, dpr] = view;
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const blocked = [];
  const errors = [];
  const docUrl = `${ORIGIN}/${network}.html`;
  await ctx.route("**/*", (route) => {
    const url = route.request().url();
    if (url === docUrl) return route.continue();
    const stub = Object.keys(STUBS).find((k) => url.endsWith("/" + k));
    if (stub && ((stub === "mraid.js" && network === "mraid") || (stub === "Playable-sdk.js" && network === "tiktok") || (stub === "exitapi.js" && network === "google"))) {
      return route.fulfill({ status: 200, contentType: "text/javascript", body: STUBS[stub] });
    }
    if (url.startsWith("data:") || url.startsWith("blob:") || url.startsWith("about:")) return route.continue();
    blocked.push(url);
    return route.abort();
  });
  if (network === "meta") await page.addInitScript(META_STUB);
  if (network === "preview") await page.addInitScript("window.__clicks = [];");
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
  const cdp = await ctx.newCDPSession(page);
  const state = () => page.evaluate(() => window.__tcState());
  const until = async (pred, ms, what) => {
    const t0 = Date.now();
    for (;;) {
      const s = await state();
      if (pred(s)) return s;
      if (Date.now() - t0 > ms) throw new Error(`timeout waiting for ${what}: ${JSON.stringify(s)}`);
      await sleep(100);
    }
  };
  const touch = (type, x, y) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y }] });
  const tap = async (x, y) => { await touch("touchStart", x, y); await sleep(60); await touch("touchEnd"); };
  /** Drags from y0 to y1; `hold(k)` runs at the midpoint (screenshots of the swipe moment). */
  const swipe = async (y0, y1, hold) => {
    const x = w * 0.42;
    await touch("touchStart", x, y0);
    for (let i = 1; i <= 10; i++) {
      await touch("touchMove", x, y0 + ((y1 - y0) * i) / 10);
      await sleep(16);
      if (i === 5 && hold) await hold();
    }
    await touch("touchEnd");
  };
  const shot = (name) => opts.shots ? page.screenshot({ path: path.join(SCREENS, `${name}.png`) }) : null;
  const steps = [];
  const step = (s) => { steps.push(s); if (process.env.VERBOSE) console.log(`  ${network} ${w}x${h}: ${s}`); };

  await page.goto(docUrl, { waitUntil: "load" });
  await until((s) => s.ready, 12000, "game 1 ready");
  step("game 1 ready");
  await sleep(1400);
  await shot(`${opts.prefix}hook`);

  // Game 1: tap to play, then keep tapping until the run ends (Stackd: every tap drops a slab).
  await tap(w / 2, h * 0.55);
  await until((s) => s.phase === "playing", 3000, "game 1 run");
  step("tap started game 1");
  await sleep(1200);
  await shot(`${opts.prefix}play`);
  for (let i = 0; i < 40 && (await state()).phase === "playing"; i++) { await tap(w / 2, h * 0.55); await sleep(i % 3 === 0 ? 1100 : 500); }
  const s1 = await until((s) => s.phase === "over", 30000, "game 1 over");
  step(`game 1 over (played ${s1.played.join(",")})`);
  await sleep(900);
  await shot(`${opts.prefix}result`);

  // Swipe up to game 2, with a frame at the halfway point.
  await swipe(h * 0.82, h * 0.18, async () => { await sleep(60); await shot(`${opts.prefix}swipe`); });
  await until((s) => s.cur === 1 && !s.onEnd, 3000, "game 2");
  await until((s) => s.ready, 8000, "game 2 ready");
  step("swipe reached game 2");
  await sleep(900);
  await shot(`${opts.prefix}game2`);
  await tap(w / 2, h * 0.5);
  await until((s) => s.phase === "playing" || s.phase === "over", 3000, "game 2 run");
  for (let i = 0; i < 6; i++) { await tap(w / 2, h * 0.5); await sleep(260); }
  await shot(`${opts.prefix}game2-play`);
  step("tap started game 2");

  // Swipe mid-run to game 3.
  await swipe(h * 0.8, h * 0.2);
  await until((s) => s.cur === 2, 3000, "game 3");
  await until((s) => s.ready, 8000, "game 3 ready");
  step("swipe reached game 3");
  await sleep(900);
  await shot(`${opts.prefix}game3`);
  await tap(w / 2, h * 0.55);
  await until((s) => s.phase === "playing", 3000, "game 3 run");
  step("tap started game 3");
  await sleep(1500);
  await shot(`${opts.prefix}game3-play`);

  // Swipe on the last game: the end card.
  await swipe(h * 0.8, h * 0.2);
  const end = await until((s) => s.onEnd, 3000, "end card");
  step(`end card (alive frames: ${end.alive})`);
  await sleep(700);
  await shot(`${opts.prefix}end`);
  const max = await page.evaluate(() => document.querySelectorAll("iframe").length);

  await page.click("#cta-end");
  await sleep(200);
  const clicks = await page.evaluate(() => window.__clicks || []);
  const cta = await page.evaluate(() => window.__tcCta || 0);
  if (network === "preview") {
    if (!(await page.evaluate(() => window.__tcCtaCount))) throw new Error("preview toast did not fire");
  } else if (!clicks.length) throw new Error(`${network}: CTA did not reach the network (${JSON.stringify(clicks)})`);
  step(`CTA -> ${network === "preview" ? "toast" : clicks.join(", ")} (${cta})`);

  await ctx.close();
  const ok = blocked.length === 0 && errors.length === 0;
  results.push({ network, view: `${w}x${h}`, ok, steps, blocked, errors, framesAtEnd: max });
}

const PORTRAIT = [390, 844, 2];
const LANDSCAPE = [844, 390, 2];
const STILLS = [360, 640, 3]; // 1080x1920
const ONLY = process.argv.slice(2);
for (const network of Object.keys(BUILDS).filter((n) => !ONLY.length || ONLY.includes(n))) {
  for (const [view, opts] of [
    [PORTRAIT, { shots: network === "preview", prefix: "portrait-" }],
    [LANDSCAPE, { shots: network === "preview", prefix: "landscape-" }],
  ]) {
    try {
      await run(network, view, opts);
    } catch (e) {
      results.push({ network, view: `${view[0]}x${view[1]}`, ok: false, steps: [], blocked: [], errors: [String(e.message || e)] });
    }
  }
}
// The 9:16 still set for the overview page (1080x1920).
try { await run("preview", STILLS, { shots: true, prefix: "916-" }); } catch (e) { results.push({ network: "preview", view: "1080x1920 stills", ok: false, steps: [], blocked: [], errors: [String(e)] }); }

await browser.close();
server.close();
let failed = 0;
for (const r of results) {
  console.log(`${r.ok ? "PASS" : "FAIL"} ${r.network} ${r.view}  ${r.steps.join(" > ")}`);
  if (r.blocked.length) console.log("  blocked requests:", r.blocked);
  if (r.errors.length) console.log("  errors:", r.errors.slice(0, 6));
  if (!r.ok) failed++;
}
process.exit(failed ? 1 : 0);
