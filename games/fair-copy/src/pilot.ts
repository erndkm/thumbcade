import type { Rated } from "./board.ts";

/**
 * A player model for the word round: how often it finds a word, and which lengths it tends to spot. Everyday words
 * are found more readily than merely common ones. It drives the attract demo (the pen) and the headless playtests.
 */
export interface Skill {
  name: string;
  /** Seconds between words (uniform). */
  every: [number, number];
  /** Relative chance of spotting a word by length (index = letters; 8 stands for 8 and up). */
  byLength: number[];
  /** How much harder a common (not everyday) word is to spot. */
  commonFactor: number;
}

export const SKILLS: Record<"novice" | "casual" | "skilled" | "expert", Skill> = {
  novice: { name: "novice", every: [6, 9.5], byLength: [0, 0, 0, 1, 0.9, 0.35, 0.12, 0.04, 0.02], commonFactor: 0.15 },
  casual: { name: "casual", every: [4, 6.5], byLength: [0, 0, 0, 1, 1, 0.6, 0.3, 0.12, 0.06], commonFactor: 0.3 },
  skilled: { name: "skilled", every: [2.8, 4.4], byLength: [0, 0, 0, 0.8, 1, 0.9, 0.6, 0.35, 0.2], commonFactor: 0.5 },
  expert: { name: "expert", every: [1.9, 3], byLength: [0, 0, 0, 0.6, 1, 1, 0.9, 0.7, 0.5], commonFactor: 0.8 },
};

export interface Pick {
  word: string;
  path: number[];
}

export class WordPilot {
  private wait: number;
  constructor(
    readonly skill: Skill,
    private rand: () => number,
  ) {
    this.wait = this.gap() * 0.6;
  }

  private gap(): number {
    const [a, b] = this.skill.every;
    return a + (b - a) * this.rand();
  }

  /** A word it would find next among those not yet found, weighted by skill. */
  choose(rated: Rated, everyday: ReadonlySet<string>, found: ReadonlySet<string>, allow: (w: string) => boolean = () => true): Pick | null {
    let total = 0;
    const opts: Array<[string, number[], number]> = [];
    for (const [w, path] of rated.words) {
      if (found.has(w) || !allow(w)) continue;
      const wt = (this.skill.byLength[Math.min(8, w.length)] ?? 0) * (everyday.has(w) ? 1 : this.skill.commonFactor);
      if (wt <= 0) continue;
      total += wt;
      opts.push([w, path, wt]);
    }
    let x = this.rand() * total;
    for (const [w, path, wt] of opts) {
      x -= wt;
      if (x <= 0) return { word: w, path };
    }
    return null;
  }

  /** Counts down; returns true when it is time to submit the next word. */
  tick(dt: number): boolean {
    this.wait -= dt;
    if (this.wait > 0) return false;
    this.wait = this.gap();
    return true;
  }
}
