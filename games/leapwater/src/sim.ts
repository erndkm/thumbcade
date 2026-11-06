/**
 * Leapwater's world and physics. Pure: no DOM, no canvas, so it runs headless for playtests.
 *
 * World units (wu): x grows upstream (to the right), y grows downward. Pool 0's surface is y = 0 and every
 * fall climbed raises the water by that fall's height. A pool ends on the right at a rock wall; the next pool's
 * water pours over the top of that wall (the lip) and falls into it. Score = height climbed (WU_PER_M wu per
 * meter) + dragonflies.
 *
 * The koi: hold and it noses down and dives at a steady pace; let go and it turns for the surface, buoyancy
 * pulling harder the more water is above it. A deep dive comes up fast enough to leave the water, and the leap
 * that follows is about as high as the dive was deep.
 */
import { clamp, lerp } from "@thumbcade-games/kit/ease";
import { createRng, type Rng } from "@thumbcade-games/kit/rng";

export const WU_PER_M = 25;
export const G = 900;
export const STEP = 1 / 120;
export const KOI_R = 7;
export const KOI_LEN = 34;
/** Rock lip under the water that pours over a fall. */
export const LIP_D = 7;
export const FLY_BONUS = 2;
/** A leap that clears the lip by at most this much is tidy; under KISS it skims the lip. */
export const TIDY = 60;
export const KISS = 15;
const KISS_BONUS = 2;

// The koi in water.
const DIVE_ANGLE = 1.0;
const RISE_ANGLE = -1.3;
const TURN = 4.6;
const S_DIVE = 330;
const K_DIVE = 3.4;
const S_CRUISE = 150;
const K_CRUISE = 2.4;
const BUOY = 860;
const THRUST = 150;
const DRAG = 0.0003;
/** Upward speed needed to leave the water; anything slower settles at the surface. */
export const V_BREACH = 230;
const CURRENT = 32;
const PLUNGE = 250;
const PLUNGE_R = 110;
const LOOP_T = 2.4;
const LOOP_DEPTH = 52;
export const CRUISE_DEPTH = 10;

// Herons.
const HERON_DEPTH = 36;
const HERON_REACH = 78;

export interface Branch {
  x0: number;
  x1: number;
  /** Center line y and thickness. */
  y: number;
  th: number;
  seed: number;
}

export interface Fly {
  x: number;
  y: number;
  ph: number;
  taken: boolean;
  gone: number;
}

export type HeronState = "watch" | "cock" | "strike" | "rest" | "catch";

export interface Heron {
  /** Feet x (stands at the waterline). */
  x: number;
  state: HeronState;
  t: number;
  /** Where the bill strikes. */
  aimX: number;
  aimY: number;
  /** Head turned toward the koi (-1 left, 1 right). */
  face: number;
}

export interface Pool {
  i: number;
  /** Left lip (top of the fall below) and right wall (foot of the fall above). */
  x0: number;
  x1: number;
  /** Surface y. */
  s: number;
  depth: number;
  /** Where the floor reaches full depth. */
  deep0: number;
  /** Height of the fall at x1, up to pool i + 1. */
  hFall: number;
  short: boolean;
  seed: number;
  heron: Heron | null;
  /** Over the fall at x1. */
  branch: Branch | null;
  flies: Fly[];
}

export interface Koi {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Nose direction (rad); positive = nose down. */
  head: number;
  /** Speed along the nose, in water. */
  speed: number;
  water: boolean;
  /** Pool it swims in (in the air: the pool it left). */
  pool: number;
  /** Seconds without control after a knock. */
  stun: number;
  /** Buoyancy multiplier from the flow chain. */
  power: number;
  /** Highest point of the current leap. */
  apex: number;
  /** 1 = swimming upstream (right), -1 = circling back downstream. */
  dir: number;
  /** Seconds left on a loop back downstream. */
  loop: number;
  /** Seconds spent idling under a fall. */
  idle: number;
  /** Dove under the player's control since entering the water: only then does buoyancy throw it out. */
  charged: boolean;
}

export type Outcome = "breach" | "land" | "wall" | "branch" | "short" | "splash" | "bonk" | "scrape" | null;

export interface StepInfo {
  clearance: number;
  speed: number;
}

export type DeathHow = "spent" | "heron";

