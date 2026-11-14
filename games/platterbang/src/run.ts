/**
 * One run: dish walls dealt against one clock. Tap a free peg and it spins out into the open jar of its colour, or onto
 * the shelf if no jar of its colour is open. Three pegs fill a jar, which ships; the next jar in line takes its place
 * and pulls its colour off the shelf. A dish down to one peg swings on it; with none it drops and smashes. A pulled
 * peg with nowhere to go (no jar, shelf full) is the danger: forgiven in the first seconds and once more early on, then
 * by a held magnet, then the run is over. Pure and time-stepped, so the game, the pilot and the tests play the same
 * rules.
 */
import { createRng, type Rng } from "@thumbcade-games/kit/rng";
import { planFor, type Wall } from "./board.ts";
import { dealSteps, DOCKS, SHELF, type Deal } from "./deal.ts";
import { PEG_R, sdfAt } from "./geom.ts";
import { Physics, STEP } from "./physics.ts";

export const TUNE = {
  /** Seconds on the clock at the first tap, and the most it holds. */
  clock: 24,
  clockMax: 45,
  /** The clock burns 1 + (t / burnScale)^burnPow seconds a second. */
  burnScale: 80,
  burnPow: 1.4,
  /** Seconds back for a shipped jar and a smashed dish. */
  shipTime: 0.8,
  dropTime: 0.25,
  /** A cleared wall: seconds back for the first, then less each wall, down to the floor. */
  wallTime: 7,
  wallTimeStep: 0.5,
  wallTimeMin: 3,
  /** The clock stands still while a cleared wall is celebrated and the next one hung. */
  dealPause: 1.6,
  /** Shipments and smashes this close together build the streak; the streak reaching each tier lifts the multiplier. */
  streakWindow: 2.2,
  tiers: [3, 7, 12, 18, 25],
  pullPoints: 5,
  shipPoints: 40,
  dropPoints: 30,
  fancyPoints: 150,
  wallPoints: 250,
  clockPoints: 10,
  /** A full shelf this early in a run is always forgiven. */
  safeStart: 8,
  /** And once more after that, while the run is young. */
  graceUntil: 30,
  magnetsMax: 1,
  /** The streak tier that earns the spare shelf slot (once a run). */
  slotTier: 4,
} as const;

/** The named line for each multiplier (index = multiplier). */
export const TIER_LINES = ["", "", "HOT PLATE!", "SMASH-TASTIC!", "KITCHEN CHAOS!", "CRASH-A-RAMA!", "BULL IN A CHINA SHOP!"];

/** The multiplier for a streak of `n`. */
export function multiplier(n: number): number {
  let m = 1;
  for (const t of TUNE.tiers) if (n >= t) m++;
  return m;
}

export type Ending = "time" | "full";

export interface Jar {
  /** Index in the wall's line-up. */
  id: number;
  color: number;
  n: number;
  /** Rushed in out of turn (a save). */
  rush: boolean;
}

/** Where a pulled peg went. */
export type Dest = { to: "jar"; jar: number; slot: number } | { to: "shelf"; index: number };

export type RunEvent =
  | { type: "pull"; peg: number; color: number; dest: Dest }
  | { type: "covered"; peg: number; by: number[] }
  | { type: "swing"; dish: number }
  | { type: "drop"; dish: number; points: number; mult: number; fancy: boolean }
  | { type: "land"; dish: number; x: number; y: number; speed: number; spin: number }
  | { type: "ship"; jar: number; slot: number; color: number; points: number; mult: number; streak: number }
  | { type: "dock"; jar: number; slot: number; color: number; rush: boolean }
  | { type: "jump"; peg: number; jar: number; slot: number }
  | { type: "tier"; mult: number; streak: number }
  | { type: "save"; why: "safe" | "grace" | "magnet" | "hand"; color: number }
  | { type: "earn"; what: "magnet" | "slot" }
  | { type: "clear"; wall: number; points: number; time: number }
  | { type: "deal"; wall: number }
  | { type: "over"; why: Ending; peg: number };

