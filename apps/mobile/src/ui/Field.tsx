import { forwardRef } from "react";
import { TextInput, View, type TextInputProps } from "react-native";
import { T } from "./Text";
import { c, radius, space, type } from "./theme";

export interface FieldProps extends TextInputProps {
  label?: string;
  error?: string | null;
  mono?: boolean;
}

export const Field = forwardRef<TextInput, FieldProps>(function Field({ label, error, mono, style, ...rest }, ref) {
  return (
    <View style={{ gap: space[1.5] }}>
      {label ? (
        <T variant="monoLabel" color="textDim">
          {label}
        </T>
      ) : null}
      <TextInput
        ref={ref}
        placeholderTextColor={c.textMute}
        selectionColor={c.accent}
        keyboardAppearance="dark"
        maxFontSizeMultiplier={1.35}
        accessibilityLabel={rest.accessibilityLabel ?? label}
        {...rest}
        style={[
          mono ? type("mono") : type("body"),
          {
            minHeight: 48,
            borderRadius: radius.input,
            borderWidth: 1,
            borderColor: error ? c.heat : c.line,
            backgroundColor: c.raised,
            color: c.text,
            paddingHorizontal: space[4],
            paddingVertical: space[3],
          },
          mono ? { fontSize: 22, lineHeight: 28, letterSpacing: 6 } : null,
          style,
        ]}
      />
      {error ? (
        <T variant="caption" color="heat" accessibilityLiveRegion="polite">
          {error}
        </T>
      ) : null}
    </View>
  );
});
