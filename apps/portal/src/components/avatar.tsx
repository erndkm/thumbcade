import { pixelAvatar } from "@thumbcade/design-tokens";
import { cx } from "./ui";

/** Generative 8x8 pixel avatar (never initials in a circle). */
export function PixelAvatar({ seed, size = 40, className }: { seed: string; size?: number; className?: string }) {
  const a = pixelAvatar(seed);
  return (
    <svg viewBox="0 0 8 8" width={size} height={size} shapeRendering="crispEdges" className={cx("shrink-0 rounded-full", className)} aria-hidden>
      <rect width="8" height="8" fill={a.background} />
      <g fill={a.foreground}>
        {a.cells.map((on, i) => (on ? <rect key={i} x={i % 8} y={Math.floor(i / 8)} width="1.02" height="1.02" /> : null))}
      </g>
    </svg>
  );
}

export function Avatar({ url, seed, size = 40, className, alt = "" }: { url: string | null; seed: string; size?: number; className?: string; alt?: string }) {
  if (!url) return <PixelAvatar seed={seed} size={size} className={className} />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt={alt} width={size} height={size} className={cx("shrink-0 rounded-full object-cover", className)} />;
}
