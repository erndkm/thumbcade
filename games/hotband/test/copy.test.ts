import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { charsFit, COACH, hintFor, HINTS, SUB, summaryLines, TITLE, wrapWords } from "../src/copy.ts";
import { summaryBox } from "../src/layout.ts";
import { CUT_NAMES, GAIN_NAMES, TUNE, type Stats } from "../src/run.ts";

const stats = (over: Partial<Stats> = {}): Stats => ({
  seconds: 60, pieces: 40, rows: 12, singles: 8, doubles: 2, triples: 0, bestChain: 5, bestGain: 3, hot: 1, silences: 0,
  slams: 30, turns: 20, slides: 60, softs: 2, noisePushed: 8, noiseCut: 2, idle: 0, trips: 0, left: 40, ...over,
});

describe("copy", () => {
  it("picks the hint the run asks for", () => {
    expect(hintFor(stats({ slams: 0 }))).toBe(HINTS.noSlam);
    expect(hintFor(stats({ turns: 0 }))).toBe(HINTS.noTurn);
    expect(hintFor(stats({ rows: 0 }))).toBe(HINTS.noRow);
    expect(hintFor(stats({ pieces: 15 }))).toBe(HINTS.slow);
    expect(hintFor(stats({ rows: 3, left: 60 }))).toBe(HINTS.gaps);
    expect(hintFor(stats({ bestGain: 1 }))).toBe(HINTS.chain);
    expect(hintFor(stats({ doubles: 0 }))).toBe(HINTS.doubles);
    expect(hintFor(stats({ noiseCut: 0 }))).toBe(HINTS.noise);
    expect(hintFor(stats({ hot: 0 }))).toBe(HINTS.hot);
    expect(hintFor(stats())).toBe(HINTS.deep);
    // An idle run: nothing was slammed because nothing was done at all.
    expect(hintFor(stats({ pieces: 10, slams: 0, turns: 0, rows: 0 }))).toBe(HINTS.noSlam);
  });

  it("hints quote the real rules", () => {
    expect(HINTS.deep).toContain(String(TUNE.tiers[3]));
    expect(TUNE.chainGrace).toBe(1);
    expect(HINTS.chain).toContain("TWO PIECES");
    expect(HINTS.noRow).toContain("EIGHT");
  });

  it("every hint fits the game-over panel in two lines on the narrowest phone", () => {
    const box = summaryBox(360, 724, { top: 72, right: 72, bottom: 148, left: 0 }, false, 2);
    const max = charsFit(box.w - 28, 10);
    for (const hint of Object.values(HINTS)) {
      const lines = wrapWords(`NEXT: ${hint}`, max);
      expect(lines.length, hint).toBeLessThanOrEqual(2);
      for (const l of lines) expect(l.length, hint).toBeLessThanOrEqual(max);
    }
  });

  it("the game-over lines read right for a first score, a best, a tie and a miss", () => {
    const s = stats();
    expect(summaryLines(1200, null, s, "X")[0]).toBe("FIRST BEST · 1,200");
    expect(summaryLines(1200, 1000, s, "X")[0]).toBe("NEW BEST · 1,200 · +200");
    expect(summaryLines(1000, 1000, s, "X")[0]).toBe("LEVEL WITH YOUR BEST · 1,000");
    expect(summaryLines(400, 1000, s, "X")[0]).toBe("BEST 1,000 · 600 TO GO");
    expect(summaryLines(0, null, stats({ rows: 0 }), "X")[0]).toBe("NO SCORE YET · CUT ONE ROW");
    expect(summaryLines(100, null, stats({ rows: 1 }), "X")[1]).toBe("1 ROW · CHAIN 5 · GAIN ×3");
    expect(summaryLines(100, null, s, "X")[2]).toBe("NEXT: X");
    // The widest head still fits the panel at its smallest size.
    const head = summaryLines(999999, 999998, s, "X")[0];
    expect(head.length * 8 * 0.68).toBeLessThanOrEqual(360 - 72 - 24 - 28);
  });

  it("banners and tier names are short enough for the meter", () => {
    for (const name of [...GAIN_NAMES, ...CUT_NAMES, "SILENCE", "CLIPPED", "NEW BEST"]) expect(name.length).toBeLessThanOrEqual(11);
    expect(COACH).toHaveLength(3);
    expect(TITLE).toBe("HOTBAND");
    expect(SUB.length).toBeLessThanOrEqual(34);
  });

  it("names no other game anywhere in the bundle's source or its manifest", () => {
    const banned = /tetri|tetro|block ?blast|lumines|columns|puyo|dr\. ?mario/i;
    const dir = new URL("../src/", import.meta.url);
    for (const f of readdirSync(dir)) expect(banned.test(readFileSync(new URL(f, dir), "utf8")), f).toBe(false);
    expect(banned.test(readFileSync(new URL("../thumbcade.json", import.meta.url), "utf8"))).toBe(false);
    expect(banned.test(readFileSync(new URL("../index.html", import.meta.url), "utf8"))).toBe(false);
  });
});
