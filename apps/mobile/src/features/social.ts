/**
 * Social actions with optimistic updates. Every action patches every cache that shows the same game
 * or person (feed pages, game pages, profiles), sends the write, and rolls back on failure.
 * Guests are asked to sign up first (social writes require `public.is_member()`).
 */
import type { InfiniteData } from "@tanstack/react-query";
import type { FeedCard, FeedResponse } from "@thumbcade/protocol";
import { track } from "../lib/events";
import { haptic } from "../lib/haptics";
import { queryClient } from "../lib/query";
import { supabase } from "../lib/supabase";
import { useAuth } from "../state/auth";
import { toast } from "../state/toast";
import { openAuthSheet } from "./auth/openAuthSheet";

export interface GameSocialPatch {
  liked?: boolean;
  saved?: boolean;
  likesDelta?: number;
  savesDelta?: number;
  commentsDelta?: number;
  sharesDelta?: number;
}

/** Game detail cache entries carry the same fields under these names. */
export interface GameSocialFields {
  id: string;
  liked: boolean;
  saved: boolean;
  like_count: number;
  save_count: number;
  comment_count: number;
  share_count: number;
}

function patchCard(card: FeedCard, gameId: string, p: GameSocialPatch): FeedCard {
  if (card.game.id !== gameId) return card;
  return {
    ...card,
    viewer: {
      ...card.viewer,
      ...(p.liked !== undefined ? { liked: p.liked } : null),
      ...(p.saved !== undefined ? { saved: p.saved } : null),
    },
    game: {
      ...card.game,
      stats: {
        ...card.game.stats,
        likes: Math.max(0, card.game.stats.likes + (p.likesDelta ?? 0)),
        saves: Math.max(0, card.game.stats.saves + (p.savesDelta ?? 0)),
        comments: Math.max(0, card.game.stats.comments + (p.commentsDelta ?? 0)),
        shares: Math.max(0, card.game.stats.shares + (p.sharesDelta ?? 0)),
      },
    },
  };
}

function patchCreator(card: FeedCard, creatorId: string, following: boolean): FeedCard {
  if (card.creator.id !== creatorId) return card;
  return { ...card, viewer: { ...card.viewer, followingCreator: following } };
}

function mapFeeds(fn: (card: FeedCard) => FeedCard): void {
  for (const [key, data] of queryClient.getQueriesData<InfiniteData<FeedResponse>>({ queryKey: ["feed"] })) {
    if (!data?.pages) continue;
    queryClient.setQueryData<InfiniteData<FeedResponse>>(key, {
      ...data,
      pages: data.pages.map((page) => ({ ...page, cards: page.cards.map(fn) })),
    });
  }
}

export function patchGameEverywhere(gameId: string, p: GameSocialPatch): void {
  mapFeeds((card) => patchCard(card, gameId, p));
  for (const [key, data] of queryClient.getQueriesData<GameSocialFields>({ queryKey: ["game"] })) {
    if (!data || data.id !== gameId) continue;
    queryClient.setQueryData<GameSocialFields>(key, {
      ...data,
      ...(p.liked !== undefined ? { liked: p.liked } : null),
      ...(p.saved !== undefined ? { saved: p.saved } : null),
      like_count: Math.max(0, data.like_count + (p.likesDelta ?? 0)),
      save_count: Math.max(0, data.save_count + (p.savesDelta ?? 0)),
      comment_count: Math.max(0, data.comment_count + (p.commentsDelta ?? 0)),
      share_count: Math.max(0, data.share_count + (p.sharesDelta ?? 0)),
    });
  }
}

export function patchFollowEverywhere(creatorId: string, following: boolean): void {
  mapFeeds((card) => patchCreator(card, creatorId, following));
  for (const [key, data] of queryClient.getQueriesData<{ id: string; following?: boolean; follower_count?: number }>({ queryKey: ["profile"] })) {
    if (!data || data.id !== creatorId || data.following === following) continue;
    queryClient.setQueryData(key, {
      ...data,
      following,
      follower_count: Math.max(0, (data.follower_count ?? 0) + (following ? 1 : -1)),
    });
  }
  for (const [key, data] of queryClient.getQueriesData<{ creator?: { id: string }; following?: boolean }>({ queryKey: ["game"] })) {
    if (!data?.creator || data.creator.id !== creatorId) continue;
    queryClient.setQueryData(key, { ...data, following });
  }
}

