/**
 * Headless thumbs. A pilot looks at a few angles the way a player eyes the pile, picks the one that looks best,
 * wobbles a little and lets go. Skill is how many angles it weighs up, how steady its thumb is and how long it
 * takes to make up its mind.
 */
import type { Rng } from "@thumbcade-games/kit/rng";
import { MIN_ELEV, type Sim } from "./sim.ts";

export interface Skill {
  name: string;
  /** Angles weighed up per shot. */
  samples: number;
  /** Thumb wobble in radians. */
  jitter: number;
  /** Seconds spent aiming, [min, max]. */
  think: [number, number];
}

export const SKILLS: Skill[] = [
  { name: "novice", samples: 1, jitter: 0.14, think: [1.7, 3.2] },
  { name: "good", samples: 8, jitter: 0.05, think: [1.1, 2.1] },
  { name: "expert", samples: 26, jitter: 0.012, think: [0.7, 1.3] },
];
/** The attract demo: decent shots, an unhurried thumb. */
export const DEMO: Skill = { name: "demo", samples: 14, jitter: 0.02, think: [1.1, 1.5] };

export class Pilot {
  /** The shot being lined up (for the demo's guide), and how far through the aim it is (0-1). */
  target: [number, number] | null = null;
  progress = 0;
  private wait = -1;
  private total = 1;

  constructor(
    readonly skill: Skill,
    private readonly rng: Rng,
  ) {}

  step(sim: Sim, dt: number): void {
    if (sim.phase !== "aim") {
      this.wait = -1;
      this.target = null;
      return;
    }
    if (this.wait < 0) {
      this.total = this.wait = this.rng.range(this.skill.think[0], this.skill.think[1]);
      this.target = this.choose(sim);
    }
    this.wait -= dt;
    this.progress = 1 - Math.max(0, this.wait) / this.total;
    if (this.wait <= 0 && this.target) {
      sim.fire(this.target[0], this.target[1]);
      this.wait = -1;
      this.target = null;
    }
  }

  choose(sim: Sim): [number, number] {
    let best = Math.PI / 2;
    let bestV = -1;
    for (let i = 0; i < this.skill.samples; i++) {
      const a = this.rng.range(MIN_ELEV, Math.PI - MIN_ELEV);
      const v = sim.probe(Math.cos(a), -Math.sin(a));
      if (v > bestV) {
        bestV = v;
        best = a;
      }
    }
    best += (this.rng() * 2 - 1) * this.skill.jitter;
    return [Math.cos(best), -Math.sin(best)];
  }
}
