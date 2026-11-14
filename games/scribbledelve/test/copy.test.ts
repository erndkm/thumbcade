import { describe, expect, it } from "vitest";
import { bestLine, CARD, hintFor, LINES, NOTES, statLine, SUBTITLE, TAP, TITLE } from "../src/copy.ts";
import type { Stats } from "../src/sim.ts";

const stats = (o: Partial<Stats> = {}): Stats => ({ coins: 80, poofs: 3, swords: 2, swordsWasted: 0, shaves: 1, stars: 0, floors: 1, maxStreak: 30, maxMult: 3, swipes: 60, bumps: 2, caughtBy: [1, 1, 1, 0], ...o });

describe("what the page says", () => {
  it("is short enough for its scraps, lowercase, and names no other game", () => {
    const all = [TITLE, SUBTITLE, TAP, ...Object.values(LINES).flat(), ...Object.values(NOTES), ...Object.values(CARD)];
    for (const line of all) {
      expect(line.length, line).toBeLessThanOrEqual(42);
      expect(line, line).not.toMatch(/pac|ghost|pellet|namco|blinky|pinky|inky|clyde/i);
    }
    for (const line of [SUBTITLE, TAP, ...Object.values(NOTES)]) expect(line).toBe(line.toLowerCase());
    expect(TITLE).toBe("Scribbledelve");
  });

  it("gives one hint drawn from the run, each at most two lines on the card", () => {
    const cases: Array<[Partial<Stats>, number, RegExp]> = [
      [{ swipes: 0, coins: 0 }, 1, /swipe any way/],
      [{ coins: 5 }, 1, /keep him moving/],
      [{ swords: 2, swordsWasted: 2 }, 2, /a sword is for chasing/],
      [{ swords: 0 }, 1, /grab a sword/],
      [{ bumps: 30 }, 2, /swipe a little early/],
      [{ caughtBy: [0, 3, 0, 0] }, 3, /sneak/],
      [{ caughtBy: [3, 0, 0, 0] }, 3, /grumble/],
      [{ maxMult: 2 }, 3, /coins in a row/],
      [{}, 3, /save a sword/],
    ];
    const seen = new Set<string>();
    for (const [o, floor, re] of cases) {
      const h = hintFor(stats(o), floor);
      expect(h).toMatch(re);
      expect(h.length, h).toBeLessThanOrEqual(62);
      seen.add(h);
    }
    expect(seen.size).toBe(cases.length);
  });

  it("sums the run up in one line and compares it with the best", () => {
    expect(statLine(stats({ coins: 1, poofs: 1 }), 2)).toBe("floor 2 · 1 coin · 1 scribble poofed");
    expect(statLine(stats(), 3)).toBe("floor 3 · 80 coins · 3 scribbles poofed");
    const fmt = (n: number) => String(n);
    expect(bestLine(0, 500, false, fmt)).toBe(CARD.none);
    expect(bestLine(700, 500, true, fmt)).toBe("new best! +200 on your old one");
    expect(bestLine(700, null, true, fmt)).toBe(CARD.first);
    expect(bestLine(250, 500, false, fmt)).toBe("50% of your best (500)");
  });
});
