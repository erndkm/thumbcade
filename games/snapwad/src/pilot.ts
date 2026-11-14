/**
 * The pilot: a virtual thumb that pulls the band the way a person does, through the same drag the game reads
 * (dragFor / aimFromDrag), at four skill levels. It picks something to hit, solves the flight for it on the real
 * stepped path, and misses by its skill's hand. Plays attract mode, the headless run lengths and the QA autoplay.
 *
 * Skill changes how long it thinks, how far its aim and pull wander, whether it checks what's in the way of the
 * flight, whether it goes for what holds a doodle up instead of the doodle, and whether it ever lobs.
 */
import type { Rng } from "@thumbcade-games/kit/rng";
import { dragFor, firstHit, powerFor, velocityOf } from "./aim.ts";
import { GRAVITY } from "./physics.ts";
import type { Run } from "./game.ts";
import { isMite, isShot, MITES, specOf, type MiteKind } from "./pieces.ts";

export interface Skill {
  name: string;
  /** Seconds it looks before it pulls, once the page is quiet enough. */
  think: [number, number];
  /** Seconds it takes to pull back, and to hold the pull. */
  pull: [number, number];
  /** Aim error (radians) and pull error (share of a full pull), 1 sigma. */
  angleNoise: number;
  powerNoise: number;
  /** Chance it checks what's in the way of a flight. */
  sees: number;
  /** Chance it goes for what holds a doodle up (a topple) when that's better. */
  smart: number;
  /** Chance it tries lobs over a wall. */
  lob: number;
  /** Seconds after a shot before it looks again, and whether it waits for the fort to go still. */
  wait: number;
  calm: boolean;
  /** How far off its sense of the band's strength starts (share of a full pull, 1 sigma); it learns a third of it back per shot. */
  bias: number;
}

export const SKILLS = {
  novice: { name: "novice", think: [0.7, 1.5], pull: [0.35, 0.7], angleNoise: 0.16, powerNoise: 0.16, sees: 0.15, smart: 0, lob: 0.1, wait: 0.6, calm: false, bias: 0.25 },
  casual: { name: "casual", think: [0.8, 1.5], pull: [0.3, 0.6], angleNoise: 0.085, powerNoise: 0.09, sees: 0.5, smart: 0.3, lob: 0.35, wait: 0.55, calm: false, bias: 0.1 },
  good: { name: "good", think: [0.9, 1.6], pull: [0.3, 0.5], angleNoise: 0.05, powerNoise: 0.055, sees: 0.85, smart: 0.65, lob: 0.7, wait: 0.5, calm: false, bias: 0.05 },
  expert: { name: "expert", think: [0.8, 1.4], pull: [0.25, 0.45], angleNoise: 0.03, powerNoise: 0.03, sees: 1, smart: 0.9, lob: 0.9, wait: 0.45, calm: false, bias: 0 },
} satisfies Record<string, Skill>;

export type SkillName = keyof typeof SKILLS;

