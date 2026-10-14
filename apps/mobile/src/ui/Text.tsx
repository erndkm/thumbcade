import { Text as RNText, type TextProps } from "react-native";
import type { TextStyleName } from "@thumbcade/design-tokens";
import { c, type } from "./theme";

type ColorKey = "text" | "textDim" | "textMute" | "accentText" | "heat" | "onAccent";

export interface TProps extends TextProps {
  variant?: TextStyleName;
  color?: ColorKey | (string & {});
  align?: "left" | "center" | "right";
}

const MAX_SCALE: Partial<Record<TextStyleName, number>> = {
  display1: 1.1,
  display2: 1.15,
  display3: 1.2,
  monoScore: 1.1,
};

/** Token-driven text. Dynamic Type is honoured up to XL (max multiplier per style). */
export function T({ variant = "body", color = "text", align, style, ...rest }: TProps) {
  const resolved = (c as unknown as Record<string, unknown>)[color];
  return (
    <RNText
      maxFontSizeMultiplier={MAX_SCALE[variant] ?? 1.35}
      {...rest}
      style={[type(variant), { color: typeof resolved === "string" ? resolved : color }, align ? { textAlign: align } : null, style]}
    />
  );
}
