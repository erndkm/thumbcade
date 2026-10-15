import { formatRelative, milestoneCopy, safeAccent, type Milestone } from "@thumbcade/protocol";
import { GameIcon } from "../game-icon";
import { ShareMilestone } from "./share-milestone";

/** Milestones newest first, each shareable. `showGame` adds the game's icon (overview across games). */
export function MilestoneList({ milestones, showGame = true }: { milestones: Milestone[]; showGame?: boolean }) {
  return (
    <ul className="rule-t">
      {milestones.map((m) => {
        const copy = milestoneCopy(m, m.gameName);
        return (
          <li key={m.id} className="rule-b grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-3 py-4 sm:grid-cols-[auto_minmax(0,1fr)_auto]">
            {showGame ? (
              <GameIcon url={m.iconUrl} name={m.gameName} accent={m.accentColor} size={40} />
            ) : (
              <span className="w-[72px] font-mono text-[20px] tabular" style={{ color: safeAccent(m.accentColor) }}>
                {copy.figureText}
              </span>
            )}
            <div className="min-w-0">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-semiwide text-[15px] font-bold text-text">{copy.title}</span>
                <span className="font-mono text-[12px] text-text-mute">{formatRelative(m.reachedAt)}</span>
              </div>
              <p className="mt-0.5 text-[14px] leading-6 text-text-dim">{copy.body}</p>
            </div>
            <div className="col-start-2 sm:col-start-auto">
              <ShareMilestone id={m.id} existingCode={m.shareCode} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
