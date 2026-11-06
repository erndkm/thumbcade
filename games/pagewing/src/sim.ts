/**
 * Pagewing's world and flight. Pure: no DOM, no canvas, so it runs headless for playtests.
 *
 * World units (wu): x grows to the right, y grows downward, the doodled ground sits near y = 0.
 * A flight starts at x = 0, thrown from the margin. Score = meters flown (WU_PER_M wu each) + bonuses.
 *
 * The plane is a real glider: lift ~ v² · c(angle of attack) at right angles to the airflow, drag along it,
 * gravity down. Holding pulls the nose up; letting go lets it find its glide again. Climbing bleeds speed, too
 * slow with the nose up stalls, and enough speed with the nose held carries it over the top into a loop.
 * Velocity is airspeed and the air carries the plane: warm air rising off the doodles lifts it (far more when
 * the wing is held nose-up inside it), the ring around each column and the rain under storms push it down,
 * and gusts shove it forward. Energy leaks away between columns, and the columns keep getting further apart.
 */
import { clamp, lerp } from "@thumbcade-games/kit/ease";
import { createRng, type Rng } from "@thumbcade-games/kit/rng";

export const WU_PER_M = 30;
/** A page break every this many meters. */
export const PAGE_M = 100;
export const G = 520;
/** Trim speed: the steady glide with the nose relaxed. */
export const VT = 240;
export const MAX_SPEED = VT * 3.2;
export const STEP = 1 / 120;
/** Lift coefficient relative to trim: relaxed, and with the nose held up. */
export const C_TRIM = 1;
export const C_HOLD = 2.7;
/** Angle of attack at trim (rad) and where the wing stalls. */
export const ALPHA_T = 0.07;
export const ALPHA_STALL = ALPHA_T * 3.7;
const CD0 = 0.12;
const KI = 0.036;
/** How fast the nose settles on the commanded angle of attack at trim speed (1/s). */
const PITCH_RATE = 9;
/** The relaxed glide: the path angle it settles on (rad, negative = down) and how firmly it returns to it. */
const GLIDE_ANGLE = -0.16;
const GLIDE_K = 2.2;
/** How much steeper (rad) the relaxed glide dives when the plane is slow. */
const SWOOP = 0.75;
/** Below this dynamic pressure (relative to trim) the nose stops following the flight path. */
const FOLLOW_Q = 0.5;
/** Half-length of the plane (collision points at nose and tail). */
export const HALF = 15;
export const STAR_BONUS = 5;
export const HOOP_BONUS = 10;
export const LOOP_BONUS = 15;
/** Seconds of riding before a column's warm air is spent. */
export const HEAT_TIME = 4.6;
/** No kites before this x: the first stretch teaches warm air, then wires and birds, then kites. */
const KITES_FROM = 2700;
/** A gust pushes the plane forward at GUST_PUSH wu/s² up to GUST_SPEED. */
const GUST_PUSH = 900;
const GUST_SPEED = VT * 1.7;
/** Turning (rad) after which a held pull counts as going over the top (see flyStep). */
const LOOP_ASSIST = Math.PI * 0.42;
/** How many wu the gap between warm air grows per meter flown. */
const GAP_GROWTH = 1.0;
/** A loop only pays if the plane made this much headway since the last one that paid. */
const LOOP_HEADWAY = 160;
/** Hazards are placed against a reference glide out of each column: leave it this far under its top… */
const EXIT_DROP = 240;
/** …and glide at 1 : GLIDE. */
const GLIDE = 6;
/** How far under a storm cloud its rain pulls the air down. */
export const SINK_DEPTH = 170;
/** The sinking ring around each column: its width (wu) and strength relative to the column's core. */
export const EDGE_W = 34;
const EDGE_SINK = 0.55;
/** How much of the warm air's lift a stalled plane still gets. */
const STALL_CARRY = 0.3;
/** How much more lift warm air gives a wing held fully nose-up than a relaxed one. */
const CATCH = 1.05;
const TS = 4;
const CHUNK = 256;
const NO_GROUND = 2000;

export type ColumnKind = "chimney" | "mug" | "campfire" | "kettle" | "volcano";

/** Warm air rising off a doodle. */
export interface Column {
  id: number;
  kind: ColumnKind;
  x: number;
  /** Half width. */
  w: number;
  /** Where the source sits and how high the air keeps rising (y, so smaller = higher). */
  base: number;
  top: number;
  /** How fast the air rises at the core (wu/s). */
  s: number;
  /** 1 = fresh; it cools while the plane rides it, so nobody circles one forever. */
  heat: number;
  seed: number;
}

/** A scribbled storm cloud: the air under it sinks. */
export interface Storm {
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
  /** How fast the rain pulls the air down (wu/s). */
  s: number;
  seed: number;
}

/** A power line between two poles, sagging. */
export interface Wire {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  sag: number;
  seed: number;
}

export interface Kite {
  /** The kid holding the string. */
  ax: number;
  ay: number;
  /** Kite rest position; it bobs around it. */
  kx: number;
  ky: number;
  ph: number;
  seed: number;
}

export interface Bird {
  x0: number;
  y0: number;
  vx: number;
  amp: number;
  ph: number;
  seed: number;
}

export type PropKind = "house" | "tree" | "pine" | "pole" | "kid" | "flower" | "rock" | "fence" | "cat" | "mug" | "campfire" | "kettle" | "volcano" | "pond";

/** Things standing on the ground (drawn by main; the solid ones are raised into the height map). */
export interface Prop {
  kind: PropKind;
  x: number;
  /** Ground y at x. */
  y: number;
  w: number;
  h: number;
  seed: number;
  /** House: chimney offset (x from center), if it smokes. */
  chimney?: number;
}

export interface Star {
  x: number;
  y: number;
  ph: number;
  taken: boolean;
  gone: number;
}

export interface Hoop {
  x: number;
  y: number;
  r: number;
  seed: number;
  taken: boolean;
  /** Seconds since passed (for the check mark). */
  gone: number;
}

/** A gust of wind: doodled whoosh lines that shove the plane forward (the speed a loop needs). */
export interface Gust {
  x0: number;
  x1: number;
  /** Centre line and thickness. */
  y: number;
  h: number;
  seed: number;
}

export type Crash = "ground" | "tree" | "house" | "wire" | "kite" | "bird" | "water";

export type SimEvent =
  | { k: "star"; x: number; y: number; chain: number }
  | { k: "hoop"; x: number; y: number }
  | { k: "loop"; x: number; y: number; count: number; hoop: boolean; pays: boolean }
  | { k: "stall"; x: number; y: number }
  | { k: "lift"; column: Column }
  | { k: "gust"; gust: Gust }
  | { k: "near"; x: number; y: number }
  | { k: "page"; page: number }
  | { k: "crash"; how: Crash; soft: boolean };

