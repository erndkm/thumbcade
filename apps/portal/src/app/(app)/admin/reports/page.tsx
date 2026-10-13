import { formatRelative } from "@thumbcade/protocol";
import type { Metadata } from "next";
import Link from "next/link";
import { Avatar } from "@/components/avatar";
import { EmptyState } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { resolveReport } from "../actions";

export const metadata: Metadata = { title: "Reports" };
export const dynamic = "force-dynamic";

const reasons: Record<string, string> = {
  spam: "Spam",
  harassment: "Harassment",
  hate: "Hate",
  sexual: "Sexual content",
  violence: "Violence",
  self_harm: "Self-harm",
  age_inappropriate: "Not age-appropriate",
  broken: "Broken game",
  ip_violation: "IP violation",
  other: "Other",
};

export default async function ReportsPage() {
  await requireAdmin("/admin/reports");
  const supabase = await createClient();
  const { data } = await supabase
    .from("reports")
    .select("id, target_type, target_id, reason, details, created_at, reporter:profiles!reports_reporter_id_fkey ( handle, avatar_url, avatar_seed )")
    .eq("status", "open")
    .order("created_at", { ascending: true })
    .limit(100);
  const rows = (data ?? []) as unknown as {
    id: string;
    target_type: "game" | "comment" | "user";
    target_id: string;
    reason: string;
    details: string | null;
    created_at: string;
    reporter: { handle: string; avatar_url: string | null; avatar_seed: string } | null;
  }[];

  // Resolve targets for context.
  const ids = (t: string) => rows.filter((r) => r.target_type === t).map((r) => r.target_id);
  const [games, comments, users] = await Promise.all([
    ids("game").length ? supabase.from("games").select("id, slug, name").in("id", ids("game")) : { data: [] },
    ids("comment").length ? supabase.from("comments").select("id, body, user:profiles ( handle )").in("id", ids("comment")) : { data: [] },
    ids("user").length ? supabase.from("profiles").select("id, handle, display_name").in("id", ids("user")) : { data: [] },
  ]);
  const gameMap = new Map((games.data ?? []).map((g) => [g.id, g]));
  const commentMap = new Map(((comments.data ?? []) as unknown as { id: string; body: string; user: { handle: string } | null }[]).map((c) => [c.id, c]));
  const userMap = new Map((users.data ?? []).map((u) => [u.id, u]));

  return (
    <div className="flex flex-col gap-10">
      <header className="flex flex-col gap-3">
        <span className="label">Moderation</span>
        <h1 className="display text-[clamp(36px,5vw,64px)] text-text">Reports</h1>
        <p className="max-w-[560px] text-[16px] leading-6 text-text-dim">Open reports, oldest first. Every action is logged with your name.</p>
      </header>
      {rows.length === 0 ? (
        <EmptyState title="All quiet." body="No open reports. Players report games, comments and people from the app." />
      ) : (
        <ul className="rule-t">
          {rows.map((r) => {
            const g = r.target_type === "game" ? gameMap.get(r.target_id) : null;
            const c = r.target_type === "comment" ? commentMap.get(r.target_id) : null;
            const u = r.target_type === "user" ? userMap.get(r.target_id) : null;
            return (
              <li key={r.id} className="rule-b grid gap-4 py-5 md:grid-cols-[1fr_auto]">
                <div className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-2 text-[13px] text-text-mute">
                    <span className="rounded-[5px] bg-heat/15 px-1.5 font-mono text-[11px] uppercase text-heat">{reasons[r.reason] ?? r.reason}</span>
                    <span className="label">{r.target_type}</span>
                    <span className="flex items-center gap-1.5">
                      by <Avatar url={r.reporter?.avatar_url ?? null} seed={r.reporter?.avatar_seed ?? r.id} size={16} /> @{r.reporter?.handle}
                    </span>
                    <span className="font-mono text-[11px]">{formatRelative(r.created_at)}</span>
                  </div>
                  <div className="text-[15px] text-text">
                    {g ? <Link href={`/g/${g.slug}`} className="underline decoration-accent underline-offset-2">{g.name}</Link> : null}
                    {c ? <span>“{c.body}” <span className="text-text-mute">— @{c.user?.handle}</span></span> : null}
                    {u ? <span>@{u.handle} ({u.display_name})</span> : null}
                    {!g && !c && !u ? <span className="text-text-mute">Target no longer exists</span> : null}
                  </div>
                  {r.details ? <p className="text-[14px] text-text-dim">{r.details}</p> : null}
                </div>
                <form action={resolveReport} className="flex flex-wrap items-start gap-2">
                  <input type="hidden" name="id" value={r.id} />
                  <input type="hidden" name="targetType" value={r.target_type} />
                  <input type="hidden" name="targetId" value={r.target_id} />
                  {r.target_type === "game" ? (
                    <button name="action" value="takedown" className="h-9 rounded-pill bg-heat px-4 text-[13px] font-bold text-on-heat">Take down game</button>
                  ) : null}
                  {r.target_type === "comment" ? (
                    <button name="action" value="hide" className="h-9 rounded-pill bg-heat px-4 text-[13px] font-bold text-on-heat">Remove comment</button>
                  ) : null}
                  {r.target_type === "user" ? (
                    <button name="action" value="actioned" className="h-9 rounded-pill border border-line-strong px-4 text-[13px] font-bold text-text">Mark handled</button>
                  ) : null}
                  <button name="action" value="dismiss" className="h-9 rounded-pill px-4 text-[13px] font-semibold text-text-dim hover:bg-raised">Dismiss</button>
                </form>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
