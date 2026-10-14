import { describe, expect, it } from "vitest";
import { COMMENT_POOLS, GENERIC_POOL, poolFor } from "../seed/comments.ts";
import { DEMO_PEOPLE, DEMO_PLAYER } from "../seed/people.ts";
import { clampScore, formatSeedScore, mulberry32, plausibleScore, sample, worseScore, type ScoreShape } from "../seed/random.ts";

const LAUNCH = ["flapjack", "stackd", "lane-rush", "gambit", "pairs", "merge", "snek", "slice", "breakout-neo", "helix-fall", "reflex", "mines"];
const EMOJI = /\p{Extended_Pictographic}/u;

describe("seed people", () => {
  it("has ~40 distinct, valid handles", () => {
    const handles = DEMO_PEOPLE.map((p) => p.handle);
    expect(handles.length).toBeGreaterThanOrEqual(40);
    expect(new Set(handles).size).toBe(handles.length);
    for (const h of [...handles, DEMO_PLAYER.handle]) expect(h).toMatch(/^[a-z0-9_.]{3,24}$/);
    for (const p of DEMO_PEOPLE) {
      expect(p.displayName.length).toBeLessThanOrEqual(40);
      expect(p.bio.length).toBeLessThanOrEqual(160);
    }
  });
});

describe("seed comments", () => {
  it("covers every launch game and the fixtures, without emoji or lorem", () => {
    for (const slug of [...LAUNCH, "fixture-tap", "fixture-swipe"]) {
      const pool = COMMENT_POOLS[slug];
      expect(pool, slug).toBeDefined();
      expect(pool!.top.length).toBeGreaterThanOrEqual(8);
    }
    for (const pool of [...Object.values(COMMENT_POOLS), GENERIC_POOL]) {
      for (const text of [...pool.top, ...pool.replies, pool.pinned]) {
        expect(text).not.toMatch(EMOJI);
        expect(text.toLowerCase()).not.toContain("lorem");
        expect(text.length).toBeLessThanOrEqual(500);
      }
    }
    expect(poolFor("unknown-game")).toBe(GENERIC_POOL);
  });
});

describe("seed scores", () => {
  const desc: ScoreShape = { order: "desc", max: 1_000_000, format: "integer" };
  const asc: ScoreShape = { order: "asc", max: 600_000, format: "ms" };

  it("is deterministic and respects max and order", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    expect(plausibleScore(a, "merge", desc, 0.5)).toBe(plausibleScore(b, "merge", desc, 0.5));
    const rng = mulberry32(7);
    for (let i = 0; i < 500; i++) {
      const s = plausibleScore(rng, "flapjack", { order: "desc", max: 200, format: "integer" }, rng());
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(200);
      const t = plausibleScore(rng, "reflex", asc, rng());
      expect(t).toBeGreaterThanOrEqual(1);
      expect(t).toBeLessThanOrEqual(asc.max);
    }
  });

  it("makes skilled players score better on average", () => {
    const rng = mulberry32(1);
    const avg = (skill: number, shape: ScoreShape, slug: string) =>
      Array.from({ length: 300 }, () => plausibleScore(rng, slug, shape, skill)).reduce((x, y) => x + y, 0) / 300;
    expect(avg(0.9, desc, "snek")).toBeGreaterThan(avg(0.1, desc, "snek"));
    expect(avg(0.9, asc, "reflex")).toBeLessThan(avg(0.1, asc, "reflex"));
  });

  it("produces worse runs than the best", () => {
    const rng = mulberry32(3);
    for (let i = 0; i < 100; i++) {
      expect(worseScore(rng, 1000, desc)).toBeLessThanOrEqual(1000);
      expect(worseScore(rng, 300, asc)).toBeGreaterThanOrEqual(300);
    }
  });

  it("formats like the shell", () => {
    expect(formatSeedScore(12345, desc)).toBe("12,345");
    expect(formatSeedScore(2345, asc)).toBe("2.35s");
    expect(clampScore(2_000_000, desc)).toBe(1_000_000);
    expect(sample(mulberry32(1), [1, 2, 3], 5)).toHaveLength(3);
  });
});
