import { ICON_STROKE, icons, type IconName } from "@thumbcade/design-tokens";

type IconDef = { d: string; filled?: string; filledDetail?: string; solid?: boolean };

export function Icon({
  name,
  size = 20,
  active = false,
  className,
  detailColor = "var(--tc-bg)",
  title,
}: {
  name: IconName;
  size?: number;
  active?: boolean;
  className?: string;
  detailColor?: string;
  title?: string;
}) {
  const def = icons[name] as IconDef;
  const showFilled = def.solid || (active && def.filled);
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
      focusable="false"
    >
      {title ? <title>{title}</title> : null}
      {showFilled ? (
        <>
          <path d={def.solid ? def.d : def.filled} fill="currentColor" />
          {active && def.filledDetail ? (
            <path d={def.filledDetail} fill="none" stroke={detailColor} strokeWidth={ICON_STROKE} strokeLinecap="square" strokeLinejoin="miter" />
          ) : null}
        </>
      ) : (
        <path d={def.d} fill="none" stroke="currentColor" strokeWidth={ICON_STROKE} strokeLinecap="square" strokeLinejoin="miter" />
      )}
    </svg>
  );
}
