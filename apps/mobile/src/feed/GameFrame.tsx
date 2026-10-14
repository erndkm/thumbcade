import { memo, useEffect, useMemo, useRef } from "react";
import { Platform, StyleSheet } from "react-native";
import { GestureDetector, type NativeGesture } from "react-native-gesture-handler";
import WebView, { type WebViewMessageEvent } from "react-native-webview";
import type { ShouldStartLoadRequest } from "react-native-webview/lib/WebViewTypes";
import { rewriteLocalUrl } from "../lib/env";
import { c } from "../ui/theme";
import type { CardController } from "./controller";

export interface GameFrameProps {
  controller: CardController;
  native: NativeGesture;
  loadKey: number;
}

/**
 * Whether a WebView message came from the game's origin. iOS reports the page URL; Android's
 * WebMessageListener reports the bare origin. A plain prefix check would also accept a lookalike host
 * (https://slug.thumbcade.gg.evil.example).
 */
export function isFromOrigin(url: string, origin: string): boolean {
  return url === origin || url.startsWith(`${origin}/`);
}

/** Strips any trailing path segment: https://x/slug/v1/index.html -> https://x/slug/v1/ */
export function versionBaseOf(entryUrl: string): string {
  return entryUrl.slice(0, entryUrl.lastIndexOf("/") + 1);
}

/**
 * The game's WebView. Locked to the game's origin and version path, no windows, no file access, no
 * shared cookies, no scrolling/bouncing. Every message is origin-checked here and validated with zod
 * in the controller.
 */
export const GameFrame = memo(function GameFrame({ controller, native, loadKey }: GameFrameProps) {
  const ref = useRef<WebView>(null);
  const entryUrl = useMemo(() => rewriteLocalUrl(controller.card.version.entryUrl), [controller]);
  const origin = useMemo(() => rewriteLocalUrl(controller.card.version.origin).replace(/\/$/, ""), [controller]);
  const base = useMemo(() => versionBaseOf(entryUrl), [entryUrl]);

  useEffect(() => {
    controller.attach((js) => ref.current?.injectJavaScript(js));
    return () => controller.detach();
  }, [controller, loadKey]);

  const allowNavigation = (req: ShouldStartLoadRequest) => req.url.startsWith(base) || req.url === "about:blank";

  const onMessage = (e: WebViewMessageEvent) => {
    if (!isFromOrigin(e.nativeEvent.url, origin)) return;
    controller.onMessage(e.nativeEvent.data);
  };

  return (
    <GestureDetector gesture={native}>
      <WebView
        // A replaced controller never saw this page's hello/ready, so it needs its own page load.
        key={`${controller.instance}:${loadKey}`}
        ref={ref}
        source={{ uri: entryUrl }}
        style={styles.web}
        containerStyle={styles.web}
        originWhitelist={[origin]}
        onShouldStartLoadWithRequest={allowNavigation}
        onLoadStart={() => controller.loadStarted()}
        onMessage={onMessage}
        onError={() => controller.failLoad("network")}
        onHttpError={(e) => {
          if (e.nativeEvent.url === entryUrl || e.nativeEvent.statusCode >= 500) controller.failLoad(`http ${e.nativeEvent.statusCode}`);
        }}
        onContentProcessDidTerminate={() => controller.failLoad("content process terminated")}
        onRenderProcessGone={() => controller.failLoad("render process gone")}
        javaScriptEnabled
        domStorageEnabled
        scrollEnabled={false}
        bounces={false}
        overScrollMode="never"
        pullToRefreshEnabled={false}
        showsHorizontalScrollIndicator={false}
        showsVerticalScrollIndicator={false}
        automaticallyAdjustContentInsets={false}
        contentInsetAdjustmentBehavior="never"
        setSupportMultipleWindows={false}
        javaScriptCanOpenWindowsAutomatically={false}
        allowFileAccess={false}
        allowFileAccessFromFileURLs={false}
        allowUniversalAccessFromFileURLs={false}
        sharedCookiesEnabled={false}
        thirdPartyCookiesEnabled={false}
        geolocationEnabled={false}
        mixedContentMode="never"
        allowsBackForwardNavigationGestures={false}
        allowsLinkPreview={false}
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        allowsFullscreenVideo={false}
        {...IOS_ONLY}
        setBuiltInZoomControls={false}
        setDisplayZoomControls={false}
        cacheEnabled
        webviewDebuggingEnabled={__DEV__}
        androidLayerType="hardware"
        accessibilityLabel={`${controller.card.game.name}, game`}
      />
    </GestureDetector>
  );
});

const styles = StyleSheet.create({ web: { flex: 1, backgroundColor: c.bg } });

/**
 * iOS-only WebView props. On Android (Fabric) the RNCWebView props parser crashes on
 * `dataDetectorTypes` (SIGSEGV in convertRawProp), so these are never passed there.
 */
const IOS_ONLY =
  Platform.OS === "ios"
    ? ({ dataDetectorTypes: "none", textInteractionEnabled: false, keyboardDisplayRequiresUserAction: true } as const)
    : {};
