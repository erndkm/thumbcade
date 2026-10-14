import { useEffect, useRef, useState } from "react";
import { Keyboard, KeyboardAvoidingView, ScrollView, TextInput, View } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { FadeIn, FadeInDown, FadeOut } from "react-native-reanimated";
import { useQuery } from "@tanstack/react-query";
import { CATEGORIES } from "@thumbcade/protocol";
import { ageBandFor } from "../src/lib/age";
import { supabase } from "../src/lib/supabase";
import { invalidateMe } from "../src/hooks/useMe";
import { useAuth } from "../src/state/auth";
import { useSettings } from "../src/state/settings";
import { takePendingHref } from "../src/state/pendingLink";
import { BrandMark } from "../src/ui/Brand";
import { Button } from "../src/ui/Button";
import { Press } from "../src/ui/Press";
import { T } from "../src/ui/Text";
import { c, layout, radius, space, type } from "../src/ui/theme";

export default function Onboarding() {
  const [step, setStep] = useState<"age" | "interests">("age");
  const insets = useSafeAreaInsets();
  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: c.bg, paddingTop: insets.top + space[4], paddingBottom: insets.bottom + space[4] }}>
      {step === "age" ? <AgeStep onNext={() => setStep("interests")} /> : <InterestsStep />}
    </KeyboardAvoidingView>
  );
}

function AgeStep({ onNext }: { onNext: () => void }) {
  const [year, setYear] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<TextInput>(null);
  const userId = useAuth((s) => s.userId);
  useEffect(() => {
    const t = setTimeout(() => input.current?.focus(), 450);
    return () => clearTimeout(t);
  }, []);
  const submit = async () => {
    const band = ageBandFor(Number(year));
    if (!band) {
      setError("Enter a four-digit year, like 2001.");
      return;
    }
    setBusy(true);
    Keyboard.dismiss();
    if (userId) await supabase.from("profiles").update({ age_band: band }).eq("id", userId);
    await invalidateMe();
    setBusy(false);
    onNext();
  };
  const digits = year.padEnd(4, " ").split("");
  return (
    <Animated.View entering={FadeIn.duration(220)} exiting={FadeOut.duration(120)} style={{ flex: 1, paddingHorizontal: layout.gutter, justifyContent: "space-between" }}>
      <View style={{ gap: space[5] }}>
        <BrandMark size={56} />
        <T variant="display2">What year were you born?</T>
        <T variant="body" color="textDim">
          We keep an age range, never your birthday. It decides which games show up in your feed.
        </T>
        <Press testID="age-digits" onPress={() => input.current?.focus()} scaleTo={1} accessibilityLabel="Birth year digits" style={{ flexDirection: "row", gap: space[2], marginTop: space[4] }}>
          {digits.map((d, i) => (
            <View
              key={i}
              style={{
                width: 64,
                height: 80,
                borderRadius: radius.sheetInner,
                borderWidth: 1.5,
                borderColor: i === year.length ? c.accent : c.line,
                backgroundColor: c.surface,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <T variant="monoScore" style={{ fontSize: 44, lineHeight: 50 }}>
                {d.trim()}
              </T>
            </View>
          ))}
        </Press>
        <TextInput
          ref={input}
          testID="age-year"
          value={year}
          onChangeText={(v) => {
            setError(null);
            setYear(v.replace(/\D/g, "").slice(0, 4));
          }}
          keyboardType="number-pad"
          maxLength={4}
          caretHidden
          style={[type("mono"), { position: "absolute", opacity: 0, height: 1, width: 1 }]}
          accessibilityLabel="Birth year"
          onSubmitEditing={submit}
        />
        {error ? (
          <T variant="caption" color="heat">
            {error}
          </T>
        ) : null}
      </View>
      <Button testID="age-continue" label="Continue" onPress={submit} disabled={year.length !== 4} busy={busy} />
    </Animated.View>
  );
}

const STARTER_TAGS = ["onetap", "runner", "puzzle", "3d", "reflex", "chill", "brain", "arcade", "merge", "chess", "memory", "physics"];

function InterestsStep() {
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const userId = useAuth((s) => s.userId);
  const trending = useQuery({
    queryKey: ["onboardingTags"],
    queryFn: async () => {
      const { data } = await supabase.from("hashtags").select("tag").gt("game_count", 0).order("trend_score", { ascending: false }).limit(12);
      return (data ?? []).map((r: { tag: string }) => r.tag);
    },
  });
  const tags = Array.from(new Set([...(trending.data ?? []), ...CATEGORIES.map((c2) => c2.id), ...STARTER_TAGS])).slice(0, 18);
  const finish = async (save: boolean) => {
    setBusy(true);
    if (save && userId && picked.length) await supabase.from("profiles").update({ interests: picked }).eq("id", userId);
    await invalidateMe();
    useSettings.getState().set({ onboarded: true });
    setBusy(false);
    const next = takePendingHref();
    router.replace((next ?? "/") as never);
  };
  return (
    <Animated.View entering={FadeInDown.duration(260)} style={{ flex: 1, paddingHorizontal: layout.gutter }}>
      <ScrollView contentContainerStyle={{ gap: space[5], paddingBottom: space[6] }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <T variant="monoLabel" color="textDim">
            Optional
          </T>
          <Press onPress={() => finish(false)} testID="interests-skip" accessibilityLabel="Skip" style={{ padding: space[2] }}>
            <T variant="bodyStrong" color="textDim">
              Skip
            </T>
          </Press>
        </View>
        <T variant="display2">Pick your poison.</T>
        <T variant="body" color="textDim">
          Tap a few and we'll tune your first feed. Or skip, it learns fast.
        </T>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
          {tags.map((t) => {
            const on = picked.includes(t);
            return (
              <Press
                key={t}
                onPress={() => setPicked((p) => (on ? p.filter((x) => x !== t) : [...p, t].slice(0, 10)))}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
                accessibilityLabel={`#${t}`}
                scaleTo={0.94}
                style={{ paddingHorizontal: space[3], height: 40, justifyContent: "center", borderRadius: radius.chip, borderWidth: 1, borderColor: on ? c.accent : c.line, backgroundColor: on ? c.accent : c.surface }}
              >
                <T variant="mono" color={on ? "onAccent" : "text"}>
                  #{t}
                </T>
              </Press>
            );
          })}
        </View>
      </ScrollView>
      <Button testID="interests-go" label={picked.length ? `Play (${picked.length})` : "Start playing"} icon="play" onPress={() => finish(true)} busy={busy} />
    </Animated.View>
  );
}
