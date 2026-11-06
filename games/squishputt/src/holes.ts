/**
 * The hole book: hand-designed templates with randomized details. Pure data (no three.js), so the physics
 * and the hole tests can run anywhere.
 *
 * Course frame: x to the right, z toward the camera. The tee sits near +z, the cup near -z.
 */
import type { Rng } from "@thumbcade-games/kit/rng";
import { ensurePositive, softenCorners, v2, type V2 } from "./geom.ts";

export interface Bump {
  x: number;
  z: number;
  /** Height (negative = a dip). */
  a: number;
  /** Gaussian radius. */
  s: number;
}

/** Height rises smoothly from 0 at (x0, z0) to `h` at (x1, z1) along that axis, and stays there beyond. */
export interface Ramp {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  h: number;
}

export interface Wall {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  r: number;
}

export interface Bumper {
  x: number;
  z: number;
  r: number;
}

/** A soft, hand-pressed patch: a polar outline around a center. */
export interface Blob {
  x: number;
  z: number;
  radii: number[];
}

export interface Windmill {
  x: number;
  z: number;
  /** Half width of the tunnel. */
  gap: number;
  /** Radians per second. */
  speed: number;
  phase: number;
}

export interface HoleDef {
  name: string;
  par: number;
  outline: V2[];
  tee: V2;
  cup: V2;
  walls: Wall[];
  bumpers: Bumper[];
  sand: Blob[];
  water: Blob[];
  bumps: Bump[];
  ramps: Ramp[];
  tilt: { gx: number; gz: number };
  windmill: Windmill | null;
}

export const BALL_R = 0.12;
export const CUP_R = 0.21;

// ---------------------------------------------------------------------------
// Height field
// ---------------------------------------------------------------------------

export function heightAt(h: HoleDef, x: number, z: number): number {
  let y = h.tilt.gx * x + h.tilt.gz * z;
  for (const b of h.bumps) {
    const dx = x - b.x;
    const dz = z - b.z;
    y += b.a * Math.exp(-(dx * dx + dz * dz) / (2 * b.s * b.s));
  }
  for (const r of h.ramps) {
    const ax = r.x1 - r.x0;
    const az = r.z1 - r.z0;
    const len2 = ax * ax + az * az;
    let t = ((x - r.x0) * ax + (z - r.z0) * az) / len2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    y += r.h * t * t * (3 - 2 * t);
  }
  return y;
}

/** Analytic gradient of `heightAt` (uphill direction), written into `out`. */
export function slopeAt(h: HoleDef, x: number, z: number, out: V2): V2 {
  let gx = h.tilt.gx;
  let gz = h.tilt.gz;
  for (const b of h.bumps) {
    const dx = x - b.x;
    const dz = z - b.z;
    const s2 = b.s * b.s;
    const k = (-b.a / s2) * Math.exp(-(dx * dx + dz * dz) / (2 * s2));
    gx += k * dx;
    gz += k * dz;
  }
  for (const r of h.ramps) {
    const ax = r.x1 - r.x0;
    const az = r.z1 - r.z0;
    const len2 = ax * ax + az * az;
    const t = ((x - r.x0) * ax + (z - r.z0) * az) / len2;
    if (t <= 0 || t >= 1) continue;
    const k = (r.h * 6 * t * (1 - t)) / len2;
    gx += k * ax;
    gz += k * az;
  }
  out.x = gx;
  out.z = gz;
  return out;
}

// ---------------------------------------------------------------------------
// Blobs
// ---------------------------------------------------------------------------

const BLOB_N = 28;

export function makeBlob(rng: Rng, x: number, z: number, rx: number, rz: number, wobble = 0.12): Blob {
  const radii: number[] = [];
  const k1 = rng.range(0, 6.28);
  const k2 = rng.range(0, 6.28);
  for (let i = 0; i < BLOB_N; i++) {
    const a = (i / BLOB_N) * Math.PI * 2;
    const base = (rx * rz) / Math.hypot(rz * Math.cos(a), rx * Math.sin(a));
    const n = 1 + wobble * (0.6 * Math.sin(a * 2 + k1) + 0.4 * Math.sin(a * 3 + k2));
    radii.push(base * n);
  }
  return { x, z, radii };
}

export function blobRadius(b: Blob, angle: number): number {
  const n = b.radii.length;
  let f = (angle / (Math.PI * 2)) * n;
  f = ((f % n) + n) % n;
  const i = Math.floor(f);
  const t = f - i;
  return b.radii[i]! * (1 - t) + b.radii[(i + 1) % n]! * t;
}

export function inBlob(b: Blob, x: number, z: number, shrink = 0): boolean {
  const dx = x - b.x;
  const dz = z - b.z;
  const d = Math.hypot(dx, dz);
  return d < blobRadius(b, Math.atan2(dz, dx)) - shrink;
}