/** The flying body: everything the pilot's look-ahead needs to copy. */
export interface Body {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Nose angle above the horizon (rad, counter-clockwise on screen). */
  pitch: number;
  /** Seconds the nose has been held. */
  held: number;
  /** Seconds since the hold ended. */
  free: number;
  stalled: boolean;
  /** Positive turning since the hold began (rad), for loops. */
  turn: number;
}

export function newBody(x: number, y: number, v: number, angle: number): Body {
  return { x, y, vx: Math.cos(angle) * v, vy: -Math.sin(angle) * v, pitch: angle + ALPHA_T, held: 0, free: 9, stalled: false, turn: 0 };
}

export function copyBody(b: Body, out: Body): Body {
  out.x = b.x;
  out.y = b.y;
  out.vx = b.vx;
  out.vy = b.vy;
  out.pitch = b.pitch;
  out.held = b.held;
  out.free = b.free;
  out.stalled = b.stalled;
  out.turn = b.turn;
  return out;
}

const wrap = (a: number) => {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
};

/** Flight-path angle (rad above the horizon). */
export const pathAngle = (b: Body) => Math.atan2(-b.vy, b.vx);
export const speedOf = (b: Body) => Math.hypot(b.vx, b.vy);

/** Lift coefficient (relative to trim) at angle of attack `a`; it falls away past the stall. */
export function liftC(a: number): number {
  const s = Math.abs(a);
  if (s <= ALPHA_STALL) return a / ALPHA_T;
  const peak = ALPHA_STALL / ALPHA_T;
  return Math.sign(a) * peak * Math.max(0.22, 1 - (s - ALPHA_STALL) / 0.35);
}

/** 0..1 difficulty from meters. Ramps over the first ~650 m. */
export function difficulty(m: number): number {
  return clamp(m / 650) ** 0.9;
}

/** 0..1: the long tail after that, for the few who get there (wider gaps, weaker air). */
export function overtime(m: number): number {
  return clamp((m - 650) / 1100);
}

export interface WorldOptions {
  seed: number;
  /** Attract demo: gentle, fixed difficulty, generous warm air. */
  demo?: boolean;
}

/** Acceleration the air puts on a body (reused, no allocation). */
const air = { wx: 0, wy: 0, up: 0, column: null as Column | null, storm: false };

export class World {
  readonly demo: boolean;
  readonly rng: Rng;
  time = 0;
  body: Body = newBody(0, -300, VT * 1.45, 0.16);
  alive = true;
  /** Seconds since the crash. */
  deadT = 0;
  crash: Crash | null = null;
  soft = false;
  holding = false;
  maxX = 0;
  bonus = 0;
  starsTaken = 0;
  starChain = 0;
  starChainT = 0;
  hoops = 0;
  loops = 0;
  stalls = 0;
  /** The column the plane is in now. */
  inColumn: Column | null = null;
  nearCool = 0;
  page = 0;
  columns: Column[] = [];
  storms: Storm[] = [];
  wires: Wire[] = [];
  kites: Kite[] = [];
  birds: Bird[] = [];
  props: Prop[] = [];
  stars: Star[] = [];
  hoopList: Hoop[] = [];
  gusts: Gust[] = [];
  /** The gust the plane is in now. */
  inGust: Gust | null = null;
  /** Flags the ground as water between [x0, x1] (ponds). */
  ponds: Array<{ x0: number; x1: number }> = [];
  events: SimEvent[] = [];
  private chunks = new Map<number, Float32Array>();
  private solid = new Map<number, Float32Array>();
  private genX = 0;
  private terrainX = 0;
  private nextId = 0;
  private acc = 0;
  private lastHoop: Hoop | null = null;

  constructor(opts: WorldOptions) {
    this.demo = !!opts.demo;
    this.rng = createRng(opts.seed);
    this.buildStart();
    this.generate(2600);
  }

  get meters(): number {
    return Math.max(0, Math.floor(this.maxX / WU_PER_M)) + this.bonus;
  }

  get distanceM(): number {
    return Math.max(0, this.maxX / WU_PER_M);
  }

  get speed(): number {
    return speedOf(this.body);
  }

  diffAt(x: number): number {
    return this.demo ? 0.15 : difficulty(x / WU_PER_M);
  }

  // ---------------------------------------------------------------------------------------------
  // Height maps: the ground itself, and the ground plus whatever solid stands on it.
  // ---------------------------------------------------------------------------------------------

  private sampleOf(map: Map<number, Float32Array>, i: number): number {
    const c = map.get(Math.floor(i / CHUNK));
    if (!c) return NO_GROUND;
    return c[((i % CHUNK) + CHUNK) % CHUNK]!;
  }

  private write(map: Map<number, Float32Array>, i: number, y: number, min: boolean): void {
    const ci = Math.floor(i / CHUNK);
    let c = map.get(ci);
    if (!c) {
      c = new Float32Array(CHUNK).fill(NO_GROUND);
      map.set(ci, c);
    }
    const k = ((i % CHUNK) + CHUNK) % CHUNK;
    c[k] = min ? Math.min(c[k]!, y) : y;
  }

  private interp(map: Map<number, Float32Array>, x: number): number {
    const f = x / TS;
    const i = Math.floor(f);
    const a = this.sampleOf(map, i);
    const b = this.sampleOf(map, i + 1);
    return a + (b - a) * (f - i);
  }

  /** The doodled ground line at x (higher ground = smaller y). */
  groundY(x: number): number {
    return this.interp(this.chunks, x);
  }

  /** Top of anything solid at x: ground, houses, trees, poles. */
  solidY(x: number): number {
    return this.interp(this.solid, x);
  }

  /** Highest solid over [x0, x1]. */
  solidTop(x0: number, x1: number): number {
    let m = NO_GROUND;
    for (let i = Math.floor(x0 / TS); i <= Math.ceil(x1 / TS); i++) m = Math.min(m, this.sampleOf(this.solid, i));
    return m;
  }

  /** Calls fn(x, y) along the ground every `step` wu over [x0, x1] (for drawing). */
  forGround(x0: number, x1: number, step: number, fn: (x: number, y: number) => void): void {
    const s = Math.max(1, Math.round(step / TS));
    const i0 = Math.floor(x0 / TS);
    const i1 = Math.ceil(x1 / TS);
    for (let i = i0; i <= i1 + s; i += s) fn(i * TS, this.sampleOf(this.chunks, i));
  }

