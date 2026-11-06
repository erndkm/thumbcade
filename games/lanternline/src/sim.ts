/**
 * Lanternline's world and physics. Pure: no DOM, no canvas, so it runs headless for playtests.
 *
 * World units (wu): x grows to the right, y grows downward, the meadow floor sits near y = 0.
 * A run starts on a cliff at x = 0. Score = meters travelled (WU_PER_M wu each) + seed bonus.
 */
import { clamp, lerp } from "@thumbcade-games/kit/ease";
import { createRng, type Rng } from "@thumbcade-games/kit/rng";

export const WU_PER_M = 30;
export const G = 930;
/** How far the line reaches. */
export const RANGE = 268;
export const MIN_ROPE = 64;
export const MAX_SPEED = 980;
/** Seconds a lantern's line holds before it frays through (summed over every grab of that lantern). */
export const WEAR_MAX = 4.6;
export const BODY_R = 7;
/** Below this the mist takes you. */
export const DEATH_Y = 380;
export const STEP = 1 / 120;
export const SEED_BONUS = 5;
/** Tangential push while swinging (wu/s²). */
export const PUMP = 70;
/** Room kept between a lantern and the highest terrain under its swing. */
const MIN_CLEAR = 175;
const TS = 4;
const CHUNK = 256;
const NO_GROUND = 2000;

export interface Island {
  x: number;
  /** Top surface y. */
  y: number;
  w: number;
  h: number;
  /** Polygon, flat [x0, y0, x1, y1, …], clockwise from the top-left. */
  pts: number[];
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  hazard: boolean;
  seed: number;
}

export interface Anchor {
  id: number;
  /** Hinge the chain hangs from. */
  hx: number;
  hy: number;
  chain: number;
  /** Chain sway: amplitude (rad), angular speed, phase. */
  amp: number;
  w: number;
  ph: number;
  /** Lantern position now. */
  x: number;
  y: number;
  lit: number;
  wear: number;
  island: Island | null;
}

export interface Seed {
  x: number;
  y: number;
  ph: number;
  taken: boolean;
  /** Seconds since it was taken (for the bloom). */
  gone: number;
}

export type SimEvent =
  | { k: "grab"; anchor: Anchor; low: boolean }
  | { k: "release"; good: boolean; speed: number }
  | { k: "seed"; x: number; y: number; chain: number }
  | { k: "snap"; anchor: Anchor }
  | { k: "near"; x: number; y: number }
  | { k: "miss" }
  | { k: "die"; how: "ground" | "island" | "mist" };

export interface Tether {
  anchor: Anchor;
  len: number;
  t: number;
}

export interface WorldOptions {
  seed: number;
  /** Attract demo: gentle, fixed difficulty, lines never fray. */
  demo?: boolean;
}

/** 0..1 difficulty from meters. Ramps over the first ~900 m. */
export function difficulty(m: number): number {
  return clamp(m / 900) ** 0.85;
}

interface Segment {
  x0: number;
  x1: number;
}

export class World {
  readonly demo: boolean;
  readonly rng: Rng;
  time = 0;
  x = -26;
  y = -128 - BODY_R;
  vx = 0;
  vy = 0;
  standing = true;
  alive = true;
  deadT = 0;
  deathHow: "ground" | "island" | "mist" | null = null;
  tether: Tether | null = null;
  /** Seconds since the last release / snap (for the line's recoil). */
  sinceRelease = 9;
  lastAnchor: Anchor | null = null;
  holding = false;
  /** Releases in the good window in a row. */
  flow = 0;
  seedChain = 0;
  seedChainT = 0;
  bonus = 0;
  maxX = 0;
  grabs = 0;
  goodReleases = 0;
  seedsTaken = 0;
  nearCool = 0;
  private missed = false;
  anchors: Anchor[] = [];
  islands: Island[] = [];
  seeds: Seed[] = [];
  events: SimEvent[] = [];
  private chunks = new Map<number, Float32Array>();
  private nextAnchorId = 0;
  private genAnchorX = 0;
  private genAnchorY = 0;
  private genTerrainX = 0;
  private lastSeg: Segment | null = null;

  constructor(opts: WorldOptions) {
    this.demo = !!opts.demo;
    this.rng = createRng(opts.seed);
    this.buildStart();
    this.generate(this.x + 2400);
  }

