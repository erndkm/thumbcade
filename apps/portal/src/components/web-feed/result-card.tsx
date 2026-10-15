"use client";
import { formatScore, safeAccent, type Challenge } from "@thumbcade/protocol";
import { useOdometer } from "@/lib/use-odometer";
import { Icon } from "../icon";
import type { WebCard } from "./types";

export function ResultCard({
  card,
  score,
  best,
  isNewBest,
  challenge,
  onReplay,
  onChallenge,
}: {
  card: WebCard;
  score: number;
  best: number;
  isNewBest: boolean;
  challenge?: Challenge;
  onReplay: () => void;
  onChallenge: () => void;
}) {
  const shown = useOdometer(score);
  const accent = safeAccent(card.accentColor);
  const beatChallenge =
    challenge && (card.score.order === "desc" ? score > challenge.score : score < challenge.score);
  return (
    <div className="absolute inset-0 flex flex-col justify-end bg-gradient-to-b from-black/10 via-black/55 to-black/85 p-5 pb-6">
      <div className="relative rounded-[24px] border border-white/10 bg-ink-1/92 p-6 shadow-[0_30px_80px_rgba(0,0,0,0.6)] [animation:tc-rise_420ms_cubic-bezier(0.22,1,0.36,1)_both]">
        <div className="mb-1 flex items-center justify-between">
          <span className="label">Run over · {card.name}</span>
          {isNewBest ? (
            <span className="rounded-[6px] border-2 border-accent px-2 py-0.5 font-mono text-[12px] uppercase tracking-wider text-accent-text [animation:tc-stamp_480ms_cubic-bezier(0.34,1.56,0.64,1)_200ms_both]">
              New best
            </span>
          ) : null}
        </div>
        <div className="font-mono text-[64px] leading-[68px] tracking-[-0.03em] text-paper tabular" aria-live="polite">
          {formatScore(Math.round(shown), card.score)}
        </div>
        <div className="mt-1 flex items-center gap-3 font-mono text-[13px] text-paper/60">
          <span>BEST {formatScore(best, card.score)}</span>
          {challenge ? (
            <span style={{ color: beatChallenge ? "var(--color-accent-text)" : undefined }}>
              · {beatChallenge ? `BEAT ${challenge.fromName.toUpperCase()}` : `${challenge.fromName.toUpperCase()}: ${formatScore(challenge.score, card.score)}`}
            </span>
          ) : null}
        </div>
        <div className="mt-6 grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={onReplay}
            className="flex h-12 items-center justify-center gap-2 rounded-pill font-semiwide text-[15px] font-bold text-ink-1 active:scale-[0.97]"
            style={{ background: accent }}
          >
            <Icon name="replay" size={18} /> Play again
          </button>
          <button
            type="button"
            onClick={onChallenge}
            className="flex h-12 items-center justify-center gap-2 rounded-pill border border-white/20 font-semiwide text-[15px] font-bold text-paper active:scale-[0.97]"
          >
            <Icon name="share" size={18} /> Challenge
          </button>
        </div>
      </div>
      <div className="mt-4 flex items-center justify-center gap-2 font-mono text-[12px] uppercase tracking-wider text-paper/60">
        <span className="motion-safe:animate-[tc-nudge_1.6s_ease-in-out_infinite]">
          <Icon name="swipeUp" size={16} />
        </span>
        Swipe up for the next game
      </div>
    </div>
  );
}
