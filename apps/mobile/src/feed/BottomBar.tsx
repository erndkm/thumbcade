import { memo, useEffect, useState, type ReactNode } from "react";
import { useWindowDimensions, View } from "react-native";
import { GestureDetector, type GestureType } from "react-native-gesture-handler";
import Animated, {
  interpolate,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { durations, layout } from "@thumbcade/design-tokens";
import { Icon, type IconName } from "../ui/Icon";
import { Press } from "../ui/Press";
import { T } from "../ui/Text";
import { c, space, springs } from "../ui/theme";
import { useReduceMotion } from "../hooks/useMotion";

export type TabKey = "home" | "discover" | "create" | "inbox" | "me";

const TABS: { key: TabKey; icon: IconName; label: string }[] = [
  { key: "home", icon: "home", label: "Home" },
  { key: "discover", icon: "discover", label: "Discover" },
  { key: "create", icon: "create", label: "Create" },
  { key: "inbox", icon: "inbox", label: "Inbox" },
  { key: "me", icon: "profile", label: "Profile" },
];

export interface DockActions {
  liked: boolean;
  onLike: () => void;
  muted: boolean;
  onToggleMute: () => void;
  onMore: () => void;
}

export interface BottomBarProps {
  active: TabKey;
  onTab: (tab: TabKey) => void;
  /** Tab bar or Dock (PLAYING). */
  mode: "tabbar" | "dock";
  /** Accent for the Dock grabber (the current game's, contrast-checked). */
  accent?: string;
  dock?: DockActions;
  /** Pan that drives the feed from the bar (always available on the feed). */
  gesture?: GestureType;
  /** Play the "swipe here for next" coach once when the Dock appears. */
  coach?: boolean;
  onCoachShown?: () => void;
  inboxBadge?: number;
}

/**
 * One bar, two personalities. Outside play it is the tab bar; when a run starts it morphs (spring,
 * ~280 ms) into the Dock: the Home key collapses into a grabber pill tinted with the game's accent
 * and mini actions slide in from the sides. Same height either way, so the game never resizes.
 */
export const BottomBar = memo(function BottomBar({ active, onTab, mode, accent = c.text, dock, gesture, coach, onCoachShown, inboxBadge = 0 }: BottomBarProps) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const reduce = useReduceMotion();
  const p = useSharedValue(mode === "dock" ? 1 : 0);
  const slot = width / TABS.length;
  const homeCenter = slot / 2;

  useEffect(() => {
    const to = mode === "dock" ? 1 : 0;
    p.value = reduce ? withTiming(to, { duration: durations.fade }) : withSpring(to, springs.morph);
  }, [mode, reduce, p]);

  const tabsStyle = useAnimatedStyle(() => ({
    opacity: interpolate(p.value, [0, 0.55], [1, 0], "clamp"),
    transform: [{ translateY: interpolate(p.value, [0, 1], [0, 10]) }],
  }));
  const grabberStyle = useAnimatedStyle(() => {
    const w = interpolate(p.value, [0, 1], [22, layout.grabberWidth]);
    const h = interpolate(p.value, [0, 1], [22, layout.grabberHeight]);
    return {
      width: w,
      height: h,
      borderRadius: interpolate(p.value, [0, 1], [5, layout.grabberHeight / 2]),
      opacity: interpolate(p.value, [0, 0.25, 1], [0, 1, 1]),
      backgroundColor: interpolateColor(p.value, [0, 1], [c.text, accent]),
      transform: [{ translateX: interpolate(p.value, [0, 1], [homeCenter - width / 2, 0]) }, { translateY: interpolate(p.value, [0, 1], [-6, 0]) }],
    };
  });
  const leftStyle = useAnimatedStyle(() => ({
    opacity: interpolate(p.value, [0.4, 1], [0, 1], "clamp"),
    transform: [{ translateX: interpolate(p.value, [0, 1], [-24, 0]) }],
  }));
  const rightStyle = useAnimatedStyle(() => ({
    opacity: interpolate(p.value, [0.4, 1], [0, 1], "clamp"),
    transform: [{ translateX: interpolate(p.value, [0, 1], [24, 0]) }],
  }));

  const isDock = mode === "dock";
  const bar = (
    <View
      testID={isDock ? "dock" : "tabbar"}
      accessibilityLabel={isDock ? "Dock. Swipe up or down here to change games." : undefined}
      style={{ height: layout.bottomBarHeight + insets.bottom, paddingBottom: insets.bottom, backgroundColor: c.bg, borderTopWidth: 1, borderTopColor: c.line }}
    >
      <View style={{ height: layout.bottomBarHeight }}>
        <Animated.View
          pointerEvents={isDock ? "none" : "auto"}
          accessibilityElementsHidden={isDock}
          importantForAccessibility={isDock ? "no-hide-descendants" : "auto"}
          style={[{ flexDirection: "row", height: layout.bottomBarHeight }, tabsStyle]}
        >
          {TABS.map((t) => (
            <TabItem key={t.key} tab={t} active={active === t.key} onPress={() => onTab(t.key)} badge={t.key === "inbox" ? inboxBadge : 0} />
          ))}
        </Animated.View>
        <View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, alignItems: "center", justifyContent: "center" }}>
          <Animated.View style={grabberStyle} />
        </View>
        {dock ? (
          <>
            <Animated.View
              pointerEvents={isDock ? "auto" : "none"}
              accessibilityElementsHidden={!isDock}
              importantForAccessibility={isDock ? "auto" : "no-hide-descendants"}
              style={[{ position: "absolute", left: space[2], top: 0, bottom: 0, flexDirection: "row", alignItems: "center" }, leftStyle]}>
              <DockButton icon="like" active={dock.liked} color={dock.liked ? c.heat : c.text} label={dock.liked ? "Unlike" : "Like"} onPress={dock.onLike} testID="dock-like" />
            </Animated.View>
            <Animated.View
              pointerEvents={isDock ? "auto" : "none"}
              accessibilityElementsHidden={!isDock}
              importantForAccessibility={isDock ? "auto" : "no-hide-descendants"}
              style={[{ position: "absolute", right: space[2], top: 0, bottom: 0, flexDirection: "row", alignItems: "center" }, rightStyle]}>
              <DockButton icon={dock.muted ? "soundOff" : "soundOn"} label={dock.muted ? "Sound on" : "Mute"} onPress={dock.onToggleMute} testID="dock-mute" />
              <DockButton icon="more" label="More" onPress={dock.onMore} testID="dock-more" />
            </Animated.View>
          </>
        ) : null}
        {isDock && coach ? <DockCoach accent={accent} onShown={onCoachShown} /> : null}
      </View>
    </View>
  );
  return gesture ? <GestureDetector gesture={gesture}>{bar}</GestureDetector> : bar;
});

