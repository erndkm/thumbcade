/**
 * The script logo as a swipe on a phone: the same word and stroke as script.mjs, drawn as the trail a finger leaves on
 * glass instead of a line of paint. The trail comes in from nothing at the bottom left, thin and cool, and widens and
 * warms as it writes "le", "up" and "sw", so the end at the top is the hottest: the fingertip. Light, not paint: the
 * stroke glows, has a bright core and changes color along its length. Not final artwork.
 *
 *   node marketing/swuple/script-swipe.mjs   -> marketing/swuple/concepts/script-swipe-sheet.png, script-swipe-homescreen.png
 */
import { P, appIcon, clamp, f, homeScreens, lerp, markSheet } from "./sketch-kit.mjs";
import { samples, script } from "./script-geometry.mjs";

// Colors beyond the palette, for these sketches only. Heat stays in the middle of every ramp.
const C = {
  violet: "#7B5CFF",
  magenta: "#F2369A",
  tangerine: "#FF8A2B",
  gold: "#FFCB45",
  cyan: "#3CD7FF",
  white: "#FFF8EE",
  night: "#0B0A14",
};

let uid = 0;
const id = (p) => `${p}${uid++}`;

const rgb = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
const mix = (a, b, k) => `#${rgb(a).map((v, i) => Math.round(lerp(v, rgb(b)[i], clamp(k))).toString(16).padStart(2, "0")).join("")}`;
/** The color at t (0..1) along a ramp of [t, color] stops. */
function ramp(stops, t) {
  const i = stops.findIndex(([s]) => s >= t);
  if (i === 0) return stops[0][1];
  if (i < 0) return stops.at(-1)[1];
  const [s0, c0] = stops[i - 1], [s1, c1] = stops[i];
  return mix(c0, c1, (t - s0) / (s1 - s0));
}

