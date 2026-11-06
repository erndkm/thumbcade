/**
 * Geometry of the script logo: "swuple" written as one connected cursive stroke across the app icon, three rows of two
 * letters (sw / up / le), shared by the sketch sheet (script.mjs) and the brand files (script/brand.mjs).
 * Everything is in the 1024 box of the app icon, y down.
 *
 * Letters are written as nodes in their own frame: x across, y up, the baseline at 0 and the x-height at 1. A node is
 * [x, y, angle] (the direction the pen moves, in degrees, 0 = right, 90 = up) or [x, y, [in, out]] for a sharp turn.
 * Between nodes the pen follows a cubic Hermite curve; the whole word is upright until `slant` shears it.
 */

const f = (v) => +v.toFixed(2);
const rad = (d) => (d * Math.PI) / 180;

/** A letter frame: origin (ox, base) in the box, H px per unit up, W px per unit across. */
export const frame = (ox, base, H, W = H) => ({ ox, base, H, W });

/** Nodes in a frame -> points in the box with unit directions (null where the curve picks its own). */
function place(fr, nodes) {
  return nodes.map(([x, y, a, k]) => {
    const dir = (deg) => {
      if (deg == null) return null;
      const dx = Math.cos(rad(deg)) * fr.W, dy = -Math.sin(rad(deg)) * fr.H;
      const len = Math.hypot(dx, dy);
      return [dx / len, dy / len];
    };
    const [ai, ao] = Array.isArray(a) ? a : [a, a];
    return { p: [fr.ox + x * fr.W, fr.base - y * fr.H], din: dir(ai), dout: dir(ao), k };
  });
}

/** The pen's path through the nodes as cubic segments [p0, c1, c2, p1]. Tension 1.15 makes quarter turns round. */
function hermite(pts, tension = 1.15) {
  const unit = (v) => {
    const len = Math.hypot(v[0], v[1]) || 1;
    return [v[0] / len, v[1] / len];
  };
  const auto = (i) => {
    const a = pts[Math.max(0, i - 1)].p, b = pts[Math.min(pts.length - 1, i + 1)].p;
    return unit([b[0] - a[0], b[1] - a[1]]);
  };
  const segs = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const A = pts[i], B = pts[i + 1];
    const d = Math.hypot(B.p[0] - A.p[0], B.p[1] - A.p[1]);
    const da = A.dout ?? auto(i), db = B.din ?? auto(i + 1);
    const ka = ((A.k ?? tension) * d) / 3, kb = ((B.k ?? tension) * d) / 3;
    segs.push([A.p, [A.p[0] + da[0] * ka, A.p[1] + da[1] * ka], [B.p[0] - db[0] * kb, B.p[1] - db[1] * kb], B.p]);
  }
  return segs;
}

/** Leans the writing by `deg`, pivoting on the icon's horizontal center line. */
const shear = (segs, deg, cy = 512) => segs.map((s) => s.map(([x, y]) => [x + (cy - y) * Math.tan(rad(deg)), y]));

/** The word as cubic segments, given `parts`: [frame, nodes] in stroke order, all one stroke. */
export function word(parts, slant) {
  return shear(hermite(parts.flatMap(([fr, nodes]) => place(fr, nodes))), slant);
}

/** Cubic segments as SVG path data. */
export const pathData = (segs) => `M${segs[0][0].map(f).join(" ")}` + segs.map(([, a, b, c]) => `C${[a, b, c].map((p) => p.map(f).join(" ")).join(" ")}`).join("");

export function bezier([p0, p1, p2, p3], t) {
  const u = 1 - t;
  return [0, 1].map((k) => u ** 3 * p0[k] + 3 * u * u * t * p1[k] + 3 * u * t * t * p2[k] + t ** 3 * p3[k]);
}