export function blobPoints(b: Blob, scale = 1): V2[] {
  return b.radii.map((r, i) => {
    const a = (i / b.radii.length) * Math.PI * 2;
    return v2(b.x + Math.cos(a) * r * scale, b.z + Math.sin(a) * r * scale);
  });
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

type Template = (rng: Rng, level: number) => HoleDef;

const empty = (name: string, par: number, outline: V2[], tee: V2, cup: V2): HoleDef => ({
  name,
  par,
  outline,
  tee,
  cup,
  walls: [],
  bumpers: [],
  sand: [],
  water: [],
  bumps: [{ x: cup.x, z: cup.z, a: -0.06, s: 0.42 }],
  ramps: [],
  tilt: { gx: 0, gz: 0 },
  windmill: null,
});

const rect = (w: number, zTop: number, zBottom: number, soften: number): V2[] =>
  softenCorners([v2(-w, zBottom), v2(w, zBottom), v2(w, zTop), v2(-w, zTop)], soften);

/** Places macarons away from each other, the tee, the cup and the walls. */
function scatterBumpers(rng: Rng, h: HoleDef, count: number, area: { x0: number; x1: number; z0: number; z1: number }, r: [number, number]): void {
  let tries = 0;
  while (h.bumpers.length < count && tries++ < 200) {
    const b = { x: rng.range(area.x0, area.x1), z: rng.range(area.z0, area.z1), r: rng.range(r[0], r[1]) };
    const clear =
      h.bumpers.every((o) => Math.hypot(o.x - b.x, o.z - b.z) > o.r + b.r + 0.5) &&
      Math.hypot(h.cup.x - b.x, h.cup.z - b.z) > b.r + 0.75 &&
      Math.hypot(h.tee.x - b.x, h.tee.z - b.z) > b.r + 0.8;
    if (clear) h.bumpers.push(b);
  }
}

const straight: Template = (rng, level) => {
  const w = rng.range(1.35, 1.6);
  const h = empty("the long lick", 2, rect(w, -4.9, 4.9, 0.5), v2(rng.range(-0.3, 0.3), 4.05), v2(rng.range(-0.55, 0.55), -3.85));
  scatterBumpers(rng, h, level > 0 ? 2 : 1, { x0: -w + 0.5, x1: w - 0.5, z0: -1.8, z1: 1.4 }, [0.26, 0.34]);
  if (rng.chance(0.5)) {
    const g = (rng.chance(0.5) ? 1 : -1) * rng.range(0.022, 0.032);
    h.tilt.gx = g;
    h.name = "the leaning lick";
  }
  return h;
};

const hump: Template = (rng) => {
  const w = rng.range(1.5, 1.7);
  const h = empty("the lump", 2, rect(w, -4.9, 4.9, 0.55), v2(0, 4.05), v2(rng.range(-0.7, 0.7), -3.8));
  const hx = rng.range(-0.45, 0.45);
  h.bumps.push({ x: hx, z: rng.range(-0.6, 0.6), a: rng.range(0.3, 0.38), s: rng.range(0.7, 0.85) });
  h.bumps.push({ x: -hx * 1.8, z: rng.range(-2.6, -2.0), a: rng.range(0.1, 0.16), s: 0.45 });
  return h;
};

const garden: Template = (rng, level) => {
  const outline = softenCorners([v2(-1.9, 4.9), v2(1.9, 4.9), v2(2.25, 0.4), v2(1.65, -4.9), v2(-1.65, -4.9), v2(-2.25, 0.4)], 0.45);
  const h = empty("macaron garden", 2, outline, v2(rng.range(-0.5, 0.5), 4.05), v2(rng.range(-0.75, 0.75), -3.85));
  scatterBumpers(rng, h, 4 + Math.min(2, level), { x0: -1.5, x1: 1.5, z0: -2.7, z1: 1.9 }, [0.26, 0.33]);
  return h;
};

const dogleg: Template = (rng) => {
  const lw = rng.range(1.55, 1.8);
  const cw = rng.range(1.8, 2.05);
  const top = -4.9;
  const x0 = -2.2;
  const pts = [v2(x0, 4.9), v2(x0 + lw, 4.9), v2(x0 + lw, top + cw), v2(2.2, top + cw), v2(2.2, top), v2(x0 + 0.95, top), v2(x0, top + 0.95)];
  const h = empty("the elbow", 2, softenCorners(pts, 0.28), v2(x0 + lw / 2, 4.05), v2(rng.range(1.0, 1.55), top + cw / 2));
  if (rng.chance(0.6)) h.bumpers.push({ x: rng.range(0.1, 0.5), z: top + cw / 2 + rng.range(-0.35, 0.35), r: 0.24 });
  h.bumps.push({ x: x0 + lw / 2, z: rng.range(0, 2), a: rng.range(0.08, 0.14), s: 0.5 });
  return h;
};

const windmill: Template = (rng, level) => {
  const w = 1.75;
  const wz = rng.range(-0.7, 0.1);
  const h = empty("the flour mill", 2, rect(w, -4.9, 4.9, 0.5), v2(rng.range(-0.4, 0.4), 4.05), v2(rng.range(-0.8, 0.8), -3.75));
  const gap = 0.3;
  const r = 0.2;
  h.walls.push({ ax: -w - 0.2, az: wz, bx: -(gap + r), bz: wz, r }, { ax: gap + r, az: wz, bx: w + 0.2, bz: wz, r });
  h.windmill = { x: 0, z: wz, gap, speed: rng.range(1.25, 1.6) + Math.min(0.6, level * 0.06), phase: rng.range(0, 6.28) };
  if (rng.chance(0.5)) h.bumpers.push({ x: rng.range(-0.9, 0.9), z: rng.range(-2.6, -2.0), r: 0.24 });
  return h;
};

const plateau: Template = (rng) => {
  const w = rng.range(1.5, 1.65);
  const r0 = rng.range(-0.3, 0.4);
  const h = empty("the shelf", 2, rect(w, -4.9, 4.9, 0.5), v2(rng.range(-0.3, 0.3), 4.05), v2(rng.range(-0.7, 0.7), -3.55));
  h.ramps.push({ x0: 0, z0: r0, x1: 0, z1: r0 - 1.15, h: rng.range(0.26, 0.32) });
  if (rng.chance(0.5)) h.bumpers.push({ x: -h.cup.x * 0.7, z: h.cup.z + 1.1, r: 0.24 });
  return h;
};

const sandglass: Template = (rng) => {
  const pts = [v2(-1.9, 4.9), v2(1.9, 4.9), v2(1.9, 2.3), v2(0.95, 0.5), v2(0.95, -0.6), v2(2.0, -2.4), v2(2.0, -4.9), v2(-2.0, -4.9), v2(-2.0, -2.4), v2(-0.95, -0.6), v2(-0.95, 0.5), v2(-1.9, 2.3)];
  const h = empty("the sugar glass", 2, softenCorners(pts, 0.32), v2(rng.range(-0.6, 0.6), 4.05), v2(rng.range(-1.0, 1.0), -3.85));
  h.sand.push(makeBlob(rng, -h.cup.x * 0.35 + rng.range(-0.2, 0.2), h.cup.z + 1.25, 0.62, 0.42));
  h.sand.push(makeBlob(rng, rng.chance(0.5) ? -1.3 : 1.3, rng.range(2.6, 3.2), 0.45, 0.4));
  return h;
};

const pond: Template = (rng, level) => {
  const w = 2.0;
  const h = empty("the duck pond", 2, rect(w, -4.9, 4.9, 0.5), v2(rng.range(-0.4, 0.4), 4.1), v2(rng.range(-0.6, 0.6), -3.9));
  const side = rng.chance(0.5) ? 1 : -1;
  const rx = rng.range(1.28, 1.38) + Math.min(0.1, level * 0.01);
  h.water.push(makeBlob(rng, side * -0.55, rng.range(-0.7, 0.3), rx, rng.range(0.95, 1.1), 0.08));
  if (rng.chance(0.6)) h.bumpers.push({ x: side * 1.45, z: rng.range(1.6, 2.2), r: 0.24 });
  return h;
};

const zigzag: Template = (rng) => {
  const w = 2.0;
  const z1 = rng.range(1.2, 1.8);
  const z2 = rng.range(-1.6, -1.0);
  const h = empty("the wiggle", 3, rect(w, -4.9, 4.9, 0.5), v2(rng.range(-1.3, -0.6), 4.05), v2(rng.range(0.35, 1.2), -3.85));
  h.walls.push({ ax: -w - 0.1, az: z1, bx: rng.range(0.55, 0.8), bz: z1, r: 0.13 }, { ax: w + 0.1, az: z2, bx: rng.range(-0.8, -0.55), bz: z2, r: 0.13 });
  if (rng.chance(0.5)) h.bumpers.push({ x: rng.range(1.2, 1.5), z: (z1 + z2) / 2 + rng.range(-0.3, 0.3), r: 0.22 });
  return h;
};

const volcano: Template = (rng) => {
  const h = empty("the soufflé", 2, rect(1.8, -4.9, 4.9, 0.5), v2(rng.range(-0.4, 0.4), 4.05), v2(rng.range(-0.4, 0.4), rng.range(-2.6, -2.1)));
  h.bumps.length = 0;
  h.bumps.push({ x: h.cup.x, z: h.cup.z, a: rng.range(0.27, 0.32), s: 0.72 }, { x: h.cup.x, z: h.cup.z, a: -0.11, s: 0.22 });
  const sx = rng.chance(0.5) ? 1 : -1;
  h.sand.push(makeBlob(rng, h.cup.x + sx * 1.05, h.cup.z - 0.9, 0.5, 0.42));
  h.sand.push(makeBlob(rng, h.cup.x - sx * 1.0, h.cup.z + 0.25, 0.38, 0.5));
  return h;
};

const millpond: Template = (rng, level) => {
  const h = windmill(rng, level);
  h.name = "the mill pond";
  h.bumpers.length = 0;
  const wz = h.windmill!.z;
  const side = rng.chance(0.5) ? 1 : -1;
  h.cup = v2(-side * rng.range(0.6, 1.0), -3.9);
  h.bumps[0] = { x: h.cup.x, z: h.cup.z, a: -0.06, s: 0.42 };
  h.water.push(makeBlob(rng, side * 0.55, wz - 1.75, 0.85, 0.6, 0.1));
  return h;
};

const switchback: Template = (rng) => {
  const lw = rng.range(1.5, 1.7);
  const pts = [v2(-2.1, 4.9), v2(-2.1 + lw, 4.9), v2(-2.1 + lw, -1.9), v2(2.1 - lw, -1.9), v2(2.1 - lw, 4.9), v2(2.1, 4.9), v2(2.1, -4.0), v2(1.25, -4.9), v2(-1.25, -4.9), v2(-2.1, -4.0)];
  const h = empty("the hairpin", 3, softenCorners(pts, 0.25), v2(-2.1 + lw / 2, 4.05), v2(2.1 - lw / 2 + rng.range(-0.15, 0.15), rng.range(1.6, 2.8)));
  if (rng.chance(0.6)) h.bumpers.push({ x: rng.range(-0.4, 0.4), z: -3.6, r: 0.25 });
  return h;
};

export const TEMPLATES = { straight, hump, garden, dogleg, windmill, plateau, sandglass, pond, zigzag, volcano, millpond, switchback } as const;
export type TemplateName = keyof typeof TEMPLATES;

/** Which templates a run can draw from at each hole number (0-based). */
export function poolFor(hole: number): TemplateName[] {
  if (hole <= 0) return ["straight", "hump", "garden"];
  if (hole <= 1) return ["straight", "hump", "garden", "plateau"];
  if (hole <= 3) return ["dogleg", "windmill", "plateau", "sandglass", "garden"];
  if (hole <= 5) return ["pond", "zigzag", "volcano", "windmill", "dogleg", "sandglass"];
  return ["millpond", "switchback", "zigzag", "pond", "volcano", "windmill"];
}

function mirror(h: HoleDef): HoleDef {
  const m = (p: V2) => v2(-p.x, p.z);
  return {
    ...h,
    outline: h.outline.map(m).reverse(),
    tee: m(h.tee),
    cup: m(h.cup),
    walls: h.walls.map((w) => ({ ax: -w.ax, az: w.az, bx: -w.bx, bz: w.bz, r: w.r })),
    bumpers: h.bumpers.map((b) => ({ ...b, x: -b.x })),
    sand: h.sand.map(mirrorBlob),
    water: h.water.map(mirrorBlob),
    bumps: h.bumps.map((b) => ({ ...b, x: -b.x })),
    ramps: h.ramps.map((r) => ({ ...r, x0: -r.x0, x1: -r.x1 })),
    tilt: { gx: -h.tilt.gx, gz: h.tilt.gz },
    windmill: h.windmill ? { ...h.windmill, x: -h.windmill.x, speed: -h.windmill.speed } : null,
  };
}

function mirrorBlob(b: Blob): Blob {
  // Angle a maps to π - a.
  const n = b.radii.length;
  const radii = b.radii.map((_, i) => b.radii[(n - i + n / 2) % n]!);
  return { x: -b.x, z: b.z, radii };
}

export function buildHole(name: TemplateName, rng: Rng, level: number): HoleDef {
  let h = TEMPLATES[name](rng, level);
  // Late in a run somebody nudged the table: holes lean a little, so every putt bends.
  if (level >= 5 && h.tilt.gx === 0 && !h.water.length && rng.chance(level >= 7 ? 0.7 : 0.4)) {
    h.tilt.gx = (rng.chance(0.5) ? 1 : -1) * rng.range(0.016, 0.026);
  }
  if (rng.chance(0.5)) h = mirror(h);
  h.outline = ensurePositive(h.outline);
  return h;
}
