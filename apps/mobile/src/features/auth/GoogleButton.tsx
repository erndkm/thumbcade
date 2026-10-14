import { useEffect } from "react";
import * as Google from "expo-auth-session/providers/google";
import * as WebBrowser from "expo-web-browser";
import { env } from "../../lib/env";
import { toast } from "../../state/toast";
import { Button } from "../../ui/Button";
import { signInWithIdToken } from "./authActions";

WebBrowser.maybeCompleteAuthSession();

/** Google sign-in via an OpenID id token (expo-auth-session), then Supabase `signInWithIdToken`/`linkIdentity`. */
export function GoogleButton({ onSignedIn }: { onSignedIn: () => void }) {
  const [request, response, promptAsync] = Google.useIdTokenAuthRequest({
    iosClientId: env.googleIosClientId,
    webClientId: env.googleWebClientId,
    androidClientId: env.googleWebClientId,
  });
  useEffect(() => {
    if (response?.type !== "success") return;
    const idToken = response.params.id_token;
    if (!idToken) return;
    signInWithIdToken("google", idToken)
      .then(onSignedIn)
      .catch(() => toast("Google sign-in didn't go through. Try email instead.", "bad"));
  }, [response, onSignedIn]);
  return <Button label="Continue with Google" kind="secondary" disabled={!request} onPress={() => void promptAsync()} />;
}
