import { useCallback, useMemo } from "react";
import { RefreshControl, SectionList, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { formatRelative } from "@thumbcade/protocol";
import { qk, queryClient } from "../../src/lib/query";
import { supabase } from "../../src/lib/supabase";
import type { NotificationRow } from "../../src/lib/types";
import { unreadKey } from "../../src/hooks/useUnread";
import { useAuth } from "../../src/state/auth";
import { openAuthSheet } from "../../src/features/auth/openAuthSheet";
import { requireMember, setFollow } from "../../src/features/social";
import { fmtScore } from "../../src/lib/format";
import { Avatar } from "../../src/ui/Avatar";
import { Button } from "../../src/ui/Button";
import { EmptyState, ErrorState } from "../../src/ui/EmptyState";
import { GameIcon } from "../../src/ui/GameIcon";
import { Icon } from "../../src/ui/Icon";
import { Press } from "../../src/ui/Press";
import { Header, Screen, SectionTitle } from "../../src/ui/Screen";
import { Skeleton } from "../../src/ui/Skeleton";
import { T } from "../../src/ui/Text";
import { c, layout, radius, space } from "../../src/ui/theme";

type Item = NotificationRow & {
  actor: { id: string; handle: string; display_name: string; avatar_url: string | null; avatar_seed: string } | null;
  game: { slug: string; name: string; icon_url: string | null; accent_color: string; score_config: { order?: "asc" | "desc"; max: number; format?: "integer" | "ms"; unit?: string } } | null;
  comment: { body: string } | null;
};

const SELECT =
  "*, actor:profiles!notifications_actor_id_fkey(id, handle, display_name, avatar_url, avatar_seed), game:games(slug, name, icon_url, accent_color, score_config), comment:comments(body)";

function copyFor(n: Item): { text: string; quote?: string } {
  const who = n.actor ? `@${n.actor.handle}` : "Someone";
  const game = n.game?.name ?? "a game";
  const p = n.payload as Record<string, unknown>;
  const fmt = (v: unknown) => (typeof v === "number" ? fmtScore(v, n.game?.score_config) : String(v ?? ""));
  switch (n.type) {
    case "follow":
      return { text: `${who} followed you.` };
    case "comment_like":
      return { text: `${who} liked your comment on ${game}.`, ...(n.comment ? { quote: n.comment.body } : null) };
    case "comment_reply":
      return { text: `${who} replied on ${game}:`, ...(n.comment ? { quote: n.comment.body } : null) };
    case "score_beaten":
      return { text: `${who} beat your ${fmt(p.theirBest)} on ${game} with ${fmt(p.score)}.` };
    case "new_game":
      return { text: `${who} dropped a new game: ${game}.` };
    case "game_approved":
      return { text: `${game}${p.semver ? ` v${String(p.semver)}` : ""} passed review and is live.` };
    case "game_rejected":
      return { text: `${game}${p.semver ? ` v${String(p.semver)}` : ""} needs changes before it can go live.`, ...(p.notes ? { quote: String(p.notes) } : null) };
    case "challenge_accepted":
      return { text: p.beat ? `${who} took your challenge on ${game} and beat it with ${fmt(p.score)}.` : `${who} took your challenge on ${game} and scored ${fmt(p.score)}. Yours stands.` };
  }
}

export default function Inbox() {
  const userId = useAuth((s) => s.userId);
  const isGuest = useAuth((s) => s.isGuest);
  const q = useQuery({
    queryKey: [...qk.notifications, userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase.from("notifications").select(SELECT).eq("user_id", userId!).order("created_at", { ascending: false }).limit(80);
      if (error) throw error;
      return (data ?? []) as Item[];
    },
  });

  // Viewing the inbox marks everything read (after a beat, so "New" is visible first).
  useFocusEffect(
    useCallback(() => {
      if (!userId) return;
      const t = setTimeout(() => {
        void supabase
          .from("notifications")
          .update({ read_at: new Date().toISOString() })
          .eq("user_id", userId)
          .is("read_at", null)
          .then(() => queryClient.invalidateQueries({ queryKey: unreadKey }));
      }, 1500);
      return () => clearTimeout(t);
    }, [userId]),
  );

  const sections = useMemo(() => {
    const items = q.data ?? [];
    const fresh = items.filter((n) => !n.read_at);
    const old = items.filter((n) => n.read_at);
    return [
      ...(fresh.length ? [{ title: "New", data: fresh }] : []),
      ...(old.length ? [{ title: "Earlier", data: old }] : []),
    ];
  }, [q.data]);

  return (
    <Screen testID="inbox">
      <Header title="Inbox" large />
      {isGuest ? (
        <View style={{ marginHorizontal: layout.gutter, marginBottom: space[2], padding: space[4], borderRadius: radius.sheetInner, borderWidth: 1, borderColor: c.line, backgroundColor: c.surface, gap: space[3] }}>
          <T variant="bodyStrong">Your inbox wakes up when you sign up.</T>
          <T variant="body" color="textDim">
            Follows, replies, and the moment a friend beats your score land here.
          </T>
          <Button label="Sign up" small onPress={() => openAuthSheet({ reason: "Sign up to get follows, replies and score alerts." })} style={{ alignSelf: "flex-start" }} />
        </View>
      ) : null}
      {q.isPending ? (
        <View style={{ paddingHorizontal: layout.gutter, gap: space[4], paddingTop: space[3] }} accessibilityLabel="Loading inbox">
          {[0, 1, 2, 3, 4].map((i) => (
            <View key={i} style={{ flexDirection: "row", gap: space[3], alignItems: "center" }}>
              <Skeleton style={{ width: 40, height: 40, borderRadius: 11 }} />
              <View style={{ flex: 1, gap: space[1.5] }}>
                <Skeleton style={{ width: "85%", height: 14 }} />
                <Skeleton style={{ width: 60, height: 10 }} />
              </View>
            </View>
          ))}
        </View>
      ) : q.isError ? (
        <ErrorState what="Your inbox" onRetry={() => void q.refetch()} />
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(n) => n.id}
          refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} tintColor={c.textDim} />}
          contentContainerStyle={{ paddingBottom: space[16] }}
          stickySectionHeadersEnabled={false}
          renderSectionHeader={({ section }) => <SectionTitle>{section.title}</SectionTitle>}
          ListEmptyComponent={isGuest ? null : <EmptyState icon="inbox" title="Quiet in here." body="Follow creators, leave a comment, set a score. This is where the replies and rematches show up." action="Find something to play" onAction={() => router.navigate("/")} testID="inbox-empty" />}
          renderItem={({ item }) => <NotificationRowView n={item} />}
        />
      )}
    </Screen>
  );
}

