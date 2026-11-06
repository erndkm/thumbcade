/**
 * A run: racks against the clock. A strike resets the rack at once and buys the most time; otherwise the second ball
 * goes at what's left, and the rack resets after it either way. Consecutive strikes build the chain (×2 double,
 * ×3 turkey, ×4 hambone, ×5 five-bagger) that multiplies everything; a spare or an open frame ends it.
 */
import { clamp } from "@thumbcade-games/kit/ease";
import type { Rng } from "@thumbcade-games/kit/rng";
import { PIN_COUNT } from "./lane.ts";
import { FULL_RACK, isSplit, leaveName, type Throw } from "./pins.ts";

export const START_CLOCK = 22;
export const MAX_CLOCK = 32;
/** The last seconds: every pin counts double. */
export const CLUTCH_T = 6;
/** Racks with bumpers up (the first ones), so nobody's first balls go in the gutter. */
export const BUMPER_RACKS = 2;
/** Every fifth rack glows: double points, and its strike pays more time. */
export const GLOW_EVERY = 5;
export const MAX_MULT = 5;

/** Seconds of a ball's life the game also uses, so headless runs pace exactly like the real thing. */
export const FIRST_BALL_T = 0.55;
/** After the result is decided: let the pins finish falling, then the sweep. */
export const HOLD_T = { strike: 0.95, spare: 0.85, other: 0.6 } as const;
/** The sweep and re-spot (the clock waits). */
export const RESET_T = 0.5;

export const CHAIN_NAMES: Record<number, string> = { 1: "STRIKE", 2: "DOUBLE", 3: "TURKEY", 4: "HAMBONE", 5: "FIVE-BAGGER" };
export const chainName = (n: number): string => CHAIN_NAMES[Math.min(n, 5)] ?? (n >= 6 ? `${n} IN A ROW` : "STRIKE");

export type AwardKind = "strike" | "spare" | "open" | "leave" | "gutter" | "mulligan";

export interface Award {
  kind: AwardKind;
  pins: number;
  points: number;
  /** Seconds back on the clock. */
  refill: number;
  mult: number;
  chain: number;
  /** The chain reached a new named level. */
  tierUp: boolean;
  /** The first ball left a split (ball 1), or the second ball converted one (ball 2). */
  split: boolean;
  converted: boolean;
  leave: string;
  clutch: boolean;
  glow: boolean;
  buzzer: boolean;
  /** Pins the second ball didn't get (open frames), for the "so close" moments. */
  left: number;
  tags: string[];
}

/** Seconds per second, faster the longer you last. */
export function drainAt(t: number): number {
  return Math.min(2.6, 1 + (t / 66) ** 1.5);
}

export class Run {
  clock = START_CLOCK;
  t = 0;
  score = 0;
  rack = 0;
  ball = 1;
  standing: boolean[] = [...FULL_RACK];
  chain = 0;
  bestChain = 0;
  strikes = 0;
  spares = 0;
  opens = 0;
  splits = 0;
  converted = 0;
  gutters = 0;
  balls = 0;
  pins = 0;
  mulligan = true;
  buzzer = false;
  /** Leaves after ball 1 that the second ball didn't finish: aim-related hints. */
  missedSpares = 0;
  headOn = 0;
  bestRack = 0;
  rackPoints = 0;
  best: { points: number; label: string } | null = null;
  /** The pinsetter's imprecision for the current rack (±1 per pin and axis). */
  jitter = new Float64Array(PIN_COUNT * 2);

  constructor(private readonly rng?: Rng) {
    this.newJitter();
  }

  get mult(): number {
    return clamp(this.chain, 1, MAX_MULT);
  }
  get clutch(): boolean {
    return !this.buzzer && this.clock <= CLUTCH_T;
  }
  get glow(): boolean {
    return this.rack % GLOW_EVERY === GLOW_EVERY - 1;
  }
  get bumpers(): boolean {
    return this.rack < BUMPER_RACKS;
  }

  private newJitter(): void {
    for (let i = 0; i < this.jitter.length; i++) this.jitter[i] = this.rng ? this.rng() * 2 - 1 : 0;
  }

  /** Advances the clock; returns true on the frame it runs out. */
  tick(dt: number, frozen: boolean): boolean {
    if (this.buzzer) return false;
    if (!frozen) {
      this.t += dt;
      this.clock -= dt * drainAt(this.t);
    }
    if (this.clock <= 0) {
      this.clock = 0;
      this.buzzer = true;
      return true;
    }
    return false;
  }

