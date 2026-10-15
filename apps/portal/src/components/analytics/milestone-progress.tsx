import { formatCount, safeAccent, type NextMilestone } from "@thumbcade/protocol";
import { progressTo } from "@/lib/analytics-view";

/** Progress toward the next players (or playtime) milestone, in the game's accent. */
export function MilestoneProgress({ next, accent }: { next: NextMilestone | null; accent: string }) {
  if (!next) return <span className="text-[13px] text-text-mute">Every milestone reached.</span>;
  const unit = next.kind === "players" ? "players" : "hours played";
  const p = progressTo(next);
  return (
    <div className="flex flex-col gap-1.5">
      <div
        className="h-1.5 overflow-hidden rounded-[2px] bg-raised"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={next.target}
        aria-valuenow={next.current}
        aria-label={`Next milestone: ${next.target} ${unit}`}
      >
        <div className="h-full rounded-[2px]" style={{ width: `${Math.max(p > 0 ? 2 : 0, p * 100)}%`, background: safeAccent(accent) }} />
      </div>
      <span className="font-mono text-[12px] text-text-mute tabular">
        {formatCount(next.current)} / {formatCount(next.target)} {unit}
      </span>
    </div>
  );
}