function NotificationRowView({ n }: { n: Item }) {
  const { text, quote } = copyFor(n);
  const open = () => {
    if (n.type === "follow" && n.actor) router.push(`/u/${n.actor.handle}`);
    else if ((n.type === "score_beaten" || n.type === "challenge_accepted") && n.game) router.push({ pathname: "/play", params: { first: n.game.slug, title: n.game.name } });
    else if (n.game) router.push(`/game/${n.game.slug}`);
  };
  return (
    <Press onPress={open} scaleTo={0.99} accessibilityLabel={`${text}${quote ? ` ${quote}` : ""}, ${formatRelative(n.created_at)}`} style={{ flexDirection: "row", gap: space[3], paddingHorizontal: layout.gutter, paddingVertical: space[3], alignItems: "flex-start" }}>
      <View>
        {n.actor ? <Avatar seed={n.actor.avatar_seed} url={n.actor.avatar_url} size={40} /> : n.game ? <GameIcon url={n.game.icon_url} size={40} accent={n.game.accent_color} /> : <Icon name="bolt" size={24} />}
        {!n.read_at ? <View style={{ position: "absolute", left: -8, top: 16, width: 6, height: 6, backgroundColor: c.heat }} /> : null}
      </View>
      <View style={{ flex: 1, gap: space[1] }}>
        <T variant="body">{text}</T>
        {quote ? (
          <T variant="body" color="textDim" numberOfLines={2} style={{ borderLeftWidth: 2, borderLeftColor: c.line, paddingLeft: space[2] }}>
            {quote}
          </T>
        ) : null}
        <T variant="mono" color="textDim">
          {formatRelative(n.created_at)}
        </T>
      </View>
      {n.type === "follow" && n.actor ? (
        <Button label="Follow back" small kind="secondary" onPress={() => requireMember("Sign up to follow.", () => void setFollow(n.actor!.id, true))} />
      ) : n.type === "score_beaten" && n.game ? (
        <Button label="Rematch" small kind="secondary" icon="bolt" onPress={open} />
      ) : n.game ? (
        <GameIcon url={n.game.icon_url} size={40} accent={n.game.accent_color} />
      ) : null}
    </Press>
  );
}
