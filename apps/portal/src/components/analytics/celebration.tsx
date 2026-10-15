"use client";
import { milestoneCopy, safeAccent, type Milestone } from "@thumbcade/protocol";
import { useState, useTransition } from "react";
import { markMilestonesSeen } from "@/app/(app)/creator/actions";
import { useOdometer } from "@/lib/use-odometer";
import { GameIcon } from "../game-icon";
import { Button } from "../ui";
import { ShareMilestone } from "./share-milestone";

/**
 * The first visit after a milestone opens with it: the game's icon, the number rolling up in the game's
 * accent like the result card's odometer, and a stamp. Dismissing marks every unseen milestone as seen.
 */
export function Celebration({ milestone, unseenIds, more }: { milestone: Milestone; unseenIds: string[]; more: number }) {
  const [open, setOpen] = useState(true);
  const [pending, start] = useTransition();
  const copy = milestoneCopy(milestone, milestone.gameName);
  const decimals = copy.figureText.endsWith("×") ? 1 : 0;
  const shown = useOdometer(copy.figure, 900);
  const accent = safeAccent(milestone.accentColor);
  if (!open) return null;
  const figure = decimals ? `${shown.toFixed(1)}×` : Math.floor(shown).toLocaleString("en-US");
  return (
    <section
      aria-labelledby="celebration-title"
      className="relative overflow-hidden rounded-sheet border border-line-strong bg-surface px-6 py-8 [animation:tc-rise_420ms_cubic-bezier(0.22,1,0.36,1)_both] md:px-10 md:py-10"
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[3px]" style={{ background: accent }} aria-hidden />
      <div className="flex flex-col gap-8 md:flex-row md:items-end md:justify-between">
        <div className="flex min-w-0 flex-col gap-5">
          <div className="flex items-center gap-3">
            <GameIcon url={milestone.iconUrl} name={milestone.gameName} accent={milestone.accentColor} size={44} />
            <span className="label">{milestone.gameName}</span>
            <span
              className="rounded-[6px] border-2 px-2 py-0.5 font-mono text-[12px] uppercase tracking-wider [animation:tc-stamp_480ms_cubic-bezier(0.34,1.56,0.64,1)_700ms_both]"
              style={{ borderColor: accent, color: accent }}
            >
              {copy.title}
            </span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="font-mono text-[clamp(56px,11vw,112px)] leading-[0.95] tracking-[-0.03em] tabular" style={{ color: accent }} aria-hidden>
              {figure}
            </span>
            <span className="font-mono text-[13px] uppercase tracking-wider text-text-dim">{copy.figureLabel}</span>
          </div>
          <h2 id="celebration-title" className="max-w-[40ch] text-[17px] leading-7 text-text">
            {copy.body}
            {more > 0 ? <span className="text-text-dim"> Plus {more} more milestone{more === 1 ? "" : "s"} below.</span> : null}
          </h2>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <ShareMilestone id={milestone.id} existingCode={milestone.shareCode} size="md" label="Share the card" />
          <Button
            type="button"
            variant="ghost"
            disabled={pending}
            onClick={() =>
              start(async () => {
                await markMilestonesSeen(unseenIds);
                setOpen(false);
              })
            }
          >
            Nice. Back to work
          </Button>
        </div>
      </div>
    </section>
  );
}
