/**
 * The pilot: a thumb that plays Lintstorm through the same relative drag a player uses. It plays the attract demo
 * and the headless runs (scripts/pilot.ts, test/pilot.test.ts) at several skill levels.
 *
 * Every `react` seconds it looks at the sky, ignoring a share of the sparks (`blind`: what a player under pressure
 * doesn't see), and picks where to be from a grid of nearby spots: the safest one over the next `horizon` seconds,
 * nudged toward laundry to shoot (`hunt`) and loot to scoop (`greed`). Between looks it drags toward that spot no
 * faster than a thumb (`speed`), so a late or slow read gets it hit like a person.
 */
import type { Rng } from "@thumbcade-games/kit/rng";
import { HERO_R, type Sim } from "./sim.ts";

export interface Skill {
  name: string;
  /** Seconds between looks (uniform range). */
  react: [number, number];
  /** Fastest thumb, px/s. */
  speed: number;
  /** How far ahead it reads the sparks, seconds. */
  horizon: number;
  /** Share of sparks it never sees. */
  blind: number;
  /** 0..1 how keen it is to line up under enemies. */
  hunt: number;
  /** 0..1 how keen it is on coins and boxes. */
  greed: number;
  /** Extra margin it keeps from sparks, px. */
  margin: number;
  /** Perception lag: it sees each spark where it was this many seconds ago. */
  lag: number;
  /** Chance a look actually checks the sparks (the rest of the time it is busy with loot and aim). */
  attention: number;
}

export const SKILLS: Skill[] = [
  { name: "novice", react: [0.34, 0.55], speed: 420, horizon: 0.35, blind: 0.45, hunt: 0.35, greed: 0.25, margin: 1, lag: 0.24, attention: 0.55 },
  { name: "casual", react: [0.24, 0.38], speed: 600, horizon: 0.45, blind: 0.3, hunt: 0.55, greed: 0.5, margin: 3, lag: 0.17, attention: 0.7 },
  { name: "good", react: [0.15, 0.25], speed: 820, horizon: 0.56, blind: 0.17, hunt: 0.8, greed: 0.7, margin: 5, lag: 0.11, attention: 0.84 },
  { name: "expert", react: [0.09, 0.15], speed: 1150, horizon: 0.7, blind: 0.07, hunt: 0.85, greed: 0.8, margin: 8, lag: 0.06, attention: 0.94 },
];

/** The attract-mode player: good and showy, scoops everything. */
export const DEMO: Skill = { name: "demo", react: [0.1, 0.16], speed: 950, horizon: 0.7, blind: 0.03, hunt: 0.9, greed: 1, margin: 8, lag: 0.04, attention: 0.97 };

const DX = [-150, -100, -60, -30, 0, 30, 60, 100, 150];
const DY = [-90, -45, 0, 45, 90];

function seen(id: number, seed: number, blind: number): boolean {
  let h = Math.imul(id ^ 0x5bd1e995, 0x9e3779b1) ^ Math.imul(seed, 0x85ebca77);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296 >= blind;
}

export class Pilot {
  tx = 0;
  ty = 0;
  private wait = 0;
  private started = false;
  private readonly seed: number;

  constructor(
    readonly skill: Skill,
    readonly rng: Rng,
  ) {
    this.seed = Math.floor(rng() * 1e9);
  }

  /** The thumb's motion for this step. */
  step(sim: Sim, dt: number): [number, number] {
    const h = sim.hero;
    if (!h.alive) return [0, 0];
    if (!this.started) {
      this.started = true;
      this.tx = h.x;
      this.ty = h.y;
    }
    this.wait -= dt;
    if (this.wait <= 0) {
      this.wait = this.rng.range(this.skill.react[0], this.skill.react[1]);
      this.decide(sim);
    }
    const dx = this.tx - h.x;
    const dy = this.ty - h.y;
    const d = Math.hypot(dx, dy);
    const max = this.skill.speed * dt;
    if (d <= max) return [dx, dy];
    return [(dx / d) * max, (dy / d) * max];
  }

