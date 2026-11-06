/**
 * Word lists. Both ship as sorted, newline-separated lowercase a-z words (built by scripts/words.ts).
 *
 * - The broad list (everything we accept) stays one string and is searched in place: a binary search over line
 *   offsets, so loading 170k words costs no parsing at all.
 * - The common list (what we seed boards with and reveal) becomes a compact trie for the board solver.
 */

/** Membership in a sorted, "\n"-separated word list without splitting it. */
export class SortedWords {
  readonly text: string;
  constructor(text: string) {
    this.text = text.endsWith("\n") ? text : `${text}\n`;
  }
  /** The line that contains offset i: [start, end). */
  private line(i: number): [number, number] {
    const start = this.text.lastIndexOf("\n", i - 1) + 1;
    const end = this.text.indexOf("\n", i);
    return [start, end < 0 ? this.text.length : end];
  }
  has(word: string): boolean {
    if (!word) return false;
    let lo = 0;
    let hi = this.text.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      const [s, e] = this.line(mid);
      const w = this.text.slice(s, e);
      if (w === word) return true;
      if (w < word) lo = e + 1;
      else hi = s;
    }
    return false;
  }
}

/**
 * A trie in four typed arrays (first child, next sibling, letter, end-of-word), built in one pass from a sorted list.
 * Node 0 is the root. Letters are 0-25.
 */
export class Trie {
  readonly first: Int32Array;
  readonly next: Int32Array;
  readonly letter: Uint8Array;
  readonly end: Uint8Array;
  readonly size: number;
  readonly words: number;

  constructor(sorted: readonly string[]) {
    let cap = 1;
    for (const w of sorted) cap += w.length;
    const first = new Int32Array(cap).fill(-1);
    const next = new Int32Array(cap).fill(-1);
    const last = new Int32Array(cap).fill(-1);
    const letter = new Uint8Array(cap);
    const end = new Uint8Array(cap);
    let size = 1;
    let prev = "";
    const path: number[] = [0];
    let count = 0;
    for (const w of sorted) {
      if (w === prev || !w) continue;
      // Sorted input: the new word shares a prefix with the previous one, and everything after it is new and comes
      // after every existing child alphabetically, so it is appended as the last child.
      let k = 0;
      while (k < w.length && k < prev.length && w.charCodeAt(k) === prev.charCodeAt(k)) k++;
      path.length = k + 1;
      for (let i = k; i < w.length; i++) {
        const parent = path[i]!;
        const n = size++;
        letter[n] = w.charCodeAt(i) - 97;
        if (last[parent]! < 0) first[parent] = n;
        else next[last[parent]!] = n;
        last[parent] = n;
        path.push(n);
      }
      end[path[w.length]!] = 1;
      count++;
      prev = w;
    }
    this.first = first;
    this.next = next;
    this.letter = letter;
    this.end = end;
    this.size = size;
    this.words = count;
  }

  /** Child of `node` for letter l (0-25), or -1. */
  child(node: number, l: number): number {
    for (let c = this.first[node]!; c >= 0; c = this.next[c]!) {
      const x = this.letter[c]!;
      if (x === l) return c;
      if (x > l) return -1;
    }
    return -1;
  }

  /** Walks a string from `node`; -1 when the path leaves the trie. */
  walk(s: string, node = 0): number {
    let n = node;
    for (let i = 0; i < s.length && n >= 0; i++) n = this.child(n, s.charCodeAt(i) - 97);
    return n;
  }

  has(word: string): boolean {
    const n = this.walk(word);
    return n >= 0 && this.end[n] === 1;
  }
}

/** Splits a list file into words (drops blanks). */
export const lines = (text: string): string[] => text.split("\n").filter((w) => w.length > 0);
