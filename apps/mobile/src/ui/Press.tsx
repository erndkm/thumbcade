import { forwardRef, type ReactNode } from "react";
import { Pressable, type PressableProps, type View, type StyleProp, type ViewStyle } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import { springs } from "./theme";
import { useReduceMotion } from "../hooks/useMotion";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export interface PressProps extends Omit<PressableProps, "style" | "children"> {
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
  /** Scale while pressed. */
  scaleTo?: number;
  hitSlop?: number;
}

/** Pressable with a springy press-down, ≥44 pt via hitSlop when the visual is smaller. */
export const Press = forwardRef<View, PressProps>(function Press({ style, children, scaleTo = 0.94, hitSlop = 8, onPressIn, onPressOut, ...rest }, ref) {
  const s = useSharedValue(1);
  const reduce = useReduceMotion();
  const anim = useAnimatedStyle(() => ({ transform: [{ scale: s.value }] }));
  return (
    <AnimatedPressable
      ref={ref}
      hitSlop={hitSlop}
      accessibilityRole="button"
      onPressIn={(e) => {
        s.value = reduce ? withTiming(scaleTo, { duration: 80 }) : withSpring(scaleTo, springs.ui);
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        s.value = reduce ? withTiming(1, { duration: 120 }) : withSpring(1, springs.ui);
        onPressOut?.(e);
      }}
      style={[style, anim]}
      {...rest}
    >
      {children}
    </AnimatedPressable>
  );
});
