/**
 * Wires CardControllers to the app: Supabase (sessions, storage, leaderboards), haptics, analytics,
 * the share flow and the user's settings. Games only ever reach these through the bridge.
 */
import { AccessibilityInfo, Platform } from "react-native";
import { getLocales } from "expo-localization";
import type { FeedCard, Json, LeaderboardEntry, LeaderboardScope } from "@thumbcade/protocol";
import { sessionEnd, sessionProgress, sessionStart } from "../lib/api";
import { track } from "../lib/events";
import { gameFeedback } from "../lib/haptics";
import { kv } from "../lib/kv";
import { opaquePlayerId } from "../lib/playerId";
import { supabase } from "../lib/supabase";
import type { LeaderboardRow } from "../lib/types";
import { cachedMe } from "../hooks/useMe";
import { useAuth } from "../state/auth";
import { useSettings } from "../state/settings";
import { CardController, isUuid, type CardDeps, type ChallengeInfo } from "./controller";
import { getFeedLayout, insetsFor } from "./layout";
import { useDevLog } from "../state/devlog";

let systemReduceMotion = false;
void AccessibilityInfo.isReduceMotionEnabled().then((v) => {
  systemReduceMotion = v;
});
AccessibilityInfo.addEventListener("reduceMotionChanged", (v) => {
  systemReduceMotion = v;
});

/** Share flow hook-in (set by the share feature to avoid an import cycle). */
let shareChallengeImpl: (card: FeedCard, score: number) => Promise<boolean> = async () => false;
export function registerShareChallenge(fn: typeof shareChallengeImpl): void {
  shareChallengeImpl = fn;
}

async function storageGet(gameId: string, key: string): Promise<Json | null> {
  const userId = useAuth.getState().userId;
  if (!isUuid(gameId) || !userId) return kv.getJSON<Json | null>(`tc.devkv.${gameId}.${key}`, null);
  const { data, error } = await supabase.from("game_kv").select("value").eq("user_id", userId).eq("game_id", gameId).eq("key", key).maybeSingle();
  if (error) throw new Error(error.message);
  return ((data as { value: Json } | null)?.value ?? null) as Json | null;
}

async function storageSet(gameId: string, key: string, value: Json): Promise<void> {
  const userId = useAuth.getState().userId;
  if (!isUuid(gameId) || !userId) {
    kv.setJSON(`tc.devkv.${gameId}.${key}`, value);
    return;
  }
  const { error } = await supabase.from("game_kv").upsert({ user_id: userId, game_id: gameId, key, value }, { onConflict: "user_id,game_id,key" });
  if (error) throw new Error(error.message);
}

async function leaderboardTop(gameId: string, scope: LeaderboardScope, limit: number): Promise<LeaderboardEntry[]> {
  if (!isUuid(gameId)) return [];
  const { data, error } = await supabase.rpc("leaderboard", { p_game_id: gameId, p_scope: scope, p_limit: limit });
  if (error) throw new Error(error.message);
  return ((data ?? []) as LeaderboardRow[]).map((r) => ({
    rank: r.rank,
    name: r.display_name,
    avatarUrl: r.avatar_url,
    score: r.score,
    isMe: r.is_me,
  }));
}

async function leaderboardMe(gameId: string) {
  if (!isUuid(gameId)) return { best: null, rank: null, percentile: null };
  const { data, error } = await supabase.rpc("leaderboard_me", { p_game_id: gameId });
  if (error) throw new Error(error.message);
  const row = (Array.isArray(data) ? data[0] : data) as { best: number | null; rank: number | null; percentile: number | null } | undefined;
  return { best: row?.best ?? null, rank: row?.rank ?? null, percentile: row?.percentile === null || row?.percentile === undefined ? null : Math.max(0, Math.min(100, row.percentile)) };
}

export function makeDeps(card: FeedCard, dev: boolean): CardDeps {
  return {
    now: () => Date.now(),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (h) => {
      if (h) clearTimeout(h as ReturnType<typeof setTimeout>);
    },
    insets: () => insetsFor(getFeedLayout()),
    launch: async () => {
      const { userId, isGuest } = useAuth.getState();
      const me = cachedMe();
      return {
        player: userId
          ? {
              id: await opaquePlayerId(userId, card.game.id),
              name: isGuest ? "Guest" : (me?.display_name ?? "Player"),
              avatarUrl: isGuest ? null : (me?.avatar_url ?? null),
              guest: isGuest,
            }
          : null,
        locale: getLocales()[0]?.languageTag ?? "en-US",
        reducedMotion: systemReduceMotion || useSettings.getState().reduceMotion,
        muted: !useSettings.getState().soundOn,
        insets: insetsFor(getFeedLayout()),
        host: Platform.OS === "ios" ? "ios" : "android",
      };
    },
    sessionStart: (req) => sessionStart(req),
    sessionEnd: (req) => sessionEnd(req),
    sessionProgress: (req) => sessionProgress(req),
    storageGet,
    storageSet,
    leaderboardTop,
    leaderboardMe,
    feedback: gameFeedback,
    shareChallenge: (c, score) => shareChallengeImpl(c, score),
    track: (e) => track({ ...e, ...(e.cardId ? { feedId: e.cardId.split(":")[0]!.slice(0, 80) } : null) }),
    ...(dev ? { onViolation: (code: string, detail: string) => useDevLog.getState().push(`${code}: ${detail}`) } : null),
    dev,
  };
}

export function createController(
  card: FeedCard,
  opts: { launchReason?: "feed" | "gamePage" | "challenge" | "dev"; challenge?: ChallengeInfo | null; dev?: boolean } = {},
): CardController {
  return new CardController(card, makeDeps(card, !!opts.dev), opts);
}
