import { useEffect } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from "react-native-reanimated";
import { c, radius } from "./theme";
import { useReduceMotion } from "../hooks/useMotion";

/** A skeleton block in the final layout. Breathes softly; never a spinner. */
export function Skeleton({ style, round }: { style?: StyleProp<ViewStyle>; round?: boolean }) {
  const o = useSharedValue(0.55);
  const reduce = useReduceMotion();
  useEffect(() => {
    if (reduce) return;
    o.value = withRepeat(withSequence(withTiming(1, { duration: 700, easing: Easing.inOut(Easing.quad) }), withTiming(0.55, { duration: 700 })), -1);
  }, [o, reduce]);
  const anim = useAnimatedStyle(() => ({ opacity: o.value }));
  return <Animated.View style={[{ backgroundColor: c.raised, borderRadius: round ? radius.pill : radius.chip }, style, anim]} />;
}

/** Three keys blinking in sequence: the busy state for buttons and sheets. */
export function BusyDots({ color = c.text, size = 6 }: { color?: string; size?: number }) {
  return (
    <View style={{ flexDirection: "row", gap: size * 0.8 }} accessibilityLabel="Working" accessibilityRole="progressbar">
      {[0, 1, 2].map((i) => (
        <Dot key={i} delay={i * 140} color={color} size={size} />
      ))}
    </View>
  );
}

function Dot({ delay, color, size }: { delay: number; color: string; size: number }) {
  const o = useSharedValue(0.25);
  useEffect(() => {
    const t = setTimeout(() => {
      o.value = withRepeat(withSequence(withTiming(1, { duration: 260 }), withTiming(0.25, { duration: 260 })), -1);
    }, delay);
    return () => clearTimeout(t);
  }, [delay, o]);
  const anim = useAnimatedStyle(() => ({ opacity: o.value }));
  return <Animated.View style={[{ width: size, height: size, backgroundColor: color }, anim]} />;
}
