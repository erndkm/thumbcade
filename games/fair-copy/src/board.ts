import type { Trie } from "./lexicon.ts";

/**
 * The letter grid. Tiles are strings: one letter, or "qu" (Q never comes alone, so it rides with its U and
 * counts as two letters).
 */

export const N = 4;
export const CELLS = N * N;

export type Board = string[];

export const rowOf = (i: number): number => Math.floor(i / N);
export const colOf = (i: number): number => i % N;

/** Neighbours in all eight directions. */
export const NEIGHBOURS: number[][] = Array.from({ length: CELLS }, (_, i) => {
  const out: number[] = [];
  for (let dr = -1; dr <= 1; dr++)
    for (let dc = -1; dc <= 1; dc++) {
      if (!dr && !dc) continue;
      const r = rowOf(i) + dr;
      const c = colOf(i) + dc;
      if (r >= 0 && c >= 0 && r < N && c < N) out.push(r * N + c);
    }
  return out;
});

export const adjacent = (a: number, b: number): boolean => a !== b && Math.abs(rowOf(a) - rowOf(b)) <= 1 && Math.abs(colOf(a) - colOf(b)) <= 1;

/** The word a path spells. */
export const spell = (b: Board, path: readonly number[]): string => path.map((i) => b[i]!).join("");

/** Letters in a word as the player sees it ("queen" is five). */
export const letters = (w: string): number => w.length;

// ---------------------------------------------------------------------------
// Scoring: long words are worth disproportionately more, and from five letters up they buy a little time.
// ---------------------------------------------------------------------------

/** 3 → 1, 4 → 2, 5 → 4, 6 → 7, 7 → 11, 8 → 16, 9 → 22 … */
export function points(len: number): number {
  if (len < 3) return 0;
  return 1 + ((len - 3) * (len - 2)) / 2;
}

/** Seconds back: 5 letters +1, 6 +2, 7 +3, 8 and up +4. */
export function timeBack(len: number): number {
  return len < 5 ? 0 : Math.min(4, len - 4);
}

// ---------------------------------------------------------------------------
// Solver: every word in `trie` the board can spell (each tile used once per word), with one path per word.
// ---------------------------------------------------------------------------

export interface Found {
  word: string;
  path: number[];
}

export function solve(b: Board, trie: Trie, minLen = 3): Map<string, number[]> {
  const out = new Map<string, number[]>();
  const path: number[] = [];
  let used = 0;
  let word = "";
  const visit = (i: number, node: number) => {
    const n = trie.walk(b[i]!, node);
    if (n < 0) return;
    used |= 1 << i;
    path.push(i);
    const before = word;
    word += b[i]!;
    if (trie.end[n] === 1 && word.length >= minLen && !out.has(word)) out.set(word, path.slice());
    for (const j of NEIGHBOURS[i]!) if (!(used & (1 << j))) visit(j, n);
    word = before;
    path.pop();
    used &= ~(1 << i);
  };
  for (let i = 0; i < CELLS; i++) visit(i, 0);
  return out;
}

/** Does the board hold this word anywhere (any path)? */
export function findPath(b: Board, word: string): number[] | null {
  const path: number[] = [];
  let used = 0;
  const go = (i: number, at: number): boolean => {
    const t = b[i]!;
    if (!word.startsWith(t, at)) return false;
    used |= 1 << i;
    path.push(i);
    if (at + t.length === word.length) return true;
    for (const j of NEIGHBOURS[i]!) if (!(used & (1 << j)) && go(j, at + t.length)) return true;
    path.pop();
    used &= ~(1 << i);
    return false;
  };
  for (let i = 0; i < CELLS; i++) if (go(i, 0)) return path;
  return null;
}

// ---------------------------------------------------------------------------
// Generation.
// ---------------------------------------------------------------------------

/** Letter weights: English-ish, tuned so boards read like words and not like alphabet soup. */
export const WEIGHTS: Record<string, number> = {
  e: 12, a: 9, i: 8, o: 7.5, u: 3.6,
  t: 8.5, n: 7, s: 7.5, r: 7, l: 5.5, d: 4.2, h: 3.4, c: 3.4, m: 3, p: 3, g: 2.8, b: 2, y: 2, f: 2, w: 1.8, k: 1.3, v: 1.2,
  x: 0.35, j: 0.25, z: 0.3, qu: 0.4,
};
export const VOWELS = new Set(["a", "e", "i", "o", "u"]);
/** At most one of these on a board. */
export const HARD = new Set(["x", "j", "z", "qu", "k", "v"]);

const LETTERS = Object.keys(WEIGHTS);

export interface Rules {
  minVowels: number;
  maxVowels: number;
  maxSame: number;
  maxSameE: number;
  maxHard: number;
}

export const RULES: Rules = { minVowels: 5, maxVowels: 7, maxSame: 2, maxSameE: 3, maxHard: 1 };

/** Can tile `t` join a board holding `tiles` without breaking a rule? */
export function allowed(tiles: readonly string[], t: string, rules: Rules = RULES, slotsLeft = Infinity): boolean {
  const same = tiles.filter((x) => x === t).length;
  if (same >= (t === "e" ? rules.maxSameE : rules.maxSame)) return false;
  if (HARD.has(t) && tiles.filter((x) => HARD.has(x)).length >= rules.maxHard) return false;
  const vowels = tiles.filter((x) => VOWELS.has(x)).length;
  if (VOWELS.has(t) && vowels >= rules.maxVowels) return false;
  // Leave room for the vowels a board still needs.
  if (!VOWELS.has(t) && rules.minVowels - vowels >= slotsLeft) return false;
  return true;
}