export type SimEvent =
  | { k: "breach"; x: number; y: number; speed: number }
  | { k: "land"; x: number; y: number; speed: number; clean: boolean; clearance: number; flow: number; h: number }
  | { k: "fail"; x: number; y: number; why: "wall" | "branch" | "short" }
  | { k: "splash"; x: number; y: number; speed: number }
  | { k: "bonk"; x: number; y: number }
  | { k: "scrape"; x: number; y: number }
  | { k: "near"; x: number; y: number }
  | { k: "fly"; x: number; y: number; n: number }
  | { k: "cock"; heron: Heron }
  | { k: "strike"; heron: Heron; hit: boolean }
  | { k: "low" }
  | { k: "die"; how: DeathHow };

export interface WorldOptions {
  seed: number;
  /** Attract demo: gentle falls, no herons, the koi never tires. */
  demo?: boolean;
}

/** 0..1 difficulty by fall index. */
export function difficulty(fall: number): number {
  return clamp(fall / 26) ** 0.85;
}

export class World {
  readonly demo: boolean;
  readonly rng: Rng;
  time = 0;
  pools: Pool[] = [];
  koi: Koi;
  holding = false;
  alive = true;
  deadT = 0;
  deathHow: DeathHow | null = null;
  /** 0..1: drains while swimming, refilled by every fall climbed. */
  vigor = 1;
  climbed = 0;
  bonus = 0;
  falls = 0;
  /** First-try leaps in a row. */
  flow = 0;
  cleanLeaps = 0;
  fliesTaken = 0;
  fails = 0;
  /** Failed attempts in the current pool. */
  tries = 0;
  events: SimEvent[] = [];
  private acc = 0;
  private scrapeCool = 0;
  private lastBonk = -9;
  private lowSent = false;
  private info: StepInfo = { clearance: 0, speed: 0 };

  constructor(opts: WorldOptions) {
    this.demo = !!opts.demo;
    this.rng = createRng(opts.seed);
    this.addPool();
    this.generate();
    this.koi = { x: -150, y: CRUISE_DEPTH, vx: S_CRUISE, vy: 0, head: 0, speed: S_CRUISE, water: true, pool: 0, stun: 0, power: 1, apex: 0, dir: 1, loop: 0, idle: 0, charged: false };
  }

  get meters(): number {
    return Math.floor(this.climbed / WU_PER_M) + this.bonus;
  }

  get pool(): Pool {
    return this.poolById(this.koi.pool)!;
  }

  poolById(i: number): Pool | undefined {
    const first = this.pools[0];
    return first ? this.pools[i - first.i] : undefined;
  }

  poolAt(x: number): Pool | undefined {
    for (const p of this.pools) if (x >= p.x0 && x < p.x1) return p;
    return undefined;
  }

  diff(i: number): number {
    return this.demo ? 0.15 : difficulty(i);
  }

  /** Floor y of pool p at x. */
  floorOf(p: Pool, x: number): number {
    // Off the lip the floor drops fast to half depth (room to land a leap), then slopes on to full depth.
    const u = clamp((x - p.x0 - 10) / Math.max(1, p.deep0 - p.x0 - 10));
    const v = clamp((x - p.x0 - 6) / 60);
    const e = Math.max(0.5 * v * v * (3 - 2 * v), u * u * (3 - 2 * u));
    // A plunge pool: deepest a little way out from the wall, rising a touch right at its foot.
    const toWall = clamp((p.x1 - x) / 60);
    const bowl = 0.9 + 0.1 * toWall;
    const rough = (Math.sin(x * 0.083 + p.seed * 40) * 3 + Math.sin(x * 0.029 + p.seed * 9) * 4) * e;
    return p.s + lerp(LIP_D + 2, p.depth * bowl, e) + rough;
  }

  floorAt(x: number): number {
    const p = this.poolAt(x);
    return p ? this.floorOf(p, x) : 4000;
  }

  // ---------------------------------------------------------------------------------------------
  // Generation
  // ---------------------------------------------------------------------------------------------

