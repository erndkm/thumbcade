/**
 * The feed pager: a custom Reanimated vertical pager with a fixed pool of three card slots
 * (previous, current, next). Slot k always hosts the card whose index ≡ k (mod 3), so moving forward
 * recycles the slot furthest behind for the new "next". Each slot hosts at most one WebView.
 *
 * Arbitration (Swipe Contract §5) runs on the UI thread: the surface pan, the two-finger pan and the
 * Dock pan read their activation rules from shared values derived from the active card's state via
 * `gestureConfigFor()`. The WebView receives every touch immediately (Gesture.Native, simultaneous);
 * the feed claims retroactively and the machine sends `input.cancel` + `pause`.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { AppState, BackHandler, View } from "react-native";
import { Gesture, GestureDetector, type GestureType } from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming, type SharedValue } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { Image } from "expo-image";
import type { FeedCard } from "@thumbcade/protocol";
import { SNAP_SPRING, claims, gestureConfigFor, resolveRelease, type CardPhase, type PanRule } from "@thumbcade/swipe-contract";
import { haptic } from "../lib/haptics";
import { localUrl, rewriteLocalUrl } from "../lib/env";
import { useReduceMotion } from "../hooks/useMotion";
import { useSheets } from "../state/sheets";
import { useSettings } from "../state/settings";
import { c } from "../ui/theme";
import type { CardController } from "./controller";
import { CardView } from "./CardView";

export interface PagerRules {
  surface: PanRule;
  dock: PanRule;
  two: PanRule;
}

const OFF: PanRule = { enabled: false, activationDistance: 1e9, directionRatio: 1e9 };

export interface PagerApi {
  index: number;
  active: CardController | null;
  activeCard: FeedCard | null;
  phase: CardPhase;
}

export interface PagerProps {
  cards: FeedCard[];
  width: number;
  height: number;
  safeTop: number;
  /** This pager owns the WebView budget (focused screen). */
  live: boolean;
  /** Screen is focused and the app is foregrounded. */
  focused: boolean;
  makeController: (card: FeedCard) => CardController;
  isDev?: (card: FeedCard) => boolean;
  onIndexChange?: (index: number) => void;
  onNearEnd?: () => void;
  /** Rendered over the cards (top tabs etc). */
  overlay?: (api: PagerApi) => ReactNode;
  /** Rendered at the bottom (tab bar / Dock). Receives the Dock pan. */
  bottomBar: (api: PagerApi & { dockGesture: GestureType }) => ReactNode;
  initialIndex?: number;
}

function slotIndexFor(k: number, index: number, count: number): number {
  for (const i of [index - 1, index, index + 1]) {
    if (i >= 0 && i < count && ((i % 3) + 3) % 3 === k) return i;
  }
  return -1;
}

