import { useRef, useState } from "react";
import { Linking, ScrollView, View } from "react-native";
import { router } from "expo-router";
import Constants from "expo-constants";
import { env } from "../../src/lib/env";
import { AGE_BAND_LABEL } from "../../src/lib/age";
import { useMe } from "../../src/hooks/useMe";
import { useAuth } from "../../src/state/auth";
import { useSettings } from "../../src/state/settings";
import { openSheet } from "../../src/state/sheets";
import { toast } from "../../src/state/toast";
import { openAuthSheet } from "../../src/features/auth/openAuthSheet";
import { deleteMyAccount, signOutToGuest } from "../../src/features/account/accountActions";
import { exportMyData } from "../../src/features/account/exportData";
import { Avatar } from "../../src/ui/Avatar";
import { Button } from "../../src/ui/Button";
import { Field } from "../../src/ui/Field";
import { Press } from "../../src/ui/Press";
import { Header, Screen, SectionTitle } from "../../src/ui/Screen";
import { SheetDragArea } from "../../src/ui/Sheet";
import { SheetRow, SheetTitle } from "../../src/ui/SheetRow";
import { T } from "../../src/ui/Text";
import { ToggleRow } from "../../src/ui/Toggle";
import { layout, space } from "../../src/ui/theme";

export default function Settings() {
  const me = useMe();
  const isGuest = useAuth((s) => s.isGuest);
  const s = useSettings();
  const taps = useRef(0);
  const [exporting, setExporting] = useState(false);
  const devVisible = s.devMenu || me.data?.role === "creator" || me.data?.role === "admin";
  const version = `${Constants.expoConfig?.version ?? "1.0.0"}`;

  const tapVersion = () => {
    if (s.devMenu) return;
    taps.current += 1;
    if (taps.current >= 7) {
      s.set({ devMenu: true });
      toast("Developer menu unlocked. Handle with care.", "good");
    } else if (taps.current >= 4) {
      toast(`${7 - taps.current} more…`);
    }
  };

  return (
    <Screen testID="settings">
      <Header back title="Settings" />
      <ScrollView contentContainerStyle={{ paddingBottom: space[16] }}>
        <SectionTitle>Account</SectionTitle>
        {me.data ? (
          <Press onPress={() => (isGuest ? openAuthSheet() : router.push("/settings/account"))} scaleTo={0.99} accessibilityLabel={isGuest ? "Sign up" : "Edit profile"} style={{ flexDirection: "row", alignItems: "center", gap: space[3], paddingHorizontal: layout.gutter, paddingVertical: space[2] }}>
            <Avatar seed={me.data.avatar_seed} url={me.data.avatar_url} size={48} />
            <View style={{ flex: 1 }}>
              <T variant="bodyStrong">{isGuest ? "Guest" : me.data.display_name}</T>
              <T variant="mono" color="textDim">
                @{me.data.handle}
                {me.data.age_band ? ` · ${AGE_BAND_LABEL[me.data.age_band]}` : ""}
              </T>
            </View>
            <T variant="bodyStrong" color={isGuest ? "accentText" : "textDim"}>
              {isGuest ? "Sign up" : "Edit"}
            </T>
          </Press>
        ) : null}

        <SectionTitle>Play</SectionTitle>
        <ToggleRow testID="toggle-sound" label="Sound" hint="Games start muted in previews until you turn this on" value={s.soundOn} onChange={(v) => s.set({ soundOn: v })} />
        <ToggleRow testID="toggle-motion" label="Reduce motion" hint="Swaps springs and wipes for quick fades. Games are told too" value={s.reduceMotion} onChange={(v) => s.set({ reduceMotion: v })} />
        <ToggleRow label="Notifications" hint="Follows, replies and when someone beats your score" value={s.notifications} onChange={(v) => s.set({ notifications: v })} />

        <SectionTitle>Safety</SectionTitle>
        <SheetRow icon="lock" label="Blocked accounts" onPress={() => router.push("/settings/blocked")} />
        <SheetRow icon="flag" label="Community guidelines" onPress={() => router.push({ pathname: "/settings/legal", params: { doc: "guidelines" } })} />
        <SheetRow icon="link" label="Contact the safety team" hint={env.contactEmail} onPress={() => void Linking.openURL(`mailto:${env.contactEmail}`)} />

        <SectionTitle>Your data</SectionTitle>
        <SheetRow
          icon="download"
          label={exporting ? "Packing your data…" : "Download my data"}
          hint="Everything we store about you, as a JSON file"
          onPress={async () => {
            if (exporting) return;
            setExporting(true);
            try {
              await exportMyData();
            } catch {
              toast("Export failed. Try again in a moment.", "bad");
            } finally {
              setExporting(false);
            }
          }}
        />
        <SheetRow
          icon="close"
          label={isGuest ? "Delete my data" : "Delete account"}
          hint={isGuest ? "Removes your guest profile, scores and saves" : "Removes your account and everything in it"}
          danger
          testID="delete-account"
          onPress={() => openDeleteSheet(isGuest)}
        />

        <SectionTitle>About</SectionTitle>
        <SheetRow icon="eye" label="Privacy Policy" onPress={() => router.push({ pathname: "/settings/legal", params: { doc: "privacy" } })} />
        <SheetRow icon="grid" label="Terms of Service" onPress={() => router.push({ pathname: "/settings/legal", params: { doc: "terms" } })} />
        <SheetRow icon="home" label="Imprint" onPress={() => router.push({ pathname: "/settings/legal", params: { doc: "imprint" } })} />
        <SheetRow icon="code" label="Open-source licences" testID="open-licenses" onPress={() => router.push("/settings/licenses")} />
        {devVisible ? <SheetRow icon="code" label="Developer menu" testID="open-dev-menu" onPress={() => router.push("/settings/dev")} /> : null}
        <Press onPress={tapVersion} scaleTo={1} accessibilityLabel={`Version ${version}`} testID="version-row" style={{ paddingHorizontal: layout.gutter, minHeight: 56, justifyContent: "center" }}>
          <T variant="mono" color="textDim">
            Thumbcade {version} · Made for thumbs
          </T>
        </Press>

        {!isGuest ? (
          <View style={{ paddingHorizontal: layout.gutter, marginTop: space[4] }}>
            <Button label="Sign out" kind="ghost" onPress={() => void signOutToGuest().then(() => router.replace("/"))} />
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

function openDeleteSheet(isGuest: boolean) {
  openSheet({ key: "delete", snap: 0.62, keyboard: true, accessibilityLabel: "Delete account", render: (close) => <DeleteSheet isGuest={isGuest} onDone={close} /> });
}

function DeleteSheet({ isGuest, onDone }: { isGuest: boolean; onDone: () => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <View style={{ paddingHorizontal: layout.gutter, gap: space[4] }}>
      <SheetDragArea>
        <SheetTitle>{isGuest ? "Delete your data?" : "Delete your account?"}</SheetTitle>
      </SheetDragArea>
      <T variant="body" color="textDim">
        This permanently deletes your profile, scores, likes, saves, comments, follows and game saves. It can't be undone. Type DELETE to confirm.
      </T>
      <Field testID="delete-confirm" value={text} onChangeText={setText} autoCapitalize="characters" placeholder="DELETE" mono />
      <Button
        testID="delete-go"
        label="Delete everything"
        kind="danger"
        disabled={text.trim() !== "DELETE"}
        busy={busy}
        onPress={async () => {
          setBusy(true);
          try {
            await deleteMyAccount();
            onDone();
            toast(isGuest ? "Your data is gone. Thanks for playing." : "Your account is gone. Thanks for playing.", "good");
            router.replace("/onboarding");
          } catch {
            toast("Deletion failed. Nothing was removed. Try again.", "bad");
          } finally {
            setBusy(false);
          }
        }}
      />
    </View>
  );
}
