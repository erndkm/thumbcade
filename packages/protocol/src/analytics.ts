import { z } from "zod";
import { BUDGETS, QUALIFIED_PLAY_MS } from "./constants.ts";
import { formatCount } from "./format.ts";

/**
 * Creator analytics: the metric definitions every surface shows (portal dashboard, docs, Creator Hub),
 * milestone kinds and their copy (portal, inbox, push), and the shapes the `creator_*` RPCs return.
 * The counting rules themselves live in SQL (`supabase/migrations/*_creator_analytics.sql`).
 */

const qualifiedSeconds = QUALIFIED_PLAY_MS / 1000;

// ---------------------------------------------------------------------------
// Definitions
// ---------------------------------------------------------------------------

export const AnalyticsRangeSchema = z.enum(["today", "7d", "28d", "all"]);
export type AnalyticsRange = z.infer<typeof AnalyticsRangeSchema>;

export const ANALYTICS_RANGES: readonly { id: AnalyticsRange; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "7d", label: "7 days" },
  { id: "28d", label: "28 days" },
  { id: "all", label: "All time" },
];

export type MetricId =
  | "players"
  | "newPlayers"
  | "returningPlayers"
  | "plays"
  | "bounced"
  | "playtime"
  | "avgPlaytime"
  | "typicalRun"
  | "avgRun"
  | "d1Return"
  | "d7Return"
  | "cardViews"
  | "started"
  | "played"
  | "playedAgain"
  | "leftInstantly"
  | "leftAfterWatching"
  | "leftMidRun"
  | "leftAfterRun"
  | "loadFailures"
  | "readyTime"
  | "sources"
  | "followsGained"
  | "benchmark";

/** One sentence per metric, shown behind every info control and on /docs/analytics. */
export const METRIC_DEFINITIONS: Record<MetricId, { label: string; definition: string }> = {
  players: {
    label: "Players",
    definition: "People with at least one play. Each person counts once per range, and once per day on the chart.",
  },
  newPlayers: { label: "New players", definition: "Players whose first play ever in this game happened that day." },
  returningPlayers: { label: "Returning players", definition: "Players who played that day and had played on an earlier day too." },
  plays: {
    label: "Plays",
    definition: `Runs the game ended, or that reached ${qualifiedSeconds} s of active play, whichever came first. A tap followed by a quick swipe isn't a play.`,
  },
  bounced: { label: "Bounced starts", definition: `Runs that never became plays: the player tapped, then left within ${qualifiedSeconds} s.` },
  playtime: {
    label: "Total playtime",
    definition: "Time spent in runs while the game was running. Paused time, feed drags and time offscreen don't count.",
  },
  avgPlaytime: { label: "Avg playtime per player", definition: "Total playtime divided by the number of players in the range." },
  typicalRun: { label: "Typical run", definition: "The median active playtime of a play: half of all plays were shorter than this." },
  avgRun: { label: "Avg run", definition: "Total playtime divided by plays." },
  d1Return: {
    label: "Day-1 return",
    definition: "Share of a day's new players who played again the next day. Only days whose next day is over count.",
  },
  d7Return: {
    label: "Day-7 return",
    definition: "Share of a day's new players who played again within the next 7 days. Only days whose 7 days are over count.",
  },
  cardViews: { label: "Card views", definition: "Times your game was the card on screen in a feed." },
  started: { label: "Started a run", definition: "Card views where the player tapped to start a run." },
  played: { label: "Played", definition: "Card views with at least one play." },
  playedAgain: { label: "Played again", definition: "Card views with two or more plays." },
  leftInstantly: { label: "Swiped past instantly", definition: "Left within 1.5 s, while the game was loading or showing its attract screen." },
  leftAfterWatching: { label: "Watched, then swiped", definition: "Watched the attract screen for 1.5 s or longer, then swiped on without playing." },
  leftMidRun: { label: "Left mid-run", definition: "Swiped away during a run, or while it was paused." },
  leftAfterRun: { label: "Left after a run", definition: "Swiped on from the result card." },
  loadFailures: {
    label: "Failed to load",
    definition: `Card views where the game didn't call ready() within ${BUDGETS.loadTimeoutMs / 1000} s.`,
  },
  readyTime: { label: "Time to ready", definition: "Time from loading the game to its ready() call: typical (p50) and slow (p90)." },
  sources: { label: "How people found it", definition: "Where plays started: the feed, the game page, or a challenge link." },
  followsGained: { label: "Follows", definition: "People who followed you from this game's card." },
  benchmark: {
    label: "Benchmark",
    definition: "Where this game ranks among live games with 200 or more card views in the last 28 days.",
  },
};