  /** Scores a finished throw and sets up the next ball. `buzzer`: the clock ran out while it was rolling. */
  settle(th: Throw, buzzer = false): Award {
    this.balls++;
    const clutch = this.clock <= CLUTCH_T || buzzer;
    const glow = this.glow;
    const before = this.standing;
    const pins = th.knocked;
    this.pins += pins;
    const tags: string[] = [];
    const a: Award = { kind: "open", pins, points: 0, refill: 0, mult: 1, chain: this.chain, tierUp: false, split: false, converted: false, leave: "", clutch, glow, buzzer, left: 0, tags };
    const full = before.every((s) => s);
    const boost = (clutch ? 2 : 1) * (glow ? 2 : 1);

    // A gutter ball off a full rack, the first time with no bumpers: it doesn't count.
    if (full && this.ball === 1 && pins === 0 && th.gutter && this.mulligan && !this.bumpers && !buzzer) {
      this.mulligan = false;
      this.gutters++;
      a.kind = "mulligan";
      return a;
    }
    if (th.gutter) this.gutters++;
    if (full && Math.abs(th.entryX) < 0.025 && !th.gutter) this.headOn++;

    if (this.ball === 1 && pins === PIN_COUNT) {
      // Strike.
      const prevLevel = Math.min(this.chain, MAX_MULT);
      this.chain++;
      this.bestChain = Math.max(this.bestChain, this.chain);
      this.strikes++;
      a.kind = "strike";
      a.chain = this.chain;
      a.mult = this.mult;
      a.tierUp = this.chain >= 2 && Math.min(this.chain, MAX_MULT) > prevLevel;
      a.points = (pins * 10 + 200) * a.mult * boost + (this.chain === 3 ? 500 : 0);
      a.refill = (5.2 - Math.min(2.1, this.rack * 0.15)) * (glow ? 1.25 : 1) + Math.min(4, this.chain - 1) * 0.45 + (this.chain === 3 ? 1.5 : 0);
      tags.push(chainName(this.chain));
      if (glow) tags.push("GLOW RACK");
      this.nextRack();
    } else if (this.ball === 1) {
      // Pins left standing: the second ball goes at them.
      a.mult = this.mult;
      a.points = pins * 10 * a.mult * boost;
      a.refill = pins * 0.1;
      a.kind = pins === 0 ? "gutter" : "leave";
      this.standing = [...th.after];
      a.leave = leaveName(this.standing);
      a.split = isSplit(this.standing);
      if (a.split) this.splits++;
      this.ball = 2;
    } else {
      const wasSplit = isSplit(before);
      const cleared = th.after.every((s) => !s);
      a.mult = this.mult;
      if (cleared) {
        this.spares++;
        a.kind = "spare";
        a.converted = wasSplit;
        const bigOne = wasSplit && before[6] && before[9] && before.filter(Boolean).length === 2;
        a.points = (pins * 10 + 150 + (wasSplit ? (bigOne ? 1500 : 500) : 0)) * boost;
        a.refill = 3.3 + (wasSplit ? 3 : 0) + pins * 0.1;
        tags.push(wasSplit ? (bigOne ? "THE BIG ONE" : "SPLIT CONVERTED") : "SPARE");
        if (wasSplit) this.converted++;
      } else {
        this.opens++;
        this.missedSpares++;
        a.kind = pins === 0 ? "gutter" : "open";
        a.points = pins * 10 * boost;
        a.refill = pins * 0.1;
        a.left = th.after.filter(Boolean).length;
      }
      // A spare or an open frame ends a strike chain.
      this.chain = 0;
      this.nextRack();
    }
    if (clutch) tags.push("CLUTCH ×2");
    a.buzzer = buzzer;
    this.score += a.points;
    this.rackPoints += a.points;
    if (this.ball === 1) {
      this.bestRack = Math.max(this.bestRack, this.rackPoints);
      this.rackPoints = 0;
    }
    if (!this.best || a.points > this.best.points) {
      if (a.kind === "strike" || a.kind === "spare") this.best = { points: a.points, label: tags[0] ?? "" };
    }
    if (!buzzer) this.clock = Math.min(MAX_CLOCK, this.clock + a.refill);
    return a;
  }

  private nextRack(): void {
    this.rack++;
    this.ball = 1;
    this.standing = [...FULL_RACK];
    this.newJitter();
  }

  /** One thing to try next time, picked from how the run went. */
  hint(): string {
    if (this.balls <= 2) return "FLICK UP THE LANE. CURVE YOUR SWIPE TO HOOK IT.";
    if (this.gutters >= 2) return "AIM A LITTLE INSIDE THE ARROWS. THE HOOK DOES THE REST.";
    if (this.headOn >= 2 && this.strikes < this.headOn) return "HEAD-ON HITS SPLIT. HOOK INTO THE POCKET BESIDE THE HEAD PIN.";
    if (this.missedSpares >= 3 && this.spares < this.missedSpares) return "SPARES: THROW STRAIGHT AT THE FRONT PIN OF WHAT'S LEFT.";
    if (this.strikes === 0) return "CURVE YOUR SWIPE: A HOOKED BALL CARRIES MORE PINS.";
    if (this.bestChain < 3) return "THREE STRIKES IN A ROW IS A TURKEY: ×3 AND BONUS TIME.";
    return "STRIKES BUY THE MOST TIME. KEEP THE CHAIN GOING.";
  }
}
