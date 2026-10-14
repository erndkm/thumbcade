import { memo, useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { durations } from "@thumbcade/design-tokens";
import { localUrl } from "../lib/env";
import { alpha, c } from "../ui/theme";
import { useReduceMotion } from "../hooks/useMotion";

export interface PosterLayerProps {
  posterUrl: string | null;
  accent: string;
  /** The game called ready(): reveal the live game. */
  ready: boolean;
  width: number;
  height: number;
}

/**
 * The game's poster with a soft accent shimmer while the WebView boots (never a spinner), then a
 * one-pass scanline wipe in the accent color that reveals the live game underneath.
 */
export const PosterLayer = memo(function PosterLayer({ posterUrl, accent, ready, width, height }: PosterLayerProps) {
  const reduce = useReduceMotion();
  const reveal = useSharedValue(ready ? 1 : 0);
  const fade = useSharedValue(1);
  const [gone, setGone] = useState(ready);

  useEffect(() => {
    if (!ready) {
      reveal.value = 0;
      fade.value = 1;
      setGone(false);
      return;
    }
    if (gone) return;
    const done = () => setGone(true);
    if (reduce) {
      fade.value = withTiming(0, { duration: durations.fade }, (f) => {
        if (f) scheduleOnRN(done);
      });
    } else {
      reveal.value = withTiming(1, { duration: durations.scanline, easing: Easing.inOut(Easing.cubic) }, (f) => {
        if (f) scheduleOnRN(done);
      });
    }
  }, [ready, reduce, reveal, fade, gone]);

  const clip = useAnimatedStyle(() => ({
    top: reveal.value * height,
    opacity: fade.value,
  }));
  const inner = useAnimatedStyle(() => ({ transform: [{ translateY: -reveal.value * height }] }));
  const line = useAnimatedStyle(() => ({
    opacity: reveal.value > 0 && reveal.value < 1 ? 1 : 0,
    transform: [{ translateY: reveal.value * height - 28 }],
  }));

  if (gone) return null;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Animated.View style={[{ position: "absolute", left: 0, right: 0, bottom: 0, overflow: "hidden", backgroundColor: c.bg }, clip]}>
        <Animated.View style={[{ width, height }, inner]}>
          {posterUrl ? (
            <Image source={{ uri: localUrl(posterUrl) }} style={{ width, height }} contentFit="cover" cachePolicy="memory-disk" transition={0} />
          ) : (
            <View style={{ width, height, backgroundColor: alpha(accent, 0.12) }} />
          )}
          {!ready ? <Shimmer accent={accent} width={width} height={height} reduce={reduce} /> : null}
        </Animated.View>
      </Animated.View>
      <Animated.View style={[{ position: "absolute", left: 0, right: 0, top: 0, height: 30 }, line]}>
        <LinearGradient colors={[alpha(accent, 0), alpha(accent, 0.35)]} style={{ height: 28 }} />
        <View style={{ height: 2, backgroundColor: accent }} />
      </Animated.View>
    </View>
  );
});

function Shimmer({ accent, width, height, reduce }: { accent: string; width: number; height: number; reduce: boolean }) {
  const x = useSharedValue(0);
  useEffect(() => {
    if (reduce) return;
    x.value = withRepeat(withTiming(1, { duration: 1500, easing: Easing.inOut(Easing.quad) }), -1, false);
  }, [x, reduce]);
  return <ShimmerBand x={x} accent={accent} width={width} height={height} reduce={reduce} />;
}

function ShimmerBand({ x, accent, width, height, reduce }: { x: SharedValue<number>; accent: string; width: number; height: number; reduce: boolean }) {
  const band = Math.max(width, height) * 0.6;
  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: -band + x.value * (height + band * 2) }],
  }));
  if (reduce) return <View style={[StyleSheet.absoluteFill, { backgroundColor: alpha(accent, 0.06) }]} />;
  return (
    <Animated.View style={[{ position: "absolute", left: 0, right: 0, height: band }, style]}>
      <LinearGradient colors={[alpha(accent, 0), alpha(accent, 0.16), alpha(accent, 0)]} style={{ flex: 1 }} />
    </Animated.View>
  );
}
