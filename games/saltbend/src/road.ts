/**
 * The coast road, pure and seeded: a chain of straights and constant-radius bends, generated ahead of the cart and
 * dropped behind it. Distances are metres along the centreline (`s`); lateral offsets (`d`) are metres to the left of
 * it. Headings are radians from +x, counterclockwise; the road sets off north (π/2) and never turns back south (its
 * heading stays within ±HEADING_MAX of north), so it can wind as hard as it likes and never cross itself.
 *
 * Difficulty is a function of distance only: bends get tighter and longer, straights shorter, S-bends more common.
 * The first stretch is a scripted warm-up a cart can drive with no input at all. Every GATE_M a gate stands on a
 * straight; lemons lie on the inside line of some bends; gulls stand about on the verge.
 */
import { createRng, type Rng } from "@thumbcade-games/kit/rng";

/** Half the tarmac's width, the gravel verge outside it, and where the cart is off the road (its centre past it). */
export const HALF = 3.5;
export const VERGE = 1.3;
export const OFF = HALF + VERGE;
/** The cart, in metres. */
export const CAR_HALF_W = 0.72;
export const CAR_LEN = 2.7;
/** A segment this curved or more is a bend: it is graded, and holding swings into it. */
export const BEND_K = 0.018;
/** A gate every this many metres. */
export const GATE_M = 320;
/** The road's heading never strays further than this from north. */
export const HEADING_MAX = 1.45;
/** The scripted warm-up ends here. */
export const WARM_M = 165;

export interface Seg {
  i: number;
  s0: number;
  len: number;
  /** Signed curvature (1/m), + bends left. */
  k: number;
  x0: number;
  y0: number;
  a0: number;
}

export interface Pose {
  x: number;
  y: number;
  a: number;
  k: number;
}

export interface Lemon {
  s: number;
  d: number;
  taken: boolean;
}

export interface Flock {
  s: number;
  d: number;
  n: number;
  seed: number;
  /** Seconds since they took off (−1 = still standing). */
  flown: number;
}

export interface Gate {
  n: number;
  s: number;
  passed: boolean;
}

