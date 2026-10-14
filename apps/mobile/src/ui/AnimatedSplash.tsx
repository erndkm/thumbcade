import { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withSequence, withSpring, withTiming } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { BrandMark } from "./Brand";
import { c } from "./theme";
import { useReduceMotion } from "../hooks/useMotion";

/**
 * Signature moment #6: the splash presses the arcade button. Starts pixel-identical to the native
 * splash (mark at 180 pt on black), presses down, springs back as two rings ripple out, then lifts.
 */
export function AnimatedSplash({ onDone }: { onDone: () => void }) {
  const reduce = useReduceMotion();
  const press = useSharedValue(1);
  const ring = useSharedValue(0);
  const fade = useSharedValue(1);
  useEffect(() => {
    if (reduce) {
      fade.value = withDelay(200, withTiming(0, { duration: 120 }, (f) => {
        if (f) scheduleOnRN(onDone);
      }));
      return;
    }
    press.value = withSequence(
      withDelay(120, withTiming(0.86, { duration: 110, easing: Easing.in(Easing.quad) })),
      withSpring(1, { damping: 9, stiffness: 320, mass: 0.7 }),
    );
    ring.value = withDelay(230, withTiming(1, { duration: 620, easing: Easing.out(Easing.cubic) }));
    fade.value = withDelay(760, withTiming(0, { duration: 220 }, (f) => {
      if (f) scheduleOnRN(onDone);
    }));
  }, [reduce, press, ring, fade, onDone]);
  const markStyle = useAnimatedStyle(() => ({ transform: [{ scale: press.value }] }));
  const ringA = useAnimatedStyle(() => ({ opacity: (1 - ring.value) * 0.9, transform: [{ scale: 0.8 + ring.value * 0.9 }] }));
  const ringB = useAnimatedStyle(() => ({ opacity: Math.max(0, 1 - ring.value * 1.3) * 0.6, transform: [{ scale: 0.8 + ring.value * 1.6 }] }));
  const root = useAnimatedStyle(() => ({ opacity: fade.value }));
  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: c.bg, alignItems: "center", justifyContent: "center", zIndex: 100 }, root]}>
      <Animated.View style={[styles.ring, ringB]} />
      <Animated.View style={[styles.ring, ringA]} />
      <Animated.View style={markStyle}>
        <BrandMark size={180} />
      </Animated.View>
      <View />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  ring: { position: "absolute", width: 180, height: 180, borderRadius: 90, borderWidth: 3, borderColor: c.accent },
});
