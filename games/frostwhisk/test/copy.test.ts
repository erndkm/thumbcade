import { describe, expect, it } from "vitest";
import { CRITTERS } from "../src/ai.ts";
import { overHint, overLines, PANEL_TEXT } from "../src/copy.ts";
import { textWidth } from "../src/font.ts";
import { hudLanes, PIPS_LANE, SCORE_LANE } from "../src/layout.ts";

/** The game-over strip and the banners are pixel text in a fixed width: every line we can show must fit. */
describe("copy fits its plate", () => {
  it("every game-over tip fits the strip", () => {
    const base = { moved: 30, goals: 5, against: 1, banks: 2, zingers: 2, bestStreak: 3 };
    const variants = [
      { ...base, moved: 0 },
      { ...base, goals: 0 },
      { ...base, against: 9 },
      { ...base, banks: 0 },
      { ...base, zingers: 0 },
      base,
    ];
    for (const critter of [0, 1, 2, 3, 4]) for (const v of variants) expect(textWidth(overHint(v, critter))).toBeLessThanOrEqual(PANEL_TEXT);
  });

  it("every critter's name and quip fit a banner", () => {
    for (const c of CRITTERS) {
      expect(textWidth(c.label)).toBeLessThanOrEqual(104);
      expect(textWidth(c.quip)).toBeLessThanOrEqual(104);
      expect(textWidth(`${c.brain.name} is out! +2,000`)).toBeLessThanOrEqual(104);
      expect(textWidth(`now knock it into`)).toBeLessThanOrEqual(104);
      expect(textWidth(`${c.brain.name}'s den!`)).toBeLessThanOrEqual(104);
    }
  });
});

describe("panels and the HUD fit", () => {
  it("every game-over line fits the fixed panel, for any run", () => {
    const runs: Array<[Parameters<typeof overLines>[0], number, number, number | null, boolean, number]> = [];
    for (const goals of [0, 1, 9, 15, 120]) {
      for (const kos of [0, 1, 4, 5]) {
        for (const streak of [0, 1, 12]) {
          for (const [score, best] of [
            [0, null],
            [240, null],
            [99_999, 1],
            [5_000, 10_000],
            [10_000, 10_000],
            [123_456, 9_999],
          ] as Array<[number, number | null]>) {
            runs.push([{ moved: goals % 3, goals, against: kos, banks: goals % 2, zingers: kos % 2, bestStreak: streak, kos }, kos % 5, score, best, kos === 5, 12_000]);
          }
        }
      }
    }
    for (const r of runs) for (const line of overLines(...r)) expect(textWidth(line), line).toBeLessThanOrEqual(PANEL_TEXT);
  });

  it("the attract prompt and its sub-line fit a panel", () => {
    for (const t of ["~ tap to play ~", "pond hockey", "best 199,999"]) expect(textWidth(t)).toBeLessThanOrEqual(PANEL_TEXT);
  });

  it("the HUD lanes never touch, down to a 130 px screen", () => {
    for (const w of [130, 135, 143, 188]) {
      const l = hudLanes(w);
      expect(l.gap, `${w} px`).toBeGreaterThanOrEqual(5);
      expect(l.pipsX + PIPS_LANE).toBeLessThanOrEqual(w - 2);
    }
    expect(SCORE_LANE).toBeGreaterThanOrEqual(textWidth("99,999") + textWidth("x4") + 3);
  });
});