const TAU = Math.PI * 2;
export const wrap = (a: number): number => {
  let x = (a + Math.PI) % TAU;
  if (x < 0) x += TAU;
  return x - Math.PI;
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Metres from the first gate to the hardest road. */
export const RAMP_M = 850;
/** 0 up to the first gate, 1 from about 1.4 km. */
export function difficulty(s: number): number {
  return clamp01((s - GATE_M) / RAMP_M);
}

/** The pose a distance `u` into a segment. */
export function poseIn(g: Seg, u: number): Pose {
  if (Math.abs(g.k) < 1e-9) return { x: g.x0 + Math.cos(g.a0) * u, y: g.y0 + Math.sin(g.a0) * u, a: g.a0, k: 0 };
  const a = g.a0 + g.k * u;
  return { x: g.x0 + (Math.sin(a) - Math.sin(g.a0)) / g.k, y: g.y0 - (Math.cos(a) - Math.cos(g.a0)) / g.k, a, k: g.k };
}

export const isBend = (g: Seg | undefined): boolean => !!g && Math.abs(g.k) >= BEND_K;

export interface CourseOptions {
  /** The attract demo: the road stays as it is at the start of the difficulty ramp, give or take. */
  demo?: boolean;
}

export class Course {
  readonly segs: Seg[] = [];
  readonly lemons: Lemon[] = [];
  readonly flocks: Flock[] = [];
  readonly gates: Gate[] = [];
  private rng: Rng;
  private nextFlock = 120;
  private lastSign = 1;
  private nextId = 0;
  private chain = false;
  private demo: boolean;

  constructor(seed: number, o: CourseOptions = {}) {
    this.rng = createRng(seed ^ 0x51a7be2d);
    this.demo = !!o.demo;
    this.segs.push({ i: this.nextId++, s0: -60, len: 60, k: 0, x0: 0, y0: -60, a0: Math.PI / 2 });
    this.warmUp();
  }

  /** Where the generated road ends. */
  get end(): number {
    const g = this.segs[this.segs.length - 1]!;
    return g.s0 + g.len;
  }

  private push(len: number, k: number): Seg {
    const last = this.segs[this.segs.length - 1]!;
    const p = poseIn(last, last.len);
    const g: Seg = { i: this.nextId++, s0: last.s0 + last.len, len, k, x0: p.x, y0: p.y, a0: p.a };
    this.segs.push(g);
    return g;
  }

  private warmUp(): void {
    // A straight out of the harbour, then two easy sweeps the cart follows on its own.
    this.push(46, 0);
    this.push(0.4 * 88, 1 / 88);
    this.push(22, 0);
    this.push(0.46 * 82, -1 / 82);
    this.push(WARM_M - this.end, 0);
  }

  /** Generates road until it reaches `s`. */
  ensure(s: number): void {
    while (this.end < s) this.grow();
  }

  /** Drops road (and what lies on it) more than `keep` metres behind `s`. */
  trim(s: number, keep = 160): void {
    while (this.segs.length > 2 && this.segs[1]!.s0 + this.segs[1]!.len < s - keep) this.segs.shift();
    const cut = s - keep;
    while (this.lemons.length && this.lemons[0]!.s < cut) this.lemons.shift();
    while (this.flocks.length && this.flocks[0]!.s < cut) this.flocks.shift();
    while (this.gates.length && this.gates[0]!.s < cut) this.gates.shift();
  }

  private heading(): number {
    return wrap(poseIn(this.segs[this.segs.length - 1]!, this.segs[this.segs.length - 1]!.len).a - Math.PI / 2);
  }

  private grow(): void {
    const r = this.rng;
    const e = this.end;
    const D = this.demo ? Math.min(0.35, difficulty(e)) : difficulty(e);
    // A gate due soon stands on a long straight.
    const gateS = Math.ceil((e + 1) / GATE_M) * GATE_M;
    const early = e < GATE_M - 20 && !this.demo;
    let straight = this.chain ? r.range(3, 10) * (1 - D * 0.4) : early ? r.range(14, 30) : r.range(lerp(26, 6, D), lerp(50, 17, D));
    this.chain = false;
    // No bend is longer than ~55 m, so looking 85 m past the straight always catches the gate on a straight.
    if (gateS - e < straight + 85) {
      straight = Math.max(straight, gateS - e + 28);
      this.gates.push({ n: Math.round(gateS / GATE_M), s: gateS, passed: false });
    }
    const sg = this.push(straight, 0);
    this.placeFlock(sg);

    // The bend.
    const h = this.heading();
    let sign: number;
    if (h > 0.75) sign = -1;
    else if (h < -0.75) sign = 1;
    else sign = r.chance(0.3 + 0.35 * D) ? -this.lastSign : r.chance(0.5) ? 1 : -1;
    // Up to the first gate the bends are open sweeps; from there they tighten.
    const first = early;
    const rMax = first ? 54 : lerp(36, 17, D);
    const rMin = first ? 46 : lerp(26, 11.5, Math.pow(D, 0.8));
    const R = r.range(rMin, rMax);
    let ang = first ? r.range(0.5, 0.85) : r.range(lerp(0.65, 0.95, D), lerp(1.15, 2.6, D));
    const room = (s: number) => (s > 0 ? HEADING_MAX - h : HEADING_MAX + h);
    if (room(sign) < 0.45) sign = -sign;
    ang = Math.min(ang, room(sign));
    const g = this.push(ang * R, sign / R);
    this.lastSign = sign;
    // Lemons on the inside line, more often as the road gets harder.
    if (r.chance(lerp(0.3, 0.55, D)) && g.len > 10) {
      const d = sign * (HALF - 1.05);
      const n = g.len > 22 && r.chance(0.5) ? 3 : 1;
      for (let i = 0; i < n; i++) this.lemons.push({ s: g.s0 + g.len * 0.5 + (i - (n - 1) / 2) * 3.2, d, taken: false });
    }
    this.chain = r.chance(lerp(0.2, 0.55, D));
  }

  private placeFlock(g: Seg): void {
    while (this.nextFlock < g.s0 + g.len - 6) {
      if (this.nextFlock > g.s0 + 6) {
        const side = this.rng.chance(0.5) ? 1 : -1;
        this.flocks.push({ s: this.nextFlock, d: side * this.rng.range(0.5, HALF + VERGE * 0.6), n: this.rng.int(2, 4), seed: this.rng.int(1, 1e6), flown: -1 });
        this.nextFlock += this.rng.range(150, 240);
      } else this.nextFlock = g.s0 + 6.5;
    }
  }

  /** Index of the segment holding `s` (clamped to the generated road). */
  indexAt(s: number, hint = -1): number {
    const segs = this.segs;
    let i = hint >= 0 && hint < segs.length ? hint : 0;
    if (hint < 0 || hint >= segs.length) {
      let lo = 0;
      let hi = segs.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (segs[mid]!.s0 <= s) lo = mid;
        else hi = mid - 1;
      }
      return lo;
    }
    while (i > 0 && segs[i]!.s0 > s) i--;
    while (i < segs.length - 1 && segs[i]!.s0 + segs[i]!.len <= s) i++;
    return i;
  }

  segAt(s: number): Seg {
    return this.segs[this.indexAt(s)]!;
  }

  pose(s: number): Pose {
    const g = this.segAt(s);
    return poseIn(g, Math.max(0, Math.min(g.len, s - g.s0)));
  }

  /** A point `d` metres left of the centreline at `s`. */
  point(s: number, d = 0): { x: number; y: number } {
    const p = this.pose(s);
    return { x: p.x - Math.sin(p.a) * d, y: p.y + Math.cos(p.a) * d };
  }

  /** The nearest centreline point to (x, y), searched from the segment holding `sHint`. */
  project(x: number, y: number, sHint: number): { s: number; d: number; i: number } {
    let i = this.indexAt(sHint);
    let u = 0;
    for (let iter = 0; iter < 6; iter++) {
      const g = this.segs[i]!;
      u = localU(g, x, y);
      if (u < 0 && i > 0) {
        i--;
        continue;
      }
      if (u > g.len && i < this.segs.length - 1) {
        i++;
        continue;
      }
      break;
    }
    const g = this.segs[i]!;
    u = Math.max(0, Math.min(g.len, u));
    const p = poseIn(g, u);
    const d = (x - p.x) * -Math.sin(p.a) + (y - p.y) * Math.cos(p.a);
    return { s: g.s0 + u, d, i };
  }

  /**
   * Which way holding swings the cart from `s`: into the bend at `s + lead`, or, on a straight, into the next one.
   * +1 left, −1 right.
   */
  bendAhead(s: number, lead: number): number {
    const g = this.bendSegAhead(s, lead);
    return g ? Math.sign(g.k) : 1;
  }

  /** The bend holding would swing into from `s` (see `bendAhead`). */
  bendSegAhead(s: number, lead: number): Seg | null {
    let i = this.indexAt(s + lead);
    for (let n = 0; n < 6 && i < this.segs.length; n++, i++) {
      const g = this.segs[i]!;
      if (isBend(g)) return g;
    }
    return null;
  }

  /** The bend holding `s`, or null on a straight or an easy sweep. */
  bendAt(s: number): Seg | null {
    const g = this.segAt(s);
    return isBend(g) ? g : null;
  }
}

/** Distance into `g` of the point on its centreline nearest (x, y); may fall outside 0..len. */
function localU(g: Seg, x: number, y: number): number {
  if (Math.abs(g.k) < 1e-9) return (x - g.x0) * Math.cos(g.a0) + (y - g.y0) * Math.sin(g.a0);
  const cx = g.x0 - Math.sin(g.a0) / g.k;
  const cy = g.y0 + Math.cos(g.a0) / g.k;
  const phi = Math.atan2(y - cy, x - cx);
  const a = g.k > 0 ? phi + Math.PI / 2 : phi - Math.PI / 2;
  return wrap(a - g.a0) / g.k;
}
