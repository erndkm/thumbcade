/**
 * Gesture spike (§5.6). Throwaway: two WebViews (tap game, swipe game) in a minimal vertical pager.
 * Proves (a) taps reach the WebView with no added latency, (b) the feed pan claims vertical swipes in
 * PREVIEW, (c) the surface pan is off in PLAYING for a vertical game while the Dock still works.
 */
import { useCallback, useRef, useState } from "react";
import { Dimensions, Pressable, Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import WebView from "react-native-webview";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AVATAR_PALETTE } from "@thumbcade/design-tokens";
import { c, type } from "../../src/ui/theme";

const { height: SCREEN_H, width: SCREEN_W } = Dimensions.get("window");
const DOCK_H = 56;

const page = (kind: "tap" | "swipe") => `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<style>html,body{margin:0;height:100%;background:${kind === "tap" ? AVATAR_PALETTE[0]![0] : AVATAR_PALETTE[2]![0]};color:${c.text};font:16px -apple-system;touch-action:none;overscroll-behavior:none;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none}
#c{position:absolute;top:40%;width:100%;text-align:center}</style></head><body><div id="c">${kind.toUpperCase()} GAME</div><script>
var sx=0,sy=0,taps=0,swipes=0,cancels=0;
function post(m){window.ReactNativeWebView.postMessage(JSON.stringify(m));}
addEventListener('touchstart',function(e){var t=e.touches[0];sx=t.clientX;sy=t.clientY;post({t:'down',at:Date.now()});},{passive:false});
addEventListener('touchcancel',function(){cancels++;post({t:'cancel',n:cancels});});
addEventListener('touchend',function(e){var t=e.changedTouches[0];var dx=t.clientX-sx,dy=t.clientY-sy;
 if(Math.abs(dx)<10&&Math.abs(dy)<10){taps++;post({t:'tap',n:taps});}
 else if(Math.abs(dy)>Math.abs(dx)){swipes++;post({t:'swipe',n:swipes,dy:dy});}
});
addEventListener('message',function(e){ if(e.data&&e.data.type==='input.cancel'){cancels++;post({t:'cancel',n:cancels});} });
post({t:'ready'});
</script></body></html>`;

type Log = { downAt: number; taps: number; swipes: number; cancels: number; latency: number | null };

