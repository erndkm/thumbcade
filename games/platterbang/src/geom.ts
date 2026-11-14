/**
 * The dishes as exact shapes: a signed distance for each kind (what covers a peg is decided by it), mass properties
 * for the swing, and outlines for drawing and bounds. Pure, no DOM. Units are wall units (the wall is 6 wide), y
 * points down, angles turn clockwise on screen.
 */

export type Kind = "plate" | "board" | "tray" | "platter" | "wedge" | "pan";

export interface Shape {
  kind: Kind;
  /** plate: radius · board: half length to the cap centre · tray: half width · platter: x radius · wedge: circumradius · pan: radius */
  a: number;
  /** board: half width · tray: half height · platter: y radius · pan: handle length past the rim */
  b: number;
  /** tray and wedge: corner radius · pan: handle half width */
  c: number;
}

/** Peg head radius. A dish whose edge comes within this of a peg's centre covers it. */
export const PEG_R = 0.22;

const TAU = Math.PI * 2;

function capsule(x: number, y: number, x0: number, x1: number, r: number): number {
  const px = x < x0 ? x0 - x : x > x1 ? x - x1 : 0;
  return Math.hypot(px, y) - r;
}

/** Wedge corners (equilateral, one corner up) at circumradius `r`. */
function triCorners(r: number): Array<[number, number]> {
  return [0, 1, 2].map((k) => {
    const a = -Math.PI / 2 + (k * TAU) / 3;
    return [Math.cos(a) * r, Math.sin(a) * r] as [number, number];
  });
}

/** Signed distance to a convex polygon (counter-clockwise or clockwise, both fine). */
function polySdf(pts: ReadonlyArray<readonly [number, number]>, x: number, y: number): number {
  let d = Infinity;
  let s = 1;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i, i++) {
    const [xi, yi] = pts[i]!;
    const [xj, yj] = pts[j]!;
    const ex = xj - xi;
    const ey = yj - yi;
    const wx = x - xi;
    const wy = y - yi;
    const t = Math.max(0, Math.min(1, (wx * ex + wy * ey) / (ex * ex + ey * ey)));
    const bx = wx - ex * t;
    const by = wy - ey * t;
    d = Math.min(d, bx * bx + by * by);
    const c1 = y >= yi;
    const c2 = y < yj;
    const c3 = ex * wy > ey * wx;
    if ((c1 && c2 && c3) || (!c1 && !c2 && !c3)) s = -s;
  }
  return s * Math.sqrt(d);
}

const triCache = new Map<number, Array<[number, number]>>();

/** Signed distance from local point (x, y) to the dish: negative inside. */
export function sdf(s: Shape, x: number, y: number): number {
  switch (s.kind) {
    case "plate":
      return Math.hypot(x, y) - s.a;
    case "board":
      return capsule(x, y, -s.a, s.a, s.b);
    case "tray": {
      const qx = Math.abs(x) - (s.a - s.c);
      const qy = Math.abs(y) - (s.b - s.c);
      return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - s.c;
    }
    case "platter": {
      const k0 = Math.hypot(x / s.a, y / s.b);
      if (k0 < 1e-9) return -Math.min(s.a, s.b);
      const k1 = Math.hypot(x / (s.a * s.a), y / (s.b * s.b));
      return (k0 * (k0 - 1)) / k1;
    }
    case "wedge": {
      const r = s.a - 2 * s.c;
      let pts = triCache.get(r);
      if (!pts) triCache.set(r, (pts = triCorners(r)));
      return polySdf(pts, x, y) - s.c;
    }
    case "pan":
      return Math.min(Math.hypot(x, y) - s.a, capsule(x, y, s.a * 0.6, s.a + s.b - s.c, s.c));
  }
}

/** Half extents of the local bounding box. */
export function extent(s: Shape): { x0: number; x1: number; y0: number; y1: number } {
  switch (s.kind) {
    case "plate":
      return { x0: -s.a, x1: s.a, y0: -s.a, y1: s.a };
    case "board":
      return { x0: -s.a - s.b, x1: s.a + s.b, y0: -s.b, y1: s.b };
    case "tray":
      return { x0: -s.a, x1: s.a, y0: -s.b, y1: s.b };
    case "platter":
      return { x0: -s.a, x1: s.a, y0: -s.b, y1: s.b };
    case "wedge":
      return { x0: -s.a * 0.87, x1: s.a * 0.87, y0: -s.a, y1: s.a * 0.5 };
    case "pan":
      return { x0: -s.a, x1: s.a + s.b, y0: -s.a, y1: s.a };
  }
}

