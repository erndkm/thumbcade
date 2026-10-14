import type { Session } from "@supabase/supabase-js";
import { create } from "zustand";
import { supabase } from "../lib/supabase";

export interface AuthState {
  ready: boolean;
  session: Session | null;
  userId: string | null;
  /** Anonymous Supabase user (guest). */
  isGuest: boolean;
  error: string | null;
}

export const useAuth = create<AuthState>(() => ({ ready: false, session: null, userId: null, isGuest: true, error: null }));

function apply(session: Session | null) {
  useAuth.setState({
    session,
    userId: session?.user.id ?? null,
    isGuest: session ? Boolean(session.user.is_anonymous) : true,
    ready: true,
    error: null,
  });
}

let started = false;

/** Every install signs in anonymously on first launch; linking upgrades the same user in place. */
export async function bootstrapAuth(): Promise<void> {
  if (started) return;
  started = true;
  supabase.auth.onAuthStateChange((_event, session) => {
    apply(session);
  });
  const { data } = await supabase.auth.getSession();
  if (data.session) {
    apply(data.session);
    return;
  }
  await ensureGuest();
}

export async function ensureGuest(): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const { data, error } = await supabase.auth.signInAnonymously();
    if (!error && data.session) {
      apply(data.session);
      return;
    }
    useAuth.setState({ error: error?.message ?? "Could not start a session" });
    await new Promise<void>((r) => setTimeout(() => r(), 600 * (attempt + 1)));
  }
  useAuth.setState({ ready: true });
}

export function currentUserId(): string | null {
  return useAuth.getState().userId;
}

let recovering: Promise<void> | null = null;

/**
 * The session's user no longer exists (account deleted elsewhere, or a local reseed). Try a refresh;
 * if that fails, drop the session and start a fresh guest so the app keeps working.
 */
export function recoverSession(): Promise<void> {
  if (recovering) return recovering;
  recovering = (async () => {
    const { data, error } = await supabase.auth.refreshSession();
    if (!error && data.session) {
      const { error: userError } = await supabase.auth.getUser();
      if (!userError) return;
    }
    await supabase.auth.signOut({ scope: "local" });
    await ensureGuest();
  })().finally(() => {
    recovering = null;
  });
  return recovering;
}
