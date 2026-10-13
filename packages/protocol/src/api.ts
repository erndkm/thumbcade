import { z } from "zod";
import { AgeRatingSchema, ControlsSchema, ScoreConfigSchema } from "./manifest.ts";
import { LaunchReasonSchema } from "./launch.ts";

/**
 * Client <-> backend DTOs for the Supabase edge functions owned by the Player Platform.
 * Functions live at `${SUPABASE_URL}/functions/v1/<name>`.
 */

// ---------------------------------------------------------------------------
// Feed  —  GET /functions/v1/feed?tab=foryou|following&cursor=&limit=&tag=&first=<slug>
// ---------------------------------------------------------------------------

export const FeedTabSchema = z.enum(["foryou", "following"]);
export type FeedTab = z.infer<typeof FeedTabSchema>;

export const GameStatsSchema = z.object({
  plays: z.number().int().nonnegative(),
  likes: z.number().int().nonnegative(),
  comments: z.number().int().nonnegative(),
  shares: z.number().int().nonnegative(),
  saves: z.number().int().nonnegative(),
});
export type GameStats = z.infer<typeof GameStatsSchema>;

export const GameSummarySchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  name: z.string(),
  description: z.string(),
  iconUrl: z.string().nullable(),
  posterUrl: z.string().nullable(),
  accentColor: z.string(),
  tags: z.array(z.string()),
  ageRating: AgeRatingSchema,
  controls: ControlsSchema,
  session: z.enum(["short", "medium", "long"]),
  audio: z.boolean(),
  score: ScoreConfigSchema,
  stats: GameStatsSchema,
});
export type GameSummary = z.infer<typeof GameSummarySchema>;

export const CreatorSummarySchema = z.object({
  id: z.string().uuid(),
  handle: z.string(),
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
  /** Seed for the generative pixel avatar used when avatarUrl is null. */
  avatarSeed: z.string(),
  verified: z.boolean(),
});
export type CreatorSummary = z.infer<typeof CreatorSummarySchema>;

export const VersionRefSchema = z.object({
  id: z.string().uuid(),
  semver: z.string(),
  /** Fully-qualified entry URL on the games origin. */
  entryUrl: z.string().url(),
  /** Origin the WebView must be locked to. */
  origin: z.string().url(),
  sdkMajor: z.number().int(),
});
export type VersionRef = z.infer<typeof VersionRefSchema>;

export const ViewerStateSchema = z.object({
  liked: z.boolean(),
  saved: z.boolean(),
  followingCreator: z.boolean(),
  best: z.number().nullable(),
});
export type ViewerState = z.infer<typeof ViewerStateSchema>;

export const RankSourceSchema = z.enum(["personal", "explore", "following", "trending", "deeplink", "editorial", "tag"]);
export type RankSource = z.infer<typeof RankSourceSchema>;

export const FeedCardSchema = z.object({
  /** Unique per feed position; analytics events reference it. */
  cardId: z.string(),
  game: GameSummarySchema,
  version: VersionRefSchema,
  creator: CreatorSummarySchema,
  viewer: ViewerStateSchema,
  /** All-time top score for the game, for the caption meta line. */
  topScore: z.number().nullable(),
  rank: z.object({ source: RankSourceSchema, score: z.number().optional() }),
});
export type FeedCard = z.infer<typeof FeedCardSchema>;

export const FeedResponseSchema = z.object({
  feedId: z.string(),
  cards: z.array(FeedCardSchema),
  nextCursor: z.string().nullable(),
});
export type FeedResponse = z.infer<typeof FeedResponseSchema>;

// ---------------------------------------------------------------------------
// Events  —  POST /functions/v1/events  { events: ClientEvent[] }
// ---------------------------------------------------------------------------

export const FeedEventTypeSchema = z.enum([
  "impression",
  "ready",
  "play_start",
  "play_end",
  "skip",
  "replay",
  "like",
  "unlike",
  "save",
  "unsave",
  "share",
  "comment",
  "follow",
  "open_game_page",
  "load_failed",
  "custom",
]);
export type FeedEventType = z.infer<typeof FeedEventTypeSchema>;

export const CardPhaseNameSchema = z.enum(["LOADING", "PREVIEW", "PLAYING", "ENDED", "PAUSED", "OFFSCREEN", "FAILED"]);

export const ClientEventSchema = z.object({
  type: FeedEventTypeSchema,
  gameId: z.string().uuid().optional(),
  versionId: z.string().uuid().optional(),
  cardId: z.string().max(80).optional(),
  feedId: z.string().max(80).optional(),
  /** Client timestamp (ms since epoch). */
  ts: z.number().int(),
  /** Time the card was active before this event (skip, play_end). */
  dwellMs: z.number().int().nonnegative().optional(),
  /** Card phase at the time of the event (skip). */
  state: CardPhaseNameSchema.optional(),
  score: z.number().optional(),
  durationMs: z.number().int().nonnegative().optional(),
  meta: z.record(z.string(), z.union([z.string().max(120), z.number(), z.boolean()])).optional(),
});
export type ClientEvent = z.infer<typeof ClientEventSchema>;

export const EventsRequestSchema = z.object({ events: z.array(ClientEventSchema).min(1).max(200) });
export type EventsRequest = z.infer<typeof EventsRequestSchema>;

// ---------------------------------------------------------------------------
// Sessions  —  POST /functions/v1/session-start, /functions/v1/session-end
// ---------------------------------------------------------------------------

export const SessionStartRequestSchema = z.object({
  gameId: z.string().uuid(),
  versionId: z.string().uuid(),
  launchReason: LaunchReasonSchema,
});
export type SessionStartRequest = z.infer<typeof SessionStartRequestSchema>;

export const SessionStartResponseSchema = z.object({
  sessionId: z.string().uuid(),
  /** Signed token proving the session was issued by the server. */
  token: z.string(),
});
export type SessionStartResponse = z.infer<typeof SessionStartResponseSchema>;

export const SessionEndRequestSchema = z.object({
  sessionId: z.string().uuid(),
  token: z.string(),
  score: z.number().finite(),
  durationMs: z.number().int().nonnegative(),
  outcome: z.enum(["win", "lose", "quit"]).optional(),
});
export type SessionEndRequest = z.infer<typeof SessionEndRequestSchema>;

export const SessionEndResponseSchema = z.object({
  accepted: z.boolean(),
  /** Reason when not accepted (guest, over_max, too_fast, bad_token). */
  reason: z.string().optional(),
  best: z.number().nullable(),
  isNewBest: z.boolean(),
  /** Today's percentile of this score among all players (0-100, higher is better). */
  percentile: z.number().min(0).max(100).nullable(),
  dailyRank: z.number().int().nullable(),
});
export type SessionEndResponse = z.infer<typeof SessionEndResponseSchema>;

// ---------------------------------------------------------------------------
// Challenges  —  GET /functions/v1/challenge-resolve?code=
// ---------------------------------------------------------------------------

export const ChallengeResolveResponseSchema = z.object({
  code: z.string(),
  gameSlug: z.string(),
  gameId: z.string().uuid(),
  fromName: z.string(),
  fromHandle: z.string().nullable(),
  score: z.number().nullable(),
});
export type ChallengeResolveResponse = z.infer<typeof ChallengeResolveResponseSchema>;
