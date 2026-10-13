import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Icon } from "@/components/icon";
import { ReviewReportView } from "@/components/review-report";
import { StatusDot } from "@/components/ui";
import { requireViewer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Review report" };
export const dynamic = "force-dynamic";

const copy = {
  uploaded: ["pending", "Uploaded", "Waiting for the automated reviewer to pick it up."],
  auto_checking: ["pending", "Automated checks running", "Usually under a minute. Refresh to see the result."],
  auto_failed: ["failed", "Failed automated checks", "Fix the failing checks below and publish a new version."],
  pending_review: ["pending", "Waiting for a human", "Automated checks passed. Someone on the team will play it — typically within a day."],
  approved: ["live", "Approved", "This version passed review."],
  rejected: ["failed", "Rejected", "See the reviewer's note below."],
} as const;

export default async function VersionReport({ params }: { params: Promise<{ slug: string; versionId: string }> }) {
  const { slug, versionId } = await params;
  await requireViewer(`/creator/games/${slug}/versions/${versionId}`);
  const supabase = await createClient();
  const { data: v } = await supabase
    .from("game_versions")
    .select("id, semver, status, review_report, review_notes, release_notes, created_at, game:games!game_versions_game_id_fkey ( slug, name, live_version_id )")
    .eq("id", versionId)
    .maybeSingle();
  if (!v) notFound();
  const game = v.game as unknown as { slug: string; name: string; live_version_id: string | null } | null;
  const [tone, title, body] = copy[v.status];
  return (
    <div className="flex max-w-[1080px] flex-col gap-10">
      <Link href={`/creator/games/${slug}`} className="flex items-center gap-1 self-start text-[14px] text-text-dim hover:text-text">
        <Icon name="back" size={16} /> {game?.name ?? slug}
      </Link>
      <header className="flex flex-col gap-3">
        <span className="label">Version {v.semver}{game?.live_version_id === v.id ? " · live" : ""}</span>
        <h1 className="display flex items-center gap-4 text-[clamp(32px,4.4vw,56px)] text-text">
          <StatusDot tone={tone} /> {title}
        </h1>
        <p className="max-w-[620px] text-[16px] leading-6 text-text-dim">{body}</p>
        {v.release_notes ? <p className="text-[14px] text-text-mute">Release notes: {v.release_notes}</p> : null}
      </header>
      {v.review_notes ? (
        <blockquote className="border-l-2 border-accent py-1 pl-4 text-[15px] text-text">
          <span className="label mb-1 block">Reviewer note</span>
          {v.review_notes}
        </blockquote>
      ) : null}
      <ReviewReportView report={v.review_report} status={v.status} />
    </div>
  );
}