export function gauss(rng: Rng): number {
  const u = Math.max(1e-9, rng());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

interface Plan {
  angle: number;
  power: number;
  score: number;
}

export class Pilot {
  /** The thumb: down or not, and the drag so far (CSS px from where it went down). */
  down = false;
  dx = 0;
  dy = 0;
  /** Where the thumb went down (share of the screen), for the drawn ghost thumb. */
  ax = 0.62;
  ay = 0.72;
  private t = 0;
  private stage: "wait" | "think" | "pull" | "hold" = "wait";
  private stageT = 0;
  private plan: Plan | null = null;
  private pullT = 0.5;
  private holdT = 0.1;
  private gx = 0;
  private gy = 0;

  private bias: number;

  constructor(
    readonly skill: Skill,
    private readonly rng: Rng,
  ) {
    this.bias = gauss(rng) * skill.bias;
  }

  /** One fixed step. Returns a release (the drag at let-go) on the step the thumb comes up, else null. */
  update(run: Run, dt: number): { dx: number; dy: number } | null {
    this.t += dt;
    this.stageT += dt;
    const s = this.skill;
    const ready = run.phase === "play" && run.ammo > 0 && run.reload <= 0;
    switch (this.stage) {
      case "wait": {
        const quiet = !run.flying && run.sinceLanding >= s.wait && (!s.calm || run.desk.calm() || run.sinceLanding > 3);
        if (ready && quiet) {
          this.stage = "think";
          this.stageT = 0;
          this.thinkT = this.rng.range(s.think[0], s.think[1]) * (run.pageShots === 0 ? 1.15 : 1);
        }
        return null;
      }
      case "think": {
        if (run.phase !== "play") {
          this.reset();
          return null;
        }
        if (this.stageT < this.thinkT) return null;
        this.learn(run);
        this.plan = this.choose(run);
        if (this.plan) this.tried.push({ page: run.page, angle: this.plan.angle, power: this.plan.power, kos: run.stats.kos, shots: run.stats.shots });
        if (!this.plan) {
          this.reset();
          return null;
        }
        const g = dragFor(this.plan.angle, this.plan.power);
        this.gx = g.dx;
        this.gy = g.dy;
        this.pullT = this.rng.range(s.pull[0], s.pull[1]);
        this.holdT = this.rng.range(0.05, 0.25);
        this.ax = this.rng.range(0.45, 0.72);
        this.ay = this.rng.range(0.55, 0.7);
        this.down = true;
        this.dx = 0;
        this.dy = 0;
        this.stage = "pull";
        this.stageT = 0;
        return null;
      }
      case "pull": {
        const k = Math.min(1, this.stageT / this.pullT);
        const e = 1 - (1 - k) ** 2;
        this.dx = this.gx * e;
        this.dy = this.gy * e;
        if (k >= 1) {
          this.stage = "hold";
          this.stageT = 0;
        }
        return null;
      }
      case "hold": {
        if (this.stageT < this.holdT) return null;
        const out = { dx: this.gx, dy: this.gy };
        this.reset();
        return out;
      }
    }
  }

  private thinkT = 1;
  /** What it tried on this page, and whether that knocked anything out (a good thumb doesn't repeat a dud). */
  private tried: Array<{ page: number; angle: number; power: number; kos: number; shots: number; dud?: boolean }> = [];

  private learn(run: Run): void {
    this.tried = this.tried.filter((t) => t.page === run.page);
    const last = this.tried[this.tried.length - 1];
    if (last && last.dud === undefined && run.stats.shots > last.shots) last.dud = run.stats.kos === last.kos;
  }

  /** How much a plan looks like a dud it already tried here (0 = nothing like it). */
  private dudness(angle: number, power: number): number {
    let d = 0;
    for (const t of this.tried) if (t.dud && Math.abs(t.angle - angle) < 0.07 && Math.abs(t.power - power) < 0.09) d++;
    return d;
  }

  private reset(): void {
    this.stage = "wait";
    this.stageT = 0;
    this.down = false;
    this.dx = 0;
    this.dy = 0;
    this.plan = null;
  }

  /** Cancel whatever it was doing (a new page, a paused card). */
  cancel(): void {
    this.reset();
  }

  /** Picks a shot and adds its skill's error. */
  choose(run: Run): Plan | null {
    const s = this.skill;
    const live = run.desk.live();
    if (live.length === 0) return null;
    const sees = this.rng.chance(s.sees);
    const smart = this.rng.chance(s.smart);
    const lob = this.rng.chance(s.lob);
    let best: Plan | null = null;
    const targets = sees ? live : [this.rng.pick(live)];
    for (const m of targets) {
      const p = m.body.getPosition();
      const hh = MITES[m.kind as MiteKind].hh * m.s;
      // Aim points: the doodle (a little above its middle, so a hit tips it), and, for a smart thumb, the top of
      // each piece near it (a hard sideways hit there topples the fort onto it).
      const points: Array<[number, number]> = [[p.x - 0.05, p.y + hh * 0.25]];
      if (smart) {
        for (const t of run.desk.things) {
          if (t.gone || isMite(t.kind) || isShot(t.kind)) continue;
          const q = t.body.getPosition();
          if (Math.hypot(q.x - p.x, q.y - p.y) > 1.7) continue;
          const sp = specOf(t.kind);
          const a = t.body.getAngle();
          const ext = Math.abs(Math.sin(a)) * sp.hw + Math.abs(Math.cos(a)) * sp.hh;
          const exx = Math.abs(Math.cos(a)) * sp.hw + Math.abs(Math.sin(a)) * sp.hh;
          points.push([q.x - exx * 0.9, q.y + ext * 0.55]);
        }
      }
      for (const [tx, ty] of points) {
        const angles: number[] = [];
        for (let a = 0.12; a <= (lob ? 1.45 : 1.0); a += sees ? 0.06 : 0.12) angles.push(a);
        if (!sees) angles.sort(() => this.rng() - 0.5);
        for (const a of angles) {
          const pw = powerFor(a, tx, ty);
          if (pw === null) continue;
          let score = 1 - a * 0.3;
          if (sees) {
            const h = firstHit(run.desk, a, pw);
            const v = velocityOf(a, pw);
            const vx = v.vx;
            const vy = v.vy - GRAVITY * (h?.t ?? 0);
            if (!h) score -= 5;
            else if (h.thing === m) score += 6 + Math.min(1.5, Math.hypot(vx, vy) / 8);
            else if (h.thing && isMite(h.thing.kind)) score += 5.5;
            else if (h.thing) {
              // A piece near the doodle: a topple, the better the harder it's hit sideways.
              const d = Math.hypot(h.x - p.x, h.y - p.y);
              score += (d < 1.3 ? 3.5 : d < 2.3 ? 1.5 : 0.4) + Math.min(2, Math.abs(vx) / 5);
            } else score -= 3;
          }
          // A little variety among near-equal shots, and none of the duds again (if it sees what it did).
          score += this.rng() * 0.3;
          if (sees) score -= this.dudness(a, pw) * 3;
          if (!best || score > best.score) best = { angle: a, power: pw, score };
          if (!sees) break;
        }
        if (!sees && best) break;
      }
    }
    if (!best) {
      // Nothing solved: a hopeful full pull at the page.
      best = { angle: 0.9, power: 0.95, score: 0 };
    }
    const bias = this.bias;
    this.bias *= 0.67;
    return {
      angle: best.angle + gauss(this.rng) * s.angleNoise,
      power: Math.max(0, Math.min(1, best.power + bias + gauss(this.rng) * s.powerNoise)),
      score: best.score,
    };
  }
}
