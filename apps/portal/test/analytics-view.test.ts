import type { Milestone } from "@thumbcade/protocol";
import { describe, expect, it } from "vitest";
import { delta, formatPct, funnelSteps, leaveRows, parseRange, pickCelebration, progressTo, rateText, returnRate, sourceRows } from "../src/lib/analytics-view";

const milestone = (over: Partial<Milestone>): Milestone => ({
  id: "00000000-0000-4000-8000-000000000001",
  gameId: "00000000-0000-4000-8000-000000000002",
  gameSlug: "duskrail",
  gameName: "Duskrail",
  iconUrl: null,
  accentColor: "#FF6A1A",
  kind: "players",
  threshold: 100,
  value: 104,
  detail: {},
  reachedAt: "2026-10-14T10:00:00Z",
  seenAt: null,
  shareCode: null,
  ...over,
});

describe("creator dashboard view helpers", () => {
  it("defaults unknown ranges to 7 days", () => {
    expect(parseRange("28d")).toBe("28d");
    expect(parseRange(["all", "7d"])).toBe("all");
    expect(parseRange("forever")).toBe("7d");
    expect(parseRange(undefined)).toBe("7d");
  });

  it("formats shares without rounding a real share to zero", () => {
    expect(formatPct(0.384)).toBe("38%");
    expect(formatPct(0.042)).toBe("4.2%");
    expect(formatPct(0.003)).toBe("<1%");
    expect(formatPct(0)).toBe("0%");
  });

  it("hides rates under the sample floor", () => {
    expect(rateText(5, 19)).toBeNull();
    expect(rateText(5, 20)).toBe("25%");
    expect(returnRate({ returned: 3, cohort: 10 })).toBeNull();
    expect(returnRate({ returned: 12, cohort: 40 })).toBe("30%");
  });

  it("compares with the previous period, but not against tiny baselines", () => {
    expect(delta(118, 100)).toMatchObject({ text: "+18%", direction: "up" });
    expect(delta(91, 100)).toMatchObject({ text: "−9%", direction: "down" });
    expect(delta(100, 100.2)).toMatchObject({ direction: "flat" });
    expect(delta(50, 3)).toMatchObject({ text: null, direction: null });
    expect(delta(50, null)).toMatchObject({ text: null });
  });

  it("builds the funnel per card view with the share kept from each step", () => {
    const steps = funnelSteps({ views: 1000, started: 400, played: 300, playedAgain: 90 });
    expect(steps.map((s) => s.id)).toEqual(["cardViews", "started", "played", "playedAgain"]);
    expect(steps[0]!.kept).toBeNull();
    expect(steps[2]!.kept).toBeCloseTo(0.75);
    expect(steps[3]!.share).toBeCloseTo(0.09);
    expect(funnelSteps({ views: 0, started: 0, played: 0, playedAgain: 0 })[1]!.kept).toBeNull();
  });

  it("splits where people leave as shares of card views", () => {
    const rows = leaveRows({ views: 200, instantly: 50, afterWatching: 30, midRun: 20, afterRun: 60, failed: 2 });
    expect(rows.map((r) => r.id)).toEqual(["leftInstantly", "leftAfterWatching", "leftMidRun", "leftAfterRun", "loadFailures"]);
    expect(rows[0]!.share).toBe(0.25);
    expect(leaveRows({ views: 0, instantly: 0, afterWatching: 0, midRun: 0, afterRun: 0, failed: 0 })[0]!.share).toBe(0);
  });

  it("labels sources and their shares", () => {
    expect(sourceRows([{ reason: "feed", plays: 75 }, { reason: "challenge", plays: 25 }])).toEqual([
      { reason: "feed", label: "Feed", plays: 75, share: 0.75 },
      { reason: "challenge", label: "Challenge links", plays: 25, share: 0.25 },
    ]);
  });

  it("measures progress to the next milestone, clamped", () => {
    expect(progressTo({ kind: "players", target: 10000, current: 7412 })).toBeCloseTo(0.7412);
    expect(progressTo({ kind: "players", target: 100, current: 140 })).toBe(1);
    expect(progressTo(null)).toBe(0);
  });

  it("celebrates the most exciting unseen milestone and marks all unseen ones together", () => {
    const picked = pickCelebration([
      milestone({ id: "00000000-0000-4000-8000-00000000000a", kind: "first_like", threshold: 1 }),
      milestone({ id: "00000000-0000-4000-8000-00000000000b", kind: "players", threshold: 100 }),
      milestone({ id: "00000000-0000-4000-8000-00000000000c", kind: "players", threshold: 1000 }),
      milestone({ id: "00000000-0000-4000-8000-00000000000d", kind: "taking_off", seenAt: "2026-10-13T00:00:00Z" }),
    ]);
    expect(picked?.milestone.threshold).toBe(1000);
    expect(picked?.unseenIds).toHaveLength(3);
    expect(pickCelebration([milestone({ seenAt: "2026-10-14T11:00:00Z" })])).toBeNull();
  });
});