export interface RunStats {
  walls: number;
  ships: number;
  drops: number;
  pulls: number;
  coveredTaps: number;
  /** Pegs that went to the shelf, and the most that sat there at once. */
  shelved: number;
  peakShelf: number;
  saves: number;
  magnetsUsed: number;
  bestStreak: number;
  bestMult: number;
  fancy: number;
  seconds: number;
  /** Seconds a magnet was held and the shelf had four or more on it. */
  magnetIdle: number;
}

/** Each run's walls come from the launch seed and the run number. */
export const runSeed = (seed: number, run: number): number => (seed ^ Math.imul(run + 1, 0x9e3779b1)) >>> 0;
const wallSeed = (seed: number, n: number): number => (seed ^ Math.imul(n, 0x85ebca77) ^ 0x51ed) >>> 0;

export class Run {
  readonly seed: number;
  t = 0;
  clock: number = TUNE.clock;
  wallNo = 0;
  deal!: Deal;
  wall!: Wall;
  phys!: Physics;
  /** 1 while the peg is in the wall. */
  left!: Uint8Array;
  /** Pegs left in each dish. */
  count!: Int8Array;
  docks: Array<Jar | null> = [];
  rush: Jar[] = [];
  /** Next jar of the line-up to arrive, and the ones that were rushed in out of turn. */
  qi = 0;
  rushed = new Set<number>();
  shelf: Array<{ peg: number; color: number }> = [];
  shelfCap: number = SHELF;
  score = 0;
  streak = 0;
  mult = 1;
  sinceHit = Infinity;
  magnets = 0;
  slotEarned = false;
  graceUsed = false;
  /** Seconds left in the pause between walls. */
  pause = 0;
  over: Ending | null = null;
  events: RunEvent[] = [];
  stats: RunStats = { walls: 0, ships: 0, drops: 0, pulls: 0, coveredTaps: 0, shelved: 0, peakShelf: 0, saves: 0, magnetsUsed: 0, bestStreak: 0, bestMult: 1, fancy: 0, seconds: 0, magnetIdle: 0 };
  /** Physics time not yet stepped, and how far into the next step we are (for drawing). */
  private acc = 0;
  /** The next wall, dealt a little at a time. */
  private next: { n: number; gen: Generator<void, Deal>; deal: Deal | null } | null = null;

  constructor(seed: number, opts: { clock?: number } = {}) {
    this.seed = seed >>> 0;
    if (opts.clock) this.clock = opts.clock;
    this.hangWall(this.dealNow(1));
  }

  get live(): boolean {
    return this.over === null;
  }

  /** Seconds the clock burns per second right now. */
  get burn(): number {
    return 1 + (this.t / TUNE.burnScale) ** TUNE.burnPow;
  }

  /** Fraction of the way to the next physics step (for drawing between steps). */
  get alpha(): number {
    return this.acc / STEP;
  }

  get pegsLeft(): number {
    let n = 0;
    for (const v of this.left) n += v;
    return n;
  }

  /** The jar the next arrival will be (null when the line-up is done). */
  upcoming(k = 0): number | null {
    let i = this.qi;
    let seen = 0;
    for (; i < this.deal.queue.length; i++) {
      if (this.rushed.has(i)) continue;
      if (seen++ === k) return this.deal.queue[i]!;
    }
    return null;
  }

  // -----------------------------------------------------------------------------------------------------------
  // Dealing
  // -----------------------------------------------------------------------------------------------------------

  private dealNow(n: number): Deal {
    if (this.next && this.next.n === n) {
      while (!this.next.deal) {
        const r = this.next.gen.next();
        if (r.done) this.next.deal = r.value;
      }
      return this.next.deal;
    }
    const gen = dealSteps(planFor(n), createRng(wallSeed(this.seed, n)));
    for (;;) {
      const r = gen.next();
      if (r.done) return r.value;
    }
  }