  private decide(sim: Sim): void {
    const s = this.skill;
    const h = sim.hero;
    const minX = 20;
    const maxX = sim.w - 20;
    const minY = sim.ceiling;
    const maxY = sim.h - 34;
    const prefY = sim.h * 0.8;
    const alert = this.rng() < s.attention;
    const sparks = alert ? sim.sparks.filter((b) => seen(b.id, this.seed, s.blind)) : [];
    const K = 6;
    let best = Infinity;
    let bx = h.x;
    let by = h.y;
    const consider = (cx: number, cy: number, sticky: number) => {
      cx = Math.min(maxX, Math.max(minX, cx));
      cy = Math.min(maxY, Math.max(minY, cy));
      const dist = Math.hypot(cx - h.x, cy - h.y);
      const tau = Math.max(1e-3, dist / s.speed);
      let cost = 0;
      for (let k = 1; k <= K; k++) {
        const ts = (s.horizon * k) / K;
        const f = Math.min(1, ts / tau);
        const px = h.x + (cx - h.x) * f;
        const py = h.y + (cy - h.y) * f;
        const early = 1.3 - ts / s.horizon;
        const tb = ts - s.lag;
        for (const b of sparks) {
          const qx = b.x + b.vx * tb - px;
          const qy = b.y + b.vy * tb - py;
          const rr = b.r * 0.75 + HERO_R + s.margin;
          const d2 = qx * qx + qy * qy;
          if (d2 < rr * rr) cost += 60 * early;
          else if (d2 < (rr + 40) * (rr + 40)) cost += 3 * Math.exp(-(Math.sqrt(d2) - rr) / 14);
        }
        for (const e of sim.enemies) {
          const qx = e.x + e.vx * ts - px;
          const qy = e.y + e.vy * ts - py;
          const rr = e.r * 0.72 + HERO_R + s.margin + 6;
          const d2 = qx * qx + qy * qy;
          if (d2 < rr * rr) cost += 60 * early;
        }
        const b = sim.boss;
        if (b) {
          const qx = (b.x + b.vx * ts - px) / (b.r * 0.85 + HERO_R + 12);
          const qy = (b.y + b.vy * ts - py) / (b.r * 0.75 + HERO_R + 12);
          if (qx * qx + qy * qy < 1) cost += 60 * early;
        }
      }
      // Where a player likes to be: low, off the walls, under something to shoot, near loot.
      cost += Math.abs(cy - prefY) * 0.012;
      if (cx < 45 || cx > sim.w - 45) cost += 0.8;
      let hunt = 0;
      for (const e of sim.enemies) {
        if (e.y > cy - 40 || e.y < sim.top) continue;
        hunt = Math.max(hunt, Math.exp(-Math.abs(cx - e.x) / 30) * (e.kind === "sweater" ? 1.4 : 1));
      }
      if (sim.boss && sim.boss.phase === "fight") hunt = Math.max(hunt, 1.3 * Math.exp(-Math.abs(cx - sim.boss.x) / 45));
      cost -= s.hunt * 1.2 * hunt;
      for (const p of sim.pickups) {
        const big = p.kind !== "coin" && p.kind !== "button";
        const want = p.kind === "heart" ? (h.hearts < 3 ? 4 : 0.5) : big ? 3 : 0.6;
        const qx = p.x + p.vx * tau - cx;
        const qy = p.y + Math.max(0, p.vy) * tau - cy;
        cost -= s.greed * want * Math.exp(-Math.hypot(qx, qy) / 45);
      }
      cost -= sticky;
      cost += this.rng() * 0.05;
      if (cost < best) {
        best = cost;
        bx = cx;
        by = cy;
      }
    };
    consider(this.tx, this.ty, 0.25);
    for (const dx of DX) for (const dy of DY) consider(h.x + dx, h.y + dy, 0);
    this.tx = bx;
    this.ty = by;
  }
}
