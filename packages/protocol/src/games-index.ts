import { z } from "zod";
import { ManifestSchema } from "./manifest.ts";

/**
 * `dist/games/games-index.json` — produced by `pnpm games:build` (Creator & Games stream),
 * consumed by `pnpm seed` (Player Platform stream), which uploads each bundle to the
 * `game-bundles` bucket and creates the game, version and creator rows.
 *
 * Layout on disk:
 *   dist/games/games-index.json
 *   dist/games/<slug>/bundle/...      built game files (thumbcade.json at the root)
 *   dist/games/<slug>/icon.png        1024x1024
 *   dist/games/<slug>/poster.jpg      1080x1920
 */
export const GamesIndexEntrySchema = z.object({
  manifest: ManifestSchema,
  /** Directory of the built bundle, relative to dist/games/. */
  bundleDir: z.string(),
  /** Every file in the bundle, relative to bundleDir. */
  files: z.array(z.string()).min(1),
  /** Relative to dist/games/. */
  icon: z.string(),
  poster: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  gzipBytes: z.number().int().nonnegative(),
  /** Handle of the seed creator account that owns the game. */
  creatorHandle: z.string(),
  /** Release notes for the seeded version. */
  notes: z.string().optional(),
});
export type GamesIndexEntry = z.infer<typeof GamesIndexEntrySchema>;

export const GamesIndexSchema = z.object({
  generatedAt: z.string(),
  games: z.array(GamesIndexEntrySchema),
});
export type GamesIndex = z.infer<typeof GamesIndexSchema>;

/**
 * Seed creator accounts the launch games are attributed to. The seed script creates them;
 * games reference them through `creatorHandle`.
 */
export const SEED_CREATORS = [
  { handle: "thumbcade", displayName: "Thumbcade Studio", verified: true, bio: "The house band. We make the games that make the feed." },
  { handle: "pixelwitch", displayName: "Ines Kroll", verified: true, bio: "Tiny games, big feelings. Berlin." },
  { handle: "lowpolyfox", displayName: "Kai Okafor", verified: false, bio: "Three.js after dark. Everything is a cube if you squint." },
  { handle: "quietmoves", displayName: "Mara Lindqvist", verified: false, bio: "Puzzles for the bus ride. Chess for the soul." },
  { handle: "juicefactory", displayName: "Tomás Rivera", verified: false, bio: "Screen shake is a love language." },
  { handle: "bitbybit", displayName: "Aiyana Brooks", verified: false, bio: "One input. Infinite runs." },
] as const;
export type SeedCreatorHandle = (typeof SEED_CREATORS)[number]["handle"];
