/**
 * One run of Saltbend, time-stepped and pure (no DOM): the cart, the one input, the lines it takes and what they pay.
 *
 * The input is a hold. Pressing swings the cart into the bend ahead (into the one it is in, or the next one if it is on
 * a straight), whichever way that bend goes, and the direction is fixed for that press; letting go straightens it: the
 * cart eases back toward the road's heading on its own, and follows easy sweeps unaided. So a bend is one press, and
 * the skill is when you press (early tucks you in, late runs you wide) and how long you hold (too long and you cut the
 * inside, too short and you run wide).
 *
 * The tarmac is paper; outside it a gravel verge slows the cart, breaks the streak and nudges it back; past the verge
 * the cart leaves the road. A crate on the back (one is loaded at every gate) saves it once: the crate goes over and
 * the cart bumps back on. Without a crate the run is over.
 *
 * Every bend is graded from how close the cart came to its inner edge through the middle of it: on the paint, kissed,
 * tight, clean or wide. Clean lines or better in a row build the streak and the multiplier; a wide line or the gravel
 * ends it. Holding through a bend also builds drift, banked when you let go.
 */
import { BEND_K, CAR_HALF_W, Course, GATE_M, HALF, isBend, OFF, poseIn, wrap, type Seg } from "./road.ts";

/**
 * Path curvature while holding (1/m): the bend's own curvature times HOLD_GAIN plus HOLD_ADD, capped at K_HOLD. So a
 * hold always turns a little tighter than the bend it swings into: held all the way, the cart creeps to the inside.
 */
export const K_HOLD = 0.122;
export const HOLD_GAIN = 1.22;
export const HOLD_ADD = 0.009;
export const holdCurvature = (bendK: number): number => Math.min(K_HOLD, Math.abs(bendK) * HOLD_GAIN + HOLD_ADD);
/** Path curvature a released cart finds on its own into a bend (easy sweeps need no hold), and back out of one. */
export const K_RELAX = 0.014;
export const K_BACK = 0.09;
/** How hard a released cart turns back to the road's heading (1/m per radian). */
export const ALIGN = 0.3;
/** The gravel's push back toward the tarmac (1/m). */
export const NUDGE = 0.02;
/** Seconds for the steering to swing fully in when pressed, and back out when let go. */
export const SWING_IN = 0.15;
export const SWING_OUT = 0.12;
/** Holding looks this far ahead (seconds of travel) for the bend to swing into. */
export const LEAD_S = 0.28;
/** Speeds (m/s). */
export const V_START = 14;
export const V_GAIN = 20;
export const V_SCALE = 1500;
/** Drift points per metre held hard into a bend. */
export const DRIFT_PTS = 4;
/** Crates the cart can carry. */
export const MAX_CRATES = 1;
/** Streak lengths that reach ×2 … ×5. */
export const TIERS = [2, 5, 9, 14];
export const TIER_NAMES = ["", "smooth", "silk", "ribbon", "long horizon"];

export type Grade = "paint" | "kissed" | "tight" | "clean" | "wide" | "scraped";
export const GRADE_WORDS: Record<Grade, string> = {
  paint: "on the paint",
  kissed: "kissed",
  tight: "tight",
  clean: "clean",
  wide: "wide",
  scraped: "gravel",
};
export const GRADE_POINTS: Record<Grade, number> = { paint: 120, kissed: 75, tight: 45, clean: 20, wide: 0, scraped: 0 };
/** Inner-edge gaps (m, the cart's inside to the edge line) for each grade. */
export const GAPS = { paint: 0.05, kissed: 0.6, tight: 1.4, clean: 2.6 };

export function gradeFor(gap: number): Grade {
  if (gap <= GAPS.paint) return "paint";
  if (gap <= GAPS.kissed) return "kissed";
  if (gap <= GAPS.tight) return "tight";
  if (gap <= GAPS.clean) return "clean";
  return "wide";
}

