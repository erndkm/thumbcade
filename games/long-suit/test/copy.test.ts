import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { clearLine, dealLine, DEK, hintFor, HINTS, kicker, LINES, PROMPT, summaryLines, TEACH, tierLine, TITLE } from "../src/copy.ts";
import { SPECS, specOf } from "../src/deal.ts";
import { attractLayout, LANE_PX, SUMMARY_PAD, SUMMARY_PX, summaryPlate } from "../src/layout.ts";
import { multOf, TUNE, type Stats } from "../src/run.ts";
import { measure } from "../scripts/fonts.ts";

/**
 * Every line we can show must fit where it goes in Instrument Serif, measured with the font's own advance widths
 * and kerning (the same woff2 the game ships), on the narrowest phone.
 */
const W = 360;
const H = 724;
const INS = { top: 72, right: 72, bottom: 148, left: 0 };
const LANE_W = W - 24;
const PLATE_W = summaryPlate(W, H, INS, false).w - 2 * SUMMARY_PAD;

const stats = (over: Partial<Stats> = {}): Stats => ({ seconds: 60, deals: 3, home: 90, flips: 40, taps: 110, duds: 2, draws: 30, turns: 3, bestChain: 30, bestMult: 5, afresh: 0, ...over });

/** A run that earns each tip. */
const CASES: Record<keyof typeof HINTS, Stats> = {
  noTap: stats({ taps: 0, home: 0, deals: 0, flips: 0, draws: 0, duds: 0 }),
  noHome: stats({ taps: 6, home: 0, deals: 0, flips: 0, draws: 6, duds: 0 }),
  duds: stats({ taps: 20, duds: 8, home: 5, deals: 0 }),
  pack: stats({ taps: 9, duds: 1, home: 4, deals: 0, draws: 0 }),
  hidden: stats({ taps: 30, home: 6, deals: 0, flips: 2, draws: 20 }),
  slow: stats({ taps: 30, home: 12, deals: 0, flips: 7, draws: 12 }),
  chain: stats({ deals: 1, bestMult: 2 }),
  deep: stats(),
};

describe("copy", () => {
  it("every tip is reached by some run, and each run gets the tip it asks for", () => {
    for (const key of Object.keys(HINTS) as Array<keyof typeof HINTS>) expect(hintFor(CASES[key]), key).toBe(HINTS[key]);
    expect(new Set(Object.values(HINTS)).size).toBe(Object.keys(HINTS).length);
    expect(Object.keys(CASES).sort()).toEqual(Object.keys(HINTS).sort());
  });

  it("tips quote the real rules", () => {
    expect(TUNE.tiers[1]).toBe(9);
    expect(HINTS.chain).toBe("nine home in a row pays ×3");
    expect(multOf(TUNE.tiers[1]!)).toBe(3);
    expect(TUNE.homeTime).toBeGreaterThan(0);
  });

  it("every tip fits the game-over slip at full size", async () => {
    for (const hint of Object.values(HINTS)) expect(await measure(hint, SUMMARY_PX[2]), hint).toBeLessThanOrEqual(PLATE_W);
  });

  it("the game-over lines fit the slip: the stats at full size, the head at full size for any score a run reaches", async () => {
    const lines = [summaryLines(0, null, stats({ home: 0, deals: 0 })), summaryLines(880, null, stats({ deals: 1 })), summaryLines(12480, 9850, stats({ deals: 6, home: 240, bestChain: 99 })), summaryLines(9850, 9850, stats()), summaryLines(640, 12480, stats({ deals: 0 }))];
    for (const [head, mid] of lines) {
      expect(await measure(head, SUMMARY_PX[0]), head).toBeLessThanOrEqual(PLATE_W);
      expect(await measure(mid, SUMMARY_PX[1]), mid).toBeLessThanOrEqual(PLATE_W);
    }
    // The longest head there could ever be still fits once shrunk, and never below 15 px.
    const extreme = summaryLines(1, 999999, stats())[0];
    expect((await measure(extreme, SUMMARY_PX[0])) * (15 / SUMMARY_PX[0])).toBeLessThanOrEqual(PLATE_W);
    expect(summaryLines(880, null, stats({ deals: 1 }))[0]).toBe("880 · a first best");
    expect(summaryLines(12480, 9850, stats())[0]).toBe("12,480 · a new best by 2,630");
    expect(summaryLines(640, 12480, stats())[0]).toBe("640 · 11,840 short of your best");
    expect(summaryLines(0, null, stats({ home: 0 }))[0]).toBe("no cards home yet");
    expect(summaryLines(100, null, stats({ deals: 1, home: 20, bestChain: 7 }))[1]).toBe("one deal · 20 home · 7 in a row");
  });

  it("every line of news fits the lane at full size: deals, multipliers, a cleared deal, the dead end, the first-run lines", async () => {
    const lines: string[] = [...Object.values(LINES), ...TEACH];
    for (let level = 0; level < 40; level++) lines.push(dealLine(level, specOf(level).ranks));
    for (const t of TUNE.tiers) lines.push(tierLine(t, multOf(t)));
    lines.push(tierLine(77, 5), clearLine(12345, 5.5), clearLine(100, 3));
    for (const l of lines) expect(await measure(l, LANE_PX), l).toBeLessThanOrEqual(LANE_W);
    expect(dealLine(0, SPECS[0]!.ranks)).toBe("deal i · ace to five");
    expect(dealLine(4, 13)).toBe("deal v · ace to king");
    expect(tierLine(9, 3)).toBe("nine home in a row · ×3");
    expect(clearLine(350, 5.5)).toBe("all home · +350 · +5.5s");
    expect(clearLine(350, 3)).toBe("all home · +350 · +3s");
  });

  it("the title block and the prompt fit what the feed leaves free", async () => {
    const L = attractLayout(W, H, INS);
    // The title is set as large as fits; the dek may close up, but not below 13 px.
    expect((await measure(TITLE, 58)) * (32 / 58)).toBeLessThanOrEqual(L.w);
    expect((await measure(DEK, 17)) * (13 / 17)).toBeLessThanOrEqual(L.w);
    expect(await measure(kicker(366), 15)).toBeLessThanOrEqual(L.w);
    expect((await measure(PROMPT, 20)) + 16 + (await measure("best 99,999", 15))).toBeLessThanOrEqual(L.w);
    expect(TITLE).toBe("Long Suit");
  });

  it("names no other game or maker anywhere in the bundle's source, and the copy calls the game patience", () => {
    const banned = /microsoft|mobilityware|freecell|spider|tripeaks|pyramid|vegas|grand harvest/i;
    const dir = new URL("../src/", import.meta.url);
    for (const f of readdirSync(dir)) {
      if (!f.endsWith(".ts")) continue;
      expect(banned.test(readFileSync(new URL(f, dir), "utf8")), f).toBe(false);
    }
    const manifest = readFileSync(new URL("../thumbcade.json", import.meta.url), "utf8");
    expect(banned.test(manifest)).toBe(false);
    expect(/klondike/i.test(manifest + readFileSync(new URL("copy.ts", dir), "utf8"))).toBe(false);
    expect(kicker(1)).toContain("patience");
  });
});
