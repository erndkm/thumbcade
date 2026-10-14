import { createContext, useContext, useEffect, type ReactNode } from "react";
import { BackHandler, Pressable, StyleSheet, useWindowDimensions, View } from "react-native";
import { usePathname } from "expo-router";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  interpolate,
  useAnimatedKeyboard,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSheets, type SheetSpec } from "../state/sheets";
import { useReduceMotion } from "../hooks/useMotion";
import { c, radius, springs } from "./theme";

export function SheetHost() {
  const stack = useSheets((s) => s.stack);
  const pathname = usePathname();
  // Navigating away closes every sheet (they belong to the screen they were opened on).
  useEffect(() => {
    for (const s of useSheets.getState().stack) useSheets.getState().close(s.key);
  }, [pathname]);
  useEffect(() => {
    if (stack.length === 0) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      useSheets.getState().close();
      return true;
    });
    return () => sub.remove();
  }, [stack.length]);
  return (
    <>
      {stack.map((spec) => (
        <SheetView key={spec.key} spec={spec} />
      ))}
    </>
  );
}

function SheetView({ spec }: { spec: SheetSpec & { closing?: boolean } }) {
  const { height: H } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const reduce = useReduceMotion();
  const sheetH = Math.round(H * (spec.snap ?? 0.62));
  const y = useSharedValue(sheetH);
  const fade = useSharedValue(0);
  const keyboard = useAnimatedKeyboard();
  const remove = useSheets((s) => s.remove);
  const close = useSheets((s) => s.close);

  useEffect(() => {
    if (reduce) {
      y.value = 0;
      fade.value = withTiming(1, { duration: 120 });
    } else {
      fade.value = 1;
      y.value = withSpring(0, springs.sheet);
    }
  }, [reduce, y, fade]);

  useEffect(() => {
    if (!spec.closing) return;
    const done = () => remove(spec.key);
    if (reduce) {
      fade.value = withTiming(0, { duration: 120 }, (fin) => {
        if (fin) scheduleOnRN(done);
      });
    } else {
      y.value = withSpring(sheetH, { ...springs.sheet, overshootClamping: true }, (fin) => {
        if (fin) scheduleOnRN(done);
      });
    }
  }, [spec.closing, spec.key, reduce, remove, sheetH, y, fade]);

  const requestClose = () => close(spec.key);

  const makePan = () =>
    Gesture.Pan()
    .activeOffsetY([-6, 6])
    .onUpdate((e) => {
      // Rubber-band above the resting position.
      y.value = e.translationY < 0 ? -Math.sqrt(-e.translationY) * 3 : e.translationY;
    })
    .onEnd((e) => {
      if (e.translationY > sheetH * 0.25 || e.velocityY > 900) {
        scheduleOnRN(requestClose);
      } else {
        y.value = withSpring(0, springs.sheet);
      }
    });
  const pan = makePan();

  const scrimStyle = useAnimatedStyle(() => ({
    opacity: interpolate(y.value, [0, sheetH], [1, 0]) * fade.value,
  }));
  const panelStyle = useAnimatedStyle(() => ({
    opacity: fade.value,
    transform: [{ translateY: y.value - (spec.keyboard ? Math.max(0, keyboard.height.value - insets.bottom) : 0) }],
  }));

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none" accessibilityViewIsModal>
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: c.scrim }, scrimStyle]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={requestClose} accessibilityLabel="Dismiss" accessibilityRole="button" />
      </Animated.View>
      <Animated.View
        accessibilityLabel={spec.accessibilityLabel}
        style={[
          {
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            height: sheetH + 40,
            paddingBottom: 40,
            marginBottom: -40,
            backgroundColor: c.surface,
            borderTopLeftRadius: radius.sheet,
            borderTopRightRadius: radius.sheet,
            borderCurve: "continuous",
            borderTopWidth: 1,
            borderColor: c.line,
          },
          panelStyle,
        ]}
      >
        <GestureDetector gesture={pan}>
          <View style={{ height: 22, alignItems: "center", justifyContent: "center" }} accessibilityLabel="Drag to close">
            <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: c.lineStrong }} />
          </View>
        </GestureDetector>
        <SheetDragContext.Provider value={makePan}>
          <View style={{ flex: 1, paddingBottom: insets.bottom }}>{spec.render(requestClose)}</View>
        </SheetDragContext.Provider>
      </Animated.View>
    </View>
  );
}

const SheetDragContext = createContext<(() => ReturnType<typeof Gesture.Pan>) | null>(null);

/** Makes a region of the sheet (e.g. its header) drag the sheet too. */
export function SheetDragArea({ children }: { children: ReactNode }) {
  const makePan = useContext(SheetDragContext);
  if (!makePan) return <>{children}</>;
  const pan = makePan();
  return (
    <GestureDetector gesture={pan}>
      <View>{children}</View>
    </GestureDetector>
  );
}
