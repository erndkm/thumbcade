import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryClient } from "../lib/query";
import { supabase } from "../lib/supabase";
import { useAuth } from "../state/auth";

export const unreadKey = ["unread"] as const;

/** Unread inbox items, kept live through Supabase Realtime. */
export function useUnreadCount(): number {
  const userId = useAuth((s) => s.userId);
  const q = useQuery({
    queryKey: [...unreadKey, userId],
    enabled: !!userId,
    queryFn: async () => {
      const { count, error } = await supabase.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", userId!).is("read_at", null);
      if (error) throw error;
      return count ?? 0;
    },
    staleTime: 60_000,
  });
  return q.data ?? 0;
}

/** One realtime subscription for the signed-in user's notifications (mounted at the root). */
export function useNotificationsRealtime(): void {
  const userId = useAuth((s) => s.userId);
  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`notifications:${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` }, () => {
        void queryClient.invalidateQueries({ queryKey: unreadKey });
        void queryClient.invalidateQueries({ queryKey: ["notifications"] });
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId]);
}
