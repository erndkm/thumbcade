/**
 * Longhop's world and physics. Pure: no DOM, no canvas, so it runs headless for playtests.
 *
 * World units (wu): x grows to the right, y grows downward, the plain sits near y = 0.
 * The tracked point is the kangaroo's feet. A hop is a ballistic arc; a landing is a stance on the spring of the
 * legs. Hold as you land and the legs load; let go to spring. Letting go at the bottom of the squat gives the
 * whole hop back (and a little speed); early gives a partial hop, late lets the energy leak away, and landing
 * without holding is a stiff little bounce. Score = meters travelled + wildflower bonus.
 */
import { clamp, lerp } from "@thumbcade-games/kit/ease";
import { createRng, type Rng } from "@thumbcade-games/kit/rng";

export const WU_PER_M = 30;
export const G = 1500;
export const STEP = 1 / 120;
/** Seconds from touchdown to the bottom of the squat on firm ground. */
export const T_BOTTOM = 0.19;
/** A release within this many seconds of the bottom is perfect. */
export const PERFECT = 0.055;
/** A press this soon after touchdown still counts as holding as you land. */
export const GRACE = 0.06;
/** Stance length of a stiff (unloaded) bounce. */
export const T_STIFF = 0.07;
/** Hop height (wu) at power 0 and power 1. */
export const H_MIN = 16;
export const H_MAX = 150;
export const P_STIFF = 0.16;
export const VX0 = 280;
export const VX_MIN = 200;
/** Holding this long in the squat lets go by itself. */
export const MAX_HOLD = 1.6;
export const FLOWER_BONUS = 5;
/** The feet sink this far into a gully before it's over. */
const FALL_Y = 70;
const NO_GROUND = 10000;

export type Surface = "earth" | "sand" | "salt";
export type ObstacleKind = "mound" | "rock" | "log";

export interface Gully {
  x0: number;
  x1: number;
  seed: number;
}

export interface Patch {
  x0: number;
  x1: number;
  kind: "sand" | "salt";
  seed: number;
}

export interface Obstacle {
  kind: ObstacleKind;
  /** Center x and half-width. */
  x: number;
  w: number;
  h: number;
  /** Ground y under it. */
  base: number;
  seed: number;
}

/** A low gum branch: nothing may pass above `y` between x0 and x1 (the crown is above it). */
export interface Branch {
  x0: number;
  x1: number;
  y: number;
  trunkX: number;
  seed: number;
}

/** A willy-willy: a dust devil that lifts anything flying through it. */
export interface Devil {
  x: number;
  w: number;
  seed: number;
}

export interface Flower {
  x: number;
  y: number;
  taken: boolean;
  seed: number;
  /** Seconds since it was taken (for the burst). */
  gone: number;
}

export type HopKind = "perfect" | "early" | "late" | "stiff";

export type SimEvent =
  | { k: "land"; x: number; y: number; surface: Surface; speed: number; loaded: boolean }
  | { k: "hop"; kind: HopKind; power: number; flow: number; surface: Surface }
  | { k: "flower"; x: number; y: number; chain: number }
  | { k: "devil"; x: number }
  | { k: "near"; x: number; y: number }
  | { k: "crash"; how: ObstacleKind | "branch" | "wall" }
  | { k: "fall" };

