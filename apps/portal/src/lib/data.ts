import "server-only";
import { gameEntryUrl, gameOrigin, ScoreConfigSchema, ControlsSchema, type Controls, type ScoreConfig } from "@thumbcade/protocol";
import { cache } from "react";
import { gameHostConfig } from "./env";
import { createPublicClient } from "./supabase/server";

/** Everything the web player needs to render one card (serializable; passed to client components). */
export interface WebCard {
  id: string;
  slug: string;
  name: string;
  description: string;
  tags: string[];
  iconUrl: string | null;
  posterUrl: string | null;
  accentColor: string;
  controls: Controls;
  score: ScoreConfig;
  audio: boolean;
  ageRating: string;
  stats: { plays: number; likes: number; comments: number; shares: number; saves: number };
  version: { id: string; semver: string; entryUrl: string; origin: string };
  creator: { id: string; handle: string; displayName: string; avatarUrl: string | null; avatarSeed: string; verified: boolean };
  topScore: number | null;
}

const GAME_SELECT = `
  id, slug, name, description, icon_url, poster_url, accent_color, tags, controls, score_config, audio, age_rating,
  play_count, like_count, comment_count, share_count, save_count, featured_rank, published_at,
  creator:profiles!games_creator_id_fkey ( id, handle, display_name, avatar_url, avatar_seed, verified ),
  version:game_versions!games_live_version_fk ( id, semver, manifest )
`;

type Row = {
  id: string;
  slug: string;
  name: string;
  description: string;
  icon_url: string | null;
  poster_url: string | null;
  accent_color: string;
  tags: string[];
  controls: unknown;
  score_config: unknown;
  audio: boolean;
  age_rating: string;
  play_count: number;
  like_count: number;
  comment_count: number;
  share_count: number;
  save_count: number;
  creator: { id: string; handle: string; display_name: string; avatar_url: string | null; avatar_seed: string; verified: boolean } | null;
  version: { id: string; semver: string; manifest: unknown } | null;
};

function toCard(r: Row): WebCard | null {
  if (!r.version || !r.creator) return null;
  const host = gameHostConfig();
  const manifest = (r.version.manifest ?? {}) as { entry?: string };
  const controls = ControlsSchema.safeParse(r.controls);
  const score = ScoreConfigSchema.safeParse(r.score_config);
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    description: r.description,
    tags: r.tags,
    iconUrl: r.icon_url,
    posterUrl: r.poster_url,
    accentColor: r.accent_color,
    controls: controls.success ? controls.data : { vertical: false, horizontal: false, multitouch: false, inputs: ["tap"] },
    score: score.success ? score.data : { order: "desc", max: 1_000_000, format: "integer" },
    audio: r.audio,
    ageRating: r.age_rating,
    stats: { plays: r.play_count, likes: r.like_count, comments: r.comment_count, shares: r.share_count, saves: r.save_count },
    version: {
      id: r.version.id,
      semver: r.version.semver,
      entryUrl: gameEntryUrl({ slug: r.slug, versionId: r.version.id, entry: manifest.entry ?? "index.html" }, host),
      origin: gameOrigin(r.slug, host),
    },
    creator: {
      id: r.creator.id,
      handle: r.creator.handle,
      displayName: r.creator.display_name,
      avatarUrl: r.creator.avatar_url,
      avatarSeed: r.creator.avatar_seed,
      verified: r.creator.verified,
    },
    topScore: null,
  };
}

/** Live games, featured first, then most played. */
export const getLiveGames = cache(async (limit = 24): Promise<WebCard[]> => {
  const supabase = createPublicClient();
  const { data, error } = await supabase
    .from("games")
    .select(GAME_SELECT)
    .eq("status", "live")
    .order("featured_rank", { ascending: true, nullsFirst: false })
    .order("play_count", { ascending: false })
    .limit(limit);
  if (error || !data) return [];
  const cards = (data as unknown as Row[]).map(toCard).filter((c): c is WebCard => c !== null);
  await attachTopScores(cards);
  return cards;
});

export const getGameBySlug = cache(async (slug: string): Promise<WebCard | null> => {
  const supabase = createPublicClient();
  const { data } = await supabase.from("games").select(GAME_SELECT).eq("slug", slug).eq("status", "live").maybeSingle();
  if (!data) return null;
  const card = toCard(data as unknown as Row);
  if (card) await attachTopScores([card]);
  return card;
});

async function attachTopScores(cards: WebCard[]) {
  if (cards.length === 0) return;
  const supabase = createPublicClient();
  await Promise.all(
    cards.map(async (c) => {
      const { data } = await supabase
        .from("best_scores")
        .select("best_score")
        .eq("game_id", c.id)
        .order("best_score", { ascending: c.score.order === "asc" })
        .limit(1)
        .maybeSingle();
      c.topScore = data?.best_score ?? null;
    }),
  );
}

export interface ChallengeInfo {
  code: string;
  score: number | null;
  fromName: string;
  fromHandle: string | null;
  fromAvatarUrl: string | null;
  fromAvatarSeed: string;
  game: WebCard;
}

/** Resolves a challenge code (service role: shares are not publicly readable). */
export const getChallenge = cache(async (code: string): Promise<ChallengeInfo | null> => {
  if (!/^[A-Za-z0-9]{6,12}$/.test(code)) return null;
  const { createServiceClient } = await import("./supabase/server");
  const admin = createServiceClient();
  const { data } = await admin
    .from("shares")
    .select("code, challenge_score, game_id, user:profiles ( handle, display_name, avatar_url, avatar_seed ), game:games ( slug )")
    .eq("code", code)
    .maybeSingle();
  if (!data) return null;
  const row = data as unknown as {
    code: string;
    challenge_score: number | null;
    user: { handle: string; display_name: string; avatar_url: string | null; avatar_seed: string } | null;
    game: { slug: string } | null;
  };
  if (!row.game) return null;
  const game = await getGameBySlug(row.game.slug);
  if (!game) return null;
  return {
    code: row.code,
    score: row.challenge_score,
    fromName: row.user?.display_name ?? "A friend",
    fromHandle: row.user?.handle ?? null,
    fromAvatarUrl: row.user?.avatar_url ?? null,
    fromAvatarSeed: row.user?.avatar_seed ?? code,
    game,
  };
});

export const getPlatformStats = cache(async () => {
  const supabase = createPublicClient();
  const [{ count: games }, { count: creators }] = await Promise.all([
    supabase.from("games").select("id", { count: "exact", head: true }).eq("status", "live"),
    supabase.from("profiles").select("id", { count: "exact", head: true }).in("role", ["creator", "admin"]),
  ]);
  return { games: games ?? 0, creators: creators ?? 0 };
});

export const getLeaders = cache(async (gameId: string, order: "asc" | "desc", limit = 10) => {
  const supabase = createPublicClient();
  const { data } = await supabase
    .from("best_scores")
    .select("best_score, user:profiles ( handle, display_name, avatar_url, avatar_seed )")
    .eq("game_id", gameId)
    .order("best_score", { ascending: order === "asc" })
    .limit(limit);
  const rows = (data ?? []) as unknown as { best_score: number; user: { handle: string; display_name: string; avatar_url: string | null; avatar_seed: string } | null }[];
  return rows.map((r, i) => ({
    rank: i + 1,
    name: r.user?.display_name ?? "Player",
    handle: r.user?.handle ?? "player",
    avatarUrl: r.user?.avatar_url ?? null,
    avatarSeed: r.user?.avatar_seed ?? String(i),
    score: r.best_score,
  }));
});
