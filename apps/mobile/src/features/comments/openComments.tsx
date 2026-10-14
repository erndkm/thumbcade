import { memo, useEffect, useMemo, useRef, useState } from "react";
import { ActionSheetIOS, Alert, FlatList, Platform, TextInput, View } from "react-native";
import { router } from "expo-router";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { formatCount, formatRelative, formatScore, type FeedCard } from "@thumbcade/protocol";
import { track } from "../../lib/events";
import { haptic } from "../../lib/haptics";
import { qk, queryClient } from "../../lib/query";
import { supabase } from "../../lib/supabase";
import type { CommentRow } from "../../lib/types";
import { useMe } from "../../hooks/useMe";
import { useAuth } from "../../state/auth";
import { closeSheet, openSheet } from "../../state/sheets";
import { toast } from "../../state/toast";
import { Avatar } from "../../ui/Avatar";
import { Icon } from "../../ui/Icon";
import { Press } from "../../ui/Press";
import { SheetDragArea } from "../../ui/Sheet";
import { Skeleton } from "../../ui/Skeleton";
import { T } from "../../ui/Text";
import { accentOf, c, layout, radius, space, type } from "../../ui/theme";
import { blockUser, patchGameEverywhere, requireMember } from "../social";
import { openReportSheet } from "../report/openReportSheet";

export interface CommentAuthor {
  handle: string;
  display_name: string;
  avatar_url: string | null;
  avatar_seed: string;
  verified: boolean;
}
export type CommentItem = CommentRow & { author: CommentAuthor | null; pending?: boolean };

const SELECT = "*, author:profiles!comments_user_id_fkey(handle, display_name, avatar_url, avatar_seed, verified)";
const PAGE = 30;

export interface CommentsTarget {
  gameId: string;
  gameName: string;
  creatorId: string;
  accent: string;
  scoreConfig: FeedCard["game"]["score"];
  count: number;
}

export function openComments(card: FeedCard): void {
  openCommentsFor({
    gameId: card.game.id,
    gameName: card.game.name,
    creatorId: card.creator.id,
    accent: card.game.accentColor,
    scoreConfig: card.game.score,
    count: card.game.stats.comments,
  });
}

export function openCommentsFor(target: CommentsTarget): void {
  openSheet({ key: "comments", snap: 0.72, keyboard: true, accessibilityLabel: "Comments", render: () => <CommentsSheet target={target} /> });
}

async function fetchTop(gameId: string, page: number): Promise<CommentItem[]> {
  const { data, error } = await supabase
    .from("comments")
    .select(SELECT)
    .eq("game_id", gameId)
    .is("parent_id", null)
    .order("is_pinned", { ascending: false })
    .order("created_at", { ascending: false })
    .range(page * PAGE, page * PAGE + PAGE - 1);
  if (error) throw error;
  return (data ?? []) as CommentItem[];
}

