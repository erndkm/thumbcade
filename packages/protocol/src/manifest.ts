import { z } from "zod";

/**
 * `thumbcade.json` — the manifest every game ships at the root of its bundle.
 * The CLI validates it before upload, `creator-publish` validates it again server-side,
 * and the portal serves the generated JSON Schema at https://thumbcade.com/schema/manifest-v1.json.
 */

export const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;
export const HASHTAG_PATTERN = /^[a-z0-9_]{1,32}$/;
export const HEX_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;
export const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-.]+)?(?:\+[0-9A-Za-z-.]+)?$/;

export const AgeRatingSchema = z.enum(["4+", "9+", "12+", "17+"]);
export type AgeRating = z.infer<typeof AgeRatingSchema>;

export const InputKindSchema = z.enum(["tap", "swipe", "drag", "longpress", "hold", "joystick", "tilt"]);
export type InputKind = z.infer<typeof InputKindSchema>;

export const ControlsSchema = z
  .object({
    /**
     * True if the game uses ANY vertical motion during play: swipes, drags, joysticks,
     * dragging pieces. When true, the game owns the whole surface while PLAYING and the
     * feed is reachable only through the Dock or a two-finger swipe. See the Swipe Contract.
     */
    vertical: z.boolean(),
    /** True if the game uses horizontal swipes/drags. Informational; the feed never claims horizontal motion. */
    horizontal: z.boolean().default(false),
    /** True if the game needs two or more simultaneous touches. Disables the two-finger feed swipe. */
    multitouch: z.boolean().default(false),
    /** The input kinds used. Shown to players as a hint chip and used by discovery. */
    inputs: z.array(InputKindSchema).min(1).default(["tap"]),
  })
  .strict();
export type Controls = z.infer<typeof ControlsSchema>;

export const ScoreConfigSchema = z
  .object({
    /** "desc" = higher is better (points). "asc" = lower is better (times, moves). */
    order: z.enum(["desc", "asc"]).default("desc"),
    /** Scores above this are rejected by `session-end`. */
    max: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    /** How the shell renders the score. "ms" renders 12.345s. */
    format: z.enum(["integer", "ms"]).default("integer"),
    /** Optional unit label rendered after integers, e.g. "m" or "pts". */
    unit: z.string().max(6).optional(),
  })
  .strict();
export type ScoreConfig = z.infer<typeof ScoreConfigSchema>;

const relativeAssetPath = z
  .string()
  .min(1)
  .max(200)
  .refine((p) => !p.startsWith("/") && !p.includes("..") && !/^[a-z]+:/i.test(p), {
    message: "Must be a relative path inside the bundle",
  });

export const ManifestSchema = z
  .object({
    $schema: z.string().optional(),
    /** Globally unique slug. Immutable after first publish. Becomes the game's origin: <id>.thumbcade.gg */
    id: z.string().regex(SLUG_PATTERN, "lowercase letters, digits and dashes, 3-40 chars"),
    name: z.string().trim().min(1).max(32),
    version: z.string().regex(SEMVER_PATTERN, "must be semver, e.g. 1.0.0"),
    /** SDK semver range the game was built against, e.g. "^1.0.0". */
    sdk: z.string().regex(/^[~^]?\d+\.\d+\.\d+$/, 'e.g. "^1.0.0"'),
    entry: relativeAssetPath.default("index.html"),
    description: z.string().trim().min(1).max(120),
    tags: z
      .array(z.string().regex(HASHTAG_PATTERN, "hashtags are lowercase a-z, 0-9 and _"))
      .min(1)
      .max(5),
    accentColor: z.string().regex(HEX_COLOR_PATTERN, "6-digit hex, e.g. #FF6A1A"),
    /** 1024x1024 PNG — the game's profile picture. */
    icon: relativeAssetPath,
    /** 1080x1920 portrait still. Auto-captured by the reviewer if omitted. */
    poster: relativeAssetPath.optional(),
    ageRating: AgeRatingSchema.default("9+"),
    controls: ControlsSchema,
    /** short < 60s, medium < 5 min, long otherwise (typical run length). */
    session: z.enum(["short", "medium", "long"]).default("short"),
    audio: z.boolean().default(true),
    orientation: z.literal("portrait").default("portrait"),
    score: ScoreConfigSchema,
  })
  .strict();

export type Manifest = z.infer<typeof ManifestSchema>;
export type ManifestInput = z.input<typeof ManifestSchema>;

export const MANIFEST_FILENAME = "thumbcade.json";
export const MANIFEST_SCHEMA_URL = "https://thumbcade.com/schema/manifest-v1.json";

/** Parses a manifest and returns human-readable issues instead of throwing. */
export function validateManifest(
  input: unknown,
): { ok: true; manifest: Manifest } | { ok: false; issues: string[] } {
  const result = ManifestSchema.safeParse(input);
  if (result.success) return { ok: true, manifest: result.data };
  return {
    ok: false,
    issues: result.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
  };
}

/** Major version a manifest's `sdk` range targets. */
export function sdkMajorOf(range: string): number {
  const match = /(\d+)\./.exec(range);
  return match ? Number(match[1]) : 0;
}
