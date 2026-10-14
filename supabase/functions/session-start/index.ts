/**
 * POST /functions/v1/session-start  SessionStartRequest -> SessionStartResponse
 * Opens a play session and returns a signed token that session-end requires.
 */
import { HttpError, json, readJson, serve } from "../_shared/http.ts";
import { adminClient, requireCaller } from "../_shared/supa.ts";
import { signSessionToken } from "../_shared/token.ts";
import { SessionStartRequestSchema, type SessionStartResponse } from "../_shared/protocol.ts";

const SECRET = Deno.env.get("SESSION_SIGNING_SECRET") ?? "";

serve(["POST"], async (req) => {
  const caller = await requireCaller(req);
  const body = SessionStartRequestSchema.safeParse(await readJson(req));
  if (!body.success) throw new HttpError(400, "invalid_request", body.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  const { gameId, versionId, launchReason } = body.data;
  const { data, error } = await adminClient().rpc("start_play_session", {
    p_user: caller.id,
    p_game: gameId,
    p_version: versionId,
    p_reason: launchReason,
  });
  if (error) {
    if (/game_not_live|version_mismatch/.test(error.message)) throw new HttpError(404, "not_found", "That game version is not live.");
    throw error;
  }
  const sessionId = String(data);
  const token = await signSessionToken({ sid: sessionId, uid: caller.id, gid: gameId, iat: Date.now() }, SECRET);
  const res: SessionStartResponse = { sessionId, token };
  return json(req, res);
});
