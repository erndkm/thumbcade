/**
 * GET /functions/v1/challenge-resolve?code=  ->  ChallengeResolveResponse
 * Resolves a share/challenge code to its game and challenger; counts the open.
 */
import { HttpError, json, serve } from "../_shared/http.ts";
import { adminClient } from "../_shared/supa.ts";
import { SHARE_CODE_PATTERN } from "../_shared/codes.ts";
import { type ChallengeResolveResponse } from "../_shared/protocol.ts";

interface Resolved {
  code: string;
  game_id: string;
  game_slug: string;
  from_name: string | null;
  from_handle: string | null;
  from_guest: boolean | null;
  score: number | null;
}

serve(["GET"], async (req) => {
  const code = new URL(req.url).searchParams.get("code") ?? "";
  if (!SHARE_CODE_PATTERN.test(code)) throw new HttpError(404, "not_found", "That challenge link doesn't exist.");
  const { data, error } = await adminClient().rpc("resolve_share", { p_code: code });
  if (error) throw error;
  const row = ((data ?? []) as Resolved[])[0];
  if (!row) throw new HttpError(404, "not_found", "That challenge link doesn't exist or the game is gone.");
  const res: ChallengeResolveResponse = {
    code: row.code,
    gameSlug: row.game_slug,
    gameId: row.game_id,
    fromName: row.from_name ?? "A player",
    fromHandle: row.from_guest ? null : row.from_handle,
    score: row.score,
  };
  return json(req, res);
});
