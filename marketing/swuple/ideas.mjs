/**
 * Six logo directions for swuple, each from something only this product has: the game card in the feed, the swipe to
 * the next game, a poster turning live, the games bringing the color. One board per idea (icon, idea, lockups,
 * motion or system, small sizes) and an overview. Concepts, not final artwork.
 *
 *   node marketing/swuple/ideas.mjs         -> marketing/swuple/concepts/ideas-*.png
 */
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { P, appIcon, f, glyphAt, label, lerp, loadFont, place, text, writeSheet } from "./sketch-kit.mjs";
import { curve, stroke } from "./swipe-geometry.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(resolve(HERE, "../../packages/design-tokens/package.json"));
const sharp = require("sharp");
const FRAMES = resolve(HERE, "../trailer/frames");
const BODY = loadFont("MonaSans-Medium.ttf");
const H = P.heat;

/** Launch games' accent colors, from their manifests. */
const ACCENT = {
  stackd: "#3DE0FF", shortwick: "#B48CFF", kingsnare: "#5CF2B8", heatfall: "#FFE14D", pairs: "#FF6FB5",
  duskrail: "#FF6A1A", voltbrick: "#4D8DFF", snek: "#4DFF88", flapjack: "#FFB23F", "neon-chop": "#FF3D6E",
};

/**
 * A frame of real gameplay (the trailer's capture) as a data URI: the whole 9:16 frame, or with `square` the 1080
 * square starting at that y, where the game's action is. `pixels` > 0 resamples it into that many blocks across.
 */
const SHOT = { duskrail: ["f00240", 760], kingsnare: ["f00480", 300], voltbrick: ["f00480", 180], heatfall: ["f00480", 560], "neon-chop": ["f00480", 420], stackd: ["f00480", 840] };
const frameCache = new Map();
async function frame(game, { square = false, pixels = 0 } = {}) {
  const key = `${game}:${square}:${pixels}`;
  if (!frameCache.has(key)) {
    const [file, top] = SHOT[game];
    let img = sharp(resolve(FRAMES, game, `${file}.jpg`));
    const [w, h] = square ? [540, 540] : [540, 960];
    img = square ? img.extract({ left: 0, top, width: 1080, height: 1080 }).resize(w, h) : img.resize(w, h);
    if (pixels) {
      const small = await img.resize(pixels, Math.round((pixels * h) / w), { kernel: "cubic" }).toBuffer();
      img = sharp(small).resize(w, h, { kernel: "nearest" });
    }
    frameCache.set(key, `data:image/jpeg;base64,${(await img.jpeg({ quality: 84 }).toBuffer()).toString("base64")}`);
  }
  return frameCache.get(key);
}

let uid = 0;
const id = (p) => `${p}${uid++}`;
const rrect = (x, y, w, h, r, fill, extra = "") => `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" rx="${f(r)}" fill="${fill}" ${extra}/>`;

// ---------------------------------------------------------------------------
// 1 The card: one game leaving, the next rising. Inside the card, any game.
// ---------------------------------------------------------------------------

async function card(game = "duskrail") {
  const c = id("card");
  const [w, h, r] = [520, 924, 74];
  const x = 512 - w / 2;
  return appIcon(
    `${rrect(x, 866, w, h, r, H)}${rrect(512 - 56, 896, 112, 16, 8, P.ink1, 'opacity="0.55"')}
    <g transform="rotate(-4 512 380)"><defs><clipPath id="${c}"><rect x="${x}" y="-150" width="${w}" height="${h}" rx="${r}"/></clipPath></defs>
      <image href="${await frame(game)}" x="${x}" y="-150" width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${c})"/>
      ${rrect(x, -150, w, h, r, "none", `stroke="${P.paper}" stroke-opacity="0.16" stroke-width="6"`)}</g>`,
    P.ink1,
  );
}

// ---------------------------------------------------------------------------
// 2 Split-flap: the next game flips in, folding up.
// ---------------------------------------------------------------------------

/**
 * One flap tile centered on (cx, cy). `p` 0..1 is a flip upward from `from` to `to`: the lower flap swings up on the
 * hinge toward the viewer (foreshortened, its free edge widening in perspective), uncovering `to`'s lower half, and
 * lands over the upper half showing `to`'s upper half.
 */
