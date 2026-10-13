import { ICON_STROKE, icons, type IconName } from "@thumbcade/design-tokens";

/** The shared Thumbcade icon set (24-pt grid, 1.75 stroke, square caps). `active` draws the filled variant. */
export function Icon({ name, size = 24, active = false, bg = "var(--tc-bg)", label }: { name: IconName; size?: number; active?: boolean; bg?: string; label?: string }) {
  const icon = icons[name] as { d: string; filled?: string; filledDetail?: string; solid?: boolean };
  const filled = active || icon.solid;
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden={label ? undefined : true} aria-label={label} role={label ? "img" : undefined}>
      {filled ? (
        <>
          <path d={icon.filled ?? icon.d} fill="currentColor" />
          {icon.filledDetail ? <path d={icon.filledDetail} fill="none" stroke={bg} strokeWidth={ICON_STROKE} strokeLinecap="square" strokeLinejoin="miter" /> : null}
        </>
      ) : (
        <path d={icon.d} fill="none" stroke="currentColor" strokeWidth={ICON_STROKE} strokeLinecap="square" strokeLinejoin="miter" />
      )}
    </svg>
  );
}
