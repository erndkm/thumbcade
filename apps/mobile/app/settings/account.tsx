import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, View } from "react-native";
import { router } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { File } from "expo-file-system";
import { supabase } from "../../src/lib/supabase";
import { invalidateMe, useMe } from "../../src/hooks/useMe";
import { queryClient } from "../../src/lib/query";
import { useAuth } from "../../src/state/auth";
import { toast } from "../../src/state/toast";
import { Avatar } from "../../src/ui/Avatar";
import { Button } from "../../src/ui/Button";
import { Field } from "../../src/ui/Field";
import { Header, Screen } from "../../src/ui/Screen";
import { T } from "../../src/ui/Text";
import { layout, space } from "../../src/ui/theme";

export default function EditProfile() {
  const me = useMe();
  const userId = useAuth((s) => s.userId);
  const [name, setName] = useState("");
  const [handle, setHandle] = useState("");
  const [bio, setBio] = useState("");
  const [avatar, setAvatar] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!me.data) return;
    setName(me.data.display_name);
    setHandle(me.data.handle);
    setBio(me.data.bio);
    setAvatar(me.data.avatar_url);
  }, [me.data]);

  const pick = async () => {
    if (!userId) return;
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsEditing: true, aspect: [1, 1], quality: 0.8 });
    if (res.canceled || !res.assets[0]) return;
    setUploading(true);
    try {
      const asset = res.assets[0];
      const bytes = await new File(asset.uri).bytes();
      const ext = asset.mimeType === "image/png" ? "png" : "jpg";
      const path = `${userId}/avatar-${Date.now()}.${ext}`;
      const up = await supabase.storage.from("avatars").upload(path, bytes, { contentType: asset.mimeType ?? "image/jpeg", upsert: true });
      if (up.error) throw up.error;
      setAvatar(supabase.storage.from("avatars").getPublicUrl(path).data.publicUrl);
    } catch {
      toast("Upload failed. Try a smaller photo.", "bad");
    } finally {
      setUploading(false);
    }
  };

  const save = async () => {
    if (!userId) return;
    const clean = handle.trim().toLowerCase();
    if (!/^[a-z0-9_.]{3,24}$/.test(clean)) {
      setError("Handles are 3–24 characters: letters, numbers, dots and underscores.");
      return;
    }
    setBusy(true);
    setError(null);
    const { error: err } = await supabase
      .from("profiles")
      .update({ display_name: name.trim().slice(0, 40) || clean, handle: clean, bio: bio.trim().slice(0, 160), avatar_url: avatar })
      .eq("id", userId);
    setBusy(false);
    if (err) {
      setError(err.code === "23505" ? `@${clean} is taken.` : "Couldn't save. Try again.");
      return;
    }
    await invalidateMe();
    void queryClient.invalidateQueries({ queryKey: ["profile"] });
    toast("Profile saved.", "good");
    router.back();
  };

  return (
    <Screen testID="edit-profile">
      <Header back title="Edit profile" />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: layout.gutter, gap: space[4], paddingBottom: space[16] }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space[4] }}>
            <Avatar seed={me.data?.avatar_seed ?? "me"} url={avatar} size={88} />
            <View style={{ flex: 1, gap: space[2] }}>
              <Button label={uploading ? "Uploading…" : "Choose photo"} small kind="secondary" busy={uploading} onPress={pick} />
              {avatar ? <Button label="Use my pixel sprite" small kind="ghost" onPress={() => setAvatar(null)} /> : null}
            </View>
          </View>
          <T variant="caption" color="textDim">
            Without a photo you get a pixel sprite generated from your account. It's yours and nobody else's.
          </T>
          <Field label="Display name" value={name} onChangeText={setName} maxLength={40} />
          <Field label="Handle" value={handle} onChangeText={(v) => setHandle(v.toLowerCase())} autoCapitalize="none" autoCorrect={false} maxLength={24} error={error} />
          <Field label="Bio" value={bio} onChangeText={setBio} maxLength={160} multiline placeholder="Speedrunner. Shortwick enjoyer. Has never lost at Pairs." style={{ minHeight: 88, textAlignVertical: "top" }} />
          <T variant="mono" color="textDim" align="right">
            {bio.length}/160
          </T>
          <Button label="Save" onPress={save} busy={busy} />
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
