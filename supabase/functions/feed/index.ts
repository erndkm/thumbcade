/**
 * GET /functions/v1/feed?tab=foryou|following&cursor=&limit=8&tag=&first=<slug>
 * Ranked, infinite feed of playable cards (FeedResponse). Ranking lives in SQL (`rank_feed`);
 * this function owns the cursor and turns ranked ids into FeedCards.
 */
import { z } from "zod";
import { HttpError, json, serve } from "../_shared/http.ts";
import { adminClient, optionalCaller } from "../_shared/supa.ts";
import { advanceCursor, decodeCursor, encodeCursor, newFeedId, type FeedCursor } from "../_shared/cursor.ts";
import {
  AgeRatingSchema,
  ControlsSchema,
  FeedResponseSchema,
  FeedTabSchema,
  HASHTAG_PATTERN,
  SLUG_PATTERN,
  ScoreConfigSchema,
  gameEntryUrl,
  gameOrigin,
  sdkMajorOf,
  type FeedCard,
  type GameHostConfig,
  type RankSource,
} from "../_shared/protocol.ts";

const GAME_HOST: GameHostConfig = { mode: "path", base: Deno.env.get("GAME_HOST_BASE") ?? "http://127.0.0.1:5555" };

const QuerySchema = z.object({
  tab: FeedTabSchema.default("foryou"),
  cursor: z.string().max(8192).optional(),
  limit: z.coerce.number().int().min(1).max(20).default(8),
  tag: z.string().regex(HASHTAG_PATTERN).optional(),
  first: z.string().regex(SLUG_PATTERN).optional(),
});

interface Ranked {
  game_id: string;
  source: RankSource;
  score: number | null;
}

interface Hydrated {
  game_id: string;
  slug: string;
  name: string;
  description: string;
  icon_url: string | null;
  poster_url: string | null;
  accent_color: string;
  tags: string[];
  age_rating: string;
  controls: unknown;
  session_length: "short" | "medium" | "long";
  audio: boolean;
  score_config: unknown;
  play_count: number;
  like_count: number;
  comment_count: number;
  share_count: number;
  save_count: number;
  version_id: string;
  semver: string;
  entry: string;
  sdk: string;
  creator_id: string;
  creator_handle: string;
  creator_display_name: string;
  creator_avatar_url: string | null;
  creator_avatar_seed: string;
  creator_verified: boolean;
  liked: boolean;
  saved: boolean;
  following: boolean;
  viewer_best: number | null;
  top_score: number | null;
  allowed: boolean;
}

function toCard(h: Hydrated, cardId: string, rank: Ranked): FeedCard | null {
  const controls = ControlsSchema.safeParse(h.controls);
  const score = ScoreConfigSchema.safeParse(h.score_config);
  const age = AgeRatingSchema.safeParse(h.age_rating);
  if (!controls.success || !score.success || !age.success) {
    console.error(`feed: skipping ${h.slug}: invalid stored controls/score/age`);
    return null;
  }
  return {
    cardId,
    game: {
      id: h.game_id,
      slug: h.slug,
      name: h.name,
      description: h.description,
      iconUrl: h.icon_url,
      posterUrl: h.poster_url,
      accentColor: h.accent_color,
      tags: h.tags,
      ageRating: age.data,
      controls: controls.data,
      session: h.session_length,
      audio: h.audio,
      score: score.data,
      stats: {
        plays: Number(h.play_count),
        likes: h.like_count,
        comments: h.comment_count,
        shares: h.share_count,
        saves: h.save_count,
      },
    },
    version: {
      id: h.version_id,
      semver: h.semver,
      entryUrl: gameEntryUrl({ slug: h.slug, versionId: h.version_id, entry: h.entry }, GAME_HOST),
      origin: gameOrigin(h.slug, GAME_HOST),
      sdkMajor: sdkMajorOf(h.sdk),
    },
    creator: {
      id: h.creator_id,
      handle: h.creator_handle,
      displayName: h.creator_display_name,
      avatarUrl: h.creator_avatar_url,
      avatarSeed: h.creator_avatar_seed,
      verified: h.creator_verified,
    },
    viewer: { liked: h.liked, saved: h.saved, followingCreator: h.following, best: h.viewer_best },
    topScore: h.top_score,
    rank: rank.score === null ? { source: rank.source } : { source: rank.source, score: rank.score },
  };
}

serve(["GET"], async (req) => {
  const params = QuerySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!params.success) throw new HttpError(400, "invalid_query", params.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  const { tab, limit, tag, first } = params.data;
  const caller = await optionalCaller(req);
  const viewer = caller?.id ?? null;
  const db = adminClient();

  const start: FeedCursor = decodeCursor(params.data.cursor) ?? { feedId: newFeedId(), pos: 0, seen: [], lastCreator: null, lastTag: null };
  let cursor = start;
  const ranked: Ranked[] = [];

  // Deep links and the game page put one game first, then the feed continues as usual.
  if (first && start.pos === 0) {
    const { data, error } = await db.from("games").select("id, creator_id, tags").eq("slug", first).eq("status", "live").maybeSingle();
    if (error) throw error;
    if (data) {
      ranked.push({ game_id: data.id, source: "deeplink", score: null });
      cursor = advanceCursor(cursor, [{ gameId: data.id, creatorId: data.creator_id, primaryTag: (data.tags as string[])[0] ?? null }]);
    }
  }

  const rest = limit - ranked.length;
  if (rest > 0) {
    const { data, error } = await db.rpc("rank_feed", {
      p_viewer: viewer,
      p_cursor: { seen: cursor.seen, pos: cursor.pos, lastCreator: cursor.lastCreator, lastTag: cursor.lastTag },
      p_limit: rest,
      p_tab: tab,
      p_tag: tag ?? null,
    });
    if (error) throw error;
    for (const r of (data ?? []) as Ranked[]) ranked.push(r);
  }

  const ids = [...new Set(ranked.map((r) => r.game_id))];
  const byId = new Map<string, Hydrated>();
  if (ids.length > 0) {
    const { data, error } = await db.rpc("feed_hydrate", { p_viewer: viewer, p_game_ids: ids });
    if (error) throw error;
    for (const h of (data ?? []) as Hydrated[]) byId.set(h.game_id, h);
  }

  const cards: FeedCard[] = [];
  const served: { gameId: string; creatorId: string; primaryTag: string | null }[] = [];
  for (const r of ranked) {
    const h = byId.get(r.game_id);
    if (!h || !h.allowed) continue;
    const card = toCard(h, `${start.feedId}:${start.pos + cards.length}`, r);
    if (!card) continue;
    cards.push(card);
    served.push({ gameId: h.game_id, creatorId: h.creator_id, primaryTag: h.tags[0] ?? null });
  }

  const next = advanceCursor({ ...start }, served);
  const body = {
    feedId: start.feedId,
    cards,
    nextCursor: cards.length > 0 ? encodeCursor(next) : null,
  };
  const checked = FeedResponseSchema.safeParse(body);
  if (!checked.success) {
    console.error("feed: response failed contract validation", checked.error.issues.slice(0, 5));
    throw new HttpError(500, "contract_violation", "Feed response did not match the contract.");
  }
  return json(req, checked.data);
});
