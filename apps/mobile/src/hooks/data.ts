import { useQuery } from "@tanstack/react-query";
import { qk } from "../lib/query";
import { supabase } from "../lib/supabase";
import { GAME_CARD_COLUMNS, PROFILE_PUBLIC, type GameRow, type LeaderboardRow, type ProfileRow } from "../lib/types";
import { useAuth } from "../state/auth";

export type CreatorLite = Pick<ProfileRow, "id" | "handle" | "display_name" | "avatar_url" | "avatar_seed" | "verified" | "follower_count">;

export interface GameDetail extends GameRow {
  creator: CreatorLite;
  liked: boolean;
  saved: boolean;
  following: boolean;
  best: number | null;
  version: { id: string; semver: string; release_notes: string | null; created_at: string } | null;
}

export async function fetchGame(slug: string, userId: string | null): Promise<GameDetail | null> {
  const { data, error } = await supabase
    .from("games")
    .select(`${GAME_CARD_COLUMNS}, creator:profiles!games_creator_id_fkey(id, handle, display_name, avatar_url, avatar_seed, verified, follower_count)`)
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const g = data as unknown as GameRow & { creator: CreatorLite };
  const [version, liked, saved, following, best] = await Promise.all([
    g.live_version_id
      ? supabase.from("game_versions").select("id, semver, release_notes, created_at").eq("id", g.live_version_id).maybeSingle()
      : Promise.resolve({ data: null }),
    userId ? supabase.from("likes").select("game_id").eq("user_id", userId).eq("game_id", g.id).maybeSingle() : Promise.resolve({ data: null }),
    userId ? supabase.from("saves").select("game_id").eq("user_id", userId).eq("game_id", g.id).maybeSingle() : Promise.resolve({ data: null }),
    userId ? supabase.from("follows").select("followee_id").eq("follower_id", userId).eq("followee_id", g.creator_id).maybeSingle() : Promise.resolve({ data: null }),
    userId ? supabase.from("best_scores").select("best_score").eq("user_id", userId).eq("game_id", g.id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  return {
    ...g,
    version: (version.data as GameDetail["version"]) ?? null,
    liked: !!liked.data,
    saved: !!saved.data,
    following: !!following.data,
    best: (best.data as { best_score: number } | null)?.best_score ?? null,
  };
}

export function useGame(slug: string) {
  const userId = useAuth((s) => s.userId);
  return useQuery({ queryKey: [...qk.game(slug), userId], queryFn: () => fetchGame(slug, userId), enabled: !!slug });
}

export function useLeaderboard(gameId: string | undefined, scope: "daily" | "allTime" | "friends") {
  const userId = useAuth((s) => s.userId);
  return useQuery({
    queryKey: [...qk.leaderboard(gameId ?? "", scope), userId],
    enabled: !!gameId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("leaderboard", { p_game_id: gameId, p_scope: scope, p_limit: 20 });
      if (error) throw error;
      return (data ?? []) as LeaderboardRow[];
    },
  });
}

export function useCreatorGames(creatorId: string | undefined) {
  return useQuery({
    queryKey: qk.gamesByCreator(creatorId ?? ""),
    enabled: !!creatorId,
    queryFn: async () => {
      const { data, error } = await supabase.from("games").select(GAME_CARD_COLUMNS).eq("creator_id", creatorId!).eq("status", "live").order("published_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as GameRow[];
    },
  });
}

export interface ProfileDetail extends ProfileRow {
  following: boolean;
  followsMe: boolean;
  blocked: boolean;
}

export function useProfile(handle: string) {
  const userId = useAuth((s) => s.userId);
  return useQuery({
    queryKey: [...qk.profile(handle), userId],
    enabled: !!handle,
    queryFn: async (): Promise<ProfileDetail | null> => {
      const { data, error } = await supabase.from("profiles").select(`${PROFILE_PUBLIC}, bio, interests, age_band, dock_coach_shown`).eq("handle", handle).maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const p = data as ProfileRow;
      if (!userId || userId === p.id) return { ...p, following: false, followsMe: false, blocked: false };
      const [f1, f2, b] = await Promise.all([
        supabase.from("follows").select("followee_id").eq("follower_id", userId).eq("followee_id", p.id).maybeSingle(),
        supabase.from("follows").select("follower_id").eq("follower_id", p.id).eq("followee_id", userId).maybeSingle(),
        supabase.from("blocks").select("blocked_id").eq("blocker_id", userId).eq("blocked_id", p.id).maybeSingle(),
      ]);
      return { ...p, following: !!f1.data, followsMe: !!f2.data, blocked: !!b.data };
    },
  });
}

export type ProfileTab = "games" | "liked" | "saved" | "best";
export type TileGame = Pick<GameRow, "id" | "slug" | "name" | "poster_url" | "accent_color" | "play_count" | "score_config"> & { best?: number };

const TILE = "id, slug, name, poster_url, accent_color, play_count, score_config, status";

export function useProfileTab(userId: string | undefined, tab: ProfileTab) {
  return useQuery({
    queryKey: qk.profileTab(userId ?? "", tab),
    enabled: !!userId,
    queryFn: async (): Promise<TileGame[]> => {
      const live = (g: (TileGame & { status?: string }) | null) => !!g && g.status === "live";
      if (tab === "games") {
        const { data, error } = await supabase.from("games").select(TILE).eq("creator_id", userId!).eq("status", "live").order("published_at", { ascending: false });
        if (error) throw error;
        return (data ?? []) as TileGame[];
      }
      if (tab === "best") {
        const { data, error } = await supabase.from("best_scores").select(`best_score, game:games(${TILE})`).eq("user_id", userId!).order("achieved_at", { ascending: false }).limit(60);
        if (error) throw error;
        return ((data ?? []) as unknown as { best_score: number; game: TileGame | null }[]).filter((r) => live(r.game)).map((r) => ({ ...r.game!, best: r.best_score }));
      }
      const table = tab === "liked" ? "likes" : "saves";
      const { data, error } = await supabase.from(table).select(`created_at, game:games(${TILE})`).eq("user_id", userId!).order("created_at", { ascending: false }).limit(90);
      if (error) throw error;
      return ((data ?? []) as unknown as { game: TileGame | null }[]).filter((r) => live(r.game)).map((r) => r.game!);
    },
  });
}