  get meters(): number {
    return Math.max(0, Math.floor(this.maxX / WU_PER_M)) + this.bonus;
  }

  get distanceM(): number {
    return Math.max(0, this.maxX / WU_PER_M);
  }

  get speed(): number {
    return Math.hypot(this.vx, this.vy);
  }

  /** Difficulty at world x. */
  diffAt(x: number): number {
    return this.demo ? 0.12 : difficulty(x / WU_PER_M);
  }

  // ---------------------------------------------------------------------------------------------
  // Terrain
  // ---------------------------------------------------------------------------------------------

  private sample(i: number): number {
    const c = this.chunks.get(Math.floor(i / CHUNK));
    if (!c) return NO_GROUND;
    return c[((i % CHUNK) + CHUNK) % CHUNK]!;
  }

  private setSample(i: number, y: number): void {
    const ci = Math.floor(i / CHUNK);
    let c = this.chunks.get(ci);
    if (!c) {
      c = new Float32Array(CHUNK).fill(NO_GROUND);
      this.chunks.set(ci, c);
    }
    c[((i % CHUNK) + CHUNK) % CHUNK] = y;
  }

  private raise(i: number, y: number): void {
    if (y < this.sample(i)) this.setSample(i, y);
  }

  /** Ground surface y at x (higher terrain = smaller y). */
  groundY(x: number): number {
    const f = x / TS;
    const i = Math.floor(f);
    const a = this.sample(i);
    const b = this.sample(i + 1);
    return a + (b - a) * (f - i);
  }

  /** Highest terrain (smallest y) over [x0, x1]. */
  groundTop(x0: number, x1: number): number {
    let m = NO_GROUND;
    for (let i = Math.floor(x0 / TS); i <= Math.ceil(x1 / TS); i++) m = Math.min(m, this.sample(i));
    return m;
  }

  /** Samples for drawing: calls fn(x, y) every TS wu over [x0, x1]. */
  forGround(x0: number, x1: number, step: number, fn: (x: number, y: number) => void): void {
    const s = Math.max(1, Math.round(step / TS));
    const i0 = Math.floor(x0 / TS);
    const i1 = Math.ceil(x1 / TS);
    for (let i = i0; i <= i1 + s; i += s) fn(i * TS, this.sample(i));
  }

  private buildStart(): void {
    // A grassy cliff to leap from, then a drop into the mist.
    for (let x = -1400; x <= 24; x += TS) {
      const y = -128 + Math.sin(x * 0.013) * 5 + Math.sin(x * 0.051) * 1.5 + Math.max(0, -x - 120) * 0.12;
      // The lip: a few broken steps down the cliff face.
      const lip = x > 0 ? (x * x) / 6 + Math.sin(x * 1.7) * 3 : 0;
      this.setSample(Math.round(x / TS), y + lip);
    }
    // A few pines on the cliff, well behind the start.
    for (const [cx, h] of [
      [-210, 92],
      [-168, 66],
      [-120, 118],
      [-300, 74],
      [-360, 104],
    ] as const) {
      this.pine(cx, -128, h);
    }
    for (let x = 28; x < 230; x += TS) this.setSample(Math.round(x / TS), 900);
    this.genTerrainX = 230;
    this.lastSeg = { x0: 24, x1: 230 };
    this.genAnchorX = 0;
    this.genAnchorY = -300;
  }

  private pine(cx: number, base: number, h: number): void {
    // Stacked tiers: each one a little lower and wider; the outline is the highest tier at every x.
    const n = Math.max(3, Math.round(h / 18));
    const hw = h * 0.3;
    const top = base - h;
    for (let x = cx - hw; x <= cx + hw; x += TS) {
      const dx = Math.abs(x - cx);
      let y = Infinity;
      for (let i = 0; i < n; i++) {
        const apex = top + (i / n) * h * 0.74;
        const wb = (hw * (i + 1)) / n;
        if (dx > wb) continue;
        y = Math.min(y, apex + (dx / wb) * h * 0.36);
      }
      if (y < Infinity) this.raise(Math.round(x / TS), y);
    }
    // Trunk.
    for (let x = cx - 2; x <= cx + 2; x += TS) this.raise(Math.round(x / TS), base - h * 0.2);
  }