export const multFor = (streak: number): number => 1 + TIERS.filter((t) => streak >= t).length;
export const vTarget = (s: number): number => V_START + V_GAIN * (1 - Math.exp(-Math.max(0, s) / V_SCALE));

export type RunEvent =
  | { k: "press"; dir: number }
  | { k: "release" }
  | { k: "bank"; points: number; metres: number }
  | { k: "spill"; points: number }
  | { k: "grade"; grade: Grade; points: number; gap: number; streak: number; mult: number; dir: number; seg: number }
  | { k: "tier"; mult: number }
  | { k: "lost"; streak: number }
  | { k: "verge"; side: number }
  | { k: "lemon"; s: number; d: number; points: number }
  | { k: "gate"; n: number; points: number; crate: boolean }
  | { k: "crate"; why: "gate" | "streak" }
  | { k: "save"; side: number }
  | { k: "crash"; side: number; how: "wide" | "inside" }
  | { k: "flock"; i: number };

export interface RunStats {
  bends: number;
  grades: Record<Grade, number>;
  bestStreak: number;
  bestMult: number;
  driftM: number;
  drifts: number;
  lemons: number;
  gates: number;
  saves: number;
  scrapes: number;
  presses: number;
  /** How the run ended: ran wide off the outside of a bend, or cut over the inside. */
  end: "wide" | "inside" | null;
  maxSpeed: number;
}

export interface RunOptions {
  /** The attract demo: the road stays gentle, and nothing is scored. */
  demo?: boolean;
}

/** Each run's road comes from the launch seed and the run number. */
export const runSeed = (seed: number, run: number): number => (Math.imul(seed ^ 0x9e3779b9, 2654435761) + run * 40503) >>> 0;

export class Run {
  readonly course: Course;
  readonly demo: boolean;
  phase: "drive" | "crashed" = "drive";
  time = 0;
  // The cart: position, heading of travel, speed, path curvature.
  x = 0;
  y = 0;
  a = Math.PI / 2;
  v = 8;
  kappa = 0;
  // On the road.
  s = 0;
  d = 0;
  seg = 0;
  /** The body's yaw relative to the travel heading (drift angle) and its rate, for the picture. */
  slip = 0;
  slipV = 0;
  holding = false;
  dir = 0;
  /** The curvature this press swings to. */
  holdK = 0;
  holdT = 0;
  onVerge = false;
  invuln = 0;
  // The run's economy.
  score = 0;
  streak = 0;
  crates = 0;
  drift = 0;
  driftM = 0;
  driftClean = true;
  readonly events: RunEvent[] = [];
  readonly stats: RunStats = {
    bends: 0,
    grades: { paint: 0, kissed: 0, tight: 0, clean: 0, wide: 0, scraped: 0 },
    bestStreak: 0,
    bestMult: 1,
    driftM: 0,
    drifts: 0,
    lemons: 0,
    gates: 0,
    saves: 0,
    scrapes: 0,
    presses: 0,
    end: null,
    maxSpeed: 0,
  };
  // The bend being graded.
  private bend: { seg: number; dir: number; gap: number; scraped: boolean; s1: number; len: number } | null = null;
  private lastBendDir = 1;
  private scoredM = 0;
  private cleanSinceGate = false;
  private crashT = 0;
  private spin = 0;

  constructor(seed: number, o: RunOptions = {}) {
    this.demo = !!o.demo;
    this.course = new Course(seed, { demo: this.demo });
    this.course.ensure(400);
  }

  get mult(): number {
    return multFor(this.streak);
  }

  /** Seconds since the crash (0 while driving). */
  get crashedFor(): number {
    return this.crashT;
  }

  /** The body's heading on screen: travel heading plus the drift angle. */
  get yaw(): number {
    return this.a + this.slip + this.spin;
  }

