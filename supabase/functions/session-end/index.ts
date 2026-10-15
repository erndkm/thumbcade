/**
 * POST /functions/v1/session-end  SessionEndRequest -> SessionEndResponse
 * Light score integrity: a valid signed token for this caller and session, score <= manifest max,
 * a duration the server clock agrees with. Guests get their best and percentile but are not ranked.
 */
import { HttpError, json, readJson, serve } from "../_shared/http.ts";
import { adminClient, requireCaller } from "../_shared/supa.ts";
import { verifySessionToken } from "../_shared/token.ts";
import { SessionEndRequestSchema, SessionRejectReasonSchema, type SessionEndResponse } from "../_shared/protocol.ts";

const SECRET = Deno.env.get("SESSION_SIGNING_SECRET") ?? "";

interface FinishRow {
  accepted: boolean;
  reason: string | null;
  best: number | null;
  is_new_best: boolean;
  percentile: number | null;
  daily_rank: number | null;
}

serve(["POST"], async (req) => {
  const caller = await requireCaller(req);
  const body = SessionEndRequestSchema.safeParse(await readJson(req));
  if (!body.success) throw new HttpError(400, "invalid_request", body.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  const { sessionId, token, score, durationMs, activeMs, outcome } = body.data;

  const claims = await verifySessionToken(token, SECRET);
  if (!claims || claims.sid !== sessionId || claims.uid !== caller.id) {
    const res: SessionEndResponse = { accepted: false, reason: "bad_token", best: null, isNewBest: false, percentile: null, dailyRank: null };
    return json(req, res);
  }

  const { data, error } = await adminClient().rpc("finish_play_session", {
    p_session: sessionId,
    p_user: caller.id,
    p_score: score,
    p_duration_ms: durationMs,
    p_outcome: outcome ?? null,
    p_active_ms: activeMs ?? null,
  });
  if (error) throw error;
  const row = ((data ?? []) as FinishRow[])[0];
  if (!row) throw new HttpError(500, "internal", "Session could not be finished.");
  const res: SessionEndResponse = {
    accepted: row.accepted,
    best: row.best,
    isNewBest: row.is_new_best,
    percentile: row.percentile === null ? null : Math.round(row.percentile * 10) / 10,
    dailyRank: row.daily_rank,
  };
  if (row.reason) {
    // The SQL reasons are exactly the contract's SessionRejectReason enum; anything else is a bug.
    const reason = SessionRejectReasonSchema.safeParse(row.reason);
    if (!reason.success) throw new HttpError(500, "internal", `Unexpected reject reason: ${row.reason}`);
    res.reason = reason.data;
  }
  return json(req, res);
});
