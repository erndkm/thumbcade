/**
 * Geometry of the swipe logo, shared by the sketch sheet (swipe.mjs) and the brand files (swipe/brand.mjs).
 * Everything is in the 1024 box of the app icon, y down.
 */

const f = (v) => +v.toFixed(2);
const lerp = (a, b, k) => a + (b - a) * k;

/** The swipe's path, bottom to top: [start, control, control, end]. Like the letter, it bulges right low and left high. */
export function curve({ from = [430, 1060], to = [604, 190], bend = 1.35 } = {}) {
  const lift = (from[1] - to[1]) * 0.38;
  return [from, [from[0] + 210 * bend, from[1] - lift], [to[0] - 210 * bend, to[1] + lift], to];
}

export function bezier([p0, p1, p2, p3], t) {
  const u = 1 - t;
  return [0, 1].map((k) => u ** 3 * p0[k] + 3 * u * u * t * p1[k] + 3 * u * t * t * p2[k] + t ** 3 * p3[k]);
}

/** The cubic as SVG path data. */
export const centerline = ([p0, p1, p2, p3]) => `M${p0.join(" ")}C${[p1, p2, p3].map((p) => p.join(" ")).join(" ")}`;

/**
 * The stretch t0..t1 of the swipe as one closed outline, swelling from w0 to w1 over the whole path. Ends are round
 * unless `butt` names them ("start", "end" or "both"). One path, so a translucent fill never doubles up.
 */
export function stroke(pts, w0, w1, t0 = 0, t1 = 1, butt = "") {
  const n = Math.max(8, Math.round(90 * (t1 - t0)));
  const ts = Array.from({ length: n + 1 }, (_, i) => lerp(t0, t1, i / n));
  const p = ts.map((t) => bezier(pts, t));
  const width = (t) => lerp(w0, w1, t) / 2;
  const normal = (i) => {
    const [ax, ay] = bezier(pts, Math.max(0, ts[i] - 0.002));
    const [bx, by] = bezier(pts, Math.min(1, ts[i] + 0.002));
    const len = Math.hypot(bx - ax, by - ay);
    return [-(by - ay) / len, (bx - ax) / len, (bx - ax) / len, (by - ay) / len];
  };
  const left = [], right = [];
  p.forEach(([x, y], i) => {
    const [nx, ny] = normal(i);
    const w = width(ts[i]);
    left.push([x + nx * w, y + ny * w]);
    right.push([x - nx * w, y - ny * w]);
  });
  /** A half circle around point i, from `from` to `to` through the direction (dx, dy). */
  const cap = (i, from, dx, dy) => {
    const [cx, cy] = p[i];
    const r = width(ts[i]);
    const a0 = Math.atan2(from[1] - cy, from[0] - cx);
    const side = Math.sign(Math.cos(a0 + Math.PI / 2 - Math.atan2(dy, dx))) || 1;
    return Array.from({ length: 13 }, (_, k) => {
      const a = a0 + side * Math.PI * (k / 12);
      return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
    });
  };
  const [, , ex, ey] = normal(n);
  const [, , sx, sy] = normal(0);
  const endCap = butt === "end" || butt === "both" ? [] : cap(n, left[n], ex, ey);
  const startCap = butt === "start" || butt === "both" ? [] : cap(0, right[0], -sx, -sy);
  const outline = [...left, ...endCap, ...[...right].reverse(), ...startCap];
  return `M${outline.map(([x, y]) => `${f(x)} ${f(y)}`).join("L")}Z`;
}

/** The t at which the centerline crosses height y (it rises monotonically). */
export function tAtY(pts, y) {
  let lo = 0, hi = 1;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (bezier(pts, mid)[1] > y) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * The chosen logo ("B, edge to edge" on the sketch sheet): the swipe comes in below the icon and leaves above it,
 * fading in from nothing at the bottom edge to solid heat in the upper third. `ramp` is [y, opacity] from the bottom up.
 */
export const LOGO = {
  path: curve({ from: [420, 1100], to: [640, -80] }),
  w0: 130,
  w1: 168,
  ramp: [
    [1024, 0],
    [640, 0.45],
    [300, 1],
  ],
};
