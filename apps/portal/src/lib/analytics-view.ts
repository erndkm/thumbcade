import {
  ANALYTICS_MIN_SAMPLE,
  AnalyticsRangeSchema,
  METRIC_DEFINITIONS,
  rateOrNull,
  type AnalyticsRange,
  type GameAnalytics,
  type GameFunnel,
  type Milestone,
  type MilestoneKind,
  type MetricId,
  type NextMilestone,
} from "@thumbcade/protocol";

/** Pure shaping for the creator dashboard (unit-tested; no React, no I/O). */

export function parseRange(value: string | string[] | undefined): AnalyticsRange {
  const parsed = AnalyticsRangeSchema.safeParse(Array.isArray(value) ? value[0] : value);
  return parsed.success ? parsed.data : "7d";
}

/** "38%", "4.2%", "<1%"; never rounds a non-zero share down to 0. */
export function formatPct(share: number): string {
  const p = share * 100;
  if (p > 0 && p < 1) return "<1%";
  return p < 10 && p % 1 !== 0 ? `${p.toFixed(1)}%` : `${Math.round(p)}%`;
}

/** A rate as text, or null when its denominator is under the sample floor. */
export function rateText(numerator: number, denominator: number, minSample = ANALYTICS_MIN_SAMPLE): string | null {
  const r = rateOrNull(numerator, denominator, minSample);
  return r === null ? null : formatPct(r);
}

export interface Delta {
  /** Relative change, e.g. 0.18 for +18 %. Null when there is nothing to compare with. */
  change: number | null;
  text: string | null;
  direction: "up" | "down" | "flat" | null;
}

/** Change against the previous period. Small baselines don't produce "+900 %" headlines. */
export function delta(current: number, previous: number | null | undefined, minBase = 10): Delta {
  if (previous === null || previous === undefined || previous < minBase) return { change: null, text: null, direction: null };
  const change = (current - previous) / previous;
  if (Math.abs(change) < 0.005) return { change: 0, text: "same as before", direction: "flat" };
  const pct = Math.abs(change) * 100;
  const shown = pct < 10 ? pct.toFixed(1).replace(/\.0$/, "") : Math.round(pct).toString();
  return { change, text: `${change > 0 ? "+" : "−"}${shown}%`, direction: change > 0 ? "up" : "down" };
}

export interface BarRow {
  id: MetricId;
  label: string;
  count: number;
  /** Share of the reference total (card views), 0..1. */
  share: number;
}

/** Where people leave, as shares of card views (each category on its own; they don't add up to 100 %). */
export function leaveRows(leave: GameAnalytics["leave"]): BarRow[] {
  const rows: [MetricId, number][] = [
    ["leftInstantly", leave.instantly],
    ["leftAfterWatching", leave.afterWatching],
    ["leftMidRun", leave.midRun],
    ["leftAfterRun", leave.afterRun],
    ["loadFailures", leave.failed],
  ];
  return rows.map(([id, count]) => ({ id, label: METRIC_DEFINITIONS[id].label, count, share: leave.views > 0 ? count / leave.views : 0 }));
}

export interface FunnelStep extends BarRow {
  /** Share of the previous step that made it to this one (null for the first step). */
  kept: number | null;
}

export function funnelSteps(f: GameFunnel): FunnelStep[] {
  const steps: [MetricId, number][] = [
    ["cardViews", f.views],
    ["started", f.started],
    ["played", f.played],
    ["playedAgain", f.playedAgain],
  ];
  return steps.map(([id, count], i) => {
    const prev = i > 0 ? steps[i - 1]![1] : null;
    return {
      id,
      label: METRIC_DEFINITIONS[id].label,
      count,
      share: f.views > 0 ? Math.min(1, count / f.views) : 0,
      kept: prev === null ? null : prev > 0 ? Math.min(1, count / prev) : null,
    };
  });
}

const SOURCE_LABELS: Record<string, string> = { feed: "Feed", gamePage: "Game page", challenge: "Challenge links", dev: "Developer menu" };

export function sourceRows(sources: GameAnalytics["sources"]): { reason: string; label: string; plays: number; share: number }[] {
  const total = sources.reduce((a, s) => a + s.plays, 0);
  return sources.map((s) => ({ reason: s.reason, label: SOURCE_LABELS[s.reason] ?? s.reason, plays: s.plays, share: total > 0 ? s.plays / total : 0 }));
}

export function progressTo(next: NextMilestone | null): number {
  if (!next || next.target <= 0) return 0;
  return Math.max(0, Math.min(1, next.current / next.target));
}

/** Most exciting first: the order a celebration and a batched push pick from. */
const PRIORITY: Record<MilestoneKind, number> = {
  taking_off: 1,
  players: 2,
  playtime: 3,
  best_day: 4,
  first_player: 5,
  first_challenge: 6,
  first_comment: 7,
  first_like: 8,
};

/** The unseen milestone to celebrate on this visit, plus every unseen id (they are all marked seen together). */
export function pickCelebration(milestones: Milestone[]): { milestone: Milestone; unseenIds: string[] } | null {
  const unseen = milestones.filter((m) => m.seenAt === null);
  if (unseen.length === 0) return null;
  const milestone = [...unseen].sort((a, b) => PRIORITY[a.kind] - PRIORITY[b.kind] || b.threshold - a.threshold)[0]!;
  return { milestone, unseenIds: unseen.map((m) => m.id) };
}

/** Return rate of a cohort, or null under the sample floor. */
export function returnRate(r: { returned: number; cohort: number }): string | null {
  return rateText(r.returned, r.cohort);
}

/** "Oct 14" from YYYY-MM-DD, in UTC like the stats. */
export function shortDay(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}
