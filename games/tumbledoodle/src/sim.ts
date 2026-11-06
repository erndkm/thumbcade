/**
 * Tumbledoodle's rules, pure and deterministic (no DOM): the page and its doodles, the hole and how it swallows, the
 * erasers, the page drawing itself back in, and the run economy (clock, combos, feasts, tiers, the final gulp).
 * The game, the headless pilots and the tests all step this same world at a fixed 60 Hz.
 */
import { createRng, type Rng } from "@thumbcade-games/kit/rng";
import { ERASERS, KIND_INDEX, KINDS, kindsOfTier } from "./catalog.ts";

export const STEP = 1 / 60;
export const PAGE_W = 1300;
export const PAGE_H = 2600;
/** Where the hole tears open: low on the page, in the pencil-sharpening mess. */
export const START_X = 650;
export const START_Y = 2080;

/** Hole sizes. `r` is the radius at the start of the tier, `view` the page width the camera shows. */
export const TIERS: ReadonlyArray<{ r: number; view: number }> = [
  { r: 12, view: 240 },
  { r: 18, view: 320 },
  { r: 27, view: 420 },
  { r: 40, view: 560 },
  { r: 60, view: 740 },
  { r: 88, view: 960 },
  { r: 128, view: 1220 },
];
export const TOP = TIERS.length - 1;
/** A doodle falls in if its radius is at most this share of the hole's. */
export const FIT = 0.86;
/** The hole grows this share of the way to the next tier while the meter fills; the rest bursts open at the tier-up. */
export const GROW_IN_TIER = 0.3;
/** Food (sum of swallowed radius²) each tier needs, as a multiple of the next tier's extra area: quick at first, slower up top. */
export const FOOD_K = [2.2, 5.4, 7.4, 10.5, 15, 26, 8] as const;

// The run.
export const START_CLOCK = 44;
export const MAX_CLOCK = 50;
export const TIER_BONUS = 3;
export const ERASER_BONUS = 4;
export const SCRUB_COST = 2;
/** Share of the tier meter an eraser rubs off. */
export const SCRUB_METER = 0.2;
export const LAST_BITES = 6;
export const GULP_T = 1.35;
export const COMBO_WINDOW = 0.7;
/** Combo lengths for "feast" ×2, "banquet" ×3, "all you can eat" ×4. */
export const FEAST = [8, 20, 40] as const;
export const FEAST_NAMES = ["", "feast!", "banquet!", "all you can eat!"] as const;
export const FALL_T = 0.5;
export const DRAW_T = 0.55;
/** The first eraser walks in after this long. */
export const ERASER_AT = 7;
export const ERASER_GAP = 6;
/** The tier a run must reach before each eraser shows up. */
const ERASER_MIN_TIER = [0, 3, 4] as const;
const ERASER_STUN = 1.3;
/** After a scrub the eraser backs off for a moment, rubbing doodles out, before it comes for you again. */
const ERASER_RETREAT = 1.5;
const INVULN = 1.6;

// Movement.
const FOLLOW = 16;
const SPEED_CAP = 3.2;
/** How far ahead of the hole a dragged target may run, as a share of the view. */
export const MAX_LEAD = 0.32;
const PULL = 30;
const SLIDE_DAMP = 5.5;
const CELL = 80;
const COLS = Math.ceil(PAGE_W / CELL);
const ROWS = Math.ceil(PAGE_H / CELL);
const MAX_S = 110;
const MAX_DOODLES = 1300;
const SPAWN_DT = 0.6;
const LOCAL_TARGET = 6;

export const DRAWING = 0;
export const REST = 1;
export const FALLING = 2;
export const GONE = 3;

export interface Doodle {
  id: number;
  /** Index into KINDS. */
  k: number;
  s: number;
  x: number;
  y: number;
  rot: number;
  state: number;
  /** Seconds in the current state. */
  t: number;
  vx: number;
  vy: number;
  wob: number;
  wobV: number;
  /** Too big and over the rim this step. */
  touch: boolean;
  lastWob: number;
  /** Fall: offset from the hole's centre when it tipped in, and its spin. */
  fx: number;
  fy: number;
  spin: number;
  seed: number;
  cell: number;
  moving: boolean;
  wobbling: boolean;
}

export interface Hole {
  x: number;
  y: number;
  px: number;
  py: number;
  vx: number;
  vy: number;
  r: number;
  tier: number;
  /** Food eaten toward the next tier. */
  food: number;
  invuln: number;
}

export type EraserState = "chase" | "stun" | "retreat" | "flee" | "fall";

export interface Eraser {
  level: number;
  s: number;
  x: number;
  y: number;
  px: number;
  py: number;
  ang: number;
  speed: number;
  state: EraserState;
  t: number;
  fx: number;
  fy: number;
  /** Seconds since it last rubbed a doodle out (for the crumbs and the sound). */
  rubbed: number;
}

export type Ev =
  | { t: "swallow"; d: Doodle; pts: number; mult: number; combo: number; final: boolean }
  | { t: "tier"; tier: number; bonus: number; pts: number }
  | { t: "feast"; level: number; combo: number }
  | { t: "burp"; combo: number }
  | { t: "wobble"; d: Doodle }
  | { t: "eraserIn"; level: number }
  | { t: "scrub"; x: number; y: number; level: number }
  | { t: "flee"; level: number }
  | { t: "eraserEaten"; level: number; pts: number }
  | { t: "erase"; d: Doodle }
  | { t: "spawn"; d: Doodle }
  | { t: "lastBites" }
  | { t: "gulp" }
  | { t: "done" };