  private addPool(): void {
    const r = this.rng;
    const prev = this.pools[this.pools.length - 1];
    if (!prev) {
      // The wide calm pool at the foot of the stream, and a small first fall.
      this.pools.push({ i: 0, x0: -300, x1: 220, s: 0, depth: 140, deep0: 20, hFall: 62, short: false, seed: r(), heron: null, branch: null, flies: [] });
      return;
    }
    const i = prev.i + 1;
    const d = this.diff(i);
    const s = prev.s - prev.hFall;
    const x0 = prev.x1;
    const short = !this.demo && i >= 5 && !prev.short && r.chance(lerp(0.05, 0.2, d));
    let hFall: number;
    let len: number;
    if (short) {
      hFall = r.range(48, 64);
      len = r.range(200, 230);
    } else {
      hFall = this.demo ? r.range(70, 130) : clamp(lerp(70, 140, d) + r.range(-16, lerp(26, 90, d)), 56, 240);
      len = this.demo ? r.range(340, 380) : lerp(380, 310, d) + r.range(-20, 20);
    }
    // Room to dive about as deep as the fall is high, plus the turn.
    const depth = clamp(hFall * 1.08 + 52 + r.range(0, 20), 100, 320);
    const pool: Pool = { i, x0, x1: x0 + len, s, depth, deep0: x0 + len * (short ? 0.3 : 0.42), hFall, short, seed: r(), heron: null, branch: null, flies: [] };

    if (!this.demo) {
      if (!short && i >= 6 && r.chance(lerp(0.1, 0.42, d))) {
        // In the first half: where the koi cruises in after landing, not where it turns under the fall.
        const hx = lerp(pool.x0 + 140, pool.x0 + len * 0.5, r());
        pool.heron = { x: hx, state: "watch", t: 0, aimX: hx, aimY: s, face: -1 };
      }
      if (i >= 9 && r.chance(lerp(0.12, 0.38, d))) {
        // An overhanging branch above this pool's fall: clear the lip, but not by much.
        const above = r.range(62, 92);
        pool.branch = { x0: pool.x1 - r.range(30, 70), x1: pool.x1 + r.range(40, 80), y: s - hFall - above, th: 9, seed: r() };
      }
    }
    if (r.chance(this.demo ? 0.5 : lerp(0.5, 0.35, d))) {
      // Dragonflies hang in the air over the lip: a little higher than you need.
      const n = r.int(1, 2);
      for (let k = 0; k < n; k++) {
        const fx = pool.x1 + r.range(-34, 26) + k * 26;
        const fy = s - hFall - r.range(22, pool.branch ? 40 : 70);
        pool.flies.push({ x: fx, y: fy, ph: r.range(0, 6.28), taken: false, gone: 0 });
      }
    }
    this.pools.push(pool);
    // Every fall must be climbable from a plain entry: if the search can't find a leap, give it more room.
    for (let tries = 0; tries < 3 && !this.demo && !feasible(this, pool); tries++) {
      pool.depth = Math.min(330, pool.depth + 36);
      pool.x1 += 40;
      pool.deep0 = pool.x0 + (pool.x1 - pool.x0) * (pool.short ? 0.3 : 0.42);
      if (pool.branch) {
        pool.branch.x0 += 40;
        pool.branch.x1 += 40;
        pool.branch.y -= 12;
      }
      for (const f of pool.flies) f.x += 40;
    }
  }

  /** Keeps pools generated ahead of the koi; `budget` caps how many are made now (spreads the cost over frames). */
  private generate(budget = Infinity): void {
    // (Called once from the constructor before the koi exists.)
    const at = (this.koi as Koi | undefined)?.pool ?? 0;
    for (let n = 0; n < budget && this.pools[this.pools.length - 1]!.i < at + 6; n++) this.addPool();
  }

  private prune(): void {
    while (this.pools.length > 2 && this.pools[1]!.x1 < this.koi.x - 1400 && this.pools[0]!.i < this.koi.pool - 3) this.pools.shift();
  }

  // ---------------------------------------------------------------------------------------------
  // Simulation
  // ---------------------------------------------------------------------------------------------

  setHold(h: boolean): void {
    this.holding = h;
  }

  update(dt: number): void {
    this.generate(1);
    this.acc += Math.min(dt, 0.1);
    while (this.acc >= STEP) {
      this.acc -= STEP;
      this.step(STEP);
    }
  }

  drainRate(): number {
    if (this.demo) return 0;
    const d = this.diff(this.falls);
    // Gentle in the first pool; then a slow climb that never stops.
    const base = this.falls === 0 ? 1 / 30 : lerp(1 / 16, 1 / 11.5, d);
    return base + Math.max(0, this.falls - 26) * 0.0015;
  }

