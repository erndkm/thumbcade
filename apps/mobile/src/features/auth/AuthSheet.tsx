import { useState } from "react";
import { Platform, ScrollView, View } from "react-native";
import * as AppleAuthentication from "expo-apple-authentication";
import * as Crypto from "expo-crypto";
import { router } from "expo-router";
import { env } from "../../lib/env";
import { useMe } from "../../hooks/useMe";
import { useAuth } from "../../state/auth";
import { toast } from "../../state/toast";
import { Button } from "../../ui/Button";
import { Field } from "../../ui/Field";
import { T } from "../../ui/Text";
import { Icon } from "../../ui/Icon";
import { Press } from "../../ui/Press";
import { SheetDragArea } from "../../ui/Sheet";
import { c, layout, space } from "../../ui/theme";
import { claimHandle, sendEmailCode, signInWithIdToken, verifyEmailCode, type EmailMode } from "./authActions";
import { GoogleButton } from "./GoogleButton";

type Step = { k: "start" } | { k: "code"; email: string; mode: EmailMode } | { k: "handle" };

export function AuthSheet({ reason, onDone, onClose }: { reason?: string | undefined; onDone: () => void; onClose: () => void }) {
  const [step, setStep] = useState<Step>({ k: "start" });
  const me = useMe();
  const under13 = me.data?.age_band === "under13";

  return (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingBottom: space[6], gap: space[5] }}>
      <SheetDragArea>
        <View style={{ gap: space[2], paddingTop: space[2] }}>
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <T variant="display3" style={{ flex: 1 }}>
              {step.k === "handle" ? "Name your legend." : "Make it count."}
            </T>
            <Press onPress={onClose} accessibilityLabel="Close" testID="sheet-close" style={{ width: 44, height: 44, alignItems: "center", justifyContent: "flex-start", marginRight: -space[3] }}>
              <Icon name="close" size={20} />
            </Press>
          </View>
          <T variant="body" color="textDim">
            {step.k === "handle"
              ? "This is how the leaderboard will remember you."
              : (reason ?? "Sign up to like, comment, follow and get your scores on the board.")}
          </T>
        </View>
      </SheetDragArea>
      {under13 ? (
        <View style={{ gap: space[3] }}>
          <T variant="body">Likes, comments and leaderboards unlock at 13. Until then, every game in your feed is yours to play.</T>
          <Button label="Back to playing" kind="secondary" onPress={onClose} />
        </View>
      ) : step.k === "start" ? (
        <StartStep onCode={(email, mode) => setStep({ k: "code", email, mode })} onSignedIn={() => setStep({ k: "handle" })} />
      ) : step.k === "code" ? (
        <CodeStep email={step.email} mode={step.mode} onBack={() => setStep({ k: "start" })} onVerified={() => setStep({ k: "handle" })} />
      ) : (
        <HandleStep onDone={onDone} />
      )}
      {step.k !== "handle" && !under13 ? (
        <T variant="caption" color="textDim">
          By continuing you agree to the{" "}
          <T variant="caption" color="textDim" onPress={() => router.push("/settings/legal?doc=terms")} accessibilityRole="link">
            Terms
          </T>{" "}
          and the{" "}
          <T variant="caption" color="textDim" onPress={() => router.push("/settings/legal?doc=privacy")} accessibilityRole="link">
            Privacy Policy
          </T>
          . We never sell your data or show ads.
        </T>
      ) : null}
    </ScrollView>
  );
}

