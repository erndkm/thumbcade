import { choose, DRAW, plays, type Move, type Policy } from "./deal.ts";
import type { Run } from "./run.ts";

/**
 * A player model: how it picks a move, how long each tap takes, and how often it misses a card that would have
 * gone (and draws instead). It plays the attract demo and the headless playtests below.
 */
export interface Skill {
  name: string;
  policy: Policy;
  /** Seconds per decision (uniform). */
  think: [number, number];
  /** Chance of overlooking every play and drawing anyway. */
  miss: number;
}

export const SKILLS: Record<"novice" | "casual" | "skilled" | "expert", Skill> = {
  novice: { name: "novice", policy: "random", think: [1.0, 1.5], miss: 0.08 },
  casual: { name: "casual", policy: "greedy", think: [0.7, 1.0], miss: 0.06 },
  skilled: { name: "skilled", policy: "planner", think: [0.5, 0.75], miss: 0.03 },
  expert: { name: "expert", policy: "planner", think: [0.38, 0.55], miss: 0.01 },
};

export class Pilot {
  private wait: number;
  constructor(
    readonly skill: Skill,
    private rand: () => number,
  ) {
    this.wait = this.think();
  }
  private think(): number {
    const [a, b] = this.skill.think;
    return a + (b - a) * this.rand();
  }
  /** The move it makes this frame, if any. */
  update(run: Run, dt: number): Move | null {
    if (run.phase !== "play") {
      this.wait = Math.max(this.wait, this.think() * 0.6);
      return null;
    }
    this.wait -= dt;
    if (this.wait > 0) return null;
    this.wait = this.think();
    const options = plays(run.deal, run.pos);
    if (options.length && run.canDraw && this.rand() < this.skill.miss) return DRAW;
    return choose(run.deal, run.pos, this.skill.policy, this.rand);
  }
}

/** Applies a pilot's move to the run. */
export function act(run: Run, m: Move | null): void {
  if (m === null) return;
  if (m === DRAW) run.draw();
  else run.play(m);
}