  private step(h: number): void {
    this.time += h;
    this.scrapeCool = Math.max(0, this.scrapeCool - h);
    for (const p of this.pools) for (const f of p.flies) if (f.taken) f.gone += h;
    const k = this.koi;

    if (!this.alive) {
      this.deadT += h;
      if (this.deathHow === "heron") {
        this.updateHerons(h);
        return;
      }
      // Spent: the current takes it, rolling slowly, down toward the lip.
      if (k.water) {
        k.speed *= Math.exp(-1.5 * h);
        k.vx = -CURRENT * 1.8 + Math.cos(k.head) * k.speed * 0.3;
        k.vy = 10;
        k.x += k.vx * h;
        k.y = Math.min(k.y + k.vy * h, this.floorAt(k.x) - KOI_R);
      }
      return;
    }

    if (!this.demo) {
      this.vigor -= this.drainRate() * h;
      if (this.vigor < 0.25 && !this.lowSent) {
        this.lowSent = true;
        this.events.push({ k: "low" });
      }
      if (this.vigor > 0.4) this.lowSent = false;
      if (this.vigor <= 0) {
        this.vigor = 0;
        this.die("spent");
        return;
      }
    }

    const from = k.pool;
    const out = advanceKoi(this, k, this.holding, h, this.info);
    if (out) this.handle(out, from);

    // Dragonflies.
    for (const p of this.pools) {
      if (p.i < k.pool - 1 || p.i > k.pool + 1) continue;
      for (const f of p.flies) {
        if (f.taken) continue;
        const fy = f.y + Math.sin(this.time * 2.2 + f.ph) * 5;
        if (Math.hypot(f.x - k.x, fy - k.y) < 20) {
          f.taken = true;
          this.fliesTaken++;
          if (!this.demo) {
            this.bonus += FLY_BONUS;
            this.vigor = Math.min(1, this.vigor + 0.05);
          }
          this.events.push({ k: "fly", x: f.x, y: fy, n: this.fliesTaken });
        }
      }
    }
    this.updateHerons(h);
    if (this.time % 1 < h) this.prune();
  }

  private handle(out: Exclude<Outcome, null>, from: number): void {
    const k = this.koi;
    switch (out) {
      case "breach":
        this.events.push({ k: "breach", x: k.x, y: k.y, speed: this.info.speed });
        break;
      case "land": {
        const below = this.poolById(from)!;
        const c = this.info.clearance;
        // Clean: first try, and only just over the lip. A huge leap is safe, but it builds nothing.
        const clean = this.tries === 0 && c <= TIDY;
        this.falls++;
        this.climbed += below.hFall;
        if (clean) {
          this.flow = Math.min(this.flow + 1, 12);
          this.cleanLeaps++;
          if (!this.demo) this.bonus += Math.min(this.flow, 5) + (c < KISS ? KISS_BONUS : 0);
        } else if (this.tries > 0) this.flow = 0;
        k.power = 1 + Math.min(this.flow, 6) * 0.015;
        this.tries = 0;
        if (!this.demo) this.vigor = Math.min(1, this.vigor + 0.36 + (clean ? 0.08 : 0));
        this.events.push({ k: "land", x: k.x, y: k.y, speed: Math.hypot(k.vx, k.vy), clean, clearance: this.info.clearance, flow: this.flow, h: below.hFall });
        if (c < KISS) this.events.push({ k: "near", x: below.x1, y: below.s - below.hFall });
        break;
      }
      case "wall":
      case "branch":
        this.fail(out, 0.08);
        break;
      case "short":
        // Fell back into the same pool: only the time is lost.
        this.events.push({ k: "fail", x: k.x, y: k.y, why: "short" });
        this.events.push({ k: "splash", x: k.x, y: k.y, speed: Math.hypot(k.vx, k.vy) });
        break;
      case "splash":
        this.events.push({ k: "splash", x: k.x, y: k.y, speed: Math.hypot(k.vx, k.vy) });
        break;
      case "bonk":
        if (!this.demo && this.time - this.lastBonk > 1) this.vigor -= 0.04;
        this.lastBonk = this.time;
        this.events.push({ k: "bonk", x: k.x, y: k.y });
        break;
      case "scrape":
        if (this.scrapeCool <= 0) {
          this.scrapeCool = 0.5;
          this.events.push({ k: "scrape", x: k.x, y: k.y });
        }
        break;
    }
  }

  private fail(why: "wall" | "branch", cost: number): void {
    const k = this.koi;
    this.tries++;
    this.fails++;
    this.flow = 0;
    k.power = 1;
    if (!this.demo) this.vigor -= cost;
    this.events.push({ k: "fail", x: k.x, y: k.y, why });
  }

