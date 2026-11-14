/**
 * Player models. A pilot looks at the rug the way a player does: each look, it notices some of the cats whose way
 * is clear, taps one of them after a moment, and now and then taps a cat that is stuck. Skills differ in how long a
 * look takes, how much of the rug they take in, and how often they misjudge.
 */
import type { Rng } from "@thumbcade-games/kit/rng";
import { EMPTY, occupancy, wayOf, type Cat } from "./board.ts";
import type { Run } from "./run.ts";

export interface Skill {
  name: string;
  /** Seconds studying the rug before a tap. */
  look: [number, number];
  /** Chance of spotting each free cat in one look. */
  sees: number;
  /** Chance a tap goes to a cat that is stuck. */
  slips: number;
  /** Chance of remembering to keep the witch's cat for last. */
  manners: number;
}

export const SKILLS: Record<string, Skill> = {
  novice: { name: "novice", look: [0.95, 1.7], sees: 0.5, slips: 0.2, manners: 0.1 },
  casual: { name: "casual", look: [0.65, 1.15], sees: 0.65, slips: 0.11, manners: 0.35 },
  good: { name: "good", look: [0.42, 0.75], sees: 0.82, slips: 0.05, manners: 0.75 },
  expert: { name: "expert", look: [0.27, 0.46], sees: 0.94, slips: 0.015, manners: 0.97 },
};

/** The attract-mode player: unhurried, never wrong, polite to the witch's cat. */
export const DEMO: Skill = { name: "demo", look: [0.7, 1.1], sees: 1, slips: 0, manners: 1 };

export const skillByName = (name: string): Skill | undefined => SKILLS[name];

export class Pilot {
  private wait = -1;
  private polite = false;
  private rug = -1;

  constructor(readonly skill: Skill, private readonly rng: Rng) {}

  reset(): void {
    this.wait = -1;
    this.rug = -1;
  }

  /** Advances the pilot by `dt`. Returns the id of the cat it taps now, or -1. */
  update(run: Run, dt: number): number {
    if (run.over || run.phase !== "play") return -1;
    const s = this.skill;
    if (run.level !== this.rug) {
      this.rug = run.level;
      this.polite = this.rng.chance(s.manners);
      this.wait = this.rng.range(s.look[0], s.look[1]) * 1.3;
    }
    if (this.wait < 0) this.wait = this.rng.range(s.look[0], s.look[1]);
    this.wait -= dt;
    if (this.wait > 0) return -1;
    this.wait = -1;
    const b = run.board;
    const occ = occupancy(b);
    const left = b.cats.filter((c) => !c.out);
    const free: Cat[] = [];
    const stuck: Cat[] = [];
    for (const c of left) (wayOf(b, c, occ).by === EMPTY ? free : stuck).push(c);
    if (stuck.length && this.rng.chance(s.slips)) return this.rng.pick(stuck).id;
    let seen = free.filter(() => this.rng.chance(s.sees));
    // Keeping the witch's cat for last, when there is anyone else to send first.
    if (this.polite && left.length > 1) seen = seen.filter((c) => c.coat !== 0);
    if (seen.length === 0) return -1;
    return this.rng.pick(seen).id;
  }
}

/** Plays a whole run with a pilot at 60 steps a second. */
export function playRun(run: Run, pilot: Pilot, maxSeconds = 300): Run {
  const dt = 1 / 60;
  if (!run.started) run.start();
  while (!run.over && run.time < maxSeconds) {
    const id = pilot.update(run, dt);
    if (id >= 0) run.tap(id);
    run.step(dt);
  }
  return run;
}