  /** Deals the next wall ahead of time, a step at a time, for up to `ms` milliseconds. Same result as dealing it at once. */
  prepare(ms: number, now: () => number = () => performance.now()): void {
    const n = this.wallNo + 1;
    if (!this.next || this.next.n !== n) this.next = { n, gen: dealSteps(planFor(n), createRng(wallSeed(this.seed, n))), deal: null };
    if (this.next.deal) return;
    const t0 = now();
    while (!this.next.deal && now() - t0 < ms) {
      const r = this.next.gen.next();
      if (r.done) this.next.deal = r.value;
    }
  }

  private hangWall(deal: Deal): void {
    this.wallNo++;
    this.deal = deal;
    this.wall = deal.wall;
    this.phys = new Physics(deal.wall);
    this.left = new Uint8Array(deal.wall.pegs.length).fill(1);
    this.count = Int8Array.from(deal.wall.dishes.map((d) => d.pegs.length));
    this.qi = 0;
    this.rushed = new Set();
    this.rush = [];
    this.docks = [];
    for (let k = 0; k < DOCKS; k++) {
      const c = this.nextJar();
      this.docks.push(c);
    }
    this.next = null;
  }

  private nextJar(): Jar | null {
    const q = this.deal.queue;
    while (this.qi < q.length && this.rushed.has(this.qi)) this.qi++;
    if (this.qi >= q.length) return null;
    const id = this.qi++;
    return { id, color: q[id]!, n: 0, rush: false };
  }

  // -----------------------------------------------------------------------------------------------------------
  // Time
  // -----------------------------------------------------------------------------------------------------------

  step(dt: number): RunEvent[] {
    const out = this.events;
    this.acc += dt;
    while (this.acc >= STEP) {
      this.acc -= STEP;
      for (const e of this.phys.step()) out.push(e);
    }
    if (!this.live) return out;
    if (this.pause > 0) {
      this.pause -= dt;
      if (this.pause <= 0) {
        this.pause = 0;
        this.hangWall(this.dealNow(this.wallNo + 1));
        out.push({ type: "deal", wall: this.wallNo });
      }
      return out;
    }
    this.t += dt;
    this.stats.seconds = this.t;
    this.sinceHit += dt;
    if (this.sinceHit > TUNE.streakWindow) {
      this.streak = 0;
      this.mult = 1;
    }
    if (this.magnets > 0 && this.shelf.length >= this.shelfCap - 1) this.stats.magnetIdle += dt;
    this.clock -= dt * this.burn;
    if (this.clock <= 0) {
      this.clock = 0;
      this.over = "time";
      out.push({ type: "over", why: "time", peg: -1 });
    }
    return out;
  }

  // -----------------------------------------------------------------------------------------------------------
  // Pegs
  // -----------------------------------------------------------------------------------------------------------

  /** Dishes on higher layers covering peg `id` right now (as they hang or swing this instant). */
  coveredBy(id: number): number[] {
    const peg = this.wall.pegs[id]!;
    const own = this.wall.dishes[peg.dish]!;
    const out: number[] = [];
    for (const d of this.wall.dishes) {
      if (d.layer <= own.layer || this.count[d.id]! <= 0) continue;
      const b = this.phys.bodies[d.id]!;
      if (b.state === "falling" || b.state === "gone") continue;
      if (sdfAt(d.shape, b.pose, peg.x, peg.y) < PEG_R) out.push(d.id);
    }
    return out;
  }

  isFree(id: number): boolean {
    return this.left[id] === 1 && this.coveredBy(id).length === 0;
  }

  /** Pegs that can be pulled this instant. */
  freePegs(): number[] {
    const out: number[] = [];
    for (let i = 0; i < this.left.length; i++) if (this.left[i] && this.coveredBy(i).length === 0) out.push(i);
    return out;
  }