// ---------------------------------------------------------------------------
// Milestones
// ---------------------------------------------------------------------------

export const MilestoneKindSchema = z.enum([
  "players",
  "playtime",
  "first_player",
  "first_like",
  "first_comment",
  "first_challenge",
  "best_day",
  "taking_off",
]);
export type MilestoneKind = z.infer<typeof MilestoneKindSchema>;

export const MilestoneSchema = z.object({
  id: z.string().uuid(),
  gameId: z.string().uuid(),
  gameSlug: z.string(),
  gameName: z.string(),
  iconUrl: z.string().nullable(),
  accentColor: z.string(),
  kind: MilestoneKindSchema,
  /** players: the count passed; playtime: hours; best_day / taking_off: the day as YYYYMMDD; firsts: 1. */
  threshold: z.number(),
  /** players / playtime: the total when it was reached; best_day: players that day; taking_off: the ratio. */
  value: z.number(),
  detail: z.object({ players: z.number().optional(), ratio: z.number().optional() }).passthrough(),
  reachedAt: z.string(),
  seenAt: z.string().nullable(),
  shareCode: z.string().nullable(),
});
export type Milestone = z.infer<typeof MilestoneSchema>;

export interface MilestoneCopy {
  /** Short headline, e.g. "10K players". */
  title: string;
  /** One sentence for the inbox, push body and share card. */
  body: string;
  /** The number the celebration rolls up to. */
  figure: number;
  /** How the figure is printed ("10,000", "3.4×"). */
  figureText: string;
  /** What the figure counts. */
  figureLabel: string;
}

/** "4 days", "5 weeks", "1 year": a floor, so the claim is never bigger than the truth. */
export function nonstopSpan(hours: number): string {
  const days = hours / 24;
  if (days < 14) {
    const d = Math.floor(days);
    return `${d} day${d === 1 ? "" : "s"}`;
  }
  if (days < 365) return `${Math.floor(days / 7)} weeks`;
  const y = Math.floor(days / 365);
  return `${y} year${y === 1 ? "" : "s"}`;
}

const grouped = (n: number) => Math.floor(n).toLocaleString("en-US");

export function milestoneCopy(m: Pick<Milestone, "kind" | "threshold" | "value" | "detail">, gameName: string): MilestoneCopy {
  switch (m.kind) {
    case "players":
      return {
        title: `${formatCount(m.threshold)} players`,
        body: `${gameName} just passed ${grouped(m.threshold)} players.`,
        figure: m.threshold,
        figureText: grouped(m.threshold),
        figureLabel: "players",
      };
    case "playtime":
      return {
        title: `${formatCount(m.threshold)} hours played`,
        body: `${grouped(m.threshold)} hours played in ${gameName}. That's more than ${nonstopSpan(m.threshold)} of nonstop play.`,
        figure: m.threshold,
        figureText: grouped(m.threshold),
        figureLabel: "hours played",
      };
    case "first_player":
      return { title: "First player", body: `${gameName} has its first player. Everyone starts at one.`, figure: 1, figureText: "1", figureLabel: "player" };
    case "first_like":
      return { title: "First like", body: `Someone liked ${gameName}. The first of many.`, figure: 1, figureText: "1", figureLabel: "like" };
    case "first_comment":
      return { title: "First comment", body: `${gameName} got its first comment. Go say hi.`, figure: 1, figureText: "1", figureLabel: "comment" };
    case "first_challenge":
      return {
        title: "First challenge",
        body: `Someone challenged a friend to beat their score in ${gameName}.`,
        figure: 1,
        figureText: "1",
        figureLabel: "challenge sent",
      };
    case "best_day":
      return {
        title: "Best day yet",
        body: `${gameName} just had its best day: ${grouped(m.value)} players.`,
        figure: m.value,
        figureText: grouped(m.value),
        figureLabel: "players in one day",
      };
    case "taking_off": {
      const ratio = m.detail.ratio ?? m.value;
      return {
        title: "Taking off",
        body: `${gameName} is taking off: ${ratio.toFixed(1)}× your usual players today.`,
        figure: ratio,
        figureText: `${ratio.toFixed(1)}×`,
        figureLabel: "your usual players",
      };
    }
  }
}

// ---------------------------------------------------------------------------
// RPC shapes (creator_overview, creator_game_summary, creator_game_funnel, creator_version_compare,
// milestone_card). Numbers come from SQL jsonb; dates are YYYY-MM-DD, timestamps ISO strings.
// ---------------------------------------------------------------------------