/** The body's state for one step of physics (the world's own and the pilot's look-ahead share it). */
export interface Body {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface WorldOptions {
  seed: number;
  /** Attract demo: gentle, fixed difficulty. */
  demo?: boolean;
}

/** 0..1 difficulty from meters: a gentle first stretch, then a ramp to full by ~1200 m. */
export function difficulty(m: number): number {
  return clamp((m - 40) / 1160) ** 1.1;
}

/** Top speed at a difficulty. */
export function vxCap(d: number): number {
  return lerp(400, 500, d);
}

/** Height of an obstacle's top above its base at offset dx from its center (0 outside). */
export function obstacleTop(o: Obstacle, dx: number): number {
  const u = Math.abs(dx) / o.w;
  if (u >= 1) return 0;
  switch (o.kind) {
    case "mound":
      // A lumpy cone, steep near the top.
      return o.h * (1 - u ** 1.35) * (0.94 + 0.06 * Math.cos(dx * 0.6 + o.seed * 9));
    case "rock":
      return o.h * Math.sqrt(1 - u * u);
    case "log":
      return u < 0.86 ? o.h : o.h * Math.sqrt(Math.max(0, 1 - ((u - 0.86) / 0.14) ** 2));
  }
}

/** Sample points of the body (relative to the feet), flying and in a squat (`squat` 0..1). */
const BODY_PTS: Array<[number, number]> = [];
for (let i = 0; i < 8; i++) {
  const a = (i / 8) * Math.PI * 2;
  BODY_PTS.push([3 + Math.cos(a) * 12, -30 + Math.sin(a) * 11]);
}
for (let i = 0; i < 5; i++) {
  const a = (i / 5) * Math.PI * 2;
  BODY_PTS.push([19 + Math.cos(a) * 6.5, -46 + Math.sin(a) * 5.5]);
}
// Ear tips, snout, feet.
BODY_PTS.push([12, -58], [26, -45], [4, -3], [12, -3]);

export class World {
  readonly demo: boolean;
  readonly rng: Rng;
  time = 0;
  x = 0;
  y = 0;
  vx = 0;
  vy = 0;
  phase: "stand" | "air" | "stance" | "dead" = "stand";
  /** Stance: when it began, where the feet are, whether the legs are loaded, the surface. */
  stanceT = 0;
  footX = 0;
  footY = 0;
  loaded = false;
  surface: Surface = "earth";
  /** 0..1 squat depth (drawing). */
  squat = 0;
  /** Seconds since the last takeoff. */
  airT = 0;
  lastHop: HopKind = "early";
  lastPower = 0;
  holding = false;
  /** When the current press began (sim time), for the grace window. */
  pressT = -9;
  flow = 0;
  bonus = 0;
  maxX = 0;
  hops = 0;
  perfects = 0;
  flowersTaken = 0;
  flowerChain = 0;
  deadT = 0;
  deathHow: ObstacleKind | "branch" | "wall" | "gully" | null = null;
  nearCool = 0;
  inDevil = false;
  gullies: Gully[] = [];
  patches: Patch[] = [];
  obstacles: Obstacle[] = [];
  branches: Branch[] = [];
  devils: Devil[] = [];
  flowers: Flower[] = [];
  events: SimEvent[] = [];
  private genX = 0;
  private acc = 0;

  constructor(opts: WorldOptions) {
    this.demo = !!opts.demo;
    this.rng = createRng(opts.seed);
    this.genX = this.demo ? 380 : 700;
    this.generate(this.x + 2600);
    this.y = this.groundY(0);
    this.footX = 0;
    this.footY = this.y;
  }

  get meters(): number {
    return Math.max(0, Math.floor(this.maxX / WU_PER_M)) + this.bonus;
  }

  get distanceM(): number {
    return Math.max(0, this.maxX / WU_PER_M);
  }

  get alive(): boolean {
    return this.phase !== "dead";
  }

  diffAt(x: number): number {
    return this.demo ? 0.16 : difficulty(x / WU_PER_M);
  }

  /** Seconds from touchdown to the bottom of the squat on this surface. */
  static bottom(s: Surface): number {
    return s === "sand" ? T_BOTTOM * 1.3 : s === "salt" ? T_BOTTOM * 0.82 : T_BOTTOM;
  }

  // ---------------------------------------------------------------------------------------------
  // Terrain queries
  // ---------------------------------------------------------------------------------------------

  /** The plain's gentle roll (no gullies). */
  baseY(x: number): number {
    return Math.sin(x * 0.0037 + 1.3) * 7 + Math.sin(x * 0.0113 + 0.4) * 3;
  }

  gullyAt(x: number): Gully | null {
    for (const g of this.gullies) if (x > g.x0 && x < g.x1) return g;
    return null;
  }

  groundY(x: number): number {
    return this.gullyAt(x) ? NO_GROUND : this.baseY(x);
  }

