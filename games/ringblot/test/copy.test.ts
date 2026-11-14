import { describe, expect, it } from "vitest";
import {
  ALL_TIPS, BANNER_PX, BANNER_SUB_PX, BANNER_W, barLabel, goalLine, HINT_LINE, LINES, MIN_W, NOTES, POP_PX, printedSub, PULL_WORDS, pullLine, SCORE_W, shareLine, SHEET_W, sheetLine,
  STAT_PX, statLine, STRIP_TEXT, TAGLINE, TAGLINE_2, TIP_MIN_PX, TIP_PX, tipFor, TIPS, TITLE,
} from "../src/copy.ts";
import { measure } from "../src/metrics.ts";
import { COLS, goalFor, type Stats } from "../src/sim.ts";

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
const stats = (o: Partial<Stats> = {}): Stats => ({ swipes: 80, bonks: 2, prints: 14, squares: 320, biggest: 34, bestTier: 3, smudges: 1, smudged: 0, selfCuts: 0, shaves: 1, sheets: 2, stolen: 12, stillTicks: 300, lineTicks: 2000, longestLine: 12, ...o });
/** The sheet's width on the narrowest phone: fifteen squares in 360 px less the margins. */
const FIELD = MIN_W - 16;

describe("copy fits its plate (Jost's real advance widths)", () => {
  it("every game-over tip fits the strip on the narrowest phone", () => {
    expect(ALL_TIPS).toHaveLength(10);
    for (const t of ALL_TIPS) {
      expect(measure(t, "light", TIP_MIN_PX, 0.6), t).toBeLessThanOrEqual(STRIP_TEXT);
      // And at full size on a 390 px phone.
      expect(measure(t, "light", TIP_PX, 0.6), t).toBeLessThanOrEqual(STRIP_TEXT + 30);
      expect(t).toBe(t.toLowerCase());
    }
  });

  it("each tip is reachable, comes from what happened, and is one the strip was measured for", () => {
    const cases: Array<[Partial<Stats>, number, string]> = [
      [{ swipes: 0, prints: 0 }, 1, TIPS.swipe],
      [{ prints: 0 }, 1, TIPS.home],
      [{ selfCuts: 2 }, 2, TIPS.boxed],
      [{ smudged: 2, longestLine: 20 }, 2, TIPS.long],
      [{ smudged: 3, longestLine: 8 }, 2, TIPS.near],
      [{ stillTicks: 40 * 120 * 0.5 }, 2, TIPS.still],
      [{ biggest: 7 }, 2, TIPS.small],
      [{ smudges: 0 }, 2, TIPS.cut],
      [{ bestTier: 2 }, 2, TIPS.bigger],
      [{}, 3, TIPS.corners],
    ];
    const seen = new Set<string>();
    for (const [o, sheet, want] of cases) {
      const tip = tipFor(stats(o), sheet, 40);
      expect(tip).toBe(want);
      expect(ALL_TIPS).toContain(tip);
      seen.add(tip);
    }
    expect(seen.size).toBe(ALL_TIPS.length);
    // A rival's line is only worth mentioning once there has been a second sheet.
    expect(tipFor(stats({ smudges: 0 }), 1, 40)).not.toBe(TIPS.cut);
  });

  it("the strip's stat line and bar label fit, for any run", () => {
    for (const squares of [0, 1, 87, 999, 12_345]) for (const sheet of [1, 9, 24]) for (const smudges of [0, 7, 30]) {
      const line = statLine(sheet, stats({ squares, smudges }), fmt);
      expect(measure(line, "medium", 10, 1.6), line).toBeLessThanOrEqual(STRIP_TEXT);
      if (squares < 1000 && sheet < 10) expect(measure(line, "medium", STAT_PX, 1.6), line).toBeLessThanOrEqual(STRIP_TEXT + 30);
    }
    expect(statLine(1, stats({ squares: 1, smudges: 0 }), fmt)).toBe("sheet 1 · 1 square · 0 smudged");
    for (const l of [barLabel(true, 99_999, 12_345, 1, fmt), barLabel(true, 500, null, 1, fmt), barLabel(false, 10, 900_000, 0.01, fmt), barLabel(false, 0, 500, 0, fmt)])
      expect(measure(l, "light", 14, 1.2), l).toBeLessThanOrEqual(STRIP_TEXT);
  });

  it("every banner fits the narrowest phone", () => {
    const scale = Math.min(1, MIN_W / 390);
    const words = [...Object.values(LINES).map((l) => l[0]), sheetLine(1), sheetLine(24), `${sheetLine(24)} printed`];
    for (const w of words) expect(measure(w, "light", BANNER_PX * scale, BANNER_PX * scale * 0.08) + 36, w).toBeLessThanOrEqual(BANNER_W);
    const subs = [...Object.values(LINES).map((l) => l[1]), goalLine(goalFor(1)), goalLine(goalFor(9)), printedSub(3600, true, fmt), printedSub(150, false, fmt), "1,234,567"];
    for (const sub of subs) expect(measure(sub, "medium", BANNER_SUB_PX, 2.4) + 36, sub).toBeLessThanOrEqual(BANNER_W);
  });

  it("the two tickets at the top fit side by side over the sheet, whatever the score", () => {
    for (const score of [0, 999, 54_321, 9_999_999]) expect(measure(fmt(score), "light", 28, 1.2) + 26, String(score)).toBeLessThanOrEqual(SCORE_W);
    for (const [share, sheet] of [[0.02, 1], [0.49, 8], [1, 24]] as const) {
      // The share is set two points bigger for a moment after a print.
      expect(measure(shareLine(share, goalFor(sheet)), "medium", 15, 1.4) + 22).toBeLessThanOrEqual(SHEET_W);
      expect(measure(sheetLine(sheet), "medium", 10, 1.8) + 22).toBeLessThanOrEqual(SHEET_W);
    }
    expect(SCORE_W + SHEET_W + 12).toBeLessThanOrEqual(FIELD);
    expect(shareLine(0.1499, 0.15)).toBe("14 / 15 %");
  });

  it("the title card and the first-run hint fit beside the action rail", () => {
    const avail = MIN_W - 72 - 28;
    const u = 0.92;
    const size = Math.min(54 * u, avail / 5.2);
    const card = Math.min(avail, size * 5.6);
    expect(measure(TITLE, "light", size, size * 0.1)).toBeLessThanOrEqual(card - 24);
    for (const t of [TAGLINE, TAGLINE_2]) expect(measure(t, "medium", 11 * u, 2 * u), t).toBeLessThanOrEqual(card - 12);
    expect(measure("best 9,999,999", "medium", 10.5 * u, 3.4 * u)).toBeLessThanOrEqual(card - 12);
    expect(measure(HINT_LINE, "medium", 11, 1.8) + 16).toBeLessThanOrEqual(FIELD - 24);
    expect(TITLE).toBe("ringblot");
  });

  it("every popup fits on the sheet, and nothing names another game", () => {
    const widest = FIELD - 16;
    const pops = [pullLine(6, 1, fmt), pullLine(48, 2, fmt), pullLine(147, 3, fmt), pullLine(1560, 4, fmt), `${NOTES.smudge} +${fmt(2400)}`, `${NOTES.shave} +30`, LINES.low[0]];
    for (const p of pops) expect(measure(p, "medium", (POP_PX + 4.5) * 1.15, 1.2) + 14, p).toBeLessThanOrEqual(widest);
    expect(PULL_WORDS.slice(2)).toEqual(["good pull", "big pull", "huge pull"]);
    expect(COLS).toBe(15);
    const all = [TITLE, TAGLINE, TAGLINE_2, HINT_LINE, ...ALL_TIPS, ...Object.values(LINES).flat(), ...Object.values(NOTES), ...PULL_WORDS];
    for (const line of all) {
      expect(line).toBe(line.toLowerCase());
      expect(line).not.toMatch(/paper\.?io|splix|qix|xonix|voodoo/i);
    }
  });
});