  private updateHerons(h: number): void {
    const k = this.koi;
    for (const p of this.pools) {
      const hr = p.heron;
      if (!hr) continue;
      hr.t += h;
      const here = this.alive && k.pool === p.i && k.water;
      if (here) hr.face = k.x < hr.x ? -1 : 1;
      switch (hr.state) {
        case "watch": {
          // It waits out a koi that's tumbling or circling back: no cheap catches.
          if (!here || k.stun > 0 || k.dir < 0) break;
          const depth = k.y - p.s;
          const ahead = k.x + clamp(k.vx, -200, 200) * 0.3;
          if (depth < HERON_DEPTH && Math.abs(k.x - hr.x) < HERON_REACH + 20 && Math.abs(ahead - hr.x) < HERON_REACH && hr.t > 0.4) {
            hr.state = "cock";
            hr.t = 0;
            this.events.push({ k: "cock", heron: hr });
          }
          break;
        }
        case "cock":
          if (hr.t >= 0.6) {
            hr.state = "strike";
            hr.t = 0;
            // Strikes where the koi is now, as far as the bill can reach.
            hr.aimX = clamp(k.x + k.vx * 0.06, hr.x - HERON_REACH, hr.x + HERON_REACH);
            hr.aimY = clamp(k.y, p.s - 6, p.s + HERON_DEPTH);
          }
          break;
        case "strike":
          if (hr.t >= 0.1 && hr.t - h < 0.1) {
            const hit = this.alive && k.pool === p.i && Math.hypot(k.x - hr.aimX, k.y - hr.aimY) < 20 && k.y - p.s < HERON_DEPTH + 6;
            this.events.push({ k: "strike", heron: hr, hit });
            if (hit) {
              hr.state = "catch";
              hr.t = 0;
              this.die("heron");
              k.x = hr.aimX;
              k.y = hr.aimY;
              break;
            }
          }
          if (hr.t >= 0.32) {
            hr.state = "rest";
            hr.t = 0;
          }
          break;
        case "rest":
          if (hr.t >= 1.1) {
            hr.state = "watch";
            hr.t = 0;
          }
          break;
        case "catch":
          // Lifts its catch out of the water.
          k.x = hr.aimX + (hr.x + hr.face * 14 - hr.aimX) * clamp(hr.t / 0.5);
          k.y = hr.aimY + (p.s - 58 - hr.aimY) * clamp(hr.t / 0.5);
          break;
      }
    }
  }

  private die(how: DeathHow): void {
    if (!this.alive) return;
    this.alive = false;
    this.deathHow = how;
    this.deadT = 0;
    this.events.push({ k: "die", how });
  }

  drain(): SimEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }
}

// -----------------------------------------------------------------------------------------------
// The koi's physics, shared by the world and every look-ahead.
// -----------------------------------------------------------------------------------------------

function turnToward(a: number, target: number, rate: number): number {
  const d = target - a;
  return Math.abs(d) <= rate ? target : a + Math.sign(d) * rate;
}