  private spire(cx: number, base: number, top: number, w: number): void {
    const r = this.rng;
    const k1 = r.range(0.5, 1);
    for (let x = cx - w; x <= cx + w; x += TS) {
      const u = (x - cx) / w;
      const shape = 1 - Math.abs(u) ** (2.2 + k1);
      const crag = Math.sin(x * 0.19 + cx) * 3 + Math.sin(x * 0.07) * 4;
      this.raise(Math.round(x / TS), lerp(base, top, shape) + crag * shape);
    }
  }

  private ruin(cx: number, base: number, h: number): void {
    // A broken watchtower: crenellated top, one shoulder sheared off, a low wall running out from it.
    const r = this.rng;
    const half = r.range(11, 16);
    const shear = r.range(0.25, 0.6);
    for (let x = cx - half; x <= cx + half; x += TS) {
      const u = (x - cx + half) / (half * 2);
      let y = base - h;
      if (Math.floor(u * 5) % 2 === 1) y += 4;
      if (u > 1 - shear) y += (u - (1 - shear)) * h * 0.9;
      this.raise(Math.round(x / TS), y);
    }
    const wall = r.range(30, 60);
    const dir = r.chance(0.5) ? 1 : -1;
    for (let k = 0; k < wall; k += TS) {
      const x = cx + dir * (half + k);
      this.raise(Math.round(x / TS), base - h * 0.32 + Math.abs(Math.sin(k * 0.21)) * 6 + (k / wall) * h * 0.2);
    }
  }

