import { describe, expect, it } from "vitest";
import { consistent, keyMarks, markLine, marksText, RING, RULE, solved, STRUCK, type Mark } from "../src/marks.ts";

const R = RING;
const U = RULE;
const X = STRUCK;
const m = (guess: string, answer: string) => markLine(guess, answer);

describe("marking a line", () => {
  it("rings, rules and strikes plain letters", () => {
    expect(m("crane", "react")).toEqual([U, U, R, X, U]);
    expect(m("proof", "proof")).toEqual([R, R, R, R, R]);
    expect(m("blimp", "hound")).toEqual([X, X, X, X, X]);
    expect(solved(m("proof", "proof"))).toBe(true);
    expect(solved(m("prood", "proof"))).toBe(false);
  });

  it("a letter guessed twice but hidden once: one mark, the other copy struck", () => {
    // "sassy": the hidden word has one s.
    expect(m("sassy", "stone")).toEqual([R, X, X, X, X]);
    // The ring takes the only copy even when an earlier copy could have been ruled.
    expect(m("sleds", "shine")).toEqual([R, X, U, X, X]);
    expect(m("geese", "those")).toEqual([X, X, X, R, R]);
    expect(m("eerie", "crane")).toEqual([X, X, U, X, R]);
  });

  it("a letter hidden twice: two copies guessed get two marks, a third is struck", () => {
    expect(m("loose", "spool")).toEqual([U, U, R, U, X]);
    expect(m("odors", "proof")).toEqual([U, X, R, U, X]);
    expect(m("ooooo", "proof")).toEqual([X, X, R, R, X]);
    expect(m("geese", "geese")).toEqual([R, R, R, R, R]);
    expect(m("eeeee", "geese")).toEqual([X, R, R, X, R]);
  });

  it("rules go left to right while copies remain", () => {
    // Hidden "abbey" has two b's; the guess has three b's, none in place: the first two are ruled.
    expect(m("bxxbb", "abbey")).toEqual([U, X, X, U, X]);
    // Two in place take both copies, so a third is struck even though it comes first.
    expect(m("bbbxx", "abbey")).toEqual([X, R, R, X, X]);
    expect(m("xbxbb", "abbey")).toEqual([X, R, X, U, X]);
    expect(m("babes", "abbey")).toEqual([U, U, R, R, X]);
  });

  it("is the same rule the careful reader's test uses", () => {
    expect(consistent("proof", "floor", m("floor", "proof"))).toBe(true);
    expect(consistent("spoof", "floor", m("floor", "proof"))).toBe(false);
  });
});

describe("the keyboard's marks", () => {
  it("keeps each letter's best mark, and never strikes a letter that is in the word", () => {
    const lines = [
      { word: "eerie", marks: m("eerie", "crane") },
      { word: "nacre", marks: m("nacre", "crane") },
    ];
    const k = keyMarks(lines);
    expect(k.get("e")).toBe(RING);
    expect(k.get("r")).toBe(RULE);
    expect(k.get("i")).toBe(STRUCK);
    expect(k.get("n")).toBe(RULE);
    expect(k.get("a")).toBe(RULE);
    expect(k.has("z")).toBe(false);
  });
});

describe("marks as text", () => {
  it("uses rings, rules and strokes, never coloured squares", () => {
    const rows: Mark[][] = [m("floor", "proof"), m("proof", "proof")];
    expect(marksText(rows)).toBe("_ / ○ ○ _\n○ ○ ○ ○ ○");
    expect(marksText(rows)).not.toMatch(/[\u{1F7E5}-\u{1F7EB}⬛⬜]/u);
  });
});