  private setGround(x: number, y: number): void {
    const i = Math.round(x / TS);
    this.write(this.chunks, i, y, false);
    this.write(this.solid, i, y, false);
  }

  /** Raises the solid map over a shape given as a top-profile function on [x0, x1]. */
  private raise(x0: number, x1: number, top: (x: number) => number): void {
    for (let x = Math.floor(x0 / TS) * TS; x <= x1; x += TS) this.write(this.solid, Math.round(x / TS), top(x), true);
  }

  isWater(x: number): boolean {
    for (const p of this.ponds) if (x >= p.x0 && x <= p.x1) return true;
    return false;
  }

  // ---------------------------------------------------------------------------------------------
  // Generation
  // ---------------------------------------------------------------------------------------------

  private buildStart(): void {
    // A gentle meadow under the throw, a first chimney to show what warm air does.
    this.terrainX = -900;
    this.extendTerrain(1200);
    this.genX = 120;
  }

  /** Rolling doodled hills, made of overlapping long sine waves; now and then a pond. */
  private extendTerrain(until: number): void {
    const r = this.rng;
    while (this.terrainX < until) {
      const x0 = this.terrainX;
      const len = r.range(500, 900);
      const p1 = r.range(0, 6.28);
      const p2 = r.range(0, 6.28);
      const amp = this.demo ? 26 : lerp(24, 60, this.diffAt(x0));
      const pond = x0 > 1600 && r.chance(0.16);
      const pondAt = x0 + len * r.range(0.3, 0.6);
      const pondW = r.range(90, 150);
      for (let x = x0; x < x0 + len; x += TS) {
        let y = -26 + Math.sin(x * 0.0042 + p1) * amp + Math.sin(x * 0.011 + p2) * amp * 0.35 + Math.sin(x * 0.05) * 1.2;
        // Smooth seam with the previous stretch.
        const prev = this.sampleOf(this.chunks, Math.round(x0 / TS) - 1);
        if (prev < NO_GROUND && x - x0 < 120) y = lerp(prev, y, (x - x0) / 120);
        if (pond) {
          const e = Math.abs(x - pondAt) / (pondW / 2);
          if (e < 1.4) y = lerp(Math.max(y, 6), y, clamp((e - 1) / 0.4));
        }
        this.setGround(x, y);
      }
      if (pond) this.ponds.push({ x0: pondAt - pondW / 2, x1: pondAt + pondW / 2 });
      this.terrainX = x0 + len;
    }
  }

  private generate(until: number): void {
    this.extendTerrain(until + 1400);
    const r = this.rng;
    while (this.genX < until) {
      const x0 = this.genX;
      const d = this.diffAt(x0);
      const first = this.columns.length === 0;
      // A source of warm air.
      const cx = first ? 520 : x0 + r.range(30, 120);
      const col = this.makeColumn(cx, d, first);
      // The gap to the next one: everything else lives in here.
      // Gaps keep growing with distance (no plateau): a sloppier rider runs out of height sooner, a clean one later.
      const gap = first ? 820 : this.demo ? r.range(560, 760) : 770 + (x0 / WU_PER_M) * GAP_GROWTH + r.range(-50, 90) * (0.4 + d);
      const x1 = cx + gap;
      this.fillGap(col, x1, d);
      this.genX = x1;
    }
  }

  private makeColumn(cx: number, d: number, first: boolean): Column {
    const r = this.rng;
    const gy = this.groundY(cx);
    let kind: ColumnKind;
    if (first) kind = "campfire";
    else {
      const roll = r();
      kind = roll < 0.26 ? "chimney" : roll < 0.52 ? "campfire" : roll < 0.74 ? "mug" : roll < 0.9 ? "kettle" : d > 0.35 ? "volcano" : "campfire";
      // The first few are low and friendly: no house to fly into while learning.
      if (cx < 2200 && (kind === "chimney" || kind === "volcano")) kind = r.chance(0.5) ? "campfire" : "mug";
    }
    // Flatten a pad for the source.
    const padW = kind === "volcano" ? 130 : kind === "chimney" ? 70 : 46;
    for (let x = cx - padW; x <= cx + padW; x += TS) {
      const e = Math.abs(x - cx) / padW;
      const y = this.groundY(x);
      this.setGround(x, lerp(gy, y, e * e));
    }
    let srcTop = gy;
    const seed = r.int(0, 1e6);
    switch (kind) {
      case "chimney": {
        const w = r.range(50, 62);
        const h = r.range(32, 42);
        const roof = h * 0.62;
        const chim = r.range(-0.18, 0.2) * w;
        this.props.push({ kind: "house", x: cx - chim, y: gy, w, h, seed, chimney: chim });
        const hx = cx - chim;
        this.raise(hx - w / 2 - 4, hx + w / 2 + 4, (x) => {
          const u = Math.abs(x - hx) / (w / 2 + 4);
          return gy - h - roof * (1 - u);
        });
        srcTop = gy - h - roof * (1 - Math.abs(chim) / (w / 2 + 4)) - 14;
        this.raise(cx - 5, cx + 5, () => srcTop);
        break;
      }
      case "campfire":
        this.props.push({ kind: "campfire", x: cx, y: gy, w: 30, h: 20, seed });
        srcTop = gy - 22;
        this.raise(cx - 16, cx + 16, () => gy - 14);
        break;
      case "mug": {
        const h = r.range(50, 64);
        this.props.push({ kind: "mug", x: cx, y: gy, w: h * 0.82, h, seed });
        this.raise(cx - h * 0.45, cx + h * 0.62, () => gy - h);
        srcTop = gy - h;
        break;
      }
      case "kettle": {
        this.props.push({ kind: "kettle", x: cx, y: gy, w: 52, h: 46, seed });
        this.raise(cx - 28, cx + 30, (x) => gy - 40 + Math.abs(x - cx) * 0.25);
        srcTop = gy - 46;
        break;
      }
      case "volcano": {
        const h = r.range(110, 150);
        this.props.push({ kind: "volcano", x: cx, y: gy, w: 230, h, seed });
        for (let x = cx - 120; x <= cx + 120; x += TS) {
          const u = Math.abs(x - cx) / 120;
          this.setGround(x, Math.min(this.groundY(x), gy - h * (1 - u) ** 1.4 + (u < 0.12 ? 6 : 0)));
        }
        srcTop = gy - h + 4;
        break;
      }
    }
    // Columns get thinner and shorter as the notebook goes on.
    const strong = kind === "volcano" ? 1.25 : kind === "chimney" ? 1 : kind === "kettle" ? 0.9 : kind === "mug" ? 0.95 : 1.05;
    const reach = this.demo ? 600 : lerp(640, 470, d) + r.range(-30, 40);
    const col: Column = {
      id: this.nextId++,
      kind,
      x: cx,
      w: (kind === "volcano" ? 96 : this.demo ? 84 : lerp(80, 68, d)) * (0.9 + 0.2 * r()),
      base: srcTop,
      top: Math.min(srcTop - 200, -reach * strong + gy * 0.4),
      s: (this.demo ? 300 : lerp(300, 280, d) * (1 - 0.08 * overtime(cx / WU_PER_M))) * strong,
      heat: 1,
      seed,
    };
    this.columns.push(col);
    return col;
  }

