import { useQuery } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import { qk, queryClient } from "../lib/query";
import type { ProfileRow } from "../lib/types";
import { useAuth } from "../state/auth";

export async function fetchMe(userId: string): Promise<ProfileRow | null> {
  const { data, error } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
  if (error) throw error;
  return (data as ProfileRow | null) ?? null;
}

/** The signed-in (or guest) user's own profile. */
export function useMe() {
  const userId = useAuth((s) => s.userId);
  return useQuery({
    queryKey: [...qk.me, userId],
    enabled: !!userId,
    queryFn: () => fetchMe(userId!),
    staleTime: 60_000,
  });
}

/** Synchronous read of the cached profile (for the bridge's LaunchContext). */
export function cachedMe(): ProfileRow | null {
  const userId = useAuth.getState().userId;
  return (queryClient.getQueryData([...qk.me, userId]) as ProfileRow | null | undefined) ?? null;
}

export function invalidateMe(): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: qk.me });
}
