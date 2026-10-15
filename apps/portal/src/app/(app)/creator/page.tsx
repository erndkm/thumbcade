import { formatCount, formatPlaytime } from "@thumbcade/protocol";
import type { Metadata } from "next";
import Link from "next/link";
import { GameIcon } from "@/components/game-icon";
import { Icon } from "@/components/icon";
import { Celebration } from "@/components/analytics/celebration";
import { MetricTile } from "@/components/analytics/metric-tile";
import { MilestoneList } from "@/components/analytics/milestone-list";
import { MilestoneProgress } from "@/components/analytics/milestone-progress";
import { Sparkline } from "@/components/analytics/sparkline";
import { ButtonLink, EmptyState, Stat, StatusDot } from "@/components/ui";
import { getCreatorOverview } from "@/lib/analytics";
import { pickCelebration, shortDay } from "@/lib/analytics-view";
import { requireViewer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { CreatorOnboarding } from "./onboarding";

export const metadata: Metadata = { title: "Your games" };

const versionLabel = { approved: "Approved", pending_review: "In review", auto_checking: "Auto-checks running", uploaded: "Uploaded", auto_failed: "Failed checks", rejected: "Rejected" } as const;

export default async function CreatorHome() {
  const viewer = await requireViewer("/creator");
  if (viewer.role === "user") {
    return (
      <div className="flex max-w-[880px] flex-col gap-10">
        <header className="flex flex-col gap-4">
          <span className="label">Creator program</span>
          <h1 className="display text-[clamp(40px,6vw,80px)] text-text">Your game in the feed by Friday.</h1>
          <p className="max-w-[560px] text-[17px] leading-7 text-text-dim">
            Pick the handle people will see on your games. You can publish as soon as you&apos;ve set up the CLI.
          </p>
        </header>
        <CreatorOnboarding handle={viewer.handle} displayName={viewer.displayName} />
      </div>
    );
  }

  const supabase = await createClient();
  const [overview, { data: versionRows }] = await Promise.all([
    getCreatorOverview(),
    supabase.from("games").select("id, versions:game_versions!game_versions_game_id_fkey ( semver, status, created_at )").eq("creator_id", viewer.id),
  ]);
  const versionsByGame = new Map(
    ((versionRows ?? []) as unknown as { id: string; versions: { semver: string; status: keyof typeof versionLabel; created_at: string }[] }[]).map((g) => [g.id, g.versions]),
  );
  const celebration = pickCelebration(overview.milestones);
  const { totals, today, games } = overview;

  return (
    <div className="flex flex-col gap-14">
      <header className="flex flex-wrap items-end justify-between gap-6">
        <div className="flex flex-col gap-3">
          <span className="label">@{viewer.handle}</span>
          <h1 className="display text-[clamp(36px,5vw,64px)] text-text">Your games</h1>
        </div>
        <ButtonLink href="/docs" variant="secondary">
          <Icon name="code" size={18} /> Publish a new game
        </ButtonLink>
      </header>

      {celebration ? <Celebration milestone={celebration.milestone} unseenIds={celebration.unseenIds} more={celebration.unseenIds.length - 1} /> : null}

      {games.length === 0 ? (
        <EmptyState
          title="Nothing in the feed yet."
          body={
            <>
              Scaffold a game, test it in the simulator, then publish from your terminal. It shows up here the moment it uploads.
              <code className="mt-5 block rounded-[12px] border border-line bg-surface px-4 py-3 font-mono text-[13px] leading-6 text-text">
                <span className="text-text-mute">$</span> npm create thumbcade-game@latest
                <br />
                <span className="text-text-mute">$</span> npx thumbcade login
                <br />
                <span className="text-text-mute">$</span> npx thumbcade publish
              </code>
            </>
          }
          action={<ButtonLink href="/docs">Read the quickstart</ButtonLink>}
        />
      ) : (
        <>
          <section aria-labelledby="totals-title" className="flex flex-col gap-6">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="totals-title" className="font-wide text-[22px] font-extrabold tracking-tight text-text">
                All your games
              </h2>
              <span className="label">All time · updated every 10 minutes</span>
            </div>
            <div className="grid grid-cols-2 gap-8 border-y border-line py-6 lg:grid-cols-4">
              <MetricTile metric="players" value={formatCount(totals.players)} sub={`${formatCount(today.players)} today`} />
              <MetricTile metric="plays" value={formatCount(totals.plays)} sub={`${formatCount(today.plays)} today`} />
              <MetricTile metric="playtime" value={formatPlaytime(totals.playMs)} sub={`Measured since ${shortDay(overview.playtimeSince)}`} />
              <Stat label="Followers" value={formatCount(totals.followers)} />
            </div>
          </section>

          <section aria-labelledby="games-title" className="flex flex-col gap-4">
            <h2 id="games-title" className="font-wide text-[22px] font-extrabold tracking-tight text-text">
              Games
            </h2>
            <ul className="rule-t">
              {games.map((g) => {
                const versions = versionsByGame.get(g.id) ?? [];
                const latest = [...versions].sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
                return (
                  <li key={g.id} className="rule-b">
                    <Link
                      href={`/creator/games/${g.slug}`}
                      className="group grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-5 gap-y-3 py-5 md:grid-cols-[auto_minmax(0,1.3fr)_96px_repeat(2,88px)_minmax(0,1fr)_auto]"
                    >
                      <GameIcon url={g.iconUrl} name={g.name} accent={g.accentColor} size={56} />
                      <div className="min-w-0">
                        <div className="truncate font-semiwide text-[17px] font-bold text-text">{g.name}</div>
                        <div className="mt-0.5 flex items-center gap-2 font-mono text-[12px] text-text-mute">
                          <StatusDot tone={g.status === "live" ? "live" : g.status === "rejected" || g.status === "removed" ? "failed" : "neutral"} />
                          <span className="truncate">
                            {g.status.toUpperCase()}
                            {latest ? ` · v${latest.semver} ${versionLabel[latest.status].toLowerCase()}` : ""}
                          </span>
                        </div>
                        <div className="mt-1 font-mono text-[12px] text-text-dim md:hidden">
                          {formatCount(g.players)} players · {formatCount(g.todayPlayers)} today
                        </div>
                      </div>
                      <div className="hidden md:block">
                        <Sparkline values={g.spark.map((s) => s.players)} label={`${g.name}: players per day, last 28 days`} />
                      </div>
                      <div className="hidden text-right md:block">
                        <div className="font-mono text-[18px] text-text tabular">{formatCount(g.players)}</div>
                        <div className="label">players</div>
                      </div>
                      <div className="hidden text-right md:block">
                        <div className="font-mono text-[18px] text-text tabular">{formatCount(g.todayPlayers)}</div>
                        <div className="label">today</div>
                      </div>
                      <div className="col-span-2 col-start-2 md:col-span-1 md:col-start-auto">
                        <MilestoneProgress next={g.next} accent={g.accentColor} />
                      </div>
                      <Icon name="forward" size={18} className="col-start-3 row-start-1 text-text-mute transition-transform group-hover:translate-x-0.5 group-hover:text-text md:col-start-auto md:row-start-auto" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>

          <section aria-labelledby="milestones-title" className="flex flex-col gap-4">
            <h2 id="milestones-title" className="font-wide text-[22px] font-extrabold tracking-tight text-text">
              Milestones
            </h2>
            {overview.milestones.length ? (
              <MilestoneList milestones={overview.milestones} />
            ) : (
              <p className="rule-t rule-b py-8 text-[15px] leading-6 text-text-dim">
                Your first one lands with your first player. After that: 100 players, 1,000, and up. Each one comes with a card you can share.
              </p>
            )}
          </section>
        </>
      )}
    </div>
  );
}
