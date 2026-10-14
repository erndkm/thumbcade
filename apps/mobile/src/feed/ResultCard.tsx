import { memo, useEffect, useRef } from "react";
import { View } from "react-native";
import Animated, { FadeIn, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withSpring, withTiming } from "react-native-reanimated";
import { formatScore, type FeedCard } from "@thumbcade/protocol";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { Odometer } from "../ui/Odometer";
import { Press } from "../ui/Press";
import { T } from "../ui/Text";
import { accentOf, alpha, c, layout, onColor, radius, space, springs } from "../ui/theme";
import { useReduceMotion } from "../hooks/useMotion";
import { haptic } from "../lib/haptics";
import type { CardResult } from "./controller";

export function percentileLine(p: number | null): string | null {
  if (p === null || Number.isNaN(p)) return null;
  if (p >= 50) return `Top ${Math.max(1, Math.round(100 - p))}% today`;
  if (p < 5) return "Room to climb";
  return `Beat ${Math.round(p)}% today`;
}

export interface ResultCardProps {
  card: FeedCard;
  result: CardResult;
  guest: boolean;
  onReplay: () => void;
  onChallenge: () => void;
  onSignUp: () => void;
}

/** Signature moment #4: score odometer, NEW BEST stamp in volt, today's percentile, the challenge CTA. */
export const ResultCard = memo(function ResultCard({ card, result, guest, onReplay, onChallenge, onSignUp }: ResultCardProps) {
  const reduce = useReduceMotion();
  const accent = accentOf(card.game.accentColor);
  const y = useSharedValue(reduce ? 0 : 36);
  const o = useSharedValue(0);
  const stampedFor = useRef<number | null>(null);

  useEffect(() => {
    haptic.result();
    if (reduce) o.value = withTiming(1, { duration: 120 });
    else {
      o.value = withTiming(1, { duration: 160 });
      y.value = withSpring(0, springs.sheet);
    }
  }, [o, y, reduce]);

  useEffect(() => {
    if (result.isNewBest && stampedFor.current !== result.score) {
      stampedFor.current = result.score;
      const t = setTimeout(() => haptic.newBest(), reduce ? 0 : 520);
      return () => clearTimeout(t);
    }
  }, [result.isNewBest, result.score, reduce]);

  const style = useAnimatedStyle(() => ({ opacity: o.value, transform: [{ translateY: y.value }] }));
  const pct = percentileLine(result.percentile);
  const stats: { label: string; value: string; accent?: boolean; grow: number }[] = [
    ...(result.best !== null ? [{ label: "Best", value: formatScore(result.best, card.game.score), accent: result.isNewBest, grow: 1 }] : []),
    ...(result.percentile !== null ? [{ label: "Today", value: pct ?? "", grow: 2 }] : []),
    ...(result.dailyRank !== null && !guest ? [{ label: "Rank", value: `#${result.dailyRank}`, grow: 1 }] : []),
  ];

  return (
    <Animated.View
      testID="result-card"
      accessibilityViewIsModal={false}
      style={[
        {
          marginLeft: layout.gutter,
          marginRight: layout.actionRailWidth + space[1],
          borderRadius: radius.sheet,
          borderCurve: "continuous",
          backgroundColor: c.surface,
          borderWidth: 1,
          borderColor: c.line,
          overflow: "hidden",
        },
        style,
      ]}
    >
      <View style={{ height: 3, backgroundColor: accent }} />
      <View style={{ padding: space[5], gap: space[4] }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <T variant="monoLabel" color="textDim" numberOfLines={1}>
            {result.outcome === "win" ? "Cleared" : "Run over"} · {card.game.name}
          </T>
        </View>
        <View style={{ alignItems: "flex-start" }}>
          <Odometer testID="result-score" value={formatScore(result.score, card.game.score)} color={c.text} />
          {result.isNewBest ? <NewBestStamp reduce={reduce} /> : null}
        </View>
        <View style={{ minHeight: 34 }}>
          {stats.length ? (
            <Animated.View entering={FadeIn.duration(200)} style={{ flexDirection: "row", gap: space[3] }}>
              {stats.map((st) => (
                <View key={st.label} style={{ flex: st.grow, gap: 2 }} accessible accessibilityLabel={`${st.label}: ${st.value}`}>
                  <T variant="monoLabel" color="textDim">
                    {st.label}
                  </T>
                  <T variant="mono" color={st.accent ? "accentText" : "text"} numberOfLines={2}>
                    {st.value}
                  </T>
                </View>
              ))}
            </Animated.View>
          ) : result.pending ? (
            <T variant="mono" color="textDim">
              Checking the board…
            </T>
          ) : null}
        </View>
        {guest ? (
          <Press onPress={onSignUp} scaleTo={0.98} style={{ flexDirection: "row", alignItems: "center", gap: space[2] }} accessibilityLabel="Sign up to get ranked">
            <Icon name="trophy" size={16} color={c.textDim} />
            <T variant="caption" color="textDim">
              Guest runs don't rank. <T variant="caption" color="text">Sign up to get on the board.</T>
            </T>
          </Press>
        ) : null}
        <View style={{ gap: space[2] }}>
          <Button testID="result-replay" label="Play again" icon="replay" kind="accent" fill={accent} fillText={onColor(accent)} onPress={onReplay} />
          <Button testID="result-challenge" label="Challenge a friend" icon="bolt" kind="secondary" onPress={onChallenge} />
        </View>
        <SwipeHint reduce={reduce} />
      </View>
    </Animated.View>
  );
});

function NewBestStamp({ reduce }: { reduce: boolean }) {
  const s = useSharedValue(reduce ? 1 : 2.2);
  const o = useSharedValue(0);
  useEffect(() => {
    if (reduce) {
      o.value = withTiming(1, { duration: 120 });
      return;
    }
    o.value = withDelay(480, withTiming(1, { duration: 60 }));
    s.value = withDelay(480, withSpring(1, springs.pop));
  }, [o, s, reduce]);
  const style = useAnimatedStyle(() => ({ opacity: o.value, transform: [{ rotate: "-9deg" }, { scale: s.value }] }));
  return (
    <Animated.View
      testID="new-best"
      accessibilityLabel="New best"
      style={[
        {
          position: "absolute",
          right: -4,
          top: 6,
          borderWidth: 2,
          borderColor: c.accent,
          paddingHorizontal: space[2],
          paddingVertical: 3,
          borderRadius: 4,
          backgroundColor: alpha(c.accent, 0.08),
        },
        style,
      ]}
    >
      <T variant="monoLabel" color="accentText" style={{ fontSize: 13, lineHeight: 16 }}>
        New best
      </T>
    </Animated.View>
  );
}

function SwipeHint({ reduce }: { reduce: boolean }) {
  const y = useSharedValue(0);
  useEffect(() => {
    if (reduce) return;
    y.value = withRepeat(withSequence(withTiming(-5, { duration: 520 }), withTiming(0, { duration: 520 })), -1);
  }, [y, reduce]);
  const style = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }));
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space[1.5] }} accessibilityLabel="Swipe up for the next game">
      <Animated.View style={style}>
        <Icon name="swipeUp" size={16} color={c.textMute} />
      </Animated.View>
      <T variant="monoLabel" color="textDim">
        Swipe up for the next one
      </T>
    </View>
  );
}