/** Runs `action` now for members; opens the sign-up sheet for guests and runs it after sign-up. */
export function requireMember(reason: string, action: () => void): void {
  const { isGuest, userId } = useAuth.getState();
  if (userId && !isGuest) {
    action();
    return;
  }
  openAuthSheet({ reason, onSignedIn: action });
}

function uid(): string {
  const id = useAuth.getState().userId;
  if (!id) throw new Error("not signed in");
  return id;
}

const failMsg = "That didn't stick. Check your connection and try again.";

export async function setLike(gameId: string, liked: boolean): Promise<void> {
  patchGameEverywhere(gameId, { liked, likesDelta: liked ? 1 : -1 });
  if (liked) haptic.like();
  const res = liked
    ? await supabase.from("likes").insert({ user_id: uid(), game_id: gameId })
    : await supabase.from("likes").delete().eq("user_id", uid()).eq("game_id", gameId);
  if (res.error && res.error.code !== "23505") {
    patchGameEverywhere(gameId, { liked: !liked, likesDelta: liked ? -1 : 1 });
    toast(failMsg, "bad");
    return;
  }
  track({ type: liked ? "like" : "unlike", gameId });
}

export async function setSave(gameId: string, saved: boolean): Promise<void> {
  patchGameEverywhere(gameId, { saved, savesDelta: saved ? 1 : -1 });
  const res = saved
    ? await supabase.from("saves").insert({ user_id: uid(), game_id: gameId })
    : await supabase.from("saves").delete().eq("user_id", uid()).eq("game_id", gameId);
  if (res.error && res.error.code !== "23505") {
    patchGameEverywhere(gameId, { saved: !saved, savesDelta: saved ? -1 : 1 });
    toast(failMsg, "bad");
    return;
  }
  if (saved) toast("Saved. It's in your profile when 2am hits.", "good");
  track({ type: saved ? "save" : "unsave", gameId });
  void queryClient.invalidateQueries({ queryKey: ["profileTab"] });
}

export async function setFollow(creatorId: string, following: boolean, gameId?: string): Promise<void> {
  patchFollowEverywhere(creatorId, following);
  const res = following
    ? await supabase.from("follows").insert({ follower_id: uid(), followee_id: creatorId })
    : await supabase.from("follows").delete().eq("follower_id", uid()).eq("followee_id", creatorId);
  if (res.error && res.error.code !== "23505") {
    patchFollowEverywhere(creatorId, !following);
    toast(failMsg, "bad");
    return;
  }
  if (following) track({ type: "follow", ...(gameId ? { gameId } : null), meta: { creatorId } });
  void queryClient.invalidateQueries({ queryKey: ["feed", "following"] });
}

export async function blockUser(userId: string, handle: string): Promise<boolean> {
  const { error } = await supabase.from("blocks").insert({ blocker_id: uid(), blocked_id: userId });
  if (error && error.code !== "23505") {
    toast(failMsg, "bad");
    return false;
  }
  // Blocking also unfollows both ways (best effort).
  await supabase.from("follows").delete().eq("follower_id", uid()).eq("followee_id", userId);
  toast(`@${handle} is blocked. You won't see them again.`, "good");
  void queryClient.invalidateQueries();
  return true;
}

export async function unblockUser(userId: string): Promise<void> {
  const { error } = await supabase.from("blocks").delete().eq("blocker_id", uid()).eq("blocked_id", userId);
  if (error) toast(failMsg, "bad");
  void queryClient.invalidateQueries({ queryKey: ["blocked"] });
}

export type ReportReason =
  | "spam"
  | "harassment"
  | "hate"
  | "sexual"
  | "violence"
  | "self_harm"
  | "age_inappropriate"
  | "broken"
  | "ip_violation"
  | "other";

export async function report(targetType: "game" | "comment" | "user", targetId: string, reason: ReportReason, details?: string): Promise<boolean> {
  const { error } = await supabase.from("reports").insert({
    reporter_id: uid(),
    target_type: targetType,
    target_id: targetId,
    reason,
    ...(details ? { details: details.slice(0, 1000) } : null),
  });
  if (error) {
    toast(failMsg, "bad");
    return false;
  }
  toast("Report sent. A human will look at it.", "good");
  return true;
}
