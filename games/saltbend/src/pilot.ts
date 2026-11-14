/**
 * The pilot: drives the attract demo, times the first-run hint, and plays headless runs at several skill levels so run
 * lengths can be measured without a person (scripts/pilot.ts, test/pilot.test.ts).
 *
 * It drives the way a thumb does, through the same hold as a player: it looks a moment down the road to a point on the
 * line it wants (in a bend, near the inner edge), works out how hard it would have to turn to reach it, and holds when
 * that is more than the cart finds on its own. People are late and misjudge bends, so each skill reacts after a delay,
 * misreads each bend's sharpness by a random factor, aims for its own gap to the inner edge, and now and then switches
 * off for a moment on a bend.
 */
import { createRng, type Rng } from "@thumbcade-games/kit/rng";
import { CAR_HALF_W, HALF, isBend } from "./road.ts";
import { K_RELAX, LEAD_S, Run, type RunStats } from "./sim.ts";

export interface Skill {
  name: string;
  /** Reaction delay (s) and its spread per decision. */
  react: number;
  jitter: number;
  /** Spread (log-normal sigma) of how sharp each bend seems. */
  judge: number;
  /** The gap to the inner edge it aims for (m) and its spread per bend. */
  gap: number;
  gapSpread: number;
  /** Chance per bend of a lapse, and how late it makes the press (s). */
  lapse: number;
  lapseDelay: [number, number];
  /** Look-ahead (s of travel). */
  look: number;
  /** How much of its own lag it allows for (0..1). */
  anticipate: number;
}

export const SKILLS: Skill[] = [
  { name: "novice", react: 0.42, jitter: 0.12, judge: 0.52, gap: 1.7, gapSpread: 1.0, lapse: 0.28, lapseDelay: [0.3, 0.8], look: 0.65, anticipate: 0.25 },
  { name: "casual", react: 0.34, jitter: 0.1, judge: 0.42, gap: 1.25, gapSpread: 0.8, lapse: 0.18, lapseDelay: [0.25, 0.65], look: 0.72, anticipate: 0.42 },
  { name: "good", react: 0.25, jitter: 0.07, judge: 0.28, gap: 0.75, gapSpread: 0.5, lapse: 0.09, lapseDelay: [0.2, 0.5], look: 0.8, anticipate: 0.6 },
  { name: "expert", react: 0.17, jitter: 0.045, judge: 0.17, gap: 0.4, gapSpread: 0.35, lapse: 0.05, lapseDelay: [0.18, 0.45], look: 0.85, anticipate: 0.8 },
];

/** The attract-mode driver: tidy and a little showy, never lapses. */
export const DEMO: Skill = { name: "demo", react: 0.1, jitter: 0, judge: 0.05, gap: 0.45, gapSpread: 0.25, lapse: 0, lapseDelay: [0, 0], look: 0.9, anticipate: 1 };
/** The first-run coach: what a good line wants right now, with no delay. */
export const COACH: Skill = { name: "coach", react: 0, jitter: 0, judge: 0, gap: 0.9, gapSpread: 0, lapse: 0, lapseDelay: [0, 0], look: 0.85, anticipate: 1 };

/** How hard (signed curvature, 1/m) the cart would have to turn to reach the skill's line `look` seconds ahead. */
export function need(run: Run, gap: number, look: number, ahead = 0): number {
  const c = run.course;
  const L = Math.max(7, Math.min(26, run.v * look));
  const st = run.s + L;
  const g = c.segAt(st);
  const dt = isBend(g) ? Math.sign(g.k) * (HALF - CAR_HALF_W - gap) : 0;
  const P = c.point(st, dt);
  // Where the cart will be once a decision taken now has landed (people anticipate their own lag).
  const a = run.a + run.kappa * run.v * ahead;
  const x = run.x + Math.cos(run.a + (a - run.a) / 2) * run.v * ahead;
  const y = run.y + Math.sin(run.a + (a - run.a) / 2) * run.v * ahead;
  const dx = P.x - x;
  const dy = P.y - y;
  const fwd = dx * Math.cos(a) + dy * Math.sin(a);
  const left = -dx * Math.sin(a) + dy * Math.cos(a);
  return (2 * left) / Math.max(1, fwd * fwd + left * left);
}

