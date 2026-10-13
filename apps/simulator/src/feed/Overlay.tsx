import { pixelAvatarSvg } from "@thumbcade/design-tokens";
import { formatCount, safeAccent } from "@thumbcade/protocol";
import { useMemo } from "react";
import { Icon } from "../ui/Icon.tsx";

export interface OverlayData {
  handle: string;
  name: string;
  description: string;
  tags: string[];
  accent: string;
  iconUrl: string | null;
  meta: string;
  dev?: boolean;
  counts: { likes: number; comments: number; saves: number; shares: number };
}

export interface OverlayActions {
  liked: boolean;
  saved: boolean;
  following: boolean;
  onLike(): void;
  onSave(): void;
  onFollow(): void;
  onComment(): void;
  onShare(): void;
  /** Pans that start on the chrome drive the feed. */
  onPointerDown(e: React.PointerEvent): void;
  suppressClick(): boolean;
}

/** Right action rail + bottom-left caption, exactly where the app draws them (72 pt rail, 148 pt caption). */
export function Overlay({ data, actions, hidden, interactive = true }: { data: OverlayData; actions: OverlayActions; hidden: boolean; interactive?: boolean }) {
  const avatar = useMemo(() => `data:image/svg+xml;utf8,${encodeURIComponent(pixelAvatarSvg(data.handle, 64))}`, [data.handle]);
  const accent = safeAccent(data.accent);
  const guard = (fn: () => void) => () => {
    if (!actions.suppressClick()) fn();
  };
  return (
    <div className={`overlay ${hidden ? "is-receded" : ""} ${interactive ? "" : "is-static"}`} style={{ "--accent": accent } as React.CSSProperties} inert={!interactive}>
      <div className="rail" onPointerDown={actions.onPointerDown}>
        <button className="rail__avatar" onClick={guard(actions.onFollow)} aria-label={actions.following ? `Unfollow @${data.handle}` : `Follow @${data.handle}`}>
          <img src={avatar} alt="" width={44} height={44} />
          <span className={`rail__follow ${actions.following ? "is-on" : ""}`}>
            <Icon name={actions.following ? "check" : "plus"} size={14} />
          </span>
        </button>
        <RailButton icon="like" label="Like" count={data.counts.likes + (actions.liked ? 1 : 0)} active={actions.liked} tone="heat" onClick={guard(actions.onLike)} />
        <RailButton icon="comment" label="Comments" count={data.counts.comments} onClick={guard(actions.onComment)} />
        <RailButton icon="save" label="Save" count={data.counts.saves + (actions.saved ? 1 : 0)} active={actions.saved} tone="volt" onClick={guard(actions.onSave)} />
        <RailButton icon="share" label="Share" count={data.counts.shares} onClick={guard(actions.onShare)} />
        <span className="rail__cartridge" aria-hidden="true">
          {data.iconUrl ? <img src={data.iconUrl} alt="" /> : <span className="rail__cartridge-fallback" />}
        </span>
      </div>
      <div className="caption" onPointerDown={actions.onPointerDown}>
        <div className="caption__handle">
          <span>@{data.handle}</span>
          {data.dev ? <span className="chip chip--dev">DEV</span> : null}
        </div>
        <div className="caption__name">{data.name}</div>
        <p className="caption__desc">{data.description}</p>
        <div className="caption__tags">
          {data.tags.map((t) => (
            <span key={t} className="caption__tag">
              #{t}
            </span>
          ))}
        </div>
        <div className="caption__meta tc-mono">
          <Icon name="play" size={11} active />
          <span>{data.meta}</span>
        </div>
      </div>
    </div>
  );
}

function RailButton({ icon, label, count, active, tone, onClick }: { icon: "like" | "comment" | "save" | "share"; label: string; count: number; active?: boolean; tone?: "heat" | "volt"; onClick(): void }) {
  return (
    <button className={`rail__btn ${active ? `is-active is-${tone}` : ""}`} onClick={onClick} aria-label={label} aria-pressed={active}>
      <span className="rail__icon">
        <Icon name={icon} size={30} active={active} />
      </span>
      <span className="rail__count tc-mono">{formatCount(count)}</span>
    </button>
  );
}