  /** Scenery, hazards and pickups between one column and the next. */
  private fillGap(col: Column, x1: number, d: number): void {
    const r = this.rng;
    const x0 = col.x + col.w + 40;
    const span = x1 - x0 - 60;
    if (span < 80) return;
    // Scenery and solid ground clutter: trees, pines, fences, flowers, rocks, a cat on a hill.
    let x = x0 + r.range(10, 60);
    const treeMax = this.demo ? 70 : lerp(70, 130, d);
    while (x < x1 - 70) {
      const gy = this.groundY(x);
      if (this.isWater(x) || this.isWater(x + 30)) {
        x += 60;
        continue;
      }
      const roll = r();
      if (roll < 0.3) {
        const h = r.range(40, treeMax);
        this.tree(x, gy, h, r.chance(0.5) ? "tree" : "pine");
        x += r.range(50, 120);
      } else if (roll < 0.42) {
        this.props.push({ kind: "fence", x, y: gy, w: r.range(50, 90), h: 16, seed: r.int(0, 1e6) });
        this.raise(x - 4, x + 90, (xx) => this.groundY(xx) - 15);
        x += r.range(100, 150);
      } else if (roll < 0.62) {
        this.props.push({ kind: "flower", x, y: gy, w: 8, h: r.range(10, 18), seed: r.int(0, 1e6) });
        x += r.range(40, 90);
      } else if (roll < 0.72) {
        this.props.push({ kind: "rock", x, y: gy, w: r.range(14, 26), h: 10, seed: r.int(0, 1e6) });
        this.raise(x - 12, x + 12, () => gy - 8);
        x += r.range(50, 100);
      } else if (roll < 0.76 && !this.props.some((p) => p.kind === "cat" && Math.abs(p.x - x) < 2000)) {
        this.props.push({ kind: "cat", x, y: gy, w: 22, h: 20, seed: r.int(0, 1e6) });
        this.raise(x - 10, x + 12, () => gy - 18);
        x += r.range(60, 100);
      } else x += r.range(60, 140);
    }

    // Hazards, more of them further on. Each is placed against a reference glide out of the column (leaving it
    // EXIT_DROP under its top, gliding at 1 : GLIDE), so there is always a way past: over a kite, under a storm,
    // over or under a power line, around a bird.
    const ref = (x: number) => col.top + EXIT_DROP + (x - col.x) / GLIDE;
    // The first stretch is open sky: room to learn the glide before anything gets in the way.
    const nHaz = col.x < 1500 ? 0 : this.demo ? (r.chance(0.6) ? 1 : 0) : Math.round(lerp(0.9, 2.8, d) + overtime(col.x / WU_PER_M) * 1.2 + r.range(-0.4, 0.6));
    const slots = [0.3, 0.62, 0.45, 0.8];
    r.shuffle(slots);
    for (let i = 0; i < nHaz; i++) {
      const hx = x0 + span * slots[i % slots.length]!;
      const roll = r();
      const dd = this.demo ? 0 : d;
      if (roll < 0.3) this.wire(hx, dd, ref(hx));
      else if (roll < 0.55 && hx > KITES_FROM) this.kite(hx, dd, ref(hx));
      else if (roll < 0.8 || dd < 0.2) this.flock(hx, dd, ref(hx));
      else this.storm(hx, dd, ref(hx));
    }

    // Stars: a ladder up the warm air (a reward for riding it), and a string along a glide out of it.
    if (r.chance(0.55)) {
      const n = r.int(3, 4);
      const y0 = col.base - r.range(140, 200);
      for (let k = 0; k < n; k++) this.stars.push({ x: col.x + Math.sin(k * 1.9 + col.seed) * col.w * 0.25, y: y0 - k * 74, ph: r.range(0, 6.28), taken: false, gone: 0 });
    }
    if (r.chance(this.demo ? 0.7 : 0.7)) {
      const sx = x0 + span * r.range(0.12, 0.45);
      const ground = this.solidTop(sx - 40, sx + 200);
      const sy = clamp(lerp(col.top + 140, ground, r.range(0.25, 0.55)), col.top + 80, ground - 110);
      const n = r.int(3, 5);
      for (let k = 0; k < n; k++) {
        const xx = sx + k * 42;
        const yy = sy + k * k * 3 + Math.sin(k * 1.3) * 6;
        if (this.solidTop(xx - 10, xx + 10) < yy + 60) break;
        this.stars.push({ x: xx, y: yy, ph: r.range(0, 6.28), taken: false, gone: 0 });
      }
    }
    // A gust (a burst of speed), often with a hoop just after it: catch the gust, pull, loop through the hoop.
    if (r.chance(this.demo ? 0.9 : lerp(0.34, 0.24, d))) {
      const gx = x0 + span * r.range(0.12, 0.4);
      const len = r.range(150, 200);
      const ground = this.solidTop(gx - 40, gx + len + 160);
      const gy = clamp(ref(gx) + r.range(-60, 40), -640, ground - 170);
      // Not into a kite string or a power line: a fast plane needs open air after the gust.
      const clear = !this.kites.some((k) => Math.max(k.ax, k.kx) > gx - 100 && Math.min(k.ax, k.kx) < gx + len + 450) && !this.wires.some((w) => w.x1 > gx && w.x0 < gx + len + 350);
      if (clear && ground - gy > 160 && !this.blocked(gx + len / 2, gy, len / 2)) {
        this.gusts.push({ x0: gx, x1: gx + len, y: gy, h: 64, seed: r.int(0, 1e6) });
        if (r.chance(this.demo ? 0.8 : 0.6)) {
          this.hoopList.push({ x: gx + len + r.range(50, 90), y: gy - r.range(0, 20), r: 30, seed: r.int(0, 1e6), taken: false, gone: 0 });
        }
      }
    }
  }


