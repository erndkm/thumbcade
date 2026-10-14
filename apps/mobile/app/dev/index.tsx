import { useEffect } from "react";
import { View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { openDevGame, parseDevTarget } from "../../src/features/dev/devGame";
import { useSettings } from "../../src/state/settings";
import { toast } from "../../src/state/toast";
import { c } from "../../src/ui/theme";

/** thumbcade://dev?url=… (QR from `thumbcade dev --device`). Only honoured with the developer menu unlocked. */
export default function DevOpen() {
  const { url } = useLocalSearchParams<{ url?: string }>();
  const allowed = useSettings((s) => s.devMenu) || __DEV__;
  useEffect(() => {
    const target = url ? parseDevTarget(url) : null;
    if (!allowed || !target) {
      toast(allowed ? "That dev link has no game URL." : "Unlock the developer menu first (Settings → tap the version 7 times).", "bad");
      router.replace("/");
      return;
    }
    void openDevGame(target);
  }, [url, allowed]);
  return <View style={{ flex: 1, backgroundColor: c.bg }} />;
}