  private generateTerrain(until: number): void {
    const r = this.rng;
    while (this.genTerrainX < until) {
      const x0 = this.genTerrainX;
      const d = this.diffAt(x0);
      const chasm = x0 > 900 && r.chance(this.demo ? 0.16 : lerp(0.14, 0.26, d));
      if (chasm) {
        const len = r.range(140, lerp(260, 420, d));
        for (let x = x0; x < x0 + len; x += TS) this.setSample(Math.round(x / TS), 900);
        this.genTerrainX = x0 + len;
        continue;
      }
      // Meadow: rolling ground, pines, now and then a ruin or a rock spire.
      const len = r.range(380, 760);
      const level = r.range(-34, -6);
      const p1 = r.range(0, 6.28);
      const p2 = r.range(0, 6.28);
      const edge = 26;
      for (let x = x0; x < x0 + len; x += TS) {
        const e = Math.min(x - x0, x0 + len - x);
        // Cliff lips at the ends: the meadow drops away steeply into the mist.
        const lip = e < edge ? (edge - e) * 7 : 0;
        const y = level + Math.sin(x * 0.0045 + p1) * 16 + Math.sin(x * 0.013 + p2) * 7 + Math.sin(x * 0.07) * 1.2 + lip;
        this.setSample(Math.round(x / TS), Math.min(900, y));
      }
      let x = x0 + r.range(40, 90);
      const pineMax = this.demo ? 96 : lerp(72, 150, d);
      while (x < x0 + len - 50) {
        const roll = r();
        const base = this.groundY(x);
        if (roll < (this.demo ? 0 : lerp(0, 0.16, clamp((d - 0.12) / 0.5)))) {
          this.spire(x, base + 6, this.demo ? -150 : -lerp(150, 260, d) + r.range(-20, 20), r.range(22, 40));
          x += r.range(120, 200);
        } else if (roll < 0.22) {
          this.ruin(x, base + 2, r.range(36, 60));
          x += r.range(70, 130);
        } else {
          const n = r.int(1, 4);
          for (let k = 0; k < n; k++) this.pine(x + k * r.range(14, 26), this.groundY(x + k * 20) + 4, r.range(38, pineMax));
          x += r.range(60, 180);
        }
      }
      this.genTerrainX = x0 + len;
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Islands, lanterns, seeds
  // ---------------------------------------------------------------------------------------------

  private makeIsland(cx: number, top: number, w: number, h: number, hazard: boolean): Island {
    const r = this.rng;
    const pts: number[] = [];
    const L = cx - w / 2;
    const R = cx + w / 2;
    // Top edge, left to right, with a broken column or two standing on it.
    pts.push(L, top + 4);
    const colA = r.range(0.2, 0.42);
    const colB = r.range(0.58, 0.8);
    const hA = r.range(10, 30);
    const hB = r.chance(0.6) ? r.range(8, 22) : 0;
    const top1 = (u: number) => top + Math.sin(u * 9 + cx) * 1.6;
    for (let u = 0.04; u < 0.98; u += 0.06) {
      const x = L + w * u;
      if (Math.abs(u - colA) < 0.04) {
        pts.push(x - 1, top1(u), x - 1, top1(u) - hA, x + 7, top1(u) - hA - 3, x + 7, top1(u));
      } else if (hB && Math.abs(u - colB) < 0.04) {
        pts.push(x - 1, top1(u), x - 1, top1(u) - hB, x + 6, top1(u) - hB, x + 6, top1(u));
      } else pts.push(x, top1(u));
    }
    pts.push(R, top + 4);
    // Underside: a craggy wedge down to a point.
    const tip = cx + r.range(-w * 0.12, w * 0.12);
    const n = 7;
    for (let k = 1; k <= n; k++) {
      const u = k / (n + 1);
      const x = lerp(R, tip, u);
      const y = top + 4 + h * (u ** 0.8) + r.range(-5, 5);
      pts.push(x + r.range(-4, 4), y);
    }
    pts.push(tip, top + h);
    for (let k = n; k >= 1; k--) {
      const u = k / (n + 1);
      const x = lerp(L, tip, u);
      const y = top + 4 + h * (u ** 0.8) + r.range(-5, 5);
      pts.push(x + r.range(-4, 4), y);
    }
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < pts.length; i += 2) {
      minX = Math.min(minX, pts[i]!);
      maxX = Math.max(maxX, pts[i]!);
      minY = Math.min(minY, pts[i + 1]!);
      maxY = Math.max(maxY, pts[i + 1]!);
    }
    const isl: Island = { x: cx, y: top, w, h, pts, minX, maxX, minY, maxY, hazard, seed: r() };
    this.islands.push(isl);
    return isl;
  }

  private islandFree(minX: number, maxX: number, minY: number, maxY: number): boolean {
    for (const i of this.islands) {
      if (i.maxX + 24 > minX && i.minX - 24 < maxX && i.maxY + 30 > minY && i.minY - 30 < maxY) return false;
    }
    return true;
  }

  private generateAnchors(until: number): void {
    const r = this.rng;
    while (this.genAnchorX < until) {
      const first = this.nextAnchorId === 0;
      const d = this.diffAt(this.genAnchorX);
      const gap = first ? 196 : lerp(164, 296, d) + r.range(-24, 30) * (0.5 + d);
      const ax = this.genAnchorX + gap;
      const hiY = this.demo ? -380 : lerp(-390, -470, d);
      const loY = this.demo ? -300 : lerp(-300, -320, d);
      const jitter = this.demo ? 50 : lerp(42, 130, d);
      let ay = first ? -330 : clamp(this.genAnchorY + r.range(-jitter, jitter), hiY, loY);
      // Every lantern leaves room to swing beneath it.
      const under = this.groundTop(ax - 130, ax + 170);
      if (ay > under - MIN_CLEAR) ay = Math.max(hiY - 70, under - MIN_CLEAR);
      let chain = r.range(46, 104);
      let island: Island | null = null;
      let hx = ax;
      let hy = ay - chain;
      if (first || r.chance(this.demo ? 0.8 : lerp(0.82, 0.62, d))) {
        const w = r.range(74, 150);
        const h = r.range(36, 64);
        const top = hy - h;
        const cx = ax + r.range(-w * 0.1, w * 0.1);
        island = this.makeIsland(cx, top, w, h, false);
        // Hang from the underside's tip.
        const [tx, ty] = this.findTip(island);
        hx = tx;
        hy = ty - 2;
      } else {
        // Hangs from a floating paper sky-lantern on a short cord.
        chain = r.range(42, 66);
        hy = ay - chain;
      }
      const sway = !this.demo && d > 0.32 && r.chance(lerp(0.2, 0.6, (d - 0.32) / 0.68));
      const a: Anchor = {
        id: this.nextAnchorId++,
        hx,
        hy,
        chain: ay - hy,
        amp: sway ? r.range(0.12, lerp(0.18, 0.32, d)) : r.range(0.01, 0.03),
        w: r.range(1.3, 1.9),
        ph: r.range(0, Math.PI * 2),
        x: hx,
        y: hy + (ay - hy),
        lit: 0,
        wear: 0,
        island,
      };
      const prev = this.anchors[this.anchors.length - 1];
      this.anchors.push(a);
      if (prev && !first) {
        this.maybeSeeds(prev, a, d);
        this.maybeHazard(prev, a, d);
      }
      this.genAnchorX = ax;
      this.genAnchorY = ay;
    }
  }

  private findTip(isl: Island): [number, number] {
    let bx = isl.x;
    let by = -Infinity;
    for (let i = 0; i < isl.pts.length; i += 2) {
      if (isl.pts[i + 1]! > by) {
        by = isl.pts[i + 1]!;
        bx = isl.pts[i]!;
      }
    }
    return [bx, by];
  }

  /** Seeds along a believable flight arc between two lanterns. */
  private maybeSeeds(a: Anchor, b: Anchor, d: number): void {
    const r = this.rng;
    if (!r.chance(this.demo ? 0.5 : lerp(0.62, 0.42, d))) return;
    const L0 = 170;
    const p0x = a.x + L0 * Math.sin(0.62);
    const p0y = a.y + L0 * Math.cos(0.62);
    const L1 = 160;
    const p1x = b.x - L1 * Math.sin(0.66);
    const p1y = b.y + L1 * Math.cos(0.66);
    const dx = p1x - p0x;
    if (dx < 40) return;
    const T = clamp(dx / 400, 0.3, 0.85);
    const vx = dx / T;
    const vy = (p1y - p0y) / T - 0.5 * G * T;
    const n = r.int(3, 5);
    for (let k = 1; k <= n; k++) {
      const t = (T * k) / (n + 1);
      const x = p0x + vx * t;
      const y = p0y + vy * t + 0.5 * G * t * t;
      if (this.groundTop(x - 10, x + 10) < y + 40) return;
      this.seeds.push({ x, y, ph: r.range(0, 6.28), taken: false, gone: 0 });
    }
  }

  /** Later on, a bare rock floats high in the gap and punishes a release that's too strong. */
  private maybeHazard(a: Anchor, b: Anchor, d: number): void {
    const r = this.rng;
    if (this.demo || d < 0.26 || !r.chance(lerp(0.15, 0.45, (d - 0.26) / 0.74))) return;
    const cx = (a.x + b.x) / 2 + r.range(-30, 30);
    const w = r.range(56, 96);
    const h = r.range(30, 52);
    const bottom = Math.min(a.y, b.y) - lerp(150, 105, d) + r.range(-20, 10);
    const top = bottom - h;
    if (!this.islandFree(cx - w / 2, cx + w / 2, top - 30, bottom)) return;
    this.makeIsland(cx, top, w, h, true);
  }

  private generate(until: number): void {
    this.generateTerrain(until + 400);
    this.generateAnchors(until);
  }

  /** Drops what is far behind the figure. */
  private prune(): void {
    const behind = this.x - 1400;
    while (this.anchors.length && this.anchors[0]!.x < behind && this.anchors[0] !== this.tether?.anchor) this.anchors.shift();
    while (this.islands.length && this.islands[0]!.maxX < behind) this.islands.shift();
    while (this.seeds.length && this.seeds[0]!.x < behind) this.seeds.shift();
    for (const k of this.chunks.keys()) if ((k + 1) * CHUNK * TS < behind - 600) this.chunks.delete(k);
  }

  // ---------------------------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------------------------

  /** The lantern a line would reach right now: the nearest one ahead within range. */
  targetFrom(x: number, y: number, exclude: Anchor | null = null): Anchor | null {
    let best: Anchor | null = null;
    let bd = RANGE;
    for (const a of this.anchors) {
      if (a === exclude || a.x < x + 6 || a.x > x + RANGE) continue;
      if (!this.demo && a.wear >= WEAR_MAX) continue;
      const d = Math.hypot(a.x - x, a.y - y);
      if (d < bd) {
        bd = d;
        best = a;
      }
    }
    return best;
  }

  target(): Anchor | null {
    return this.targetFrom(this.x, this.y);
  }

  insideIsland(x: number, y: number): Island | null {
    for (const i of this.islands) {
      if (x < i.minX || x > i.maxX || y < i.minY || y > i.maxY) continue;
      if (pointInPoly(i.pts, x, y)) return i;
    }
    return null;
  }

  /** Clearance to the nearest solid (rough; for near-miss slow motion). */
  clearance(x: number, y: number): number {
    let c = this.groundY(x) - y;
    for (const dx of [-14, 14]) c = Math.min(c, this.groundY(x + dx) - y);
    for (const i of this.islands) {
      if (x < i.minX - 30 || x > i.maxX + 30 || y < i.minY - 30 || y > i.maxY + 30) continue;
      for (const [dx, dy] of OFFS) if (pointInPoly(i.pts, x + dx * 18, y + dy * 18)) c = Math.min(c, 9);
    }
    return c - BODY_R;
  }

  /** True when the body at (x, y) touches something solid. */
  solid(x: number, y: number): "ground" | "island" | "mist" | null {
    if (y > DEATH_Y) return "mist";
    if (y + BODY_R * 0.8 > this.groundY(x)) return "ground";
    if (this.insideIsland(x, y) || this.insideIsland(x, y - BODY_R)) return "island";
    return null;
  }

  // ---------------------------------------------------------------------------------------------
  // Simulation
  // ---------------------------------------------------------------------------------------------

  /** Leap off the cliff. */
  launch(): void {
    this.standing = false;
    this.vx = 300;
    this.vy = -390;
  }

  setHold(h: boolean): void {
    this.holding = h;
  }

  /** Advance by dt seconds (already slowed by the caller's time scale). */
  update(dt: number): void {
    // Equal substeps that add up to exactly dt. A fixed step with a carried remainder makes some frames move the
    // world and others not (in slow motion and on 120 Hz screens), which reads as stutter.
    const total = Math.min(dt, 0.1);
    if (total <= 0) return;
    const n = Math.ceil(total / STEP - 1e-6);
    for (let i = 0; i < n; i++) this.step(total / n);
  }

  private updateAnchors(): void {
    for (const a of this.anchors) {
      const ang = Math.sin(this.time * a.w + a.ph) * a.amp;
      a.x = a.hx + Math.sin(ang) * a.chain;
      a.y = a.hy + Math.cos(ang) * a.chain;
    }
  }

  private step(h: number): void {
    this.time += h;
    this.sinceRelease += h;
    this.nearCool = Math.max(0, this.nearCool - h);
    this.seedChainT = Math.max(0, this.seedChainT - h);
    if (this.seedChainT <= 0) this.seedChain = 0;
    this.updateAnchors();
    for (const a of this.anchors) if (a.lit > 0 && a.lit < 1) a.lit = Math.min(1, a.lit + h * 2.5);
    for (const s of this.seeds) if (s.taken) s.gone += h;
    this.generate(this.x + 2400);
    if (this.time % 1 < h) this.prune();

    if (this.standing) return;

    if (!this.alive) {
      this.deadT += h;
      this.vy += G * h;
      this.vx *= Math.exp(-1.6 * h);
      const nx = this.x + this.vx * h;
      const ny = this.y + this.vy * h;
      const gy = this.groundY(nx) - BODY_R * 0.6;
      if (ny > gy && this.deathHow !== "mist" && gy < 600) {
        this.y = gy;
        this.vy = -Math.abs(this.vy) * 0.18;
        this.vx *= 0.5;
        this.x = nx;
      } else {
        this.x = nx;
        this.y = Math.min(ny, DEATH_Y + 400);
      }
      return;
    }

    // Input: hold fires the line (and keeps trying while held), letting go releases it.
    if (this.holding && !this.tether) this.tryGrab();
    if (!this.holding && this.tether) this.release(false);

    this.vy += G * h;
    this.x += this.vx * h;
    this.y += this.vy * h;

    const t = this.tether;
    if (t) {
      t.t += h;
      const a = t.anchor;
      if (!this.demo) {
        a.wear += h;
        if (a.wear >= WEAR_MAX) {
          this.events.push({ k: "snap", anchor: a });
          this.release(true);
        }
      }
      if (this.tether) {
        // A short reel-in right after the catch: it pumps a little speed into the swing.
        if (t.t < 0.32) t.len = Math.max(MIN_ROPE, t.len - 46 * h);
        const dx = this.x - a.x;
        const dy = this.y - a.y;
        const d = Math.hypot(dx, dy);
        // A gentle pump along the swing: hanging on always builds a little amplitude, so no swing is a dead end.
        if (d > 1) {
          const tx = -dy / d;
          const ty = dx / d;
          const vt = this.vx * tx + this.vy * ty;
          if (Math.abs(vt) > 30) {
            const s = Math.sign(vt) * PUMP * h;
            this.vx += tx * s;
            this.vy += ty * s;
          }
        }
        if (d > t.len) {
          const nx = dx / d;
          const ny = dy / d;
          this.x = a.x + nx * t.len;
          this.y = a.y + ny * t.len;
          const vr = this.vx * nx + this.vy * ny;
          if (vr > 0) {
            this.vx -= vr * nx;
            this.vy -= vr * ny;
          }
        }
      }
    }
    const sp = Math.hypot(this.vx, this.vy);
    if (sp > MAX_SPEED) {
      this.vx *= MAX_SPEED / sp;
      this.vy *= MAX_SPEED / sp;
    }

    // Seeds.
    for (const s of this.seeds) {
      if (s.taken || Math.abs(s.x - this.x) > 22) continue;
      if (Math.hypot(s.x - this.x, s.y - this.y) < 22) {
        s.taken = true;
        this.seedChain++;
        this.seedChainT = 1.4;
        this.seedsTaken++;
        if (!this.demo) this.bonus += SEED_BONUS;
        this.events.push({ k: "seed", x: s.x, y: s.y, chain: this.seedChain });
      }
    }

    if (this.x > this.maxX) this.maxX = this.x;

    const hit = this.solid(this.x, this.y);
    if (hit) {
      this.die(hit);
      return;
    }
    if (this.nearCool <= 0 && sp > 240) {
      const c = this.clearance(this.x, this.y);
      if (c < 15) {
        this.nearCool = 2.4;
        this.events.push({ k: "near", x: this.x, y: this.y });
      }
    }
  }

  private tryGrab(): void {
    const a = this.target();
    if (!a) {
      if (this.sinceRelease > 0.25 && !this.missed) {
        this.missed = true;
        this.events.push({ k: "miss" });
      }
      return;
    }
    this.missed = false;
    const dx = this.x - a.x;
    const dy = this.y - a.y;
    const d = Math.hypot(dx, dy);
    const len = Math.max(MIN_ROPE, d);
    this.tether = { anchor: a, len, t: 0 };
    // The line catches softly: the body keeps its speed and turns onto the swing.
    if (d > 1) {
      const tx = -dy / d;
      const ty = dx / d;
      const vt = this.vx * tx + this.vy * ty;
      const sp = Math.hypot(this.vx, this.vy) * 0.97;
      const dir = vt >= 0 ? 1 : -1;
      const vr = (this.vx * dx + this.vy * dy) / d;
      // Only when the catch would otherwise jerk (moving away from the lantern).
      if (vr > 0) {
        this.vx = tx * sp * dir;
        this.vy = ty * sp * dir;
      }
    }
    if (a.lit === 0) a.lit = 0.01;
    this.grabs++;
    const low = this.groundY(this.x) - this.y < 70 || this.y > DEATH_Y - 120;
    this.events.push({ k: "grab", anchor: a, low });
  }

  /** Velocity angle above the horizon (rad) and whether a release now counts as good. */
  releaseWindow(vx = this.vx, vy = this.vy): { angle: number; good: boolean } {
    const angle = Math.atan2(-vy, vx);
    return { angle, good: vx > 110 && angle > 0.26 && angle < 1.13 };
  }

  private release(snapped: boolean): void {
    const t = this.tether;
    if (!t) return;
    this.tether = null;
    this.lastAnchor = t.anchor;
    this.sinceRelease = 0;
    this.missed = false;
    const { good } = this.releaseWindow();
    if (!snapped && good) {
      this.flow = Math.min(this.flow + 1, 12);
      this.goodReleases++;
      const k = 1.035 + Math.min(this.flow, 6) * 0.004;
      this.vx = this.vx * k + 10;
      this.vy *= k;
    } else if (!snapped) {
      this.flow = Math.max(0, this.flow - 2);
    }
    this.events.push({ k: "release", good: !snapped && good, speed: this.speed });
  }

  private die(how: "ground" | "island" | "mist"): void {
    if (!this.alive) return;
    this.alive = false;
    this.deathHow = how;
    this.deadT = 0;
    if (this.tether) {
      this.lastAnchor = this.tether.anchor;
      this.tether = null;
      this.sinceRelease = 0;
    }
    if (how !== "mist") {
      this.vx *= -0.25;
      this.vy = -Math.abs(this.vy) * 0.25 - 80;
    }
    this.events.push({ k: "die", how });
  }

  drain(): SimEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }
}