/** The centerline as evenly spaced points, about `step` px apart, each with its distance along the stroke. */
export function samples(segs, step = 2) {
  const fine = [];
  for (const s of segs) for (let i = fine.length ? 1 : 0; i <= 64; i++) fine.push(bezier(s, i / 64));
  const out = [{ p: fine[0], s: 0 }];
  let along = 0, last = 0;
  for (let i = 1; i < fine.length; i++) {
    along += Math.hypot(fine[i][0] - fine[i - 1][0], fine[i][1] - fine[i - 1][1]);
    if (along - last >= step || i === fine.length - 1) {
      out.push({ p: fine[i], s: along });
      last = along;
    }
  }
  return out;
}

/** The nodes traced backwards: same curve, opposite direction. */
const reverse = (nodes) => nodes.slice().reverse().map(([x, y, a, k]) => [x, y, a == null ? a : Array.isArray(a) ? [a[1] + 180, a[0] + 180] : a + 180, k]);

// The letters, each in its own frame (see the top of this file), in the direction a hand writes them.
// s: an S drawn from the bottom up, coming in from below left, so the top joins the w.
const S = [[-0.55, -0.55, 35], [0.42, 0.0, 0], [0.86, 0.26, 90], [0.46, 0.52, 150], [0.08, 0.77, 90], [0.48, 1.0, 0], [0.86, 0.8, -50]];
const W_ = [[0.0, 0.55, 10], [0.12, 1.0, [80, -95]], [0.32, 0.0, 0], [0.56, 0.85, [85, -95]], [0.8, 0.0, 0], [1.02, 0.95, 75]];
const U = [[-1.0, 0.45, 10], [0.05, 1.0, [70, -95]], [0.25, 0.0, 0], [0.52, 1.0, [85, -95]], [0.77, 0.0, 0], [1.05, 0.5, 55]];
// p: up to the top of the stem, down to the descender and back, then the bowl, closed at the stem, and out along its foot.
const P = [[-0.05, 0.5, 60], [0.12, 1.15, [75, -95]], [0.02, -0.62, [-95, 85]], [0.07, 0.45, 85], [0.3, 0.92, 30], [0.52, 1.0, 0], [0.82, 0.5, -90], [0.52, 0.0, 180], [0.15, 0.06, [175, -10]], [0.85, -0.02, 5]];
const L = [[0.0, 0.25, 40], [0.38, 1.22, 75], [0.3, 1.62, 180], [0.1, 1.22, -80], [0.12, 0.25, -80], [0.32, 0.0, 0]];
const E = [[0.0, 0.1, 20], [0.42, 0.48, 50], [0.36, 0.85, 180], [0.05, 0.45, -90], [0.36, 0.0, 0], [0.8, 0.18, 25]];
/** The l's lead-in, from outside the icon. */
const LEAD = [[-1.4, -0.1, 5], [-0.5, -0.02, 10]];

/**
 * The script logo. The rows join at alternating ends, like the strokes of an S: "sw" and "up" on the left, outside the
 * icon (which is what cuts the s in half), "up" and "le" on the right, where both tails run into the edge and turn just
 * past it (`turn`: the x of the turn before the slant; nearer 1024 it shows, and the p turns into a B). So the pen
 * comes in at the bottom left, writes "le", turns up past the right edge, writes "up" backwards, turns up past the
 * left edge, comes back as the s and leaves through the top right after the w: a swipe up that writes the word.
 * `segs` run in that order.
 * `tail`: the nodes after the w, in its frame; by default it leaves through the top right.
 * Returns `lead`, how far along the stroke (px) the l's lead-in ends, for the fade-in.
 */
