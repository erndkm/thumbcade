import { useState } from "react";
import { ScrollView, View } from "react-native";
import { router } from "expo-router";
import { CameraView, useCameraPermissions } from "expo-camera";
import { supabase } from "../../src/lib/supabase";
import { invalidateMe } from "../../src/hooks/useMe";
import { queryClient } from "../../src/lib/query";
import { useDevCards } from "../../src/state/devCards";
import { useDevLog } from "../../src/state/devlog";
import { useSettings } from "../../src/state/settings";
import { toast } from "../../src/state/toast";
import { openDevGame, parseDevTarget } from "../../src/features/dev/devGame";
import { Button } from "../../src/ui/Button";
import { Field } from "../../src/ui/Field";
import { Header, Screen, SectionTitle } from "../../src/ui/Screen";
import { SheetRow } from "../../src/ui/SheetRow";
import { T } from "../../src/ui/Text";
import { c, layout, radius, space } from "../../src/ui/theme";

/** Hidden developer menu: open a game from a LAN URL or a `thumbcade dev --device` QR code. */
export default function DevMenu() {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [perm, requestPerm] = useCameraPermissions();
  const lines = useDevLog((s) => s.lines);
  const clearLog = useDevLog((s) => s.clear);
  const devCards = useDevCards((s) => s.cards);
  const clearCards = useDevCards((s) => s.clear);
  const set = useSettings((s) => s.set);

  const open = async (raw: string) => {
    const target = parseDevTarget(raw);
    if (!target) {
      toast("Enter an http(s) URL, e.g. http://192.168.1.20:5173/", "bad");
      return;
    }
    setBusy(true);
    await openDevGame(target);
    setBusy(false);
  };

  return (
    <Screen>
      <Header back title="Developer" />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: space[16] }}>
        <View style={{ paddingHorizontal: layout.gutter, gap: space[3] }}>
          <T variant="body" color="textDim">
            Run `thumbcade dev --device` on your machine, then open the URL it prints. Dev cards show a DEV badge and a live bridge log.
          </T>
          <Field label="Game URL" testID="dev-url" value={url} onChangeText={setUrl} placeholder="http://192.168.1.20:5173/" autoCapitalize="none" autoCorrect={false} keyboardType="url" />
          <View style={{ flexDirection: "row", gap: space[2] }}>
            <Button label="Open in feed" onPress={() => void open(url)} busy={busy} style={{ flex: 1 }} />
            <Button
              label={scanning ? "Stop" : "Scan QR"}
              kind="secondary"
              onPress={async () => {
                if (scanning) return setScanning(false);
                if (!perm?.granted && !(await requestPerm()).granted) return toast("Camera access is needed to scan.", "bad");
                setScanning(true);
              }}
            />
          </View>
          {scanning ? (
            <View style={{ height: 260, borderRadius: radius.sheetInner, overflow: "hidden", borderWidth: 1, borderColor: c.line }}>
              <CameraView
                style={{ flex: 1 }}
                barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
                onBarcodeScanned={({ data }) => {
                  setScanning(false);
                  setUrl(data);
                  void open(data);
                }}
              />
            </View>
          ) : null}
          {devCards.length ? <Button label={`Remove ${devCards.length} dev card${devCards.length > 1 ? "s" : ""}`} kind="ghost" small onPress={clearCards} /> : null}
        </View>

        <SectionTitle right={lines.length ? <T variant="monoLabel" color="textDim" onPress={clearLog}>Clear</T> : undefined}>Contract violations</SectionTitle>
        <View style={{ marginHorizontal: layout.gutter, padding: space[3], borderRadius: radius.input, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, minHeight: 64 }}>
          <T variant="mono" color={lines.length ? "text" : "textDim"} style={{ fontSize: 11, lineHeight: 15 }}>
            {lines.length ? lines.slice(-40).join("\n") : "None so far. Dev cards report violations here as they happen."}
          </T>
        </View>

        <SectionTitle>Tools</SectionTitle>
        <SheetRow icon="swipeUp" label="Gesture lab" hint="The §5.6 spike: tap and swipe WebViews" onPress={() => router.push("/dev/spike")} />
        <SheetRow
          icon="replay"
          label="Replay onboarding"
          onPress={() => {
            set({ onboarded: false });
            router.replace("/onboarding");
          }}
        />
        <SheetRow icon="swipeUp" label="Reset the Dock coach" onPress={() => (set({ dockCoachShown: 0 }), toast("Coach will play again.", "good"))} />
        {__DEV__ ? (
          <SheetRow
            icon="profile"
            label="Sign in as the demo member"
            hint="demo@thumbcade.dev (seeded locally)"
            testID="dev-demo-signin"
            onPress={async () => {
              const { error } = await supabase.auth.signInWithPassword({ email: "demo@thumbcade.dev", password: "thumbcade-demo" });
              if (error) return toast("Demo sign-in failed. Did you run pnpm seed?", "bad");
              queryClient.clear();
              await invalidateMe();
              toast("Signed in as @demo.player", "good");
              router.replace("/");
            }}
          />
        ) : null}
        <SheetRow icon="close" label="Lock the developer menu" danger onPress={() => (set({ devMenu: false }), router.back())} />
      </ScrollView>
    </Screen>
  );
}
