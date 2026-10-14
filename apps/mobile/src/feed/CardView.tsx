import { memo, useEffect, useState, useSyncExternalStore } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import type { NativeGesture } from "react-native-gesture-handler";
import { gestureConfigFor } from "@thumbcade/swipe-contract";
import type { FeedCard } from "@thumbcade/protocol";
import { durations, layout } from "@thumbcade/design-tokens";
import { alpha, c, space } from "../ui/theme";
import { T } from "../ui/Text";
import { useReduceMotion } from "../hooks/useMotion";
import { useAuth } from "../state/auth";
import { openAuthSheet } from "../features/auth/openAuthSheet";
import { openShareSheet } from "../features/share/openShareSheet";
import type { CardController, CardSnapshot } from "./controller";
import { GameFrame } from "./GameFrame";
import { PosterLayer } from "./PosterLayer";
import { ActionRail } from "./ActionRail";
import { Caption } from "./Caption";
import { ResultCard } from "./ResultCard";
import { DevBadge, FailedState, PausePill } from "./CardStates";

const EMPTY: CardSnapshot = { phase: "OFFSCREEN", ready: false, loadKey: 0, result: null, runs: 0, insets: "preview", log: [] };
const noopSubscribe = () => () => {};

export interface CardViewProps {
  card: FeedCard;
  controller: CardController | null;
  native: NativeGesture;
  /** Mount the WebView (the pager owns the WebView budget). */
  live: boolean;
  active: boolean;
  width: number;
  height: number;
  safeTop: number;
  dev?: boolean;
}

export const CardView = memo(function CardView({ card, controller, native, live, active, width, height, safeTop, dev }: CardViewProps) {
  const snap = useSyncExternalStore(controller?.subscribe ?? noopSubscribe, controller?.getSnapshot ?? (() => EMPTY));
  const phase = snap.phase === "OFFSCREEN" ? (controller?.machine.resumeTo ?? "LOADING") : snap.phase;
  const cfg = gestureConfigFor(phase, card.game.controls);
  const overlayVisible = cfg.overlay === "full";
  const reduce = useReduceMotion();
  const guest = useAuth((s) => s.isGuest);
  const [showLog, setShowLog] = useState(false);

  const o = useSharedValue(overlayVisible ? 1 : 0);
  useEffect(() => {
    o.value = withTiming(overlayVisible ? 1 : 0, { duration: reduce ? durations.fade : durations.overlay });
  }, [overlayVisible, reduce, o]);
  const overlayStyle = useAnimatedStyle(() => ({ opacity: o.value, transform: [{ translateY: (1 - o.value) * 12 }] }));

  // A paused run sits under the full chrome again; dimming it keeps the game's HUD from competing with it.
  const paused = active && phase === "PAUSED";
  const dim = useSharedValue(paused ? 1 : 0);
  useEffect(() => {
    dim.value = withTiming(paused ? 1 : 0, { duration: reduce ? durations.fade : durations.overlay });
  }, [paused, reduce, dim]);
  const dimStyle = useAnimatedStyle(() => ({ opacity: dim.value }));

  const showWeb = live && controller !== null;
  const result = snap.result;

  return (
    <View style={{ width, height, backgroundColor: c.bg, overflow: "hidden" }} testID={active ? `active-${card.game.slug}` : undefined} accessibilityLabel={active ? `${card.game.name}, ${phase.toLowerCase()}` : undefined}>
      {showWeb ? <GameFrame controller={controller} native={native} loadKey={snap.loadKey} /> : null}
      <PosterLayer posterUrl={card.game.posterUrl} accent={card.game.accentColor} ready={showWeb && snap.ready} width={width} height={height} />
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: alpha(c.bg, 0.55) }, dimStyle]} />

      <Animated.View pointerEvents={overlayVisible ? "box-none" : "none"} style={[StyleSheet.absoluteFill, overlayStyle]}>
        <LinearGradient pointerEvents="none" colors={c.captionScrim} style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: height * 0.45 }} />
        <View pointerEvents="box-none" style={{ position: "absolute", left: layout.gutter, bottom: space[4] }}>
          <Caption card={card} width={width - layout.actionRailWidth - layout.gutter - space[2]} />
        </View>
        <View pointerEvents="box-none" style={{ position: "absolute", right: 0, bottom: space[4] }}>
          <ActionRail card={card} active={active} lastScore={result?.score ?? null} />
        </View>
      </Animated.View>

      {active && phase === "ENDED" && result && controller ? (
        <View pointerEvents="box-none" style={{ position: "absolute", left: 0, right: 0, top: safeTop + layout.topBarHeight + space[6] }}>
          <ResultCard
            card={card}
            result={result}
            guest={guest}
            onReplay={() => controller.replay()}
            onChallenge={() => openShareSheet(card, result.score, "challenge")}
            onSignUp={() => openAuthSheet({ reason: "Sign up to put your scores on the board." })}
          />
        </View>
      ) : null}

      {active && phase === "PAUSED" && controller ? (
        <View pointerEvents="box-none" style={[StyleSheet.absoluteFill, { alignItems: "center", justifyContent: "center" }]}>
          <PausePill onResume={() => controller.resumePlay()} />
        </View>
      ) : null}

      {phase === "FAILED" && controller ? (
        <View pointerEvents="box-none" style={[StyleSheet.absoluteFill, { justifyContent: "center" }]}>
          <FailedState onRetry={() => controller.retry()} />
        </View>
      ) : null}

      {dev ? (
        <View style={{ position: "absolute", left: layout.gutter, top: safeTop + layout.topBarHeight + space[2], gap: space[2], maxWidth: width - 120 }}>
          <DevBadge onPress={() => setShowLog((s) => !s)} />
          {showLog ? (
            <ScrollView style={{ maxHeight: 220, backgroundColor: alpha(c.bg, 0.78), borderRadius: 8, padding: space[2] }}>
              <T variant="mono" color="textDim" style={{ fontSize: 10, lineHeight: 13 }}>
                {`phase ${snap.phase} · runs ${snap.runs}\n` + snap.log.map((l) => `${l.dir === "in" ? "←" : l.dir === "out" ? "→" : "×"} ${l.text}`).join("\n")}
              </T>
            </ScrollView>
          ) : null}
        </View>
      ) : null}
    </View>
  );
});