const OFFS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

export function pointInPoly(p: number[], x: number, y: number): boolean {
  let inside = false;
  const n = p.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = p[i * 2]!;
    const yi = p[i * 2 + 1]!;
    const xj = p[j * 2]!;
    const yj = p[j * 2 + 1]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// -----------------------------------------------------------------------------------------------
// The pilot: plays the attract demo and the headless playtests.
// -----------------------------------------------------------------------------------------------

/** Would grabbing `a` from (x, y) give a clean swing? */
export function goodGrab(w: World, a: Anchor, x: number, y: number, vy: number): boolean {
  const d = Math.hypot(a.x - x, a.y - y);
  if (d > (w.demo ? 190 : RANGE - 4) || d < 84) return false;
  if (y < a.y + 20) return false;
  const phi = Math.atan2(x - a.x, y - a.y);
  if (phi > -0.12 || phi < -1.25) return false;
  if (vy < -260) return false;
  const bottom = a.y + Math.max(MIN_ROPE, d - 14);
  if (w.groundTop(a.x - d * 0.35, a.x + d * 0.75) < bottom + 30) return false;
  if (bottom > DEATH_Y - 60) return false;
  return true;
}

/** Ballistic look-ahead: does a release with this velocity lead to a good grab without hitting anything? */
export function flightOk(w: World, x: number, y: number, vx: number, vy: number, from: Anchor | null, maxT = 1.8): boolean {
  const h = 1 / 60;
  for (let t = 0; t < maxT; t += h) {
    vy += G * h;
    x += vx * h;
    y += vy * h;
    if (w.solid(x, y)) return false;
    if (w.clearance(x, y) < 10) return false;
    const a = w.targetFrom(x, y, from);
    if (a && a !== from && t > 0.08 && goodGrab(w, a, x, y, vy)) return true;
  }
  return false;
}

export interface Pilot {
  hold: boolean;
  /** Seconds on the current line. */
  onLine: number;
}

/** One frame of the pilot's decision. `prefer` = preferred release angle (rad above horizontal). */
export function pilot(w: World, p: Pilot, dt: number, prefer = 0.62): boolean {
  if (!w.alive || w.standing) return (p.hold = false);
  const t = w.tether;
  if (!t) {
    p.onLine = 0;
    const a = w.target();
    let want = !!a && goodGrab(w, a, w.x, w.y, w.vy);
    // Falling toward trouble: grab whatever is there.
    if (!want && a && (w.groundY(w.x) - w.y < 70 || w.y > DEATH_Y - 140) && w.vy > 0) want = true;
    p.hold = want;
    return p.hold;
  }
  p.onLine += dt;
  const a = t.anchor;
  const phi = Math.atan2(w.x - a.x, w.y - a.y);
  if (w.vx > 60 && phi > 0.05) {
    const win = w.releaseWindow();
    const k = win.good ? 1.035 + Math.min(w.flow, 6) * 0.004 : 1;
    const ok = flightOk(w, w.x, w.y, w.vx * k + (win.good ? 10 : 0), w.vy * k, a);
    // Highest angle this swing can still reach.
    const v2 = w.vx * w.vx + w.vy * w.vy;
    const cosMax = (w.y - a.y) / t.len - v2 / (2 * G * t.len);
    const phiMax = Math.acos(clamp(cosMax, -1, 1));
    if (ok && (win.angle >= prefer || phi >= phiMax * 0.78)) return (p.hold = false);
  }
  if (!w.demo && a.wear > WEAR_MAX - 0.25) return (p.hold = false);
  if (w.demo && p.onLine > 7) return (p.hold = false);
  p.hold = true;
  return true;
}