  /** True if a hazard already sits within `r` of (x, y). */
  private blocked(x: number, y: number, r: number): boolean {
    for (const w of this.wires) if (x > w.x0 - r && x < w.x1 + r && Math.abs(y - (w.y0 + w.y1) / 2) < r + 40) return true;
    for (const k of this.kites) if (Math.hypot(k.kx - x, k.ky - y) < r + 40) return true;
    for (const b of this.birds) if (Math.abs(b.x0 - x) < r + 60 && Math.abs(b.y0 - y) < r + 30) return true;
    for (const s of this.storms) if (Math.abs(s.x - x) < s.w / 2 + r && y > s.y - s.h) return true;
    return false;
  }

  private tree(x: number, gy: number, h: number, kind: "tree" | "pine"): void {
    const seed = this.rng.int(0, 1e6);
    const w = kind === "pine" ? h * 0.42 : h * 0.62;
    this.props.push({ kind, x, y: gy, w, h, seed });
    if (kind === "pine") this.raise(x - w / 2, x + w / 2, (xx) => gy - h + (Math.abs(xx - x) / (w / 2)) * h * 0.85);
    else {
      const cr = w / 2;
      const cy = gy - h + cr;
      this.raise(x - cr, x + cr, (xx) => cy - Math.sqrt(Math.max(0, cr * cr - (xx - x) ** 2)));
    }
  }

  private wire(cx: number, d: number, yRef: number): void {
    const r = this.rng;
    const len = r.range(170, 260);
    const xa = cx - len / 2;
    const xb = cx + len / 2;
    const gTop = Math.min(this.groundY(xa), this.groundY(xb));
    // Low enough to hop over on the reference glide, high enough to sneak under.
    const room = gTop - (yRef + 55);
    if (room < 100) return;
    const h = Math.min(room, r.range(lerp(110, 140, d), lerp(150, 230, d)));
    const ya = this.groundY(xa) - h;
    const yb = this.groundY(xb) - h;
    if (this.blocked(cx, (ya + yb) / 2, len / 2)) return;
    this.props.push({ kind: "pole", x: xa, y: this.groundY(xa), w: 18, h, seed: r.int(0, 1e6) });
    this.props.push({ kind: "pole", x: xb, y: this.groundY(xb), w: 18, h, seed: r.int(0, 1e6) });
    this.raise(xa - 3, xa + 3, () => ya - 4);
    this.raise(xb - 3, xb + 3, () => yb - 4);
    this.wires.push({ x0: xa, y0: ya + 4, x1: xb, y1: yb + 4, sag: r.range(16, 28), seed: r.int(0, 1e6) });
    if (r.chance(0.5)) this.wires.push({ x0: xa, y0: ya + 14, x1: xb, y1: yb + 14, sag: r.range(20, 32), seed: r.int(0, 1e6) });
  }

  private kite(cx: number, d: number, yRef: number): void {
    const r = this.rng;
    const ax = cx - r.range(60, 120);
    const ay = this.groundY(ax);
    const kx = cx + r.range(-20, 40);
    // The kite (and so its string) stays under the reference glide: the way past is over it.
    const lowest = ay - 130;
    const highest = yRef + lerp(140, 45, d);
    if (highest > lowest) return;
    const ky = lerp(lowest, highest, r.range(0.4, 1));
    if (this.blocked(kx, ky, 40)) return;
    this.props.push({ kind: "kid", x: ax, y: ay, w: 14, h: 30, seed: r.int(0, 1e6) });
    this.raise(ax - 6, ax + 6, () => ay - 28);
    this.kites.push({ ax: ax + 4, ay: ay - 22, kx, ky, ph: r.range(0, 6.28), seed: r.int(0, 1e6) });
  }

  private flock(cx: number, d: number, yRef: number): void {
    const r = this.rng;
    const n = this.demo ? 1 : r.int(1, d > 0.5 ? 3 : 2) + (overtime(cx / WU_PER_M) > 0.4 ? 1 : 0);
    const y0 = clamp(yRef + r.range(-80, 60), -720, this.solidTop(cx - 60, cx + 160) - 90);
    for (let i = 0; i < n; i++) {
      const by = y0 + r.range(-30, 30) + i * 30;
      const bx = cx + i * r.range(40, 70);
      if (this.blocked(bx, by, 30)) continue;
      this.birds.push({ x0: bx, y0: by, vx: -r.range(10, lerp(30, 60, d)), amp: r.range(6, 18), ph: r.range(0, 6.28), seed: r.int(0, 1e6) });
    }
  }

  private storm(cx: number, d: number, yRef: number): void {
    const r = this.rng;
    const w = r.range(110, lerp(150, 220, d));
    // The cloud sits a little over the reference glide; its rain sinks the air under it for SINK_DEPTH.
    // Over the reference glide (dip under its rain), or, where the ground is too high for that, low enough
    // that the glide passes over it.
    const y = Math.min(yRef - r.range(20, 70), this.solidTop(cx - w / 2, cx + w / 2) - SINK_DEPTH - 60);
    if (this.blocked(cx, y, w / 2)) return;
    this.storms.push({ id: this.nextId++, x: cx, y, w, h: r.range(50, 70), s: lerp(110, 170, d), seed: r.int(0, 1e6) });
  }

  /** Drops what is far behind the plane. */
  private prune(): void {
    const behind = this.body.x - 1600;
    const keep = <T>(list: T[], xOf: (t: T) => number) => {
      let i = 0;
      while (i < list.length && xOf(list[i]!) < behind) i++;
      if (i > 0) list.splice(0, i);
    };
    keep(this.columns, (c) => c.x + c.w);
    keep(this.storms, (s) => s.x + s.w);
    keep(this.wires, (w) => w.x1);
    keep(this.kites, (k) => Math.max(k.kx, k.ax) + 40);
    keep(this.props, (p) => p.x + p.w);
    keep(this.stars, (s) => s.x);
    keep(this.hoopList, (h) => h.x + h.r);
    keep(this.gusts, (g) => g.x1);
    keep(this.ponds, (p) => p.x1);
    this.birds = this.birds.filter((b) => this.birdX(b, this.time) > behind);
    for (const k of this.chunks.keys()) if ((k + 1) * CHUNK * TS < behind - 600) this.chunks.delete(k);
    for (const k of this.solid.keys()) if ((k + 1) * CHUNK * TS < behind - 600) this.solid.delete(k);
  }

  // ---------------------------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------------------------

  birdX(b: Bird, t: number): number {
    return b.x0 + b.vx * t;
  }

  birdY(b: Bird, t: number): number {
    return b.y0 + Math.sin(t * 1.3 + b.ph) * b.amp;
  }

