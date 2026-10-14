import { useCallback, useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { Stack, router, usePathname } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import Constants, { ExecutionEnvironment } from "expo-constants";
import { StatusBar } from "expo-status-bar";
import { useFonts } from "expo-font";
import * as SystemUI from "expo-system-ui";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { QueryClientProvider } from "@tanstack/react-query";
import WebView from "react-native-webview";
import { nativeFonts } from "@thumbcade/design-tokens/native-fonts";
import { queryClient } from "../src/lib/query";
import { startEventPump } from "../src/lib/events";
import { bootstrapAuth } from "../src/state/auth";
import { useSettings } from "../src/state/settings";
import { useWarmWebView } from "../src/state/webviews";
import { useNotificationsRealtime } from "../src/hooks/useUnread";
import { usePushRegistration } from "../src/hooks/usePush";
import { SheetHost } from "../src/ui/Sheet";
import { ToastHost } from "../src/ui/Toast";
import { AnimatedSplash } from "../src/ui/AnimatedSplash";
import { c } from "../src/ui/theme";
import { setPendingHref } from "../src/state/pendingLink";

void SplashScreen.preventAutoHideAsync();
// The animated splash takes over seamlessly; Expo Go does not support splash options.
if (Constants.executionEnvironment !== ExecutionEnvironment.StoreClient) SplashScreen.setOptions({ fade: false, duration: 0 });
void SystemUI.setBackgroundColorAsync(c.bg);

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts(nativeFonts);
  const [splash, setSplash] = useState(true);
  const warm = useWarmWebView((s) => s.warm);

  useEffect(() => {
    void bootstrapAuth();
    startEventPump();
  }, []);

  const ready = fontsLoaded || !!fontError;
  useEffect(() => {
    if (ready) void SplashScreen.hideAsync();
  }, [ready]);

  const onSplashDone = useCallback(() => setSplash(false), []);

  if (!ready) return null;
  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <StatusBar style="light" />
          <Root />
          {warm ? (
            <View pointerEvents="none" style={styles.warm}>
              <WebView source={{ html: "<html><body></body></html>" }} originWhitelist={["about:*"]} javaScriptEnabled={false} />
            </View>
          ) : null}
          <SheetHost />
          <ToastHost />
          {splash ? <AnimatedSplash onDone={onSplashDone} /> : null}
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function Root() {
  useNotificationsRealtime();
  usePushRegistration();
  const onboarded = useSettings((s) => s.onboarded);
  const pathname = usePathname();
  useEffect(() => {
    if (onboarded || pathname.startsWith("/onboarding")) return;
    if (pathname !== "/" && !pathname.startsWith("/dev")) setPendingHref(pathname);
    router.replace("/onboarding");
  }, [onboarded, pathname]);
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.bg }, animation: "slide_from_right" }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="onboarding" options={{ animation: "fade" }} />
      <Stack.Screen name="play" options={{ animation: "slide_from_bottom" }} />
      <Stack.Screen name="game/[slug]" options={{ animation: "fade" }} />
    </Stack>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: c.bg },
  warm: { position: "absolute", width: 1, height: 1, opacity: 0, left: -10, top: -10 },
});
