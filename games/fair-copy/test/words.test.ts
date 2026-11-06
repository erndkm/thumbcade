import { readFileSync } from "node:fs";
import { createRng } from "@thumbcade-games/kit/rng";
import { describe, expect, it } from "vitest";
import { FORMS, HARD, HARD_STEMS, MILD, SOFT } from "../scripts/blocklist.ts";
import { findPath, N, RULES, VOWELS, HARD as HARD_TILES, tilesOf } from "../src/board.ts";
import { BAND, clean, dealBoard, lexicon, type Blocked } from "../src/deal.ts";
import { SortedWords, Trie } from "../src/lexicon.ts";

const read = (f: string) => readFileSync(new URL(`../src/data/${f}`, import.meta.url), "utf8");
const acceptText = read("accept.txt");
const commonText = read("common.txt");
const accept = acceptText.split("\n").filter(Boolean);
const common = commonText.split("\n").filter(Boolean).map((l) => l.replace(/\.$/, ""));
const lex = lexicon(commonText, JSON.parse(read("blocked.json")) as Blocked);
const hard = new Set<string>();
for (const h of HARD) for (const f of FORMS) hard.add(h + f);
const soft = new Set<string>();
for (const w of SOFT) for (const f of FORMS) soft.add(w + f);
const stem = (w: string) => HARD_STEMS.some((s) => w.includes(s));

describe("shipped word lists", () => {
  it("are sorted, unique, a-z only, 3-16 letters, and every q has its u", () => {
    for (const list of [accept, common]) {
      for (let i = 1; i < list.length; i++) expect(list[i - 1]! < list[i]!).toBe(true);
      for (const w of list) {
        expect(w).toMatch(/^[a-z]{3,16}$/);
        expect(w).not.toMatch(/q(?!u)/);
      }
    }
    expect(accept.length).toBeGreaterThan(150_000);
    expect(common.length).toBeGreaterThan(30_000);
  });

  it("never hold a hard word, and the common list holds no soft word either", () => {
    for (const w of accept) {
      expect(hard.has(w), w).toBe(false);
      expect(stem(w), w).toBe(false);
    }
    for (const w of common) expect(soft.has(w), w).toBe(false);
  });

  it("every common word is also accepted", () => {
    const a = new SortedWords(acceptText);
    for (const w of common) expect(a.has(w), w).toBe(true);
  });

  it("accept generously, but only real words", () => {
    const a = new SortedWords(acceptText);
    for (const w of ["quoth", "aah", "zax", "colour", "realise", "queen", "quiet", "planters", "stoa"]) expect(a.has(w), w).toBe(true);
    // A q without its u can't be spelled with the Qu tile, so it isn't listed at all.
    for (const w of ["qat", "qoph", "zzzz", "asdf", "plnt", "", "a", "aardvarkz"]) expect(a.has(w), w).toBe(false);
  });

  it("the first and last word are found too (binary search edges)", () => {
    const a = new SortedWords(acceptText);
    expect(a.has(accept[0]!)).toBe(true);
    expect(a.has(accept[accept.length - 1]!)).toBe(true);
  });
});

describe("lexicon", () => {
  it("builds a trie that knows exactly its words", () => {
    const t = new Trie(["ant", "ants", "anvil", "bee"]);
    expect(t.words).toBe(4);
    for (const w of ["ant", "ants", "anvil", "bee"]) expect(t.has(w)).toBe(true);
    for (const w of ["an", "anv", "be", "bees", "cat"]) expect(t.has(w)).toBe(false);
    expect(t.walk("anv")).toBeGreaterThan(0);
    expect(t.walk("ax")).toBe(-1);
  });

  it("marks everyday words and picks long ones to plant", () => {
    expect(lex.everyday.size).toBeGreaterThan(8000);
    for (const w of lex.seeds) {
      expect(w.length).toBeGreaterThanOrEqual(7);
      expect(w.length).toBeLessThanOrEqual(8);
      expect(lex.everyday.has(w)).toBe(true);
    }
  });
});

describe("dealt boards", () => {
  const boards = Array.from({ length: 40 }, (_, i) => dealBoard(lex, createRng(100 + i)));

  it("are the same for the same seed and differ between seeds", () => {
    expect(dealBoard(lex, createRng(5)).board).toEqual(dealBoard(lex, createRng(5)).board);
    expect(dealBoard(lex, createRng(5)).board).not.toEqual(dealBoard(lex, createRng(6)).board);
  });

  it("stay inside the band: rich, with several long words", () => {
    for (const r of boards) {
      expect(r.potential).toBeGreaterThanOrEqual(BAND.potential[0]);
      expect(r.potential).toBeLessThanOrEqual(BAND.potential[1]);
      expect(r.words.size).toBeGreaterThanOrEqual(BAND.words);
      expect(r.long).toBeGreaterThanOrEqual(BAND.long);
      expect(r.longest.length).toBeGreaterThanOrEqual(7);
      expect([...r.words.keys()].filter((w) => lex.everyday.has(w)).length).toBeGreaterThanOrEqual(BAND.everyday);
    }
  });

  it("read like words: vowels in range, no letter more than twice (e three times), one hard letter at most", () => {
    for (const { board } of boards) {
      expect(board.length).toBe(N * N);
      const v = board.filter((t) => VOWELS.has(t)).length;
      expect(v).toBeGreaterThanOrEqual(RULES.minVowels);
      expect(v).toBeLessThanOrEqual(RULES.maxVowels);
      for (const t of new Set(board)) expect(board.filter((x) => x === t).length).toBeLessThanOrEqual(t === "e" ? 3 : 2);
      expect(board.filter((t) => HARD_TILES.has(t)).length).toBeLessThanOrEqual(1);
      expect(board).not.toContain("q");
    }
  });

  it("never spell a hard word along any path, nor a mild one along a straight line", () => {
    const mild = new Set(MILD);
    // The listed hard words and stems themselves (their generated forms are checked only where they are real words).
    const strong = [...HARD, ...HARD_STEMS].filter((w) => w.length >= 3 && !mild.has(w) && tilesOf(w));
    const straight = (b: string[], w: string) => {
      const p = findPath(b, w);
      if (!p) return false;
      // findPath returns one path; check every straight line explicitly instead.
      for (let i = 0; i < N * N; i++)
        for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1], [0, -1], [-1, 0], [-1, -1], [-1, 1]] as const) {
          let s = "";
          for (let r = Math.floor(i / N), c = i % N; r >= 0 && c >= 0 && r < N && c < N; r += dr, c += dc) {
            s += b[r * N + c]!;
            if (s === w) return true;
          }
        }
      return false;
    };
    for (const { board } of boards) {
      expect(clean(lex, board)).toBe(true);
      for (const w of strong) expect(findPath(board, w), `${w} on ${board.join("")}`).toBeNull();
      for (const w of mild) expect(straight(board, w), `${w} on ${board.join("")}`).toBe(false);
    }
  });

  it("only offer common, clean words for the reveal", () => {
    for (const r of boards) for (const w of r.words.keys()) expect(lex.trie.has(w) && !hard.has(w) && !soft.has(w)).toBe(true);
  });
});