export type Phase = "play" | "gulp" | "done";

export const needFor = (tier: number): number =>
  tier < TOP ? FOOD_K[tier]! * (TIERS[tier + 1]!.r ** 2 - TIERS[tier]!.r ** 2) : FOOD_K[TOP]! * TIERS[TOP]!.r ** 2 * 0.6;

/** Bigger holes are heavier: the same thumb travel moves them a little less far. */
export const gainOf = (tier: number): number => 1 / (1 + 0.08 * tier);
/** Only doodles at least this share of the hole's radius count toward a combo (dust doesn't make a feast). */
export const COMBO_MIN = 0.22;

/** The hole's radius for a tier and meter (0-1). */
export function radiusOf(tier: number, meter: number): number {
  const m = Math.min(1, Math.max(0, meter));
  if (tier >= TOP) return TIERS[TOP]!.r * (1 + 0.14 * m);
  const a = TIERS[tier]!.r;
  const b = TIERS[tier + 1]!.r;
  return a + (b - a) * GROW_IN_TIER * m;
}

/** The page width the camera shows for a tier and meter. */
export function viewOf(tier: number, meter: number): number {
  const m = Math.min(1, Math.max(0, meter));
  if (tier >= TOP) return TIERS[TOP]!.view * (1 + 0.06 * m);
  const a = TIERS[tier]!.view;
  const b = TIERS[tier + 1]!.view;
  return a + (b - a) * 0.22 * m;
}

export const fits = (s: number, r: number): boolean => s <= FIT * r;

/** Distance from (x, y) to the segment a-b. */
export function segDist(x: number, y: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let u = l2 > 1e-9 ? ((x - ax) * dx + (y - ay) * dy) / l2 : 0;
  u = u < 0 ? 0 : u > 1 ? 1 : u;
  return Math.hypot(x - (ax + dx * u), y - (ay + dy * u));
}

const clampTo = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

export interface GameOptions {
  mode?: "play" | "attract";
  /** Attract mode starts a tier up so the demo shows bigger doodles sooner. */
  startTier?: number;
}

export interface Stats {
  eaten: number;
  /** Swallows per kind. */
  tally: number[];
  erasersEaten: number;
  scrubs: number;
  wobbles: number;
  bestCombo: number;
  feasts: number;
  topFeast: number;
  finalGulp: number;
  /** The biggest kind eaten (index into KINDS, or -1). */
  biggest: number;
}

export class Game {
  readonly rng: Rng;
  readonly mode: "play" | "attract";
  doodles: Doodle[] = [];
  readonly grid: Doodle[][] = Array.from({ length: COLS * ROWS }, () => []);
  readonly falling: Doodle[] = [];
  readonly moving: Doodle[] = [];
  readonly wobbling: Doodle[] = [];
  hole: Hole;
  eraser: Eraser | null = null;
  /** Index of the next eraser to walk in. */
  eraserLevel = 0;
  nextEraserAt: number;
  time = 0;
  clock = START_CLOCK;
  phase: Phase = "play";
  gulpT = 0;
  score = 0;
  combo = 0;
  comboT = 0;
  /** 0 = none, 1 feast, 2 banquet, 3 all you can eat. */
  feast = 0;
  lastBites = false;
  readonly stats: Stats = { eaten: 0, tally: KINDS.map(() => 0), erasersEaten: 0, scrubs: 0, wobbles: 0, bestCombo: 0, feasts: 0, topFeast: 0, finalGulp: 0, biggest: -1 };
  readonly events: Ev[] = [];
  private nextId = 1;
  private spawnT = 0;
  private spawnN = 0;
  private drawingList: Doodle[] = [];
  /** Doodles still to draw in for the last bites. */
  private flood = 0;
  private secondWave = false;
  alive = 0;

  constructor(seed: number, o: GameOptions = {}) {
    this.rng = createRng(seed);
    this.mode = o.mode ?? "play";
    const tier = o.startTier ?? 0;
    this.hole = { x: START_X, y: START_Y, px: START_X, py: START_Y, vx: 0, vy: 0, r: radiusOf(tier, 0), tier, food: 0, invuln: 0 };
    this.nextEraserAt = this.mode === "attract" ? 3.5 : ERASER_AT;
    populate(this);
  }

  get meter(): number {
    return Math.min(1, this.hole.food / needFor(this.hole.tier));
  }

  get view(): number {
    return viewOf(this.hole.tier, this.meter);
  }