export function Pager(props: PagerProps) {
  const { cards, width, height, safeTop, live, focused, makeController, isDev, onIndexChange, onNearEnd, overlay, bottomBar } = props;
  const reduce = useReduceMotion();
  const [index, setIndex] = useState(props.initialIndex ?? 0);
  const indexRef = useRef(index);
  const scrollY = useSharedValue(index * height);
  const indexSV = useSharedValue(index);
  const countSV = useSharedValue(cards.length);
  const heightSV = useSharedValue(height);
  const reduceSV = useSharedValue(reduce);
  const rules = useSharedValue<PagerRules>({ surface: OFF, dock: OFF, two: OFF });
  const start = useSharedValue({ x: 0, y: 0 });
  const twoStart = useSharedValue({ y: 0 });
  const dockStartSV = useSharedValue({ x: 0, y: 0 });
  const [evicted, setEvicted] = useState<Set<string>>(() => new Set());
  const [nextAllowed, setNextAllowed] = useState(false);

  useEffect(() => {
    countSV.value = cards.length;
  }, [cards.length, countSV]);
  useEffect(() => {
    heightSV.value = height;
    scrollY.value = indexRef.current * height;
  }, [height, heightSV, scrollY]);
  useEffect(() => {
    reduceSV.value = reduce;
  }, [reduce, reduceSV]);

  // ------------------------------------------------------------------------------------------
  // Controllers for the cards in the window [index-1, index+1].
  const controllers = useRef(new Map<string, CardController>());
  const windowCards = useMemo(() => {
    const out: FeedCard[] = [];
    for (const i of [index - 1, index, index + 1]) {
      const card = cards[i];
      if (card) out.push(card);
    }
    return out;
  }, [cards, index]);

  const [, force] = useState(0);
  // An evicted card (memory warning) reloads as soon as it becomes current or next again.
  useEffect(() => {
    const back = [cards[index]?.cardId, cards[index + 1]?.cardId].filter((id): id is string => !!id && evicted.has(id));
    if (back.length === 0) return;
    setEvicted((prev) => {
      const next = new Set(prev);
      for (const id of back) next.delete(id);
      return next;
    });
  }, [index, cards, evicted]);
  useEffect(() => {
    const keep = new Set(windowCards.map((c) => c.cardId));
    let changed = false;
    for (const [id, ctl] of controllers.current) {
      if (!keep.has(id) || !live || evicted.has(id)) {
        ctl.dispose();
        controllers.current.delete(id);
        changed = true;
      }
    }
    if (live) {
      for (const card of windowCards) {
        if (!controllers.current.has(card.cardId) && !evicted.has(card.cardId)) {
          controllers.current.set(card.cardId, makeController(card));
          changed = true;
        }
      }
    }
    if (changed) force((n) => n + 1);
  }, [windowCards, live, makeController, evicted]);

  useEffect(
    () => () => {
      for (const ctl of controllers.current.values()) ctl.dispose();
      controllers.current.clear();
    },
    [],
  );

  const current = cards[index] ?? null;
  const active = current ? (controllers.current.get(current.cardId) ?? null) : null;
  const activeSnap = useSyncExternalStore(active?.subscribe ?? noop, active?.getSnapshot ?? nullSnap);
  const activePhase: CardPhase = activeSnap?.phase ?? "LOADING";

  // Preload the next card's WebView as soon as the current one is ready (or after a grace period).
  useEffect(() => {
    if (activeSnap?.ready) setNextAllowed(true);
  }, [activeSnap?.ready]);
  useEffect(() => {
    const t = setTimeout(() => setNextAllowed(true), 1500);
    return () => clearTimeout(t);
  }, []);

  // ------------------------------------------------------------------------------------------
  // Activation: exactly one active card, only while focused.
  const activeIdRef = useRef<string | null>(null);
  // Tracked by instance, not card id: a card can get a fresh controller (reload of the pool, Fast Refresh),
  // and that one must be activated too.
  const activeCtlRef = useRef<CardController | null>(null);
  useEffect(() => {
    const want = focused && active ? active : null;
    const prev = activeCtlRef.current;
    if (prev && prev !== want) {
      prev.deactivate();
      activeCtlRef.current = null;
      activeIdRef.current = null;
    }
    if (want && activeCtlRef.current !== want) {
      want.activate();
      activeCtlRef.current = want;
      activeIdRef.current = want.card.cardId;
    }
  }, [focused, active]);

  // Hidden screens don't paint: pause load budgets while the feed is covered.
  useEffect(() => {
    for (const ctl of controllers.current.values()) ctl.setHostVisible(focused);
  });

  // Gesture rules for the active card -> UI thread.
  useEffect(() => {
    const controls = current?.game.controls ?? { vertical: false, multitouch: false };
    const cfg = gestureConfigFor(activePhase, controls);
    rules.value = { surface: cfg.surfacePan, dock: cfg.dockPan, two: cfg.twoFingerPan };
  }, [activePhase, current, rules]);

  // Background / sheets / Android back.
  const sheetOpen = useSheets((s) => s.stack.length > 0);
  useEffect(() => {
    if (!active) return;
    if (sheetOpen) active.dispatch({ type: "SUSPEND", reason: "sheet" });
    else active.dispatch({ type: "UNSUSPEND", reason: "sheet" });
  }, [sheetOpen, active]);
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => {
      const ctl = activeIdRef.current ? controllers.current.get(activeIdRef.current) : null;
      if (!ctl) return;
      if (s === "active") ctl.dispatch({ type: "UNSUSPEND", reason: "background" });
      else ctl.dispatch({ type: "SUSPEND", reason: "background" });
    });
    const mem = AppState.addEventListener("memoryWarning", () => {
      // Destroy the "previous" slot's WebView.
      const prev = cards[indexRef.current - 1];
      if (prev) setEvicted((s) => new Set(s).add(prev.cardId));
    });
    return () => {
      sub.remove();
      mem.remove();
    };
  }, [cards]);
  useEffect(() => {
    if (!focused) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (active && active.machine.phase === "PLAYING") {
        active.dispatch({ type: "PAUSE", reason: "back" });
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [focused, active]);

  // Mute changes reach every live game.
  const soundOn = useSettings((s) => s.soundOn);
  const firstSound = useRef(true);
  useEffect(() => {
    if (firstSound.current) {
      firstSound.current = false;
      return;
    }
    for (const ctl of controllers.current.values()) ctl.setMuted(!soundOn);
  }, [soundOn]);

  // ------------------------------------------------------------------------------------------
  // Prefetch posters for the next 5 cards and warm the next 3 entry files.
  const warmed = useRef(new Set<string>());
  useEffect(() => {
    const posters = cards
      .slice(index + 1, index + 6)
      .map((c) => c.game.posterUrl)
      .filter((u): u is string => !!u)
      .map((u) => localUrl(u));
    if (posters.length) void Image.prefetch(posters, "memory-disk");
    for (const c of cards.slice(index + 1, index + 4)) {
      const url = rewriteLocalUrl(c.version.entryUrl);
      if (warmed.current.has(url)) continue;
      warmed.current.add(url);
      fetch(url, { method: "GET" }).catch(() => warmed.current.delete(url));
    }
    if (cards.length - index <= 3) onNearEnd?.();
  }, [index, cards, onNearEnd]);

  // ------------------------------------------------------------------------------------------
  // Gesture callbacks (JS).
  const onGestureBegin = useCallback(() => {
    const ctl = activeIdRef.current ? controllers.current.get(activeIdRef.current) : null;
    ctl?.dispatch({ type: "FEED_GESTURE_BEGIN" });
  }, []);

  const onRelease = useCallback(
    (target: number) => {
      const from = indexRef.current;
      const ctl = activeIdRef.current ? controllers.current.get(activeIdRef.current) : null;
      if (target === from) {
        ctl?.dispatch({ type: "FEED_GESTURE_END", committed: false });
        return;
      }
      haptic.snap();
      ctl?.dispatch({ type: "FEED_GESTURE_END", committed: true });
      ctl?.deactivate();
      activeCtlRef.current = null;
      activeIdRef.current = null;
      indexRef.current = target;
      setIndex(target);
      onIndexChange?.(target);
    },
    [onIndexChange],
  );

  const markActivity = useCallback(() => {
    const ctl = activeIdRef.current ? controllers.current.get(activeIdRef.current) : null;
    ctl?.markActivity();
  }, []);

  /** Programmatic navigation (e.g. after a list refresh). */
  useEffect(() => {
    if (props.initialIndex !== undefined && props.initialIndex !== indexRef.current) {
      indexRef.current = props.initialIndex;
      setIndex(props.initialIndex);
      indexSV.value = props.initialIndex;
      scrollY.value = props.initialIndex * height;
    }
    // Only when the requested index changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.initialIndex]);

  // ------------------------------------------------------------------------------------------
  // Gestures (UI thread).
  const natives = useMemo(() => [Gesture.Native(), Gesture.Native(), Gesture.Native()], []);

  const gestures = useMemo(() => {
    const follow = (dy: number) => {
      "worklet";
      const i = indexSV.value;
      const H = heightSV.value;
      const last = countSV.value - 1;
      let y = i * H - dy;
      if (y < 0) y = -Math.sqrt(-y) * 6;
      else if (y > last * H) y = last * H + Math.sqrt(y - last * H) * 6;
      scrollY.value = y;
    };
    const release = (dy: number, vy: number) => {
      "worklet";
      const i = indexSV.value;
      const H = heightSV.value;
      const decision = resolveRelease(dy, vy, H, { canNext: i < countSV.value - 1, canPrev: i > 0 });
      const target = decision === "next" ? i + 1 : decision === "prev" ? i - 1 : i;
      indexSV.value = target;
      scrollY.value = reduceSV.value
        ? withTiming(target * H, { duration: 120 })
        : withSpring(target * H, { ...SNAP_SPRING, velocity: -vy });
      scheduleOnRN(onRelease, target);
    };

    const surface = Gesture.Pan()
      .manualActivation(true)
      .onTouchesDown((e) => {
        const t = e.allTouches[0];
        if (t) start.value = { x: t.absoluteX, y: t.absoluteY };
        scheduleOnRN(markActivity);
      })
      .onTouchesMove((e, sm) => {
        const rule = rules.value.surface;
        const t = e.allTouches[0];
        if (!t || e.numberOfTouches > 1 || !rule.enabled) {
          sm.fail();
          return;
        }
        const dx = t.absoluteX - start.value.x;
        const dy = t.absoluteY - start.value.y;
        if (claims(rule, dx, dy)) sm.activate();
        else if (Math.abs(dx) >= 16 && Math.abs(dx) > Math.abs(dy)) sm.fail();
      })
      .onStart(() => {
        scheduleOnRN(onGestureBegin);
      })
      .onUpdate((e) => follow(e.translationY))
      .onEnd((e) => release(e.translationY, e.velocityY))
      .simultaneousWithExternalGesture(...natives);

    const two = Gesture.Pan()
      .minPointers(2)
      .maxPointers(2)
      .manualActivation(true)
      .onTouchesDown((e) => {
        if (e.numberOfTouches === 2) {
          const a = e.allTouches[0]!;
          const b = e.allTouches[1]!;
          twoStart.value = { y: (a.absoluteY + b.absoluteY) / 2 };
        }
      })
      .onTouchesMove((e, sm) => {
        const rule = rules.value.two;
        if (!rule.enabled) {
          sm.fail();
          return;
        }
        if (e.numberOfTouches !== 2) return;
        const a = e.allTouches[0]!;
        const b = e.allTouches[1]!;
        const dy = (a.absoluteY + b.absoluteY) / 2 - twoStart.value.y;
        if (claims(rule, 0, dy)) sm.activate();
      })
      .onStart(() => {
        scheduleOnRN(onGestureBegin);
      })
      .onUpdate((e) => follow(e.translationY))
      .onEnd((e) => release(e.translationY, e.velocityY))
      .simultaneousWithExternalGesture(...natives);

    const dock = Gesture.Pan()
      .manualActivation(true)
      .onTouchesDown((e) => {
        const t = e.allTouches[0];
        if (t) dockStartSV.value = { x: t.absoluteX, y: t.absoluteY };
      })
      .onTouchesMove((e, sm) => {
        const t = e.allTouches[0];
        if (!t) return;
        const rule = rules.value.dock;
        const dx = t.absoluteX - dockStartSV.value.x;
        const dy = t.absoluteY - dockStartSV.value.y;
        if (claims(rule, dx, dy)) sm.activate();
        else if (Math.abs(dx) >= 24 && Math.abs(dx) > Math.abs(dy) * 2) sm.fail();
      })
      .onStart(() => {
        scheduleOnRN(onGestureBegin);
      })
      .onUpdate((e) => follow(e.translationY))
      .onEnd((e) => release(e.translationY, e.velocityY));

    return { surface: Gesture.Simultaneous(surface, two), dock };
  }, [natives, indexSV, heightSV, countSV, scrollY, reduceSV, rules, start, twoStart, dockStartSV, onRelease, onGestureBegin, markActivity]);

  // Keep indexSV in sync with programmatic changes.
  useEffect(() => {
    indexSV.value = index;
  }, [index, indexSV]);

  const api: PagerApi = { index, active, activeCard: current, phase: activePhase };

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <View style={{ height, overflow: "hidden" }}>
        <GestureDetector gesture={gestures.surface}>
          <View style={{ flex: 1 }}>
            {[0, 1, 2].map((k) => {
              const i = slotIndexFor(k, index, cards.length);
              const card = i >= 0 ? cards[i] : undefined;
              const ctl = card ? (controllers.current.get(card.cardId) ?? null) : null;
              const isNext = i === index + 1;
              return (
                <Slot key={k} feedIndex={i} scrollY={scrollY} height={height} width={width}>
                  {card ? (
                    <CardView
                      key={card.cardId}
                      card={card}
                      controller={ctl}
                      native={natives[k]!}
                      live={live && (!isNext || nextAllowed)}
                      active={i === index && focused}
                      width={width}
                      height={height}
                      safeTop={safeTop}
                      dev={isDev?.(card) ?? false}
                    />
                  ) : null}
                </Slot>
              );
            })}
          </View>
        </GestureDetector>
        {overlay?.(api)}
      </View>
      {bottomBar({ ...api, dockGesture: gestures.dock })}
    </View>
  );
}

function Slot({ feedIndex, scrollY, height, width, children }: { feedIndex: number; scrollY: SharedValue<number>; height: number; width: number; children: ReactNode }) {
  const pos = useSharedValue(feedIndex);
  useEffect(() => {
    pos.value = feedIndex;
  }, [feedIndex, pos]);
  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: pos.value < 0 ? -10 * height : pos.value * height - scrollY.value }],
  }));
  return <Animated.View style={[{ position: "absolute", left: 0, top: 0, width, height }, style]}>{children}</Animated.View>;
}

const noop = () => () => {};
const nullSnap = () => null;
