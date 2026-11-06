/**
 * Drawing a swipe: the word's stroke as the trail a finger leaves on glass (runs of the centerline that narrow and
 * fade toward the start), the finger on its end, and the touch point. Shared by the script sketch sheets
 * (script-touch.mjs, identity.mjs). Everything is in the 1024 box of the app icon, y down.
 */
import { clamp, f, lerp } from "./sketch-kit.mjs";
import { samples } from "./script-geometry.mjs";

let uid = 0;
export const id = (p) => `${p}${uid++}`;

export const rgb = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
export const mix = (a, b, k) => `#${rgb(a).map((v, i) => Math.round(lerp(v, rgb(b)[i], clamp(k))).toString(16).padStart(2, "0")).join("")}`;
/** The color at t (0..1) along a ramp of [t, color] stops. */
export function ramp(stops, t) {
  const i = stops.findIndex(([s]) => s >= t);
  if (i === 0) return stops[0][1];
  if (i < 0) return stops.at(-1)[1];
  const [s0, c0] = stops[i - 1], [s1, c1] = stops[i];
  return mix(c0, c1, (t - s0) / (s1 - s0));
}
export const smooth = (x) => clamp(x) * clamp(x) * (3 - 2 * clamp(x));

export const stops = (list) => list.map(([o, c, a = 1]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${a}"/>`).join("");
export const radial = (gid, cx, cy, r, list, extra = "") => `<radialGradient id="${gid}" cx="${cx}" cy="${cy}" r="${r}" ${extra}>${stops(list)}</radialGradient>`;
export const linear = (gid, x1, y1, x2, y2, list, extra = "") => `<linearGradient id="${gid}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" ${extra}>${stops(list)}</linearGradient>`;
export const blur = (fid, sd) => `<filter id="${fid}" filterUnits="userSpaceOnUse" x="-400" y="-400" width="1824" height="1824"><feGaussianBlur stdDeviation="${sd}"/></filter>`;

/** Endings of the stroke after the w (nodes in the w's frame). */
export const END = {
  // Up and right, stopping inside the icon below the top right corner.
  corner: [[1.3, 1.04, 5], [1.95, 0.86, -12]],
  // Down and right into the space above the p's tail, where a thumb from the bottom right can reach it.
  thumb: [[1.35, 1.0, -15], [2.15, 0.45, -30]],
};

/**
 * The swipe's trail as runs of the centerline, each in one color and width, oldest first so newer parts of the swipe
 * cross over older ones. `w` is the width at the finger; the trail narrows to `tail` of it at the oldest end and comes
 * to a point where it enters the icon (`point`: where along the stroke that starts, in px, and over how long).
 * `colors` is a ramp from the oldest end to the finger, or a function of t (0 at the oldest end, 1 at the finger) and
 * the run's middle point.
 */
export function runs(L, { w = 58, tail = 0.4, colors, n = 260, point: [p0, pn] = [170, 520] }) {
  const pts = samples(L.segs, 3);
  const total = pts.at(-1).s;
  const out = [];
  for (let r = 0, i = 0; r < n; r++) {
    const s1 = (total * (r + 1)) / n;
    const run = [pts[Math.max(0, i - 1)]];
    while (i < pts.length && pts[i].s <= s1) run.push(pts[i++]);
    if (run.length < 2) continue;
    const s = (run[0].s + run.at(-1).s) / 2, t = s / total;
    const point = smooth((s - p0) / pn) ** 0.8;
    const color = typeof colors === "function" ? colors(t, run[run.length >> 1].p) : ramp(colors, t);
    out.push({ pts: run, t, w: w * lerp(tail, 1, t ** 0.85) * point, color });
  }
  return { list: out, head: pts.at(-1).p };
}

const polyline = (pts) => `M${pts.map((q) => q.p.map(f).join(" ")).join("L")}`;
export const group = (body, attrs = "") => `<g fill="none" stroke-linecap="round" stroke-linejoin="round" ${attrs}>${body}</g>`;
export const line = (rn, w, color) => `<path d="${polyline(rn.pts)}" stroke="${color}" stroke-width="${f(w)}"/>`;

/** The trail as one solid line, with a little glow only at the newest end, and a soft shadow on light icons. */
export function solid(R, { shadow = 0, glow = 0.5 } = {}) {
  const [shade, halo] = [id("s-shade"), id("s-halo")];
  let out = `<defs>${blur(shade, 16)}${blur(halo, 22)}</defs>`;
  if (shadow) out += group(R.list.map((rn) => line(rn, rn.w, "#000000")).join(""), `filter="url(#${shade})" opacity="${shadow}" transform="translate(0 12)"`);
  if (glow) out += group(R.list.filter((rn) => rn.t > 0.6).map((rn) => line(rn, rn.w * 1.6, rn.color)).join(""), `filter="url(#${halo})" opacity="${glow}"`);
  return out + group(R.list.map((rn) => line(rn, rn.w, rn.color)).join(""));
}

/** Where the finger touches: a bright dot with a ripple, like the touch indicator of a screen recording. */
export function touch([x, y], w, color) {
  const [halo, dot] = [id("t-halo"), id("t-dot")];
  return `<defs>${radial(halo, "0.5", "0.5", "0.5", [[0, color, 0.5], [1, color, 0]])}${radial(dot, "0.4", "0.35", "0.65", [[0, "#FFFFFF"], [1, mix(color, "#FFFFFF", 0.5)]])}</defs>
    <circle cx="${f(x)}" cy="${f(y)}" r="${f(w * 2.4)}" fill="url(#${halo})"/>
    <circle cx="${f(x)}" cy="${f(y)}" r="${f(w * 1.1)}" fill="none" stroke="#FFFFFF" stroke-opacity="0.5" stroke-width="6"/>
    <circle cx="${f(x)}" cy="${f(y)}" r="${f(w * 0.72)}" fill="url(#${dot})"/>`;
}

/** A finger's colors: body across its width (edge, light side, highlight, shade side, edge), nail, lines, shadow. */
export const WHITE_SKIN = {
  body: ["#E4E0EC", "#FBFAFD", "#FFFFFF", "#EDEAF2", "#CFCAD9"],
  nail: ["#FFFFFF", "#ECE9F2"],
  nailLine: "#D3CEDD",
  crease: "#C4BED0",
  ring: "#FFFFFF",
  shadow: "#000000",
};

/**
 * A finger seen from above, on the end of the trail, nail toward us, lying along `deg` (toward the hand). The pad
 * touches the glass a little behind the tip, so the trail runs in under it; `glow` lights the glass there. `F` is the
 * finger's width at the tip; it widens toward the hand. `ripple` draws the touch rings around the fingertip.
 */
export function finger([x, y], deg, F = 160, { glow = "", ripple = false, len = 1000, skin = WHITE_SKIN, shadow = 0.6 } = {}) {
  const [body, nail, shade, light] = [id("f-body"), id("f-nail"), id("f-shade"), id("f-light")];
  const a = (deg * Math.PI) / 180;
  const tip = [x - Math.cos(a) * F * 0.4, y - Math.sin(a) * F * 0.4];
  const local = (inner) => `<g transform="translate(${f(tip[0])} ${f(tip[1])}) rotate(${f(deg)})">${inner}</g>`;
  const r = F / 2, b = F * 0.6;
  const shape = `M${r} ${-r}L${len} ${-b}L${len} ${b}L${r} ${r}A${r} ${r} 0 0 1 ${r} ${-r}Z`;
  const crease = (cx, k) => `<path d="M${f(cx)} ${f(-F * 0.32 * k)}Q${f(cx + F * 0.1)} 0 ${f(cx)} ${f(F * 0.32 * k)}"/>`;
  const nailPath = `M${f(F * 0.86)} ${f(-F * 0.29)}L${f(F * 0.4)} ${f(-F * 0.31)}Q${f(F * 0.1)} ${f(-F * 0.3)} ${f(F * 0.1)} 0Q${f(F * 0.1)} ${f(F * 0.3)} ${f(F * 0.4)} ${f(F * 0.31)}L${f(F * 0.86)} ${f(F * 0.29)}Q${f(F * 0.96)} 0 ${f(F * 0.86)} ${f(-F * 0.29)}Z`;
  // Rings around the fingertip, open toward the hand.
  const rings = ripple
    ? [1.05, 1.4].map((k, i) => {
        const R = F * k, a0 = a + Math.PI - 1.25, a1 = a + Math.PI + 1.25;
        const pt = (t) => [x + Math.cos(t) * R, y + Math.sin(t) * R].map(f).join(" ");
        return `<path d="M${pt(a0)}A${f(R)} ${f(R)} 0 0 1 ${pt(a1)}" fill="none" stroke="${skin.ring}" stroke-opacity="${i ? 0.3 : 0.6}" stroke-width="${f(F * 0.05)}" stroke-linecap="round"/>`;
      }).join("")
    : "";
  return `<defs>
      ${linear(body, 0, 0, 0, 1, [0, 0.28, 0.5, 0.8, 1].map((o, i) => [o, skin.body[i]]))}
      ${linear(nail, 0, 0, 1, 0, [[0, skin.nail[0]], [1, skin.nail[1]]])}
      ${radial(light, "0.5", "0.5", "0.5", [[0, glow, 0.8], [0.4, glow, 0.3], [1, glow, 0]])}
      ${blur(shade, 20)}
    </defs>
    ${glow ? `<circle cx="${f(x)}" cy="${f(y)}" r="${f(F * 1.15)}" fill="url(#${light})"/>` : ""}
    ${rings}
    <g transform="translate(${f(F * 0.06)} ${f(F * 0.16)})" opacity="${shadow}" filter="url(#${shade})">${local(`<path d="${shape}" fill="${skin.shadow}"/>`)}</g>
    ${local(`<path d="${shape}" fill="url(#${body})"/>
      <path d="${nailPath}" fill="url(#${nail})" stroke="${skin.nailLine}" stroke-width="${f(F * 0.03)}"/>
      <path d="M${f(F * 0.22)} ${f(-F * 0.17)}Q${f(F * 0.45)} ${f(-F * 0.24)} ${f(F * 0.66)} ${f(-F * 0.17)}" stroke="#FFFFFF" stroke-width="${f(F * 0.06)}" stroke-linecap="round" fill="none"/>
      <g stroke="${skin.crease}" stroke-width="${f(F * 0.035)}" stroke-linecap="round" fill="none">${crease(F * 1.62, 1)}${crease(F * 1.8, 0.75)}${crease(F * 3.1, 1)}${crease(F * 3.28, 0.75)}</g>`)}`;
}

