// Builds marketing/index.html (the overview) and marketing/campaigns/<id>/README.md from campaigns.mjs
// plus whatever creatives exist on disk. Run after any render: node marketing/studio/build-index.mjs
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { campaigns, LIMITS } from "./campaigns.mjs";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const MK = path.resolve(HERE, "..");
const CAMP = path.join(MK, "campaigns");
const require = createRequire(import.meta.url);
let FFMPEG = null;
try { FFMPEG = require("ffmpeg-static"); } catch {}

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const rel = (abs) => path.relative(MK, abs).split(path.sep).join("/");
const kb = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`);

function pngSize(file) {
  const b = fs.readFileSync(file);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}
function videoInfo(file) {
  if (!FFMPEG) return {};
  try { execFileSync(FFMPEG, ["-hide_banner", "-i", file], { stdio: "pipe" }); } catch (e) {
    const out = String(e.stderr || "");
    const d = out.match(/Duration: (\d+):(\d+):([\d.]+)/);
    const r = out.match(/Video: .*?, (\d{3,4})x(\d{3,4})/);
    return { dur: d ? Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]) : 0, w: r ? Number(r[1]) : 0, h: r ? Number(r[2]) : 0 };
  }
  return {};
}
function ratio(w, h) {
  const r = w / h;
  const known = [[9 / 16, "9:16"], [4 / 5, "4:5"], [1, "1:1"], [16 / 9, "16:9"], [1.91, "1.91:1"]];
  let best = known[0];
  for (const k of known) if (Math.abs(k[0] - r) < Math.abs(best[0] - r)) best = k;
  return best[1];
}
const list = (dir, ext) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => ext.some((e) => f.endsWith(e))).sort().map((f) => path.join(dir, f)) : []);

// ------------------------------------------------------------------ collect files
function collect(c) {
  const root = path.join(CAMP, c.id);
  const RANK = { "9:16": 0, "4:5": 1, "1:1": 2, "1.91:1": 3, "16:9": 4 };
  const concept = (f) => path.basename(f, ".png").replace(/-(9x16|4x5|1x1|1200x628)$/, "");
  const images = list(path.join(root, "images"), [".png"])
    .map((f) => ({ f, ...pngSize(f), size: fs.statSync(f).size }))
    .sort((a, b) => concept(a.f).localeCompare(concept(b.f)) || RANK[ratio(a.w, a.h)] - RANK[ratio(b.w, b.h)]);
  const carousel = list(path.join(root, "carousel"), [".png"]).map((f) => ({ f, ...pngSize(f), size: fs.statSync(f).size }));
  const vdir = path.join(root, "video");
  let videos = list(vdir, [".mp4"]).map((f) => ({ f, ...videoInfo(f), size: fs.statSync(f).size }));
  const covers = list(vdir, [".png"]);
  if (c.id === "01-the-feed-is-playable") {
    const t = path.join(MK, "trailer", "out");
    videos = list(t, [".mp4"]).map((f) => ({ f, ...videoInfo(f), size: fs.statSync(f).size }));
    covers.push(...list(t, [".png"]));
  }
  // Per spot: full-length 9:16 first, then 4:5, then cuts.
  const vrank = (f) => (/-6s-/.test(f) ? 2 : /4x5/.test(f) ? 1 : 0);
  const spot = (f) => path.basename(f, ".mp4").replace(/-(6s-)?(9x16|4x5|16x9)$/, "");
  videos.sort((a, b) => spot(a.f).localeCompare(spot(b.f)) || vrank(a.f) - vrank(b.f));
  for (const v of videos) {
    const base = path.basename(v.f, ".mp4");
    v.cover = covers.find((p) => path.basename(p).startsWith(`${base}-cover`)) || covers.find((p) => path.basename(p, ".png") === `${base}-cover`);
  }
  const files = c.id === "05-the-ad-is-the-game" ? list(root, [".html", ".zip"]).map((f) => ({ f, size: fs.statSync(f).size })) : [];
  // The playable's 9:16 flow, in play order (portrait-/landscape- shots are QA only).
  const FLOW = ["hook", "play", "result", "swipe", "game2", "game2-play", "game3", "game3-play", "end"];
  const screens = FLOW.map((k) => path.join(root, "screens", `916-${k}.png`)).filter((f) => fs.existsSync(f)).map((f) => ({ f, ...pngSize(f), size: fs.statSync(f).size }));
  return { images, carousel, videos, files, screens };
}

// ------------------------------------------------------------------ copy deck
function copyRows(arr, limit, kind) {
  return (arr || [])
    .map((t) => {
      const n = [...t].length;
      return `<li><span class="ct">${esc(t)}</span><span class="cn${n > limit ? " over" : ""}" title="${kind}: ${limit} recommended">${n}/${limit}</span><button class="cp" data-copy="${esc(t)}" aria-label="Copy">Copy</button></li>`;
    })
    .join("");
}
function deck(c) {
  const langs = Object.entries({ en: c.copy.en, de: c.copy.de }).filter(([, v]) => v);
  const tabs = langs.length > 1 ? `<div class="langs" role="tablist">${langs.map(([l], i) => `<button role="tab" class="lang${i ? "" : " on"}" data-lang="${l}">${l.toUpperCase()}</button>`).join("")}</div>` : "";
  const blocks = langs
    .map(([l, v], i) => {
      const g = [
        ["Primary text · Meta", v.primary, LIMITS.primary],
        ["Headline · Meta", v.headline, LIMITS.headline],
        ["Description · Meta", v.description, LIMITS.description],
        ["Ad text · TikTok", v.tiktok, LIMITS.tiktok],
        ...(v.reddit ? [["Post title · Reddit", v.reddit, 300]] : []),
      ];
      return `<div class="deck${i ? "" : " on"}" data-lang="${l}">${g.map(([k, arr, lim]) => (arr ? `<h5>${k}</h5><ul class="copy">${copyRows(arr, lim, k)}</ul>` : "")).join("")}</div>`;
    })
    .join("");
  const google = c.copy.google
    ? `<h5>Google App campaigns · headlines (5)</h5><ul class="copy">${copyRows(c.copy.google.headline, LIMITS.googleHeadline, "Google headline")}</ul><h5>Google App campaigns · descriptions (5)</h5><ul class="copy">${copyRows(c.copy.google.description, LIMITS.googleDescription, "Google description")}</ul>`
    : "";
  const cards = c.carouselCards
    ? `<h5>Carousel card headline / description · Meta</h5><ol class="cards">${c.carouselCards.map(([h, d], i) => `<li><span class="mono mute">${String(i + 1).padStart(2, "0")}</span> ${esc(h)} <span class="mute">· ${esc(d)}</span></li>`).join("")}</ol>`
    : "";
  return `${tabs}${blocks}${cards}${google}<p class="cta"><span class="label">CTA button</span> ${esc(c.copy.cta)}</p>`;
}

// ------------------------------------------------------------------ media
const fig = (it, cls = "") =>
  `<figure class="img ${cls}"><a href="${rel(it.f)}" data-lightbox><img loading="lazy" src="${rel(it.f)}" width="${it.w}" height="${it.h}" alt="${esc(path.basename(it.f))}"></a><figcaption><span>${esc(path.basename(it.f, ".png"))}</span><span class="mute">${ratio(it.w, it.h)} · ${it.w}×${it.h}</span></figcaption></figure>`;
const vid = (v) =>
  `<figure class="vid r${v.w > v.h ? "h" : v.w === v.h ? "s" : v.w / v.h > 0.7 ? "f" : "v"}"><video src="${rel(v.f)}" ${v.cover ? `poster="${rel(v.cover)}"` : ""} controls muted loop playsinline preload="metadata"></video><figcaption><span>${esc(path.basename(v.f, ".mp4"))}</span><span class="mute">${v.w && v.h ? `${ratio(v.w, v.h)} · ` : ""}${v.dur ? `${v.dur.toFixed(1)} s · ` : ""}${kb(v.size)}</span></figcaption></figure>`;

function media(c, m) {
  let h = "";
  if (m.videos.length) h += `<h4>Video</h4><div class="vids">${m.videos.map(vid).join("")}</div>`;
  if (c.id === "05-the-ad-is-the-game") {
    const preview = m.files.find((f) => f.f.endsWith("-preview.html"));
    h += `<h4>Play it</h4><div class="play">${preview ? `<div class="phone"><iframe src="${rel(preview.f)}" title="Thumbcade playable ad preview" loading="lazy"></iframe></div>` : `<p class="mute">The playable is still being built.</p>`}
      <div class="files"><h5>Builds</h5><ul>${m.files.map((f) => `<li><a href="${rel(f.f)}">${esc(path.basename(f.f))}</a><span class="mono mute">${kb(f.size)}</span></li>`).join("")}</ul>
      <p class="mute small">Meta: the single HTML file (under 2 MB) plus the 6 s lead-in video from 02. TikTok and Google: ZIP. AppLovin, Unity, ironSource, Mintegral: MRAID HTML. Details are in the folder README.</p></div></div>`;
    if (m.screens.length) h += `<h4>The flow <span class="mute">· real captures, scroll sideways</span></h4><div class="strip">${m.screens.map((s) => fig(s, "tile flow")).join("")}</div>`;
  }
  if (m.carousel.length) h += `<h4>Carousel <span class="mute">· ${m.carousel.length} cards, scroll sideways</span></h4><div class="strip">${m.carousel.map((it) => fig(it, "tile")).join("")}</div>`;
  if (m.images.length) h += `<h4>Statics</h4><div class="imgs">${m.images.map((it) => fig(it)).join("")}</div>`;
  return h;
}

// ------------------------------------------------------------------ page
const data = campaigns.map((c) => ({ c, m: collect(c) }));
const count = {
  images: data.reduce((n, d) => n + d.m.images.length + d.m.carousel.length, 0),
  videos: data.reduce((n, d) => n + d.m.videos.length, 0),
  playables: data.reduce((n, d) => n + d.m.files.filter((f) => !f.f.endsWith("-preview.html")).length, 0),
};

const campaignHtml = data
  .map(({ c, m }, i) => `