export function script({ width = 54, slant = 12, turn = 1170, tail = [[1.3, 1.02, 5], [2.2, 1.3, 20], [3.0, 1.5, 20]] } = {}) {
  const x = 190, W = 300;
  const B1 = 270, B2 = 570, B3 = 940;
  const s = frame(-125, B1, x, 270), w = frame(145, B1, x, W);
  const u = frame(130, B2, x, W), p = frame(590, B2, x, W);
  const l = frame(280, B3, x, W), e = frame(l.ox + 0.5 * W, B3, x, W);
  // Where the two right-hand tails meet, past the edge: between the rows, a little high. The p's tail runs level
  // (dipping, it reads as the leg of an R) and the e's tail climbs toward it.
  const meet = (B2 + B3 - 0.4 * x) / 2 - 0.2 * x;
  const parts = [
    [l, [...LEAD, ...L]],
    [e, [...E, [(turn - 40 - e.ox) / W, 0.9, 5], [(turn - e.ox) / W, (B3 - meet) / x, 90]]],
    [p, reverse([...P, [(turn - 40 - p.ox) / W, -0.02, 0]])],
    [u, reverse(U)],
    [s, [[-0.9, -1.0, 180], ...S]],
    [w, [...W_, ...tail]],
  ];
  const segs = word(parts, slant);
  return { segs, width, lead: samples(segs.slice(0, LEAD.length)).at(-1).s };
}

/**
 * The word on one line, for the wordmark: s, w, u, p, l, e left to right in the same letters as the icon, one stroke.
 * Its own box, y down; returns the segments and their bounds [x0, y0, x1, y1] (the centerline, without stroke width).
 */
export function oneLine({ slant = 12 } = {}) {
  const x = 190, W = 300, B = 400;
  const s = frame(0, B, x, 240), w = frame(250, B, x, W), u = frame(680, B, x, W), p = frame(1010, B, x, W);
  const l = frame(1310, B, x, W), e = frame(l.ox + 0.5 * W, B, x, W);
  const parts = [
    // A cursive s: up from the baseline to a point, down round the right, closed at the left, out to the w.
    [s, [[-0.45, -0.05, 25], [0.32, 1.02, [62, -55]], [0.66, 0.38, -100], [0.36, 0.0, 180], [0.04, 0.16, [110, -20]], [0.72, 0.3, 20]]],
    // The w ends lower than in the icon and dips into the u, as a hand joins them.
    [w, [...W_.slice(0, -1), [1.0, 0.75, 70], [1.25, 0.95, 10]]],
    [u, U.slice(1)],
    [p, P.slice(1)],
    [l, L],
    [e, [...E, [1.1, 0.45, 40]]],
  ];
  const segs = word(parts, slant);
  const pts = samples(segs, 4).map((q) => q.p);
  const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
  return { segs, box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] };
}

/** Linear mix of two #rrggbb colors. */
const mix = (a, b, k) =>
  `#${[1, 3, 5].map((i) => Math.round(parseInt(a.slice(i, i + 2), 16) * (1 - k) + parseInt(b.slice(i, i + 2), 16) * k).toString(16).padStart(2, "0")).join("")}`;

/**
 * The stroke as SVG: one path in `color`, `width` wide, round ends. With `fade` [from, to] (px along the stroke) the
 * stretch before `to` fades in from `bg` (nothing) at `from` to `color`, drawn as short opaque pieces over the path so
 * nothing doubles up. It needs a solid `bg` behind it, which the icon always has.
 */
export function strokeSvg(segs, { width, color, bg, fade }) {
  let out = `<path d="${pathData(segs)}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`;
  if (!fade) return out;
  const [from, to] = fade;
  const pts = samples(segs, 4).filter((q) => q.s <= to);
  for (let i = 0; i < pts.length - 1; i++) {
    const k = Math.min(1, Math.max(0, (pts[i].s - from) / (to - from))) ** 1.4;
    // A hair wider than the path, so its antialiased edge doesn't show through, and a step longer, so pieces overlap.
    const b = pts[Math.min(pts.length - 1, i + 2)].p;
    out += `<path d="M${pts[i].p.map(f).join(" ")}L${b.map(f).join(" ")}" stroke="${mix(bg, color, k)}" stroke-width="${width + 1}"/>`;
  }
  return out;
}

/** How far along the stroke (px) it first crosses into the icon (x >= 0). */
export const entry = (segs) => samples(segs).find((q) => q.p[0] >= 0)?.s ?? 0;
