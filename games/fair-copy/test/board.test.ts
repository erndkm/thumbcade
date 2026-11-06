import { createRng } from "@thumbcade-games/kit/rng";
import { describe, expect, it } from "vitest";
import { adjacent, CELLS, findPath, layBoard, NEIGHBOURS, points, randomPath, readsAny, solve, spell, spellsAny, tilesOf, timeBack, type Board } from "../src/board.ts";
import { fnv } from "../src/hash.ts";
import { Trie } from "../src/lexicon.ts";
import { SKILLS, WordPilot } from "../src/pilot.ts";
import { Round, TUNE } from "../src/round.ts";

// p l a  n
// s t e  x
// r i qu o
// d e n  y
const BOARD: Board = ["p", "l", "a", "n", "s", "t", "e", "x", "r", "i", "qu", "o", "d", "e", "n", "y"];

describe("scoring", () => {
  it("long words are worth disproportionately more", () => {
    expect([2, 3, 4, 5, 6, 7, 8, 9].map(points)).toEqual([0, 1, 2, 4, 7, 11, 16, 22]);
    for (let n = 4; n < 12; n++) expect(points(n) / n).toBeGreaterThan(points(n - 1) / (n - 1));
  });

  it("five letters and up buy a little time back", () => {
    expect([3, 4, 5, 6, 7, 8, 12].map(timeBack)).toEqual([0, 0, 1, 2, 3, 4, 4]);
  });
});

describe("the grid", () => {
  it("joins tiles in all eight directions, never across the edge", () => {
    expect(NEIGHBOURS[0]!.sort((a, b) => a - b)).toEqual([1, 4, 5]);
    expect(NEIGHBOURS[5]!.length).toBe(8);
    expect(adjacent(3, 4)).toBe(false); // end of one row, start of the next
    expect(adjacent(0, 5)).toBe(true);
    expect(adjacent(5, 5)).toBe(false);
  });

  it("Qu is one tile and two letters", () => {
    expect(tilesOf("quiet")).toEqual(["qu", "i", "e", "t"]);
    expect(tilesOf("qoph")).toBeNull();
    expect(spell(BOARD, [10, 9])).toBe("qui");
  });

  it("finds every word in the list the board can spell, each tile once", () => {
    const t = new Trie(["ant", "plan", "planet", "planets", "quit", "quiet", "stop", "tsar", "lap", "pep", "dent", "tent", "tea"].sort());
    const found = solve(BOARD, t);
    expect([...found.keys()].sort()).toEqual(["plan", "planet", "planets", "quiet", "quit", "tea"]);
    for (const [w, p] of found) {
      expect(spell(BOARD, p)).toBe(w);
      expect(new Set(p).size).toBe(p.length);
      for (let i = 1; i < p.length; i++) expect(adjacent(p[i - 1]!, p[i]!)).toBe(true);
    }
    expect(findPath(BOARD, "planets")).toEqual(found.get("planets"));
    expect(findPath(BOARD, "pep")).toBeNull(); // only one p
  });

  it("random paths never revisit a tile and always step to a neighbour", () => {
    const rand = createRng(1);
    for (let i = 0; i < 200; i++) {
      const p = randomPath(8, rand)!;
      expect(new Set(p).size).toBe(8);
      for (let k = 1; k < p.length; k++) expect(adjacent(p[k - 1]!, p[k]!)).toBe(true);
    }
  });

  it("a laid board always holds its planted word", () => {
    const rand = createRng(2);
    for (const w of ["planters", "quieter", "strange", "dolphin"]) {
      const b = layBoard(w, rand) ?? layBoard(w, rand) ?? layBoard(w, rand);
      expect(b).not.toBeNull();
      expect(findPath(b!, w)).not.toBeNull();
      expect(b!.length).toBe(CELLS);
    }
  });

  it("the block check sees bent paths, the line check only straight ones", () => {
    const prefixes = new Set<number>();
    for (const w of ["pla", "plan", "planet"]) for (let i = 1; i <= w.length; i++) prefixes.add(fnv(w.slice(0, i)));
    expect(spellsAny(BOARD, prefixes, new Set([fnv("planet")]), fnv)).toBe(true); // p-l-a-n, then down-left to e, t
    expect(spellsAny(BOARD, prefixes, new Set([fnv("plank")]), fnv)).toBe(false);
    expect(readsAny(BOARD, new Set([fnv("plan")]), fnv)).toBe(true); // the top row
    expect(readsAny(BOARD, new Set([fnv("nalp")]), fnv)).toBe(true); // the top row, backwards
    expect(readsAny(BOARD, new Set([fnv("planet")]), fnv)).toBe(false); // bent
  });
});

