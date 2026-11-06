/**
 * The rules of a run, pure and deterministic from a seed: the tin, the sourdough starter rising under the pile, the
 * pinch (what you hold and what comes next), merges, chains, points, and spilling over the rim.
 *
 * The pressure: the starter at the bottom of the tin rises all the time, faster as the run goes on, and lifts the
 * whole pile toward the rim. Every merge knocks it back down (bakers "knock back" risen dough), and the bigger the
 * bake and the longer the chain, the harder the knock. A piece that sits above the rim starts a three-second grace
 * countdown; if the pile is still over when it runs out, the tin spills and the run ends.
 */
import { createRng, type Rng } from "@thumbcade-games/kit/rng";
import { STEP, World } from "./physics.ts";
import { radius, TIERS, TOP } from "./tiers.ts";

export const TIN_W = 10;
/** Height of the tin's rim above its bottom. */
export const RIM = 13;
/** Where the pinched piece hangs before it drops (its centre). */
export const HOLD_Y = RIM + 1.75;
/** The starter's surface at the start, and the lowest a knock-back can push it. */
export const FLOOR0 = 0.55;
/** Seconds the pile may sit over the rim before it spills. */
export const GRACE = 3;
/** Seconds from one drop until the next piece is ready in the pinch. */
export const COOLDOWN = 0.3;
/** A freshly merged piece may merge again after this long (a beat to read the chain). */
const CHAIN_BEAT = 0.07;
/** A merge counts as part of a chain if the piece that merged was itself made this recently. */
const CHAIN_WINDOW = 1.1;
/** Two pieces this close (beyond touching) still merge. */
const MERGE_SLACK = 0.03;
/** A dropped piece only counts against the rim once it has been in the tin this long. */
const RIM_GRACE_AGE = 0.7;

/** The starter's rise speed in tin units per second, `t` seconds into a run. */
export function riseRate(t: number): number {
  return 0.07 + 0.0085 * t;
}

/** How far a merge that makes `tier` (1-8) knocks the starter back, before the chain bonus. */
export const KNOCK = [0, 0.1, 0.16, 0.24, 0.34, 0.46, 0.62, 0.84, 1.2] as const;
/** Each extra link in a chain knocks this much harder. */
export const CHAIN_KNOCK = 0.3;

/** Points for making `tier`: 10, 30, 60, 100 … 360, times the chain. */
export const points = (tier: number): number => (10 * tier * (tier + 1)) / 2;
/** Extra points for baking the party cake (two pies), the jackpot. */
export const CAKE_BONUS = 1000;
/** Points for the showstopper (two party cakes leave the tin together), times the chain. */
export const SHOWSTOPPER = 3000;
/** Bonus the first time a run makes a tier from the donut up. */
export const firstBonus = (tier: number): number => (tier >= 4 ? 25 * tier : 0);

/** The first drops of every run: two pearls side by side make the first merge almost by themselves. */
const OPENER = [0, 0, 1, 0, 1, 2, 0] as const;

/** Drop weights for tiers 0-4, early and late in a run (bigger lumps come out of the bag as it goes on). */
const EARLY = [0.4, 0.32, 0.2, 0.08, 0];
const LATE = [0.2, 0.25, 0.25, 0.19, 0.11];

export type RunEvent =
  | { type: "drop"; id: number; tier: number; x: number }
  | {
      type: "merge";
      id: number;
      tier: number;
      x: number;
      y: number;
      /** Where the two pieces that merged were. */
      ax: number;
      ay: number;
      bx: number;
      by: number;
      chain: number;
      pts: number;
      knock: number;
      first: boolean;
      bonus: number;
    }
  | { type: "showstopper"; x: number; y: number; chain: number; pts: number }
  | { type: "danger"; on: boolean }
  | { type: "grace"; left: number }
  | { type: "over"; reason: "pile" | "dough" };

export interface RunStats {
  drops: number;
  merges: number;
  biggestChain: number;
  /** Highest tier made or dropped this run. */
  highest: number;
  /** Party cakes baked (two pies), and showstoppers (two party cakes). */
  cakes: number;
  showstoppers: number;
  /** How far merges knocked the starter back in all. */
  knocked: number;
  /** Seconds spent with the pile over the rim. */
  overTime: number;
  /** Times the grace countdown started. */
  scares: number;
  /** Most points one drop set going. */
  bestDrop: number;
}

export interface RunOptions {
  /** Attract mode: the starter doesn't rise and nothing spills; `fullness()` tells the demo when to empty the tin. */
  attract?: boolean;
  /** Where the starter's surface begins (attract mode shows it risen a little, face and all). */
  floor?: number;
}

