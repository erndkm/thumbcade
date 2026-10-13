import { formatRelative, ReviewReportSchema } from "@thumbcade/protocol";
import type { Metadata } from "next";
import Link from "next/link";
import { GameIcon } from "@/components/game-icon";
import { Icon } from "@/components/icon";
import { EmptyState, StatusDot } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Review queue" };
export const dynamic = "force-dynamic";

export default async function ReviewQueue({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  await requireAdmin("/admin");
  const { tab = "pending" } = await searchParams;
  const statuses = tab === "failed" ? ["auto_failed"] : tab === "running" ? ["uploaded", "auto_checking"] : ["pending_review"];
  const supabase = await createClient();
  const { data } = await supabase
    .from("game_versions")
    .select("id, semver, status, created_at, review_report, release_notes, game:games!game_versions_game_id_fkey ( slug, name, icon_url, accent_color, status, creator:profiles!games_creator_id_fkey ( handle ) )")
    .in("status", statuses as ("pending_review" | "auto_failed" | "uploaded" | "auto_checking")[])
    .order("created_at", { ascending: true });
  const rows = (data ?? []) as unknown as {
    id: string;
    semver: string;
    status: string;
    created_at: string;
    review_report: unknown;
    release_notes: string | null;
    game: { slug: string; name: string; icon_url: string | null; accent_color: string; status: string; creator: { handle: string } | null } | null;
  }[];
  const tabs = [
    ["pending", "Waiting for review"],
    ["running", "Checks running"],
    ["failed", "Failed checks"],
  ] as const;
  return (
    <div className="flex flex-col gap-10">
      <header className="flex flex-col gap-3">
        <span className="label">Moderation</span>
        <h1 className="display text-[clamp(36px,5vw,64px)] text-text">Review queue</h1>
        <p className="max-w-[560px] text-[16px] leading-6 text-text-dim">Oldest first. Play every build before approving — automated checks catch budgets, not fun or safety.</p>
      </header>
      <nav className="flex gap-2">
        {tabs.map(([k, label]) => (
          <Link key={k} href={`/admin?tab=${k}`} className={`h-9 rounded-pill px-4 text-[14px] font-semibold leading-9 ${tab === k ? "bg-text text-bg" : "text-text-dim hover:bg-raised hover:text-text"}`}>
            {label}
          </Link>
        ))}
      </nav>
      {rows.length === 0 ? (
        <EmptyState title="Queue's clear." body="Nothing waiting. New uploads land here once their automated checks pass." />
      ) : (
        <ul className="rule-t">
          {rows.map((r) => {
            const report = ReviewReportSchema.safeParse(r.review_report);
            const fails = report.success ? report.data.checks.filter((c) => c.status === "fail").length : null;
            return (
              <li key={r.id} className="rule-b">
                <Link href={`/admin/review/${r.id}`} className="group grid grid-cols-[auto_1fr_auto] items-center gap-5 py-4 md:grid-cols-[auto_1fr_200px_160px_auto]">
                  <GameIcon url={r.game?.icon_url ?? null} name={r.game?.name ?? ""} accent={r.game?.accent_color ?? "#D4FF3D"} size={48} />
                  <div className="min-w-0">
                    <div className="truncate font-semiwide text-[16px] font-bold text-text">
                      {r.game?.name} <span className="font-mono text-[13px] font-normal text-text-mute">v{r.semver}</span>
                    </div>
                    <div className="truncate text-[13px] text-text-mute">
                      @{r.game?.creator?.handle} · {r.game?.status === "live" ? "update to a live game" : "first release"}
                    </div>
                  </div>
                  <span className="hidden items-center gap-2 text-[13px] text-text-dim md:flex">
                    <StatusDot tone={fails === 0 ? "live" : fails ? "failed" : "pending"} />
                    {fails === null ? "No report yet" : fails === 0 ? "All checks passed" : `${fails} failed`}
                  </span>
                  <span className="hidden font-mono text-[12px] text-text-mute md:block">waiting {formatRelative(r.created_at)}</span>
                  <Icon name="forward" size={18} className="text-text-mute group-hover:text-text" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