function CommentsSheet({ target }: { target: CommentsTarget }) {
  const userId = useAuth((s) => s.userId);
  const [replyTo, setReplyTo] = useState<CommentItem | null>(null);
  const input = useRef<TextInput>(null);
  const q = useInfiniteQuery({
    queryKey: qk.comments(target.gameId),
    initialPageParam: 0,
    queryFn: ({ pageParam }) => fetchTop(target.gameId, pageParam),
    getNextPageParam: (last, all) => (last.length === PAGE ? all.length : undefined),
  });
  const items = useMemo(() => q.data?.pages.flat() ?? [], [q.data]);

  const ids = useMemo(() => items.map((i) => i.id), [items]);
  const liked = useQuery({
    queryKey: ["commentLikes", target.gameId, userId, ids.length],
    enabled: !!userId && ids.length > 0,
    queryFn: async () => {
      const { data } = await supabase.from("comment_likes").select("comment_id").eq("user_id", userId!).in("comment_id", ids);
      return new Set((data ?? []).map((r: { comment_id: string }) => r.comment_id));
    },
  });

  // New comments arrive live.
  useEffect(() => {
    const channel = supabase
      .channel(`comments:${target.gameId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "comments", filter: `game_id=eq.${target.gameId}` }, (payload) => {
        const row = payload.new as CommentRow;
        if (row.user_id === useAuth.getState().userId) return;
        if (row.parent_id) void queryClient.invalidateQueries({ queryKey: qk.replies(row.parent_id) });
        void queryClient.invalidateQueries({ queryKey: qk.comments(target.gameId) });
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [target.gameId]);

  const total = Math.max(target.count, items.length);
  return (
    <View style={{ flex: 1 }} testID="comments-sheet">
      <SheetDragArea>
        <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: layout.gutter, paddingBottom: space[2] }}>
          <T variant="headline" style={{ flex: 1 }}>
            {total === 0 ? "Comments" : `${formatCount(total)} ${total === 1 ? "comment" : "comments"}`}
          </T>
          <Press onPress={() => closeSheet("comments")} accessibilityLabel="Close comments" testID="sheet-close" style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}>
            <Icon name="close" size={20} />
          </Press>
        </View>
      </SheetDragArea>
      {q.isPending ? (
        <CommentSkeletons />
      ) : q.isError ? (
        <View style={{ padding: layout.gutter, gap: space[2] }}>
          <T variant="bodyStrong">Comments didn't load.</T>
          <Press onPress={() => void q.refetch()} accessibilityLabel="Retry loading comments">
            <T variant="body" color="textDim">
              Tap to try again.
            </T>
          </Press>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(i) => i.id}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: space[4] }}
          onEndReached={() => {
            if (q.hasNextPage && !q.isFetchingNextPage) void q.fetchNextPage();
          }}
          ListEmptyComponent={
            <View style={{ padding: layout.gutter, paddingTop: space[8], gap: space[2], alignItems: "flex-start" }}>
              <T variant="title">Quiet in here.</T>
              <T variant="body" color="textDim">
                First comment gets bragging rights. Say something about {target.gameName}.
              </T>
            </View>
          }
          renderItem={({ item }) => (
            <CommentBlock
              item={item}
              target={target}
              liked={liked.data?.has(item.id) ?? false}
              onReply={() => {
                setReplyTo(item);
                input.current?.focus();
              }}
            />
          )}
        />
      )}
      <Composer target={target} replyTo={replyTo} onClearReply={() => setReplyTo(null)} inputRef={input} />
    </View>
  );
}

function CommentSkeletons() {
  return (
    <View style={{ paddingHorizontal: layout.gutter, gap: space[5], paddingTop: space[2] }} accessibilityLabel="Loading comments">
      {[0, 1, 2, 3].map((i) => (
        <View key={i} style={{ flexDirection: "row", gap: space[3] }}>
          <Skeleton style={{ width: 32, height: 32, borderRadius: 9 }} />
          <View style={{ flex: 1, gap: space[1.5] }}>
            <Skeleton style={{ width: 120, height: 12 }} />
            <Skeleton style={{ width: "90%", height: 14 }} />
            <Skeleton style={{ width: "60%", height: 14 }} />
          </View>
        </View>
      ))}
    </View>
  );
}

const CommentBlock = memo(function CommentBlock({ item, target, liked, onReply }: { item: CommentItem; target: CommentsTarget; liked: boolean; onReply: () => void }) {
  const [open, setOpen] = useState(false);
  const userId = useAuth((s) => s.userId);
  const replies = useQuery({
    queryKey: qk.replies(item.id),
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase.from("comments").select(SELECT).eq("parent_id", item.id).order("created_at", { ascending: true }).limit(100);
      if (error) throw error;
      return (data ?? []) as CommentItem[];
    },
  });
  const replyLikes = useQuery({
    queryKey: ["commentLikes", item.id, userId, replies.data?.length ?? 0],
    enabled: !!userId && !!replies.data?.length,
    queryFn: async () => {
      const { data } = await supabase.from("comment_likes").select("comment_id").eq("user_id", userId!).in("comment_id", replies.data!.map((r) => r.id));
      return new Set((data ?? []).map((r: { comment_id: string }) => r.comment_id));
    },
  });
  return (
    <View>
      <CommentLine item={item} target={target} liked={liked} onReply={onReply} />
      {item.reply_count > 0 ? (
        <Press onPress={() => setOpen((o) => !o)} accessibilityLabel={open ? "Hide replies" : `View ${item.reply_count} replies`} style={{ marginLeft: layout.gutter + 44, paddingVertical: space[1.5], flexDirection: "row", alignItems: "center", gap: space[2] }} scaleTo={0.98}>
          <View style={{ width: 20, height: 1, backgroundColor: c.lineStrong }} />
          <T variant="mono" color="textDim">
            {open ? "Hide replies" : `View ${item.reply_count} ${item.reply_count === 1 ? "reply" : "replies"}`}
          </T>
        </Press>
      ) : null}
      {open
        ? (replies.data ?? []).map((r) => <CommentLine key={r.id} item={r} target={target} liked={replyLikes.data?.has(r.id) ?? false} indent onReply={onReply} />)
        : null}
    </View>
  );
});

function CommentLine({ item, target, liked: likedInitial, onReply, indent }: { item: CommentItem; target: CommentsTarget; liked: boolean; onReply: () => void; indent?: boolean }) {
  const userId = useAuth((s) => s.userId);
  const [liked, setLiked] = useState(likedInitial);
  const [likes, setLikes] = useState(item.like_count);
  useEffect(() => setLiked(likedInitial), [likedInitial]);
  useEffect(() => setLikes(item.like_count), [item.like_count]);
  const isCreator = userId === target.creatorId;
  const mine = userId === item.user_id;
  const accent = accentOf(target.accent);

  const toggleLike = () =>
    requireMember("Sign up to like comments.", async () => {
      const next = !liked;
      setLiked(next);
      setLikes((n) => Math.max(0, n + (next ? 1 : -1)));
      if (next) haptic.like();
      const uid = useAuth.getState().userId!;
      const res = next
        ? await supabase.from("comment_likes").insert({ user_id: uid, comment_id: item.id })
        : await supabase.from("comment_likes").delete().eq("user_id", uid).eq("comment_id", item.id);
      if (res.error && res.error.code !== "23505") {
        setLiked(!next);
        setLikes((n) => Math.max(0, n + (next ? -1 : 1)));
        toast("That like didn't stick.", "bad");
      }
    });

  const actions = () => {
    const opts: { label: string; run: () => void; destructive?: boolean }[] = [];
    if (isCreator && !item.parent_id) opts.push({ label: item.is_pinned ? "Unpin" : "Pin to top", run: () => void setPinned(item, !item.is_pinned, target.gameId) });
    if (mine) opts.push({ label: "Delete", destructive: true, run: () => void deleteComment(item, target.gameId) });
    if (!mine) {
      opts.push({ label: "Report comment", run: () => requireMember("Sign up to report comments.", () => openReportSheet("comment", item.id, "comment")) });
      if (item.author) opts.push({ label: `Block @${item.author.handle}`, destructive: true, run: () => requireMember("Sign up to block people.", () => void blockUser(item.user_id, item.author!.handle)) });
    }
    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        { options: [...opts.map((o) => o.label), "Cancel"], cancelButtonIndex: opts.length, destructiveButtonIndex: opts.findIndex((o) => o.destructive), userInterfaceStyle: "dark" },
        (i) => opts[i]?.run(),
      );
    } else {
      Alert.alert("Comment", undefined, [...opts.map((o) => ({ text: o.label, onPress: o.run, style: o.destructive ? ("destructive" as const) : ("default" as const) })), { text: "Cancel", style: "cancel" as const }]);
    }
  };

  return (
    <Press onLongPress={actions} delayLongPress={350} scaleTo={1} accessibilityHint="Long-press for options" style={{ flexDirection: "row", gap: space[3], paddingHorizontal: layout.gutter, paddingVertical: space[2], marginLeft: indent ? 44 : 0, opacity: item.pending ? 0.55 : 1 }}>
      <Press onPress={() => item.author && router.push(`/u/${item.author.handle}`)} accessibilityLabel={`@${item.author?.handle ?? "player"}`} scaleTo={0.92}>
        <Avatar seed={item.author?.avatar_seed ?? item.user_id} url={item.author?.avatar_url} size={indent ? 26 : 32} />
      </Press>
      <View style={{ flex: 1, gap: 3 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space[2], flexWrap: "wrap" }}>
          <T variant="caption" color="textDim">
            @{item.author?.handle ?? "player"}
          </T>
          {item.user_id === target.creatorId ? <Badge text="Creator" color={c.text} /> : null}
          {item.score_badge !== null && (target.scoreConfig.order === "asc" || item.score_badge > 0) ? <Badge text={`Best ${formatScore(item.score_badge, target.scoreConfig)}`} color={accent} /> : null}
          {item.is_pinned ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
              <Icon name="flag" size={11} color={c.textDim} />
              <T variant="monoLabel" color="textDim">
                Pinned
              </T>
            </View>
          ) : null}
        </View>
        <T variant="body">{item.body}</T>
        <View style={{ flexDirection: "row", gap: space[4], alignItems: "center", marginTop: 2 }}>
          <T variant="mono" color="textDim">
            {item.pending ? "Sending…" : formatRelative(item.created_at)}
          </T>
          {!item.pending ? (
            <Press onPress={onReply} hitSlop={10} accessibilityLabel="Reply" scaleTo={0.95}>
              <T variant="mono" color="textDim">
                Reply
              </T>
            </Press>
          ) : null}
        </View>
      </View>
      <Press onPress={toggleLike} hitSlop={10} accessibilityLabel={liked ? "Unlike comment" : "Like comment"} style={{ alignItems: "center", width: 36, paddingTop: 4 }} scaleTo={0.85}>
        <Icon name="like" size={18} active={liked} color={liked ? c.heat : c.textDim} />
        <T variant="mono" color="textDim" style={{ fontSize: 11 }}>
          {likes > 0 ? formatCount(likes) : ""}
        </T>
      </Press>
    </Press>
  );
}

function Badge({ text, color }: { text: string; color: string }) {
  return (
    <View style={{ borderWidth: 1, borderColor: color, borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 }}>
      <T variant="monoLabel" color={color} style={{ fontSize: 10, lineHeight: 12 }}>
        {text}
      </T>
    </View>
  );
}

function Composer({ target, replyTo, onClearReply, inputRef }: { target: CommentsTarget; replyTo: CommentItem | null; onClearReply: () => void; inputRef: React.RefObject<TextInput | null> }) {
  const me = useMe();
  const isGuest = useAuth((s) => s.isGuest);
  const [text, setText] = useState("");
  const send = () =>
    requireMember(`Sign up to comment on ${target.gameName}.`, () => {
      const body = text.trim();
      if (!body) return;
      setText("");
      onClearReply();
      void postComment(target, body, replyTo?.parent_id ?? replyTo?.id ?? null);
    });
  return (
    <View style={{ borderTopWidth: 1, borderTopColor: c.line, paddingHorizontal: layout.gutter, paddingTop: space[2], paddingBottom: space[2], backgroundColor: c.surface, gap: space[2] }}>
      {replyTo ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
          <T variant="mono" color="textDim" style={{ flex: 1 }} numberOfLines={1}>
            Replying to @{replyTo.author?.handle ?? "player"}
          </T>
          <Press onPress={onClearReply} accessibilityLabel="Cancel reply" hitSlop={10}>
            <Icon name="close" size={16} color={c.textDim} />
          </Press>
        </View>
      ) : null}
      <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
        <Avatar seed={me.data?.avatar_seed ?? "guest"} url={me.data?.avatar_url} size={32} />
        <TextInput
          ref={inputRef}
          testID="comment-input"
          value={text}
          onChangeText={setText}
          onFocus={() => {
            if (isGuest) {
              inputRef.current?.blur();
              requireMember(`Sign up to comment on ${target.gameName}.`, () => setTimeout(() => inputRef.current?.focus(), 400));
            }
          }}
          placeholder={replyTo ? "Write a reply…" : "Add a comment…"}
          placeholderTextColor={c.textMute}
          selectionColor={c.accent}
          keyboardAppearance="dark"
          multiline
          maxLength={500}
          maxFontSizeMultiplier={1.3}
          accessibilityLabel="Comment"
          style={[type("body"), { flex: 1, color: c.text, backgroundColor: c.raised, borderRadius: radius.input, paddingHorizontal: space[3], paddingTop: 10, paddingBottom: 10, minHeight: 42, maxHeight: 110 }]}
        />
        <Press onPress={send} disabled={!text.trim()} testID="comment-send" accessibilityLabel="Post comment" style={{ width: 42, height: 42, borderRadius: radius.input, backgroundColor: text.trim() ? c.accent : c.raised, alignItems: "center", justifyContent: "center" }}>
          <Icon name="swipeUp" size={20} color={text.trim() ? c.onAccent : c.textMute} />
        </Press>
      </View>
    </View>
  );
}

async function postComment(target: CommentsTarget, body: string, parentId: string | null): Promise<void> {
  const uid = useAuth.getState().userId!;
  const me = queryClient.getQueriesData<{ handle: string; display_name: string; avatar_url: string | null; avatar_seed: string; verified: boolean }>({ queryKey: ["me"] })[0]?.[1];
  const temp: CommentItem = {
    id: `temp-${Date.now()}`,
    game_id: target.gameId,
    user_id: uid,
    parent_id: parentId,
    body,
    like_count: 0,
    reply_count: 0,
    score_badge: null,
    is_pinned: false,
    status: "visible",
    created_at: new Date().toISOString(),
    author: me ? { handle: me.handle, display_name: me.display_name, avatar_url: me.avatar_url, avatar_seed: me.avatar_seed, verified: me.verified } : null,
    pending: true,
  };
  const listKey = parentId ? qk.replies(parentId) : qk.comments(target.gameId);
  if (parentId) {
    queryClient.setQueryData<CommentItem[]>(listKey, (old) => [...(old ?? []), temp]);
    bumpReplyCount(target.gameId, parentId, 1);
  } else {
    queryClient.setQueryData<{ pages: CommentItem[][]; pageParams: unknown[] }>(listKey, (old) => {
      if (!old) return { pages: [[temp]], pageParams: [0] };
      const pages = [...old.pages];
      const first = pages[0] ?? [];
      const pinned = first.filter((x) => x.is_pinned);
      pages[0] = [...pinned, temp, ...first.filter((x) => !x.is_pinned)];
      return { ...old, pages };
    });
  }
  patchGameEverywhere(target.gameId, { commentsDelta: 1 });
  const { data, error } = await supabase.from("comments").insert({ game_id: target.gameId, user_id: uid, parent_id: parentId, body }).select(SELECT).single();
  if (error) {
    removeTemp(listKey, temp.id, !!parentId);
    if (parentId) bumpReplyCount(target.gameId, parentId, -1);
    patchGameEverywhere(target.gameId, { commentsDelta: -1 });
    toast(
      /filtered/.test(error.message)
        ? "That comment didn't make it past the filter. Keep it kind."
        : /rate_limited/.test(error.message)
          ? "Slow down, five comments a minute is the speed limit."
          : "Comment didn't post. Check your connection.",
      "bad",
    );
    return;
  }
  replaceTemp(listKey, temp.id, data as CommentItem, !!parentId);
  track({ type: "comment", gameId: target.gameId });
}

function bumpReplyCount(gameId: string, parentId: string, delta: number) {
  queryClient.setQueryData<{ pages: CommentItem[][]; pageParams: unknown[] }>(qk.comments(gameId), (old) =>
    old ? { ...old, pages: old.pages.map((p) => p.map((x) => (x.id === parentId ? { ...x, reply_count: Math.max(0, x.reply_count + delta) } : x))) } : old,
  );
}

function removeTemp(key: readonly unknown[], id: string, flat: boolean) {
  if (flat) queryClient.setQueryData<CommentItem[]>(key, (old) => (old ?? []).filter((x) => x.id !== id));
  else
    queryClient.setQueryData<{ pages: CommentItem[][]; pageParams: unknown[] }>(key, (old) =>
      old ? { ...old, pages: old.pages.map((p) => p.filter((x) => x.id !== id)) } : old,
    );
}

function replaceTemp(key: readonly unknown[], id: string, row: CommentItem, flat: boolean) {
  if (flat) queryClient.setQueryData<CommentItem[]>(key, (old) => (old ?? []).map((x) => (x.id === id ? row : x)));
  else
    queryClient.setQueryData<{ pages: CommentItem[][]; pageParams: unknown[] }>(key, (old) =>
      old ? { ...old, pages: old.pages.map((p) => p.map((x) => (x.id === id ? row : x))) } : old,
    );
}

async function setPinned(item: CommentItem, pinned: boolean, gameId: string) {
  const { error } = await supabase.from("comments").update({ is_pinned: pinned }).eq("id", item.id);
  if (error) {
    toast("Couldn't pin that one.", "bad");
    return;
  }
  toast(pinned ? "Pinned to the top." : "Unpinned.", "good");
  void queryClient.invalidateQueries({ queryKey: qk.comments(gameId) });
}

async function deleteComment(item: CommentItem, gameId: string) {
  const { error } = await supabase.from("comments").delete().eq("id", item.id);
  if (error) {
    toast("Couldn't delete that comment.", "bad");
    return;
  }
  patchGameEverywhere(gameId, { commentsDelta: -1 - (item.reply_count ?? 0) });
  void queryClient.invalidateQueries({ queryKey: qk.comments(gameId) });
  if (item.parent_id) void queryClient.invalidateQueries({ queryKey: qk.replies(item.parent_id) });
}