  kitePos(k: Kite, t: number): [number, number] {
    return [k.kx + Math.sin(t * 0.9 + k.ph) * 14, k.ky + Math.sin(t * 1.4 + k.ph * 1.7) * 9];
  }

  /** y of a wire at x (catenary-ish sag). */
  wireY(w: Wire, x: number): number {
    const t = (x - w.x0) / (w.x1 - w.x0);
    return lerp(w.y0, w.y1, t) + w.sag * 4 * t * (1 - t);
  }

  /**
   * The air's own velocity at (x, y): warm air rises, rain sinks, storm clouds buffet. The plane flies relative to
   * the air and is carried along with it, so riding warm air lifts it like an elevator without turning it over.
   * Writes into `air`.
   */
  airAt(x: number, y: number, t: number): typeof air {
    air.wx = 0;
    air.wy = 0;
    air.up = 0;
    air.column = null;
    air.storm = false;
    for (const c of this.columns) {
      const dx = Math.abs(x - c.x);
      // Rising air spreads a little with height.
      const spread = c.w * (1 + clamp((c.base - y) / 600) * 0.6);
      if (dx > spread + EDGE_W || y > c.base + 10 || y < c.top - 60) continue;
      const along = clamp((y - (c.top - 60)) / 140) * clamp((c.base + 10 - y) / 30);
      if (dx > spread) {
        // Real warm air comes with a ring of sinking air around it: diving straight through costs some of
        // what the core gives; slowing down in the middle keeps it.
        const u = (dx - spread) / EDGE_W;
        air.wy += c.s * EDGE_SINK * Math.sin(u * Math.PI) * along * (0.4 + 0.6 * c.heat);
        continue;
      }
      const across = Math.cos((dx / spread) * (Math.PI / 2)) ** 4;
      air.up += c.s * c.heat * across * along;
      air.column = c;
    }
    for (const s of this.storms) {
      const dx = Math.abs(x - s.x);
      if (dx > s.w / 2 + 20 || y < s.y - s.h || y > s.y + SINK_DEPTH) continue;
      const across = clamp((s.w / 2 + 20 - dx) / 40);
      air.wy += s.s * across * clamp((s.y + SINK_DEPTH - y) / 60);
      // Buffeting inside the cloud itself.
      if (y < s.y + s.h * 0.4) air.wx += Math.sin(t * 23 + s.seed) * 70;
      air.storm = true;
    }
    return air;
  }

  gustAt(x: number, y: number): Gust | null {
    for (const g of this.gusts) if (x >= g.x0 && x <= g.x1 && Math.abs(y - g.y) < g.h / 2) return g;
    return null;
  }

  /** What the point (x, y) touches at time t, if anything. */
  hit(x: number, y: number, t: number, r = 2): Crash | null {
    const sy = this.solidY(x);
    if (y + r > sy) {
      const gy = this.groundY(x);
      if (y + r < gy - 3) return "house";
      return this.isWater(x) ? "water" : sy < gy - 3 ? "tree" : "ground";
    }
    for (const w of this.wires) {
      if (x < w.x0 || x > w.x1) continue;
      if (Math.abs(y - this.wireY(w, x)) < 3 + r) return "wire";
    }
    for (const k of this.kites) {
      const [kx, ky] = this.kitePos(k, t);
      if (Math.hypot(x - kx, y - ky) < 15 + r) return "kite";
      // The string: a straight segment from the kid's hand.
      const minX = Math.min(k.ax, kx);
      const maxX = Math.max(k.ax, kx);
      if (x < minX - 4 || x > maxX + 4 || y < ky - 4 || y > k.ay + 4) continue;
      if (segDist(k.ax, k.ay, kx, ky, x, y) < 2 + r) return "kite";
    }
    for (const b of this.birds) {
      const bx = this.birdX(b, t);
      if (Math.abs(bx - x) > 20) continue;
      if (Math.hypot(bx - x, this.birdY(b, t) - y) < 11 + r) return "bird";
    }
    return null;
  }

  /** Rough clearance to the nearest solid thing below or around (for near-miss slow motion). */
  clearance(x: number, y: number, t: number): number {
    let c = this.solidY(x) - y;
    for (const w of this.wires) if (x > w.x0 && x < w.x1) c = Math.min(c, Math.abs(y - this.wireY(w, x)) - 3);
    for (const b of this.birds) c = Math.min(c, Math.hypot(this.birdX(b, t) - x, this.birdY(b, t) - y) - 11);
    for (const k of this.kites) {
      const [kx, ky] = this.kitePos(k, t);
      c = Math.min(c, Math.hypot(x - kx, y - ky) - 15);
      if (x > Math.min(k.ax, kx) && x < Math.max(k.ax, kx)) c = Math.min(c, segDist(k.ax, k.ay, kx, ky, x, y) - 2);
    }
    return c;
  }

  // ---------------------------------------------------------------------------------------------
  // Flight
  // ---------------------------------------------------------------------------------------------

