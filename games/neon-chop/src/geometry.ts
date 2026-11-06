/** Convex-polygon helpers for cutting shapes along a line. Points are flat [x0, y0, x1, y1, ...]. */

export type Poly = number[];

/** Regular-ish polygon with optional per-vertex radius jitter (deterministic from `seed`). */
export function regular(sides: number, radius: number, rotation = 0, squashY = 1): Poly {
  const out: Poly = [];
  for (let i = 0; i < sides; i++) {
    const a = rotation + (i / sides) * Math.PI * 2;
    out.push(Math.cos(a) * radius, Math.sin(a) * radius * squashY);
  }
  return out;
}

export function scalePoly(p: Poly, k: number): Poly {
  return p.map((v) => v * k);
}

/**
 * Splits a convex polygon by the infinite line through (px, py) with direction (dx, dy).
 * Returns [left, right]; either may be empty when the line misses.
 */
export function splitPoly(poly: Poly, px: number, py: number, dx: number, dy: number): [Poly, Poly] {
  const left: Poly = [];
  const right: Poly = [];
  const n = poly.length / 2;
  const side = (x: number, y: number) => dx * (y - py) - dy * (x - px);
  for (let i = 0; i < n; i++) {
    const ax = poly[i * 2]!;
    const ay = poly[i * 2 + 1]!;
    const bx = poly[((i + 1) % n) * 2]!;
    const by = poly[((i + 1) % n) * 2 + 1]!;
    const sa = side(ax, ay);
    const sb = side(bx, by);
    if (sa >= 0) left.push(ax, ay);
    if (sa <= 0) right.push(ax, ay);
    if ((sa > 0 && sb < 0) || (sa < 0 && sb > 0)) {
      const t = sa / (sa - sb);
      const ix = ax + (bx - ax) * t;
      const iy = ay + (by - ay) * t;
      left.push(ix, iy);
      right.push(ix, iy);
    }
  }
  return [left.length >= 6 ? left : [], right.length >= 6 ? right : []];
}

/** Centroid (vertex average — fine for convex shapes). */
export function centroid(p: Poly): [number, number] {
  let x = 0;
  let y = 0;
  const n = p.length / 2;
  for (let i = 0; i < n; i++) {
    x += p[i * 2]!;
    y += p[i * 2 + 1]!;
  }
  return [x / n, y / n];
}

export function translatePoly(p: Poly, dx: number, dy: number): Poly {
  return p.map((v, i) => v + (i % 2 === 0 ? dx : dy));
}

/** Distance from point to segment. */
export function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const vx = bx - ax;
  const vy = by - ay;
  const len2 = vx * vx + vy * vy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / len2)) : 0;
  return Math.hypot(px - (ax + vx * t), py - (ay + vy * t));
}

/** Rotate a polygon around the origin. */
export function rotatePoly(p: Poly, a: number): Poly {
  const c = Math.cos(a);
  const s = Math.sin(a);
  const out: Poly = [];
  for (let i = 0; i < p.length; i += 2) {
    const x = p[i]!;
    const y = p[i + 1]!;
    out.push(x * c - y * s, x * s + y * c);
  }
  return out;
}