  /** The one input. */
  setHold(on: boolean): void {
    if (this.phase !== "drive" || on === this.holding) return;
    this.holding = on;
    if (on) {
      const g = this.course.bendSegAhead(this.s, this.v * LEAD_S);
      this.dir = g ? Math.sign(g.k) : 1;
      this.holdK = holdCurvature(g ? g.k : BEND_K);
      this.holdT = 0;
      this.drift = 0;
      this.driftM = 0;
      this.driftClean = true;
      this.stats.presses++;
      this.events.push({ k: "press", dir: this.dir });
    } else {
      this.events.push({ k: "release" });
      this.bankDrift();
    }
  }

  private bankDrift(): void {
    if (this.driftM < 4) return;
    if (this.driftClean) {
      const pts = Math.round(this.drift) * this.mult;
      if (!this.demo) this.score += pts;
      this.stats.driftM += this.driftM;
      this.stats.drifts++;
      this.events.push({ k: "bank", points: pts, metres: this.driftM });
    }
    this.drift = 0;
    this.driftM = 0;
  }

  /** Advances the run by `dt` seconds in equal substeps of at most 1/120 s. */
  step(dt: number): void {
    if (dt <= 0) return;
    const n = Math.max(1, Math.ceil(dt * 120 - 1e-6));
    const h = dt / n;
    for (let i = 0; i < n; i++) this.tick(h);
  }

  private tick(h: number): void {
    this.time += h;
    if (this.phase === "crashed") {
      this.crashT += h;
      // Over the sea wall the cart sails on a little before it drops; into the land it digs in and tips.
      this.v = Math.max(0, this.v - (this.d < 0 ? 6 : 24) * h);
      this.spin += this.dir * h * 2.6 * Math.min(1, this.v / 6);
      this.a += this.kappa * this.v * h * 0.5;
      this.x += Math.cos(this.a) * this.v * h;
      this.y += Math.sin(this.a) * this.v * h;
      this.slip *= Math.exp(-3 * h);
      return;
    }
    const c = this.course;
    c.ensure(this.s + 320);
    const g = c.segs[c.indexAt(this.s, this.seg)]!;
    const p = poseIn(g, Math.max(0, Math.min(g.len, this.s - g.s0)));
    this.invuln = Math.max(0, this.invuln - h);

    // Steering.
    let target: number;
    if (this.holding) {
      this.holdT += h;
      target = this.dir * this.holdK;
    } else {
      // Let go: the cart straightens up. It turns back out of a bend hard (the tail catches), but into one only as far
      // as an easy sweep needs: the bend is the press's job.
      const into = this.course.bendAhead(this.s, this.v * LEAD_S);
      const c = Math.max(-K_RELAX, Math.min(K_RELAX, p.k)) + ALIGN * wrap(p.a - this.a);
      const ci = c * into;
      target = ci > K_RELAX ? into * K_RELAX : ci < -K_BACK ? -into * K_BACK : c;
    }
    const rate = ((this.holding ? this.holdK : K_HOLD) / (this.holding ? SWING_IN : SWING_OUT)) * h;
    this.kappa += Math.max(-rate, Math.min(rate, target - this.kappa));
    let k = this.kappa;
    if (this.onVerge) k += -Math.sign(this.d) * NUDGE;

    // Speed: it grows along the road; drifting and gravel scrub some off.
    const want = vTarget(this.s) + (this.mult - 1) * 0.3;
    const grip = Math.min(1, Math.abs(this.kappa) / 0.07);
    if (this.onVerge) this.v = Math.max(want * 0.55, this.v - 5 * h);
    else if (this.v < want) this.v = Math.min(want, this.v + (this.time < 2 ? 4 : 2.2) * h);
    else this.v = Math.max(want, this.v - 1.5 * h);
    if (this.holding) this.v = Math.max(V_START * 0.8, this.v - 0.7 * grip * h);
    this.stats.maxSpeed = Math.max(this.stats.maxSpeed, this.v);

    // Move.
    this.a = wrap(this.a + k * this.v * h);
    this.x += Math.cos(this.a) * this.v * h;
    this.y += Math.sin(this.a) * this.v * h;
    const pr = c.project(this.x, this.y, this.s);
    this.seg = pr.i;
    const ds = pr.s - this.s;
    this.s = pr.s;
    this.d = pr.d;

    // The picture's drift angle: the tail swings out while the cart turns hard.
    const slipTarget = this.holding ? this.dir * 0.52 * grip : this.kappa * 2.2;
    this.slipV += ((slipTarget - this.slip) * 90 - this.slipV * 13) * h;
    this.slip += this.slipV * h;

    // Drift builds while holding hard into a bend.
    if (this.holding && grip > 0.45) {
      this.drift += ds * grip * DRIFT_PTS;
      this.driftM += ds;
    }

    // Distance pays a point a metre.
    if (!this.demo && this.s > this.scoredM + 1) {
      const m = Math.floor(this.s - this.scoredM);
      this.score += m;
      this.scoredM += m;
    }

    this.edges();
    if (this.phase !== "drive") return;
    this.grade(c.segs[this.seg]!);
    this.pickups();
    c.trim(this.s);
  }