export interface Mass {
  area: number;
  /** Centre of mass in local units. */
  cx: number;
  cy: number;
  /** Moment of inertia about the centre of mass, per unit density. */
  inertia: number;
}

/** Area, centre of mass and moment of inertia by integrating the shape on a fine grid. */
export function massOf(s: Shape, h = 0.04): Mass {
  // Closed forms where they are simple.
  if (s.kind === "plate") {
    const area = Math.PI * s.a * s.a;
    return { area, cx: 0, cy: 0, inertia: (area * s.a * s.a) / 2 };
  }
  if (s.kind === "platter") {
    const area = Math.PI * s.a * s.b;
    return { area, cx: 0, cy: 0, inertia: (area * (s.a * s.a + s.b * s.b)) / 4 };
  }
  if (s.kind === "board") {
    // A 2a × 2b box and two half discs of radius b at its ends.
    const box = 4 * s.a * s.b;
    const disc = Math.PI * s.b * s.b;
    const iBox = (box * (4 * s.a * s.a + 4 * s.b * s.b)) / 12;
    // Two half discs = one disc, each half's centroid 4b/3π beyond the end; parallel axis from the disc's own centre.
    const iDisc = (disc * s.b * s.b) / 2 + disc * (s.a * s.a + (8 * s.a * s.b) / (3 * Math.PI));
    return { area: box + disc, cx: 0, cy: 0, inertia: iBox + iDisc };
  }
  const e = extent(s);
  let area = 0;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  for (let y = e.y0 + h / 2; y < e.y1; y += h)
    for (let x = e.x0 + h / 2; x < e.x1; x += h) {
      if (sdf(s, x, y) > 0) continue;
      area += 1;
      sx += x;
      sy += y;
      sxx += x * x + y * y;
    }
  const cx = sx / area;
  const cy = sy / area;
  const inertia = (sxx / area - (cx * cx + cy * cy)) * area * h * h;
  return { area: area * h * h, cx, cy, inertia };
}

/** `n` points on the outline, found along rays from the centre (every kind is star-shaped about it). */
export function outline(s: Shape, n = 24): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const e = extent(s);
  const far = Math.hypot(Math.max(-e.x0, e.x1), Math.max(-e.y0, e.y1)) + 0.1;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    let lo = 0;
    let hi = far;
    for (let k = 0; k < 14; k++) {
      const m = (lo + hi) / 2;
      if (sdf(s, dx * m, dy * m) < 0) lo = m;
      else hi = m;
    }
    out.push([dx * lo, dy * lo]);
  }
  return out;
}

/** A pose: where the dish's local origin is on the wall and how far it is turned. */
export interface Pose {
  x: number;
  y: number;
  th: number;
}

/** Local point -> wall. */
export function toWorld(p: Pose, lx: number, ly: number): [number, number] {
  const c = Math.cos(p.th);
  const s = Math.sin(p.th);
  return [p.x + c * lx - s * ly, p.y + s * lx + c * ly];
}

/** Wall point -> local. */
export function toLocal(p: Pose, wx: number, wy: number): [number, number] {
  const c = Math.cos(p.th);
  const s = Math.sin(p.th);
  const dx = wx - p.x;
  const dy = wy - p.y;
  return [c * dx + s * dy, -s * dx + c * dy];
}

/** Signed distance from a wall point to a dish in a pose. */
export function sdfAt(s: Shape, p: Pose, wx: number, wy: number): number {
  const [lx, ly] = toLocal(p, wx, wy);
  return sdf(s, lx, ly);
}

/**
 * Where a dish comes to rest hanging from one peg: turned until its centre of mass is straight below the peg.
 * `peg` is the peg's local position, `at` its place on the wall.
 */
export function hangPose(m: Mass, peg: readonly [number, number], at: readonly [number, number]): Pose {
  const dx = m.cx - peg[0];
  const dy = m.cy - peg[1];
  const th = Math.PI / 2 - Math.atan2(dy, dx);
  const c = Math.cos(th);
  const s = Math.sin(th);
  return { x: at[0] - (c * peg[0] - s * peg[1]), y: at[1] - (s * peg[0] + c * peg[1]), th };
}

/** Wraps an angle into (-π, π]. */
export function wrap(a: number): number {
  let x = a % TAU;
  if (x <= -Math.PI) x += TAU;
  else if (x > Math.PI) x -= TAU;
  return x;
}
