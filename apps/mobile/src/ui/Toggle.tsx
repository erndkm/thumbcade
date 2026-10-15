import { useEffect } from "react";
import { View } from "react-native";
import Animated, { interpolateColor, useAnimatedStyle, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import { Press } from "./Press";
import { T } from "./Text";
import { c, layout, space, springs } from "./theme";
import { useReduceMotion } from "../hooks/useMotion";

/** A hardware-style toggle: squared track, accent when on. */
export function ToggleRow({ label, hint, value, onChange, testID }: { label: string; hint?: string; value: boolean; onChange: (v: boolean) => void; testID?: string }) {
  const p = useSharedValue(value ? 1 : 0);
  const reduce = useReduceMotion();
  useEffect(() => {
    p.value = reduce ? withTiming(value ? 1 : 0, { duration: 120 }) : withSpring(value ? 1 : 0, springs.ui);
  }, [value, reduce, p]);
  const track = useAnimatedStyle(() => ({ backgroundColor: interpolateColor(p.value, [0, 1], [c.raised, c.accent]), borderColor: interpolateColor(p.value, [0, 1], [c.lineStrong, c.accent]) }));
  const knob = useAnimatedStyle(() => ({ transform: [{ translateX: p.value * 18 }], backgroundColor: interpolateColor(p.value, [0, 1], [c.textDim, c.onAccent]) }));
  return (
    <Press testID={testID} onPress={() => onChange(!value)} scaleTo={0.99} accessibilityRole="switch" accessibilityState={{ checked: value }} accessibilityLabel={label} style={{ minHeight: 56, flexDirection: "row", alignItems: "center", paddingHorizontal: layout.gutter, gap: space[3] }}>
      <View style={{ flex: 1 }}>
        <T variant="bodyStrong">{label}</T>
        {hint ? (
          <T variant="caption" color="textDim">
            {hint}
          </T>
        ) : null}
      </View>
      <Animated.View style={[{ width: 46, height: 28, borderRadius: 8, borderWidth: 1, padding: 3 }, track]}>
        <Animated.View style={[{ width: 20, height: 20, borderRadius: 5 }, knob]} />
      </Animated.View>
    </Press>
  );
}