  private edges(): void {
    const ad = Math.abs(this.d);
    const verge = ad > HALF;
    if (verge && !this.onVerge) {
      this.onVerge = true;
      if (this.invuln <= 0) {
        this.v *= 0.86;
        this.stats.scrapes++;
        this.events.push({ k: "verge", side: Math.sign(this.d) });
        if (this.bend) this.bend.scraped = true;
        if (this.holding && this.driftM > 0) {
          this.events.push({ k: "spill", points: Math.round(this.drift) });
          this.driftClean = false;
        }
        this.breakStreak();
      }
    } else if (!verge) this.onVerge = false;
    if (ad <= OFF) return;
    const side = Math.sign(this.d);
    // Off the road: which way did it go? Out of the inside of the bend it was in (held too long) or off the outside.
    const g = this.course.segs[this.seg]!;
    const bendDir = isBend(g) ? Math.sign(g.k) : this.lastBendDir;
    const how = side === bendDir ? "inside" : "wide";
    if (this.crates > 0 && !this.demo) {
      this.crates--;
      this.stats.saves++;
      this.events.push({ k: "save", side });
      // Bump back onto the edge of the tarmac, square to the road, slower.
      const p = this.course.pose(this.s);
      const back = side * (HALF - 0.45);
      this.x = p.x - Math.sin(p.a) * back;
      this.y = p.y + Math.cos(p.a) * back;
      this.d = back;
      this.a = p.a - side * 0.06;
      this.kappa = 0;
      this.v *= 0.72;
      this.invuln = 1.1;
      this.onVerge = false;
      if (this.holding) {
        this.holding = false;
        this.events.push({ k: "release" });
      }
      this.drift = 0;
      this.driftM = 0;
      if (this.bend) this.bend.scraped = true;
      this.breakStreak();
      return;
    }
    this.phase = "crashed";
    this.stats.end = how;
    this.dir = side === 0 ? 1 : side;
    // The cart carries on away from the road: over the parapet and out over the water, or into the land.
    this.kappa = (side || 1) * (side < 0 ? 0.14 : 0.06);
    this.holding = false;
    this.events.push({ k: "crash", side, how });
  }

  private breakStreak(): void {
    if (this.streak >= 2) this.events.push({ k: "lost", streak: this.streak });
    this.streak = 0;
  }

