import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { QUALIFIED_PLAY_MS } from "@thumbcade/protocol";
import { describe, expect, it } from "vitest";
import { COMMENT_POOLS, GENERIC_POOL, poolFor } from "../seed/comments.ts";
import { DEMO_PEOPLE, DEMO_PLAYER } from "../seed/people.ts";
import { clampScore, formatSeedScore, mulberry32, plausibleScore, sample, worseScore, type ScoreShape } from "../seed/random.ts";
import { SEED_STAT_DAYS, seedStatDays, seedTotals } from "../seed/stats.ts";

/** Every game in games/ (what `pnpm games:build` indexes and `pnpm seed` seeds). */
const GAMES = readdirSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../games"), { withFileTypes: true })
  .filter((e) => e.isDirectory() && !e.name.startsWith("_") && !e.name.startsWith("."))
  .map((e) => e.name);
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
  it("covers every game and the fixtures, without emoji or lorem", () => {
    expect(GAMES.length).toBeGreaterThanOrEqual(25);
    for (const slug of [...GAMES, "fixture-tap", "fixture-swipe"]) {
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
    expect(plausibleScore(a, "shortwick", desc, 0.5)).toBe(plausibleScore(b, "shortwick", desc, 0.5));
    const rng = mulberry32(7);
    for (let i = 0; i < 500; i++) {
      const s = plausibleScore(rng, "flapjack", { order: "desc", max: 200, format: "integer" }, rng());
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(200);
      const t = plausibleScore(rng, "kneejerk", asc, rng());
      expect(t).toBeGreaterThanOrEqual(1);
      expect(t).toBeLessThanOrEqual(asc.max);
    }
  });

  it("makes skilled players score better on average", () => {
    const rng = mulberry32(1);
    const avg = (skill: number, shape: ScoreShape, slug: string) =>
      Array.from({ length: 300 }, () => plausibleScore(rng, slug, shape, skill)).reduce((x, y) => x + y, 0) / 300;
    expect(avg(0.9, desc, "snek")).toBeGreaterThan(avg(0.1, desc, "snek"));
    expect(avg(0.9, asc, "kneejerk")).toBeLessThan(avg(0.1, asc, "kneejerk"));
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

describe("seed analytics", () => {
  const NOW = new Date("2026-10-14T15:00:00Z");
  const shapes = [
    { quality: 0.95, publishedDaysAgo: 40 },
    { quality: 0.5, publishedDaysAgo: 12 },
    { quality: 0.45, publishedDaysAgo: 3 },
  ];

  it("writes days that follow the counting rules", () => {
    for (const [i, shape] of shapes.entries()) {
      const days = seedStatDays(mulberry32(100 + i), shape, NOW);
      expect(days.at(-1)!.day).toBe("2026-10-14");
      expect(days.length).toBe(Math.min(SEED_STAT_DAYS, shape.publishedDaysAgo + 1));
      for (const d of days) {
        const at = `${d.day} q${shape.quality}`;
        expect(d.plays + d.bounced_starts, at).toBe(d.play_starts);
        expect(d.players, at).toBeLessThanOrEqual(d.plays);
        expect(d.new_players, at).toBeLessThanOrEqual(d.players);
        expect(d.views_played, at).toBeLessThanOrEqual(d.views_started);
        expect(d.views_played, at).toBeLessThanOrEqual(d.plays);
        expect(d.views_replayed, at).toBeLessThanOrEqual(d.views_played);
        expect(d.left_instantly + d.left_after_watching + d.left_mid_run + d.left_after_run + d.load_failures, at).toBe(d.impressions);
        for (const v of [d.left_after_watching, d.left_mid_run, d.left_after_run, d.replays, d.fast_skips]) expect(v, at).toBeGreaterThanOrEqual(0);
        expect(d.players_7d, at).toBeGreaterThanOrEqual(d.players);
        expect(d.players_28d, at).toBeGreaterThanOrEqual(d.players_7d);
        expect(d.ready_ms_p90, at).toBeGreaterThan(d.ready_ms_p50);
        expect(d.plays_feed + d.plays_game_page + d.plays_challenge, at).toBe(d.plays);
        expect(Math.min(d.plays_feed, d.plays_game_page, d.plays_challenge), at).toBeGreaterThanOrEqual(0);
        if (d.returned_d7 !== null) expect(d.returned_d7, at).toBeGreaterThanOrEqual(d.returned_d1 ?? 0);
        if (d.returned_d1 !== null) expect(d.returned_d1, at).toBeLessThanOrEqual(d.new_players);
      }
      // Return rates only exist for days whose window is over.
      expect(days.find((d) => d.day === "2026-10-13")?.returned_d1 ?? null).toBeNull();
      expect(days.find((d) => d.day === "2026-10-08")?.returned_d7 ?? null).toBeNull();
      // A window of distinct players never exceeds its player-days.
      const last = days.at(-1)!;
      const week = days.slice(-7);
      expect(last.players_7d).toBeLessThanOrEqual(week.reduce((a, d) => a + d.players, 0));
      expect(last.players_7d).toBeGreaterThanOrEqual(week.reduce((a, d) => a + d.new_players, 0));
    }
  });

  it("keeps all-time totals above every window and the real sessions", () => {
    for (const [i, shape] of shapes.entries()) {
      const days = seedStatDays(mulberry32(200 + i), shape, NOW);
      const t = seedTotals(mulberry32(300 + i), shape, days, { plays: 37, players: 12 });
      expect(t.play_count).toBeGreaterThanOrEqual(days.reduce((a, d) => a + d.plays, 0) + 37);
      expect(t.player_count).toBeGreaterThanOrEqual(Math.max(12, ...days.map((d) => d.players_28d)));
      expect(t.player_count).toBeLessThanOrEqual(t.play_count);
      expect(t.play_ms_total).toBeGreaterThanOrEqual(days.reduce((a, d) => a + d.active_play_ms, 0));
    }
  });
});

describe("analytics contract", () => {
  it("uses the same qualifying threshold in TypeScript and SQL", () => {
    const sql = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../supabase/migrations/20261014120100_creator_analytics.sql"), "utf8");
    const m = /"qualifiedPlayMs":\s*(\d+)/.exec(sql);
    expect(m, "qualifiedPlayMs in the analytics config row").not.toBeNull();
    expect(Number(m![1])).toBe(QUALIFIED_PLAY_MS);
  });
});
