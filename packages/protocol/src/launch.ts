import { z } from "zod";

/**
 * Safe-area insets in CSS pixels, relative to the game viewport.
 * The game viewport never resizes during a card's life (see the Swipe Contract §5.3).
 */
export const InsetsSchema = z.object({
  top: z.number().nonnegative(),
  right: z.number().nonnegative(),
  bottom: z.number().nonnegative(),
  left: z.number().nonnegative(),
});
export type Insets = z.infer<typeof InsetsSchema>;

export const InsetSetSchema = z.object({
  /** Areas covered by the feed overlay while the card is in PREVIEW/ENDED/PAUSED (top tabs, action rail, caption). */
  preview: InsetsSchema,
  /** Areas covered while PLAYING (status bar only — the Dock lives outside the viewport). */
  play: InsetsSchema,
  /** Which set currently applies. */
  current: z.enum(["preview", "play"]),
});
export type InsetSet = z.infer<typeof InsetSetSchema>;

export const LaunchReasonSchema = z.enum(["feed", "gamePage", "challenge", "dev"]);
export type LaunchReason = z.infer<typeof LaunchReasonSchema>;

export const PlayerSchema = z.object({
  /** Opaque, stable per (user, game). Never the real user id. */
  id: z.string().min(8),
  name: z.string(),
  avatarUrl: z.string().nullable(),
  /** True for guests (not signed in). Guests can play; their scores are not ranked. */
  guest: z.boolean(),
});
export type Player = z.infer<typeof PlayerSchema>;

export const ChallengeSchema = z.object({
  fromName: z.string(),
  score: z.number(),
});
export type Challenge = z.infer<typeof ChallengeSchema>;

/** What `tc.init()` resolves with. */
export const LaunchContextSchema = z.object({
  sdkVersion: z.string(),
  gameId: z.string(),
  versionId: z.string(),
  player: PlayerSchema.nullable(),
  locale: z.string(),
  reducedMotion: z.boolean(),
  audio: z.object({ muted: z.boolean() }),
  insets: InsetSetSchema,
  challenge: ChallengeSchema.optional(),
  launchReason: LaunchReasonSchema,
  /** Deterministic seed for this launch (daily puzzles use the day seed from `dailySeed`). */
  seed: z.number().int(),
  /** Seed shared by every player today (UTC). Useful for daily challenges. */
  dailySeed: z.number().int(),
  /** The player's best score in this game, if any. */
  best: z.number().nullable(),
  /** Host environment, for diagnostics only. */
  host: z.enum(["ios", "android", "web", "simulator", "standalone"]),
});
export type LaunchContext = z.infer<typeof LaunchContextSchema>;
