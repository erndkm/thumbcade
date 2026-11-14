/**
 * The proofreader's marks. A written line gets one mark per letter:
 *   RING   (2) the right letter in the right place, ringed in vermilion;
 *   RULE   (1) in the word, but elsewhere: an ink line under it;
 *   STRUCK (0) not in the word (or not that many times): struck through.
 *
 * Duplicates are marked exactly: rings first, then each remaining letter of the line takes a rule only while the
 * hidden word still has an unmatched copy of it, left to right; any copy beyond that is struck.
 */
export const STRUCK = 0;
export const RULE = 1;
export const RING = 2;
export type Mark = typeof STRUCK | typeof RULE | typeof RING;

export const LETTERS = 5;

export function markLine(guess: string, answer: string): Mark[] {
  const marks: Mark[] = [STRUCK, STRUCK, STRUCK, STRUCK, STRUCK];
  const left = new Int8Array(26);
  for (let i = 0; i < LETTERS; i++) {
    if (guess[i] === answer[i]) marks[i] = RING;
    else left[answer.charCodeAt(i) - 97]!++;
  }
  for (let i = 0; i < LETTERS; i++) {
    if (marks[i] === RING) continue;
    const c = guess.charCodeAt(i) - 97;
    if (left[c]! > 0) {
      marks[i] = RULE;
      left[c]!--;
    }
  }
  return marks;
}

export const solved = (marks: readonly Mark[]): boolean => marks.every((m) => m === RING);

/** Would `word` have produced exactly these marks for `guess`? (The test a careful reader applies.) */
export function consistent(word: string, guess: string, marks: readonly Mark[]): boolean {
  const m = markLine(guess, word);
  for (let i = 0; i < LETTERS; i++) if (m[i] !== marks[i]) return false;
  return true;
}

/**
 * The best mark each key has earned so far: a ring beats a rule beats a strike. A letter struck only because the
 * line had one copy too many is never struck on the keyboard while another copy of it is ringed or ruled.
 */
export function keyMarks(lines: ReadonlyArray<{ word: string; marks: readonly Mark[] }>): Map<string, Mark> {
  const out = new Map<string, Mark>();
  for (const { word, marks } of lines) {
    for (let i = 0; i < LETTERS; i++) {
      const c = word[i]!;
      const m = marks[i]!;
      const was = out.get(c);
      if (was === undefined || m > was) out.set(c, m);
    }
  }
  return out;
}

/** "Plain text" form of a slip's marks, one line per written line: ○ ringed, _ ruled, / struck. */
export function marksText(rows: ReadonlyArray<readonly Mark[]>): string {
  return rows.map((r) => r.map((m) => (m === RING ? "○" : m === RULE ? "_" : "/")).join(" ")).join("\n");
}