export default function Spike() {
  const insets = useSafeAreaInsets();
  const cardH = SCREEN_H - DOCK_H - insets.bottom;
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<"PREVIEW" | "PLAYING">("PREVIEW");
  const [logs, setLogs] = useState<Log[]>([
    { downAt: 0, taps: 0, swipes: 0, cancels: 0, latency: null },
    { downAt: 0, taps: 0, swipes: 0, cancels: 0, latency: null },
    { downAt: 0, taps: 0, swipes: 0, cancels: 0, latency: null },
  ]);
  const [claims, setClaims] = useState(0);
  const webRefs = useRef<(WebView | null)[]>([null, null, null]);
  const rnDownAt = useRef(0);

  const offset = useSharedValue(0);
  const indexSV = useSharedValue(0);
  const surfaceEnabled = useSharedValue(true);
  const activation = useSharedValue(10);
  const ratio = useSharedValue(1.2);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);

  const vertical = index === 1; // card 1 = swipe game (controls.vertical = true)

  const applyPhase = useCallback(
    (p: "PREVIEW" | "PLAYING", v: boolean) => {
      setPhase(p);
      surfaceEnabled.value = !(p === "PLAYING" && v);
      activation.value = p === "PLAYING" ? 24 : 10;
      ratio.value = p === "PLAYING" ? 2 : 1.2;
    },
    [activation, ratio, surfaceEnabled],
  );

  const onClaim = useCallback(() => {
    setClaims((c) => c + 1);
    webRefs.current[indexSV.value]?.injectJavaScript(
      "window.dispatchEvent(new MessageEvent('message',{data:{type:'input.cancel'}}));true;",
    );
  }, [indexSV]);

  const onCommit = useCallback(
    (next: number) => {
      setIndex(next);
      applyPhase("PREVIEW", next === 1);
    },
    [applyPhase],
  );

  const markDown = useCallback(() => {
    rnDownAt.current = Date.now();
  }, []);

  const settle = (dy: number, vy: number) => {
    "worklet";
    const i = indexSV.value;
    let target = i;
    if ((dy < -0.2 * cardH || vy < -700) && i < 2) target = i + 1;
    else if ((dy > 0.2 * cardH || vy > 700) && i > 0) target = i - 1;
    offset.value = withSpring(-target * cardH, { damping: 26, stiffness: 260 }, () => {
      indexSV.value = target;
    });
    if (target !== i) scheduleOnRN(onCommit, target);
  };

  const native = Gesture.Native();
  const surfacePan = Gesture.Pan()
    .manualActivation(true)
    .onTouchesDown((e) => {
      const t = e.allTouches[0];
      if (!t) return;
      startX.value = t.absoluteX;
      startY.value = t.absoluteY;
      scheduleOnRN(markDown);
    })
    .onTouchesMove((e, sm) => {
      const t = e.allTouches[0];
      if (!t) return;
      if (!surfaceEnabled.value) {
        sm.fail();
        return;
      }
      const dx = t.absoluteX - startX.value;
      const dy = t.absoluteY - startY.value;
      if (Math.abs(dy) >= activation.value && Math.abs(dy) >= ratio.value * Math.abs(dx)) sm.activate();
      else if (Math.abs(dx) >= 16 && Math.abs(dx) > Math.abs(dy)) sm.fail();
    })
    .onStart(() => {
      scheduleOnRN(onClaim);
    })
    .onUpdate((e) => {
      offset.value = -indexSV.value * cardH + e.translationY;
    })
    .onEnd((e) => {
      settle(e.translationY, e.velocityY);
    })
    .simultaneousWithExternalGesture(native);

  const dockPan = Gesture.Pan()
    .activeOffsetY([-6, 6])
    .onStart(() => {
      scheduleOnRN(onClaim);
    })
    .onUpdate((e) => {
      offset.value = -indexSV.value * cardH + e.translationY;
    })
    .onEnd((e) => {
      settle(e.translationY, e.velocityY);
    });

  const pagerStyle = useAnimatedStyle(() => ({ transform: [{ translateY: offset.value }] }));

  const onMessage = (i: number) => (ev: { nativeEvent: { data: string } }) => {
    const m = JSON.parse(ev.nativeEvent.data) as { t: string; n?: number; at?: number };
    setLogs((prev) => {
      const next = [...prev];
      const l = { ...next[i]! };
      if (m.t === "down" && m.at) {
        l.downAt = m.at;
        l.latency = rnDownAt.current ? m.at - rnDownAt.current : null;
      }
      if (m.t === "tap") l.taps = m.n ?? l.taps;
      if (m.t === "swipe") l.swipes = m.n ?? l.swipes;
      if (m.t === "cancel") l.cancels = m.n ?? l.cancels;
      next[i] = l;
      return next;
    });
    if (m.t === "tap" && i === index && phase === "PREVIEW") applyPhase("PLAYING", i === 1);
  };

  const cur = logs[index]!;
  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <View style={{ height: cardH, overflow: "hidden" }}>
        <GestureDetector gesture={surfacePan}>
          <Animated.View style={[{ height: cardH * 3 }, pagerStyle]}>
            {[0, 1, 2].map((i) => (
              <View key={i} style={{ height: cardH, width: SCREEN_W }}>
                <GestureDetector gesture={native}>
                  <WebView
                    ref={(r) => {
                      webRefs.current[i] = r;
                    }}
                    source={{ html: page(i === 1 ? "swipe" : "tap") }}
                    originWhitelist={["*"]}
                    onMessage={onMessage(i)}
                    scrollEnabled={false}
                    bounces={false}
                    overScrollMode="never"
                    style={{ backgroundColor: c.bg }}
                  />
                </GestureDetector>
              </View>
            ))}
          </Animated.View>
        </GestureDetector>
        <View pointerEvents="none" style={{ position: "absolute", top: insets.top + 8, left: 12 }}>
          <Text testID="spike-status" style={[type("mono"), { color: c.accentText }]}>
            {`index ${index} phase ${phase} vertical ${vertical}`}
          </Text>
          <Text testID="spike-counters" style={[type("mono"), { color: c.text }]}>
            {`taps ${cur.taps} swipes ${cur.swipes} cancels ${cur.cancels} claims ${claims}`}
          </Text>
          <Text testID="spike-latency" style={[type("mono"), { color: c.textDim }]}>
            {`latency ${cur.latency === null ? "-" : cur.latency + "ms"}`}
          </Text>
        </View>
      </View>
      <GestureDetector gesture={dockPan}>
        <View
          testID="spike-dock"
          style={{ height: DOCK_H, marginBottom: insets.bottom, alignItems: "center", justifyContent: "center", backgroundColor: c.surface }}
        >
          <View style={{ width: 44, height: 5, borderRadius: 3, backgroundColor: phase === "PLAYING" ? c.accent : c.lineStrong }} />
          <Pressable onPress={() => applyPhase("PREVIEW", vertical)} style={{ position: "absolute", right: 12, padding: 12 }}>
            <Text style={[type("mono"), { color: c.text }]}>reset</Text>
          </Pressable>
        </View>
      </GestureDetector>
    </View>
  );
}
