import { createClient } from "@supabase/supabase-js";
import { AppState } from "react-native";
import { env, rewriteLocalUrl } from "./env";
import { kv } from "./kv";

export const supabaseUrl = rewriteLocalUrl(env.supabaseUrl);

export const supabase = createClient(supabaseUrl, env.supabaseAnonKey, {
  auth: {
    storage: kv.authStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
  realtime: { params: { eventsPerSecond: 10 } },
});

// Refresh tokens only while the app is in the foreground.
AppState.addEventListener("change", (state) => {
  if (state === "active") void supabase.auth.startAutoRefresh();
  else void supabase.auth.stopAutoRefresh();
});

export async function accessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}
