/**
 * Saltbend's print: the coast road seen from above, the camera turning with the road so it always runs up the page.
 *
 * Everything is drawn in screen space: world points go through the camera in code and the plates keep their plain
 * pixel transform, so every halftone stays pinned to the paper (WebKit fills a rotated or scaled pattern on a very slow
 * path; see "Frame rate fixes: riso screens" in docs/DECISIONS.md). Only particles, which are solid ink, are drawn
 * through a rotated transform.
 *
 * The world is a sea (the whole page, teal), a band of land along the left of the road and a strip of rock along its
 * right, each stroked along the road's own centreline (a stroke is the union of its pieces, so the bands stay whole
 * through the tightest bend), then the gravel verge, the paper tarmac, its painted edges and dashes.
 */
import { CAR_HALF_W, HALF, OFF, VERGE, type Course } from "./road.ts";
import { RED, SUN, TEAL, PLATES, stageAt, type PlateName, type Scenery, type Sky } from "./palette.ts";
import type { Press } from "./riso.ts";

const TAU = Math.PI * 2;

export function hash(n: number, seed = 0): number {
  let h = Math.imul((n | 0) ^ 0x2c1b3c6d, 0x9e3779b1) ^ Math.imul(seed | 0, 0x85ebca77);
  h = Math.imul(h ^ (h >>> 15), 0x297a2d39);
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
}

/** Ink coverage on each plate: teal, sunflower, red. */
export type Cov = readonly [number, number, number];

/** A top-down camera: `a` is the heading that points up the screen, `z` px per metre, (ax, ay) where (x, y) lands. */
export class Cam {
  x = 0;
  y = 0;
  a = Math.PI / 2;
  z = 16;
  ax = 0;
  ay = 0;
  private fx = 0;
  private fy = 1;
  private rx = 1;
  private ry = 0;

  update(): void {
    this.fx = Math.cos(this.a);
    this.fy = Math.sin(this.a);
    this.rx = Math.sin(this.a);
    this.ry = -Math.cos(this.a);
  }
  X(x: number, y: number): number {
    return this.ax + ((x - this.x) * this.rx + (y - this.y) * this.ry) * this.z;
  }
  Y(x: number, y: number): number {
    return this.ay - ((x - this.x) * this.fx + (y - this.y) * this.fy) * this.z;
  }
  /** A world direction as a screen direction (unit in, unit out). */
  dir(dx: number, dy: number): [number, number] {
    return [dx * this.rx + dy * this.ry, -(dx * this.fx + dy * this.fy)];
  }
  /** Sets a plate's transform to world metres (for solid ink only). */
  apply(press: Press, c: CanvasRenderingContext2D): void {
    const z = this.z;
    const a = z * this.rx;
    const cc = z * this.ry;
    const b = -z * this.fx;
    const d = -z * this.fy;
    press.transform(c, a, b, cc, d, this.ax - (a * this.x + cc * this.y), this.ay - (b * this.x + d * this.y));
  }
}

/** Knocks a path out of every plate, then prints it at `cov`. */
export function region(press: Press, cov: Cov, path: (c: CanvasRenderingContext2D) => void, stroke = 0): void {
  PLATES.forEach((p, i) => {
    const c = press.plate(p);
    c.globalCompositeOperation = "destination-out";
    c.fillStyle = "#000";
    c.strokeStyle = "#000";
    c.beginPath();
    path(c);
    if (stroke > 0) {
      c.lineWidth = stroke;
      c.stroke();
    } else c.fill();
    c.globalCompositeOperation = "source-over";
    const k = cov[i]!;
    if (k <= 0.01) return;
    const ink = k >= 0.99 ? press.solid(p) : press.screen(p, k);
    c.beginPath();
    path(c);
    if (stroke > 0) {
      c.strokeStyle = ink;
      c.lineWidth = stroke;
      c.stroke();
    } else {
      c.fillStyle = ink;
      c.fill();
    }
  });
}

/** Prints a path on one plate at coverage `k` (over what is there: the darker dot wins). */
export function ink(press: Press, p: PlateName, k: number, path: (c: CanvasRenderingContext2D) => void, stroke = 0): void {
  if (k <= 0.01) return;
  const c = press.plate(p);
  const fill = k >= 0.99 ? press.solid(p) : press.screen(p, k);
  c.beginPath();
  path(c);
  if (stroke > 0) {
    c.strokeStyle = fill;
    c.lineWidth = stroke;
    c.stroke();
  } else {
    c.fillStyle = fill;
    c.fill();
  }
}

/** Prints `cov` over what is there on every plate (shadows, washes). */
export function over(press: Press, cov: Cov, path: (c: CanvasRenderingContext2D) => void, stroke = 0): void {
  PLATES.forEach((p, i) => ink(press, p, cov[i]!, path, stroke));
}

export function knock(press: Press, plates: readonly PlateName[], path: (c: CanvasRenderingContext2D) => void, stroke = 0): void {
  for (const p of plates) {
    const c = press.plate(p);
    c.globalCompositeOperation = "destination-out";
    c.fillStyle = "#000";
    c.strokeStyle = "#000";
    c.beginPath();
    path(c);
    if (stroke > 0) {
      c.lineWidth = stroke;
      c.stroke();
    } else c.fill();
    c.globalCompositeOperation = "source-over";
  }
}

