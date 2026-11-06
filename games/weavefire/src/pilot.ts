/**
 * The pilot: flies the ship like a thumb would. It plays the attract demo and the headless playtests.
 *
 * Every `think` seconds it looks at the bullets and enemies near the ship (with some perception noise), tries a
 * handful of moves over a short horizon, and picks the one that keeps the most room while lining up shots and
 * steering into pickups. Between thinks it keeps drifting the way it chose, at no more than a thumb's speed.
 * Skill sets how often it looks, how far ahead it sees, how fast and precisely it moves, and how often it zones out.
 */
import { createRng, type Rng } from "@thumbcade-games/kit/rng";
import { FIELD_W, SHIP_HIT_R } from "./consts.ts";
import type { Sim } from "./sim.ts";

export interface Skill {
  name: string;
  /** Seconds between decisions. */
  think: number;
  /** How far ahead (s) it predicts. */
  horizon: number;
  /** Top thumb speed in field units per second. */
  speed: number;
  /** Perception noise on bullet positions (field units). */
  noise: number;
  /** Chance per second of zoning out for `lapseLen` seconds. */
  lapse: number;
  lapseLen: number;
  /** Room it wants around the hitbox (field units). */
  margin: number;
  /** How much it cares about pickups (0-1). */
  greed: number;
  /** Does it skim bullets on purpose? (0-1) */
  graze: number;
  /** How many of the nearest bullets it can keep track of at once. */
  attention: number;
  /** A bullet younger than this (s) hasn't been noticed yet. */
  react: number;
  /** Motor error: how far the executed move strays from the intended one (0-1). */
  motor: number;
  /** Error in judging a bullet's speed and direction (fraction of its velocity). */
  judge: number;
}

export const SKILLS = {
  novice: { name: "novice", think: 0.26, horizon: 0.34, speed: 380, noise: 9, lapse: 0.12, lapseLen: 0.6, margin: 6, greed: 0.35, graze: 0, attention: 5, react: 0.34, motor: 0.45, judge: 0.22 },
  casual: { name: "casual", think: 0.19, horizon: 0.42, speed: 560, noise: 6, lapse: 0.06, lapseLen: 0.5, margin: 7, greed: 0.6, graze: 0, attention: 8, react: 0.28, motor: 0.3, judge: 0.16 },
  good: { name: "good", think: 0.14, horizon: 0.52, speed: 780, noise: 4, lapse: 0.03, lapseLen: 0.4, margin: 8, greed: 0.85, graze: 0.2, attention: 12, react: 0.23, motor: 0.2, judge: 0.11 },
  expert: { name: "expert", think: 0.1, horizon: 0.62, speed: 1000, noise: 3, lapse: 0.012, lapseLen: 0.32, margin: 8, greed: 1, graze: 0.5, attention: 18, react: 0.19, motor: 0.12, judge: 0.08 },
} as const satisfies Record<string, Skill>;

export type SkillName = keyof typeof SKILLS;

const DIRS = 16;
/** Look-ahead times (s); the ones past the skill's horizon are skipped. Dense early, so a fast move is checked all along. */
const TIMES = [0.025, 0.05, 0.08, 0.12, 0.17, 0.23, 0.3, 0.38, 0.47, 0.57, 0.68, 0.8] as const;

export class Pilot {
  private readonly rng: Rng;
  private vx = 0;
  private vy = 0;
  private wait = 0;
  private lapseLeft = 0;
  /** Where the pilot wants the ship to be at the end of its current move (for the demo's ghost finger). */
  targetX = 0;
  targetY = 0;
  private readonly cx = new Float32Array(DIRS * 2 + 1);
  private readonly cy = new Float32Array(DIRS * 2 + 1);
  /** Per-think perception error for each bullet (how far off the pilot thinks it is). */
  private readonly nx = new Float32Array(64);
  private readonly ny = new Float32Array(64);
  private readonly jv = new Float32Array(64);
  private readonly ja = new Float32Array(64);
  /** The bullets it is paying attention to this think (indices into sim.bullets). */
  private readonly seen = new Int32Array(64);
  private readonly seenD = new Float32Array(64);

