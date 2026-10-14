import { supabase } from "../../lib/supabase";
import { invalidateMe } from "../../hooks/useMe";
import { useAuth } from "../../state/auth";

export type EmailMode = "link" | "signin";
/** "linked": the server confirmed the email immediately (email confirmations disabled), no code needed. */
export type EmailStart = EmailMode | "linked";

/**
 * Starts the email OTP flow. A guest is upgraded in place (`updateUser({ email })`); if that email
 * already belongs to a member, we sign into that account instead.
 */
export async function sendEmailCode(email: string): Promise<EmailStart> {
  const { session, isGuest } = useAuth.getState();
  if (session && isGuest) {
    const { data, error } = await supabase.auth.updateUser({ email });
    if (!error) {
      if (data.user && !data.user.is_anonymous && data.user.email_confirmed_at) {
        await afterSignIn(true);
        return "linked";
      }
      return "link";
    }
    if (!/already|exists|registered/i.test(error.message) && error.code !== "email_exists") throw error;
  }
  const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
  if (error) throw error;
  return "signin";
}

export async function verifyEmailCode(email: string, token: string, mode: EmailMode): Promise<void> {
  const { error } = await supabase.auth.verifyOtp({ email, token, type: mode === "link" ? "email_change" : "email" });
  if (error) throw error;
  await afterSignIn(mode === "link");
}

/** Called after any successful sign-in or upgrade. */
export async function afterSignIn(upgraded: boolean): Promise<void> {
  const { data } = await supabase.auth.refreshSession();
  if (data.session) useAuth.setState({ session: data.session, userId: data.session.user.id, isGuest: Boolean(data.session.user.is_anonymous) });
  if (upgraded) await supabase.rpc("claim_guest_scores").then(() => undefined, () => undefined);
  await invalidateMe();
}

export async function signInWithIdToken(provider: "apple" | "google", token: string, nonce?: string): Promise<void> {
  const { session, isGuest } = useAuth.getState();
  const creds = { provider, token, ...(nonce ? { nonce } : null) };
  if (session && isGuest) {
    const { error } = await supabase.auth.linkIdentity(creds);
    if (!error) {
      await afterSignIn(true);
      return;
    }
    if (!/already|exists|linked/i.test(error.message)) throw error;
  }
  const { error } = await supabase.auth.signInWithIdToken(creds);
  if (error) throw error;
  await afterSignIn(false);
}

export async function claimHandle(userId: string, handle: string, displayName: string): Promise<string | null> {
  const clean = handle.trim().toLowerCase();
  if (!/^[a-z0-9_.]{3,24}$/.test(clean)) return "3–24 characters: letters, numbers, dots and underscores.";
  const { error } = await supabase.from("profiles").update({ handle: clean, display_name: displayName.trim().slice(0, 40) || clean }).eq("id", userId);
  if (error) return error.code === "23505" ? `@${clean} is taken. Try another.` : "Couldn't save that. Try again.";
  await invalidateMe();
  return null;
}
