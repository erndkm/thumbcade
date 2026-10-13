import { formatCount, formatRelative } from "@thumbcade/protocol";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DailyChart } from "@/components/daily-chart";
import { GameIcon } from "@/components/game-icon";
import { Icon } from "@/components/icon";
import { ButtonLink, Stat, StatusDot } from "@/components/ui";
import { requireViewer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { rollback } from "../../actions";
import { MetadataForm } from "./metadata-form";

export const metadata: Metadata = { title: "Game" };

const tone = { approved: "live", pending_review: "pending", auto_checking: "pending", uploaded: "pending", auto_failed: "failed", rejected: "failed" } as const;
const label = { approved: "Approved", pending_review: "In review", auto_checking: "Auto-checks running", uploaded: "Uploaded", auto_failed: "Failed checks", rejected: "Rejected" } as const;

function lastDays(n: number): string[] {
  const out: string[] = [];
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  for (let i = n - 1; i >= 0; i--) out.push(new Date(d.getTime() - i * 86400000).toISOString().slice(0, 10));
  return out;
}

export default async function CreatorGame({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  await requireViewer(`/creator/games/${slug}`);
  const supabase = await createClient();
  const { data: game } = await supabase
    .from("games")
    .select("id, slug, name, description, tags, accent_color, icon_url, status, live_version_id, play_count, like_count, comment_count, share_count, save_count, published_at")
    .eq("slug", slug)
    .maybeSingle();
  if (!game) notFound();

  const days = lastDays(14);
  const [{ data: versions }, { data: stats }] = await Promise.all([
    supabase.from("game_versions").select("id, semver, status, created_at, size_bytes, gzip_bytes, release_notes, review_notes").eq("game_id", game.id).order("created_at", { ascending: false }),
    supabase.from("game_stats_daily").select("*").eq("game_id", game.id).gte("day", days[0]!).order("day"),
  ]);
  const byDay = new Map((stats ?? []).map((s) => [s.day, s]));
  const sum = (k: "impressions" | "play_starts" | "play_ends" | "total_play_ms" | "replays" | "likes" | "shares" | "fast_skips") =>
    (stats ?? []).reduce((a, s) => a + Number(s[k] ?? 0), 0);
  const impressions = sum("impressions");
  const starts = sum("play_starts");
  const ends = sum("play_ends");
  const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : "—");

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

      <section className="flex flex-col gap-8">
        <div className="flex items-baseline justify-between">
          <h2 className="font-wide text-[22px] font-extrabold tracking-tight text-text">Last 14 days</h2>
          <span className="label">Updated hourly</span>
        </div>
        <div className="grid grid-cols-2 gap-8 border-y border-line py-6 md:grid-cols-3 xl:grid-cols-6">
          <Stat label="Impressions" value={formatCount(impressions)} />
          <Stat label="Play-start rate" value={pct(starts, impressions)} sub={`${formatCount(starts)} runs`} />
          <Stat label="Avg run" value={ends > 0 ? `${(sum("total_play_ms") / ends / 1000).toFixed(1)}s` : "—"} />
          <Stat label="Replay rate" value={pct(sum("replays"), ends)} />
          <Stat label="Fast skips" value={pct(sum("fast_skips"), impressions)} sub="left in < 1.5 s" />
          <Stat label="Likes" value={formatCount(sum("likes"))} sub={`${formatCount(sum("shares"))} shares`} />
        </div>
        <DailyChart title="Runs started per day" unit="runs" points={days.map((d) => ({ day: d, value: Number(byDay.get(d)?.play_starts ?? 0) }))} />
        <p className="text-[13px] text-text-mute">
          All time: {formatCount(game.play_count)} plays · {formatCount(game.like_count)} likes · {formatCount(game.comment_count)} comments · {formatCount(game.save_count)} saves
        </p>
      </section>

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
                  {isLive ? <span className="rounded-[5px] bg-accent px-1.5 font-mono text-[11px] uppercase text-on-accent">live</span> : null}
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