function TabItem({ tab, active, onPress, badge }: { tab: (typeof TABS)[number]; active: boolean; onPress: () => void; badge: number }) {
  const create = tab.key === "create";
  return (
    <Press
      onPress={onPress}
      testID={`tab-${tab.key}`}
      accessibilityRole="tab"
      accessibilityLabel={badge > 0 ? `${tab.label}, ${badge} new` : tab.label}
      accessibilityState={{ selected: active }}
      scaleTo={0.9}
      hitSlop={0}
      style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 3 }}
    >
      {create ? (
        <View style={{ width: 40, height: 26, borderRadius: 7, backgroundColor: c.text, alignItems: "center", justifyContent: "center" }}>
          <Icon name="plus" size={18} color={c.bg} strokeWidth={2.4} />
        </View>
      ) : (
        <View>
          <Icon name={tab.icon} size={24} active={active} color={active ? c.text : c.textDim} />
          {badge > 0 ? (
            <View style={{ position: "absolute", right: -9, top: -5, minWidth: 16, height: 16, borderRadius: 8, paddingHorizontal: 4, backgroundColor: c.heat, alignItems: "center", justifyContent: "center" }}>
              <T variant="mono" color="onHeat" style={{ fontSize: 10, lineHeight: 12 }}>
                {badge > 99 ? "99+" : badge}
              </T>
            </View>
          ) : null}
        </View>
      )}
      {create ? null : (
        <T variant="micro" color={active ? "text" : "textDim"} maxFontSizeMultiplier={1.1}>
          {tab.label}
        </T>
      )}
    </Press>
  );
}

function DockButton({ icon, label, onPress, active, color = c.text, testID }: { icon: IconName; label: string; onPress: () => void; active?: boolean; color?: string; testID?: string }) {
  return (
    <Press onPress={onPress} accessibilityLabel={label} testID={testID} hitSlop={0} style={{ width: layout.hitTarget, height: layout.hitTarget, alignItems: "center", justifyContent: "center" }}>
      <Icon name={icon} size={22} active={active} color={color} />
    </Press>
  );
}

/** "Swipe here for next" — plays the first three times a vertical-claiming game is played. */
function DockCoach({ accent, onShown }: { accent: string; onShown?: (() => void) | undefined }) {
  const o = useSharedValue(0);
  const y = useSharedValue(0);
  const [done, setDone] = useState(false);
  useEffect(() => {
    onShown?.();
    o.value = withSequence(withTiming(1, { duration: 180 }), withDelay(durations.coach - 360, withTiming(0, { duration: 180 })));
    y.value = withSequence(withTiming(-10, { duration: 420 }), withTiming(0, { duration: 420 }), withTiming(-10, { duration: 420 }));
    const t = setTimeout(() => setDone(true), durations.coach + 100);
    return () => clearTimeout(t);
    // Plays once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const style = useAnimatedStyle(() => ({ opacity: o.value, transform: [{ translateY: y.value }] }));
  if (done) return null;
  return (
    <Animated.View pointerEvents="none" testID="dock-coach" style={[{ position: "absolute", left: 0, right: 0, bottom: layout.bottomBarHeight + 6, alignItems: "center", gap: 4 }, style]}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space[1.5], paddingHorizontal: space[3], paddingVertical: space[1.5], borderRadius: 999, backgroundColor: c.surface, borderWidth: 1, borderColor: accent }}>
        <Icon name="swipeUp" size={14} color={accent} />
        <T variant="monoLabel">Swipe here for next</T>
      </View>
    </Animated.View>
  );
}

export function BottomBarSpacer({ children }: { children?: ReactNode }) {
  const insets = useSafeAreaInsets();
  return <View style={{ height: layout.bottomBarHeight + insets.bottom }}>{children}</View>;
}