  surfaceAt(x: number): Surface {
    for (const p of this.patches) if (x >= p.x0 && x <= p.x1) return p.kind;
    return "earth";
  }

  /** What, if anything, is solid at (px, py) (ground excluded). */
  solidAt(px: number, py: number): ObstacleKind | "branch" | null {
    for (const o of this.obstacles) {
      const dx = px - o.x;
      if (dx <= -o.w || dx >= o.w) continue;
      if (py > o.base - obstacleTop(o, dx) && py < o.base + 4) return o.kind;
    }
    for (const b of this.branches) if (px > b.x0 && px < b.x1 && py < b.y) return "branch";
    return null;
  }

  /** Is the body (feet at x, y, squatting by `squat`) touching an obstacle or branch? */
  hit(x: number, y: number, squat: number): ObstacleKind | "branch" | null {
    let near = false;
    for (const o of this.obstacles) if (o.x + o.w > x - 16 && o.x - o.w < x + 34) near = true;
    for (const b of this.branches) if (b.x1 > x - 16 && b.x0 < x + 34) near = true;
    if (!near) return null;
    for (const [dx, dy] of BODY_PTS) {
      const s = dy < -10 ? squat * 13 : 0;
      const r = this.solidAt(x + dx, y + dy + s);
      if (r) return r;
    }
    return null;
  }

  /** Room between the body and the nearest obstacle or branch (rough; for near-miss slow motion). */
  clearance(x: number, y: number): number {
    let c = 99;
    for (const o of this.obstacles) {
      if (Math.abs(o.x - x) > o.w + 40) continue;
      for (const [dx, dy] of BODY_PTS) {
        const px = x + dx;
        const ox = px - o.x;
        if (Math.abs(ox) >= o.w) continue;
        c = Math.min(c, o.base - obstacleTop(o, ox) - (y + dy));
      }
    }
    for (const b of this.branches) {
      if (x + 30 < b.x0 || x - 10 > b.x1) continue;
      c = Math.min(c, y - 58 - b.y);
    }
    return c;
  }

  devilAt(x: number): Devil | null {
    for (const d of this.devils) if (Math.abs(x - d.x) < d.w) return d;
    return null;
  }

  // ---------------------------------------------------------------------------------------------
  // Generation
  // ---------------------------------------------------------------------------------------------

  private flowerRun(x0: number, x1: number, d: number): void {
    const r = this.rng;
    if (x1 - x0 < 90 || !r.chance(this.demo ? 0.4 : lerp(0.55, 0.38, d))) return;
    const x = r.range(x0 + 40, x1 - 40);
    if (this.gullyAt(x)) return;
    this.flowers.push({ x, y: this.baseY(x), taken: false, seed: r(), gone: 0 });
  }

  private addGully(x: number, d: number): number {
    const r = this.rng;
    const w = this.demo ? r.range(70, 120) : lerp(70, 190, d) * r.range(0.72, 1.04);
    this.gullies.push({ x0: x, x1: x + w, seed: r() });
    return x + w;
  }

  private addObstacle(kind: ObstacleKind, x: number, d: number): number {
    const r = this.rng;
    let w: number;
    let h: number;
    if (kind === "mound") {
      h = this.demo ? r.range(46, 64) : lerp(48, 102, d) * r.range(0.85, 1.05);
      w = r.range(15, 21);
    } else if (kind === "rock") {
      h = r.range(28, lerp(46, 64, d));
      w = h * r.range(0.75, 1.05);
    } else {
      h = r.range(20, 28);
      w = r.range(30, lerp(46, 70, d));
    }
    const cx = x + w;
    this.obstacles.push({ kind, x: cx, w, h, base: this.baseY(cx), seed: r() });
    return x + w * 2;
  }

  private addBranch(x: number, d: number): number {
    const r = this.rng;
    const span = r.range(lerp(80, 130, d), lerp(130, 230, d));
    const clear = this.demo ? 124 : lerp(126, 104, d) * r.range(0.97, 1.03);
    const y = Math.min(this.baseY(x), this.baseY(x + span)) - clear;
    this.branches.push({ x0: x, x1: x + span, y, trunkX: x + span + r.range(-20, 30), seed: r() });
    return x + span;
  }

