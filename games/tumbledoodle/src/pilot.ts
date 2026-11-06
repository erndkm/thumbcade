/**
 * The pilot: a virtual thumb that drags the hole the way a person does, through the same relative-drag target the
 * game uses. Skill changes how fast it drags, how often it re-decides, how far it looks, whether it sees the eraser
 * coming, and how often it lifts its thumb. Plays attract mode, the headless run lengths and the QA autoplay.
 */
import type { Rng } from "@thumbcade-games/kit/rng";
import { fits, gainOf, REST, type Doodle, type Game } from "./sim.ts";

export interface Skill {
  name: string;
  /** Finger speed while dragging, in view widths per second. */
  speed: number;
  /** Seconds between decisions. */
  think: [number, number];
  /** Steering error (radians, 1 sigma). */
  noise: number;
  /** Chance to notice a chasing eraser inside the danger range. */
  aware: number;
  /** Chance to chase a fleeing eraser. */
  hunt: number;
  /** Chance per decision to lift the thumb for a moment. */
  lift: number;
  liftT: [number, number];
  /** How far it looks for food, as a share of the view. */
  reach: number;
  /** 0 = the nearest thing, 1 = the richest crowd. */
  greed: number;
}

export const SKILLS = {
  novice: { name: "novice", speed: 0.62, think: [0.6, 1.0], noise: 0.55, aware: 0.2, hunt: 0.15, lift: 0.25, liftT: [0.4, 1.1], reach: 0.42, greed: 0.1 },
  casual: { name: "casual", speed: 0.9, think: [0.42, 0.75], noise: 0.36, aware: 0.45, hunt: 0.4, lift: 0.13, liftT: [0.3, 0.8], reach: 0.52, greed: 0.4 },
  good: { name: "good", speed: 1.25, think: [0.26, 0.46], noise: 0.2, aware: 0.78, hunt: 0.8, lift: 0.05, liftT: [0.25, 0.5], reach: 0.62, greed: 0.75 },
  expert: { name: "expert", speed: 1.65, think: [0.15, 0.3], noise: 0.11, aware: 0.95, hunt: 0.95, lift: 0.02, liftT: [0.2, 0.4], reach: 0.72, greed: 1 },
} satisfies Record<string, Skill>;

export type SkillName = keyof typeof SKILLS;

