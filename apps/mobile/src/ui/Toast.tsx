import { useEffect } from "react";
import { View } from "react-native";
import Animated, { FadeInUp, FadeOutUp } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useToast } from "../state/toast";
import { T } from "./Text";
import { c, radius, space } from "./theme";

export function ToastHost() {
  const current = useToast((s) => s.current);
  const clear = useToast((s) => s.clear);
  const insets = useSafeAreaInsets();
  useEffect(() => {
    if (!current) return;
    const t = setTimeout(clear, 2600);
    return () => clearTimeout(t);
  }, [current, clear]);
  if (!current) return null;
  return (
    <View pointerEvents="none" style={{ position: "absolute", top: insets.top + space[2], left: 0, right: 0, alignItems: "center", zIndex: 50 }}>
      <Animated.View
        key={current.id}
        entering={FadeInUp.duration(180)}
        exiting={FadeOutUp.duration(160)}
        accessibilityLiveRegion="polite"
        accessibilityRole="alert"
        style={{
          backgroundColor: c.raised,
          borderRadius: radius.sheetInner,
          borderWidth: 1,
          borderColor: current.tone === "bad" ? c.heat : current.tone === "good" ? c.accent : c.line,
          paddingHorizontal: space[4],
          paddingVertical: space[3],
          maxWidth: 340,
          flexDirection: "row",
          alignItems: "center",
          gap: space[2],
        }}
      >
        <View style={{ width: 6, height: 6, backgroundColor: current.tone === "bad" ? c.heat : current.tone === "good" ? c.accent : c.textDim }} />
        <T variant="caption">{current.text}</T>
      </Animated.View>
    </View>
  );
}