const stops = (list) => list.map(([o, c, a = 1]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${a}"/>`).join("");
const radial = (gid, cx, cy, r, list) => `<radialGradient id="${gid}" cx="${cx}" cy="${cy}" r="${r}">${stops(list)}</radialGradient>`;
const linear = (gid, x1, y1, x2, y2, list) => `<linearGradient id="${gid}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">${stops(list)}</linearGradient>`;
const blur = (fid, sd) => `<filter id="${fid}" filterUnits="userSpaceOnUse" x="-400" y="-400" width="1824" height="1824"><feGaussianBlur stdDeviation="${sd}"/></filter>`;

// Tail to fingertip.
const SUNSET = [[0, C.violet], [0.3, C.magenta], [0.55, P.heat], [0.8, C.tangerine], [1, C.gold]];
const AURORA = [[0, C.cyan], [0.3, C.violet], [0.6, C.magenta], [1, P.heat]];
const EMBER = [[0, P.heatDeep], [0.6, P.heat], [1, C.gold]];
const NEON = [[0, C.magenta], [0.5, P.heat], [1, P.heat]];
const WHITE = [[0, C.white], [1, "#FFFFFF"]];

/** The stroke ending inside the icon, at the top right, so the fingertip shows. */
const TOUCH = { tail: [[1.3, 1.04, 5], [1.95, 0.86, -12]] };

/**
 * The word as a touch trail. Runs of the centerline, each in one color and width, drawn in stroke order so the later
 * part of the swipe crosses over the earlier. `ramp` colors it from tail to fingertip; the width swells from `w0` to
 * `w1` of the stroke width. The tail fades in from nothing where it enters the icon at the bottom left; `glow` lights
 * the icon around the trail, `core` is how wide its hot center gets at the fingertip (it cools to nothing toward the
 * tail), `touch` draws the fingertip at the end.
 */
function trail({ ramp: colors, w0 = 0.5, w1 = 1, glow = 1, core = 0.4, touch = false, width = 56, shadow = 0 }) {
  const L = script(touch ? TOUCH : {});
  const pts = samples(L.segs, 3);
  const total = pts.at(-1).s;
  const RUNS = 220;
  const runs = [];
  for (let r = 0, i = 0; r < RUNS; r++) {
    const s1 = (total * (r + 1)) / RUNS;
    const run = [pts[Math.max(0, i - 1)]];
    while (i < pts.length && pts[i].s <= s1) run.push(pts[i++]);
    if (run.length < 2) continue;
    const t = (run[0].s + run.at(-1).s) / 2 / total;
    runs.push({ d: `M${run.map((q) => q.p.map(f).join(" ")).join("L")}`, t, w: width * lerp(w0, w1, t ** 0.8), color: ramp(colors, t) });
  }
  const line = (rn, w, color) => `<path d="${rn.d}" stroke="${color}" stroke-width="${f(w)}"/>`;
  const group = (body, attrs = "") => `<g fill="none" stroke-linecap="round" stroke-linejoin="round" ${attrs}>${body}</g>`;
  const [mask, fade, wide, tight, soft, shade] = ["t-mask", "t-fade", "t-wide", "t-tight", "t-soft", "t-shade"].map(id);
  // The fade-in is a mask in space, around where the stroke enters, so the glow and shadow fade with the stroke.
  let out = `<defs>${blur(wide, 46)}${blur(tight, 14)}${blur(soft, 5)}${blur(shade, 18)}
    <radialGradient id="${fade}" gradientUnits="userSpaceOnUse" cx="-120" cy="1010" r="430">${stops([[0.25, "#000000"], [0.55, "#5A5A5A"], [0.8, "#D0D0D0"], [1, "#FFFFFF"]])}</radialGradient>
    <mask id="${mask}" maskUnits="userSpaceOnUse" x="-400" y="-400" width="1824" height="1824"><rect x="-400" y="-400" width="1824" height="1824" fill="url(#${fade})"/></mask></defs>`;
  let body = "";
  // On a bright icon the trail lifts off it with a shadow instead of a glow.
  if (shadow) body += group(runs.map((rn) => line(rn, rn.w * 1.1, "#000000")).join(""), `filter="url(#${shade})" opacity="${shadow}" transform="translate(0 14)"`);
  if (glow) {
    body += group(runs.map((rn) => line(rn, rn.w * 2.2, rn.color)).join(""), `filter="url(#${wide})" opacity="${0.42 * glow}"`);
    body += group(runs.map((rn) => line(rn, rn.w * 1.2, rn.color)).join(""), `filter="url(#${tight})" opacity="${0.7 * glow}"`);
  }
  body += group(runs.map((rn) => line(rn, rn.w, rn.color)).join(""));
  if (core) body += group(runs.map((rn) => line(rn, rn.w * core * lerp(0.3, 1, rn.t), mix(rn.color, C.white, rn.t ** 1.6 * 0.9))).join(""), `filter="url(#${soft})"`);
  out += `<g mask="url(#${mask})">${body}</g>`;
  if (touch) out += fingertip(pts.at(-1).p, width * w1, ramp(colors, 1), glow);
  return out;
}

/** Where the finger is: a bright dot, a halo and a ripple, like the touch indicator of a screen recording. */
function fingertip([x, y], w, color, glow) {
  const [halo, dot] = [id("f-halo"), id("f-dot")];
  return `<defs>
      ${radial(halo, "0.5", "0.5", "0.5", [[0, color, 0.55 * (glow || 0.6)], [1, color, 0]])}
      ${radial(dot, "0.4", "0.35", "0.65", [[0, "#FFFFFF"], [0.55, C.white], [1, mix(color, C.white, 0.4)]])}
    </defs>
    <circle cx="${f(x)}" cy="${f(y)}" r="${f(w * 2.6)}" fill="url(#${halo})"/>
    <circle cx="${f(x)}" cy="${f(y)}" r="${f(w * 1.55)}" fill="none" stroke="#FFFFFF" stroke-opacity="0.22" stroke-width="5"/>
    <circle cx="${f(x)}" cy="${f(y)}" r="${f(w * 1.05)}" fill="none" stroke="#FFFFFF" stroke-opacity="0.55" stroke-width="6"/>
    <circle cx="${f(x)}" cy="${f(y)}" r="${f(w * 0.72)}" fill="url(#${dot})"/>`;
}

/** Night: ink with a little violet in it, a touch lighter at the top left. */
function night() {
  const g = id("bg");
  return `<defs>${radial(g, "0.3", "0.2", "1", [[0, "#221C38"], [0.55, "#100E1A"], [1, "#060509"]])}</defs><rect width="1024" height="1024" fill="url(#${g})"/>`;
}

/** Glass over the screen: a soft sheen across the top left and a thin rim of light. */
function glass() {
  const [sheen, rim] = [id("g-sheen"), id("g-rim")];
  return `<defs>
      ${linear(sheen, 0, 0, 0.7, 0.7, [[0, "#FFFFFF", 0.16], [0.42, "#FFFFFF", 0.05], [0.43, "#FFFFFF", 0], [1, "#FFFFFF", 0]])}
      ${linear(rim, 0, 0, 1, 1, [[0, "#FFFFFF", 0.45], [0.35, "#FFFFFF", 0.06], [0.7, "#FFFFFF", 0.03], [1, "#FFFFFF", 0.25]])}
    </defs>
    <rect width="1024" height="1024" fill="url(#${sheen})"/>
    <rect x="5" y="5" width="1014" height="1014" rx="${f(1024 * 0.2237 - 5)}" fill="none" stroke="url(#${rim})" stroke-width="10"/>`;
}

/** Sunset as a background: gold at the top right through heat to violet at the bottom left. */
function sunset() {
  const [g, light] = [id("bg"), id("bg-light")];
  return `<defs>
      ${linear(g, 1, 0, 0, 1, [[0, C.gold], [0.3, C.tangerine], [0.55, P.heat], [0.8, C.magenta], [1, C.violet]])}
      ${radial(light, "0.75", "0.1", "0.7", [[0, "#FFFFFF", 0.3], [1, "#FFFFFF", 0]])}
    </defs><rect width="1024" height="1024" fill="url(#${g})"/><rect width="1024" height="1024" fill="url(#${light})"/>`;
}

const ICON = { inset: 0, vis: [0, 1024] };
const MARKS = [
  { title: "A  LIGHT TRAIL", ...ICON, draw: () => appIcon(night() + trail({ ramp: SUNSET }), C.night) },
  { title: "B  FINGERTIP", ...ICON, draw: () => appIcon(night() + trail({ ramp: SUNSET, touch: true }), C.night) },
  { title: "C  GLASS SCREEN", ...ICON, draw: () => appIcon(night() + trail({ ramp: SUNSET, touch: true }) + glass(), C.night) },
  { title: "D  NEON", ...ICON, draw: () => appIcon(night() + trail({ ramp: NEON, core: 0.55, glow: 1.3, w0: 0.6 }), C.night) },
  { title: "E  AURORA", ...ICON, draw: () => appIcon(night() + trail({ ramp: AURORA, touch: true }) + glass(), C.night) },
  { title: "F  EMBER", ...ICON, draw: () => appIcon(night() + trail({ ramp: EMBER, touch: true, w0: 0.45 }), C.night) },
  { title: "G  LIGHT ON SUNSET", ...ICON, draw: () => appIcon(sunset() + trail({ ramp: WHITE, touch: true, glow: 0, core: 0, shadow: 0.35 }) + glass(), P.heat) },
  { title: "H  SUNSET ON PAPER", ...ICON, draw: () => appIcon(`<rect width="1024" height="1024" fill="${P.paper}"/>` + trail({ ramp: SUNSET, touch: true, glow: 0, core: 0, shadow: 0.18 }), P.paper) },
];

await markSheet(MARKS, "script-swipe-sheet.png");

await homeScreens(await Promise.all(MARKS.map((m) => m.draw())), MARKS.map((m) => `${m.title[0]} swuple`), "script-swipe-homescreen.png");