export class Run {
  readonly world = new World(TIN_W);
  readonly rng: Rng;
  readonly attract: boolean;
  phase: "play" | "over" = "play";
  elapsed = 0;
  score = 0;
  /** Tier in the pinch, and the one after it. */
  held = 0;
  next = 0;
  /** Where the pinch is, in tin units (clamped so the held piece fits). */
  aimX = TIN_W / 2;
  /** Seconds until the pinch holds a piece again. */
  cooldown = 0;
  /** Where the starter is heading; the surface follows it (the world's floor). */
  floorTarget = FLOOR0;
  /** Seconds the pile has been over the rim (it drains when the pile drops back). */
  danger = 0;
  dangerOn = false;
  /** Height of the highest settled piece's top (for the rim's glow). */
  pileTop = 0;
  readonly events: RunEvent[] = [];
  readonly stats: RunStats = { drops: 0, merges: 0, biggestChain: 0, highest: 0, cakes: 0, showstoppers: 0, knocked: 0, overTime: 0, scares: 0, bestDrop: 0 };
  /** Tiers made at least once this run. */
  readonly made: boolean[] = TIERS.map(() => false);
  /** Called after every fixed step (the game reads impacts here). */
  afterStep: (() => void) | null = null;
  private acc = 0;
  private dropIndex = 0;
  private lastGrace = 0;
  /** Points scored since the last drop (for "best drop"). */
  private dropPts = 0;

  constructor(seed: number, o: RunOptions = {}) {
    this.rng = createRng(seed);
    this.attract = !!o.attract;
    this.floorTarget = this.world.floor = o.floor ?? FLOOR0;
    this.held = this.draw();
    this.next = this.draw();
  }

  get canDrop(): boolean {
    return this.phase === "play" && this.cooldown <= 0;
  }

  /** Seconds the grace countdown has left (GRACE when the pile is clear). */
  get graceLeft(): number {
    return Math.max(0, GRACE - this.danger);
  }

  /** Aims the pinch; the held piece always fits between the walls. */
  aim(x: number): void {
    const r = radius(this.held);
    this.aimX = Math.min(TIN_W - r, Math.max(r, x));
  }

  /** Lets go of the held piece. Returns its body id, or 0 if the pinch is still empty. */
  drop(): number {
    if (!this.canDrop) return 0;
    const tier = this.held;
    const r = radius(tier);
    const i = this.world.add(tier, this.aimX, HOLD_Y, r);
    if (i < 0) return 0;
    this.world.vy[i] = -1.5;
    const id = this.world.id[i]!;
    this.held = this.next;
    this.next = this.draw();
    this.aim(this.aimX);
    this.cooldown = COOLDOWN;
    this.stats.drops++;
    this.stats.highest = Math.max(this.stats.highest, tier);
    this.dropPts = 0;
    this.events.push({ type: "drop", id, tier, x: this.aimX });
    return id;
  }

  /** Advances by `dt` seconds in fixed steps. */
  update(dt: number): void {
    this.acc += dt;
    while (this.acc >= STEP) {
      this.acc -= STEP;
      this.fixed();
    }
  }

  /** How far the current frame is between the last step and the next (for smooth drawing). */
  get alpha(): number {
    return this.acc / STEP;
  }

  /** 0-1: how full the tin looks (the top of the pile against the rim, from where the starter is). */
  fullness(): number {
    return Math.min(1, Math.max(0, (this.pileTop - this.world.floor) / (RIM - this.world.floor)));
  }

  private draw(): number {
    const k = this.dropIndex++;
    if (k < OPENER.length) return OPENER[k]!;
    const u = Math.min(1, this.elapsed / 50);
    let total = 0;
    for (let t = 0; t < EARLY.length; t++) total += EARLY[t]! + (LATE[t]! - EARLY[t]!) * u;
    let pick = this.rng() * total;
    for (let t = 0; t < EARLY.length; t++) {
      pick -= EARLY[t]! + (LATE[t]! - EARLY[t]!) * u;
      if (pick < 0) return t;
    }
    return 0;
  }

  private fixed(): void {
    const w = this.world;
    if (this.phase === "play") {
      this.elapsed += STEP;
      this.cooldown -= STEP;
      if (!this.attract) this.floorTarget += riseRate(this.elapsed) * STEP;
    }
    // The surface follows its target: it rises steadily and slumps quickly after a knock.
    const gap = this.floorTarget - w.floor;
    const floorTo = Math.max(FLOOR0, w.floor + gap * (gap < 0 ? 0.07 : 0.5));
    w.step(floorTo);
    this.merges();
    this.checkRim();
    this.afterStep?.();
  }

