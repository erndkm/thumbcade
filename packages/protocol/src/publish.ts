import { z } from "zod";

/**
 * Creator publishing API (owned by the Creator & Games stream).
 *
 * POST /functions/v1/creator-publish
 *   Authorization: Bearer tc_<creator token>
 *   Content-Type: multipart/form-data
 *     manifest: JSON string (thumbcade.json)
 *     bundle:   application/zip — the built game; thumbcade.json at the zip root
 *     notes:    optional release notes (<= 500 chars)
 *
 * Failures before anything is stored (bad token, invalid manifest, oversize bundle, slug owned by
 * someone else, duplicate version) answer HTTP 4xx with `PublishErrorBody` — there is no version and
 * no review link yet. `auto_failed` is set later by the reviewer callback.
 *
 * GET /functions/v1/creator-publish                 -> `CreatorWhoAmI` (token check for `thumbcade login`)
 * GET /functions/v1/creator-publish?versionId=<id>  -> `VersionStatusResponse` (`thumbcade publish --wait`)
 *
 * Bundles are stored immutably in the `game-bundles` bucket at `<slug>/<versionId>/<path>`
 * and served from the games origin at `<origin>/<versionId>/<path>` (prod: <slug>.thumbcade.gg,
 * local: game-host at http://<host>:5555/<slug>/<versionId>/<path>).
 */

export const CREATOR_TOKEN_PREFIX = "tc_";

export const PublishResponseSchema = z.object({
  gameId: z.string().uuid(),
  versionId: z.string().uuid(),
  status: z.enum(["auto_checking", "auto_failed"]),
  reviewUrl: z.string().url(),
  /** Present when status is auto_failed before upload (e.g. manifest or size). */
  issues: z.array(z.string()).optional(),
});
export type PublishResponse = z.infer<typeof PublishResponseSchema>;

export const PublishErrorBodySchema = z.object({
  error: z.enum(["unauthorized", "invalid_manifest", "too_large", "slug_taken", "duplicate_version", "invalid_request", "internal"]).or(z.string()),
  message: z.string(),
  issues: z.array(z.string()).optional(),
});
export type PublishErrorBody = z.infer<typeof PublishErrorBodySchema>;

export const VersionStatusSchema = z.enum([
  "uploaded",
  "auto_checking",
  "auto_failed",
  "pending_review",
  "approved",
  "rejected",
]);
export type VersionStatus = z.infer<typeof VersionStatusSchema>;

export const CreatorWhoAmISchema = z.object({
  handle: z.string(),
  displayName: z.string(),
  role: z.enum(["user", "creator", "admin"]),
  games: z.array(z.object({ slug: z.string(), name: z.string(), status: z.string(), liveVersionId: z.string().nullable() })),
});
export type CreatorWhoAmI = z.infer<typeof CreatorWhoAmISchema>;

export const ReviewCheckIdSchema = z.enum([
  "manifest",
  "size",
  "static_scan",
  /** Runtime requests to other origins (blocked by CSP, recorded by the probe). */
  "network",
  "loads",
  "ready_budget",
  "tap_starts",
  "no_swipe_start",
  "pause_stops_loop",
  "pause_stops_audio",
  "no_uncaught_errors",
  "fps",
  "long_tasks",
  "heap",
  "insets",
  "gameplay_end",
]);
export type ReviewCheckId = z.infer<typeof ReviewCheckIdSchema>;

export const ReviewCheckSchema = z.object({
  id: ReviewCheckIdSchema,
  label: z.string(),
  status: z.enum(["pass", "fail", "warn", "skip"]),
  detail: z.string().optional(),
  /** Measured value when the check is numeric (ms, bytes, fps). */
  value: z.number().optional(),
  /** Budget the value was compared against. */
  budget: z.number().optional(),
});
export type ReviewCheck = z.infer<typeof ReviewCheckSchema>;

export const ReviewReportSchema = z.object({
  versionId: z.string().uuid(),
  startedAt: z.string(),
  finishedAt: z.string(),
  passed: z.boolean(),
  checks: z.array(ReviewCheckSchema),
  metrics: z.object({
    readyMs: z.number().nullable(),
    initialPayloadGzipBytes: z.number().nullable(),
    totalBytes: z.number().nullable(),
    fps: z.number().nullable(),
    longestTaskMs: z.number().nullable(),
    heapBytes: z.number().nullable(),
  }),
  console: z.array(z.object({ level: z.string(), text: z.string() })).max(200),
  /** Public URLs of screenshots (game-assets bucket). */
  screenshots: z.array(z.string()),
  posterCaptured: z.boolean(),
  reviewerVersion: z.string(),
});
export type ReviewReport = z.infer<typeof ReviewReportSchema>;

/** POST /functions/v1/creator-review-callback (service-role only; called by services/reviewer). */
export const ReviewCallbackRequestSchema = z.object({
  jobId: z.string().uuid(),
  report: ReviewReportSchema,
  /** Storage path of the captured poster, when the manifest had none. */
  posterPath: z.string().optional(),
});
export type ReviewCallbackRequest = z.infer<typeof ReviewCallbackRequestSchema>;

/**
 * CLI device-code login (portal routes):
 *   POST {portal}/api/cli/device                      -> DeviceCodeStartResponse
 *   POST {portal}/api/cli/device/poll { deviceCode }  -> DeviceCodePollResponse
 *   The user approves at {portal}/cli/activate?code=<userCode> while signed in as a creator.
 */
export const DeviceCodeStartResponseSchema = z.object({
  deviceCode: z.string(),
  userCode: z.string(),
  verificationUrl: z.string().url(),
  expiresIn: z.number().int(),
  interval: z.number().int(),
});
export type DeviceCodeStartResponse = z.infer<typeof DeviceCodeStartResponseSchema>;

export const DeviceCodePollResponseSchema = z.union([
  z.object({ status: z.literal("pending") }),
  z.object({ status: z.literal("expired") }),
  z.object({ status: z.literal("approved"), token: z.string(), handle: z.string() }),
]);
export type DeviceCodePollResponse = z.infer<typeof DeviceCodePollResponseSchema>;



export const VersionStatusResponseSchema = z.object({
  versionId: z.string().uuid(),
  slug: z.string(),
  semver: z.string(),
  status: VersionStatusSchema,
  reviewUrl: z.string().url(),
  reviewNotes: z.string().nullable(),
  report: z.object({ passed: z.boolean(), checks: z.array(ReviewCheckSchema.partial({ value: true, budget: true, detail: true })) }).nullable(),
});
export type VersionStatusResponse = z.infer<typeof VersionStatusResponseSchema>;
