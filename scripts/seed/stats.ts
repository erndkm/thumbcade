/**
 * Demo creator analytics for the seed (pure; unit-tested in test/seed-data.test.ts).
 *
 * The seed has ~40 real accounts, far too few for believable dashboards, so `game_stats_daily` gets
 * synthetic days. They must still obey the counting rules (docs/analytics): every row is internally
 * consistent (players <= plays, new <= players, the ways of leaving add up to card views, ...), windows of
 * distinct players sit between the busiest day and the sum of days, and all-time totals cover every window.
 */
import { int, type Rng } from "./random.ts";

const DAY = 86_400_000;
/** Days of history the seed writes: enough for the dashboard's 28-day range. */
export const SEED_STAT_DAYS = 28;

export interface SeedStatDay {
  day: string;
  impressions: number;
  ready_count: number;
  play_starts: number;
  play_ends: number;
  total_play_ms: number;
  replays: number;
  fast_skips: number;
  load_failures: number;
  unique_players: number;
  players: number;
  players_7d: number;
  players_28d: number;
  new_players: number;
  plays: number;
  bounced_starts: number;
  active_play_ms: number;
  views_started: number;
  views_played: number;
  views_replayed: number;
  left_instantly: number;
  left_after_watching: number;
  left_mid_run: number;
  left_after_run: number;
  follows: number;
  plays_feed: number;
  plays_game_page: number;
  plays_challenge: number;
  ready_ms_p50: number;
  ready_ms_p90: number;
  returned_d1: number | null;
  returned_d7: number | null;
  is_seed: true;
}

export interface SeedGameShape {
  /** 0..1: how good the game is (drives every rate). */
  quality: number;
  /** Whole days since the game went live. */
  publishedDaysAgo: number;
}

/** Plays split by where they started: mostly the feed, then game pages and challenge links. */
function sources(rng: Rng, plays: number): { plays_feed: number; plays_game_page: number; plays_challenge: number } {
  const plays_challenge = Math.round(plays * (0.03 + rng() * 0.05));
  const plays_game_page = Math.round(plays * (0.08 + rng() * 0.1));
  return { plays_feed: plays - plays_challenge - plays_game_page, plays_game_page, plays_challenge };
}

/** Distinct people in a window: at least the busiest day and every new player, at most the sum of player-days. */
function windowPlayers(days: SeedStatDay[]): number {
  const sum = days.reduce((a, d) => a + d.players, 0);
  const newSum = days.reduce((a, d) => a + d.new_players, 0);
  const busiest = Math.max(0, ...days.map((d) => d.players));
  return Math.min(sum, Math.max(busiest, Math.round(newSum + 0.4 * (sum - newSum))));
}

/**
 * The last SEED_STAT_DAYS days including today (today scaled by the share of the UTC day that has passed),
 * oldest first.
 * Social columns (likes, shares, ...) are left to the caller, which splits real counters across days.
 */
