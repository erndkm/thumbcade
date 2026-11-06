import { CELLS, points, spell, timeBack, type Board } from "./board.ts";

/**
 * The rules of one round, with no drawing in them (the game and the headless pilots share it): a clock, a board,
 * and every word the player has found.
 */

export const TUNE = {
  /** Seconds on the clock. Long words buy a little back, but a round never runs past `ceiling` seconds. */
  clock: 70,
  ceiling: 90,
  /** A seal every this many words. */
  sealEvery: 4,
  /** Every tile used in at least one word: a bonus, once per round. */
  inkedPoints: 10,
  inkedSeconds: 3,
} as const;

export type Verdict =
  | { kind: "word"; word: string; points: number; seconds: number; seal: number | null; inked: boolean }
  | { kind: "again"; word: string }
  | { kind: "short"; word: string }
  | { kind: "unknown"; word: string };

export interface RoundStats {
  words: number;
  bestWord: string;
  bestPoints: number;
  longest: number;
  seconds: number;
}

export class Round {
  clock: number = TUNE.clock;
  score = 0;
  readonly found = new Map<string, number>();
  /** Order the words were found in. */
  readonly order: string[] = [];
  /** Bit per tile used in an accepted word. */
  inked = 0;
  allInked = false;
  elapsed = 0;
  over = false;

  constructor(
    readonly board: Board,
    private isWord: (w: string) => boolean,
  ) {}

  /** Burns the clock. Returns true on the frame the round ends. */
  step(dt: number): boolean {
    if (this.over) return false;
    this.elapsed += dt;
    this.clock -= dt;
    if (this.clock <= 0) {
      this.clock = 0;
      this.over = true;
      return true;
    }
    return false;
  }

  /** Checks a traced path without submitting it (for the live preview). */
  peek(path: readonly number[]): "short" | "again" | "word" | "unknown" {
    const w = spell(this.board, path);
    if (w.length < 3) return "short";
    if (this.found.has(w)) return "again";
    return this.isWord(w) ? "word" : "unknown";
  }

  /**
   * Judges a traced path. `late` lets a word traced before the bell (and waiting for the dictionary) count after it;
   * `trust` takes it without the dictionary, for words still waiting when the round has to be reported.
   */
  submit(path: readonly number[], o: { late?: boolean; trust?: boolean } = {}): Verdict {
    const word = spell(this.board, path);
    if ((this.over && !o.late) || word.length < 3) return { kind: "short", word };
    if (this.found.has(word)) return { kind: "again", word };
    if (!o.trust && !this.isWord(word)) return { kind: "unknown", word };
    let pts = points(word.length);
    let secs = timeBack(word.length);
    this.found.set(word, pts);
    this.order.push(word);
    for (const i of path) this.inked |= 1 << i;
    let inked = false;
    if (!this.allInked && this.inked === (1 << CELLS) - 1) {
      this.allInked = inked = true;
      pts += TUNE.inkedPoints;
      secs += TUNE.inkedSeconds;
    }
    this.score += pts;
    // Time back fills the page up to its ninety seconds, never past them.
    secs = Math.max(0, Math.min(secs, TUNE.ceiling - this.elapsed - this.clock));
    this.clock += secs;
    const seal = this.order.length % TUNE.sealEvery === 0 ? this.order.length : null;
    return { kind: "word", word, points: pts, seconds: secs, seal, inked };
  }

  get stats(): RoundStats {
    let bestWord = "";
    let bestPoints = 0;
    let longest = 0;
    for (const w of this.found.keys()) {
      const base = points(w.length);
      if (base > bestPoints || (base === bestPoints && w < bestWord)) {
        bestPoints = base;
        bestWord = w;
      }
      longest = Math.max(longest, w.length);
    }
    return { words: this.order.length, bestWord, bestPoints, longest, seconds: this.elapsed };
  }
}