function flap(cx, cy, w, h, to, { from = "", p = 1, size = h * 0.62, light = false, pins = true } = {}) {
  const k = id("flap");
  const half = h / 2;
  const [x0, y0] = [cx - w / 2, cy - half];
  const r = w * 0.09;
  // Lit from above: the upper half a touch lighter than the lower.
  const [topFill, botFill, flapFill] = light ? [P.ink2, P.ink1, P.ink3] : ["#2A2A31", "#202026", "#3A3A44"];
  const glyph = (ch) => (ch ? glyphAt(ch, size, cx, cy, P.paper) : "");
  const half_ = (top) => `<clipPath id="${k}-${top ? "t" : "b"}"><rect x="${x0}" y="${top ? y0 : cy}" width="${w}" height="${half}"/></clipPath>`;
  let moving = "";
  if (p > 0 && p < 1) {
    const s = Math.abs(Math.cos(Math.PI * p));
    const up = p > 0.5;
    const fh = half * s;
    const spread = w * 0.07 * (1 - s);
    const edge = up ? cy - fh : cy + fh;
    const quad = `M${f(x0)} ${f(cy)}L${f(x0 + w)} ${f(cy)}L${f(x0 + w + spread)} ${f(edge)}L${f(x0 - spread)} ${f(edge)}Z`;
    // The half letter the flap carries, squashed toward the hinge and widened like the flap.
    const ch = up ? to : from;
    const sx = 1 + (2 * spread) / w;
    moving = `<clipPath id="${k}-f"><path d="${quad}"/></clipPath><path d="${quad}" fill="${flapFill}"/>
      <g clip-path="url(#${k}-f)"><g transform="translate(${f(cx)} ${f(cy)}) scale(${f(sx)} ${f(s)}) translate(${f(-cx)} ${f(-cy)})">${glyph(ch)}</g></g>`;
  }
  const topCh = p >= 1 ? to : from;
  const botCh = p > 0 ? to : from;
  const pin = (x) => rrect(x, cy - h * 0.055, w * 0.045, h * 0.11, w * 0.016, light ? P.ink4 : H);
  return `<defs>${half_(true)}${half_(false)}</defs>
    <path d="M${x0} ${cy}V${y0 + r}Q${x0} ${y0} ${x0 + r} ${y0}H${x0 + w - r}Q${x0 + w} ${y0} ${x0 + w} ${y0 + r}V${cy}Z" fill="${topFill}"/>
    <path d="M${x0} ${cy}V${y0 + h - r}Q${x0} ${y0 + h} ${x0 + r} ${y0 + h}H${x0 + w - r}Q${x0 + w} ${y0 + h} ${x0 + w} ${y0 + h - r}V${cy}Z" fill="${botFill}"/>
    <g clip-path="url(#${k}-t)">${glyph(topCh)}</g><g clip-path="url(#${k}-b)">${glyph(botCh)}</g>
    <rect x="${x0}" y="${f(cy - h * 0.012)}" width="${w}" height="${f(h * 0.024)}" fill="${P.ink0}"/>${moving}
    ${pins ? pin(x0 - w * 0.03) + pin(x0 + w - w * 0.015) : ""}`;
}
const flapIcon = (p = 0.72) => appIcon(flap(512, 512, 640, 780, "S", { p }), P.ink1);
const flapWord = (x, cy, tw, light) =>
  [..."SWUPLE"].map((ch, i) => flap(x + tw / 2 + i * tw * 1.08, cy, tw, tw * 1.26, ch, { light, size: tw * 0.8, pins: false })).join("");

// ---------------------------------------------------------------------------
// 3 The snake: an S on the grid, heading up, its tail fading into the feed.
// ---------------------------------------------------------------------------

/** The S as grid cells from tail to head: bottom stroke, lower bowl, spine, upper bowl, top stroke, then up. */
const SNAKE = (() => {
  const cells = [];
  const run = (c0, r0, c1, r1) => {
    const n = Math.max(Math.abs(c1 - c0), Math.abs(r1 - r0));
    for (let i = 0; i <= n; i++) {
      const cell = [c0 + Math.sign(c1 - c0) * i, r0 + Math.sign(r1 - r0) * i];
      const last = cells[cells.length - 1];
      if (!last || last[0] !== cell[0] || last[1] !== cell[1]) cells.push(cell);
    }
  };
  run(0, 10, 6, 10);
  run(6, 10, 6, 5);
  run(6, 5, 0, 5);
  run(0, 5, 0, 0);
  run(0, 0, 5, 0);
  return cells;
})();

