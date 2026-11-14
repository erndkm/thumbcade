import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BANNER_TEXT, hintFor, HINTS, LINES, overLines, PANEL_TEXT, TEACH, TITLE } from "../src/copy.ts";
import { chunkyCovers, chunkyWidth, textWidth } from "../src/font.ts";
import { PURR_NAMES, TUNE, type Stats } from "../src/run.ts";

const stats = (over: Partial<Stats> = {}): Stats => ({ seconds: 60, rugs: 6, cats: 60, bumps: 2, bestStreak: 30, bestPurr: 5, cleanRugs: 4, lastOut: 5, misses: 0, ...over });

describe("copy", () => {
  it("picks the tip the run asks for", () => {
    expect(hintFor(stats({ cats: 0, rugs: 0 }))).toBe(HINTS.none);
    expect(hintFor(stats({ cats: 3, rugs: 0 }))).toBe(HINTS.noRug);
    expect(hintFor(stats({ bumps: 14 }))).toBe(HINTS.bumps);
    expect(hintFor(stats({ cats: 20, rugs: 2, lastOut: 2 }))).toBe(HINTS.slow);
    expect(hintFor(stats({ lastOut: 1 }))).toBe(HINTS.last);
    expect(hintFor(stats({ bestStreak: 6 }))).toBe(HINTS.streak);
    expect(hintFor(stats())).toBe(HINTS.deep);
    expect(HINTS.streak).toContain(String(TUNE.tiers[1]));
  });

  it("every tip and every game-over line fits its panel", () => {
    for (const h of Object.values(HINTS)) expect(textWidth(h), h).toBeLessThanOrEqual(PANEL_TEXT);
    const cases: Array<[number, number | null, Stats]> = [
      [0, null, stats({ cats: 0, rugs: 0 })],
      [120, null, stats({ rugs: 1, cats: 4 })],
      [999999, 999998, stats({ rugs: 12, cats: 144 })],
      [999999, 1, stats({ rugs: 12, cats: 144 })],
      [1, 999999, stats({ rugs: 0, cats: 1 })],
      [5000, 5000, stats()],
      [4000, 5000, stats()],
    ];
    for (const [score, best, s] of cases) for (const line of overLines(score, best, s)) expect(textWidth(line), line).toBeLessThanOrEqual(PANEL_TEXT);
    expect(overLines(120, null, stats({ rugs: 1, cats: 4 }))[0]).toBe("first best: 120");
    expect(overLines(5200, 5000, stats())[0]).toBe("new best! +200");
    expect(overLines(4000, 5000, stats())[0]).toBe("1,000 off best");
    expect(overLines(495, 500, stats())[0]).toBe("5 short of best");
    expect(overLines(1, 999999, stats())[0]).toBe("999,998 off best");
    expect(overLines(0, null, stats({ cats: 0, rugs: 0 }))[0]).toBe("no cats out yet");
    expect(overLines(100, null, stats({ rugs: 1, cats: 4 }))[1]).toBe("1 rug ~ 4 cats");
  });

  it("plates, banners and the prompt fit the narrowest screen", () => {
    for (const pair of TEACH) for (const line of pair) expect(textWidth(line), line).toBeLessThanOrEqual(BANNER_TEXT);
    for (const line of [`${LINES.clean} ~`, `${LINES.last} ~`, "+7.5s of candle", "+99,999", LINES.out, LINES.past, LINES.hurry]) expect(textWidth(line), line).toBeLessThanOrEqual(BANNER_TEXT);
    for (const name of PURR_NAMES) expect(textWidth(`${name} x5`), name).toBeLessThanOrEqual(BANNER_TEXT);
    // The attract prompt and its line sit in the 80 px panel left of the rail.
    for (const line of ["~ tap to play ~", "clear the rug", "best 999,999"]) expect(textWidth(line), line).toBeLessThanOrEqual(PANEL_TEXT);
  });

  it("the big lettering has every glyph it needs and fits its sign", () => {
    for (const s of [TITLE, LINES.clear, LINES.best]) {
      expect(chunkyCovers(s), s).toBe(true);
      expect(chunkyWidth(s, 1), s).toBeLessThanOrEqual(94);
    }
    expect(TITLE).toBe("scootpurr");
  });

  it("names no other game anywhere in the bundle's source or its manifest", () => {
    const banned = /parking ?jam|tap ?away|unblock|rush ?hour|arrows|traffic|car ?(jam|escape)/i;
    const dir = new URL("../src/", import.meta.url);
    for (const f of readdirSync(dir)) expect(banned.test(readFileSync(new URL(f, dir), "utf8")), f).toBe(false);
    expect(banned.test(readFileSync(new URL("../thumbcade.json", import.meta.url), "utf8"))).toBe(false);
  });
});
