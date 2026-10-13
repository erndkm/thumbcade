/**
 * POST /functions/v1/creator-review-callback   (service role only; called by services/reviewer)
 *   body: ReviewCallbackRequest { jobId, report: ReviewReport, posterPath? }
 *
 * Stores the automated review report on the version, moves it to `pending_review` (passed) or
 * `auto_failed`, closes the job, and records the poster the reviewer captured when the manifest had
 * none. Screenshots/posters are uploaded by the reviewer to game-assets/<slug>/...; only paths under
 * the game's own folder are accepted. Approval is the portal's job (approve_version RPC).
 */
import {
  adminClient,
  HttpError,
  isServiceRequest,
  json,
  publicObjectUrl,
  ReviewCallbackRequestSchema,
  serve,
  STORAGE_BUCKETS,
} from "../creator-publish/shared.ts";

serve(async (req) => {
  if (req.method !== "POST") throw new HttpError(405, "method_not_allowed", "POST only.");
  if (!isServiceRequest(req)) throw new HttpError(403, "forbidden", "Service role only.");
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new HttpError(400, "invalid_json", "Body must be JSON.");
  }
  const parsed = ReviewCallbackRequestSchema.safeParse(body);
  if (!parsed.success) {
    throw new HttpError(422, "invalid_report", "The report doesn't match ReviewCallbackRequestSchema.", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
  }
  const { jobId, report, posterPath } = parsed.data;
  const db = adminClient();

  const { data: job, error: jErr } = await db.from("review_jobs").select("id, version_id, status").eq("id", jobId).maybeSingle();
  if (jErr) throw jErr;
  if (!job) throw new HttpError(404, "not_found", "No such review job.");
  if (job.version_id !== report.versionId) throw new HttpError(422, "version_mismatch", "report.versionId doesn't belong to this job.");

  const { data: version, error: vErr } = await db.from("game_versions").select("id, status, game_id, manifest").eq("id", job.version_id).single();
  if (vErr) throw vErr;
  const { data: game, error: gErr } = await db.from("games").select("id, slug, poster_url").eq("id", version.game_id).single();
  if (gErr) throw gErr;

  const prefix = `${game.slug}/`;
  const ownAsset = (url: string) => url.includes(`/storage/v1/object/public/${STORAGE_BUCKETS.gameAssets}/${prefix}`);
  if (report.screenshots.some((u) => !ownAsset(u))) throw new HttpError(422, "bad_screenshot", `Screenshots must live under ${STORAGE_BUCKETS.gameAssets}/${prefix}.`);
  if (posterPath && !posterPath.startsWith(prefix)) throw new HttpError(422, "bad_poster", `posterPath must start with ${prefix}.`);

  // A human may already have decided (approve/reject) while an old job was running: never override that.
  const decided = version.status === "approved" || version.status === "rejected";
  const nextStatus = decided ? version.status : report.passed ? "pending_review" : "auto_failed";
  const { error: uErr } = await db.from("game_versions").update({ review_report: report, status: nextStatus }).eq("id", version.id);
  if (uErr) throw uErr;

  if (posterPath && !game.poster_url) {
    await db.from("games").update({ poster_url: publicObjectUrl(STORAGE_BUCKETS.gameAssets, posterPath) }).eq("id", game.id);
  }

  const { error: doneErr } = await db
    .from("review_jobs")
    .update({ status: "done", finished_at: new Date().toISOString(), error: null })
    .eq("id", job.id);
  if (doneErr) throw doneErr;

  return json({ ok: true, versionId: version.id, status: nextStatus });
});