describe("a round", () => {
  const words = new Set(["plan", "planet", "planets", "tea", "quit", "quiet"]);
  const isWord = (w: string) => words.has(w);
  const path = (w: string) => findPath(BOARD, w)!;

  it("accepts a word once, refuses unknown and short ones without cost", () => {
    const r = new Round(BOARD, isWord);
    expect(r.submit(path("plan"))).toMatchObject({ kind: "word", points: 2, seconds: 0 });
    expect(r.submit(path("plan")).kind).toBe("again");
    expect(r.submit([0, 1, 5]).kind).toBe("unknown"); // "plt"
    expect(r.submit([0, 1]).kind).toBe("short");
    expect(r.score).toBe(2);
    expect(r.clock).toBe(TUNE.clock);
  });

  it("long words add time back, but a round never runs past its ceiling", () => {
    const r = new Round(BOARD, isWord);
    const v = r.submit(path("planets"));
    expect(v).toMatchObject({ kind: "word", points: 11, seconds: 3 });
    expect(r.clock).toBe(TUNE.clock + 3);
    const late = new Round(BOARD, isWord);
    late.step(TUNE.clock - 1);
    late.clock = TUNE.ceiling - late.elapsed; // the page is full
    expect(late.submit(path("planet"))).toMatchObject({ seconds: 0 });
  });

  it("a word that waited for the dictionary still counts after the bell", () => {
    const r = new Round(BOARD, isWord);
    for (let i = 0; i < 100 * 60 && !r.over; i++) r.step(1 / 60);
    expect(r.submit(path("plan")).kind).toBe("short"); // traced after the bell: no
    expect(r.submit(path("plan"), { late: true })).toMatchObject({ kind: "word", points: 2 }); // traced before it: yes
    // Still waiting when the round must be reported: taken on trust rather than refused.
    expect(r.submit([0, 1, 5], { late: true, trust: true }).kind).toBe("word");
    expect(r.submit([0, 1, 5], { late: true }).kind).toBe("again");
  });

  it("peeks without submitting, for the live preview", () => {
    const r = new Round(BOARD, isWord);
    expect(r.peek(path("plan"))).toBe("word");
    expect(r.peek([0, 1])).toBe("short");
    r.submit(path("plan"));
    expect(r.peek(path("plan"))).toBe("again");
    expect(r.found.size).toBe(1);
  });

  it("presses a seal every few words and pays once for every letter inked", () => {
    const all = new Set<string>();
    // Five words that together use every tile once.
    const r = new Round(BOARD, (w) => all.has(w));
    const sets = [[0, 1, 2, 3], [4, 5, 6, 7], [8, 9, 10, 11], [12, 13, 14, 15], [0, 4, 8, 12]];
    let inked = 0;
    let seal = 0;
    for (const p of sets) {
      all.add(spell(BOARD, p));
      const v = r.submit(p);
      if (v.kind === "word" && v.inked) inked++;
      if (v.kind === "word" && v.seal) seal = v.seal;
    }
    expect(inked).toBe(1);
    expect(r.allInked).toBe(true);
    expect(seal).toBe(TUNE.sealEvery);
  });

  it("ends when the clock is out and keeps its stats", () => {
    const r = new Round(BOARD, isWord);
    r.submit(path("planets"));
    r.submit(path("tea"));
    let ended = false;
    for (let i = 0; i < 100 * 60 && !ended; i++) ended = r.step(1 / 60);
    expect(r.over).toBe(true);
    expect(r.submit(path("plan")).kind).toBe("short");
    expect(r.stats).toMatchObject({ words: 2, bestWord: "planets", longest: 7 });
    expect(r.stats.seconds).toBeLessThanOrEqual(TUNE.ceiling + 0.05);
  });
});

describe("the pilot", () => {
  it("only picks words it hasn't found, from the board's list", () => {
    const t = new Trie(["plan", "planet", "planets", "quit", "tea"]);
    const rated = { board: BOARD, words: solve(BOARD, t), potential: 0, long: 0, longest: "planets" };
    const p = new WordPilot(SKILLS.expert, createRng(1));
    const found = new Set<string>();
    for (let i = 0; i < 5; i++) {
      const pick = p.choose(rated, new Set(["plan", "tea"]), found)!;
      expect(found.has(pick.word)).toBe(false);
      expect(spell(BOARD, pick.path)).toBe(pick.word);
      found.add(pick.word);
    }
    expect(p.choose(rated, new Set(), found)).toBeNull();
  });
});
