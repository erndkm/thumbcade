/**
 * The pilot: a player model that plays the attract demo, the QA autoplay builds and the headless runs that
 * measure run lengths (scripts/pilot.ts, test/pilot.test.ts). It only sees what a player sees (the placed digits,
 * the pencil marks once they are out, the nudge once it shows), it taps through `Controls` like a player, and it
 * is slower on moves that are harder to read.
 *
 * For each move it looks at every single on the board and notices each one after a random time that grows with
 * how hard the technique is; the first one noticed is the move. With nothing visible it needs the harder
 * techniques (good players find them slowly, novices wait for the nudge or a lamp).
 */
import type { Rng } from "@thumbcade-games/kit/rng";
import { candidates, digitsOf } from "./grid.ts";
import { Controls, type Target } from "./controls.ts";
import { type Run, TUNE } from "./run.ts";
import { singles, solve, TECH } from "./solver.ts";

export interface Skill {
  name: "novice" | "casual" | "good" | "expert";
  /** Seconds to notice a last gap (the easiest single); harder techniques take a multiple of it. */
  look: number;
  /** Seconds per tap (uniform). */
  tap: [number, number];
  /** Chance a digit entered is wrong. */
  slip: number;
  /** Finds locked digits and pairs when no single shows (else waits for the nudge, the marks or a lamp). */
  deep: boolean;
  /** Enters digits digit-first (arms a digit and taps its keys) when that saves taps. */
  armed: boolean;
  /** Seconds stuck before it uses a lamp. */
  lampAfter: number;
}

export const SKILLS: Record<Skill["name"], Skill> = {
  novice: { name: "novice", look: 1.8, tap: [0.45, 0.75], slip: 0.12, deep: false, armed: false, lampAfter: 9 },
  casual: { name: "casual", look: 1.2, tap: [0.34, 0.52], slip: 0.08, deep: false, armed: false, lampAfter: 7 },
  good: { name: "good", look: 0.88, tap: [0.26, 0.4], slip: 0.04, deep: true, armed: true, lampAfter: 5 },
  expert: { name: "expert", look: 0.62, tap: [0.2, 0.3], slip: 0.015, deep: true, armed: true, lampAfter: 3 },
};
export const skillByName = (name: string): Skill | undefined => (SKILLS as Record<string, Skill>)[name];

/** How much longer than a last gap each technique takes to see. */
const COST: Record<number, number> = {
  [TECH.fullHouse]: 1,
  [TECH.hiddenBox]: 1.55,
  [TECH.hiddenLine]: 2.3,
  [TECH.nakedSingle]: 3.6,
};
/** Deep techniques (locked digits, pairs) for players who know them. */
const DEEP_COST = 7;

interface Step {
  at: number;
  target: Target;
}

export class Pilot {
  private queue: Step[] = [];
  private clock = 0;
  private grid = -1;
  private stuckSince = -1;

  constructor(
    readonly skill: Skill,
    private rand: Rng,
  ) {}

  private u(a: number, b: number): number {
    return a + (b - a) * this.rand();
  }
  private tapTime(): number {
    return this.u(this.skill.tap[0], this.skill.tap[1]);
  }

  /** Forget any plan (a new run, a cancelled gesture). */
  reset(): void {
    this.queue = [];
    this.stuckSince = -1;
  }

  /** The tap it makes this frame, if any. `controls` is the state the taps go into. */
  update(run: Run, controls: Controls, dt: number): Target | null {
    this.clock += dt;
    if (run.phase !== "play") {
      this.queue = [];
      return null;
    }
    if (run.index !== this.grid) {
      this.grid = run.index;
      this.queue = [];
      this.stuckSince = -1;
    }
    if (!this.queue.length) this.plan(run, controls);
    const next = this.queue[0];
    if (!next || this.clock < next.at) return null;
    this.queue.shift();
    return next.target;
  }