function snake(shift = 0) {
  const cell = 74;
  const n = SNAKE.length;
  const at = ([c, r]) => [512 + (c - 3) * cell, 512 + (r - 5) * cell + 10];
  const tiles = SNAKE.map((c, i) => {
    // Position along the body from the head (0) to the tail (1); `shift` slides it forward for the motion strip.
    const j = n - 1 - i;
    const u = (j + shift) / (n - 1);
    if (u > 1.02) return "";
    const s = j === 0 ? 1.06 : lerp(0.86, 0.42, Math.max(0, (u - 0.55) / 0.45));
    const o = j === 0 ? 1 : lerp(1, 0.18, u ** 1.3);
    const [x, y] = at(c);
    return rrect(x - (cell * s) / 2, y - (cell * s) / 2, cell * s, cell * s, cell * s * 0.22, H, `opacity="${f(o)}"`);
  });
  // The next game, one cell ahead of the head.
  const [fx, fy] = at([6.5, 0]);
  return appIcon(`${tiles.join("")}${rrect(fx - 22, fy - 22, 44, 44, 10, P.paper)}`, P.ink1);
}

// ---------------------------------------------------------------------------
// 4 The ribbon: the feed as one strip bent into a swipe; every cell is a game's color, the leading edge is heat.
// ---------------------------------------------------------------------------

const RIBBON_PATH = curve({ from: [404, 1000], to: [624, 150], bend: 1.75 });
function ribbon(colors = ["stackd", "shortwick", "kingsnare", "heatfall", "pairs"]) {
  const fills = [...colors.map((c) => ACCENT[c]), H];
  const n = fills.length;
  const gap = 0.012;
  const parts = fills.map((fill, i) => {
    const t0 = i / n + (i ? gap : 0);
    const t1 = (i + 1) / n - (i < n - 1 ? gap : 0);
    return `<path d="${stroke(RIBBON_PATH, 196, 196, t0, t1, i === 0 ? "end" : i === n - 1 ? "start" : "both")}" fill="${fill}"/>`;
  });
  return appIcon(parts.join(""), P.ink1);
}

// ---------------------------------------------------------------------------
// 5 The peek: the bottom of the card leaving, the top of the next arriving, the gap where the swipe happens.
// ---------------------------------------------------------------------------

function peek(rise = 0) {
  const w = 600, r = 92;
  const x = 512 - w / 2;
  const top = lerp(690, 120, rise);
  return appIcon(
    `${rrect(x, top - 64 - 1000, w, 1000, r, P.ink3)}${rrect(x, top, w, 1000, r, H)}${rrect(512 - 70, top + 34, 140, 20, 10, P.ink1, 'opacity="0.5"')}`,
    P.ink1,
  );
}

// ---------------------------------------------------------------------------
// 6 The scanline: poster to live. Below the line the game is still pixels; above it, it's playing.
// ---------------------------------------------------------------------------

async function scanline(game = "stackd", y = 560) {
  const c = id("scan");
  const img = (href) => `<image href="${href}" width="1024" height="1024"/>`;
  return appIcon(
    `<defs><clipPath id="${c}-t"><rect width="1024" height="${y}"/></clipPath><clipPath id="${c}-b"><rect y="${y}" width="1024" height="${1024 - y}"/></clipPath></defs>
    <g clip-path="url(#${c}-t)">${img(await frame(game, { square: true }))}</g><g clip-path="url(#${c}-b)">${img(await frame(game, { square: true, pixels: 16 }))}</g>
    <rect y="${y - 9}" width="1024" height="18" fill="${H}"/>`,
    P.ink1,
  );
}

// ---------------------------------------------------------------------------
// Boards
// ---------------------------------------------------------------------------

const wrap = (lines, x, y, size = 30, color = P.paperDim, lh = 1.5) => lines.map((l, i) => `<path d="${text(l, size, x, y + i * size * lh, { font: BODY, tracking: 0 }).d}" fill="${color}"/>`).join("");

