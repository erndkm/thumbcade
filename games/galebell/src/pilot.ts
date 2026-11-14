/**
 * The pilot: plays Galebell through the same controls a player has (hold left, hold right, tap to launch).
 *
 * It sees each ball as it was `react` seconds ago, guesses where it will be when its flip lands (gravity only, so a
 * bounce it hasn't seen yet fools it), and flips when that guess is over the rubber, with timing noise, a habit of
 * being early or late, and lapses where it doesn't react at all. Better pilots catch slow balls on a raised flipper
 * (a cradle), let them settle, then let go and flip after the delay that sends the ball where they want it: the
 * delays come from a table simulated once from the cradle (`aimTable`).
 */
import { createRng, type Rng } from "@thumbcade-games/kit/rng";
import { EvKind, GRAVITY, World, type Ball } from "./physics.ts";
import type { Controls, Game } from "./rules.ts";
import { buildTable, Sensor, Tag, type FlipperDef, type TableDef } from "./table.ts";

export interface Skill {
  name: SkillName;
  /** Seconds between the ball's real state and what the pilot acts on. */
  react: number;
  /** Timing noise (s, standard deviation) and a per-run bias (+ late). */
  jitter: number;
  bias: number;
  /** Chance an approach goes unanswered. */
  lapse: number;
  /** Chance to catch a slow ball on a raised flipper, and to aim from a cradle. */
  cradle: number;
  aim: number;
  /** Seconds a plain flip is held. */
  hold: number;
  /** Seconds before tapping the plunger. */
  launch: [number, number];
}

export type SkillName = "novice" | "casual" | "good" | "expert";

export const SKILLS: Record<SkillName, Skill> = {
  novice: { name: "novice", react: 0.22, jitter: 0.08, bias: 0.035, lapse: 0.3, cradle: 0, aim: 0, hold: 0.16, launch: [0.6, 2.2] },
  casual: { name: "casual", react: 0.17, jitter: 0.055, bias: 0.02, lapse: 0.13, cradle: 0.2, aim: 0.25, hold: 0.18, launch: [0.5, 1.5] },
  good: { name: "good", react: 0.14, jitter: 0.045, bias: 0.012, lapse: 0.09, cradle: 0.5, aim: 0.6, hold: 0.2, launch: [0.4, 1.1] },
  expert: { name: "expert", react: 0.095, jitter: 0.025, bias: 0.005, lapse: 0.028, cradle: 0.8, aim: 0.85, hold: 0.22, launch: [0.3, 0.8] },
};

/** What a flip from the cradle does, by the delay between letting go and flipping again. */
export type AimOutcome = "orbit" | "harbour" | "flag" | "lane" | "bumper" | "drain" | "none";

interface AimRow {
  d: number;
  up: AimOutcome;
  open: AimOutcome;
}

let AIM: [AimRow[], AimRow[]] | null = null;

/** Where a ball rests when caught on a raised flipper (found by rolling one down the inlane). */
export function cradleSpot(def: TableDef, side: 0 | 1): { x: number; y: number } {
  const w = new World(def);
  const f = w.flippers[side];
  f.pressed = true;
  w.step(0.2);
  const x = side === 0 ? 30 : 2 * 169 - 30;
  const b = w.addBall(x, 400);
  for (let i = 0; i < 480 * 3; i++) w.substep(1 / 480);
  return { x: b.x, y: b.y };
}

/** One cradle shot: release, wait `d` (sim seconds), flip; what does the ball do first? */
function aimShot(def: TableDef, side: 0 | 1, spot: { x: number; y: number }, d: number, open: boolean): AimOutcome {
  const w = new World(def);
  if (open) for (let i = 0; i < 4; i++) w.setTarget(i, false);
  const f = w.flippers[side];
  f.pressed = true;
  f.angle = f.def.up;
  const b = w.addBall(spot.x, spot.y);
  w.step(0.05);
  f.pressed = false;
  let outcome: AimOutcome = "none";
  let orbitUp = -1;
  let tt = 0;
  while (tt < 2.6 && outcome === "none") {
    f.pressed = tt >= d && tt < d + 0.25;
    w.evCount = 0;
    w.substep(1 / 480);
    tt += 1 / 480;
    for (let i = 0; i < w.evCount; i++) {
      const e = w.events[i]!;
      if (e.kind === EvKind.Harbour) outcome = "harbour";
      else if (e.kind === EvKind.Drain) outcome = "drain";
      else if (e.kind === EvKind.TargetDown) outcome = "flag";
      else if (e.kind === EvKind.Contact && e.a >= Tag.Bumper0 && e.a <= Tag.Bumper2 && tt > d + 0.05) outcome = outcome === "none" ? "bumper" : outcome;
      else if (e.kind === EvKind.Sensor) {
        if (e.a <= Sensor.Lane2) outcome = "lane";
        if (e.a === Sensor.OrbitL || e.a === Sensor.OrbitR) {
          const s = e.a === Sensor.OrbitL ? 0 : 1;
          if (e.s > 0) orbitUp = s;
          else if (orbitUp === 1 - s) outcome = "orbit";
        }
      }
    }
    if (!b.live) break;
  }
  return outcome;
}