  private plan(run: Run, controls: Controls): void {
    const s = this.skill;
    const g = run.g;
    const visible = singles(g, run.values);
    let best: { cell: number; digit: number; t: number } | null = null;
    for (const p of visible) {
      let cost = COST[p.tech] ?? DEEP_COST;
      // Pencil marks make a key with one digit left as plain as a last gap.
      if (run.marks && p.tech === TECH.nakedSingle) cost = 1.2;
      // A player who works digit-first sees the armed digit's homes sooner.
      if (s.armed && controls.armed === p.digit) cost *= 0.7;
      const t = s.look * cost * this.u(0.45, 1.75);
      if (!best || t < best.t) best = { cell: p.cell, digit: p.digit, t };
    }
    if (!best) {
      // Nothing shows from the placed digits alone.
      if (this.stuckSince < 0) this.stuckSince = this.clock;
      if (run.lamps > 0 && this.clock - this.stuckSince >= s.lampAfter) {
        this.queue.push({ at: this.clock + this.tapTime(), target: { kind: "lamp" } });
        return;
      }
      const deep = solve(g, run.values).placements[0];
      if (!deep) return;
      if (s.deep) best = { cell: deep.cell, digit: deep.digit, t: s.look * DEEP_COST * this.u(0.6, 1.6) };
      else {
        // Wait for the nudge, then work the nudged key out (slowly, and with more slips).
        const wait = Math.max(0, TUNE.nudgeAfter - run.idle);
        const lampWait = run.lamps > 0 ? Math.max(0, s.lampAfter - (this.clock - this.stuckSince)) : Infinity;
        if (lampWait < wait + s.look * 3) {
          this.queue.push({ at: this.clock + lampWait + this.tapTime(), target: { kind: "lamp" } });
          return;
        }
        best = { cell: deep.cell, digit: deep.digit, t: wait + s.look * 3 * this.u(0.6, 1.5) };
      }
    } else this.stuckSince = -1;
    // The nudge shows the easiest key after a few idle seconds, which caps a slow look.
    const nudge = run.nudge();
    if (nudge && best.t > TUNE.nudgeAfter - run.idle + s.look) {
      const t = Math.max(0, TUNE.nudgeAfter - run.idle) + s.look * 1.4 * this.u(0.6, 1.4);
      if (t < best.t) best = { cell: nudge.cell, digit: nudge.digit, t };
    }
    // A slow look with a lamp in hand: light a key instead.
    const lampAt = s.lampAfter * 0.6;
    if (run.lamps > 0 && best.t > lampAt) {
      this.queue.push({ at: this.clock + lampAt + this.tapTime(), target: { kind: "lamp" } });
      return;
    }
    let digit = best.digit;
    if (this.rand() < s.slip) {
      // A slip: some other digit, one that looks possible if there is one.
      const fits = digitsOf(candidates(g, run.values)[best.cell]!).filter((d) => d !== best!.digit);
      const others = Array.from({ length: run.n }, (_, i) => i + 1).filter((d) => d !== best!.digit && !run.done(d));
      const pool = fits.length ? fits : others;
      if (pool.length) digit = pool[Math.floor(this.rand() * pool.length)]!;
    }
    let at = this.clock + best.t;
    const push = (target: Target) => {
      this.queue.push({ at, target });
      at += this.tapTime();
    };
    if (s.armed) {
      // Digit first: arm the digit unless it already is, then tap the key.
      if (controls.selected !== null) push({ kind: "key", cell: controls.selected });
      if (controls.armed !== digit) push({ kind: "pad", digit });
      push({ kind: "key", cell: best.cell });
    } else {
      // Key first: drop any armed digit, select the key (unless it is), then the digit.
      if (controls.armed !== null) push({ kind: "pad", digit: controls.armed });
      if (controls.selected !== best.cell) push({ kind: "key", cell: best.cell });
      push({ kind: "pad", digit });
    }
  }
}

/** Plays one headless run at `skill` and returns it when the clock runs out (or after `maxSeconds`). */
export function playRun(run: Run, pilot: Pilot, maxSeconds = 400, dt = 1 / 60): Run {
  const controls = new Controls(() => run);
  for (let t = 0; t < maxSeconds && !run.over; t += dt) {
    run.step(dt);
    const target = pilot.update(run, controls, dt);
    if (target) controls.tap(target);
  }
  return run;
}