  private generate(until: number): void {
    const r = this.rng;
    while (this.genX < until) {
      const d = this.diffAt(this.genX);
      const minGap = lerp(220, 200, d);
      const gap = minGap + r.range(0, lerp(300, 150, d));
      const x0 = this.genX;
      const x = x0 + gap;
      this.flowerRun(x0, x, d);
      if (this.demo) {
        const roll = r();
        // No trees in the demo: their trunks would run through the title.
        this.genX = roll < 0.45 ? this.addGully(x, d) : this.addObstacle(roll < 0.75 ? "mound" : roll < 0.9 ? "rock" : "log", x, d);
        continue;
      }
      // Weighted pick of the next feature; later on, pairs that ask for two different hops in a row.
      const w = {
        gully: 1,
        mound: 0.75,
        rock: 0.7,
        log: d > 0.08 ? 0.5 : 0,
        branch: d > 0.04 ? 0.7 : 0,
        sand: d > 0.15 ? 0.35 : 0,
        salt: d > 0.1 ? 0.3 : 0,
        devil: d > 0.32 ? 0.22 : 0,
        pair: d > 0.22 ? lerp(0.2, 0.9, (d - 0.22) / 0.78) : 0,
      };
      let total = 0;
      for (const v of Object.values(w)) total += v;
      let pick = r() * total;
      let kind: keyof typeof w = "gully";
      for (const [k, v] of Object.entries(w) as Array<[keyof typeof w, number]>) {
        pick -= v;
        if (pick <= 0) {
          kind = k;
          break;
        }
      }
      switch (kind) {
        case "gully":
          this.genX = this.addGully(x, d);
          break;
        case "mound":
        case "rock":
        case "log":
          this.genX = this.addObstacle(kind, x, d);
          break;
        case "branch":
          this.genX = this.addBranch(x, d);
          break;
        case "sand":
        case "salt": {
          const len = kind === "sand" ? r.range(110, 220) : r.range(150, 300);
          this.patches.push({ x0: x, x1: x + len, kind, seed: r() });
          // Something to hop over right after a patch, so the patch matters.
          const after = x + len + r.range(10, 60);
          this.genX = kind === "salt" ? this.addObstacle("mound", after, Math.min(1, d + 0.15)) : this.addGully(after, d * 0.8);
          break;
        }
        case "devil": {
          // A dust devil over a wide gully: fly through it and it carries you over.
          const gx = x + r.range(80, 140);
          const end = this.addGully(gx, Math.min(1, d + 0.25));
          this.devils.push({ x: gx + r.range(10, 50), w: r.range(30, 40), seed: r() });
          this.genX = end;
          break;
        }
        case "pair": {
          const roll = r();
          if (roll < 0.35) {
            // Duck under a branch, then a gully: small bounces, then a big one.
            const b = this.addBranch(x, d * 0.85);
            this.genX = this.addGully(b + r.range(lerp(200, 170, d), 240), d * 0.85);
          } else if (roll < 0.65) {
            // A gully with a mound waiting on the far side.
            const g = this.addGully(x, d * 0.8);
            this.genX = this.addObstacle("mound", g + r.range(lerp(150, 120, d), 190), d * 0.85);
          } else {
            // Two obstacles a short hop apart.
            const a = this.addObstacle(r.chance(0.5) ? "rock" : "log", x, d * 0.9);
            this.genX = this.addObstacle(r.chance(0.5) ? "mound" : "rock", a + r.range(lerp(170, 140, d), 210), d * 0.85);
          }
          break;
        }
      }
    }
  }

  /** Drops what is far behind the kangaroo. */
  private prune(): void {
    const behind = this.x - 900;
    const keep = <T extends { x1?: number; x?: number }>(list: T[], end: (t: T) => number) => {
      while (list.length && end(list[0]!) < behind) list.shift();
    };
    keep(this.gullies, (g) => g.x1);
    keep(this.patches, (p) => p.x1);
    keep(this.obstacles, (o) => o.x + o.w);
    keep(this.branches, (b) => b.x1);
    keep(this.devils, (v) => v.x + v.w);
    keep(this.flowers, (f) => f.x);
  }

