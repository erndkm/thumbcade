import { describe, expect, it } from "vitest";
import { AGAIN, bestLine, CARD, LINES, NEWS, NOTES, pagesLine, statLine, SUBTITLE, TAP, TITLE } from "../src/copy.ts";
import { CHAIN_NAMES, HINTS, TOPPLE_NAMES } from "../src/game.ts";
import { measure } from "./metrics.ts";

/**
 * Every line fits the plate it's drawn on, on the narrowest phone the feed supports (360 px wide). Widths come from
 * Caveat's own advance widths; the game wraps or shrinks the same way at runtime, so these check that nothing has
 * to shrink past readable or wrap past its plate.
 */
const W = 360;
const BANNER_TEXT = W - 60;
const RAIL = 72;
const fmt = (n: number) =>
  Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const lines = (text: string, px: number, weight: "bold" | "medium", maxW: number): number => {
  let n = 1;
  let cur = "";
  for (const word of text.split(" ")) {
    const next = cur ? `${cur} ${word}` : word;
    if (measure(next, px, weight) > maxW && cur) {
      n++;
      cur = word;
    } else cur = next;
  }
  return n;
};

describe("copy fits its plate", () => {
  it("banner titles fit at a big size and their lines wrap to two at most", () => {
    const all = [...Object.values(LINES), ...Object.values(NEWS).filter((x): x is readonly [string, string] => !!x)];
    for (const [title, sub] of all) {
      expect(measure(title, 30, "bold"), title).toBeLessThanOrEqual(BANNER_TEXT);
      if (sub) expect(lines(sub, 18, "medium", BANNER_TEXT), sub).toBeLessThanOrEqual(2);
    }
    for (const n of [...CHAIN_NAMES, ...TOPPLE_NAMES]) expect(measure(n, 38, "bold"), n).toBeLessThanOrEqual(BANNER_TEXT);
    expect(measure("page 99 done!", 38, "bold")).toBeLessThanOrEqual(BANNER_TEXT);
  });

  it("the title block fits between the left edge and the rail", () => {
    const bw = Math.min(300, W - RAIL - 12 - 16);
    expect(measure(TITLE, 54, "bold")).toBeLessThanOrEqual(bw - 40);
    expect(measure(SUBTITLE, 16, "medium")).toBeLessThanOrEqual(bw - 24);
    expect(measure(TAP, 28, "bold")).toBeLessThanOrEqual(176 - 24);
    expect(measure(AGAIN, 26, "bold")).toBeLessThanOrEqual(220 - 24);
    expect(measure("best 999,999", 22, "bold")).toBeLessThanOrEqual(bw);
  });

  it("every game-over line fits the card clear of the rail; the longest hint wraps to three lines", () => {
    const inner = W - (RAIL + 6) - 12 - 32;
    for (const h of Object.values(HINTS)) expect(lines(`next time: ${h}`, 17, "medium", inner), h).toBeLessThanOrEqual(3);
    expect(measure(CARD.title, 18, "bold")).toBeLessThanOrEqual(inner * 0.62);
    for (const n of [0, 1, 12, 99]) expect(measure(pagesLine(n), 18, "medium") + measure(CARD.title, 18, "bold") + 12).toBeLessThanOrEqual(inner);
    expect(measure(statLine(12, 11, 99), 14, "medium")).toBeLessThanOrEqual(inner);
    for (const [score, prev, best] of [
      [0, null, false],
      [120, null, true],
      [99_999, 12_345, true],
      [5_000, 99_999, false],
    ] as Array<[number, number | null, boolean]>) {
      expect(measure(bestLine(score, prev, best, fmt), 15, "bold")).toBeLessThanOrEqual(inner);
    }
    expect(measure(CARD.none, 15, "bold")).toBeLessThanOrEqual(inner);
  });

  it("the notes on the page stay short", () => {
    for (const n of Object.values(NOTES)) expect(measure(n, 20, "medium"), n).toBeLessThanOrEqual(220);
  });
});