const count = z.number().nonnegative();
const nullableMs = z.number().nonnegative().nullable();

export const NextMilestoneSchema = z.object({
  kind: z.enum(["players", "playtime"]),
  target: z.number(),
  current: z.number(),
});
export type NextMilestone = z.infer<typeof NextMilestoneSchema>;

export const CreatorOverviewSchema = z.object({
  totals: z.object({ players: count, plays: count, playMs: count, followers: count }),
  today: z.object({ players: count, plays: count }),
  games: z.array(
    z.object({
      id: z.string().uuid(),
      slug: z.string(),
      name: z.string(),
      iconUrl: z.string().nullable(),
      accentColor: z.string(),
      status: z.string(),
      players: count,
      plays: count,
      playMs: count,
      todayPlayers: count,
      spark: z.array(z.object({ day: z.string(), players: count })),
      next: NextMilestoneSchema.nullable(),
    }),
  ),
  milestones: z.array(MilestoneSchema),
  playtimeSince: z.string(),
});
export type CreatorOverview = z.infer<typeof CreatorOverviewSchema>;

export const PeriodSchema = z.object({
  players: count,
  newPlayers: count,
  plays: count,
  bounced: count,
  playMs: count,
  views: count,
  typicalRunMs: nullableMs,
});
export type Period = z.infer<typeof PeriodSchema>;

export const ReturnCohortSchema = z.object({ returned: count, cohort: count });

export const GameAnalyticsSchema = z.object({
  range: AnalyticsRangeSchema,
  from: z.string(),
  to: z.string(),
  current: PeriodSchema,
  previous: PeriodSchema.nullable(),
  series: z.array(z.object({ day: z.string(), players: count, newPlayers: count, plays: count, playMs: count })),
  /** Milestones reached and versions released inside the chart's days. */
  markers: z.array(
    z.union([
      z.object({ day: z.string(), type: z.literal("milestone"), kind: MilestoneKindSchema, threshold: z.number(), value: z.number() }),
      z.object({ day: z.string(), type: z.literal("version"), semver: z.string() }),
    ]),
  ),
  leave: z.object({ views: count, instantly: count, afterWatching: count, midRun: count, afterRun: count, failed: count }),
  engagement: z.object({ likes: count, comments: count, shares: count, saves: count, follows: count }),
  sources: z.array(z.object({ reason: z.string(), plays: count })),
  health: z.object({ readyP50: nullableMs, readyP90: nullableMs, loadFailures: count, views: count }),
  returns: z.object({ d1: ReturnCohortSchema, d7: ReturnCohortSchema }),
  benchmarks: z
    .object({
      gamesCompared: count,
      playRate: z.number().nullable(),
      leftInstantly: z.number().nullable(),
      replayRate: z.number().nullable(),
      avgPlaytime: z.number().nullable(),
      d1Return: z.number().nullable(),
    })
    .nullable(),
  next: NextMilestoneSchema.nullable(),
  playtimeSince: z.string(),
});
export type GameAnalytics = z.infer<typeof GameAnalyticsSchema>;

export const GameFunnelSchema = z.object({ views: count, started: count, played: count, playedAgain: count });
export type GameFunnel = z.infer<typeof GameFunnelSchema>;

export const VersionCompareSchema = z.array(
  z.object({
    versionId: z.string().uuid(),
    semver: z.string(),
    isLive: z.boolean(),
    releasedAt: z.string().nullable(),
    /** Days this version was live (as rolled up). */
    days: count,
    plays: count,
    playMs: count,
    d1: ReturnCohortSchema,
    views: count,
    leftInstantly: count,
  }),
);
export type VersionCompare = z.infer<typeof VersionCompareSchema>;

export const MilestoneCardSchema = z.object({
  code: z.string(),
  kind: MilestoneKindSchema,
  threshold: z.number(),
  value: z.number(),
  detail: z.object({ players: z.number().optional(), ratio: z.number().optional() }).passthrough(),
  reachedAt: z.string(),
  game: z.object({ slug: z.string(), name: z.string(), iconUrl: z.string().nullable(), accentColor: z.string(), description: z.string() }),
  creator: z.object({ handle: z.string(), displayName: z.string() }),
});
export type MilestoneCard = z.infer<typeof MilestoneCardSchema>;

/** A rate for the dashboard, or null when the denominator is too small to mean anything. */
export function rateOrNull(numerator: number, denominator: number, minSample: number): number | null {
  if (!(denominator >= minSample) || denominator <= 0) return null;
  return numerator / denominator;
}
