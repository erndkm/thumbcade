/**
 * POST /functions/v1/events  { events: ClientEvent[] }  ->  { accepted: number }
 * Batch analytics ingest. Events are tied to the caller's user id (anonymous installs included) and capped
 * per user per minute.
 */
import { HttpError, json, readJson, serve } from "../_shared/http.ts";
import { adminClient, requireCaller } from "../_shared/supa.ts";
import { EventsRequestSchema } from "../_shared/protocol.ts";

/**
 * Real play produces about five events per card, so this is generous; it keeps one install from steering
 * trending and the ranking signals (both rolled up from these events). The app's queue retries on 429.
 */
const MAX_EVENTS_PER_MINUTE = 600;

serve(["POST"], async (req) => {
  const caller = await requireCaller(req);
  const body = EventsRequestSchema.safeParse(await readJson(req));
  if (!body.success) {
    throw new HttpError(400, "invalid_events", body.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  }
  const db = adminClient();
  const since = new Date(Date.now() - 60_000).toISOString();
  const { count, error: cErr } = await db.from("feed_events").select("id", { count: "exact", head: true }).eq("user_id", caller.id).gte("created_at", since);
  if (cErr) throw cErr;
  if ((count ?? 0) + body.data.events.length > MAX_EVENTS_PER_MINUTE) throw new HttpError(429, "rate_limited", "Too many events. Try again in a minute.");
  const { data, error } = await db.rpc("ingest_events", { p_user: caller.id, p_events: body.data.events });
  if (error) throw error;
  return json(req, { accepted: Number(data ?? 0) });
});