// ---------------------------------------------------------------------------------------------------------------
// The road and the land, sampled once a frame
// ---------------------------------------------------------------------------------------------------------------

export interface Strip {
  n: number;
  s: Float64Array;
  /** Screen centreline and the screen direction of the road's left. */
  X: Float64Array;
  Y: Float64Array;
  NX: Float64Array;
  NY: Float64Array;
  /** World centreline. */
  wx: Float64Array;
  wy: Float64Array;
  wa: Float64Array;
}

const MAXS = 260;
export function makeStrip(): Strip {
  const f = () => new Float64Array(MAXS);
  return { n: 0, s: f(), X: f(), Y: f(), NX: f(), NY: f(), wx: f(), wy: f(), wa: f() };
}

export function sampleStrip(st: Strip, course: Course, cam: Cam, s0: number, s1: number, step: number): void {
  let n = 0;
  for (let s = s0; s <= s1 + 1e-6 && n < MAXS; s += step) {
    const p = course.pose(s);
    st.s[n] = s;
    st.wx[n] = p.x;
    st.wy[n] = p.y;
    st.wa[n] = p.a;
    st.X[n] = cam.X(p.x, p.y);
    st.Y[n] = cam.Y(p.x, p.y);
    const [nx, ny] = cam.dir(-Math.sin(p.a), Math.cos(p.a));
    st.NX[n] = nx;
    st.NY[n] = ny;
    n++;
  }
  st.n = n;
}

/** The polyline `d` metres left of the centreline between samples i0..i1. */
function offsetPath(st: Strip, z: number, d: number, i0 = 0, i1 = st.n - 1): (c: CanvasRenderingContext2D) => void {
  return (c) => {
    for (let i = i0; i <= i1; i++) {
      const x = st.X[i]! + st.NX[i]! * d * z;
      const y = st.Y[i]! + st.NY[i]! * d * z;
      if (i === i0) c.moveTo(x, y);
      else c.lineTo(x, y);
    }
  };
}

function strokeBand(press: Press, st: Strip, z: number, d0: number, d1: number, cov: Cov | null, i0: number, i1: number, mode: "region" | "over" | "knock" = "region", plates: readonly PlateName[] = PLATES): void {
  const path = offsetPath(st, z, (d0 + d1) / 2, i0, i1);
  const w = Math.abs(d1 - d0) * z;
  for (const p of PLATES) {
    const c = press.plate(p);
    c.lineJoin = "round";
    c.lineCap = "round";
  }
  if (mode === "knock") knock(press, plates, path, w);
  else if (mode === "over") over(press, cov!, path, w);
  else region(press, cov!, path, w);
}

export interface WorldLook {
  sky: Sky;
  time: number;
  still: boolean;
}

/** Ranges of samples that share a stage, so each stretch of land gets its own width and colour. */
function stageRuns(st: Strip): Array<{ i0: number; i1: number; stage: number }> {
  const runs: Array<{ i0: number; i1: number; stage: number }> = [];
  let cur = -1;
  for (let i = 0; i < st.n; i++) {
    const k = stageAt(st.s[i]!).index;
    if (k !== cur) {
      if (runs.length) runs[runs.length - 1]!.i1 = Math.min(st.n - 1, i + 1);
      runs.push({ i0: Math.max(0, i - 1), i1: i, stage: k });
      cur = k;
    } else runs[runs.length - 1]!.i1 = i;
  }
  return runs;
}

const LAND: Record<Scenery, { body: Cov; edge: Cov }> = {
  harbour: { body: [0, 0.26, 0.05], edge: [0, 0.42, 0] },
  terraces: { body: [0.1, 0.3, 0], edge: [0, 0.42, 0] },
  pines: { body: [0.18, 0.22, 0], edge: [0, 0.4, 0] },
  salt: { body: [0, 0.12, 0.05], edge: [0, 0.34, 0] },
  cape: { body: [0.08, 0.2, 0.1], edge: [0, 0.36, 0] },
  cypress: { body: [0.12, 0.3, 0], edge: [0, 0.4, 0] },
};