/** Advances the koi by h seconds. Reads the world's geometry, never changes it. */
export function advanceKoi(w: World, k: Koi, hold: boolean, h: number, info: StepInfo): Outcome {
  if (k.stun > 0) k.stun = Math.max(0, k.stun - h);
  const control = k.stun <= 0;
  if (k.water) {
    const p = w.poolById(k.pool);
    if (!p) return null;
    const depth = k.y - p.s;
    const dive = control && hold;
    // A press always turns it upstream again.
    if (dive && k.dir < 0) {
      k.dir = 1;
      k.loop = 0;
    }
    if (dive) k.charged = true;
    const vUp = -k.speed * Math.sin(k.head);
    const settle = !dive && ((depth < CRUISE_DEPTH + 10 && vUp < V_BREACH) || k.dir < 0 || !k.charged);
    // Idling under a fall, the koi circles back downstream for another run at it.
    if (settle && k.dir > 0 && p.x1 - k.x < 90) k.idle += h;
    else if (k.dir > 0) k.idle = 0;
    if (k.idle > 0.5) {
      k.idle = 0;
      k.dir = -1;
      k.loop = LOOP_T;
    }
    if (k.dir < 0) {
      // Back out to a run-up that suits this fall, then face it again.
      k.loop -= h;
      const runUp = clamp(p.hFall * 1.3 + 160, 220, p.x1 - p.x0 - 70);
      if (k.loop <= 0 || k.x < p.x1 - runUp || k.x < p.x0 + 60) {
        k.dir = 1;
        k.loop = 0;
      }
    }
    const target = dive ? DIVE_ANGLE : !control ? 0.2 : settle ? (depth > CRUISE_DEPTH + 16 && k.dir > 0 ? -0.45 : 0) : RISE_ANGLE;
    k.head = turnToward(k.head, target, TURN * h * (control ? 1 : 0.5));
    if (dive) k.speed += (S_DIVE - k.speed) * Math.min(1, K_DIVE * h);
    else if (settle || !control) k.speed += (S_CRUISE * (control ? 1 : 0.6) - k.speed) * Math.min(1, K_CRUISE * h);
    else k.speed += (BUOY * k.power * -Math.sin(k.head) + THRUST - DRAG * k.speed * k.speed) * h;
    k.speed = clamp(k.speed, 60, 1300);
    // The stream runs toward the lip; under a fall the plunging water pushes out hard at every depth, so a koi
    // swimming up to the wall holds station below it instead of nosing into the rock.
    const near = clamp(1 - (p.x1 - k.x) / PLUNGE_R);
    const outflow = CURRENT + PLUNGE * near * near * (depth < 90 ? 1 : 0.75);
    k.vx = k.dir * Math.cos(k.head) * k.speed - outflow;
    k.vy = Math.sin(k.head) * k.speed;
    k.x += k.vx * h;
    k.y += k.vy * h;
    // Circling back it runs low, under a heron's reach.
    if (k.dir < 0) k.y += (p.s + LOOP_DEPTH - k.y) * Math.min(1, 3 * h);
    else if (settle && depth < CRUISE_DEPTH + 24) k.y += (p.s + CRUISE_DEPTH - k.y) * Math.min(1, 5 * h);
    // Behind the lip the current would carry it over; it just swims.
    if (k.x < p.x0 + KOI_R) k.x = p.x0 + KOI_R;
    if (k.x > p.x1 - KOI_R) {
      const hard = k.vx > 140;
      k.x = p.x1 - KOI_R - (hard ? 8 : 1);
      if (!hard) return null;
      k.speed *= 0.3;
      k.head = Math.min(k.head, 0.2);
      k.stun = 0.4;
      return "bonk";
    }
    const fy = w.floorOf(p, k.x) - KOI_R;
    if (k.y > fy) {
      k.y = fy;
      if (k.head > -0.1) k.head = Math.max(-0.35, k.head - 0.5);
      k.speed *= 0.985;
      return "scrape";
    }
    if (k.y < p.s) {
      if (!settle && vUp > 0) {
        // Leaves the water with the water's push still in it: right under a fall, it pops nearly straight up.
        k.water = false;
        k.charged = false;
        k.apex = k.y;
        info.speed = k.speed;
        return "breach";
      }
      k.y = p.s + 1;
    }
    return null;
  }

  // In the air.
  const from = w.poolById(k.pool);
  if (!from) return null;
  const upS = from.s - from.hFall;
  const px = k.x;
  const py = k.y;
  k.vy += G * h;
  k.vx *= 1 - 0.04 * h;
  k.x += k.vx * h;
  k.y += k.vy * h;
  k.head = Math.atan2(k.vy, k.vx);
  if (k.y < k.apex) k.apex = k.y;
  const wallX = from.x1;
  const b = from.branch;
  if (b && k.stun <= 0 && k.x > b.x0 - 4 && k.x < b.x1 + 4 && Math.abs(k.y - b.y) < b.th / 2 + 5) {
    k.vx = -Math.abs(k.vx) * 0.25 - 30;
    k.vy = Math.abs(k.vy) * 0.2 + 70;
    k.stun = 0.8;
    return "branch";
  }
  if (px < wallX && k.x >= wallX) {
    const t = (wallX - px) / (k.x - px);
    const yc = py + (k.y - py) * t;
    const clear = upS - yc;
    if (clear < 1) {
      // Into the falling water: it carries the koi back down.
      k.x = wallX - KOI_R - 1;
      k.vx = -45;
      k.vy = Math.max(k.vy, 140);
      k.stun = 0.9;
      return "wall";
    }
    info.clearance = clear;
  }
  if (k.x >= wallX && k.y > upS) {
    k.water = true;
    k.charged = false;
    k.pool = from.i + 1;
    k.speed = Math.hypot(k.vx, k.vy) * 0.62;
    k.head = clamp(Math.atan2(k.vy, k.vx), -0.3, 1.25);
    return "land";
  }
  if (k.x < wallX && k.y > from.s) {
    k.water = true;
    k.charged = false;
    k.speed = Math.hypot(k.vx, k.vy) * (k.stun > 0 ? 0.35 : 0.55);
    k.head = clamp(Math.atan2(k.vy, Math.max(20, k.vx)), -0.3, 1.25);
    return k.stun > 0 ? "splash" : "short";
  }
  return null;
}

export function cloneKoi(k: Koi): Koi {
  return { ...k };
}

export interface Prediction {
  ok: boolean;
  out: Outcome;
  clearance: number;
  /** Seconds until the outcome. */
  t: number;
  /** Highest point above the upper surface. */
  rise: number;
}

