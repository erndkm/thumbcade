/**
 * Player models. A pilot sees what a player sees (the face-up cards, the top drawn card, how many lie face down)
 * and plays through the same taps: a card home when it spots one, a run moved to turn up a hidden card, the drawn
 * card onto a column, otherwise the pack. Skills differ in how long a look takes, how much they notice, and how
 * often a tap goes astray.
 */
import type { Rng } from "@thumbcade-games/kit/rng";
import type { Table } from "./cards.ts";
import { plays, type Target } from "./natural.ts";
import type { Run } from "./run.ts";

export interface Skill {
  name: string;
  /** Seconds studying the table before a tap. */
  look: [number, number];
  /** A tap on the pack takes this share of a look. */
  flick: number;
  /** Chance of noticing each kind of play that is there. */
  sees: number;
  /** Chance a tap lands on some other card. */
  slips: number;
  /** Chance of following the pen when it shows a way on. */
  heeds: number;
}

export const SKILLS: Record<string, Skill> = {
  novice: { name: "novice", look: [1.0, 1.8], flick: 0.6, sees: 0.5, slips: 0.14, heeds: 0.7 },
  casual: { name: "casual", look: [0.7, 1.25], flick: 0.5, sees: 0.68, slips: 0.08, heeds: 0.8 },
  good: { name: "good", look: [0.45, 0.8], flick: 0.42, sees: 0.85, slips: 0.035, heeds: 0.9 },
  expert: { name: "expert", look: [0.28, 0.5], flick: 0.36, sees: 0.96, slips: 0.01, heeds: 1 },
};

/** The attract-mode player: unhurried, misses nothing, never slips. */
export const DEMO: Skill = { name: "demo", look: [0.6, 0.95], flick: 0.55, sees: 1, slips: 0, heeds: 1 };

export const skillByName = (name: string): Skill | undefined => SKILLS[name];

/** Every tap that could do something, for a slip to pick from. */
function anyTaps(t: Table): Target[] {
  const out: Target[] = [{ kind: "stock" }];
  if (t.waste.length) out.push({ kind: "waste" });
  t.cols.forEach((c, col) => {
    if (c.up.length) out.push({ kind: "col", col, index: c.up.length - 1 }, { kind: "col", col, index: 0 });
  });
  return out;
}

export class Pilot {
  private wait = -1;
  private next: Target | null = null;

  constructor(readonly skill: Skill, private readonly rng: Rng) {}

  reset(): void {
    this.wait = -1;
    this.next = null;
  }

  private choose(run: Run): Target {
    const s = this.skill;
    const t = run.table;
    if (this.rng.chance(s.slips)) return this.rng.pick(anyTaps(t));
    if (run.hint && this.rng.chance(s.heeds)) return run.hint;
    for (const p of plays(t)) if (this.rng.chance(s.sees)) return p;
    return { kind: "stock" };
  }

  /** Advances the pilot by `dt`. Returns the tap it makes now, or null. */
  update(run: Run, dt: number): Target | null {
    if (run.over || run.phase !== "play") {
      this.wait = -1;
      return null;
    }
    if (this.wait < 0) {
      this.next = this.choose(run);
      const look = this.rng.range(this.skill.look[0], this.skill.look[1]);
      this.wait = this.next.kind === "stock" ? look * this.skill.flick : look;
    }
    this.wait -= dt;
    if (this.wait > 0) return null;
    this.wait = -1;
    return this.next;
  }
}

/** Plays a whole run with a pilot at 60 steps a second. */
export function playRun(run: Run, pilot: Pilot, maxSeconds = 300): Run {
  const dt = 1 / 60;
  if (!run.started) run.start();
  while (!run.over && run.time < maxSeconds) {
    const tap = pilot.update(run, dt);
    if (tap) run.tap(tap);
    run.think(Infinity);
    run.step(dt);
  }
  return run;
}
