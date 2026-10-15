import {
  formatCount,
  formatPlaytime,
  formatRelative,
  milestoneCopy,
  MilestoneKindSchema,
  type AnalyticsRange,
  type GameAnalytics,
  type Milestone,
  type Period,
} from "@thumbcade/protocol";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { BarList } from "@/components/analytics/bar-list";
import { MetricLabel } from "@/components/analytics/metric-label";
import { MetricTile } from "@/components/analytics/metric-tile";
import { MilestoneList } from "@/components/analytics/milestone-list";
import { MilestoneProgress } from "@/components/analytics/milestone-progress";
import { RangeTabs } from "@/components/analytics/range-tabs";
import { VersionsTable } from "@/components/analytics/versions-table";
import { DailyChart } from "@/components/daily-chart";
import { GameIcon } from "@/components/game-icon";
import { Icon } from "@/components/icon";
import { ButtonLink, StatusDot } from "@/components/ui";
import { getGameAnalytics, getGameFunnel, getVersionCompare } from "@/lib/analytics";
import { delta, formatPct, funnelSteps, leaveRows, parseRange, rateText, returnRate, shortDay, sourceRows } from "@/lib/analytics-view";
import { requireViewer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { rollback } from "../../actions";
import { MetadataForm } from "./metadata-form";

export const metadata: Metadata = { title: "Game" };

const tone = { approved: "live", pending_review: "pending", auto_checking: "pending", uploaded: "pending", auto_failed: "failed", rejected: "failed" } as const;
const label = { approved: "Approved", pending_review: "In review", auto_checking: "Auto-checks running", uploaded: "Uploaded", auto_failed: "Failed checks", rejected: "Rejected" } as const;

const COMPARE: Partial<Record<AnalyticsRange, string>> = { "7d": "vs prior 7 days", "28d": "vs prior 28 days" };
const RANGE_NOUN: Record<AnalyticsRange, string> = { today: "Today so far", "7d": "Last 7 days", "28d": "Last 28 days", all: "All time" };

function Section({ id, title, aside, children }: { id: string; title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id={id} className="font-wide text-[22px] font-extrabold tracking-tight text-text">
          {title}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

function headline(cur: Period, prev: Period | null, a: GameAnalytics) {
  const avg = (p: Period) => (p.players > 0 ? p.playMs / p.players : null);
  const curAvg = avg(cur);
  return {
    players: { value: formatCount(cur.players), delta: delta(cur.players, prev?.players) },
    plays: { value: formatCount(cur.plays), delta: delta(cur.plays, prev?.plays) },
    playtime: { value: formatPlaytime(cur.playMs), delta: delta(cur.playMs, prev?.playMs, 60_000) },
    avg: { value: curAvg !== null && cur.players >= 20 ? formatPlaytime(curAvg) : null, delta: delta(curAvg ?? 0, prev && prev.players >= 20 ? avg(prev) : null, 1000) },
    typical: { value: cur.typicalRunMs !== null && cur.plays >= 20 ? formatPlaytime(cur.typicalRunMs) : null },
    d1: { value: returnRate(a.returns.d1) },
  };
}

export default async function CreatorGame({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  const range = parseRange(sp.range);
  const viewer = await requireViewer(`/creator/games/${slug}`);
  const supabase = await createClient();
  const { data: game } = await supabase
    .from("games")
    .select("id, creator_id, slug, name, description, tags, accent_color, icon_url, status, live_version_id, play_count, like_count, comment_count, share_count, save_count, published_at")
    .eq("slug", slug)
    .maybeSingle();
  if (!game || (game.creator_id !== viewer.id && viewer.role !== "admin")) notFound();

  const [{ data: versions }, a, funnel, versionStats, { data: milestoneRows }] = await Promise.all([
    supabase.from("game_versions").select("id, semver, status, created_at, size_bytes, gzip_bytes, release_notes, review_notes").eq("game_id", game.id).order("created_at", { ascending: false }),
    getGameAnalytics(game.id, range),
    getGameFunnel(game.id, range),
    getVersionCompare(game.id),
    supabase.from("creator_milestones").select("id, kind, threshold, value, detail, reached_at, seen_at, share_code").eq("game_id", game.id).order("reached_at", { ascending: false }).limit(20),
  ]);
  const milestones: Milestone[] = (milestoneRows ?? []).flatMap((m) => {
    const kind = MilestoneKindSchema.safeParse(m.kind);
    if (!kind.success) return [];
    return [
      {
        id: m.id,
        gameId: game.id,
        gameSlug: game.slug,
        gameName: game.name,
        iconUrl: game.icon_url,
        accentColor: game.accent_color,
        kind: kind.data,
        threshold: Number(m.threshold),
        value: Number(m.value),
        detail: (m.detail ?? {}) as Milestone["detail"],
        reachedAt: m.reached_at,
        seenAt: m.seen_at,
        shareCode: m.share_code,
      },
    ];
  });

  const h = headline(a.current, a.previous, a);
  const compare = COMPARE[range];
  const bm = a.benchmarks;
  const noPlayersYet = a.current.players === 0 && a.current.views === 0 && game.play_count === 0;
  const steps = funnelSteps(funnel);
  const markers = a.markers.map((m) =>
    m.type === "version"
      ? { day: m.day, kind: "version" as const, label: `v${m.semver} released` }
      : { day: m.day, kind: "milestone" as const, label: milestoneCopy({ ...m, detail: {} }, game.name).title },
  );
  const playtimeNote = a.playtimeSince > a.from ? `Playtime counts from ${shortDay(a.playtimeSince)}, when measuring started.` : null;

  return (
    <div className="flex flex-col gap-14">
      <header className="flex flex-wrap items-center gap-6">
        <Link href="/creator" className="flex size-10 items-center justify-center rounded-full border border-line text-text-dim hover:text-text" aria-label="Back to games">
          <Icon name="back" size={18} />
        </Link>
        <GameIcon url={game.icon_url} name={game.name} accent={game.accent_color} size={72} />
        <div className="min-w-0 flex-1">
          <h1 className="display text-[clamp(32px,4.4vw,56px)] text-text">{game.name}</h1>
          <div className="mt-2 flex items-center gap-2 font-mono text-[12px] text-text-mute">
            <StatusDot tone={game.status === "live" ? "live" : game.status === "removed" || game.status === "rejected" ? "failed" : "neutral"} />
            {game.status.toUpperCase()} · {game.slug}
            {game.published_at ? ` · live since ${new Date(game.published_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}` : ""}
          </div>
        </div>
        {game.status === "live" ? (
          <ButtonLink href={`/g/${game.slug}`} variant="secondary">
            <Icon name="eye" size={18} /> View public page
          </ButtonLink>
        ) : null}
      </header>

      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <RangeTabs current={range} hrefFor={(r) => `/creator/games/${game.slug}?range=${r}`} />
          <span className="label">
            {shortDay(a.from)}
            {a.from !== a.to ? ` – ${shortDay(a.to)}` : ""} · UTC · updated every 10 minutes
          </span>
        </div>
        {noPlayersYet ? (
          <div className="rule-t rule-b flex flex-col items-start gap-3 py-10">
            <h2 className="font-wide text-[22px] font-extrabold tracking-tight text-text">No players yet. Everyone starts at zero.</h2>
            <p className="max-w-md text-[15px] leading-6 text-text-dim">
              {game.status === "live"
                ? "Your game is in the feed. Send the link to a few friends and the numbers start moving within minutes."
                : "Numbers show up here once a version passes review and goes live in the feed."}
            </p>
            {game.status === "live" ? (
              <ButtonLink href={`/g/${game.slug}`} variant="secondary" size="sm">
                <Icon name="link" size={16} /> Open the share page
              </ButtonLink>
            ) : null}
          </div>
        ) : null}
      </div>

      <Section id="headline-title" title={RANGE_NOUN[range]}>
        <div className="grid grid-cols-2 gap-x-8 gap-y-10 border-y border-line py-6 md:grid-cols-3">
          <MetricTile metric="players" value={h.players.value} delta={h.players.delta} {...(compare ? { compareLabel: compare } : {})} sub={`${formatCount(a.current.newPlayers)} new`} />
          <MetricTile
            metric="plays"
            value={h.plays.value}
            delta={h.plays.delta}
            {...(compare ? { compareLabel: compare } : {})}
            sub={a.current.bounced > 0 ? `+ ${formatCount(a.current.bounced)} bounced starts` : undefined}
            benchmark={bm?.playRate ?? null}
          />
          <MetricTile metric="playtime" value={h.playtime.value} delta={h.playtime.delta} {...(compare ? { compareLabel: compare } : {})} />
          <MetricTile metric="avgPlaytime" value={h.avg.value} delta={h.avg.delta} {...(compare ? { compareLabel: compare } : {})} emptyText="Needs 20 players" benchmark={bm?.avgPlaytime ?? null} />
          <MetricTile metric="typicalRun" value={h.typical.value} emptyText="Needs 20 plays" />
          <MetricTile
            metric="d1Return"
            value={h.d1.value}
            emptyText={range === "today" ? "Known tomorrow" : "Needs 20 new players"}
            sub={returnRate(a.returns.d7) ? `${returnRate(a.returns.d7)} within 7 days` : undefined}
            benchmark={bm?.d1Return ?? null}
          />
        </div>
        {playtimeNote ? <p className="text-[13px] text-text-mute">{playtimeNote}</p> : null}
        {bm ? <p className="text-[13px] text-text-mute">Benchmarks compare the last 28 days with {bm.gamesCompared} live games that had 200 or more card views.</p> : null}
      </Section>

      <Section id="players-title" title="Players per day" aside={range === "today" ? <span className="label">Last 14 days</span> : null}>
        <DailyChart
          title="New and returning players"
          unit="player-days"
          partLabels={["Returning", "New"]}
          points={a.series.map((d) => ({ day: d.day, value: d.players, parts: [Math.max(0, d.players - d.newPlayers), Math.min(d.players, d.newPlayers)] }))}
          markers={markers}
        />
      </Section>

      <div className="grid gap-14 xl:grid-cols-2 xl:gap-12">
        <Section id="funnel-title" title="From card to player">
          <BarList
            emphasis="played"
            rows={steps.map((s) => ({
              key: s.id === "cardViews" ? "views" : s.id,
              metric: s.id,
              label: s.label,
              count: s.count,
              share: s.share,
              ...(s.kept !== null ? { note: `${formatPct(s.kept)} of the step before` } : {}),
            }))}
          />
          {bm?.replayRate !== null && bm?.replayRate !== undefined ? <p className="text-[13px] text-text-dim">Played again more often than {Math.round(bm.replayRate)}% of live games.</p> : null}
        </Section>

        <Section id="leave-title" title="Where people leave">
          <BarList rows={leaveRows(a.leave).map((r) => ({ key: r.id, metric: r.id, label: r.label, count: r.count, share: r.share }))} />
          <p className="text-[13px] text-text-mute">
            Shares of {formatCount(a.leave.views)} card views.
            {bm?.leftInstantly !== null && bm?.leftInstantly !== undefined ? ` Fewer instant swipes than ${Math.round(bm.leftInstantly)}% of live games.` : ""}
          </p>
        </Section>
      </div>

      <div className="grid gap-14 xl:grid-cols-2 xl:gap-12">
        <Section id="sources-title" title="How people found it">
          {a.sources.length ? (
            <BarList rows={sourceRows(a.sources).map((r) => ({ key: r.reason, label: r.label, count: r.plays, share: r.share }))} unit="plays" />
          ) : (
            <p className="text-[15px] text-text-dim">No plays in this range yet.</p>
          )}
        </Section>

        <Section id="engagement-title" title="Engagement">
          <div className="grid grid-cols-3 gap-x-6 gap-y-8 sm:grid-cols-5">
            {(
              [
                ["Likes", a.engagement.likes],
                ["Comments", a.engagement.comments],
                ["Shares", a.engagement.shares],
                ["Saves", a.engagement.saves],
              ] as const
            ).map(([k, v]) => (
              <div key={k} className="flex flex-col gap-1.5">
                <span className="label">{k}</span>
                <span className="font-mono text-[22px] leading-7 text-text tabular">{formatCount(v)}</span>
              </div>
            ))}
            <div className="flex flex-col gap-1.5">
              <MetricLabel metric="followsGained" />
              <span className="font-mono text-[22px] leading-7 text-text tabular">{formatCount(a.engagement.follows)}</span>
            </div>
          </div>
        </Section>
      </div>

      <Section id="versions-title" title="Versions compared">
        {versionStats.length ? <VersionsTable versions={versionStats} /> : <p className="text-[15px] text-text-dim">Numbers per version show up once a version is approved.</p>}
        {versionStats.length === 1 ? <p className="text-[13px] text-text-mute">Ship an update and its numbers line up here next to this one.</p> : null}
      </Section>

      <Section id="health-title" title="Health">
        <div className="grid grid-cols-2 gap-8 border-y border-line py-6 md:grid-cols-3">
          <MetricTile metric="readyTime" value={a.health.readyP50 !== null ? formatPlaytime(a.health.readyP50) : null} emptyText="No loads yet" sub={a.health.readyP90 !== null ? `p90 ${formatPlaytime(a.health.readyP90)}` : undefined} />
          <MetricTile metric="loadFailures" value={rateText(a.health.loadFailures, a.health.views)} emptyText="Needs 20 card views" sub={`${formatCount(a.health.loadFailures)} of ${formatCount(a.health.views)} card views`} />
          <MetricTile metric="bounced" value={formatCount(a.current.bounced)} sub="Taps that never became a play" />
        </div>
      </Section>

      <Section id="milestones-title" title="Milestones">
        <div className="max-w-md">
          <MilestoneProgress next={a.next} accent={game.accent_color} />
        </div>
        {milestones.length ? (
          <MilestoneList milestones={milestones} showGame={false} />
        ) : (
          <p className="rule-t rule-b py-8 text-[15px] leading-6 text-text-dim">The first milestone lands with your first player. Each one comes with a card you can share.</p>
        )}
        <p className="text-[13px] text-text-mute">
          All time: {formatCount(game.play_count)} plays · {formatCount(game.like_count)} likes · {formatCount(game.comment_count)} comments · {formatCount(game.save_count)} saves
          {milestones[0] ? ` · last milestone ${formatRelative(milestones[0].reachedAt)}` : ""}
        </p>
      </Section>

      <section className="flex flex-col gap-8">
        <h2 className="font-wide text-[22px] font-extrabold tracking-tight text-text">Feed listing</h2>
        <MetadataForm game={game} />
      </section>

      <section className="flex flex-col gap-6">
        <div className="flex items-baseline justify-between">
          <h2 className="font-wide text-[22px] font-extrabold tracking-tight text-text">Versions</h2>
          <span className="font-mono text-[12px] text-text-mute">npx thumbcade publish</span>
        </div>
        <ul className="rule-t">
          {(versions ?? []).map((v) => {
            const isLive = v.id === game.live_version_id;
            return (
              <li key={v.id} className="rule-b grid grid-cols-[1fr_auto] items-center gap-4 py-4 md:grid-cols-[120px_1fr_140px_auto]">
                <span className="font-mono text-[15px] text-text">v{v.semver}</span>
                <span className="flex items-center gap-2 text-[14px] text-text-dim">
                  <StatusDot tone={tone[v.status]} /> {label[v.status]}
                  {isLive ? <span className="rounded-[5px] bg-success/15 px-1.5 font-mono text-[11px] uppercase text-success">live</span> : null}
                  <span className="hidden truncate text-text-mute md:inline">{v.release_notes ? `— ${v.release_notes}` : ""}</span>
                </span>
                <span className="hidden font-mono text-[12px] text-text-mute md:block">
                  {(Number(v.gzip_bytes) / 1024).toFixed(0)} KB gz · {formatRelative(v.created_at)}
                </span>
                <span className="flex items-center gap-2">
                  {v.status === "approved" && !isLive ? (
                    <form action={rollback}>
                      <input type="hidden" name="versionId" value={v.id} />
                      <input type="hidden" name="slug" value={game.slug} />
                      <button type="submit" className="h-8 rounded-pill border border-line-strong px-3 text-[13px] font-semibold text-text hover:bg-raised">
                        Make live
                      </button>
                    </form>
                  ) : null}
                  <Link href={`/creator/games/${game.slug}/versions/${v.id}`} className="flex h-8 items-center gap-1 rounded-pill px-3 text-[13px] text-text-dim hover:bg-raised hover:text-text">
                    Report <Icon name="forward" size={14} />
                  </Link>
                </span>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