const scratchInfo: StepInfo = { clearance: 0, speed: 0 };

/** Plays the koi forward: hold for `holdFor` seconds, then let go, until it lands, fails or `maxT` runs out. */
export function predict(w: World, from: Koi, holdFor: number, maxT = 3, h = STEP): Prediction {
  const k = cloneKoi(from);
  const start = k.pool;
  let t = 0;
  while (t < maxT) {
    const out = advanceKoi(w, k, t < holdFor, h, scratchInfo);
    t += h;
    if (out === "land") {
      const below = w.poolById(start);
      return { ok: true, out, clearance: scratchInfo.clearance, t, rise: below ? below.s - below.hFall - k.apex : 0 };
    }
    if (out === "wall" || out === "branch" || out === "short" || out === "bonk") return { ok: false, out, clearance: 0, t, rise: 0 };
    // Settled back at the surface without leaving the water: no leap.
    if (t > holdFor + 0.4 && k.water && k.y - (w.poolById(k.pool)?.s ?? 0) < CRUISE_DEPTH + 3 && Math.abs(k.head) < 0.05) return { ok: false, out: null, clearance: 0, t, rise: 0 };
  }
  return { ok: false, out: null, clearance: 0, t, rise: 0 };
}

/** Is pool p's fall climbable for a koi arriving at the surface near its left end? (Coarse, so it stays cheap.) */
function feasible(w: World, p: Pool): boolean {
  const k: Koi = { x: p.x0 + 50, y: p.s + CRUISE_DEPTH, vx: S_CRUISE, vy: 0, head: 0, speed: S_CRUISE, water: true, pool: p.i, stun: 0, power: 1, apex: 0, dir: 1, loop: 0, idle: 0, charged: false };
  const h = 1 / 60;
  for (let n = 0; n < 300; n++) {
    if (n % 10 === 0) {
      // A window a thumb can hit: three neighbouring hold times (0.15 s) that all clear the lip.
      let run = 0;
      for (let hold = 0.1; hold < 1.26; hold += 0.05) {
        const r = predict(w, k, hold, 2.4, 1 / 40);
        run = r.ok && r.clearance >= 6 ? run + 1 : 0;
        if (run >= 3) return true;
      }
    }
    const out = advanceKoi(w, k, false, h, scratchInfo);
    // Past every dive point (it turned back) or out of the water: no.
    if (out === "bonk" || !k.water || k.dir < 0) return false;
  }
  return false;
}

// -----------------------------------------------------------------------------------------------
// The pilot: plays the attract demo and the headless playtests.
// -----------------------------------------------------------------------------------------------

export interface PilotSkill {
  /** Seconds between seeing and pressing. */
  delay: number;
  /** Random timing error (s, standard deviation). */
  noise: number;
  /** Target clearance over the lip (wu). */
  aim: number;
  /** Chance to notice a heron's tell in time. */
  wary: number;
}

export const PERFECT: PilotSkill = { delay: 0, noise: 0, aim: 26, wary: 1 };

export interface Pilot {
  hold: boolean;
  /** A press or release decided but not yet done (reaction time). */
  pendingAt: number;
  pendingTo: boolean;
  /** Release once this much time has passed holding (the plan), or -1. */
  plan: number;
  held: number;
  /** Seconds since the last release. */
  since: number;
  think: number;
  aim: number;
  tell: Heron | null;
  noticed: boolean;
  rng: Rng;
}

export function createPilot(seed: number): Pilot {
  return { hold: false, pendingAt: -1, pendingTo: false, plan: -1, held: 0, since: 9, think: 0, aim: 26, tell: null, noticed: false, rng: createRng(seed) };
}

/** The koi `t` seconds from now if the hold stays as it is. */
function ahead(w: World, k: Koi, hold: boolean, t: number): Koi {
  const c = cloneKoi(k);
  for (let s = 0; s < t; s += 1 / 60) {
    advanceKoi(w, c, hold, 1 / 60, scratchInfo);
    if (!c.water) break;
  }
  return c;
}

function gauss(r: Rng): number {
  return (r() + r() + r() - 1.5) * 1.41;
}