  private grade(g: Seg): void {
    const b = this.bend;
    if (b && (g.i !== b.seg || this.s >= b.s1)) {
      // The bend is behind us: grade it.
      this.bend = null;
      this.finishBend(b);
    }
    if (!this.bend && isBend(g) && g.i !== this.gradedSeg) {
      this.bend = { seg: g.i, dir: Math.sign(g.k), gap: Infinity, scraped: false, s1: g.s0 + g.len, len: g.len };
      this.gradedSeg = g.i;
      this.lastBendDir = Math.sign(g.k);
    }
    const cur = this.bend;
    if (cur) {
      const u = (this.s - (cur.s1 - cur.len)) / cur.len;
      if (u > 0.15 && u < 0.85) cur.gap = Math.min(cur.gap, HALF - cur.dir * this.d - CAR_HALF_W);
    }
  }
  private gradedSeg = -1;

  private finishBend(b: { seg: number; dir: number; gap: number; scraped: boolean; len: number }): void {
    if (this.demo) {
      this.events.push({ k: "grade", grade: b.scraped ? "scraped" : gradeFor(b.gap), points: 0, gap: b.gap, streak: 0, mult: 1, dir: b.dir, seg: b.seg });
      return;
    }
    const grade: Grade = b.scraped ? "scraped" : gradeFor(b.gap);
    this.stats.bends++;
    this.stats.grades[grade]++;
    if (grade === "scraped") {
      this.events.push({ k: "grade", grade, points: 0, gap: b.gap, streak: 0, mult: this.mult, dir: b.dir, seg: b.seg });
      return;
    }
    if (grade === "wide") {
      this.breakStreak();
      this.events.push({ k: "grade", grade, points: 0, gap: b.gap, streak: 0, mult: 1, dir: b.dir, seg: b.seg });
      return;
    }
    const before = this.mult;
    this.cleanSinceGate = true;
    this.streak++;
    this.stats.bestStreak = Math.max(this.stats.bestStreak, this.streak);
    const pts = GRADE_POINTS[grade] * this.mult;
    this.score += pts;
    this.events.push({ k: "grade", grade, points: pts, gap: b.gap, streak: this.streak, mult: this.mult, dir: b.dir, seg: b.seg });
    if (this.mult > before) {
      this.stats.bestMult = Math.max(this.stats.bestMult, this.mult);
      this.events.push({ k: "tier", mult: this.mult });
    }
    if (this.streak % 12 === 0 && this.crates < MAX_CRATES) {
      this.crates++;
      this.events.push({ k: "crate", why: "streak" });
    }
  }

  private pickups(): void {
    const c = this.course;
    for (const l of c.lemons) {
      if (l.taken || Math.abs(l.s - this.s) > 1.6) continue;
      if (Math.abs(l.d - this.d) < 1.15) {
        l.taken = true;
        const pts = 25 * this.mult;
        if (!this.demo) {
          this.score += pts;
          this.stats.lemons++;
        }
        this.events.push({ k: "lemon", s: l.s, d: l.d, points: pts });
      }
    }
    c.flocks.forEach((f, i) => {
      if (f.flown < 0 && f.s - this.s < 16) {
        f.flown = 0;
        this.events.push({ k: "flock", i });
      }
    });
    for (const gt of c.gates) {
      if (gt.passed || this.s < gt.s) continue;
      gt.passed = true;
      if (this.demo) continue;
      this.stats.gates++;
      const pts = 150 * gt.n * this.mult;
      this.score += pts;
      // A gate loads a spare crate for a cart that has driven at least one clean line since the last one.
      const crate = this.crates < MAX_CRATES && this.cleanSinceGate;
      this.cleanSinceGate = false;
      if (crate) this.crates++;
      this.events.push({ k: "gate", n: gt.n, points: pts, crate });
      if (crate) this.events.push({ k: "crate", why: "gate" });
    }
  }

  /** Metres driven (the distance marker, the best-distance post). */
  get metres(): number {
    return Math.max(0, Math.floor(this.s));
  }

  /** The gate the cart is heading for. */
  get nextGate(): number {
    return Math.floor(Math.max(0, this.s) / GATE_M) + 1;
  }
}

export { BEND_K };