const IDEAS = [
  {
    n: 1, name: "THE CARD",
    idea: ["Every icon is a game. The mark is the feed's own moment:", "one game card leaving, the next one rising in heat.", "Inside the card, whatever is live. Around it, always ink and heat."],
    hero: () => card("duskrail"),
    strip: { title: "THE SYSTEM: ONE MARK, EVERY GAME", frames: () => Promise.all(["kingsnare", "voltbrick", "heatfall", "neon-chop"].map((g) => card(g))) },
  },
  {
    n: 2, name: "SPLIT-FLAP",
    idea: ["The next game flips in. A departure-board flap folding up,", "letter tiles like a word game's, the clack of something new", "arriving. The wordmark is the board itself."],
    hero: () => flapIcon(),
    lockup: (x, cy, light) => flapWord(x, cy, 74, light),
    strip: { title: "IN MOTION", frames: () => [0.18, 0.4, 0.68, 1].map((p) => flapIcon(p)) },
  },
  {
    n: 3, name: "THE SNAKE",
    idea: ["Snake, drawn as an S, heading up for the next game.", "A game everybody has played, tracing the gesture of the app;", "its tail fades back into the feed it came from."],
    hero: () => snake(),
    strip: { title: "IN MOTION", frames: () => [6, 4, 2, 0].map((s) => snake(s)) },
  },
  {
    n: 4, name: "THE RIBBON",
    idea: ["The feed as one strip, bent into a swipe. Every cell is a launch", "game in its own accent color, and the leading edge is always", "heat. The chrome stays ink; the games bring the color."],
    hero: () => ribbon(),
    strip: {
      title: "THE SYSTEM: THE LINEUP CHANGES, THE HEAT LEADS",
      frames: () => [["voltbrick", "flapjack", "snek", "shortwick", "stackd"], ["kingsnare", "pairs", "heatfall", "voltbrick", "duskrail"], ["neon-chop", "stackd", "flapjack", "kingsnare", "shortwick"], ["snek", "heatfall", "pairs", "stackd", "voltbrick"]].map((c) => ribbon(c)),
    },
  },
  {
    n: 5, name: "THE PEEK",
    idea: ["There is always a next one. The bottom of a card on its way", "out, the top of the next on its way in, and the gap between", "them: the exact place a swipe happens."],
    hero: () => peek(),
    strip: { title: "IN MOTION", frames: () => [0, 0.3, 0.62, 1].map((k) => peek(k)) },
  },
  {
    n: 6, name: "THE SCANLINE",
    idea: ["Poster to live, the app's signature wipe as the mark.", "Below the line the game is still pixels; above it, it's playing.", "One line of heat, any game behind it."],
    hero: () => scanline("kingsnare", 520),
    strip: { title: "IN MOTION", frames: () => Promise.all([[860, "voltbrick"], [640, "voltbrick"], [420, "voltbrick"], [200, "voltbrick"]].map(([y, g]) => scanline(g, y))) },
  },
];

/** The default lockup: the icon, then the plain wordmark. */
function iconLockup(art, x, cy, light) {
  const s = 150;
  return place(art, x, cy - s / 2, s) + `<path d="${text("swuple", 80, x + s + 34, cy + 22).d}" fill="${light ? P.ink1 : P.paper}"/>`;
}

const W = 2400, BH = 1350;
for (const idea of IDEAS) {
  const hero = await idea.hero();
  let b = `<rect width="${W}" height="${BH}" fill="#000000"/>`;
  b += place(hero, 110, 130, 760);
  b += label(`CONCEPT ${idea.n} / 6`, 1000, 150, P.paperMute, 24);
  b += `<path d="${text(idea.name, 76, 1000, 250).d}" fill="${P.paper}"/>`;
  b += wrap(idea.idea, 1000, 320);
  b += idea.lockup ? idea.lockup(1000, 560, false) : iconLockup(hero, 1000, 560, false);
  b += `<rect x="1000" y="660" width="1290" height="200" rx="10" fill="${P.paper}"/>`;
  b += idea.lockup ? idea.lockup(1040, 760, true) : iconLockup(hero, 1040, 760, true);
  b += label(idea.strip.title, 110, 975, P.paperMute, 22);
  const frames = await idea.strip.frames();
  frames.forEach((fr, i) => (b += place(fr, 110 + i * 250, 1000, 220)));
  b += label("96 · 48 · 32 PX", 1240, 975, P.paperMute, 22);
  b += place(hero, 1240, 1000, 96) + place(hero, 1370, 1024, 48) + place(hero, 1452, 1032, 32);
  b += label("SWUPLE · LOGO CONCEPTS · SKETCH, NOT FINAL ARTWORK", 110, 1300, P.paperMute, 20);
  await writeSheet(b, W, BH, `ideas-${idea.n}-${idea.name.toLowerCase().replace(/[^a-z]+/g, "-")}.png`);
}

// Overview: all six heroes.
{
  const OW = 2400, OH = 1560;
  let o = `<rect width="${OW}" height="${OH}" fill="#000000"/>`;
  o += `<path d="${text("swuple: six directions", 64, 110, 150).d}" fill="${P.paper}"/>`;
  for (const [i, idea] of IDEAS.entries()) {
    const x = 110 + (i % 3) * 760, y = 240 + Math.floor(i / 3) * 640;
    o += place(await idea.hero(), x, y, 500);
    o += label(`${idea.n}  ${idea.name}`, x, y + 560, P.paperDim, 26);
  }
  await writeSheet(o, OW, OH, "ideas-overview.png");
}