  get mult(): number {
    return (1 + this.feast) * (this.lastBites ? 2 : 1);
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Doodles and the grid
  // ---------------------------------------------------------------------------------------------------------------
  private cellOf(x: number, y: number): number {
    const c = clampTo(Math.floor(x / CELL), 0, COLS - 1);
    const r = clampTo(Math.floor(y / CELL), 0, ROWS - 1);
    return r * COLS + c;
  }

  /** Adds a doodle (already drawn, or drawing itself in when `drawing`). */
  add(k: number, x: number, y: number, drawing = false): Doodle {
    const kind = KINDS[k]!;
    const d: Doodle = {
      id: this.nextId++,
      k,
      s: kind.s,
      x,
      y,
      rot: (this.rng() - 0.5) * 0.9,
      state: drawing ? DRAWING : REST,
      t: 0,
      vx: 0,
      vy: 0,
      wob: 0,
      wobV: 0,
      touch: false,
      lastWob: -9,
      fx: 0,
      fy: 0,
      spin: 0,
      seed: Math.floor(this.rng() * 1e6),
      cell: this.cellOf(x, y),
      moving: false,
      wobbling: false,
    };
    this.doodles.push(d);
    this.grid[d.cell]!.push(d);
    this.alive++;
    return d;
  }

  private unlink(d: Doodle): void {
    const list = this.grid[d.cell]!;
    const i = list.indexOf(d);
    if (i >= 0) {
      list[i] = list[list.length - 1]!;
      list.pop();
    }
    this.alive--;
  }

  private relink(d: Doodle): void {
    const c = this.cellOf(d.x, d.y);
    if (c === d.cell) return;
    const list = this.grid[d.cell]!;
    const i = list.indexOf(d);
    if (i >= 0) {
      list[i] = list[list.length - 1]!;
      list.pop();
    }
    d.cell = c;
    this.grid[c]!.push(d);
  }

  /** Calls `cb` for every doodle on the grid (drawing or resting) whose cell overlaps the box around (x, y). */
  query(x: number, y: number, rad: number, cb: (d: Doodle) => void): void {
    const c0 = clampTo(Math.floor((x - rad) / CELL), 0, COLS - 1);
    const c1 = clampTo(Math.floor((x + rad) / CELL), 0, COLS - 1);
    const r0 = clampTo(Math.floor((y - rad) / CELL), 0, ROWS - 1);
    const r1 = clampTo(Math.floor((y + rad) / CELL), 0, ROWS - 1);
    for (let r = r0; r <= r1; r++)
      for (let c = c0; c <= c1; c++) {
        const list = this.grid[r * COLS + c]!;
        for (let i = 0; i < list.length; i++) cb(list[i]!);
      }
  }

  /** True if a doodle of radius `s` at (x, y) would overlap nothing (with `gap` to spare). */
  free(x: number, y: number, s: number, gap = 1): boolean {
    let ok = true;
    this.query(x, y, s + MAX_S, (o) => {
      if (ok && Math.hypot(o.x - x, o.y - y) < (o.s + s) * 0.92 * gap) ok = false;
    });
    return ok;
  }

  /** Sweeps out the doodles that have finished falling (call now and then; the game does it every second). */
  compact(): void {
    if (this.doodles.length > this.alive + this.falling.length + 200) this.doodles = this.doodles.filter((d) => d.state !== GONE);
  }

  // ---------------------------------------------------------------------------------------------------------------
  // A step
  // ---------------------------------------------------------------------------------------------------------------
  /** Keeps a dragged target on the page and within reach of the hole. */
  clampTarget(t: { x: number; y: number }): void {
    const h = this.hole;
    const lead = this.view * MAX_LEAD;
    const dx = t.x - h.x;
    const dy = t.y - h.y;
    const d = Math.hypot(dx, dy);
    if (d > lead) {
      t.x = h.x + (dx / d) * lead;
      t.y = h.y + (dy / d) * lead;
    }
    const m = h.r * 0.8;
    t.x = clampTo(t.x, m, PAGE_W - m);
    t.y = clampTo(t.y, m, PAGE_H - m);
  }

  step(tx: number, ty: number): void {
    const dt = STEP;
    this.time += dt;
    const h = this.hole;
    h.px = h.x;
    h.py = h.y;
    h.invuln = Math.max(0, h.invuln - dt);
    const view = this.view;
    if (this.phase === "play") {
      let vx = (tx - h.x) * FOLLOW;
      let vy = (ty - h.y) * FOLLOW;
      const sp = Math.hypot(vx, vy);
      const cap = view * SPEED_CAP;
      if (sp > cap) {
        vx *= cap / sp;
        vy *= cap / sp;
      }
      h.x += vx * dt;
      h.y += vy * dt;
      const m = h.r * 0.8;
      h.x = clampTo(h.x, m, PAGE_W - m);
      h.y = clampTo(h.y, m, PAGE_H - m);
    }
    h.vx = (h.x - h.px) / dt;
    h.vy = (h.y - h.py) / dt;
    const base = radiusOf(h.tier, this.meter);
    const gulping = this.phase === "gulp";
    const gk = gulping ? Math.min(1, this.gulpT / 0.35) : 0;
    h.r = base * (1 + 0.42 * gk * (2 - gk));

    if (this.phase === "play" || (gulping && this.gulpT < GULP_T)) this.swallowNear(dt, gulping);
    this.slide(dt);
    this.fall(dt);
    this.wobble(dt);
    if (this.phase === "play") {
      this.stepEraser(dt, view);
      this.spawn(dt, view);
    } else if (this.eraser) this.eraserFall(dt);
    this.economy(dt);
  }

  private swallowNear(dt: number, gulping: boolean): void {
    const h = this.hole;
    const r = h.r;
    const reach = gulping ? r * 2.4 : r;
    this.query(h.x, h.y, reach + MAX_S, (d) => {
      // The final gulp even takes doodles that are still being drawn.
      if (d.state !== REST && !(gulping && d.state === DRAWING)) return;
      const dx = h.x - d.x;
      const dy = h.y - d.y;
      const dist = Math.hypot(dx, dy);
      const edible = fits(d.s, r);
      if (edible) {
        if (segDist(d.x, d.y, h.px, h.py, h.x, h.y) < r - d.s * 0.35) {
          this.swallow(d);
          return;
        }
        const edge = gulping ? reach + d.s : r + d.s * 0.7;
        if (dist < edge) {
          const k = gulping ? 3.2 : 0.4 + Math.min(1, (edge - dist) / Math.max(1, d.s * 1.05));
          const a = PULL * r * k * dt;
          const ux = dx / (dist || 1);
          const uy = dy / (dist || 1);
          d.vx += ux * a;
          d.vy += uy * a;
          if (!d.moving) {
            d.moving = true;
            this.moving.push(d);
          }
        }
        d.touch = false;
      } else if (dist < r + d.s * 0.45) {
        if (!d.touch && this.time - d.lastWob > 0.5) {
          d.lastWob = this.time;
          d.wobV += (d.seed & 1 ? 1 : -1) * (3.2 + 2.5 * Math.min(1, r / d.s));
          this.stats.wobbles++;
          this.events.push({ t: "wobble", d });
        }
        d.touch = true;
        d.wobV += Math.sin(this.time * 26 + d.seed) * dt * 34;
        if (!d.wobbling) {
          d.wobbling = true;
          this.wobbling.push(d);
        }
      } else d.touch = false;
    });
  }

  private swallow(d: Doodle, final = false): void {
    const h = this.hole;
    this.unlink(d);
    d.state = FALLING;
    d.t = 0;
    d.fx = d.x - h.x;
    d.fy = d.y - h.y;
    d.spin = (d.seed & 2 ? 1 : -1) * (2.4 + (d.seed % 7) * 0.35);
    this.falling.push(d);
    const kind = KINDS[d.k]!;
    this.stats.eaten++;
    this.stats.tally[d.k]!++;
    if (this.stats.biggest < 0 || kind.s > KINDS[this.stats.biggest]!.s) this.stats.biggest = d.k;
    if (this.phase === "gulp") this.stats.finalGulp++;
    if (d.s >= COMBO_MIN * h.r) {
      this.combo++;
      this.comboT = COMBO_WINDOW;
    }
    this.stats.bestCombo = Math.max(this.stats.bestCombo, this.combo);
    if (this.combo > 0 && this.feast < FEAST.length && this.combo >= FEAST[this.feast]!) {
      this.feast++;
      if (this.feast === 1) this.stats.feasts++;
      this.stats.topFeast = Math.max(this.stats.topFeast, this.feast);
      this.events.push({ t: "feast", level: this.feast, combo: this.combo });
    }
    const mult = this.mult;
    const pts = kind.pts * mult;
    this.score += pts;
    this.events.push({ t: "swallow", d, pts, mult, combo: this.combo, final: final || this.phase === "gulp" });
    this.feed(d.s * d.s);
  }

  /** Food in: fills the meter and opens the next tier. */
  private feed(food: number): void {
    const h = this.hole;
    h.food += food;
    if (this.phase !== "play") return;
    while (h.tier < TOP && h.food >= needFor(h.tier)) {
      h.food -= needFor(h.tier);
      h.tier++;
      h.food = Math.min(h.food, needFor(h.tier) * 0.4);
      const bonus = this.mode === "play" ? Math.min(TIER_BONUS, MAX_CLOCK - this.clock) : 0;
      this.clock += Math.max(0, bonus);
      const pts = 250 * h.tier;
      this.score += pts;
      this.events.push({ t: "tier", tier: h.tier, bonus: Math.max(0, bonus), pts });
    }
  }

  private slide(dt: number): void {
    const damp = Math.exp(-SLIDE_DAMP * dt);
    for (let i = this.moving.length - 1; i >= 0; i--) {
      const d = this.moving[i]!;
      if (d.state !== REST) {
        d.moving = false;
        this.moving[i] = this.moving[this.moving.length - 1]!;
        this.moving.pop();
        continue;
      }
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.vx *= damp;
      d.vy *= damp;
      d.x = clampTo(d.x, d.s, PAGE_W - d.s);
      d.y = clampTo(d.y, d.s, PAGE_H - d.s);
      this.relink(d);
      if (Math.abs(d.vx) + Math.abs(d.vy) < 0.4) {
        d.vx = d.vy = 0;
        d.moving = false;
        this.moving[i] = this.moving[this.moving.length - 1]!;
        this.moving.pop();
      }
    }
  }

  private fall(dt: number): void {
    for (let i = this.falling.length - 1; i >= 0; i--) {
      const d = this.falling[i]!;
      d.t += dt;
      if (d.t >= FALL_T) {
        d.state = GONE;
        this.falling[i] = this.falling[this.falling.length - 1]!;
        this.falling.pop();
      }
    }
  }

  private wobble(dt: number): void {
    for (let i = this.wobbling.length - 1; i >= 0; i--) {
      const d = this.wobbling[i]!;
      d.wobV += (-140 * d.wob - 7 * d.wobV) * dt;
      d.wob += d.wobV * dt;
      if (!d.touch && Math.abs(d.wob) < 0.002 && Math.abs(d.wobV) < 0.02) {
        d.wob = d.wobV = 0;
        d.wobbling = false;
        this.wobbling[i] = this.wobbling[this.wobbling.length - 1]!;
        this.wobbling.pop();
      }
    }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Erasers
  // ---------------------------------------------------------------------------------------------------------------
  private stepEraser(dt: number, view: number): void {
    const h = this.hole;
    if (!this.eraser) {
      if (this.eraserLevel < ERASERS.length && this.time >= this.nextEraserAt && h.tier >= ERASER_MIN_TIER[this.eraserLevel]!) this.spawnEraser(view);
      return;
    }
    const e = this.eraser;
    e.px = e.x;
    e.py = e.y;
    e.rubbed += dt;
    if (e.state === "fall") {
      this.eraserFall(dt);
      return;
    }
    const kind = ERASERS[e.level]!;
    const edible = fits(e.s, h.r);
    if (edible && e.state !== "flee") {
      e.state = "flee";
      e.t = 0;
      this.events.push({ t: "flee", level: e.level });
    }
    e.t += dt;
    const dx = h.x - e.x;
    const dy = h.y - e.y;
    const dist = Math.hypot(dx, dy) || 1;
    let want = e.ang;
    let target = 0;
    let turn = 2.5;
    if (e.state === "stun") {
      if (e.t >= ERASER_STUN) {
        e.state = "retreat";
        e.t = 0;
      }
    } else if (e.state === "retreat") {
      want = Math.atan2(-dy, -dx) + Math.sin(e.t * 2.3) * 0.6;
      target = view * kind.chase * 0.6;
      if (e.t >= ERASER_RETREAT) {
        e.state = "chase";
        e.t = 0;
      }
    } else if (e.state === "chase") {
      const lead = Math.min(0.5, dist / (view * kind.chase + 1)) * 0.6;
      // Far away it meanders toward you, rubbing out doodles on the way; close up it homes in.
      const far = Math.min(1, Math.max(0, (dist - view * 0.45) / (view * 0.5)));
      want = Math.atan2(h.y + h.vy * lead - e.y, h.x + h.vx * lead - e.x) + Math.sin(this.time * 1.7 + e.level) * 0.9 * far;
      target = view * kind.chase * (1 - 0.3 * far);
    } else {
      // Flee: straight away from the hole, bending off the page edges.
      let ax = -dx / dist;
      let ay = -dy / dist;
      const m = 140 + e.s;
      if (e.x < m) ax += (m - e.x) / m * 1.6;
      if (e.x > PAGE_W - m) ax -= (e.x - (PAGE_W - m)) / m * 1.6;
      if (e.y < m) ay += (m - e.y) / m * 1.6;
      if (e.y > PAGE_H - m) ay -= (e.y - (PAGE_H - m)) / m * 1.6;
      want = Math.atan2(ay, ax);
      target = view * kind.flee * (dist < view * 0.5 ? 1 : 0.6);
      turn = 3.2;
    }
    let da = want - e.ang;
    while (da > Math.PI) da -= Math.PI * 2;
    while (da < -Math.PI) da += Math.PI * 2;
    const maxTurn = turn * dt;
    e.ang += da > maxTurn ? maxTurn : da < -maxTurn ? -maxTurn : da;
    const acc = view * 1.3 * dt;
    e.speed += clampTo(target - e.speed, -acc * 1.6, acc);
    e.x += Math.cos(e.ang) * e.speed * dt;
    e.y += Math.sin(e.ang) * e.speed * dt;
    const m = e.s * 0.7;
    if (e.x < m || e.x > PAGE_W - m) e.ang = Math.PI - e.ang;
    if (e.y < m || e.y > PAGE_H - m) e.ang = -e.ang;
    e.x = clampTo(e.x, m, PAGE_W - m);
    e.y = clampTo(e.y, m, PAGE_H - m);

    const d2 = Math.hypot(h.x - e.x, h.y - e.y);
    if (edible) {
      if (segDist(e.x, e.y, h.px, h.py, h.x, h.y) < h.r - e.s * 0.35) this.eatEraser();
      return;
    }
    if (e.state === "chase" && h.invuln <= 0 && d2 < h.r + e.s * 0.8) {
      this.scrub(e);
      return;
    }
    if (e.state === "chase" || e.state === "retreat") this.rub(e);
  }

  private spawnEraser(view: number): void {
    const h = this.hole;
    const kind = ERASERS[this.eraserLevel]!;
    let best = { x: h.x, y: h.y - view, d: -1 };
    for (let i = 0; i < 12; i++) {
      const a = this.rng() * Math.PI * 2;
      const x = clampTo(h.x + Math.cos(a) * view * 0.85, kind.s, PAGE_W - kind.s);
      const y = clampTo(h.y + Math.sin(a) * view * 0.85, kind.s, PAGE_H - kind.s);
      const d = Math.hypot(x - h.x, y - h.y);
      if (d > best.d) best = { x, y, d };
      if (d > view * 0.7) break;
    }
    this.eraser = {
      level: this.eraserLevel,
      s: kind.s,
      x: best.x,
      y: best.y,
      px: best.x,
      py: best.y,
      ang: Math.atan2(h.y - best.y, h.x - best.x),
      speed: 0,
      state: "chase",
      t: 0,
      fx: 0,
      fy: 0,
      rubbed: 9,
    };
    this.events.push({ t: "eraserIn", level: this.eraserLevel });
  }

  private scrub(e: Eraser): void {
    const h = this.hole;
    h.invuln = INVULN;
    if (this.mode === "play") this.clock = Math.max(0, this.clock - SCRUB_COST);
    h.food = Math.max(0, h.food - needFor(h.tier) * SCRUB_METER);
    this.stats.scrubs++;
    e.state = "stun";
    e.t = 0;
    e.ang = Math.atan2(e.y - h.y, e.x - h.x);
    e.speed = this.view * 0.9;
    // A scrub ends the streak, quietly.
    this.combo = 0;
    this.comboT = 0;
    this.feast = 0;
    this.events.push({ t: "scrub", x: (e.x + h.x) / 2, y: (e.y + h.y) / 2, level: e.level });
  }

  /** The eraser rubs out the doodles it runs over (smaller than itself), leaving crumbs. */
  private rub(e: Eraser): void {
    this.query(e.x, e.y, e.s + MAX_S, (d) => {
      if (d.state !== REST || d.s >= e.s * 0.8) return;
      if (Math.hypot(d.x - e.x, d.y - e.y) > e.s * 0.7 + d.s * 0.3) return;
      this.unlink(d);
      d.state = GONE;
      e.rubbed = 0;
      this.events.push({ t: "erase", d });
      if (d.k !== KIND_INDEX.crumb && this.rng() < 0.45 && this.alive < MAX_DOODLES) {
        const a = this.rng() * Math.PI * 2;
        this.add(KIND_INDEX.crumb!, d.x + Math.cos(a) * d.s * 0.6, d.y + Math.sin(a) * d.s * 0.6);
      }
    });
  }

  private eatEraser(): void {
    const e = this.eraser!;
    const h = this.hole;
    e.state = "fall";
    e.t = 0;
    e.fx = e.x - h.x;
    e.fy = e.y - h.y;
    const kind = ERASERS[e.level]!;
    const pts = kind.pts * this.mult;
    this.score += pts;
    if (this.mode === "play") this.clock = Math.min(MAX_CLOCK, this.clock + ERASER_BONUS);
    this.stats.erasersEaten++;
    this.eraserLevel = e.level + 1;
    this.nextEraserAt = this.time + ERASER_GAP;
    this.combo++;
    this.comboT = COMBO_WINDOW;
    this.events.push({ t: "eraserEaten", level: e.level, pts });
    this.feed(e.s * e.s * 0.6);
  }

  private eraserFall(dt: number): void {
    const e = this.eraser;
    if (!e || e.state !== "fall") return;
    e.t += dt;
    if (e.t >= FALL_T * 1.6) this.eraser = null;
  }

  // ---------------------------------------------------------------------------------------------------------------
  // The page draws itself back in
  // ---------------------------------------------------------------------------------------------------------------
  private spawn(dt: number, view: number): void {
    for (const d of this.drawingList) {
      d.t += dt;
      if (d.t >= DRAW_T) {
        d.state = REST;
        d.t = 0;
      }
    }
    if (this.drawingList.length && this.drawingList.some((d) => d.state !== DRAWING)) this.drawingList = this.drawingList.filter((d) => d.state === DRAWING);
    this.spawnT -= dt;
    if (this.spawnT > 0) return;
    this.spawnT = this.flood > 0 ? 0.11 : SPAWN_DT;
    if (this.alive >= MAX_DOODLES) return;
    const h = this.hole;
    if (this.flood > 0) {
      // The last bites: the margins draw back, a ring of doodles your size all around you.
      this.flood--;
      const ks = [...kindsOfTier(h.tier), ...kindsOfTier(Math.max(0, h.tier - 1))].filter((k) => fits(KINDS[k]!.s, h.r));
      this.drawNear(ks[Math.floor(this.rng() * ks.length)]!, view * 0.16, view * 0.42);
      return;
    }
    let edible = 0;
    let big = 0;
    const near = view * 0.6;
    this.query(h.x, h.y, view * 0.8, (d) => {
      if (d.state === GONE) return;
      const dd = Math.hypot(d.x - h.x, d.y - h.y);
      // Only what's worth chasing counts: dust doesn't feed a big hole.
      if (fits(d.s, h.r)) {
        if (dd < near && d.s >= COMBO_MIN * h.r) edible++;
      } else if (dd < view * 0.8) big++;
    });
    this.spawnN++;
    // Now and then something a size up, to look forward to (never more than two in sight).
    if (this.spawnN % 7 === 0 && h.tier < TOP && big < 2) {
      // Never a sky full of moons: at most two of any one kind of the next size on the page.
      const ks = kindsOfTier(h.tier + 1).filter((k) => this.aliveOf(k) < 2);
      if (ks.length) this.drawNear(ks[Math.floor(this.rng() * ks.length)]!, view * 0.4, view * 0.8);
      return;
    }
    // Bigger holes see more page, so they keep more on it.
    if (edible >= LOCAL_TARGET + h.tier * 1.5) return;
    // A crowd: one doodle your size with a few little ones round it, so there is always a feast to be had.
    const top = h.tier >= TOP;
    const mainTier = top ? 3 + Math.floor(this.rng() * 3.4) : this.rng() < 0.6 ? h.tier : Math.max(0, h.tier - 1);
    const mk = kindsOfTier(mainTier).filter((k) => fits(KINDS[k]!.s, h.r) && (KINDS[k]!.tier < TOP || this.aliveOf(k) < 2));
    const main = mk.length ? this.drawNear(mk[Math.floor(this.rng() * mk.length)]!, view * 0.32, view * 0.62) : null;
    if (!main) return;
    const n = 3 + Math.floor(h.tier / 2) + Math.floor(this.rng() * 4);
    for (let i = 0; i < n; i++) {
      const t = Math.max(0, (top ? 3 : h.tier - 1) - Math.floor(this.rng() * 2.4));
      const ks = kindsOfTier(t);
      const k = ks[Math.floor(this.rng() * ks.length)]!;
      const s = KINDS[k]!.s;
      for (let j = 0; j < 6; j++) {
        const a = this.rng() * Math.PI * 2;
        const dd = main.s + s + this.rng() * h.r * 2.2;
        const x = main.x + Math.cos(a) * dd;
        const y = main.y + Math.sin(a) * dd;
        if (x < s + 8 || x > PAGE_W - s - 8 || y < s + 8 || y > PAGE_H - s - 8) continue;
        if (Math.hypot(x - h.x, y - h.y) < h.r * 1.6 + s || !this.free(x, y, s, 1.05)) continue;
        const d = this.add(k, x, y, true);
        d.t = -0.08 * (i + 1);
        this.drawingList.push(d);
        this.events.push({ t: "spawn", d });
        break;
      }
    }
  }

  /** How many of a kind are on the page (drawn or drawing). */
  aliveOf(k: number): number {
    let n = 0;
    for (const d of this.doodles) if (d.k === k && (d.state === REST || d.state === DRAWING)) n++;
    return n;
  }

  /** Draws a doodle in somewhere free between `near` and `far` from the hole. */
  private drawNear(k: number, near: number, far: number): Doodle | null {
    const h = this.hole;
    const s = KINDS[k]!.s;
    for (let i = 0; i < 10; i++) {
      const a = this.rng() * Math.PI * 2;
      const dd = near + this.rng() * (far - near) + s;
      const x = h.x + Math.cos(a) * dd;
      const y = h.y + Math.sin(a) * dd;
      if (x < s + 8 || x > PAGE_W - s - 8 || y < s + 8 || y > PAGE_H - s - 8) continue;
      if (Math.hypot(x - h.x, y - h.y) < h.r * 1.6 + s) continue;
      if (this.eraser && Math.hypot(x - this.eraser.x, y - this.eraser.y) < this.eraser.s + s) continue;
      if (!this.free(x, y, s, 1.05)) continue;
      const d = this.add(k, x, y, true);
      this.drawingList.push(d);
      this.events.push({ t: "spawn", d });
      return d;
    }
    return null;
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Clock, combo, the end
  // ---------------------------------------------------------------------------------------------------------------
  private economy(dt: number): void {
    if (this.combo > 0) {
      this.comboT -= dt;
      if (this.comboT <= 0) {
        if (this.feast > 0) this.events.push({ t: "burp", combo: this.combo });
        this.combo = 0;
        this.feast = 0;
      }
    }
    if (this.mode !== "play") return;
    if (this.phase === "play") {
      this.clock -= dt;
      if (!this.lastBites && this.clock <= LAST_BITES) {
        this.lastBites = true;
        this.flood = 10;
        this.spawnT = 0;
        this.events.push({ t: "lastBites" });
      }
      if (!this.secondWave && this.clock <= 1.3) {
        // A second ring right before the end, still drawing itself in when the final gulp comes.
        this.secondWave = true;
        this.flood += 9;
        this.spawnT = 0;
      }
      if (this.clock <= 0) {
        this.clock = 0;
        this.phase = "gulp";
        this.gulpT = 0;
        if (this.eraser && this.eraser.state !== "fall") {
          this.eraser.state = "stun";
          this.eraser.t = -99;
        }
        this.events.push({ t: "gulp" });
      }
    } else if (this.phase === "gulp") {
      this.gulpT += dt;
      if (this.gulpT >= GULP_T && (this.falling.length === 0 || this.gulpT >= GULP_T + FALL_T)) {
        this.phase = "done";
        this.events.push({ t: "done" });
      }
    }
  }

  /** One hint from how the run went, for the game-over card. */
  hint(): string {
    const st = this.stats;
    const t = this.hole.tier;
    if (st.scrubs >= 3) return HINTS.eraser;
    if (t < 3) return HINTS.size;
    if (st.bestCombo < FEAST[0]) return HINTS.feast;
    if (st.erasersEaten === 0 && t >= 3) return HINTS.hunt;
    if (st.wobbles > 14) return HINTS.wobble;
    if (st.finalGulp < 6) return HINTS.gulp;
    return HINTS.last;
  }
}

/** Every game-over hint (the card is laid out for the longest). */
export const HINTS = {
  eraser: "the eraser turns wide. circle round it instead of running straight",
  size: "eat everything your size first. bigger doodles only fall in once you've grown",
  feast: `sweep through a crowd of little doodles in one go. ${FEAST[0]} in a row is a feast`,
  hunt: `once you're bigger than the eraser it runs. chase it down for +${ERASER_BONUS} s`,
  wobble: "too-big doodles only wobble. don't waste seconds on them",
  gulp: "save a crowd for the end: the last bites count double and the final gulp pulls them in",
  last: `the last ${LAST_BITES} seconds count double. finish next to a crowd`,
} as const;

// ---------------------------------------------------------------------------------------------------------------
// The page as it starts: themed patches of doodles, bigger ones farther from the tear, over a scatter of desk dust.
// ---------------------------------------------------------------------------------------------------------------
interface Patch {
  mix: Record<string, number>;
  count: number;
  rad: number;
  band: [number, number];
}

const PATCHES: Patch[] = [
  { mix: { shaving: 4, crumb: 3, dot: 2, staple: 1.5, star: 0.6 }, count: 48, rad: 175, band: [0, 0] },
  { mix: { staple: 2, paperclip: 3, button: 3, dot: 1, shaving: 1 }, count: 30, rad: 190, band: [250, 420] },
  { mix: { heart: 1, star: 1, flower: 4, snail: 3, mushroom: 2, bird: 1, tree: 0.6 }, count: 34, rad: 230, band: [280, 520] },
  { mix: { heart: 2, smiley: 3, fish: 1, cat: 3, ghost: 1, bird: 1 }, count: 28, rad: 210, band: [380, 700] },
  { mix: { heart: 2, star: 1, button: 1, cupcake: 4, smiley: 1, paperclip: 1 }, count: 24, rad: 190, band: [380, 760] },
  { mix: { flower: 3, snail: 2, mushroom: 3, bird: 2, tree: 2, cat: 1 }, count: 26, rad: 240, band: [600, 950] },
  { mix: { car: 3, bike: 2, tree: 2, robot: 1, house: 1.2, balloon: 1, cat: 1 }, count: 18, rad: 300, band: [650, 1100] },
  { mix: { fish: 4, sailboat: 2, bird: 1, whale: 0.8, ship: 0.8, smiley: 1 }, count: 20, rad: 320, band: [800, 1300] },
  { mix: { star: 5, robot: 2, rocket: 2, balloon: 1, ghost: 1, moon: 0.35 }, count: 24, rad: 340, band: [1150, 1800] },
  { mix: { ghost: 2, dino: 2, house: 1, castle: 1, tree: 1, kraken: 0.3 }, count: 15, rad: 320, band: [1250, 2100] },
  { mix: { cupcake: 2, cat: 2, car: 2, bike: 1, house: 1, dino: 1 }, count: 16, rad: 300, band: [900, 1500] },
  { mix: { whale: 1, ship: 1, castle: 1, sailboat: 2, fish: 3 }, count: 12, rad: 330, band: [1500, 2300] },
];

function pickMix(rng: Rng, mix: Record<string, number>): number {
  let total = 0;
  for (const w of Object.values(mix)) total += w;
  let u = rng() * total;
  for (const [id, w] of Object.entries(mix)) {
    u -= w;
    if (u <= 0) return KIND_INDEX[id]!;
  }
  return KIND_INDEX[Object.keys(mix)[0]!]!;
}

function populate(g: Game): void {
  const rng = g.rng;
  // The pencil-sharpening mess right round the tear, so the first drag in any direction eats.
  for (let ring = 0; ring < 3; ring++) {
    const n = 8 + ring * 5;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + ring * 0.7 + (rng() - 0.5) * 0.4;
      const d = 30 + ring * 24 + rng() * 10;
      const k = pickMix(rng, { shaving: 3, crumb: 3, dot: 2, staple: 1 });
      const x = START_X + Math.cos(a) * d;
      const y = START_Y + Math.sin(a) * d;
      if (g.free(x, y, KINDS[k]!.s, 1.05)) g.add(k, x, y);
    }
  }
  const centers: Array<{ x: number; y: number; rad: number }> = [];
  for (const p of PATCHES) {
    let cx = START_X;
    let cy = START_Y;
    if (p.band[1] > 0) {
      let ok = false;
      for (let i = 0; i < 40 && !ok; i++) {
        // Mostly up the page from the tear (it starts near the bottom).
        const a = -Math.PI / 2 + (rng() - 0.5) * Math.PI * (i < 20 ? 1.3 : 2);
        const d = p.band[0] + rng() * (p.band[1] - p.band[0]);
        cx = START_X + Math.cos(a) * d;
        cy = START_Y + Math.sin(a) * d;
        const m = p.rad * 0.55;
        if (cx < m || cx > PAGE_W - m || cy < m || cy > PAGE_H - m) continue;
        ok = centers.every((c) => Math.hypot(c.x - cx, c.y - cy) > (c.rad + p.rad) * 0.62);
      }
    }
    centers.push({ x: cx, y: cy, rad: p.rad });
    for (let n = 0; n < p.count; n++) {
      const k = pickMix(rng, p.mix);
      const s = KINDS[k]!.s;
      for (let i = 0; i < 12; i++) {
        const a = rng() * Math.PI * 2;
        const d = Math.sqrt(rng()) * p.rad;
        const x = cx + Math.cos(a) * d;
        const y = cy + Math.sin(a) * d;
        if (x < s + 6 || x > PAGE_W - s - 6 || y < s + 6 || y > PAGE_H - s - 6) continue;
        // Keep the tear itself clear, and nothing too big right next to it.
        const ds = Math.hypot(x - START_X, y - START_Y);
        if (ds < 26 + s || (KINDS[k]!.tier > 1 && ds < 140)) continue;
        if (!g.free(x, y, s, 1.1)) continue;
        g.add(k, x, y);
        break;
      }
    }
  }
  // Every kind (bar the giants) at least twice, out where its size belongs.
  const have = new Array<number>(KINDS.length).fill(0);
  for (const d of g.doodles) have[d.k]!++;
  for (let k = 0; k < KINDS.length; k++) {
    const kind = KINDS[k]!;
    const want = kind.tier >= 6 ? 1 : 2;
    for (let n = have[k]!, tries = 0; n < want && tries < 60; tries++) {
      const a = -Math.PI / 2 + (rng() - 0.5) * Math.PI * 1.6;
      const d = 200 + kind.tier * 260 + rng() * 300;
      const x = START_X + Math.cos(a) * d;
      const y = START_Y + Math.sin(a) * d;
      if (x < kind.s + 6 || x > PAGE_W - kind.s - 6 || y < kind.s + 6 || y > PAGE_H - kind.s - 6) continue;
      if (!g.free(x, y, kind.s, 1.1)) continue;
      g.add(k, x, y);
      n++;
    }
  }
  // Desk dust and little doodles everywhere, thicker toward the bottom of the page.
  const scatter: Array<[number, number]> = [[0, 300], [1, 90], [2, 34]];
  for (const [tier, count] of scatter) {
    const ks = kindsOfTier(tier);
    for (let n = 0; n < count; n++) {
      const k = ks[Math.floor(rng() * ks.length)]!;
      const s = KINDS[k]!.s;
      for (let i = 0; i < 8; i++) {
        const x = s + 6 + rng() * (PAGE_W - 2 * s - 12);
        const y = s + 6 + Math.sqrt(rng()) * (PAGE_H - 2 * s - 12);
        if (Math.hypot(x - START_X, y - START_Y) < 26 + s) continue;
        if (!g.free(x, y, s, 1.15)) continue;
        g.add(k, x, y);
        break;
      }
    }
  }
}
