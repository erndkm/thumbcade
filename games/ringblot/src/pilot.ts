/**
 * Headless thumbs. A pilot is a brain (the same one the rivals run on) looking a square ahead of the player's
 * beetle and swiping when the plan turns. Skill is how big a loop it dares, how long it dithers on its own print,
 * how late it notices a rival near its line, whether it goes for theirs, and how often its thumb misses a turn.
 */
import type { Rng } from "@thumbcade-games/kit/rng";
import { Brain, type BrainSpec } from "./brain.ts";
import { beside } from "./grid.ts";
import { HERO, HERO_SPEED, type Sim } from "./sim.ts";

export interface Skill extends BrainSpec {
  /** Seconds between looks at the sheet. */
  react: number;
  /** Chance that a look ends in a missed swipe: the beetle carries straight on a square too far. */
  fumble: number;
}

export const SKILLS: Skill[] = [
  { name: "novice", speed: HERO_SPEED, loop: [2, 3], rest: [0.7, 1.6], fear: 1, cut: 0, react: 0.05, fumble: 0.12 },
  { name: "good", speed: HERO_SPEED, loop: [3, 4], rest: [0.3, 0.8], fear: 2, cut: 2, react: 0.04, fumble: 0.05 },
  { name: "expert", speed: HERO_SPEED, loop: [4, 8], rest: [0, 0.15], fear: 4, cut: 3, wary: true, react: 0.03, fumble: 0 },
];
/** The attract demo: tidy loops, an unhurried thumb. */
export const DEMO: Skill = { name: "demo", speed: HERO_SPEED, loop: [3, 6], rest: [0.2, 0.5], fear: 4, cut: 3, wary: true, react: 0.04, fumble: 0 };

export class Pilot {
  private readonly brain: Brain;
  private wait = 0;

  constructor(
    readonly skill: Skill,
    private readonly rng: Rng,
  ) {
    this.brain = new Brain(skill, rng);
  }

  step(sim: Sim, dt: number): void {
    if (sim.phase !== "play") {
      this.brain.reset();
      return;
    }
    this.wait -= dt;
    if (this.wait > 0) return;
    this.wait = this.skill.react * (0.6 + this.rng() * 0.8);
    const h = sim.hero;
    if (h.dir < 0) {
      const d = this.brain.choose(sim, h);
      if (d >= 0) sim.steer(d);
      return;
    }
    // Think from the square he is about to reach.
    const next = beside(h.cell, h.dir);
    if (next < 0) return;
    const line = sim.owner[next] === HERO ? [] : [...h.line, next];
    const d = this.brain.choose(sim, { id: HERO, cell: next, line });
    if (d >= 0 && d !== h.dir && !this.rng.chance(this.skill.fumble)) sim.steer(d);
  }
}