  /** The open jar a peg of `color` would go into (the earliest in the line-up), as [jar, slot] with slot DOCKS+k for rushes. */
  jarFor(color: number): { jar: Jar; slot: number } | null {
    let best: { jar: Jar; slot: number } | null = null;
    this.docks.forEach((j, slot) => {
      if (j && j.color === color && j.n < 3 && (!best || j.id < best.jar.id)) best = { jar: j, slot };
    });
    this.rush.forEach((j, k) => {
      if (j.color === color && j.n < 3 && (!best || j.id < best.jar.id)) best = { jar: j, slot: DOCKS + k };
    });
    return best;
  }

  /** Pulls peg `id` if it's free. */
  tap(id: number): RunEvent[] {
    const out = this.events;
    if (!this.live || this.pause > 0 || !this.left[id]) return out;
    const by = this.coveredBy(id);
    if (by.length) {
      this.stats.coveredTaps++;
      out.push({ type: "covered", peg: id, by });
      return out;
    }
    const color = this.wall.pegs[id]!.color;
    if (!this.jarFor(color) && this.shelf.length >= this.shelfCap) {
      // Nowhere to go: the danger.
      const why = this.t < TUNE.safeStart ? "safe" : !this.graceUsed && this.t < TUNE.graceUntil ? "grace" : this.magnets > 0 ? "magnet" : null;
      if (!why || !this.rushIn(color, why)) {
        this.over = "full";
        out.push({ type: "over", why: "full", peg: id });
        return out;
      }
      if (why === "grace") this.graceUsed = true;
      if (why === "magnet") this.magnets--;
      this.stats.saves++;
    }
    this.pull(id, color);
    return out;
  }

  /** Uses a held magnet by hand: the jar the shelf needs most is rushed in. */
  useMagnet(): RunEvent[] {
    if (!this.live || this.pause > 0 || this.magnets <= 0 || this.shelf.length === 0) return this.events;
    if (this.rushIn(-1, "hand")) {
      this.magnets--;
      this.stats.magnetsUsed++;
    }
    return this.events;
  }

  private pull(id: number, color: number): void {
    const out = this.events;
    this.left[id] = 0;
    this.stats.pulls++;
    this.score += TUNE.pullPoints;
    const dish = this.wall.dishes[this.wall.pegs[id]!.dish]!;
    const j = this.jarFor(color);
    if (j) {
      j.jar.n++;
      out.push({ type: "pull", peg: id, color, dest: { to: "jar", jar: j.jar.id, slot: j.slot } });
    } else {
      this.shelf.push({ peg: id, color });
      this.stats.shelved++;
      this.stats.peakShelf = Math.max(this.stats.peakShelf, this.shelf.length);
      out.push({ type: "pull", peg: id, color, dest: { to: "shelf", index: this.shelf.length - 1 } });
    }
    // The dish loses a peg: it swings on the last one, or drops.
    const n = --this.count[dish.id]!;
    if (n === 1) {
      const k = dish.pegs.findIndex((p) => this.left[p]);
      this.phys.hang(dish, k);
      out.push({ type: "swing", dish: dish.id });
    } else if (n === 0) {
      this.phys.drop(dish);
      this.hit();
      const pts = (dish.fancy ? TUNE.fancyPoints : TUNE.dropPoints) * this.mult;
      this.score += pts;
      this.addClock(TUNE.dropTime);
      this.stats.drops++;
      if (dish.fancy) this.stats.fancy++;
      out.push({ type: "drop", dish: dish.id, points: pts, mult: this.mult, fancy: dish.fancy });
    }
    if (j && j.jar.n >= 3) this.ship(j.slot);
    if (this.pegsLeft === 0) this.clearWall();
  }