export function drawSea(press: Press, W: number, H: number, look: WorldLook, cam: Cam): void {
  const { sky } = look;
  const t = press.plate(TEAL);
  t.fillStyle = press.screen(TEAL, sky.sea);
  t.fillRect(0, 0, W, H);
  if (sky.seaRed > 0.02) {
    const r = press.plate(RED);
    r.fillStyle = press.screen(RED, sky.seaRed);
    r.fillRect(0, 0, W, H);
  }
  // Wave marks: short paper strokes anchored to the water, drifting slowly; glitter toward the sun by day, stars by night.
  const z = cam.z;
  const cell = 7;
  const span = Math.hypot(W, H) / z / 2 + cell;
  const cx = Math.floor(cam.x / cell);
  const cy = Math.floor(cam.y / cell);
  const n = Math.ceil(span / cell);
  const drift = look.still ? 0 : look.time * 0.35;
  const sunPlate = press.plate(SUN);
  const sunFill = press.solid(SUN);
  t.save();
  t.globalCompositeOperation = "destination-out";
  t.strokeStyle = "#000";
  t.lineCap = "round";
  t.lineWidth = Math.max(1, 0.22 * z);
  const [wx, wy] = cam.dir(1, 0.18);
  t.beginPath();
  sunPlate.fillStyle = sunFill;
  sunPlate.beginPath();
  for (let i = -n; i <= n; i++) {
    for (let j = -n; j <= n; j++) {
      const gx = cx + i;
      const gy = cy + j;
      const h = hash(gx * 7919 + gy * 104729, 3);
      if (h > 0.55) continue;
      const x = (gx + hash(gx, gy + 11)) * cell + Math.sin(look.time * 0.5 + h * 9) * 0.25 + drift * (h - 0.3);
      const y = (gy + hash(gy, gx + 17)) * cell;
      const sx = cam.X(x, y);
      const sy = cam.Y(x, y);
      if (sx < -20 || sx > W + 20 || sy < -20 || sy > H + 20) continue;
      const len = (0.6 + h * 1.6) * z;
      t.moveTo(sx - wx * len, sy - wy * len);
      t.quadraticCurveTo(sx, sy - 0.25 * z, sx + wx * len, sy + wy * len);
      if (sky.glitter > 0.05 && h < 0.18 * sky.glitter) {
        sunPlate.moveTo(sx + 0.4 * z, sy);
        sunPlate.arc(sx, sy, Math.max(0.8, 0.28 * z * (0.6 + 0.4 * Math.sin(look.time * 2 + h * 40))), 0, TAU);
      }
      if (sky.night > 0.5 && h > 0.5) {
        sunPlate.moveTo(sx + 1, sy);
        sunPlate.arc(sx, sy, 0.7, 0, TAU);
      }
    }
  }
  t.stroke();
  t.restore();
  sunPlate.fill();
}

/** The land band on the left and the rocks on the right, by stage, with sand and a paper line of foam at the water. */
export function drawLand(press: Press, st: Strip, z: number): void {
  for (const r of stageRuns(st)) {
    const stage = stageAt(st.s[Math.min(st.n - 1, r.i0 + 1)]!).stage;
    const look = LAND[stage.scenery];
    const w = stage.land;
    // Left: foam (knocked out of the sea), sand, then the land.
    strokeBand(press, st, z, OFF, OFF + w + 1.8, null, r.i0, r.i1, "knock", [TEAL, RED]);
    strokeBand(press, st, z, OFF, OFF + w + 1.1, look.edge, r.i0, r.i1);
    strokeBand(press, st, z, OFF, OFF + w, look.body, r.i0, r.i1);
    // Right: a strip of rock above the water.
    const cw = stage.cliff;
    strokeBand(press, st, z, -OFF, -OFF - cw - 1.2, null, r.i0, r.i1, "knock", [TEAL, RED]);
    strokeBand(press, st, z, -OFF, -OFF - cw, [0.42, 0.12, 0.4], r.i0, r.i1);
    // A low whitewashed parapet along the sea side, capped in red every few metres.
    strokeBand(press, st, z, -OFF - 0.05, -OFF - 0.55, [0, 0, 0], r.i0, r.i1);
    const cap = offsetPath(st, z, -OFF - 0.3, r.i0, r.i1);
    for (const p of PLATES) {
      const c = press.plate(p);
      c.setLineDash([0.5 * z, 2.2 * z]);
      // Anchored to the road, not to the first sample, so the caps don't crawl.
      c.lineDashOffset = (st.s[r.i0]! % 2.7) * z;
    }
    ink(press, RED, 1, cap, Math.max(1.5, 0.5 * z));
    for (const p of PLATES) {
      press.plate(p).setLineDash([]);
      press.plate(p).lineDashOffset = 0;
    }
    // Terraces: bands of greener and paler ground stepping up from the road.
    if (stage.scenery === "terraces") {
      for (const d of [OFF + 4.2, OFF + 12.6, OFF + 21]) strokeBand(press, st, z, d, d + 4.2, [0.26, 0.4, 0], r.i0, r.i1, "over");
    }
  }
}