/** One frame of the pilot's decision; returns whether it holds. */
export function pilot(w: World, p: Pilot, dt: number, skill: PilotSkill = PERFECT): boolean {
  const k = w.koi;
  if (p.hold) p.held += dt;
  else p.since += dt;
  if (p.pendingAt >= 0 && w.time >= p.pendingAt) {
    p.hold = p.pendingTo;
    p.pendingAt = -1;
    p.held = 0;
    p.since = 0;
  }
  if (!w.alive) return (p.hold = false);
  const decide = (to: boolean) => {
    if (p.pendingAt >= 0) return;
    if (to === p.hold) return;
    const lag = Math.max(0, skill.delay + gauss(p.rng) * skill.noise);
    if (lag <= 0) {
      p.hold = to;
      p.held = 0;
      p.since = 0;
    } else {
      p.pendingAt = w.time + lag;
      p.pendingTo = to;
    }
  };
  if (!k.water) {
    decide(false);
    return p.hold;
  }
  if (k.stun > 0) return p.hold;
  const pool = w.pool;
  // A heron cocking its neck: get deep (if this pilot noticed the tell; decided once per tell).
  const hr = pool.heron;
  if (hr && hr.state === "cock") {
    if (p.tell !== hr) {
      p.tell = hr;
      p.noticed = p.rng() < skill.wary;
    }
    if (p.noticed && k.y - pool.s < 56 && Math.abs(k.x - hr.x) < 120) {
      decide(true);
      p.plan = -1;
      return p.hold;
    }
  } else if (p.tell === hr) p.tell = null;
  // Holding to a plan: let go on time (the reaction delay and noise make it human).
  if (p.hold && p.plan > 0 && p.pendingAt < 0 && p.held >= p.plan - skill.delay) {
    decide(false);
    p.plan = -1;
    return p.hold;
  }
  p.think -= dt;
  if (p.think > 0) return p.hold;
  p.think = 0.05;
  if (p.pendingAt >= 0) return p.hold;
  // A pilot with reaction time plans from where the koi will be when its thumb moves.
  const lead = skill.delay;
  if (!p.hold) {
    // Wait for the last leap to play out: back at the surface, or rising too slowly to leave it.
    const vUp = -k.vy;
    const settled = k.y - pool.s < CRUISE_DEPTH + 6 && vUp < 60;
    if (!settled && p.since < 1.4) return p.hold;
    if (k.x < pool.x1 - 640) return p.hold;
    const from = ahead(w, k, false, lead);
    // Start a dive once a range of release times all give a clean leap (a forgiving window), or, close to the
    // wall, as soon as any does.
    // Find the widest window of hold times that clear the lip; aim inside it for the target clearance.
    let run = 0;
    let bestRun = 0;
    let runStart = 0;
    let winStart = 0;
    const clears: number[] = [];
    const STEPH = 0.04;
    for (let i = 0, hold = 0.08; hold < 1.4; hold += STEPH, i++) {
      const r = predict(w, from, hold, 2.6);
      clears[i] = r.ok && r.clearance >= 6 ? r.clearance : -1;
      if (clears[i]! >= 0) {
        if (run === 0) runStart = i;
        run++;
        if (run > bestRun) {
          bestRun = run;
          winStart = runStart;
        }
      } else run = 0;
    }
    let best: number | null = null;
    if (bestRun >= (k.x > pool.x1 - 220 ? 2 : 4)) {
      p.aim = skill.aim * (0.8 + p.rng() * 0.5);
      let err = Infinity;
      // Stay off the window's edges when it's wide enough.
      const a = bestRun >= 5 ? winStart + 1 : winStart;
      const b = bestRun >= 5 ? winStart + bestRun - 2 : winStart + bestRun - 1;
      for (let i = a; i <= b; i++) {
        const e = Math.abs(clears[i]! - p.aim);
        if (e < err) {
          err = e;
          best = 0.08 + i * STEPH;
        }
      }
    }
    if (best !== null) {
      decide(true);
      // The plan counts from the press, which lands `lead` from now.
      p.plan = best;
    }
    return p.hold;
  }
  // While diving: let go when letting go then clears the lip by about the aim, or when it's now or never.
  const from = ahead(w, k, true, lead);
  const now = predict(w, from, 0, 2.6);
  const later = predict(w, from, 0.1, 2.6);
  const dodging = !!hr && (hr.state === "cock" || hr.state === "strike");
  // After a dodge, carry on as if this were a planned dive.
  if (!dodging && p.plan < 0) p.plan = p.held + 0.9;
  const pinned = from.x > pool.x1 - 30 && !now.ok;
  if (pinned || (!dodging && ((now.ok && (now.clearance >= p.aim || !later.ok || later.clearance < now.clearance)) || (p.plan > 0 && p.held > p.plan + 0.3)))) {
    decide(false);
    p.plan = -1;
  }
  return p.hold;
}