<section class="campaign" id="c${c.id.slice(0, 2)}">
  <header class="ch">
    <span class="num mono">${c.id.slice(0, 2)}</span>
    <div><p class="label">${esc(c.role)}</p><h3>${esc(c.name)}</h3></div>
    <a class="folder mono" href="campaigns/${c.id}/">campaigns/${c.id}/</a>
  </header>
  <p class="hook">${esc(c.hook)}</p>
  <div class="brief">
    <div class="facts">
      <p>${esc(c.insight)}</p>
      <dl>
        <dt>Audience</dt><dd>${esc(c.audience)}</dd>
        <dt>Platforms</dt><dd>${c.platforms.map((p) => `<span class="chip">${esc(p)}</span>`).join(" ")}</dd>
        <dt>Formats</dt><dd><ul class="fmt">${c.formats.map((f) => `<li><b>${esc(f.label)}</b> <span class="mute">${esc(f.note || "")}</span></li>`).join("")}</ul></dd>
        <dt>Test</dt><dd>${esc(c.test)}</dd>
      </dl>
    </div>
    <div class="copydeck"><h4>Copy deck</h4>${deck(c)}</div>
  </div>
  ${media(c, m)}
</section>`)
  .join("\n");

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Thumbcade Campaigns</title>
<link rel="icon" href="../packages/design-tokens/brand/favicon.svg">
<style>
@font-face { font-family: "Mona Sans"; src: url("../packages/design-tokens/fonts/web/MonaSansVF.woff2") format("woff2"); font-weight: 200 900; font-stretch: 75% 125%; }
@font-face { font-family: "Departure Mono"; src: url("../packages/design-tokens/fonts/web/DepartureMono-Regular.woff2") format("woff2"); }
:root {
  --bg: #000; --surface: #0d0d10; --raised: #17171c; --line: #24242b; --line-strong: #34343d;
  --text: #f3f0e8; --dim: #a7a3ae; --mute: #6e6a78; --heat: #ff4a3d; --success: #4cc38a;
  --sans: "Mona Sans", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  --mono: "Departure Mono", ui-monospace, "SF Mono", Menlo, monospace;
  color-scheme: dark;
}
* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body { margin: 0; background: var(--bg); color: var(--text); font: 450 16px/1.55 var(--sans); -webkit-font-smoothing: antialiased; }
a { color: inherit; }
.wrap { max-width: 1280px; margin: 0 auto; padding: 0 16px; }
@media (min-width: 720px) { .wrap { padding: 0 32px; } }
.mono, .label, h5, .chip, figcaption, .cn, .cp, .lang { font-family: var(--mono); letter-spacing: .04em; }
.label { text-transform: uppercase; font-size: 12px; color: var(--dim); margin: 0; }
.mute { color: var(--mute); } .dim { color: var(--dim); } .small { font-size: 13px; }
.display { font-weight: 900; font-stretch: 125%; letter-spacing: -.02em; text-transform: uppercase; line-height: .9; }

/* top bar */
.top { position: sticky; top: 0; z-index: 10; background: rgba(0,0,0,.92); border-bottom: 1px solid var(--line); }
.top .wrap { display: flex; align-items: center; gap: 20px; height: 60px; }
.top img { height: 28px; display: block; }
.top nav { display: flex; gap: 4px; overflow-x: auto; scrollbar-width: none; margin-left: auto; }
.top nav a { font: 13px var(--mono); text-transform: uppercase; letter-spacing: .04em; color: var(--dim); text-decoration: none; padding: 8px 10px; border-radius: 6px; white-space: nowrap; }
.top nav a:hover { color: var(--text); background: var(--raised); }

/* hero */
.hero { padding: 72px 0 48px; border-bottom: 1px solid var(--line); }
.hero h1 { font-weight: 900; font-stretch: 125%; letter-spacing: -.02em; text-transform: uppercase; line-height: .9; font-size: clamp(40px, 8vw, 104px); margin: 16px 0 28px; max-width: 12ch; }
.hero h1 em { font-style: normal; color: var(--heat); }
.hero p.lede { font-size: 19px; color: var(--dim); max-width: 60ch; margin: 0; }
.stats { display: grid; grid-template-columns: repeat(2, 1fr); gap: 1px; background: var(--line); border: 1px solid var(--line); border-radius: 14px; overflow: hidden; margin-top: 40px; }
@media (min-width: 720px) { .stats { grid-template-columns: repeat(4, 1fr); } }
.stats div { background: var(--bg); padding: 18px 20px; }
.stats b { display: block; font: 36px/1.1 var(--mono); }
.stats span { font: 12px var(--mono); text-transform: uppercase; letter-spacing: .04em; color: var(--dim); }

section.block { padding: 64px 0; border-bottom: 1px solid var(--line); }
h2 { font-weight: 900; font-stretch: 125%; letter-spacing: -.02em; text-transform: uppercase; line-height: .95; font-size: clamp(30px, 4.6vw, 56px); margin: 10px 0 28px; }
h3 { font-weight: 800; font-stretch: 125%; letter-spacing: -.015em; font-size: clamp(26px, 3.4vw, 40px); line-height: 1; margin: 6px 0 0; }
h4 { font-family: var(--sans); font-weight: 800; font-stretch: 125%; font-size: 15px; text-transform: uppercase; letter-spacing: .01em; margin: 40px 0 14px; }
h5 { font-size: 12px; text-transform: uppercase; color: var(--dim); font-weight: 400; margin: 22px 0 8px; }

/* recommendation */
.recs { display: grid; gap: 1px; background: var(--line); border: 1px solid var(--line); border-radius: 18px; overflow: hidden; }
@media (min-width: 900px) { .recs { grid-template-columns: repeat(2, 1fr); } }
.recs div { background: var(--bg); padding: 26px 26px 28px; }
.recs b { font: 13px var(--mono); color: var(--heat); }
.recs h4 { margin: 10px 0 8px; font-size: 20px; text-transform: none; letter-spacing: -.01em; }
.recs p { margin: 0; color: var(--dim); }
.decision { margin-top: 28px; border: 2px solid var(--heat); border-radius: 18px; padding: 24px 26px; }
.decision h4 { margin: 0 0 8px; }
.decision p { margin: 0 0 14px; color: var(--dim); max-width: 80ch; }
table { width: 100%; min-width: 760px; border-collapse: collapse; font-size: 15px; }
.tbl { overflow-x: auto; border: 1px solid var(--line); border-radius: 14px; margin-top: 18px; }
th, td { text-align: left; padding: 12px 14px; border-bottom: 1px solid var(--line); vertical-align: top; }
th { font: 12px var(--mono); text-transform: uppercase; letter-spacing: .04em; color: var(--dim); font-weight: 400; background: var(--surface); white-space: nowrap; }
tr:last-child td { border-bottom: 0; }
td.n { font-family: var(--mono); white-space: nowrap; }
.edge { display: grid; gap: 14px; margin: 28px 0 0; padding: 0; list-style: none; }
@media (min-width: 900px) { .edge { grid-template-columns: repeat(2, 1fr); } }
.edge li { border-left: 2px solid var(--line-strong); padding: 2px 0 2px 16px; color: var(--dim); }
.edge li b { color: var(--text); font-weight: 600; }

/* campaigns */
.campaign { padding: 64px 0; border-bottom: 1px solid var(--line); scroll-margin-top: 60px; }
.ch { display: grid; grid-template-columns: auto 1fr; gap: 18px; align-items: end; }
.ch .num { font-size: 44px; line-height: 1; color: var(--heat); }
.ch .folder { grid-column: 1 / -1; font-size: 13px; color: var(--dim); text-decoration: none; justify-self: start; border: 1px solid var(--line-strong); border-radius: 6px; padding: 4px 8px; }
@media (min-width: 900px) { .ch { grid-template-columns: auto 1fr auto; } .ch .folder { grid-column: auto; justify-self: end; } }
.ch .folder:hover { color: var(--text); }
.hook { font-family: var(--sans); font-weight: 900; font-size: clamp(22px, 3vw, 34px); font-stretch: 125%; letter-spacing: -.02em; margin: 26px 0 0; padding: 18px 0; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); }
.brief { display: grid; gap: 40px; margin-top: 28px; }
@media (min-width: 1000px) { .brief { grid-template-columns: 1fr 1fr; } }
.facts > p { margin: 0 0 20px; font-size: 17px; }
dl { display: grid; grid-template-columns: 1fr; gap: 4px 20px; margin: 0; }
@media (min-width: 600px) { dl { grid-template-columns: 110px 1fr; } }
dt { font: 12px var(--mono); text-transform: uppercase; letter-spacing: .04em; color: var(--dim); padding-top: 4px; }
dd { margin: 0 0 14px; }
.chip { display: inline-block; font-size: 12px; border: 1px solid var(--line-strong); border-radius: 6px; padding: 2px 7px 1px; margin: 0 4px 6px 0; color: var(--text); }
ul.fmt { margin: 0; padding: 0; list-style: none; }
ul.fmt li { margin-bottom: 6px; }
.copydeck { background: var(--surface); border: 1px solid var(--line); border-radius: 18px; padding: 6px 22px 22px; min-width: 0; }
.copydeck h4 { margin-top: 18px; }
.langs { display: flex; gap: 6px; margin: 0 0 4px; }
.lang { background: none; color: var(--dim); border: 1px solid var(--line-strong); border-radius: 6px; padding: 6px 12px; font-size: 13px; cursor: pointer; min-height: 36px; }
.lang.on { background: var(--text); color: var(--surface); border-color: var(--text); }
.deck { display: none; } .deck.on { display: block; }
ul.copy { list-style: none; margin: 0; padding: 0; }
ul.copy li { display: grid; grid-template-columns: 1fr auto auto; gap: 10px; align-items: center; padding: 9px 0; border-bottom: 1px solid var(--line); }
ul.copy li:last-child { border-bottom: 0; }
.ct { min-width: 0; overflow-wrap: anywhere; }
.cn { font-size: 11px; color: var(--mute); }
.cn.over { color: var(--heat); }
.cp { background: var(--raised); color: var(--text); border: 1px solid var(--line-strong); border-radius: 6px; font-size: 11px; padding: 0 10px; height: 32px; cursor: pointer; text-transform: uppercase; }
.cp:hover { border-color: var(--text); }
.cp.done { color: var(--success); border-color: var(--success); }
ol.cards { margin: 0; padding: 0; list-style: none; font-size: 14px; }
ol.cards li { padding: 4px 0; }
.cta { margin: 20px 0 0; }
.cta .label { display: inline; margin-right: 6px; }

/* media */
.vids { display: flex; gap: 16px; overflow-x: auto; padding-bottom: 8px; align-items: flex-start; }
.vid { margin: 0; flex: none; }
.vid video { display: block; background: var(--surface); border-radius: 14px; border: 1px solid var(--line); }
.vid.rv video { height: 520px; aspect-ratio: 9/16; }
.vid.rf video { height: 520px; aspect-ratio: 4/5; }
.vid.rs video { height: 520px; aspect-ratio: 1; }
.vid.rh video { height: 300px; aspect-ratio: 16/9; }
@media (max-width: 600px) { .vid.rv video, .vid.rf video, .vid.rs video { height: 420px; } .vid.rh video { height: 190px; } }
figcaption { display: flex; flex-direction: column; gap: 2px; font-size: 12px; padding: 8px 2px 0; text-transform: uppercase; }
.imgs { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 18px; align-items: start; }
.img { margin: 0; min-width: 0; }
.img img { width: 100%; height: auto; display: block; border-radius: 10px; border: 1px solid var(--line); background: var(--surface); }
figcaption span:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.strip { display: flex; gap: 10px; overflow-x: auto; scroll-snap-type: x mandatory; padding-bottom: 10px; }
.strip .tile { flex: none; width: min(78vw, 380px); scroll-snap-align: start; }
.strip .tile.flow { width: min(60vw, 240px); }
.play { display: grid; gap: 28px; align-items: start; }
@media (min-width: 800px) { .play { grid-template-columns: auto 1fr; } }
.phone { width: 380px; max-width: 100%; aspect-ratio: 390/844; border: 1px solid var(--line-strong); border-radius: 36px; padding: 10px; background: var(--surface); }
.phone iframe { width: 100%; height: 100%; border: 0; border-radius: 28px; background: #000; display: block; }
.files ul { list-style: none; margin: 0 0 14px; padding: 0; }
.files li { display: flex; justify-content: space-between; gap: 12px; padding: 10px 0; border-bottom: 1px solid var(--line); }

/* checklist + footer */
.checks { list-style: none; padding: 0; margin: 0; display: grid; gap: 10px; }
.checks li { display: grid; grid-template-columns: 22px 1fr; gap: 12px; color: var(--dim); }
.checks li::before { content: ""; width: 16px; height: 16px; border: 2px solid var(--line-strong); border-radius: 4px; margin-top: 4px; }
pre { background: var(--surface); border: 1px solid var(--line); border-radius: 14px; padding: 18px; overflow-x: auto; font: 13px/1.7 var(--mono); color: var(--text); }
pre .mute { color: var(--mute); }
footer { padding: 40px 0 80px; color: var(--mute); font: 12px var(--mono); text-transform: uppercase; letter-spacing: .04em; }

/* lightbox */
dialog { padding: 0; border: 0; background: transparent; max-width: 96vw; max-height: 94vh; }
dialog::backdrop { background: rgba(0,0,0,.9); }
dialog img { max-width: 96vw; max-height: 90vh; display: block; border-radius: 10px; }
dialog form { text-align: right; } dialog button { margin-top: 8px; background: var(--raised); color: var(--text); border: 1px solid var(--line-strong); border-radius: 6px; padding: 8px 14px; font: 12px var(--mono); cursor: pointer; }
:focus-visible { outline: 2px solid var(--heat); outline-offset: 2px; }
</style>
</head>
<body>
<div class="top"><div class="wrap">
  <a href="#top" aria-label="Thumbcade"><img src="../packages/design-tokens/brand/lockup.svg" alt="thumbcade"></a>
  <nav aria-label="Sections"><a href="#strategy">Strategy</a>${campaigns.map((c) => `<a href="#c${c.id.slice(0, 2)}">${c.id.slice(0, 2)} ${esc(c.short)}</a>`).join("")}<a href="#plan">Test plan</a><a href="#specs">Specs</a><a href="#files">Files</a></nav>
</div></div>

<main id="top">
<section class="hero"><div class="wrap">
  <p class="label">Paid launch campaigns · October 2026 · pre-launch</p>
  <h1>Six campaigns. One idea: the feed is now <em>playable.</em></h1>
  <p class="lede">Platform analysis and ready-to-upload creatives for Meta, TikTok, Apple Ads, Google and Reddit. All gameplay is real and captured from the launch games, and the playable ad is the actual games. The full reasoning is in <a href="STRATEGY.md">STRATEGY.md</a>.</p>
  <div class="stats">
    <div><b>6</b><span>campaigns</span></div>
    <div><b>${count.images}</b><span>statics + carousel cards</span></div>
    <div><b>${count.videos}</b><span>videos</span></div>
    <div><b>${count.playables}</b><span>playable builds</span></div>
  </div>
</div></section>

<section class="block" id="strategy"><div class="wrap">
  <p class="label">The analysis</p>
  <h2>Where to run it</h2>
  <div class="recs">
    <div><b>01</b><h4>Meta is the main scale channel</h4><p>Run an Advantage+ app campaign. It takes video, playable, carousel and statics in one campaign, and targets only by country, OS and language, so the creative does the targeting. That's why there are six concepts here, not one ad in many sizes.</p></div>
    <div><b>02</b><h4>TikTok is the closest fit</h4><p>The product is "TikTok for minigames", with the same swipe. Lead with 9:16 gameplay video and Spark Ads on our own posts. Playables now run on TikTok app campaigns through Smart+.</p></div>
    <div><b>03</b><h4>Apple Ads and Google pre-registration run today</h4><p>Neither needs an app change. Apple counts installs in its own dashboard. Google Play pre-registration can start before launch.</p></div>
    <div><b>04</b><h4>Win with the playable</h4><p>Our games are HTML5, so the playable ad is the real product in a category known for fake gameplay ads. It also works as an honesty signal no competitor can easily copy.</p></div>
  </div>
  <div class="decision">
    <p class="label" style="color:var(--heat)">Decision needed before launch spend</p>
    <h4>Install measurement</h4>
    <p>Meta and TikTok optimise for installs only with their SDK or an MMP. The app has neither, by design: no IDFA, no tracking, and it must run in Expo Go. Recommendation: one MMP in the store build, SKAN only on iOS (no ATT prompt), consent-gated on Android in the EU. Until then, run Apple Ads, Google pre-registration, organic video and the creator campaign. The options are compared in STRATEGY.md.</p>
  </div>
  <div class="tbl"><table>
    <thead><tr><th>Platform</th><th>Why it fits</th><th>Our formats</th><th>Role</th><th>Budget</th></tr></thead>
    <tbody>
      <tr><td><b>Meta</b><br><span class="mute small">Reels · Stories · Feed · AN</span></td><td>Largest reach. All four install formats in one campaign. Playable supported.</td><td>Video 9:16 + 4:5, playable, 10-card carousel, statics</td><td>Scale engine</td><td class="n">40%</td></tr>
      <tr><td><b>TikTok</b></td><td>The product's own interaction model. Spark Ads on organic posts. Playable ZIP via Smart+.</td><td>Video 9:16, playable ZIP</td><td>Creative-led growth</td><td class="n">30%</td></tr>
      <tr><td><b>Apple Ads</b></td><td>High intent. Privacy-native attribution. Today tab and custom product pages.</td><td>Custom product pages mirroring 03 and 04</td><td>iOS intent</td><td class="n">15%</td></tr>
      <tr><td><b>Google App</b></td><td>Pre-registration now. Shorts, Play and AdMob at launch. HTML5 playable.</td><td>5 headlines, 5 descriptions, 1:1 / 4:5 / 1.91:1, videos, HTML5 ZIP</td><td>Android volume</td><td class="n">10%</td></tr>
      <tr><td><b>Reddit · X</b></td><td>Developers, who make up the supply side, respond to honest, technical ads.</td><td>Terminal statics, 5-card carousel</td><td>Creators (06)</td><td class="n">5%</td></tr>
    </tbody>
  </table></div>
  <ul class="edge">
    <li><b>Real gameplay only.</b> Several game advertisers were ruled against by the UK ASA for showing gameplay that isn't in the app, and players notice. Every frame and score here is captured from a real run.</li>
    <li><b>Restraint stands out.</b> Ink, warm paper and one arcade-button red with editorial type, in a feed of saturated chaos. The games bring the colour.</li>
    <li><b>The ad looks like the product.</b> The feed card is the real app chrome, rebuilt from the design tokens, so in Reels and TikTok it reads as native content.</li>
    <li><b>The category is open.</b> TikTok retired HTML5 mini games in September 2026, and YouTube Playables lives inside YouTube. A native, swipe-first feed with a creator platform is still free to claim. No competitors are named in the ads.</li>
  </ul>
</div></section>

${`<div class="wrap">${campaignHtml}</div>`}

<section class="block" id="plan"><div class="wrap">
  <p class="label">First four weeks after launch</p>
  <h2>Test plan</h2>
  <div class="tbl"><table>
    <thead><tr><th>Metric</th><th>Definition</th><th>Target</th><th>Benchmark</th></tr></thead>
    <tbody>
      <tr><td>Hook rate</td><td>3 s views ÷ impressions</td><td class="n">&gt; 30%</td><td class="mute">Creative quality in the first second</td></tr>
      <tr><td>Hold rate</td><td>ThruPlays ÷ 3 s views</td><td class="n">&gt; 25%</td><td class="mute">Does the story carry</td></tr>
      <tr><td>Link CTR</td><td>Link clicks ÷ impressions</td><td class="n">≥ 1.0% Meta · ≥ 1.5% TikTok</td><td class="mute">Meta Feed 0.5–1.5%, TikTok in-feed 0.8–2.5% (Admiral Media 2025)</td></tr>
      <tr><td>IPM</td><td>Installs per 1,000 impressions</td><td class="n">&gt; 8.6</td><td class="mute">Gaming average (Adjust 2026)</td></tr>
      <tr><td>CPI</td><td>Spend ÷ installs</td><td class="n">Watch, don't chase</td><td class="mute">Casual puzzle €1–3.50 iOS (Admiral Media 2025)</td></tr>
      <tr><td>D1 retention</td><td>Day-1 returning ÷ installs</td><td class="n">The verdict</td><td class="mute">Cuts creatives that click but don't stay</td></tr>
    </tbody>
  </table></div>
  <ul class="edge">
    <li><b>Week 0–1.</b> One Advantage+ app campaign per OS with campaigns 01–05 loaded (about 20 creatives). 06 runs separately as Traffic. Judge each creative after about 50 installs.</li>
    <li><b>Kill or keep.</b> After 5,000 impressions, pause anything with CTR under 0.6% or hook rate under 20%. Copy the winning hook onto other games (03 is built for this).</li>
    <li><b>Week 2–4.</b> Make new versions of the top two concepts: a new opening game, a new score, DE and EN copy. Refresh every 2–3 weeks.</li>
    <li><b>Geo and age.</b> DACH in German, plus UK, NL and the Nordics in English. 18+ (DSA Art. 28). Add lower-CPI EU markets once D1 holds.</li>
  </ul>
</div></section>

<section class="block" id="specs"><div class="wrap">
  <p class="label">Upload cheat sheet</p>
  <h2>Specs</h2>
  <div class="tbl"><table>
    <thead><tr><th>Placement</th><th>Our file</th><th>Safe zone / limits</th></tr></thead>
    <tbody>
      <tr><td>Meta Reels + Stories</td><td class="n">9:16 · 1080×1920</td><td>Keep text out of the top 14%, the bottom 35% and 6% on each side. Primary text 125 chars (Reels shows about 44).</td></tr>
      <tr><td>Meta Feed</td><td class="n">4:5 · 1080×1350 (or 1:1)</td><td>Primary text 125, headline 27–40, description about 30 chars</td></tr>
      <tr><td>Meta carousel</td><td class="n">1:1 · 1080×1080 · 10 cards</td><td>2–10 cards. Card headline 20 and description 18 recommended.</td></tr>
      <tr><td>Meta playable</td><td class="n">thumbcade-playable-meta.html</td><td>Single HTML under 2 MB, FbPlayableAd.onCTAClick(), no network, no mraid.js, plus a lead-in video</td></tr>
      <tr><td>TikTok in-feed</td><td class="n">9:16 · 1080×1920</td><td>Ad text 100 chars. Make the point within 3 s. Keep the right rail and the caption area clear.</td></tr>
      <tr><td>TikTok playable</td><td class="n">thumbcade-playable-tiktok.zip</td><td>ZIP at most 5 MB with index.html + config.json and window.openAppStore()</td></tr>
      <tr><td>Google App campaigns</td><td class="n">1:1 · 4:5 · 1.91:1 (1200×628) · HTML5 ZIP</td><td>5 headlines (30), 5 descriptions (90), videos via YouTube, HTML5 with ExitApi</td></tr>
      <tr><td>Reddit · X</td><td class="n">1:1 · 4:5 · 1.91:1</td><td>Native, technical tone. Titles in the 06 copy deck.</td></tr>
    </tbody>
  </table></div>
  <h4>Before uploading</h4>
  <ul class="checks">
    <li>Store listings are live, so the end-card line "Free on iPhone + Android" is true. Store URLs are set in the playable config.</li>
    <li>Claims still hold: "12 games" is the launch library, "Free" (no IAP in v1), "no account needed" (guest mode). Confirm the review turnaround before running "by Friday" (06).</li>
    <li>No fabricated social proof: the feed cards show no like or play counts, and there are no ratings or user numbers.</li>
    <li>No fake system UI or fake buttons (Meta policy). Real gameplay only (ASA, TikTok, Google policies).</li>
    <li>18+ targeting in the EU. The game names' formal trademark clearance is still open (docs/GAPS.md).</li>
  </ul>
</div></section>

<section class="block" id="files"><div class="wrap">
  <p class="label">Everything lives in marketing/</p>
  <h2>Files</h2>
<pre>marketing/
  index.html               <span class="mute">this page (generated)</span>
  STRATEGY.md              <span class="mute">platform analysis, measurement decision, test plan, sources</span>
  campaigns/
    01-the-feed-is-playable/   <span class="mute">images/ · teaser video lives in trailer/out/</span>
    02-swipe-for-the-next-game/ <span class="mute">carousel/ · images/ · video/</span>
    03-beat-this/              <span class="mute">images/ · video/</span>
    04-zero-installs/          <span class="mute">images/ · video/</span>
    05-the-ad-is-the-game/     <span class="mute">playable builds · screens/</span>
    06-ship-to-the-feed/       <span class="mute">carousel/ · images/</span>
  studio/                  <span class="mute">generators: statics/, video/, playable/, campaigns.mjs (copy), build-index.mjs</span>
  trailer/                 <span class="mute">the teaser trailer and the gameplay capture pipeline</span></pre>
<pre><span class="mute"># regenerate everything</span>
cd marketing/trailer &amp;&amp; npm install &amp;&amp; bash prepare.sh   <span class="mute"># real gameplay frames</span>
cd ../studio &amp;&amp; npm install &amp;&amp; bash prepare.sh             <span class="mute"># fonts, brand, icons</span>
node statics/render.mjs                                    <span class="mute"># statics + carousels</span>
<span class="mute"># videos: see studio/video/README.md · playable: node playable/build.mjs &amp;&amp; node playable/verify.mjs</span>
node build-index.mjs                                       <span class="mute"># this page + campaign READMEs</span></pre>
</div></section>
</main>
<footer><div class="wrap">Thumbcade · internal · generated ${new Date().toISOString().slice(0, 10)}</div></footer>

<dialog id="lb"><img alt=""><form method="dialog"><button>Close</button></form></dialog>
<script>
document.addEventListener("click", async (e) => {
  const cp = e.target.closest(".cp");
  if (cp) {
    const t = cp.dataset.copy;
    try { await navigator.clipboard.writeText(t); } catch { const a = document.createElement("textarea"); a.value = t; document.body.appendChild(a); a.select(); document.execCommand("copy"); a.remove(); }
    cp.textContent = "Copied"; cp.classList.add("done");
    setTimeout(() => { cp.textContent = "Copy"; cp.classList.remove("done"); }, 1400);
    return;
  }
  const lang = e.target.closest(".lang");
  if (lang) {
    const box = lang.closest(".copydeck");
    box.querySelectorAll(".lang").forEach((b) => b.classList.toggle("on", b === lang));
    box.querySelectorAll(".deck").forEach((d) => d.classList.toggle("on", d.dataset.lang === lang.dataset.lang));
    return;
  }
  const a = e.target.closest("a[data-lightbox]");
  if (a) {
    e.preventDefault();
    const d = document.getElementById("lb");
    d.querySelector("img").src = a.getAttribute("href");
    d.showModal();
  }
});
document.getElementById("lb").addEventListener("click", (e) => { if (e.target.id === "lb") e.currentTarget.close(); });
</script>
</body>
</html>
`;
fs.writeFileSync(path.join(MK, "index.html"), html);