  // ---------------------------------------------------------------------------------------------
  // The hop
  // ---------------------------------------------------------------------------------------------

  /** Power, speed and kind of a hop released `t` seconds into a stance (t < 0: a stiff bounce). */
  launchFor(t: number, surface: Surface, vx: number, flow: number, d: number): { power: number; vx: number; kind: HopKind; flow: number } {
    const tb = World.bottom(surface);
    let power: number;
    let kind: HopKind;
    let nvx = vx;
    let nflow = flow;
    if (t < 0) {
      kind = "stiff";
      power = P_STIFF;
      nvx *= 0.965;
      nflow = Math.max(0, flow - 1);
    } else if (Math.abs(t - tb) <= PERFECT) {
      kind = "perfect";
      power = 1;
      nflow = Math.min(flow + 1, 12);
      nvx = nvx * (1.045 + Math.min(nflow, 6) * 0.004) + 6;
    } else if (t < tb) {
      kind = "early";
      power = 0.16 + 0.74 * clamp(t / tb) ** 1.25;
    } else {
      kind = "late";
      const over = t - tb - PERFECT;
      power = Math.max(0.24, 0.9 * Math.exp(-over / 0.38));
      nflow = Math.max(0, flow - 2);
    }
    if (kind !== "stiff") {
      if (surface === "sand") {
        power *= 0.7;
        nvx *= 0.95;
      } else if (surface === "salt") power = Math.min(1.25, power * 1.16);
    }
    nvx = clamp(nvx, VX_MIN, vxCap(d));
    return { power, vx: nvx, kind, flow: nflow };
  }

  /** Horizontal speed factor of the body over its feet during a loaded stance (it brakes after the bottom). */
  static stanceSpeed(t: number, tb: number): number {
    return t <= tb + PERFECT ? 0.5 : 0.5 * Math.exp(-(t - tb - PERFECT) * 3.2);
  }

  /** Vertical launch speed for a hop of `power`. */
  static launchVy(power: number): number {
    return -Math.sqrt(2 * G * (H_MIN + (H_MAX - H_MIN) * power));
  }

  /** Speed bleed while holding past the bottom (per second). */
  static readonly LATE_BLEED = 1.2;

  /**
   * One step of flight. Returns what happened: nothing, a landing (feet on firm ground), a crash, or a fall.
   * Shared by the world and the pilot's look-ahead so both see the same physics.
   */
  flyStep(b: Body, h: number): "air" | "land" | "fall" | ObstacleKind | "branch" | "wall" {
    const dv = this.devilAt(b.x);
    const g = dv ? G * 0.2 : G;
    b.vy += g * h;
    if (dv && b.vy > -260) b.vy -= 900 * h;
    const px = b.x;
    const py = b.y;
    b.x += b.vx * h;
    b.y += b.vy * h;
    const gy = this.groundY(b.x);
    if (b.y >= gy && b.vy > 0) {
      // Came down from above onto the plain, or into a gully's far wall.
      if (py <= this.groundY(b.x) + 4 || !this.gullyAt(px)) {
        b.y = gy;
        return "land";
      }
      return "wall";
    }
    if (this.gullyAt(b.x) && b.y > this.baseY(b.x) + FALL_Y) return "fall";
    const hit = this.hit(b.x, b.y, 0);
    if (hit) return hit;
    return "air";
  }

  // ---------------------------------------------------------------------------------------------
  // Simulation
  // ---------------------------------------------------------------------------------------------

  /** The first hop of a run, off the starting rise. */
  launch(): void {
    this.phase = "air";
    this.vx = VX0;
    this.vy = World.launchVy(0.45);
    this.airT = 0;
  }

  setHold(h: boolean): void {
    if (h && !this.holding) this.pressT = this.time;
    this.holding = h;
  }