export function gauss(rng: Rng): number {
  const u = Math.max(1e-9, rng());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

export class Pilot {
  /** The dragged target (page units). */
  x: number;
  y: number;
  /** True while the thumb is down and moving. */
  dragging = false;
  private gx = 0;
  private gy = 0;
  private goal: Doodle | null = null;
  private chaseEraser = false;
  private err = 0;
  private planAt = 0;
  private liftUntil = 0;
  private evadeUntil = 0;
  private ex = 0;
  private ey = 0;

  constructor(
    readonly skill: Skill,
    private readonly rng: Rng,
    g: Game,
  ) {
    this.x = g.hole.x;
    this.y = g.hole.y;
    this.gx = g.hole.x;
    this.gy = g.hole.y;
  }

  /** Re-aims the target for this step (call before `g.step`). */
  control(g: Game): void {
    const h = g.hole;
    const sk = this.skill;
    const t = g.time;
    if (g.phase !== "play") {
      this.dragging = false;
      return;
    }
    if (t >= this.planAt || (this.goal && this.goal.state !== REST) || (!this.chaseEraser && !this.goal && Math.hypot(this.gx - h.x, this.gy - h.y) < h.r)) this.plan(g);
    if (t < this.liftUntil) {
      this.dragging = false;
      return;
    }
    let dx: number;
    let dy: number;
    if (t < this.evadeUntil) {
      dx = this.ex;
      dy = this.ey;
    } else {
      if (this.chaseEraser && g.eraser) {
        this.gx = g.eraser.x + (g.eraser.x - g.eraser.px) * 18;
        this.gy = g.eraser.y + (g.eraser.y - g.eraser.py) * 18;
      } else if (this.goal) {
        this.gx = this.goal.x;
        this.gy = this.goal.y;
      }
      const a = Math.atan2(this.gy - h.y, this.gx - h.x) + this.err;
      const d = Math.hypot(this.gx - h.x, this.gy - h.y);
      if (d < h.r * 0.25) {
        this.dragging = false;
        return;
      }
      dx = Math.cos(a);
      dy = Math.sin(a);
    }
    // Relative drag: the thumb's travel moves the target, and the hole follows the target.
    const v = sk.speed * g.view * gainOf(h.tier) * (1 / 60);
    this.x += dx * v;
    this.y += dy * v;
    const p = { x: this.x, y: this.y };
    g.clampTarget(p);
    this.x = p.x;
    this.y = p.y;
    this.dragging = true;
  }

  private plan(g: Game): void {
    const sk = this.skill;
    const rng = this.rng;
    const h = g.hole;
    const view = g.view;
    this.planAt = g.time + sk.think[0] + rng() * (sk.think[1] - sk.think[0]);
    this.err = gauss(rng) * sk.noise;
    this.chaseEraser = false;
    if (rng() < sk.lift) this.liftUntil = g.time + sk.liftT[0] + rng() * (sk.liftT[1] - sk.liftT[0]);
    const e = g.eraser;
    if (e && e.state === "chase") {
      const d = Math.hypot(e.x - h.x, e.y - h.y);
      if (d < view * 0.42 && rng() < sk.aware) {
        // Step aside, a quarter turn off the eraser's line, toward the side with more page.
        const ax = h.x - e.x;
        const ay = h.y - e.y;
        const l = Math.hypot(ax, ay) || 1;
        const side = Math.sign((h.x - 650) * -ay / l + (h.y - 1300) * ax / l) || 1;
        const turn = -side * (1.05 + rng() * 0.35);
        const c = Math.cos(turn);
        const s = Math.sin(turn);
        this.ex = (ax / l) * c - (ay / l) * s;
        this.ey = (ax / l) * s + (ay / l) * c;
        this.evadeUntil = g.time + 0.45 + rng() * 0.3;
        this.goal = null;
        return;
      }
    }
    if (e && e.state === "flee" && Math.hypot(e.x - h.x, e.y - h.y) < view * 1.3 && rng() < sk.hunt) {
      this.chaseEraser = true;
      this.goal = null;
      return;
    }
    // Food: the best-looking thing in reach (better players weigh the crowd around it).
    const reach = view * sk.reach;
    let best: Doodle | null = null;
    let bestScore = -1;
    const cands: Doodle[] = [];
    g.query(h.x, h.y, reach, (d) => {
      if (d.state !== REST || !fits(d.s, h.r)) return;
      const dd = Math.hypot(d.x - h.x, d.y - h.y);
      if (dd > reach) return;
      cands.push(d);
    });
    if (cands.length > 48) {
      cands.sort((a, b) => Math.hypot(a.x - h.x, a.y - h.y) - Math.hypot(b.x - h.x, b.y - h.y));
      cands.length = 48;
    }
    for (const d of cands) {
      const dd = Math.hypot(d.x - h.x, d.y - h.y);
      let food = d.s * d.s;
      if (sk.greed > 0) {
        let crowd = 0;
        for (const o of cands) if (o !== d && Math.hypot(o.x - d.x, o.y - d.y) < h.r * 1.8) crowd += o.s * o.s;
        food += crowd * sk.greed;
      }
      const danger = e && e.state === "chase" ? Math.max(0, 1 - Math.hypot(e.x - d.x, e.y - d.y) / (view * 0.35)) * sk.aware : 0;
      const score = (food / (dd + h.r * 1.5) ** (1 + (1 - sk.greed) * 0.6)) * (1 - danger * 0.85) * (0.75 + rng() * 0.5);
      if (score > bestScore) {
        bestScore = score;
        best = d;
      }
    }
    this.goal = best;
    if (!best) {
      // Nothing edible in sight: head for the middle of the page, where it hasn't eaten yet.
      const a = Math.atan2(1300 - h.y, 650 - h.x) + (rng() - 0.5) * 2;
      this.gx = h.x + Math.cos(a) * view * 0.5;
      this.gy = h.y + Math.sin(a) * view * 0.5;
    }
  }
}