  constructor(
    public skill: Skill,
    seed: number,
  ) {
    this.rng = createRng(seed);
  }

  /** Decides (when due) and moves the ship for `dt` seconds. Call before `sim.step(dt)`. */
  update(sim: Sim, dt: number): void {
    const sk = this.skill;
    if (!sim.ship.alive) return;
    if (this.lapseLeft > 0) this.lapseLeft -= dt;
    else if (this.rng() < sk.lapse * dt) this.lapseLeft = sk.lapseLen * (0.6 + this.rng() * 0.8);
    this.wait -= dt;
    if (this.wait <= 0 && this.lapseLeft <= 0) {
      this.wait += sk.think * (0.8 + this.rng() * 0.4);
      if (this.wait < 0) this.wait = 0;
      this.decide(sim);
    }
    // A lapse keeps the thumb moving the way it was, slowing down.
    if (this.lapseLeft > 0) {
      const k = Math.exp(-4 * dt);
      this.vx *= k;
      this.vy *= k;
    }
    sim.moveShip(this.vx * dt, this.vy * dt);
  }

  private decide(sim: Sim): void {
    const sk = this.skill;
    const s = sim.ship;
    // Candidate velocities: stay, plus 16 directions at full and half speed.
    let n = 0;
    this.cx[n] = 0;
    this.cy[n] = 0;
    n++;
    for (let i = 0; i < DIRS * 2; i++) {
      const a = ((i >> 1) / DIRS) * Math.PI * 2;
      const f = i & 1 ? 0.45 : 1;
      this.cx[n] = Math.cos(a) * sk.speed * f;
      this.cy[n] = Math.sin(a) * sk.speed * f;
      n++;
    }
    // What to line up under: the enemy that's most worth shooting.
    let aimX = FIELD_W / 2;
    let bestAim = -Infinity;
    for (let i = 0; i < sim.enemies.length; i++) {
      const e = sim.enemies[i]!;
      if (!e.entered || e.t < 0 || e.y < 10 || e.y > s.y - 40 || e.armor) continue;
      const w = (e.kind === "arm" ? 3 : e.kind === "core" ? 4 : e.kind === "skiff" ? 2.5 : e.kind === "bastion" ? 2 : 1) - Math.abs(e.x - s.x) / 120 - (s.y - e.y) / 600;
      if (w > bestAim) {
        bestAim = w;
        aimX = e.x;
      }
    }
    // The pickup it wants most.
    let pick: { x: number; y: number } | null = null;
    let pickD = Infinity;
    for (let i = 0; i < sim.pickups.length; i++) {
      const p = sim.pickups[i]!;
      if (p.y < sim.shipMinY - 80) continue;
      const d = Math.hypot(p.x - s.x, p.y - s.y);
      if (d < pickD) {
        pickD = d;
        pick = p;
      }
    }
    const prefY = sim.shipMinY + (sim.shipMaxY - sim.shipMinY) * 0.68;
    // Attention: only the nearest few bullets it has had time to notice.
    const K = Math.min(64, sk.attention);
    let nb = 0;
    for (let i = 0; i < sim.bullets.length; i++) {
      const b = sim.bullets[i]!;
      if (b.t < sk.react) continue;
      const dx = b.x - s.x;
      const dy = b.y - s.y;
      const d2 = dx * dx + dy * dy;
      if (d2 > 200 * 200) continue;
      if (nb < K) {
        let j = nb++;
        while (j > 0 && this.seenD[j - 1]! > d2) {
          this.seenD[j] = this.seenD[j - 1]!;
          this.seen[j] = this.seen[j - 1]!;
          j--;
        }
        this.seenD[j] = d2;
        this.seen[j] = i;
      } else if (d2 < this.seenD[K - 1]!) {
        let j = K - 1;
        while (j > 0 && this.seenD[j - 1]! > d2) {
          this.seenD[j] = this.seenD[j - 1]!;
          this.seen[j] = this.seen[j - 1]!;
          j--;
        }
        this.seenD[j] = d2;
        this.seen[j] = i;
      }
    }
    for (let i = 0; i < nb; i++) {
      this.nx[i] = (this.rng() - 0.5) * 2 * sk.noise;
      this.ny[i] = (this.rng() - 0.5) * 2 * sk.noise;
      // Misjudged speed and heading: predictions drift further off the further ahead they look.
      this.jv[i] = 1 + (this.rng() - 0.5) * 2 * sk.judge;
      this.ja[i] = (this.rng() - 0.5) * 2 * sk.judge * 0.6;
    }
    const room = sk.margin;
    const moveFor = sk.think * 1.4;
    let best = 0;
    let bestCost = Infinity;
    for (let c = 0; c < n; c++) {
      const vx = this.cx[c]!;
      const vy = this.cy[c]!;
      let cost = 0;
      // Danger along the move: the thumb moves for about one think, then holds; bullets keep coming.
      for (let k = 0; k < TIMES.length; k++) {
        const t = TIMES[k]!;
        if (t > sk.horizon) break;
        const mt = t < moveFor ? t : moveFor;
        const px = clamp(s.x + vx * mt, 14, FIELD_W - 14);
        const py = clamp(s.y + vy * mt, sim.shipMinY, sim.shipMaxY);
        const w = 1.5 - t / sk.horizon;
        for (let i = 0; i < nb; i++) {
          const b = sim.bullets[this.seen[i]!]!;
          const jv = this.jv[i]!;
          const ja = this.ja[i]!;
          const bvx = (b.vx - b.vy * ja) * jv;
          const bvy = (b.vy + b.vx * ja) * jv;
          const bx = b.x + bvx * t + this.nx[i]!;
          const by = b.y + bvy * t + this.ny[i]!;
          const dx = bx - px;
          const dy = by - py;
          if (dx > 50 || dx < -50 || dy > 50 || dy < -50) continue;
          const d = Math.sqrt(dx * dx + dy * dy) - b.r - SHIP_HIT_R;
          if (d < room) cost += w * (room - d) * (room - d) * 4 + (d < 0 ? 500 * w : 0);
          else if (sk.graze > 0 && d < room + 9) cost -= sk.graze * 1.2;
        }
        for (let i = 0; i < sim.enemies.length; i++) {
          const e = sim.enemies[i]!;
          if (!e.solid || !e.entered || e.t < 0) continue;
          const dx = e.x - px;
          const dy = e.y - py;
          const rr = e.r + 18;
          const d2 = dx * dx + dy * dy;
          if (d2 < rr * rr) cost += w * 400 * (1 - Math.sqrt(d2) / rr);
        }
      }
      const ex = clamp(s.x + vx * moveFor, 14, FIELD_W - 14);
      const ey = clamp(s.y + vy * moveFor, sim.shipMinY, sim.shipMaxY);
      cost += Math.abs(ex - aimX) * 0.07;
      // The demo pilot keeps to the middle of the stage.
      if (sim.attract) cost += Math.abs(ex - FIELD_W / 2) * 0.05;
      cost += Math.abs(ey - prefY) * 0.025;
      if (pick) cost += Math.hypot(pick.x - ex, pick.y - ey) * 0.12 * sk.greed;
      // Small preference for smooth motion.
      cost += Math.hypot(vx - this.vx, vy - this.vy) * 0.002;
      if (cost < bestCost) {
        bestCost = cost;
        best = c;
      }
    }
    // The thumb never does exactly what was meant.
    const ang = (this.rng() - 0.5) * sk.motor * 1.4;
    const mag = 1 + (this.rng() - 0.5) * sk.motor;
    const bx = this.cx[best]!;
    const by = this.cy[best]!;
    this.vx = (bx * Math.cos(ang) - by * Math.sin(ang)) * mag;
    this.vy = (bx * Math.sin(ang) + by * Math.cos(ang)) * mag;
    this.targetX = s.x + this.vx * sk.think;
    this.targetY = s.y + this.vy * sk.think;
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
