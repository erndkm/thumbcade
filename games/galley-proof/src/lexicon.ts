/**
 * Word lists (built by scripts/words.ts).
 *
 * - The accepted list ships packed: every word is five letters, so the file is the words back to back with no
 *   separators, sorted, and a binary search over it costs no parsing at all.
 * - The answers are a short newline-separated list, bundled with the code.
 */
import { LETTERS } from "./marks.ts";

/** Membership in a sorted list of fixed-width words, searched in place. */
export class PackedWords {
  readonly text: string;
  readonly size: number;
  constructor(text: string) {
    this.text = text.trim();
    this.size = Math.floor(this.text.length / LETTERS);
  }
  at(i: number): string {
    return this.text.slice(i * LETTERS, i * LETTERS + LETTERS);
  }
  has(word: string): boolean {
    if (word.length !== LETTERS) return false;
    let lo = 0;
    let hi = this.size - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      const w = this.at(mid);
      if (w === word) return true;
      if (w < word) lo = mid + 1;
      else hi = mid - 1;
    }
    return false;
  }
}

/** The answers file: one word per line. */
export const parseAnswers = (text: string): string[] => text.split("\n").map((w) => w.trim()).filter((w) => w.length === LETTERS);