// ------------------------------------------------------------------ campaign READMEs
for (const { c, m } of data) {
  const lines = [];
  lines.push(`# ${c.id.slice(0, 2)} · ${c.name}`, "", `**${c.role}.** Hook: **${c.hook}**`, "", c.insight, "");
  lines.push(`- **Audience:** ${c.audience}`, `- **Platforms:** ${c.platforms.join(" · ")}`, `- **Test:** ${c.test}`, "");
  lines.push("## Creatives", "");
  for (const f of c.formats) lines.push(`- **${f.label}**${f.note ? `: ${f.note}` : ""}`);
  lines.push("");
  const row = (it) => `| \`${rel(it.f).replace(`campaigns/${c.id}/`, "")}\` | ${it.w && it.h ? `${ratio(it.w, it.h)} · ${it.w}×${it.h}` : ""}${it.dur ? ` · ${it.dur.toFixed(1)} s` : ""} | ${kb(it.size)} |`;
  const all = [...m.videos, ...m.carousel, ...m.images, ...m.files];
  if (all.length) lines.push("| File | Format | Size |", "|---|---|---|", ...all.map(row), "");
  if (c.id === "01-the-feed-is-playable") lines.push("The video for this campaign is the teaser in `marketing/trailer/out/` (15 s and 26.5 s, 9:16 and 16:9).", "");
  lines.push("## Copy deck", "");
  for (const [lang, v] of Object.entries({ English: c.copy.en, Deutsch: c.copy.de })) {
    if (!v) continue;
    lines.push(`### ${lang}`, "");
    const g = [["Primary text (Meta, 125)", v.primary], ["Headline (Meta, 27–40)", v.headline], ["Description (Meta)", v.description], ["Ad text (TikTok, 100)", v.tiktok], ["Post title (Reddit)", v.reddit]];
    for (const [k, arr] of g) if (arr) lines.push(`**${k}**`, "", ...arr.map((t) => `- ${t} _(${[...t].length})_`), "");
  }
  if (c.carouselCards) lines.push("### Carousel cards (headline · description)", "", ...c.carouselCards.map(([h, d], i) => `${i + 1}. ${h} · ${d}`), "");
  if (c.copy.google) lines.push("### Google App campaigns", "", "**Headlines (30)**", "", ...c.copy.google.headline.map((t) => `- ${t} _(${t.length})_`), "", "**Descriptions (90)**", "", ...c.copy.google.description.map((t) => `- ${t} _(${t.length})_`), "");
  lines.push(`**CTA button:** ${c.copy.cta}`, "", "Regenerate this file with `node marketing/studio/build-index.mjs`. The copy lives in `marketing/studio/campaigns.mjs`.", "");
  const out = path.join(CAMP, c.id, c.id === "05-the-ad-is-the-game" ? "BRIEF.md" : "README.md");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, lines.join("\n"));
}

// Over-limit copy is a build warning, not an error.
for (const c of campaigns) for (const [k, v] of Object.entries(c.copy)) {
  if (!v || typeof v !== "object") continue;
  for (const t of v.primary || []) if ([...t].length > LIMITS.primary) console.warn(`[${c.id} ${k}] primary over ${LIMITS.primary}: ${t}`);
  for (const t of v.headline || []) if ([...t].length > (k === "google" ? LIMITS.googleHeadline : LIMITS.headline)) console.warn(`[${c.id} ${k}] headline too long: ${t}`);
  for (const t of v.tiktok || []) if ([...t].length > LIMITS.tiktok) console.warn(`[${c.id} ${k}] tiktok over 100: ${t}`);
}
console.log(`index.html: ${count.images} images, ${count.videos} videos, ${count.playables} playable builds`);