  setHold(h: boolean): void {
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
    this.starChainT = Math.max(0, this.starChainT - h);
    if (this.starChainT <= 0) this.starChain = 0;
    for (const s of this.stars) if (s.taken) s.gone += h;
    for (const o of this.hoopList) if (o.taken) o.gone += h;
    this.generate(this.body.x + 2600);
    if (this.time % 1 < h) this.prune();
    const b = this.body;

    if (!this.alive) {
      this.deadT += h;
      if (this.soft) {
        // A gentle landing: slide along the ground and stop.
        b.vx *= Math.exp(-3.2 * h);
        b.x += b.vx * h;
        b.y = this.groundY(b.x) - 3;
        b.pitch = lerpAngle(b.pitch, -Math.atan((this.groundY(b.x + 6) - this.groundY(b.x - 6)) / 12), 8 * h);
      } else {
        // Crumpled: a paper ball tumbling down.
        b.vy += G * h;
        b.vx *= Math.exp(-1.5 * h);
        b.x += b.vx * h;
        b.y += b.vy * h;
        const gy = this.groundY(b.x) - 5;
        if (b.y > gy && !this.isWater(b.x)) {
          b.y = gy;
          b.vy = -Math.abs(b.vy) * 0.3;
          b.vx *= 0.6;
        } else if (this.isWater(b.x) && b.y > gy + 4) {
          b.y = gy + 4;
          b.vy = 0;
          b.vx *= 0.9;
        }
        b.pitch += b.vx * h * 0.05;
      }
      return;
    }

    const wasStalled = b.stalled;
    const r = flyStep(this, b, this.holding, this.time, h);
    if (b.stalled && !wasStalled) {
      this.stalls++;
      this.events.push({ k: "stall", x: b.x, y: b.y });
    }
    // Loops.
    if (b.turn >= Math.PI * 2 * 0.94) {
      b.turn -= Math.PI * 2;
      const pays = this.maxX - this.loopX >= LOOP_HEADWAY;
      const throughHoop = pays && !!this.lastHoop && this.time - this.lastHoopT < 2.2;
      if (pays) {
        this.loops++;
        this.loopX = this.maxX;
        if (!this.demo) this.bonus += throughHoop ? LOOP_BONUS * 2 : LOOP_BONUS;
      }
      this.events.push({ k: "loop", x: b.x, y: b.y, count: this.loops, hoop: throughHoop, pays });
      this.lastHoop = null;
    }
    // Warm air.
    const a = this.airAt(b.x, b.y, this.time);
    if (a.column && a.column !== this.inColumn) this.events.push({ k: "lift", column: a.column });
    this.inColumn = a.column;
    if (a.column) a.column.heat = Math.max(0, a.column.heat - h / (this.demo ? 5 : HEAT_TIME));
    const g = this.gustAt(b.x, b.y);
    if (g && g !== this.inGust) this.events.push({ k: "gust", gust: g });
    this.inGust = g;
    // Pickups.
    for (const s of this.stars) {
      if (s.taken || Math.abs(s.x - b.x) > 20) continue;
      if (Math.hypot(s.x - b.x, s.y - b.y) < 20) {
        s.taken = true;
        this.starsTaken++;
        this.starChain++;
        this.starChainT = 1.4;
        if (!this.demo) this.bonus += STAR_BONUS;
        this.events.push({ k: "star", x: s.x, y: s.y, chain: this.starChain });
      }
    }
    for (const o of this.hoopList) {
      if (o.taken || Math.abs(o.x - b.x) > o.r) continue;
      if (Math.hypot(o.x - b.x, o.y - b.y) < o.r * 0.82) {
        o.taken = true;
        this.hoops++;
        this.lastHoop = o;
        this.lastHoopT = this.time;
        if (!this.demo) this.bonus += HOOP_BONUS;
        this.events.push({ k: "hoop", x: o.x, y: o.y });
      }
    }
    if (b.x > this.maxX) {
      this.maxX = b.x;
      const page = Math.floor(this.maxX / (PAGE_M * WU_PER_M));
      if (page > this.page) {
        this.page = page;
        this.events.push({ k: "page", page: page + 1 });
      }
    }
    if (r) {
      this.die(r);
      return;
    }
    if (this.nearCool <= 0 && speedOf(b) > 200) {
      const c = this.clearance(b.x, b.y, this.time);
      if (c < 14) {
        this.nearCool = 2.6;
        this.events.push({ k: "near", x: b.x, y: b.y });
      }
    }
  }

  private lastHoopT = -9;
  private loopX = -1e9;

  private die(how: Crash): void {
    if (!this.alive) return;
    const b = this.body;
    this.alive = false;
    this.crash = how;
    this.deadT = 0;
    // A slow, level touchdown on open ground is a landing, not a crash (the flight still ends).
    const level = Math.abs(wrap(b.pitch)) < 0.4;
    this.soft = how === "ground" && b.vy < 110 && level && speedOf(b) < VT * 1.5;
    if (!this.soft) {
      b.vx *= 0.3;
      b.vy = -Math.abs(b.vy) * 0.2 - 90;
    }
    this.events.push({ k: "crash", how, soft: this.soft });
  }

  drain(): SimEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }
}

function lerpAngle(a: number, b: number, t: number): number {
  return a + wrap(b - a) * clamp(t);
}

