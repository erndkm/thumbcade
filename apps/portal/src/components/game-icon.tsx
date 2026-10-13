import { iconRadius } from "@thumbcade/design-tokens";
import { cx } from "./ui";

/** A game's profile picture as a continuous-corner squircle. */
export function GameIcon({
  url,
  name,
  accent,
  size = 56,
  className,
}: {
  url: string | null;
  name: string;
  accent: string;
  size?: number;
  className?: string;
}) {
  const style = { width: size, height: size, borderRadius: iconRadius(size), background: accent };
  if (!url)
    return (
      <span className={cx("relative inline-block shrink-0 overflow-hidden", className)} style={style} aria-label={name}>
        <span className="absolute inset-[22%] rounded-full border-[3px] border-black/70" />
      </span>
    );
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt={name} width={size} height={size} className={cx("shrink-0 object-cover", className)} style={{ ...style, boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.08)" }} />
  );
}
