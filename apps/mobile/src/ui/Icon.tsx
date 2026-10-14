import Svg, { Path } from "react-native-svg";
import { ICON_STROKE, icons, type IconName } from "@thumbcade/design-tokens";
import { alpha, c } from "./theme";

export type { IconName };

export interface IconProps {
  name: IconName;
  size?: number;
  color?: string;
  /** Filled/active variant. */
  active?: boolean;
  /** Color used for details drawn on top of a filled icon (usually the surface behind it). */
  detailColor?: string;
  strokeWidth?: number;
  /** Soft ink outline so the glyph stays legible over any game. */
  halo?: boolean;
}

/** The shared Thumbcade icon set (packages/design-tokens/src/icons.ts) on a 24-pt grid. */
export function Icon({ name, size = 24, color = c.text, active = false, detailColor = c.bg, strokeWidth = ICON_STROKE, halo = false }: IconProps) {
  const def = icons[name] as { d: string; filled?: string; filledDetail?: string; solid?: boolean };
  const filled = def.solid || (active && def.filled !== undefined);
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {halo ? (
        <Path d={filled ? (def.filled ?? def.d) : def.d} fill="none" stroke={alpha(c.bg, 0.38)} strokeWidth={strokeWidth + 2.6} strokeLinecap="square" strokeLinejoin="round" />
      ) : null}
      {filled ? (
        <>
          <Path d={def.filled ?? def.d} fill={color} />
          {def.filledDetail ? (
            <Path d={def.filledDetail} fill="none" stroke={detailColor} strokeWidth={strokeWidth} strokeLinecap="square" strokeLinejoin="miter" />
          ) : null}
        </>
      ) : (
        <Path d={def.d} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="square" strokeLinejoin="miter" />
      )}
    </Svg>
  );
}