function StartStep({ onCode, onSignedIn }: { onCode: (email: string, mode: EmailMode) => void; onSignedIn: () => void }) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());

  const send = async () => {
    if (!valid) {
      setError("That doesn't look like an email address.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const mode = await sendEmailCode(email.trim().toLowerCase());
      if (mode === "linked") onSignedIn();
      else onCode(email.trim().toLowerCase(), mode);
    } catch (e) {
      setError(e instanceof Error && /rate|seconds/i.test(e.message) ? "Easy, speedrunner. Wait a few seconds and try again." : "Couldn't send the code. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const apple = async () => {
    try {
      const raw = Crypto.randomUUID();
      const hashed = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, raw);
      const cred = await AppleAuthentication.signInAsync({
        requestedScopes: [AppleAuthentication.AppleAuthenticationScope.FULL_NAME, AppleAuthentication.AppleAuthenticationScope.EMAIL],
        nonce: hashed,
      });
      if (!cred.identityToken) throw new Error("No identity token");
      await signInWithIdToken("apple", cred.identityToken, raw);
      onSignedIn();
    } catch (e) {
      if ((e as { code?: string }).code === "ERR_REQUEST_CANCELED") return;
      toast("Sign in with Apple didn't go through. Try email instead.", "bad");
    }
  };

  return (
    <View style={{ gap: space[3] }}>
      {env.appleAuth && Platform.OS === "ios" ? (
        <AppleAuthentication.AppleAuthenticationButton
          buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
          buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE}
          cornerRadius={14}
          style={{ height: 52 }}
          onPress={apple}
        />
      ) : null}
      {env.googleAuth ? <GoogleButton onSignedIn={onSignedIn} /> : null}
      {env.appleAuth || env.googleAuth ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: space[3], marginVertical: space[1] }}>
          <View style={{ flex: 1, height: 1, backgroundColor: c.line }} />
          <T variant="monoLabel" color="textDim">
            or
          </T>
          <View style={{ flex: 1, height: 1, backgroundColor: c.line }} />
        </View>
      ) : null}
      <Field
        label="Email"
        testID="auth-email"
        value={email}
        onChangeText={setEmail}
        placeholder="you@somewhere.fun"
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        textContentType="emailAddress"
        returnKeyType="send"
        onSubmitEditing={send}
        error={error}
      />
      <Button testID="auth-send" label="Send code" onPress={send} busy={busy} disabled={!email} />
    </View>
  );
}

function CodeStep({ email, mode, onBack, onVerified }: { email: string; mode: EmailMode; onBack: () => void; onVerified: () => void }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const verify = async (value = code) => {
    if (value.length !== 6) return;
    setBusy(true);
    setError(null);
    try {
      await verifyEmailCode(email, value, mode);
      onVerified();
    } catch {
      setError("That code didn't match. Check it, or go back and resend.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={{ gap: space[3] }}>
      <T variant="body" color="textDim">
        Six digits, sent to <T variant="bodyStrong">{email}</T>.
      </T>
      <Field
        testID="auth-code"
        mono
        value={code}
        onChangeText={(v) => {
          const digits = v.replace(/\D/g, "").slice(0, 6);
          setCode(digits);
          if (digits.length === 6) void verify(digits);
        }}
        placeholder="000000"
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="one-time-code"
        autoFocus
        maxLength={6}
        accessibilityLabel="Six digit code"
        error={error}
      />
      <Button testID="auth-verify" label="Verify" onPress={() => verify()} busy={busy} disabled={code.length !== 6} />
      <Button label="Use a different email" kind="ghost" onPress={onBack} />
    </View>
  );
}

function HandleStep({ onDone }: { onDone: () => void }) {
  const me = useMe();
  const userId = useAuth((s) => s.userId);
  const suggested = me.data && !/^player\d+$/.test(me.data.handle) ? me.data.handle : "";
  const [handle, setHandle] = useState(suggested);
  const [name, setName] = useState(me.data && me.data.display_name !== me.data.handle ? me.data.display_name : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    if (!userId) return;
    setBusy(true);
    const err = await claimHandle(userId, handle || me.data?.handle || "", name || handle);
    setBusy(false);
    if (err) setError(err);
    else {
      toast("You're in. Go set a score.", "good");
      onDone();
    }
  };
  return (
    <View style={{ gap: space[3] }}>
      <Field testID="auth-handle" label="Handle" value={handle} onChangeText={(v) => setHandle(v.toLowerCase())} placeholder={me.data?.handle ?? "yourname"} autoCapitalize="none" autoCorrect={false} error={error} />
      <Field label="Display name" value={name} onChangeText={setName} placeholder="What friends call you" maxLength={40} />
      <Button testID="auth-handle-save" label="Lock it in" onPress={save} busy={busy} />
      <Button label="Keep the generated one" kind="ghost" onPress={onDone} />
    </View>
  );
}