  update(dt: number): void {
    this.acc += Math.min(dt, 0.1);
    while (this.acc >= STEP) {
      this.acc -= STEP;
      this.step(STEP);
    }
  }

  private step(h: number): void {
    this.time += h;
    this.nearCool = Math.max(0, this.nearCool - h);
    for (const f of this.flowers) if (f.taken) f.gone += h;
    this.generate(this.x + 2600);
    if (this.time % 1 < h) this.prune();

    if (this.phase === "stand") return;
    if (this.phase === "dead") {
      this.deadT += h;
      this.vy += G * h;
      this.vx *= Math.exp(-2.2 * h);
      this.x += this.vx * h;
      this.y += this.vy * h;
      const gy = this.groundY(this.x);
      if (this.deathHow !== "gully" && this.deathHow !== "wall" && this.y > gy) {
        this.y = gy;
        this.vy = -Math.abs(this.vy) * 0.25;
        this.vx *= 0.6;
      }
      this.y = Math.min(this.y, 600);
      return;
    }

    if (this.phase === "air") {
      this.airT += h;
      const b: Body = { x: this.x, y: this.y, vx: this.vx, vy: this.vy };
      const wasIn = this.inDevil;
      const r = this.flyStep(b, h);
      this.x = b.x;
      this.y = b.y;
      this.vx = b.vx;
      this.vy = b.vy;
      this.inDevil = !!this.devilAt(this.x);
      if (this.inDevil && !wasIn) this.events.push({ k: "devil", x: this.x });
      this.squat = Math.max(0, this.squat - h * 6);
      if (r === "land") this.touchDown();
      else if (r === "fall") this.die("gully");
      else if (r !== "air") this.die(r);
      else this.nearCheck();
    } else if (this.phase === "stance") {
      this.stanceStep(h);
    }
    if (this.x > this.maxX) this.maxX = this.x;
  }

  private nearCheck(): void {
    if (this.nearCool > 0 || this.airT < 0.1) return;
    const c = this.clearance(this.x, this.y);
    if (c < 9) {
      this.nearCool = 1.6;
      this.events.push({ k: "near", x: this.x, y: this.y });
    }
  }

  private touchDown(): void {
    this.phase = "stance";
    this.stanceT = 0;
    this.footX = this.x;
    this.footY = this.y;
    this.surface = this.surfaceAt(this.x);
    // Holding as you land, or pressing within the grace window, loads the legs.
    this.loaded = this.holding;
    this.events.push({ k: "land", x: this.x, y: this.y, surface: this.surface, speed: this.vy, loaded: this.loaded });
    this.vy = 0;
    for (const f of this.flowers) {
      if (f.taken || Math.abs(f.x - this.x) > 20) continue;
      f.taken = true;
      this.flowersTaken++;
      this.flowerChain++;
      if (!this.demo) this.bonus += FLOWER_BONUS;
      this.events.push({ k: "flower", x: f.x, y: f.y, chain: this.flowerChain });
    }
  }

  private stanceStep(h: number): void {
    this.stanceT += h;
    const t = this.stanceT;
    const tb = World.bottom(this.surface);
    if (!this.loaded && this.holding && t <= GRACE) this.loaded = true;
    if (!this.loaded) {
      this.squat = Math.min(0.35, this.squat + h * 6);
      this.x += this.vx * 0.6 * h;
      if (t >= T_STIFF) this.takeOff(-1);
    } else {
      this.squat = Math.sin((Math.PI / 2) * Math.min(1, t / tb));
      this.x += this.vx * World.stanceSpeed(t, tb) * h;
      if (t > tb + PERFECT) this.vx = Math.max(VX_MIN * 0.5, this.vx * Math.exp(-World.LATE_BLEED * h));
      if (!this.holding || t >= MAX_HOLD) this.takeOff(t);
    }
    if (this.phase !== "stance") return;
    const hit = this.hit(this.x, this.footY, this.squat);
    if (hit) this.die(hit);
  }