  /** A shipment or a smash: the streak grows if the last one was recent, and the multiplier follows it. */
  private hit(): void {
    this.streak = this.sinceHit <= TUNE.streakWindow ? this.streak + 1 : 1;
    this.sinceHit = 0;
    this.stats.bestStreak = Math.max(this.stats.bestStreak, this.streak);
    const m = multiplier(this.streak);
    if (m > this.mult) {
      this.mult = m;
      this.stats.bestMult = Math.max(this.stats.bestMult, m);
      this.events.push({ type: "tier", mult: m, streak: this.streak });
      if (m >= TUNE.slotTier && !this.slotEarned) {
        this.slotEarned = true;
        this.shelfCap++;
        this.events.push({ type: "earn", what: "slot" });
      }
    } else this.mult = m;
  }

  private ship(slot: number): void {
    const out = this.events;
    const jar = slot < DOCKS ? this.docks[slot]! : this.rush[slot - DOCKS]!;
    this.hit();
    const pts = TUNE.shipPoints * this.mult;
    this.score += pts;
    this.addClock(TUNE.shipTime);
    this.stats.ships++;
    out.push({ type: "ship", jar: jar.id, slot, color: jar.color, points: pts, mult: this.mult, streak: this.streak });
    if (slot >= DOCKS) {
      this.rush.splice(slot - DOCKS, 1);
      return;
    }
    const next = this.nextJar();
    this.docks[slot] = next;
    if (!next) return;
    out.push({ type: "dock", jar: next.id, slot, color: next.color, rush: false });
    this.fillFromShelf(next, slot);
  }

  /** Pegs of the jar's colour waiting on the shelf jump into it, oldest first. */
  private fillFromShelf(jar: Jar, slot: number): void {
    for (let i = 0; i < this.shelf.length && jar.n < 3; ) {
      const s = this.shelf[i]!;
      if (s.color !== jar.color) {
        i++;
        continue;
      }
      this.shelf.splice(i, 1);
      jar.n++;
      this.events.push({ type: "jump", peg: s.peg, jar: jar.id, slot });
    }
    if (jar.n >= 3) this.ship(slot);
  }

  /**
   * Rushes in, out of turn, the next jar of the colour the shelf needs most (counting the peg in hand, `color`), and
   * fills it from the shelf. Returns false if no such jar is left in the line-up.
   */
  private rushIn(color: number, why: "safe" | "grace" | "magnet" | "hand"): boolean {
    const q = this.deal.queue;
    let best = -1;
    let bestScore = 0;
    for (let i = this.qi; i < q.length; i++) {
      if (this.rushed.has(i)) continue;
      const c = q[i]!;
      const score = this.shelf.filter((s) => s.color === c).length + (c === color ? 1 : 0);
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }
    if (best < 0) return false;
    this.rushed.add(best);
    const jar: Jar = { id: best, color: q[best]!, n: 0, rush: true };
    this.rush.push(jar);
    const slot = DOCKS + this.rush.length - 1;
    this.events.push({ type: "save", why, color: jar.color });
    this.events.push({ type: "dock", jar: jar.id, slot, color: jar.color, rush: true });
    this.fillFromShelf(jar, slot);
    return true;
  }

  private addClock(s: number): void {
    this.clock = Math.min(TUNE.clockMax, this.clock + s);
  }

  private clearWall(): void {
    const n = this.wallNo;
    const time = Math.max(TUNE.wallTimeMin, TUNE.wallTime - TUNE.wallTimeStep * (n - 1));
    const pts = TUNE.wallPoints * n + Math.round(this.clock) * TUNE.clockPoints;
    this.score += pts;
    this.addClock(time);
    this.stats.walls++;
    this.pause = TUNE.dealPause;
    this.events.push({ type: "clear", wall: n, points: pts, time });
    if (n % 2 === 0 && this.magnets < TUNE.magnetsMax) {
      this.magnets++;
      this.events.push({ type: "earn", what: "magnet" });
    }
  }
}

/** A seeded helper for code that wants randomness tied to a run (the pilot, effects). */
export const rngFor = (run: Run, salt: number): Rng => createRng((run.seed ^ salt) >>> 0);