const AIM_STEP = 0.006;
const AIM_MAX = 0.42;

/**
 * Builds the cradle table a few shots at a time (the game calls `step` once a frame after ready(), so it never costs a
 * long task); headless runs build it whole with `aimTable()`. Until it is done the pilot flips from a cradle by feel.
 */
export class AimBuilder {
  private readonly out: [AimRow[], AimRow[]] = [[], []];
  private readonly spots: Array<{ x: number; y: number } | null> = [null, null];
  private side: 0 | 1 = 0;
  private d = 0;
  done = false;
  constructor(private readonly def: TableDef = buildTable()) {}
  /** Simulates shots for up to `budgetMs` (Infinity = finish). */
  step(budgetMs: number): boolean {
    const t0 = performance.now();
    while (!this.done && performance.now() - t0 < budgetMs) {
      const side = this.side;
      const spot = (this.spots[side] ??= cradleSpot(this.def, side));
      this.out[side].push({ d: this.d, up: aimShot(this.def, side, spot, this.d, false), open: aimShot(this.def, side, spot, this.d, true) });
      this.d += AIM_STEP;
      if (this.d > AIM_MAX + 1e-9) {
        this.d = 0;
        if (side === 1) {
          this.done = true;
          AIM = this.out;
        } else this.side = 1;
      }
    }
    return this.done;
  }
}

/** Every cradle shot, simulated once (cached). */
export function aimTable(def: TableDef = buildTable()): [AimRow[], AimRow[]] {
  if (AIM) return AIM;
  new AimBuilder(def).step(Infinity);
  return AIM!;
}

/** The table if it has been built (by `aimTable` or an `AimBuilder`), else null. */
export const aimReady = (): [AimRow[], AimRow[]] | null => AIM;

interface Seen {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

interface Track {
  hist: Seen[];
  head: number;
  n: number;
}

const HIST = 48;

export class Pilot {
  readonly rng: Rng;
  private readonly bias: number;
  private readonly tracks = new Map<number, Track>();
  private readonly seenNow = new Map<number, Seen>();
  private holdUntil = [0, 0];
  /** Per side: a cradle in progress. */
  private mode: Array<"free" | "catch" | "settle" | "release"> = ["free", "free"];
  private modeT = [0, 0];
  private settleFor = [0, 0];
  private aimDelay = [0, 0];
  private answered = new Map<string, boolean>();
  private launchAt = -1;
  private t = 0;

  constructor(
    readonly skill: Skill,
    seed: number,
    def: TableDef = buildTable(),
    lazyAim = false,
  ) {
    this.rng = createRng(seed);
    this.bias = skill.bias * (0.5 + this.rng());
    // In the browser the table is built over frames (`AimBuilder`); headless, at once.
    if (!lazyAim) aimTable(def);
  }

  private gauss(): number {
    const u = Math.max(1e-9, this.rng());
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * this.rng());
  }

  private remember(b: Ball, frameDt: number): Seen {
    let tr = this.tracks.get(b.id);
    if (!tr) {
      tr = { hist: Array.from({ length: HIST }, () => ({ x: b.x, y: b.y, vx: b.vx, vy: b.vy })), head: 0, n: 0 };
      this.tracks.set(b.id, tr);
    }
    tr.head = (tr.head + 1) % HIST;
    const s = tr.hist[tr.head]!;
    s.x = b.x;
    s.y = b.y;
    s.vx = b.vx;
    s.vy = b.vy;
    tr.n = Math.min(HIST, tr.n + 1);
    const back = Math.min(tr.n - 1, Math.round(this.skill.react / frameDt));
    return tr.hist[(tr.head - back + HIST) % HIST]!;
  }

  /** The ball's place relative to a flipper at rest: along the rubber and height above it. */
  private local(fd: FlipperDef, dir: number, x: number, y: number): { lx: number; h: number } {
    const c = Math.cos(fd.rest);
    const s = Math.sin(fd.rest);
    const dx = x - fd.x;
    const dy = y - fd.y;
    return { lx: dx * c + dy * s, h: (-dx * s + dy * c) * dir };
  }

