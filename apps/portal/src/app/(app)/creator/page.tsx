import { formatCount, formatRelative } from "@thumbcade/protocol";
import type { Metadata } from "next";
import Link from "next/link";
import { GameIcon } from "@/components/game-icon";
import { Icon } from "@/components/icon";
import { ButtonLink, EmptyState, StatusDot } from "@/components/ui";
import { requireViewer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { CreatorOnboarding } from "./onboarding";

export const metadata: Metadata = { title: "Your games" };

const versionTone = { approved: "live", pending_review: "pending", auto_checking: "pending", uploaded: "pending", auto_failed: "failed", rejected: "failed" } as const;
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
  const { data } = await supabase
    .from("games")
    .select("id, slug, name, icon_url, accent_color, status, play_count, like_count, comment_count, updated_at, live_version_id, versions:game_versions!game_versions_game_id_fkey ( id, semver, status, created_at )")
    .eq("creator_id", viewer.id)
    .order("updated_at", { ascending: false });
  const games = (data ?? []) as unknown as {
    id: string;
    slug: string;
    name: string;
    icon_url: string | null;
    accent_color: string;
    status: string;
    play_count: number;
    like_count: number;
    comment_count: number;
    updated_at: string;
    live_version_id: string | null;
    versions: { id: string; semver: string; status: keyof typeof versionTone; created_at: string }[];
  }[];

  return (
    <div className="flex flex-col gap-10">
      <header className="flex flex-wrap items-end justify-between gap-6">
        <div className="flex flex-col gap-3">
          <span className="label">@{viewer.handle}</span>
          <h1 className="display text-[clamp(36px,5vw,64px)] text-text">Your games</h1>
        </div>
        <ButtonLink href="/docs" variant="secondary">
          <Icon name="code" size={18} /> Publish a new game
        </ButtonLink>
      </header>

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
        <ul className="rule-t">
          {games.map((g) => {
            const latest = [...g.versions].sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
            return (
              <li key={g.id} className="rule-b">
                <Link href={`/creator/games/${g.slug}`} className="group grid grid-cols-[auto_1fr_auto] items-center gap-5 py-5 md:grid-cols-[auto_1.4fr_1fr_repeat(3,90px)_auto]">
                  <GameIcon url={g.icon_url} name={g.name} accent={g.accent_color} size={56} />
                  <div className="min-w-0">
                    <div className="truncate font-semiwide text-[17px] font-bold text-text">{g.name}</div>
                    <div className="mt-0.5 flex items-center gap-2 font-mono text-[12px] text-text-mute">
                      <StatusDot tone={g.status === "live" ? "live" : g.status === "rejected" || g.status === "removed" ? "failed" : "neutral"} />
                      {g.status.toUpperCase()} · {g.slug}
                    </div>
                  </div>
                  <div className="hidden text-[14px] text-text-dim md:block">
                    {latest ? (
                      <span className="flex items-center gap-2">
                        <StatusDot tone={versionTone[latest.status]} />v{latest.semver} · {versionLabel[latest.status]}
                      </span>
                    ) : (
                      "No versions"
                    )}
                    <div className="mt-0.5 font-mono text-[11px] text-text-mute">updated {formatRelative(g.updated_at)}</div>
                  </div>
                  {[
                    ["plays", g.play_count],
                    ["likes", g.like_count],
                    ["comments", g.comment_count],
                  ].map(([k, v]) => (
                    <div key={k as string} className="hidden text-right md:block">
                      <div className="font-mono text-[18px] text-text tabular">{formatCount(v as number)}</div>
                      <div className="label">{k}</div>
                    </div>
                  ))}
                  <Icon name="forward" size={18} className="text-text-mute transition-transform group-hover:translate-x-0.5 group-hover:text-text" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