function segDist(ax: number, ay: number, bx: number, by: number, px: number, py: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? clamp(((px - ax) * dx + (py - ay) * dy) / l2) : 0;
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

/**
 * One fixed step of flight for any body (the world's plane, or the pilot's look-ahead copy). Returns what it hit.
 */
export function flyStep(w: World, b: Body, hold: boolean, t: number, h: number): Crash | null {
  if (hold) {
    b.held += h;
    b.free = 0;
  } else {
    b.free += h;
    b.held = 0;
    if (b.free > 0.25) b.turn = 0;
  }
  const V = Math.max(1, Math.hypot(b.vx, b.vy));
  const ux = b.vx / V;
  const uy = b.vy / V;
  const gamma = Math.atan2(-b.vy, b.vx);
  const q = (V / VT) * (V / VT);
  // The nose weathervanes: it turns with the flight path and settles at the commanded angle of attack. Slow air
  // has little grip on it, so when the plane runs out of speed the path sags while the nose stays up: a stall.
  // Relaxed, a paper plane finds its glide again: the nose settles where the wing carries the plane along the
  // glide angle, easing out of dives and over the top of zooms without porpoising, and never pulls into a stall.
  // A slow plane noses down further to pick up speed again: the swoop that a well-timed pull turns into a loop.
  const target = GLIDE_ANGLE - SWOOP * clamp((VT - V) / (0.6 * VT));
  const relaxed = clamp((Math.cos(gamma) + GLIDE_K * wrap(target - gamma)) / Math.max(q, 0.25), 0.25, 1.7);
  const cmd = (hold ? C_HOLD : relaxed) * ALPHA_T;
  let alpha = wrap(b.pitch - gamma);
  // Held past the vertical, the plane is going over the top: it floats round instead of stalling, so a loop
  // can be pulled from ordinary cruising speed.
  const overTop = hold && b.turn > LOOP_ASSIST;
  if (overTop) alpha = clamp(alpha, -ALPHA_STALL, ALPHA_STALL);
  if (Math.abs(alpha) > ALPHA_STALL) {
    b.stalled = true;
    // A stalled tumble over the top is not a loop.
    b.turn = 0;
  } else if (b.stalled && Math.abs(alpha) < ALPHA_STALL * 0.7) b.stalled = false;
  const c = liftC(alpha);
  const L = G * q * c;
  const D = G * q * (CD0 + KI * c * c + (b.stalled ? 0.3 : 0));
  // Lift at right angles to the airflow, toward the plane's top side.
  const ax = uy * L - ux * D;
  const ay = -ux * L - uy * D + G;
  b.vx += ax * h;
  b.vy += ay * h;
  if (V < GUST_SPEED && w.gustAt(b.x, b.y)) {
    const k = (GUST_PUSH * h) / V;
    b.vx += b.vx * k;
    b.vy += b.vy * k;
  }
  const sp = Math.hypot(b.vx, b.vy);
  if (sp > MAX_SPEED) {
    b.vx *= MAX_SPEED / sp;
    b.vy *= MAX_SPEED / sp;
  }
  // Velocity is airspeed; the air itself carries the plane. Warm air catches a wing held nose-up far better than
  // one gliding through relaxed, and only half catches a stalled, tumbling sheet of paper.
  const a = w.airAt(b.x, b.y, t);
  const catchK = b.stalled ? STALL_CARRY : 1 + CATCH * clamp((alpha / ALPHA_T - C_TRIM) / (C_HOLD - C_TRIM));
  b.x += (b.vx + a.wx) * h;
  b.y += (b.vy + a.wy - a.up * catchK) * h;
  const g2 = Math.atan2(-b.vy, b.vx);
  const dg = wrap(g2 - gamma);
  const follow = overTop ? 1 : clamp(q / FOLLOW_Q);
  let dp = dg * follow + PITCH_RATE * Math.min(1.5, Math.sqrt(q)) * (cmd - alpha) * h;
  // Nose-heavy: when the wing lets go, the nose drops, with a paper flutter.
  if (b.stalled) dp -= (2.2 + Math.sin(t * 29) * 2) * h;
  b.pitch = wrap(b.pitch + dp);
  // Loops: count turning while held.
  if (hold || b.free < 0.25) b.turn = Math.max(0, b.turn + dg);
  // Nose and tail.
  const cx = Math.cos(b.pitch) * HALF;
  const cy = -Math.sin(b.pitch) * HALF;
  return w.hit(b.x + cx, b.y + cy, t) ?? w.hit(b.x - cx * 0.8, b.y - cy * 0.8, t) ?? w.hit(b.x, b.y, t, 3);
}

// -----------------------------------------------------------------------------------------------
// The pilot: plays the attract demo and the headless playtests.
// -----------------------------------------------------------------------------------------------

export interface PilotSkill {
  /** Seconds of look-ahead. */
  horizon: number;
  /** Seconds between decisions. */
  period: number;
  /** Std-dev-ish noise on hold durations (s). */
  noise: number;
  /** Seconds between deciding and acting. */
  delay: number;
  /** Will it loop for show when there is energy to spare? */
  showoff: boolean;
}

export const EXPERT: PilotSkill = { horizon: 3.4, period: 0.08, noise: 0, delay: 0, showoff: false };

export interface Pilot {
  hold: boolean;
  /** Seconds left on the current plan's hold. */
  left: number;
  next: number;
  pending: Array<{ at: number; left: number }>;
  rand: () => number;
}

export function newPilot(seed = 1): Pilot {
  const r = createRng(seed);
  return { hold: false, left: 0, next: 0, pending: [], rand: r };
}

/** Candidate plans: [wait, then hold for]. */
const PLANS: Array<[number, number]> = [
  [0, 0],
  [0, 0.08],
  [0, 0.16],
  [0, 0.26],
  [0, 0.38],
  [0, 0.55],
  [0, 0.8],
  [0, 1.1],
  [0, 1.6],
  [0.3, 0.4],
  [0.6, 0.4],
  [0.6, 0.9],
  [1.1, 0.5],
  [1.1, 1],
];
const scratch = newBody(0, 0, 0, 0);

/** Scores holding for `dur` seconds now, then flying relaxed, out to `horizon`. */
function evalPlan(w: World, wait: number, dur: number, horizon: number, showoff: boolean): number {
  const b = copyBody(w.body, scratch);
  const h = 1 / 60;
  let minClear = 999;
  let stars = 0;
  let loops = 0;
  let turn0 = b.turn;
  let stalled = 0;
  let gusty = 0;
  // Warm air cools while it's ridden; the look-ahead cools it too, then puts it back.
  heatSave.length = 0;
  for (const c of w.columns) heatSave.push(c.heat);
  let score = 0;
  let crashed = false;
  for (let t = 0; t < horizon; t += h) {
    const hold = t >= wait && t < wait + dur;
    const crash = flyStep(w, b, hold, w.time + t, h);
    if (crash) {
      score = -100000 + t * 1000;
      crashed = true;
      break;
    }
    const col = w.airAt(b.x, b.y, w.time + t).column;
    if (col) col.heat = Math.max(0, col.heat - h / (w.demo ? 5 : HEAT_TIME));
    if (b.turn >= Math.PI * 2 * 0.94 && turn0 < Math.PI) loops++;
    turn0 = b.turn;
    minClear = Math.min(minClear, w.clearance(b.x, b.y, w.time + t));
    for (const s of w.stars) if (!s.taken && Math.abs(s.x - b.x) < 18 && Math.abs(s.y - b.y) < 18) stars++;
    if (b.stalled) stalled += h;
    if (showoff && w.gustAt(b.x, b.y)) gusty += h;
  }
  w.columns.forEach((c, i) => (c.heat = heatSave[i] ?? c.heat));
  if (crashed) return score;
  const V = Math.hypot(b.vx, b.vy);
  const ground = w.solidTop(b.x - 20, b.x + 240);
  // Energy height above what's ahead (worth ~7 wu of glide each), distance made, stars on the way.
  const energy = Math.min(ground - b.y, 900) + (V * V) / (2 * G);
  score = energy + (b.x - w.body.x) * 0.14 + Math.min(stars, 4) * 22 - stalled * 60;
  if (minClear < 45) score -= (45 - minClear) * 5;
  if (b.y < -820) score -= (-820 - b.y) * 2;
  // The attract demo shows off: it chases gusts and loops whenever it can.
  if (showoff) score += loops * 260 + gusty * 300;
  return score;
}

const heatSave: number[] = [];

/** One frame of the pilot's decision. Returns whether to hold now. */
export function pilot(w: World, p: Pilot, dt: number, skill: PilotSkill = EXPERT): boolean {
  if (!w.alive) return (p.hold = false);
  p.next -= dt;
  p.left -= dt;
  if (p.next <= 0) {
    p.next = skill.period;
    let best = -Infinity;
    let bestDur = 0;
    for (const [wait, dur] of PLANS) {
      const s = evalPlan(w, wait, dur, skill.horizon, skill.showoff);
      if (s > best) {
        best = s;
        bestDur = wait > 0 ? 0 : dur;
      }
    }
    // Keep it simple: re-planned every period, so only the start of the hold matters.
    const noisy = Math.max(0, bestDur + (p.rand() - 0.5) * 2 * skill.noise);
    if (skill.delay > 0) p.pending.push({ at: w.time + skill.delay, left: noisy });
    else p.left = noisy;
  }
  while (p.pending.length && p.pending[0]!.at <= w.time) p.left = p.pending.shift()!.left;
  p.hold = p.left > 0;
  return p.hold;
}