export function seedStatDays(rng: Rng, g: SeedGameShape, now: Date): SeedStatDay[] {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const todayShare = Math.max(0.05, (now.getTime() - today.getTime()) / DAY);
  const isNew = g.publishedDaysAgo <= 5;
  const base = isNew ? 40 + 60 * rng() : 250 + 900 * g.quality * (0.6 + rng() * 0.8);
  const q = g.quality;
  const rows: SeedStatDay[] = [];

  for (let d = SEED_STAT_DAYS - 1; d >= 0; d--) {
    if (d > g.publishedDaysAgo) continue;
    const f = d === 0 ? todayShare : 1;
    const day = new Date(today.getTime() - d * DAY).toISOString().slice(0, 10);
    const age = g.publishedDaysAgo - d;
    const ramp = Math.min(1, (age + 1) / 4);
    const impressions = Math.max(1, Math.round(base * ramp * (0.8 + rng() * 0.4) * f));
    const play_starts = Math.round(impressions * (0.4 + 0.35 * q) * (0.9 + rng() * 0.2));
    const play_ends = Math.round(play_starts * (0.85 + rng() * 0.1));
    const runMs = int(rng, 22_000, 70_000);
    const plays = Math.round(play_starts * (0.8 + 0.12 * q));
    const bounced_starts = play_starts - plays;

    const load_failures = Math.round(impressions * 0.002);
    const views_started = Math.min(impressions - load_failures, Math.round(play_starts / (1.15 + 0.35 * q)));
    const views_played = Math.min(views_started, plays, Math.round(views_started * (0.86 + 0.1 * q)));
    const views_replayed = Math.round(views_played * (0.12 + 0.3 * q));
    const fast_skips = Math.round(impressions * (0.32 - 0.22 * q) * (0.8 + rng() * 0.4));
    const notStarted = impressions - views_started - load_failures;
    const left_instantly = Math.min(notStarted, fast_skips + Math.round(impressions * 0.01));
    const left_after_watching = notStarted - left_instantly;
    const left_mid_run = Math.round(views_started * (0.06 + 0.12 * (1 - q)));
    const left_after_run = views_started - left_mid_run;

    const players = plays === 0 ? 0 : Math.max(1, Math.min(views_played || 1, Math.round(plays / (1.5 + 0.9 * q + rng() * 0.4))));
    const newShare = Math.min(0.95, Math.max(0.3, 0.95 - 0.06 * age)) * (0.9 + rng() * 0.2);
    const new_players = Math.min(players, Math.round(players * newShare));
    const d1 = d >= 2 ? Math.min(new_players, Math.round(new_players * (0.16 + 0.24 * q) * (0.85 + rng() * 0.3))) : null;
    const d7 = d >= 8 && d1 !== null ? Math.min(new_players, Math.max(d1, Math.round(new_players * (0.26 + 0.3 * q) * (0.85 + rng() * 0.3)))) : null;
    const ready_ms_p50 = int(rng, 650, 1300);

    rows.push({
      day,
      impressions,
      ready_count: Math.round(impressions * 0.98),
      play_starts,
      play_ends,
      total_play_ms: play_ends * runMs,
      replays: Math.max(0, plays - views_played),
      fast_skips: Math.min(fast_skips, left_instantly),
      load_failures,
      unique_players: Math.round(players * 1.08),
      players,
      players_7d: 0,
      players_28d: 0,
      new_players,
      plays,
      bounced_starts,
      active_play_ms: Math.round(plays * runMs * 0.9 + bounced_starts * int(rng, 800, 2500)),
      views_started,
      views_played,
      views_replayed,
      left_instantly,
      left_after_watching,
      left_mid_run,
      left_after_run,
      follows: Math.round(players * (0.004 + 0.012 * q)),
      ...sources(rng, plays),
      ready_ms_p50,
      ready_ms_p90: Math.round(ready_ms_p50 * (1.7 + rng() * 0.8)),
      returned_d1: d1,
      returned_d7: d7,
      is_seed: true,
    });
  }

  rows.forEach((row, i) => {
    row.players_7d = windowPlayers(rows.slice(Math.max(0, i - 6), i + 1));
    row.players_28d = Math.max(row.players_7d, windowPlayers(rows.slice(Math.max(0, i - 27), i + 1)));
  });
  return rows;
}

export interface SeedTotals {
  play_count: number;
  player_count: number;
  play_ms_total: number;
}

/**
 * All-time counters for a seeded game: the visible window plus the life before it, and never below the real
 * seeded sessions the triggers already counted.
 */
export function seedTotals(rng: Rng, g: SeedGameShape, days: SeedStatDay[], real: { plays: number; players: number }): SeedTotals {
  const plays = days.reduce((a, d) => a + d.plays, 0);
  const ms = days.reduce((a, d) => a + d.active_play_ms, 0);
  // The days before the visible window ran at about the same pace, a little busier around launch.
  const lifetime = Math.max(1, (g.publishedDaysAgo + 1) / Math.max(1, days.length));
  const launchBump = lifetime > 1 ? 1.2 + 0.6 * g.quality : 1;
  const play_count = Math.round(plays * lifetime * launchBump) + real.plays;
  const msPerPlay = plays > 0 ? ms / plays : 30_000;
  const lastWindow = Math.max(0, ...days.map((d) => d.players_28d));
  const player_count = Math.max(real.players, lastWindow, Math.round(play_count / (3.5 + rng() * 2.5)));
  return { play_count, player_count, play_ms_total: Math.max(ms, Math.round(play_count * msPerPlay)) };
}
