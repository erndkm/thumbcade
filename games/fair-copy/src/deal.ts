import { layBoard, rate, readsAny, spellsAny, type Rated } from "./board.ts";
import { fnv } from "./hash.ts";
import { Trie } from "./lexicon.ts";

/**
 * Dealing a board. Every run gets a fresh board from its seed, but only boards inside one narrow band are dealt, so
 * scores on the shared leaderboards stay comparable: a long common word planted along a random path, a total
 * common-word value in the band, enough everyday words, several long ones, and nothing a 4+ game can't show.
 */

export interface Blocked {
  prefixes: number[];
  words: number[];
  lines: number[];
}

export interface Lexicon {
  /** Common words (the seeding and reveal list). */
  trie: Trie;
  /** The everyday subset. */
  everyday: Set<string>;
  /** Planted words: everyday, 7-8 letters. */
  seeds: string[];
  blockedPrefixes: Set<number>;
  blockedWords: Set<number>;
  blockedLines: Set<number>;
}

/** Parses common.txt (everyday words end in ".") and blocked.json. */
export function lexicon(commonText: string, blocked: Blocked): Lexicon {
  const words: string[] = [];
  const everyday = new Set<string>();
  for (const line of commonText.split("\n")) {
    if (!line) continue;
    if (line.endsWith(".")) {
      const w = line.slice(0, -1);
      words.push(w);
      everyday.add(w);
    } else words.push(line);
  }
  const seeds = [...everyday].filter((w) => w.length >= 7 && w.length <= 8);
  return {
    trie: new Trie(words),
    everyday,
    seeds,
    blockedPrefixes: new Set(blocked.prefixes),
    blockedWords: new Set(blocked.words),
    blockedLines: new Set(blocked.lines),
  };
}

export const BAND = {
  /** Sum of points over every common word on the board. */
  potential: [150, 270] as [number, number],
  words: 50,
  everyday: 30,
  /** Common words of six letters or more. */
  long: 4,
};

export function clean(lex: Lexicon, board: string[]): boolean {
  return !spellsAny(board, lex.blockedPrefixes, lex.blockedWords, fnv) && !readsAny(board, lex.blockedLines, fnv);
}

/** One candidate board: returned when it is clean and inside the band, else null. */
export function candidate(lex: Lexicon, rand: () => number): Rated | null {
  const seed = lex.seeds[Math.floor(rand() * lex.seeds.length)]!;
  const board = layBoard(seed, rand);
  if (!board || !clean(lex, board)) return null;
  const r = rate(board, lex.trie);
  if (r.potential < BAND.potential[0] || r.potential > BAND.potential[1]) return null;
  if (r.words.size < BAND.words || r.long < BAND.long) return null;
  let everyday = 0;
  for (const w of r.words.keys()) if (lex.everyday.has(w)) everyday++;
  if (everyday < BAND.everyday) return null;
  return r;
}

/** Deals one board, trying candidates until one passes (each try costs well under a millisecond). */
export function dealBoard(lex: Lexicon, rand: () => number): Rated {
  for (let i = 0; i < 5000; i++) {
    const c = candidate(lex, rand);
    if (c) return c;
  }
  // Unreachable in practice; any clean board is still a fine board.
  for (;;) {
    const b = layBoard(lex.seeds[Math.floor(rand() * lex.seeds.length)]!, rand);
    if (b && clean(lex, b)) return rate(b, lex.trie);
  }
}
