/**
 * POST /functions/v1/share-create  { gameId, channel, score? }  ->  { code, gameUrl, challengeUrl }
 * Records a share (bumps the game's share counter) and mints a code. Challenges embed a score, which
 * may not beat the caller's verified best.
 * Members only (anonymous guests get 403); the app shares the plain game URL for guests.
 */
import { HttpError, json, readJson, serve } from "../_shared/http.ts";
import { adminClient, requireCaller } from "../_shared/supa.ts";
import { shareCode } from "../_shared/codes.ts";
import { ShareCreateRequestSchema, challengeShareUrl, gameShareUrl, type ShareCreateResponse } from "../_shared/protocol.ts";

const PORTAL_URL = (Deno.env.get("PORTAL_URL") ?? "http://localhost:3000").replace(/\/$/, "");

serve(["POST"], async (req) => {
  const caller = await requireCaller(req);
  // Share codes (and the challenges they carry) belong to members; guests share the plain game URL.
  if (caller.isAnonymous) throw new HttpError(403, "members_only", "Sign up to create challenge links.");
  const body = ShareCreateRequestSchema.safeParse(await readJson(req));
  if (!body.success) throw new HttpError(400, "invalid_request", body.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  const { gameId, channel, score } = body.data;
  if (channel === "challenge" && score === undefined) throw new HttpError(400, "score_required", "A challenge needs a score to beat.");

  const db = adminClient();
  const { data: game, error: gErr } = await db.from("games").select("id, slug, status, score_config").eq("id", gameId).maybeSingle();
  if (gErr) throw gErr;
  if (!game || game.status !== "live") throw new HttpError(404, "not_found", "That game is not live.");
  const cfg = game.score_config as { max?: number; order?: "asc" | "desc" } | null;
  const max = Number(cfg?.max ?? Number.MAX_SAFE_INTEGER);
  if (score !== undefined && score > max) throw new HttpError(400, "over_max", "That score is above what this game allows.");
  if (score !== undefined) {
    // A challenge can only carry a score the caller actually reached: session-end verified it into best_scores.
    const { data: best, error: bErr } = await db.from("best_scores").select("best_score").eq("game_id", gameId).eq("user_id", caller.id).maybeSingle();
    if (bErr) throw bErr;
    const beyondBest = !best || (cfg?.order === "asc" ? score < best.best_score : score > best.best_score);
    if (beyondBest) throw new HttpError(400, "unverified_score", "Challenges can only use a score you've played.");
  }

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = shareCode(8);
    const { error } = await db.from("shares").insert({
      code,
      user_id: caller.id,
      game_id: gameId,
      channel,
      challenge_score: channel === "challenge" ? score : null,
    });
    if (!error) {
      const res: ShareCreateResponse = {
        code,
        gameUrl: gameShareUrl(game.slug, PORTAL_URL),
        challengeUrl: channel === "challenge" ? challengeShareUrl(code, PORTAL_URL) : null,
      };
      return json(req, res);
    }
    if (error.code !== "23505") throw error;
  }
  throw new HttpError(503, "busy", "Could not mint a share code. Try again.");
});