/** The verge, the paper tarmac, the painted edges and the centre dashes. */
export function drawRoad(press: Press, st: Strip, z: number, look: WorldLook): void {
  const all = 0;
  strokeBand(press, st, z, -OFF, OFF, [0, 0.12, 0.36], all, st.n - 1);
  // Gravel grain: a coarse screen on the verge.
  strokeBand(press, st, z, -HALF, HALF, [0, 0, 0], all, st.n - 1);
  const night = look.sky.night;
  if (night > 0.05) strokeBand(press, st, z, -HALF, HALF, [0.2 * night, 0, 0.08 * night], all, st.n - 1, "over");
  // Painted edges just inside the tarmac.
  const lw = Math.max(1.2, 0.16 * z);
  for (const d of [HALF - 0.14, -HALF + 0.14]) ink(press, RED, 1, offsetPath(st, z, d), lw);
  // Centre dashes: 3 m on, 4 m off, anchored to the road.
  const c = press.plate(SUN);
  c.lineCap = "butt";
  c.strokeStyle = press.solid(SUN);
  c.lineWidth = Math.max(1.4, 0.2 * z);
  c.beginPath();
  for (let i = 0; i < st.n - 1; i++) {
    const s = st.s[i]!;
    const ph = ((s % 7) + 7) % 7;
    if (ph < 3) {
      const step = st.s[i + 1]! - s;
      const end = Math.min(1, (3 - ph) / step);
      c.moveTo(st.X[i]!, st.Y[i]!);
      c.lineTo(st.X[i]! + (st.X[i + 1]! - st.X[i]!) * end, st.Y[i]! + (st.Y[i + 1]! - st.Y[i]!) * end);
    }
  }
  c.stroke();
  // Cat's eyes on the edges at night.
  if (night > 0.3) {
    const sp = press.plate(SUN);
    sp.fillStyle = press.solid(SUN);
    sp.beginPath();
    for (let i = 0; i < st.n; i++) {
      const s = st.s[i]!;
      if (Math.abs((((s + 1) % 12) + 12) % 12) > 2) continue;
      for (const d of [HALF + 0.25, -HALF - 0.25]) {
        const x = st.X[i]! + st.NX[i]! * d * z;
        const y = st.Y[i]! + st.NY[i]! * d * z;
        sp.moveTo(x + 2, y);
        sp.arc(x, y, Math.max(1.4, 0.15 * z), 0, TAU);
      }
    }
    sp.fill();
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Scenery: fixed per 10 m block and side, checked against the road so nothing stands on it.
// ---------------------------------------------------------------------------------------------------------------

export type ItemKind = "lemon" | "pine" | "cypress" | "house" | "rock" | "pan" | "boat" | "light" | "bush";

export interface Item {
  kind: ItemKind;
  x: number;
  y: number;
  r: number;
  rot: number;
  seed: number;
  /** Height for the shadow (m). */
  h: number;
}

const BLOCK = 10;

export class Scenery2 {
  private blocks = new Map<number, Item[]>();
  /** Items for the blocks covering s0..s1. */
  items(course: Course, s0: number, s1: number): Item[] {
    const out: Item[] = [];
    const b0 = Math.floor(s0 / BLOCK);
    const b1 = Math.floor(s1 / BLOCK);
    for (let b = b0; b <= b1; b++) {
      let list = this.blocks.get(b);
      if (!list) {
        if (b * BLOCK + BLOCK > course.end) continue;
        list = this.make(course, b);
        this.blocks.set(b, list);
      }
      for (const it of list) out.push(it);
    }
    for (const k of this.blocks.keys()) if (k < b0 - 4) this.blocks.delete(k);
    return out;
  }

  clear(): void {
    this.blocks.clear();
  }

  private make(course: Course, b: number): Item[] {
    const list: Item[] = [];
    const s = b * BLOCK + BLOCK / 2;
    if (s < -40) return list;
    const { stage } = stageAt(s);
    const land = stage.land;
    const add = (kind: ItemKind, ss: number, d: number, r: number, h: number, seed: number) => {
      const p = course.point(ss, d);
      // Keep clear of the road, the far legs of hairpins included.
      for (let q = ss - 70; q <= ss + 70; q += 3) {
        const c = course.point(q, 0);
        if (Math.hypot(c.x - p.x, c.y - p.y) < OFF + r + 0.6) return;
      }
      list.push({ kind, x: p.x, y: p.y, r, rot: hash(seed, 5) * TAU, seed, h });
    };
    const H = (i: number) => hash(b * 31 + i, 77);
    // Land side.
    const n = stage.scenery === "salt" ? 1 : 2;
    for (let i = 0; i < n; i++) {
      const ss = b * BLOCK + H(i) * BLOCK;
      const u = H(i + 10);
      const seed = b * 131 + i;
      switch (stage.scenery) {
        case "terraces":
          if (H(i + 20) < 0.75) add("lemon", ss, OFF + 1.6 + Math.floor(u * 4) * 4.2, 1.35, 1.6, seed);
          else add("house", ss, OFF + 6 + u * (land - 12), 2.6, 3, seed);
          break;
        case "pines":
          add(H(i + 20) < 0.8 ? "pine" : "bush", ss, OFF + 3 + u * (land - 6), 2.4 + H(i + 30) * 1.2, 4, seed);
          break;
        case "salt":
          if (H(i + 20) < 0.6) add("pan", ss, OFF + 2.2 + u * (land - 4.4), 1.6, 0, seed);
          break;
        case "cape":
          add(H(i + 20) < 0.6 ? "bush" : "rock", ss, OFF + 2.5 + u * (land - 5), 1.2 + H(i + 30), 0.8, seed);
          break;
        case "cypress":
          if (H(i + 20) < 0.55) add("cypress", ss, OFF + 2 + (H(i + 40) < 0.6 ? 0 : u * (land - 4)), 0.9, 6, seed);
          else add("lemon", ss, OFF + 5 + u * (land - 9), 1.35, 1.6, seed);
          break;
        case "harbour":
          if (H(i + 20) < 0.7) add("house", ss, OFF + 4.5 + u * (land - 10), 2.5 + H(i + 30) * 0.8, 3.2, seed);
          else add("bush", ss, OFF + 2 + u * 5, 1.1, 1, seed);
          break;
      }
    }
    // Sea side: rocks on the cliff strip now and then, boats out on the water.
    if (H(50) < 0.35) add("rock", b * BLOCK + H(51) * BLOCK, -OFF - 0.6 - H(52) * stage.cliff * 0.7, 0.6 + H(53) * 0.7, 0.4, b * 7 + 1);
    if (H(60) < (stage.scenery === "harbour" ? 0.12 : 0.04)) add("boat", b * BLOCK + H(61) * BLOCK, -OFF - stage.cliff - 7 - H(62) * 14, 1.6, 0, b * 7 + 2);
    if (stage.scenery === "cape" && b % 26 === 7) add("light", b * BLOCK, OFF + 9, 2.2, 9, b);
    return list;
  }
}

/** Shadow offset for a thing `h` metres tall, as a screen vector. */
export function shadowOf(cam: Cam, sky: Sky, h: number): [number, number] {
  const [dx, dy] = cam.dir(Math.cos(sky.sunBearing), Math.sin(sky.sunBearing));
  const L = h * sky.shadowLen * cam.z;
  return [dx * L, dy * L];
}

function blob(c: CanvasRenderingContext2D, x: number, y: number, r: number, seed: number, lobes = 7, wob = 0.18): void {
  const n = 14;
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * TAU;
    const k = 1 + wob * Math.sin(t * lobes + seed) * (0.6 + 0.4 * hash(seed + i, 3));
    const px = x + Math.cos(t) * r * k;
    const py = y + Math.sin(t) * r * k;
    if (i === 0) c.moveTo(px, py);
    else c.lineTo(px, py);
  }
  c.closePath();
}

function rectPath(c: CanvasRenderingContext2D, cx: number, cy: number, hw: number, hh: number, ux: number, uy: number): void {
  // ux, uy: the screen direction of the rectangle's long axis.
  const vx = -uy;
  const vy = ux;
  c.moveTo(cx + ux * hh + vx * hw, cy + uy * hh + vy * hw);
  c.lineTo(cx + ux * hh - vx * hw, cy + uy * hh - vy * hw);
  c.lineTo(cx - ux * hh - vx * hw, cy - uy * hh - vy * hw);
  c.lineTo(cx - ux * hh + vx * hw, cy - uy * hh + vy * hw);
  c.closePath();
}

export function drawItems(press: Press, items: Item[], cam: Cam, look: WorldLook, W: number, H: number): void {
  const z = cam.z;
  const { sky } = look;
  const shade: Cov = [0.32 * (sky.shade / 0.3), 0.05, 0.22 * (sky.shade / 0.3)];
  const vis = items.filter((it) => {
    const x = cam.X(it.x, it.y);
    const y = cam.Y(it.x, it.y);
    const m = (it.r + it.h * sky.shadowLen + 2) * z;
    return x > -m && x < W + m && y > -m && y < H + m;
  });
  // Shadows first, all at once.
  over(press, shade, (c) => {
    for (const it of vis) {
      if (it.h <= 0.2) continue;
      const [ox, oy] = shadowOf(cam, sky, it.h);
      const x = cam.X(it.x, it.y);
      const y = cam.Y(it.x, it.y);
      if (it.kind === "house") {
        const [ux, uy] = cam.dir(Math.cos(it.rot), Math.sin(it.rot));
        rectPath(c, x + ox * 0.6, y + oy * 0.6, it.r * z, it.r * 1.25 * z, ux, uy);
      } else if (it.kind === "cypress" || it.kind === "light") {
        c.moveTo(x + it.r * z, y);
        c.lineTo(x + ox - oy * 0.08, y + oy + ox * 0.08);
        c.lineTo(x - it.r * z, y);
        c.closePath();
        c.moveTo(x + ox + it.r * 0.6 * z, y + oy);
        c.arc(x + ox, y + oy, it.r * 0.6 * z, 0, TAU);
      } else {
        c.moveTo(x + ox * 0.5 + it.r * z, y + oy * 0.5);
        c.arc(x + ox * 0.5, y + oy * 0.5, it.r * z, 0, TAU);
      }
    }
  });
  const night = sky.night;
  for (const it of vis) {
    const x = cam.X(it.x, it.y);
    const y = cam.Y(it.x, it.y);
    const r = it.r * z;
    switch (it.kind) {
      case "lemon": {
        region(press, [0.42, 0.7, 0.06], (c) => blob(c, x, y, r, it.seed, 6, 0.14));
        ink(press, TEAL, 0.62, (c) => blob(c, x - r * 0.15, y + r * 0.12, r * 0.55, it.seed + 3, 5, 0.2));
        ink(press, SUN, 1, (c) => {
          for (let i = 0; i < 5; i++) {
            const a = hash(it.seed, i + 1) * TAU;
            const d = r * (0.3 + 0.5 * hash(it.seed, i + 9));
            const lx = x + Math.cos(a) * d;
            const ly = y + Math.sin(a) * d;
            c.moveTo(lx + r * 0.16, ly);
            c.ellipse(lx, ly, r * 0.16, r * 0.12, a, 0, TAU);
          }
        });
        knock(press, [TEAL], (c) => {
          for (let i = 0; i < 5; i++) {
            const a = hash(it.seed, i + 1) * TAU;
            const d = r * (0.3 + 0.5 * hash(it.seed, i + 9));
            const lx = x + Math.cos(a) * d;
            const ly = y + Math.sin(a) * d;
            c.moveTo(lx + r * 0.16, ly);
            c.ellipse(lx, ly, r * 0.16, r * 0.12, a, 0, TAU);
          }
        });
        break;
      }
      case "pine":
        region(press, [0.55, 0.45, 0.1], (c) => blob(c, x, y, r, it.seed, 8, 0.16));
        ink(press, TEAL, 0.82, (c) => blob(c, x + r * 0.15, y + r * 0.1, r * 0.62, it.seed + 2, 7, 0.22));
        ink(press, SUN, 0.75, (c) => blob(c, x - r * 0.32, y - r * 0.3, r * 0.3, it.seed + 5, 5, 0.25));
        break;
      case "bush":
        region(press, [0.3, 0.5, 0], (c) => blob(c, x, y, r, it.seed, 5, 0.22));
        ink(press, SUN, 1, (c) => blob(c, x - r * 0.3, y - r * 0.3, r * 0.32, it.seed + 4, 4, 0.2));
        break;
      case "cypress":
        region(press, [0.85, 0.45, 0.2], (c) => blob(c, x, y, r, it.seed, 5, 0.12));
        ink(press, SUN, 0.6, (c) => blob(c, x - r * 0.25, y - r * 0.25, r * 0.4, it.seed, 4, 0.2));
        break;
      case "rock":
        region(press, [0.38, 0.12, 0.36], (c) => blob(c, x, y, r, it.seed, 4, 0.28));
        ink(press, TEAL, 0.7, (c) => blob(c, x + r * 0.2, y + r * 0.2, r * 0.5, it.seed + 1, 3, 0.3));
        break;
      case "pan":
        region(press, [0, 0, 0], (c) => {
          const [ux, uy] = cam.dir(Math.cos(it.rot), Math.sin(it.rot));
          rectPath(c, x, y, r * 1.1, r * 1.5, ux, uy);
        });
        ink(press, RED, 0.7, (c) => {
          const [ux, uy] = cam.dir(Math.cos(it.rot), Math.sin(it.rot));
          rectPath(c, x, y, r * 1.1, r * 1.5, ux, uy);
        }, Math.max(1, 0.18 * z));
        ink(press, TEAL, 0.18, (c) => {
          const [ux, uy] = cam.dir(Math.cos(it.rot), Math.sin(it.rot));
          rectPath(c, x, y, r * 0.8, r * 1.2, ux, uy);
        });
        break;
      case "house": {
        const [ux, uy] = cam.dir(Math.cos(it.rot), Math.sin(it.rot));
        const hw = r;
        const hh = r * 1.25;
        // Walls (paper) under a terracotta roof: two pitches, one in the light.
        region(press, [0, 0, 0], (c) => rectPath(c, x, y, hw, hh, ux, uy));
        const vx = -uy;
        const vy = ux;
        region(press, [0.05, 0.5, 1], (c) => rectPath(c, x + vx * hw * 0.5, y + vy * hw * 0.5, hw * 0.46, hh * 0.94, ux, uy));
        region(press, [0.06, 0.3, 0.6], (c) => rectPath(c, x - vx * hw * 0.5, y - vy * hw * 0.5, hw * 0.46, hh * 0.94, ux, uy));
        // Tiles: a few lines across the pitches.
        ink(press, RED, 1, (c) => {
          for (let k = -2; k <= 2; k++) {
            const px = x + ux * hh * 0.36 * k;
            const py = y + uy * hh * 0.36 * k;
            c.moveTo(px + vx * hw * 0.92, py + vy * hw * 0.92);
            c.lineTo(px - vx * hw * 0.92, py - vy * hw * 0.92);
          }
        }, Math.max(0.8, 0.08 * z));
        if (night > 0.4) {
          // A lit window spills sunflower onto the ground.
          ink(press, SUN, 1, (c) => rectPath(c, x + vx * (hw + 0.5 * z), y + vy * (hw + 0.5 * z), 0.45 * z, 0.4 * z, ux, uy));
          knock(press, [TEAL, RED], (c) => rectPath(c, x + vx * (hw + 0.5 * z), y + vy * (hw + 0.5 * z), 0.45 * z, 0.4 * z, ux, uy));
        }
        break;
      }
      case "boat": {
        const [ux, uy] = cam.dir(Math.cos(it.rot), Math.sin(it.rot));
        const bob = look.still ? 0 : Math.sin(look.time * 1.3 + it.seed) * 0.08 * z;
        const bx = x + bob;
        // Wake: two paper lines behind.
        knock(press, [TEAL, RED], (c) => {
          c.moveTo(bx - ux * r * 0.9, y - uy * r * 0.9);
          c.lineTo(bx - ux * r * 3 - uy * r * 0.9, y - uy * r * 3 + ux * r * 0.9);
          c.moveTo(bx - ux * r * 0.9, y - uy * r * 0.9);
          c.lineTo(bx - ux * r * 3 + uy * r * 0.9, y - uy * r * 3 - ux * r * 0.9);
        }, Math.max(1, 0.25 * z));
        region(press, [0, 0.2, 1], (c) => {
          c.moveTo(bx + ux * r * 1.3, y + uy * r * 1.3);
          c.quadraticCurveTo(bx + ux * r * 0.3 - uy * r * 0.7, y + uy * r * 0.3 + ux * r * 0.7, bx - ux * r - uy * r * 0.42, y - uy * r + ux * r * 0.42);
          c.lineTo(bx - ux * r + uy * r * 0.42, y - uy * r - ux * r * 0.42);
          c.quadraticCurveTo(bx + ux * r * 0.3 + uy * r * 0.7, y + uy * r * 0.3 - ux * r * 0.7, bx + ux * r * 1.3, y + uy * r * 1.3);
        });
        region(press, [0, 0, 0], (c) => rectPath(c, bx - ux * r * 0.1, y - uy * r * 0.1, r * 0.3, r * 0.45, ux, uy));
        break;
      }
      case "light": {
        // The lighthouse: a round tower in paper with red rings, a lamp room on top.
        region(press, [0, 0, 0], (c) => c.arc(x, y, r, 0, TAU));
        ink(press, RED, 1, (c) => {
          c.arc(x, y, r * 0.98, 0, TAU);
          c.moveTo(x + r * 0.62, y);
          c.arc(x, y, r * 0.62, 0, TAU);
        }, Math.max(1.2, 0.28 * z));
        region(press, [0.9, 0.2, 0.3], (c) => c.arc(x, y, r * 0.36, 0, TAU));
        region(press, [0, 1, 0], (c) => c.arc(x, y, r * 0.2, 0, TAU));
        break;
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// The cart: a little three-wheeled lemon cart, teal cab, wooden bed, a crate when it has one.
// ---------------------------------------------------------------------------------------------------------------

export interface CartPose {
  x: number;
  y: number;
  /** Body yaw (world rad). */
  yaw: number;
  /** Front wheel's angle relative to the body. */
  steer: number;
  crates: number;
  /** 0..1 squash for landings and bumps, scale for a fall. */
  bump: number;
  scale: number;
  /** Lemons left on the bed (0..1). */
  load: number;
  headlamp: number;
}

export function drawCart(press: Press, cam: Cam, p: CartPose, sky: Sky): void {
  // Drawn a size up from the cart's footprint, so it reads at a glance on a phone.
  const z = cam.z * p.scale * 1.28;
  const cx = cam.X(p.x, p.y);
  const cy = cam.Y(p.x, p.y);
  const [ux, uy] = cam.dir(Math.cos(p.yaw), Math.sin(p.yaw));
  const vx = -uy;
  const vy = ux;
  // Local (forward u, left w) metres → screen.
  const P = (u: number, w: number): [number, number] => [cx + (ux * u + vx * w) * z, cy + (uy * u + vy * w) * z];
  const quad = (c: CanvasRenderingContext2D, u0: number, u1: number, w0: number, w1: number) => {
    const a = P(u0, w0);
    const b = P(u1, w0);
    const d = P(u1, w1);
    const e = P(u0, w1);
    c.moveTo(a[0], a[1]);
    c.lineTo(b[0], b[1]);
    c.lineTo(d[0], d[1]);
    c.lineTo(e[0], e[1]);
    c.closePath();
  };
  const rounded = (c: CanvasRenderingContext2D, u0: number, u1: number, hw: number, nose: number) => {
    // A cab with a rounded front.
    const a = P(u0, -hw);
    c.moveTo(a[0], a[1]);
    const n = 8;
    for (let i = 0; i <= n; i++) {
      const t = -Math.PI / 2 + (i / n) * Math.PI;
      const q = P(u1 - nose + Math.cos(t) * nose, Math.sin(t) * hw);
      c.lineTo(q[0], q[1]);
    }
    const e = P(u0, hw);
    c.lineTo(e[0], e[1]);
    c.closePath();
  };
  // Shadow.
  const [sx, sy] = shadowOf(cam, sky, 0.7);
  over(press, [0.35, 0.05, 0.28], (c) => {
    const o = (q: [number, number]): [number, number] => [q[0] + sx, q[1] + sy];
    const pts = [o(P(-1.4, -0.78)), o(P(0.9, -0.78)), o(P(1.45, 0)), o(P(0.9, 0.78)), o(P(-1.4, 0.78))];
    c.moveTo(pts[0]![0], pts[0]![1]);
    for (const q of pts.slice(1)) c.lineTo(q[0], q[1]);
    c.closePath();
  });
  // Wheels: two at the back, one steering at the front.
  const wheel: Cov = [1, 0, 0.9];
  region(press, wheel, (c) => {
    quad(c, -1.12, -0.58, 0.6, 0.86);
    quad(c, -1.12, -0.58, -0.86, -0.6);
  });
  region(press, wheel, (c) => {
    const s = p.steer;
    const fu = Math.cos(s);
    const fw = Math.sin(s);
    const a = P(1.05 + fu * 0.26 - fw * 0.11, fw * 0.26 + fu * 0.11);
    const b = P(1.05 - fu * 0.26 - fw * 0.11, -fw * 0.26 + fu * 0.11);
    const d = P(1.05 - fu * 0.26 + fw * 0.11, -fw * 0.26 - fu * 0.11);
    const e = P(1.05 + fu * 0.26 + fw * 0.11, fw * 0.26 - fu * 0.11);
    c.moveTo(a[0], a[1]);
    c.lineTo(b[0], b[1]);
    c.lineTo(d[0], d[1]);
    c.lineTo(e[0], e[1]);
    c.closePath();
  });
  // The bed: warm wood with slats.
  region(press, [0, 0.55, 0.42], (c) => quad(c, -1.36, 0.22, -0.7, 0.7));
  ink(press, RED, 1, (c) => {
    for (const w of [-0.35, 0, 0.35]) {
      const a = P(-1.3, w);
      const b = P(0.16, w);
      c.moveTo(a[0], a[1]);
      c.lineTo(b[0], b[1]);
    }
  }, Math.max(0.7, 0.05 * z));
  // Lemons heaped on the bed.
  const lemons = Math.round(7 * p.load);
  if (lemons > 0) {
    const spots: Array<[number, number]> = [
      [-0.05, 0.34],
      [-0.12, -0.3],
      [-0.42, 0.05],
      [-0.48, 0.4],
      [-0.5, -0.38],
      [-0.2, 0.02],
      [-0.75, -0.1],
    ];
    const path = (c: CanvasRenderingContext2D) => {
      for (const [u, w] of spots.slice(0, lemons)) {
        const q = P(u, w);
        c.moveTo(q[0] + 0.2 * z, q[1]);
        c.ellipse(q[0], q[1], 0.2 * z, 0.16 * z, Math.atan2(uy, ux), 0, TAU);
      }
    };
    region(press, [0, 1, 0], path);
  }
  // The spare crate at the back: red slats around more lemons.
  if (p.crates > 0) {
    region(press, [0, 0.5, 1], (c) => quad(c, -1.34, -0.72, -0.62, 0.62));
    region(press, [0, 1, 0.2], (c) => quad(c, -1.24, -0.82, -0.5, 0.5));
    ink(press, RED, 1, (c) => {
      const a = P(-1.03, -0.5);
      const b = P(-1.03, 0.5);
      c.moveTo(a[0], a[1]);
      c.lineTo(b[0], b[1]);
    }, Math.max(0.8, 0.08 * z));
  }
  // The cab: teal, a paper windscreen, a little striped canopy over the seat.
  region(press, [1, 0, 0], (c) => rounded(c, 0.16, 1.4, 0.66, 0.5));
  region(press, [0, 0, 0], (c) => quad(c, 0.78, 1.0, -0.5, 0.5));
  ink(press, RED, 1, (c) => {
    for (const w of [-0.4, -0.13, 0.14, 0.41]) {
      const a = P(0.24, w);
      const b = P(0.7, w);
      c.moveTo(a[0], a[1]);
      c.lineTo(b[0], b[1]);
    }
  }, Math.max(0.9, 0.11 * z));
  // Headlamp.
  region(press, [0, 1, 0], (c) => {
    const q = P(1.32, 0);
    c.arc(q[0], q[1], Math.max(1.2, 0.13 * z), 0, TAU);
  });
}

/** Where the headlamp lights at night: a fan ahead of the cart, knocked out of the teal and red plates. */
export function drawHeadlamp(press: Press, cam: Cam, x: number, y: number, yaw: number, k: number): void {
  if (k <= 0.05) return;
  const z = cam.z;
  const cx = cam.X(x, y);
  const cy = cam.Y(x, y);
  const [ux, uy] = cam.dir(Math.cos(yaw), Math.sin(yaw));
  const vx = -uy;
  const vy = ux;
  const fan = (len: number, spread: number) => (c: CanvasRenderingContext2D) => {
    const n0x = cx + ux * 1.3 * z;
    const n0y = cy + uy * 1.3 * z;
    c.moveTo(n0x + vx * 0.4 * z, n0y + vy * 0.4 * z);
    c.lineTo(n0x + (ux * len + vx * spread) * z, n0y + (uy * len + vy * spread) * z);
    c.quadraticCurveTo(n0x + ux * (len + 3) * z, n0y + uy * (len + 3) * z, n0x + (ux * len - vx * spread) * z, n0y + (uy * len - vy * spread) * z);
    c.lineTo(n0x - vx * 0.4 * z, n0y - vy * 0.4 * z);
    c.closePath();
  };
  // A soft outer fan (paper dots) and a cleaner inner one, lifted off the teal and red so the lit ground shows warm.
  for (const p of [TEAL, RED] as const) {
    const c = press.plate(p);
    c.globalCompositeOperation = "destination-out";
    c.fillStyle = press.screen(p, Math.min(0.5, 0.5 * k));
    c.beginPath();
    fan(13, 4.8)(c);
    c.fill();
    c.fillStyle = press.screen(p, Math.min(0.8, 0.8 * k));
    c.beginPath();
    fan(8, 2.4)(c);
    c.fill();
    c.globalCompositeOperation = "source-over";
  }
}

export { CAR_HALF_W, HALF, OFF, VERGE };
