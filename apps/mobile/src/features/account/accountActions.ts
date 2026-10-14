import { deleteAccount } from "../../lib/api";
import { queryClient } from "../../lib/query";
import { supabase } from "../../lib/supabase";
import { ensureGuest } from "../../state/auth";
import { useSettings } from "../../state/settings";

/** Signs out and immediately starts a fresh guest session (the app always has an identity). */
export async function signOutToGuest(): Promise<void> {
  await supabase.auth.signOut();
  queryClient.clear();
  useSettings.getState().set({ lastTab: "foryou" });
  await ensureGuest();
}

/** In-app account deletion (Guideline 5.1.1(v)): deletes the auth user server-side; all rows cascade. */
export async function deleteMyAccount(): Promise<void> {
  await deleteAccount();
  await supabase.auth.signOut({ scope: "local" });
  queryClient.clear();
  useSettings.getState().set({ onboarded: false, dockCoachShown: 0 });
  await ensureGuest();
}
