import { useEffect } from "react";
import { Platform } from "react-native";
import Constants, { ExecutionEnvironment } from "expo-constants";
import * as Device from "expo-device";
import { router } from "expo-router";
import type * as NotificationsNS from "expo-notifications";
import { supabase } from "../lib/supabase";
import { useAuth } from "../state/auth";
import { useSettings } from "../state/settings";

type NotificationsModule = typeof NotificationsNS;

/**
 * expo-notifications is only loaded where remote push can work: a development/production build,
 * or Expo Go on iOS. Expo Go on Android removed remote push in SDK 53 and logs an error on import.
 */
function easProjectId(): string | undefined {
  return (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId ?? Constants.easConfig?.projectId ?? undefined;
}

function loadNotifications(): NotificationsModule | null {
  // Without an EAS project there is no Expo push token, so there is nothing to register or receive.
  if (!easProjectId()) return null;
  const expoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
  if (expoGo && Platform.OS === "android") return null;
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- deliberately lazy (see above)
  const mod = require("expo-notifications") as NotificationsModule;
  return mod;
}

let configured = false;

/**
 * Registers an Expo push token for signed-in members (requires an EAS projectId and a physical
 * device; see docs/GAPS.md). Taps on notifications deep-link into the app.
 */
export function usePushRegistration(): void {
  const userId = useAuth((s) => s.userId);
  const isGuest = useAuth((s) => s.isGuest);
  const enabled = useSettings((s) => s.notifications);

  useEffect(() => {
    if (!userId || isGuest || !enabled) return;
    const projectId = easProjectId();
    if (!projectId || !Device.isDevice) return;
    const Notifications = loadNotifications();
    if (!Notifications) return;
    let cancelled = false;
    void (async () => {
      const perm = await Notifications.getPermissionsAsync();
      const granted = perm.granted || (await Notifications.requestPermissionsAsync()).granted;
      if (!granted || cancelled) return;
      const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
      await supabase.from("push_tokens").upsert({ user_id: userId, token, platform: Platform.OS === "ios" ? "ios" : "android" }, { onConflict: "user_id,token" });
    })().catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [userId, isGuest, enabled]);

  useEffect(() => {
    const Notifications = loadNotifications();
    if (!Notifications) return;
    if (!configured) {
      configured = true;
      Notifications.setNotificationHandler({
        handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
      });
    }
    const sub = Notifications.addNotificationResponseReceivedListener((res) => {
      const url = (res.notification.request.content.data as { path?: string } | undefined)?.path;
      if (typeof url === "string" && url.startsWith("/")) router.push(url as never);
    });
    return () => sub.remove();
  }, []);
}
