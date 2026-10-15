/**
 * POST /functions/v1/session-progress  SessionProgressRequest -> SessionProgressResponse
 * Reports a run's active playtime before it ends. The server clamps it to wall-clock time, never lowers it,
 * and marks the run as a play once it reaches QUALIFIED_PLAY_MS (docs/analytics).
 */
import { HttpError, json, readJson, serve } from "../_shared/http.ts";
import { adminClient, requireCaller } from "../_shared/supa.ts";
import { verifySessionToken } from "../_shared/token.ts";
import { SessionProgressRequestSchema, type SessionProgressResponse } from "../_shared/protocol.ts";

const SECRET = Deno.env.get("SESSION_SIGNING_SECRET") ?? "";

serve(["POST"], async (req) => {
  const caller = await requireCaller(req);
  const body = SessionProgressRequestSchema.safeParse(await readJson(req));
  if (!body.success) throw new HttpError(400, "invalid_request", body.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  const { sessionId, token, activeMs } = body.data;

  const claims = await verifySessionToken(token, SECRET);
  if (!claims || claims.sid !== sessionId || claims.uid !== caller.id) throw new HttpError(403, "bad_token", "That session isn't yours.");

  const { data, error } = await adminClient().rpc("record_session_progress", { p_session: sessionId, p_user: caller.id, p_active_ms: activeMs });
  if (error) {
    if (/rate_limited/.test(error.message)) throw new HttpError(429, "rate_limited", "Progress is reported at most every few seconds.");
    if (/bad_session/.test(error.message)) throw new HttpError(404, "not_found", "No such session.");
    throw error;
  }
  const row = ((data ?? []) as { stored_ms: number; is_qualified: boolean }[])[0];
  if (!row) throw new HttpError(500, "internal", "Progress could not be stored.");
  const res: SessionProgressResponse = { activeMs: row.stored_ms, qualified: row.is_qualified };
  return json(req, res);
});