  private takeOff(t: number): void {
    const d = this.diffAt(this.x);
    const l = this.launchFor(t, this.surface, this.vx, this.flow, d);
    this.vx = l.vx;
    this.flow = l.flow;
    this.vy = World.launchVy(l.power);
    this.y = this.footY;
    this.phase = "air";
    this.airT = 0;
    this.hops++;
    this.lastHop = l.kind;
    this.lastPower = l.power;
    if (l.kind === "perfect") this.perfects++;
    if (l.kind !== "perfect") this.flowerChain = 0;
    this.events.push({ k: "hop", kind: l.kind, power: l.power, flow: this.flow, surface: this.surface });
  }

  private die(how: ObstacleKind | "branch" | "wall" | "gully"): void {
    if (this.phase === "dead") return;
    this.phase = "dead";
    this.deathHow = how;
    this.deadT = 0;
    if (how === "gully" || how === "wall") {
      this.vx *= how === "wall" ? -0.1 : 0.4;
      this.events.push({ k: "fall" });
    } else {
      this.vx *= -0.3;
      this.vy = -Math.abs(this.vy) * 0.3 - 220;
      this.events.push({ k: "crash", how });
    }
  }

  drain(): SimEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }
}

// -----------------------------------------------------------------------------------------------
// The pilot: plays the attract demo and the headless playtests.
// -----------------------------------------------------------------------------------------------

/** A release time into the next stance (seconds; -1 = a stiff bounce, no hold). */
export type Choice = number;

export interface Outcome {
  ok: boolean;
  body: Body;
  surface: Surface;
  flow: number;
  kind: HopKind;
  /** Room on firm ground around the landing point before the next hazard edge. */
  margin: number;
  flower: boolean;
  t: number;
}

/** Release options the pilot considers: a stiff bounce, early ones clear of the perfect window, perfect, late ones. */
function choicesFor(s: Surface): Choice[] {
  const tb = World.bottom(s);
  const e = tb - PERFECT;
  return [-1, e * 0.3, e * 0.45, e * 0.6, e * 0.75, tb, tb + PERFECT + 0.06, tb + PERFECT + 0.14, tb + PERFECT + 0.25, tb + PERFECT + 0.42];
}

/** Simulates a stance from landing state `b` released at `c`, then the hop that follows, until it ends. */
export function project(w: World, b: Body, surface: Surface, flow: number, c: Choice): Outcome {
  const tb = World.bottom(surface);
  const d = w.diffAt(b.x);
  // Stance.
  const s: Body = { x: b.x, y: b.y, vx: b.vx, vy: 0 };
  const h = STEP;
  const fail = (t: number): Outcome => ({ ok: false, body: s, surface, flow, kind: "stiff", margin: 0, flower: false, t });
  if (c < 0) {
    for (let t = 0; t < T_STIFF; t += h) {
      s.x += s.vx * 0.6 * h;
      if (w.hit(s.x, b.y, 0.3)) return fail(t);
    }
  } else {
    for (let t = 0; t < c; t += h) {
      s.x += s.vx * World.stanceSpeed(t, tb) * h;
      if (t > tb + PERFECT) s.vx = Math.max(VX_MIN * 0.5, s.vx * Math.exp(-World.LATE_BLEED * h));
      if (w.hit(s.x, b.y, Math.sin((Math.PI / 2) * Math.min(1, t / tb)))) return fail(t);
    }
  }
  const l = w.launchFor(c, surface, s.vx, flow, d);
  s.vx = l.vx;
  s.vy = World.launchVy(l.power);
  s.y = b.y;
  for (let t = 0; t < 3; t += h) {
    const r = w.flyStep(s, h);
    if (r === "air") continue;
    if (r !== "land") return fail(t);
    const ls = w.surfaceAt(s.x);
    let margin = 99;
    for (const g of w.gullies) {
      if (g.x1 < s.x - 60 || g.x0 > s.x + 120) continue;
      margin = Math.min(margin, s.x < g.x0 ? g.x0 - s.x : s.x - g.x1);
    }
    for (const o of w.obstacles) {
      if (o.x + o.w < s.x - 40 || o.x - o.w > s.x + 120) continue;
      margin = Math.min(margin, Math.abs(o.x - s.x) - o.w);
    }
    const flower = w.flowers.some((f) => !f.taken && Math.abs(f.x - s.x) < 18);
    return { ok: true, body: s, surface: ls, flow: l.flow, kind: l.kind, margin, flower, t };
  }
  return fail(3);
}