export class Pilot {
  private queue: Array<{ at: number; hold: boolean }> = [];
  private lastAt = 0;
  private want = false;
  private bendSeg = -1;
  private factor = 1;
  private gap: number;
  private extra = 0;
  private clock = 0;

  constructor(
    readonly skill: Skill,
    private rng: Rng,
  ) {
    this.gap = skill.gap;
  }

  /** What the pilot wants now, before its reaction delay. */
  get wanting(): boolean {
    return this.want;
  }

  /** Decides and applies the hold for this frame; returns the hold it applied. */
  step(run: Run, dt: number): boolean {
    this.clock += dt;
    if (run.phase !== "drive") return false;
    const sk = this.skill;
    const L = Math.max(7, Math.min(26, run.v * sk.look));
    const ahead = run.course.segAt(run.s + L);
    if (isBend(ahead) && ahead.i !== this.bendSeg) {
      this.bendSeg = ahead.i;
      this.factor = Math.exp(gauss(this.rng) * sk.judge);
      this.gap = Math.max(-0.25, sk.gap + gauss(this.rng) * sk.gapSpread);
      this.extra = this.rng.chance(sk.lapse) ? this.rng.range(sk.lapseDelay[0], sk.lapseDelay[1]) : 0;
    }
    const dir = run.holding ? run.dir : run.course.bendAhead(run.s, run.v * LEAD_S);
    const k = need(run, this.gap, sk.look, sk.react * sk.anticipate + 0.06) * this.factor * dir;
    const on = K_RELAX * 1.05 + 0.006;
    const off = K_RELAX * 0.7;
    const want = this.want ? k > off : k > on;
    if (want !== this.want) {
      this.want = want;
      // A lapse makes one press of a bend late, or one release (a thumb left down too long).
      const late = want ? this.extra : this.rng.chance(sk.lapse * 0.6) ? this.rng.range(sk.lapseDelay[0], sk.lapseDelay[1]) * 0.7 : 0;
      const delay = Math.max(0, sk.react + gauss(this.rng) * sk.jitter + late);
      if (want) this.extra = 0;
      const at = Math.max(this.lastAt, this.clock + delay);
      this.lastAt = at;
      this.queue.push({ at, hold: want });
    }
    while (this.queue.length && this.queue[0]!.at <= this.clock) run.setHold(this.queue.shift()!.hold);
    return run.holding;
  }
}

/**
 * What a good line wants right now (no delay, no mistakes): the first-run coach's "hold" and "let go". Holds a little
 * hysteresis of its own, so the prompt doesn't flicker.
 */
export class Coach {
  private want = false;
  advise(run: Run): boolean {
    if (run.phase !== "drive") return (this.want = false);
    const dir = run.holding ? run.dir : run.course.bendAhead(run.s, run.v * LEAD_S);
    const k = need(run, COACH.gap, COACH.look, 0.12) * dir;
    this.want = this.want ? k > K_RELAX * 0.7 : k > K_RELAX * 1.05 + 0.006;
    return this.want;
  }
}

function gauss(r: Rng): number {
  const u = Math.max(1e-9, r());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
}

export interface SimResult {
  seconds: number;
  score: number;
  metres: number;
  early: boolean;
  stats: RunStats;
}

/**
 * One whole headless run at 60 Hz from the first tap to the crash (capped at 240 s). `null` is a player who never
 * touches the screen; "tapper" taps briefly at random like the reviewer's scripted input.
 */
export function simulate(seed: number, skill: Skill | null | "tapper", cap = 240): SimResult {
  const run = new Run(seed);
  const rng = createRng(seed ^ 0x5eed);
  const pilot = skill && skill !== "tapper" ? new Pilot(skill, rng) : null;
  const dt = 1 / 60;
  let t = 0;
  let nextTap = 0.6;
  let release = -1;
  while (run.phase === "drive" && t < cap) {
    if (pilot) pilot.step(run, dt);
    else if (skill === "tapper") {
      if (t >= nextTap) {
        run.setHold(true);
        release = t + 0.07;
        nextTap = t + rng.range(0.3, 0.6);
      }
      if (release >= 0 && t >= release) {
        run.setHold(false);
        release = -1;
      }
    }
    run.step(dt);
    run.events.length = 0;
    t += dt;
  }
  return { seconds: t, score: run.score, metres: run.metres, early: t < 10, stats: run.stats };
}
