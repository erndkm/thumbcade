/** Plane geometry on the course (x right, z toward the camera). Pure, no three.js. */

export interface V2 {
  x: number;
  z: number;
}

export const v2 = (x: number, z: number): V2 => ({ x, z });

/** Shoelace area; positive means the outward normal of edge (a→b) is (dz, -dx). */
export function signedArea(p: readonly V2[]): number {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const q = p[i]!;
    const r = p[(i + 1) % p.length]!;
    a += q.x * r.z - r.x * q.z;
  }
  return a / 2;
}

export function ensurePositive(p: V2[]): V2[] {
  return signedArea(p) < 0 ? p.slice().reverse() : p;
}

/** Outward offset of a positive-area polygon (mitered). */
export function offsetPolygon(p: readonly V2[], d: number): V2[] {
  const n = p.length;
  const out: V2[] = [];
  for (let i = 0; i < n; i++) {
    const a = p[(i - 1 + n) % n]!;
    const b = p[i]!;
    const c = p[(i + 1) % n]!;
    const l1 = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    const l2 = Math.hypot(c.x - b.x, c.z - b.z) || 1;
    const n1x = (b.z - a.z) / l1;
    const n1z = -(b.x - a.x) / l1;
    const n2x = (c.z - b.z) / l2;
    const n2z = -(c.x - b.x) / l2;
    const k = Math.max(0.35, 1 + n1x * n2x + n1z * n2z);
    out.push({ x: b.x + (d * (n1x + n2x)) / k, z: b.z + (d * (n1z + n2z)) / k });
  }
  return out;
}

export function pointInPolygon(p: readonly V2[], x: number, z: number): boolean {
  let inside = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const a = p[i]!;
    const b = p[j]!;
    if (a.z > z !== b.z > z && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

/** Closest point on segment ab to (px, pz); writes into `out` and returns the squared distance. */
export function closestOnSegment(ax: number, az: number, bx: number, bz: number, px: number, pz: number, out: V2): number {
  const dx = bx - ax;
  const dz = bz - az;
  const len2 = dx * dx + dz * dz;
  let t = len2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  out.x = ax + dx * t;
  out.z = az + dz * t;
  const ex = px - out.x;
  const ez = pz - out.z;
  return ex * ex + ez * ez;
}

const tmp: V2 = { x: 0, z: 0 };

/** Closest point on the polygon boundary. */
export function closestOnPolygon(p: readonly V2[], x: number, z: number): { x: number; z: number; d: number } {
  let best = Infinity;
  let bx = 0;
  let bz = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i]!;
    const b = p[(i + 1) % p.length]!;
    const d2 = closestOnSegment(a.x, a.z, b.x, b.z, x, z, tmp);
    if (d2 < best) {
      best = d2;
      bx = tmp.x;
      bz = tmp.z;
    }
  }
  return { x: bx, z: bz, d: Math.sqrt(best) };
}

export function bounds(p: readonly V2[]): { minX: number; maxX: number; minZ: number; maxZ: number } {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const q of p) {
    minX = Math.min(minX, q.x);
    maxX = Math.max(maxX, q.x);
    minZ = Math.min(minZ, q.z);
    maxZ = Math.max(maxZ, q.z);
  }
  return { minX, maxX, minZ, maxZ };
}

/** Replaces every corner with a short chamfer of `size` (a rounder, hand-cut outline). */
export function softenCorners(p: readonly V2[], size: number): V2[] {
  const out: V2[] = [];
  const n = p.length;
  for (let i = 0; i < n; i++) {
    const a = p[(i - 1 + n) % n]!;
    const b = p[i]!;
    const c = p[(i + 1) % n]!;
    const l1 = Math.hypot(b.x - a.x, b.z - a.z);
    const l2 = Math.hypot(c.x - b.x, c.z - b.z);
    const s1 = Math.min(size, l1 * 0.4);
    const s2 = Math.min(size, l2 * 0.4);
    out.push({ x: b.x + ((a.x - b.x) / l1) * s1, z: b.z + ((a.z - b.z) / l1) * s1 });
    out.push({ x: b.x + ((c.x - b.x) / l2) * s2, z: b.z + ((c.z - b.z) / l2) * s2 });
  }
  return out;
}

export const smooth01 = (t: number): number => {
  const x = t < 0 ? 0 : t > 1 ? 1 : t;
  return x * x * (3 - 2 * x);
};
