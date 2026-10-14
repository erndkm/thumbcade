import { memo, useEffect } from "react";
import { Text, View } from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withSpring, withTiming } from "react-native-reanimated";
import type { TextStyleName } from "@thumbcade/design-tokens";
import { c, type } from "./theme";
import { useReduceMotion } from "../hooks/useMotion";

const DIGITS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];

/** A score that rolls into place like a mechanical counter (Departure Mono). */
export const Odometer = memo(function Odometer({
  value,
  variant = "monoScore",
  color = c.text,
  testID,
}: {
  value: string;
  variant?: TextStyleName;
  color?: string;
  testID?: string;
}) {
  const t = type(variant);
  const lh = t.lineHeight ?? 60;
  const chars = value.split("");
  const digitCount = chars.filter((ch) => /\d/.test(ch)).length;
  let digitIndex = 0;
  return (
    <View testID={testID} accessible accessibilityLabel={value} style={{ flexDirection: "row", height: lh, overflow: "hidden" }}>
      {chars.map((ch, i) => {
        if (!/\d/.test(ch)) {
          return (
            <Text key={`s${i}`} style={[t, { color }]} allowFontScaling={false}>
              {ch}
            </Text>
          );
        }
        const order = digitCount - 1 - digitIndex++;
        return <DigitColumn key={`d${i}-${chars.length}`} digit={Number(ch)} lh={lh} color={color} variant={variant} delay={order * 70} />;
      })}
    </View>
  );
});

function DigitColumn({ digit, lh, color, variant, delay }: { digit: number; lh: number; color: string; variant: TextStyleName; delay: number }) {
  const reduce = useReduceMotion();
  const y = useSharedValue(reduce ? -digit * lh : 0);
  useEffect(() => {
    // Roll at least one full turn for the leading digits so the counter visibly spins up.
    const target = -digit * lh;
    if (reduce) {
      y.value = withTiming(target, { duration: 120 });
      return;
    }
    y.value = withDelay(
      delay,
      withTiming(target - lh * 10, { duration: 520 + delay, easing: Easing.out(Easing.cubic) }, () => {
        y.value = target;
        y.value = withSpring(target, { damping: 14, stiffness: 260 });
      }),
    );
  }, [digit, lh, delay, reduce, y]);
  const style = useAnimatedStyle(() => ({ transform: [{ translateY: y.value % (lh * 10) }] }));
  const t = type(variant);
  return (
    <Animated.View style={style}>
      {DIGITS.concat(DIGITS).map((d, i) => (
        <Text key={i} style={[t, { color, height: lh }]} allowFontScaling={false}>
          {d}
        </Text>
      ))}
    </Animated.View>
  );
}
