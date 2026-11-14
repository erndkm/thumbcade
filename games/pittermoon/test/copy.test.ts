import { describe, expect, it } from "vitest";
import { BANNER_TEXT, overHint, overLines, PANEL_TEXT, TIER_LINES, TIER_SUBS } from "../src/copy.ts";
import { chunkyCovers, chunkyWidth, textWidth } from "../src/font.ts";
import { FISH_LANE, hudLanes, ROWS_W, SCORE_LANE } from "../src/layout.ts";
import type { RunStats } from "../src/run.ts";
import { BIOMES } from "../src/world.ts";

const base: RunStats = {
  taps: 40, swipes: 6, hops: 40, sides: 6, bumps: 1,
  bonks: { broom: 1, pumpkin: 0, yarn: 0, wisp: 0 },
  splashes: 0, sinks: 0, edges: 0, whiskers: 4, escapes: 0, fish: 3, gold: 0, lifts: 1,
  bestStreak: 12, maxTier: 2, scrambles: 0, still: 2, caughtWaiting: false, stretches: 1,
};

/** Every way a run can go, for the hint and the panel. */
function variants(): RunStats[] {
  const v: RunStats[] = [base];
  v.push({ ...base, taps: 0, swipes: 0 });
  v.push({ ...base, swipes: 0, bumps: 4 });
  v.push({ ...base, splashes: 3, edges: 2 });
  v.push({ ...base, splashes: 3 });
  v.push({ ...base, sinks: 2 });
  v.push({ ...base, bonks: { ...base.bonks, broom: 4 } });
  v.push({ ...base, bonks: { ...base.bonks, pumpkin: 4 } });
  v.push({ ...base, bonks: { ...base.bonks, yarn: 3 } });
  v.push({ ...base, bonks: { ...base.bonks, wisp: 3 } });
  v.push({ ...base, caughtWaiting: true });
  v.push({ ...base, maxTier: 0 });
  v.push({ ...base, fish: 0 });
  v.push({ ...base, fish: 4, lifts: 0 });
  v.push({ ...base, maxTier: 3, lifts: 1, whiskers: 1 });
  v.push({ ...base, maxTier: 3, lifts: 1, whiskers: 9 });
  return v;
}

describe("copy fits its plate", () => {
  it("every game-over hint fits the panel, and they are all different", () => {
    const hints = variants().map((s) => overHint({ rows: 40, score: 900, stats: s }));
    for (const h of hints) expect(textWidth(h), h).toBeLessThanOrEqual(PANEL_TEXT);
    expect(new Set(hints).size).toBe(hints.length);
  });

  it("every game-over line fits the fixed panel, for any run", () => {
    for (const rows of [0, 1, 9, 42, 150, 999]) {
      for (const [score, best] of [[0, null], [240, null], [99_999, 1], [5_000, 10_000], [10_000, 10_000], [499_999, 9_999]] as Array<[number, number | null]>) {
        for (const s of [base, { ...base, fish: 99 }]) for (const line of overLines({ rows, score, stats: s }, best)) expect(textWidth(line), line).toBeLessThanOrEqual(PANEL_TEXT);
      }
    }
  });

  it("the attract plate and the first-run hints fit", () => {
    for (const t of ["~ tap to play ~", "ahead of the sun", "best 499,999"]) expect(textWidth(t), t).toBeLessThanOrEqual(PANEL_TEXT);
    for (const t of ["tap to pad up", "a row at a time ~", "swipe sideways", "to sidestep ~"]) expect(textWidth(t), t).toBeLessThanOrEqual(BANNER_TEXT);
  });

  it("banners fit, and every big line has a glyph for each letter", () => {
    for (const b of BIOMES) expect(textWidth(b.name)).toBeLessThanOrEqual(BANNER_TEXT);
    for (const t of ["new stretch +9,000", "stay ahead of the sun", "five fish: up we go", "row 499 · 499,999", "past row 499"]) expect(textWidth(t), t).toBeLessThanOrEqual(BANNER_TEXT);
    for (const t of [...TIER_LINES.slice(1).map((l) => l.replace("!", "")), "broom ride!", "best row!", "sunrise"]) {
      expect(chunkyCovers(t), t).toBe(true);
      expect(chunkyWidth(t) + 4, t).toBeLessThanOrEqual(BANNER_TEXT);
    }
    for (const t of TIER_SUBS.slice(1)) expect(textWidth(t)).toBeLessThanOrEqual(BANNER_TEXT);
  });

  it("the HUD lanes never touch, down to a 130 px screen", () => {
    for (const w of [130, 135, 143, 188, 205]) {
      const l = hudLanes(w);
      expect(l.gap, `${w} px`).toBeGreaterThanOrEqual(4);
      expect(l.fishX + FISH_LANE).toBeLessThanOrEqual(w - 2);
    }
    expect(SCORE_LANE).toBeGreaterThanOrEqual(textWidth("999,999") + textWidth("x4") + 3);
    expect(ROWS_W).toBeGreaterThan(textWidth("999"));
  });
});