  update(g: Game, dt: number): Controls {
    this.t += dt;
    const w = g.world;
    const c: Controls = { left: false, right: false, launch: false };
    // Launch.
    if (g.laneBall && Math.abs(g.laneBall.vy) < 30) {
      if (this.launchAt < 0) this.launchAt = this.t + this.rng.range(...this.skill.launch) * (g.attract ? 0.6 : 1);
      if (this.t >= this.launchAt) {
        c.launch = true;
        this.launchAt = -1;
      }
    } else this.launchAt = -1;

    const seenNow = this.seenNow;
    seenNow.clear();
    for (const b of w.balls) if (b.live && b !== g.laneBall) seenNow.set(b.id, this.remember(b, dt));
    const speed = g.speed;
    const lead = 0.028; // real seconds from press to the rubber meeting a ball mid-flipper
    for (let side = 0; side < 2; side++) {
      const f = w.flippers[side]!;
      const fd = f.def;
      const dir = f.dir;
      let want = this.t < this.holdUntil[side]!;
      // The nearest ball heading for this flipper.
      let best: Ball | null = null;
      let bestSeen: Seen | null = null;
      let bestD = Infinity;
      for (const b of w.balls) {
        const seen = seenNow.get(b.id);
        if (!seen) continue;
        if ((b.x < 169) !== (side === 0)) continue;
        const d = Math.hypot(b.x - fd.x, b.y - fd.y);
        if (d < bestD) {
          bestD = d;
          best = b;
          bestSeen = seen;
        }
      }
      const mode = this.mode[side]!;
      if (best && bestSeen) {
        const sp = Math.hypot(best.vx, best.vy);
        const near = bestD < fd.len + 40;
        if (mode === "catch") {
          want = true;
          this.modeT[side]! += dt;
          if (near && sp < 25) {
            this.mode[side] = "settle";
            this.modeT[side] = 0;
            this.settleFor[side] = this.rng.range(0.25, 1.4);
          } else if (this.modeT[side]! > 1.2 || !near) this.mode[side] = "free";
        } else if (mode === "settle") {
          want = true;
          this.modeT[side]! += dt;
          if (sp > 60) this.mode[side] = "free";
          else if (this.modeT[side]! >= this.settleFor[side]!) {
            this.mode[side] = "release";
            this.modeT[side] = 0;
            this.aimDelay[side] = this.pickAim(g, side) / speed + this.gauss() * this.skill.jitter + this.bias;
            want = false;
          }
        } else if (mode === "release") {
          want = false;
          this.modeT[side]! += dt;
          if (this.modeT[side]! >= this.aimDelay[side]!) {
            want = true;
            this.holdUntil[side] = this.t + 0.24;
            this.mode[side] = "free";
          }
        } else if (!want) {
          // Free play: flip when the ball, as the pilot sees it, will be over the rubber when the flip lands.
          const horizon = (this.skill.react + lead + this.bias) * speed;
          const key = `${best.id}:${side}`;
          const slow = sp < 650 && bestSeen.vy > -100;
          const p = predict(bestSeen, horizon + this.gauss() * this.skill.jitter * speed);
          const loc = this.local(fd, dir, p.x, p.y);
          const inZone = loc.lx > fd.len * 0.3 && loc.lx < fd.len + 8 && loc.h > -6 && loc.h < 30;
          const above = this.local(fd, dir, bestSeen.x, bestSeen.y);
          if (slow && near && above.h > 0 && this.rng() < this.skill.cradle * dt * 6 && this.answered.get(key) !== false) {
            this.mode[side] = "catch";
            this.modeT[side] = 0;
            want = true;
          } else if (inZone) {
            if (!this.answered.has(key)) this.answered.set(key, this.rng() >= this.skill.lapse);
            if (this.answered.get(key)) {
              want = true;
              this.holdUntil[side] = this.t + this.skill.hold * (0.8 + 0.4 * this.rng());
            }
          } else if (bestD > fd.len + 60) this.answered.delete(key);
        }
      } else if (mode !== "free") this.mode[side] = "free";
      if (side === 0) c.left = want;
      else c.right = want;
    }
    // Forget balls that are gone.
    if (this.tracks.size > 8) {
      const live = new Set(w.balls.map((b) => b.id));
      for (const id of this.tracks.keys()) if (!live.has(id)) this.tracks.delete(id);
    }
    return c;
  }

  /** Picks a cradle shot for what's lit, and returns its delay (sim seconds). */
  private pickAim(g: Game, side: number): number {
    const table = aimReady();
    if (!table) return this.rng.range(0.05, 0.25);
    const rows = table[side]!;
    const open = g.flags.every((f) => !f);
    const lit = g.harbourLit;
    const want: AimOutcome[] = [];
    if (this.rng() < this.skill.aim) {
      if (lit !== "none" && open) want.push("harbour");
      if (g.multiball) want.push("orbit");
      if (g.flags.some((f) => f)) want.push("flag");
      want.push("orbit", "lane");
    }
    for (const goal of want) {
      const hits = rows.filter((r) => (open ? r.open : r.up) === goal);
      if (hits.length) {
        // Aim for the middle of the widest run of good delays.
        const r = hits[Math.floor(hits.length / 2)]!;
        return r.d;
      }
    }
    return this.rng.range(0.05, 0.25);
  }
}

/** Ballistic guess (no walls) `tau` sim seconds ahead. */
function predict(s: Seen, tau: number): { x: number; y: number } {
  const t = Math.max(0, tau);
  return { x: s.x + s.vx * t, y: s.y + s.vy * t + 0.5 * GRAVITY * t * t };
}
