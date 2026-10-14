import type { ReactNode } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import { BusyDots } from "./Skeleton";
import { Press } from "./Press";
import { T } from "./Text";
import { Icon, type IconName } from "./Icon";
import { c, layout, radius, space } from "./theme";

export type ButtonKind = "primary" | "secondary" | "ghost" | "danger" | "accent";

export interface ButtonProps {
  label: string;
  onPress?: () => void;
  kind?: ButtonKind;
  icon?: IconName;
  /** Fill color for kind="accent" (a game's accent). */
  fill?: string;
  fillText?: string;
  busy?: boolean;
  disabled?: boolean;
  small?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  accessibilityLabel?: string;
  right?: ReactNode;
}

/** Buttons are squared-off keys (radius 14), not pills: hardware, not template. */
export function Button({ label, onPress, kind = "primary", icon, fill, fillText, busy, disabled, small, style, testID, accessibilityLabel, right }: ButtonProps) {
  const off = !!disabled && !busy;
  const bg = off
    ? c.raised
    : kind === "primary" ? c.accent : kind === "accent" ? (fill ?? c.accent) : kind === "danger" ? c.heat : kind === "secondary" ? c.raised : "transparent";
  const fg = off
    ? c.textMute
    : kind === "primary" ? c.onAccent : kind === "accent" ? (fillText ?? c.onAccent) : kind === "danger" ? c.onHeat : c.text;
  const h = small ? 40 : 52;
  return (
    <Press
      testID={testID}
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: !!disabled, busy: !!busy }}
      disabled={disabled || busy}
      onPress={onPress}
      scaleTo={0.97}
      style={[
        {
          minHeight: Math.max(h, layout.hitTarget),
          borderRadius: radius.sheetInner,
          backgroundColor: bg,
          borderWidth: off || kind === "secondary" || kind === "ghost" ? 1 : 0,
          borderColor: kind === "ghost" ? c.lineStrong : c.line,
          paddingHorizontal: small ? space[4] : space[5],
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "row",
          gap: space[2],
          opacity: 1,
        },
        style,
      ]}
    >
      {busy ? (
        <BusyDots color={fg} />
      ) : (
        <>
          {icon ? <Icon name={icon} size={small ? 18 : 20} color={fg} /> : null}
          <T variant="button" color={fg}>
            {label}
          </T>
          {right ? <View>{right}</View> : null}
        </>
      )}
    </Press>
  );
}
