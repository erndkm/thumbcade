import { formatCount, formatScore, safeAccent } from "@thumbcade/protocol";
import type { ReactNode } from "react";
import type { WebCard } from "@/lib/data";
import { Avatar } from "./avatar";
import { GameIcon } from "./game-icon";
import { Chip } from "./ui";

export interface LeaderRow {
  rank: number;
  name: string;
  handle: string;
  avatarUrl: string | null;
  avatarSeed: string;
  score: number;
}

/** Left column of the game / challenge pages: the game's "profile". */
export function GameHero({ card, eyebrow, title, children, leaders }: { card: WebCard; eyebrow?: ReactNode; title?: ReactNode; children?: ReactNode; leaders: LeaderRow[] }) {
  const accent = safeAccent(card.accentColor);
  return (
    <div className="flex flex-col gap-8">
      {eyebrow}
      <div className="flex items-center gap-5">
        <GameIcon url={card.iconUrl} name={card.name} accent={card.accentColor} size={104} />
        <div className="min-w-0">
          <h1 className="display text-[clamp(40px,5.4vw,72px)] text-text">{title ?? card.name}</h1>
          <div className="mt-3 flex items-center gap-2 text-[15px] text-text-dim">
            <Avatar url={card.creator.avatarUrl} seed={card.creator.avatarSeed} size={24} />
            <span>@{card.creator.handle}</span>
            {card.creator.verified ? <span className="size-3 rounded-full" style={{ background: accent }} title="Verified creator" /> : null}
          </div>
        </div>
      </div>
      <p className="max-w-[520px] text-[18px] leading-7 text-text-dim">{card.description}</p>
      <div className="flex flex-wrap gap-2">
        {card.tags.map((t) => (
          <Chip key={t}>#{t}</Chip>
        ))}
        <Chip>{card.ageRating}</Chip>
        <Chip accent={accent}>{card.controls.vertical ? "uses swipes" : "tap to play"}</Chip>
      </div>
      <dl className="grid max-w-[520px] grid-cols-4 border-t border-line pt-6">
        {[
          ["Plays", formatCount(card.stats.plays)],
          ["Likes", formatCount(card.stats.likes)],
          ["Saves", formatCount(card.stats.saves)],
          ["Shares", formatCount(card.stats.shares)],
        ].map(([k, v]) => (
          <div key={k}>
            <dt className="label">{k}</dt>
            <dd className="mt-1 font-mono text-[24px] text-text tabular">{v}</dd>
          </div>
        ))}
      </dl>
      {children}
      <div className="max-w-[520px]">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="font-semiwide text-[17px] font-bold text-text">All-time leaderboard</h2>
          <span className="label">Top {Math.max(leaders.length, 10)}</span>
        </div>
        {leaders.length === 0 ? (
          <p className="rule-t py-5 text-[15px] text-text-mute">No scores yet. The top spot is open — go take it.</p>
        ) : (
          <ol className="rule-t">
            {leaders.map((l) => (
              <li key={l.rank} className="rule-b flex items-center gap-4 py-3">
                <span className="w-6 font-mono text-[13px] text-text-mute tabular">{String(l.rank).padStart(2, "0")}</span>
                <Avatar url={l.avatarUrl} seed={l.avatarSeed} size={28} />
                <span className="min-w-0 flex-1 truncate text-[15px] text-text">@{l.handle}</span>
                <span className="font-mono text-[15px] text-text tabular" style={l.rank === 1 ? { color: accent } : undefined}>
                  {formatScore(l.score, card.score)}
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