/** Can anything follow a landing at `o`? Returns the best follow-up's score, or -Infinity. */
function followUp(w: World, o: Outcome): number {
  let next = -Infinity;
  for (const c2 of choicesFor(o.surface)) {
    const o2 = project(w, o.body, o.surface, o.flow, c2);
    if (!o2.ok) continue;
    next = Math.max(next, 100 + (o2.kind === "perfect" ? 8 : 0) + Math.min(o2.margin, 50) * 0.3);
  }
  return next;
}

/**
 * Picks the release for a landing at `b`: a depth-two search for a hop that keeps the next one possible too.
 * Each release is also tried `slack` seconds earlier and later; the pilot prefers releases that survive all three
 * (two hops deep), and falls back to the most forgiving one when nothing is safe either way.
 */
export function plan(w: World, b: Body, surface: Surface, flow: number, slack = 0.02): Choice {
  let best: Choice = -1;
  let bestScore = -Infinity;
  for (const c of choicesFor(surface)) {
    const o = project(w, b, surface, flow, c);
    if (!o.ok) continue;
    const next = followUp(w, o);
    if (next === -Infinity) continue;
    let robust = 2;
    if (c >= 0) {
      for (const v of [Math.max(0.004, c - slack), c + slack]) {
        const ov = project(w, b, surface, flow, v);
        if (!ov.ok || followUp(w, ov) === -Infinity) robust--;
      }
    }
    const score = robust * 1000 + next + (o.kind === "perfect" ? 24 : 0) + (o.flower ? 14 : 0) + Math.min(o.margin, 60) * 0.5 + (o.surface === "sand" ? -10 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}

export interface Pilot {
  hold: boolean;
  /** Planned release for the coming stance (-1 = stiff), or null before the plan is made. */
  choice: Choice | null;
  /** Timing error (s) added to this stance's release. */
  jitter: number;
  /** Sim time of the takeoff the plan was made for. */
  planFor: number;
}

export function newPilot(): Pilot {
  return { hold: false, choice: null, jitter: 0, planFor: -1 };
}

/**
 * One frame of the pilot's decision. `noise` = standard deviation of the release timing (s), `rng` for it.
 * Returns whether to hold now.
 */
export function pilot(w: World, p: Pilot, noise = 0, rng: () => number = Math.random): boolean {
  if (!w.alive || w.phase === "stand") return (p.hold = false);
  if (w.phase === "air") {
    // Plan once per hop, from the predicted landing.
    if (p.planFor !== w.hops) {
      p.planFor = w.hops;
      const b: Body = { x: w.x, y: w.y, vx: w.vx, vy: w.vy };
      let landed = false;
      for (let t = 0; t < 3; t += STEP) {
        const r = w.flyStep(b, STEP);
        if (r === "air") continue;
        landed = r === "land";
        break;
      }
      p.choice = landed ? plan(w, b, w.surfaceAt(b.x), w.flow, Math.max(0.02, noise * 1.3)) : -1;
      p.jitter = noise > 0 ? gauss(rng) * noise : 0;
    }
    // Press a moment before touchdown when the plan loads the legs; stay off for a stiff bounce.
    const toGround = (w.groundY(w.x + w.vx * 0.05) - w.y) / Math.max(1, w.vy);
    p.hold = p.choice !== null && p.choice >= 0 && w.vy > 0 && toGround < 0.12;
    return p.hold;
  }
  // Stance.
  if (p.choice === null || p.choice < 0) return (p.hold = false);
  // The release lands on the next sim step, so let go half a step early.
  p.hold = w.stanceT + STEP * 0.5 < p.choice + p.jitter;
  return p.hold;
}

function gauss(rng: () => number): number {
  const u = Math.max(1e-9, rng());
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