  private merges(): void {
    const w = this.world;
    for (let guard = 0; guard < 8; guard++) {
      let found = false;
      outer: for (let i = 0; i < w.n; i++) {
        const t = w.tier[i]!;
        if (w.chain[i]! > 0 && w.age[i]! < CHAIN_BEAT) continue;
        for (let j = i + 1; j < w.n; j++) {
          if (w.tier[j] !== t || (w.chain[j]! > 0 && w.age[j]! < CHAIN_BEAT)) continue;
          const dx = w.x[j]! - w.x[i]!;
          const dy = w.y[j]! - w.y[i]!;
          const rr = w.r[i]! + w.r[j]! + MERGE_SLACK;
          if (dx * dx + dy * dy > rr * rr) continue;
          this.merge(i, j);
          found = true;
          break outer;
        }
      }
      if (!found) return;
    }
  }

  private merge(i: number, j: number): void {
    const w = this.world;
    const t = w.tier[i]!;
    const fresh = (k: number) => (w.chain[k]! > 0 && w.age[k]! < CHAIN_WINDOW ? w.chain[k]! : 0);
    const chain = Math.max(fresh(i), fresh(j)) + 1;
    // The contact point: equal sizes meet halfway.
    const x = (w.x[i]! + w.x[j]!) / 2;
    const y = (w.y[i]! + w.y[j]!) / 2;
    const ax = w.x[i]!;
    const ay = w.y[i]!;
    const bx = w.x[j]!;
    const by = w.y[j]!;
    const vx = (w.vx[i]! + w.vx[j]!) * 0.25;
    const vy = (w.vy[i]! + w.vy[j]!) * 0.25;
    w.remove(Math.max(i, j));
    w.remove(Math.min(i, j));
    this.stats.merges++;
    this.stats.biggestChain = Math.max(this.stats.biggestChain, chain);
    if (t >= TOP) {
      const pts = SHOWSTOPPER * chain;
      this.addPoints(pts);
      this.stats.showstoppers++;
      // Two party cakes leave the tin together, and the starter is punched all the way down.
      const knock = this.floorTarget - FLOOR0;
      this.stats.knocked += knock;
      this.floorTarget = FLOOR0;
      this.events.push({ type: "showstopper", x, y, chain, pts });
      return;
    }
    const tier = t + 1;
    const k = w.add(tier, x, y, radius(t) * 1.02, radius(tier), 0.14);
    if (k < 0) return;
    w.vx[k] = vx;
    w.vy[k] = vy;
    w.chain[k] = chain;
    w.landed[k] = 1;
    const first = !this.made[tier];
    this.made[tier] = true;
    if (tier === TOP) this.stats.cakes++;
    const bonus = (first ? firstBonus(tier) : 0) + (tier === TOP ? CAKE_BONUS : 0);
    const pts = points(tier) * chain + bonus;
    this.addPoints(pts);
    this.stats.highest = Math.max(this.stats.highest, tier);
    const knock = this.attract ? 0 : Math.min(this.floorTarget - FLOOR0, KNOCK[tier]! * (1 + CHAIN_KNOCK * (chain - 1)));
    this.floorTarget -= knock;
    this.stats.knocked += knock;
    this.events.push({ type: "merge", id: w.id[k]!, tier, x, y, ax, ay, bx, by, chain, pts, knock, first, bonus });
  }

  private addPoints(pts: number): void {
    if (this.attract) return;
    this.score += pts;
    this.dropPts += pts;
    this.stats.bestDrop = Math.max(this.stats.bestDrop, this.dropPts);
  }

  private checkRim(): void {
    const w = this.world;
    let top = w.floor;
    let over = false;
    for (let i = 0; i < w.n; i++) {
      if (!w.landed[i] || w.age[i]! < RIM_GRACE_AGE) continue;
      const t = w.y[i]! + w.r[i]!;
      if (t > top) top = t;
      if (t > RIM) over = true;
    }
    this.pileTop = top;
    if (this.phase !== "play" || this.attract) return;
    const dough = w.floor > RIM - 0.3;
    if (over || dough) {
      this.danger += STEP;
      this.stats.overTime += STEP;
    } else this.danger = Math.max(0, this.danger - STEP * 1.5);
    const on = this.danger > 0 && (over || dough);
    if (on !== this.dangerOn) {
      this.dangerOn = on;
      if (on) this.stats.scares++;
      this.events.push({ type: "danger", on });
    }
    const left = Math.ceil(this.graceLeft);
    if (this.dangerOn && left !== this.lastGrace && left > 0) this.events.push({ type: "grace", left });
    this.lastGrace = this.dangerOn ? left : 0;
    if (this.danger >= GRACE) {
      this.phase = "over";
      this.events.push({ type: "over", reason: over ? "pile" : "dough" });
    }
  }
}

/** Each run's seed from the launch seed and the run number (never from how long attract mode ran). */
export function runSeed(seed: number, run: number): number {
  return (Math.imul((seed >>> 0) ^ 0x5bd1e995, 2654435761) + run * 0x9e3779b9) >>> 0;
}
