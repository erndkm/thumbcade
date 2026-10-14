import { FlatList, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { formatRelative } from "@thumbcade/protocol";
import { qk } from "../../src/lib/query";
import { supabase } from "../../src/lib/supabase";
import { useAuth } from "../../src/state/auth";
import { unblockUser } from "../../src/features/social";
import { Avatar } from "../../src/ui/Avatar";
import { Button } from "../../src/ui/Button";
import { EmptyState, ErrorState } from "../../src/ui/EmptyState";
import { Header, Screen } from "../../src/ui/Screen";
import { Skeleton } from "../../src/ui/Skeleton";
import { T } from "../../src/ui/Text";
import { layout, space } from "../../src/ui/theme";

type Row = { created_at: string; blocked: { id: string; handle: string; display_name: string; avatar_url: string | null; avatar_seed: string } | null };

export default function Blocked() {
  const userId = useAuth((s) => s.userId);
  const q = useQuery({
    queryKey: [...qk.blocked, userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase.from("blocks").select("created_at, blocked:profiles!blocks_blocked_id_fkey(id, handle, display_name, avatar_url, avatar_seed)").eq("blocker_id", userId!).order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as Row[];
    },
  });
  return (
    <Screen>
      <Header back title="Blocked accounts" />
      {q.isPending ? (
        <View style={{ padding: layout.gutter, gap: space[3] }}>
          <Skeleton style={{ height: 48 }} />
          <Skeleton style={{ height: 48 }} />
        </View>
      ) : q.isError ? (
        <ErrorState what="This list" onRetry={() => void q.refetch()} />
      ) : (
        <FlatList
          data={(q.data ?? []).filter((r) => r.blocked)}
          keyExtractor={(r) => r.blocked!.id}
          ListEmptyComponent={<EmptyState icon="lock" title="Nobody blocked." body="Block someone from their profile or a comment and they disappear from your feed, comments and boards." />}
          renderItem={({ item }) => (
            <View style={{ flexDirection: "row", alignItems: "center", gap: space[3], paddingHorizontal: layout.gutter, paddingVertical: space[2] }}>
              <Avatar seed={item.blocked!.avatar_seed} url={item.blocked!.avatar_url} size={40} />
              <View style={{ flex: 1 }}>
                <T variant="bodyStrong">@{item.blocked!.handle}</T>
                <T variant="mono" color="textDim">
                  Blocked {formatRelative(item.created_at)} ago
                </T>
              </View>
              <Button label="Unblock" small kind="secondary" onPress={() => void unblockUser(item.blocked!.id)} />
            </View>
          )}
        />
      )}
    </Screen>
  );
}