/** Splits a word into tiles ("quiet" → qu, i, e, t); null if it has a q without u. */
export function tilesOf(word: string): string[] | null {
  const out: string[] = [];
  for (let i = 0; i < word.length; i++) {
    if (word[i] === "q") {
      if (word[i + 1] !== "u") return null;
      out.push("qu");
      i++;
    } else out.push(word[i]!);
  }
  return out;
}

/** A random self-avoiding path of `len` tiles (8 directions), or null. */
export function randomPath(len: number, rand: () => number): number[] | null {
  const path: number[] = [];
  let used = 0;
  const go = (i: number): boolean => {
    used |= 1 << i;
    path.push(i);
    if (path.length === len) return true;
    const opts = NEIGHBOURS[i]!.filter((j) => !(used & (1 << j)));
    for (let k = opts.length - 1; k > 0; k--) {
      const r = Math.floor(rand() * (k + 1));
      [opts[k], opts[r]] = [opts[r]!, opts[k]!];
    }
    for (const j of opts) if (go(j)) return true;
    path.pop();
    used &= ~(1 << i);
    return false;
  };
  return go(Math.floor(rand() * CELLS)) ? path : null;
}

function weighted(tiles: readonly string[], slotsLeft: number, rand: () => number): string {
  const opts = LETTERS.filter((t) => allowed(tiles, t, RULES, slotsLeft));
  let total = 0;
  for (const t of opts) total += WEIGHTS[t]!;
  let x = rand() * total;
  for (const t of opts) {
    x -= WEIGHTS[t]!;
    if (x <= 0) return t;
  }
  return opts[opts.length - 1] ?? "e";
}

/** A board with `seed` (a common word) laid along a random path and the rest filled by weight. */
export function layBoard(seed: string, rand: () => number): Board | null {
  const t = tilesOf(seed);
  if (!t || t.length > CELLS) return null;
  for (let k = 0; k < t.length; k++) if (!allowed(t.slice(0, k), t[k]!, { ...RULES, minVowels: 0 })) return null;
  const path = randomPath(t.length, rand);
  if (!path) return null;
  const b: Board = new Array<string>(CELLS).fill("");
  path.forEach((i, k) => (b[i] = t[k]!));
  const placed = t.slice();
  const empty = b.map((x, i) => (x ? -1 : i)).filter((i) => i >= 0);
  for (let k = empty.length - 1; k > 0; k--) {
    const r = Math.floor(rand() * (k + 1));
    [empty[k], empty[r]] = [empty[r]!, empty[k]!];
  }
  empty.forEach((i, k) => {
    const tile = weighted(placed, empty.length - k, rand);
    b[i] = tile;
    placed.push(tile);
  });
  const vowels = b.filter((x) => VOWELS.has(x)).length;
  if (vowels < RULES.minVowels || vowels > RULES.maxVowels) return null;
  return b;
}

export interface Rated {
  board: Board;
  /** Every common word on the board, with a path. */
  words: Map<string, number[]>;
  /** Sum of points over the common words: the board's ceiling. */
  potential: number;
  long: number;
  longest: string;
}

export function rate(board: Board, common: Trie): Rated {
  const words = solve(board, common);
  let potential = 0;
  let long = 0;
  let longest = "";
  for (const w of words.keys()) {
    potential += points(w.length);
    if (w.length >= 6) long++;
    if (w.length > longest.length || (w.length === longest.length && w < longest)) longest = w;
  }
  return { board, words, potential, long, longest };
}

/** Does the board spell any word whose hash is in `words`, along any path? `prefixes` prunes the search. */
export function spellsAny(b: Board, prefixes: ReadonlySet<number>, words: ReadonlySet<number>, hash: (s: string) => number): boolean {
  let used = 0;
  const go = (i: number, s: string): boolean => {
    const w = s + b[i]!;
    const h = hash(w);
    if (!prefixes.has(h)) return false;
    if (w.length >= 3 && words.has(h)) return true;
    used |= 1 << i;
    for (const j of NEIGHBOURS[i]!) if (!(used & (1 << j)) && go(j, w)) return (used &= ~(1 << i)), true;
    used &= ~(1 << i);
    return false;
  };
  for (let i = 0; i < CELLS; i++) if (go(i, "")) return true;
  return false;
}

/** Does any straight run of tiles (a row, column or diagonal, either way) read a word whose hash is in `words`? */
export function readsAny(b: Board, words: ReadonlySet<number>, hash: (s: string) => number): boolean {
  if (!words.size) return false;
  for (let i = 0; i < CELLS; i++)
    for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1], [0, -1], [-1, 0], [-1, -1], [-1, 1]] as const) {
      let s = "";
      for (let r = rowOf(i), c = colOf(i); r >= 0 && c >= 0 && r < N && c < N; r += dr, c += dc) {
        s += b[r * N + c]!;
        if (s.length >= 3 && words.has(hash(s))) return true;
      }
    }
  return false;
}
