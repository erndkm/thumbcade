/**
 * POST /functions/v1/notify  (service role only)  ->  { sent, skipped }
 * Push fan-out: sends Expo push messages for inbox notifications that have not been pushed yet.
 * Called every minute by pg_cron (public.dispatch_push) when there is something to send.
 */
import { HttpError, json, serve } from "../_shared/http.ts";
import { adminClient, isServiceRequest } from "../_shared/supa.ts";
import { pushCopy } from "../_shared/copy.ts";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const EXPO_ACCESS_TOKEN = Deno.env.get("EXPO_ACCESS_TOKEN") ?? "";

interface Row {
  id: string;
  user_id: string;
  type: string;
  payload: Record<string, unknown> | null;
  actor: { handle: string } | null;
  game: { name: string; slug: string } | null;
}

interface ExpoTicket {
  status: "ok" | "error";
  details?: { error?: string };
}

serve(["POST"], async (req) => {
  if (!isServiceRequest(req)) throw new HttpError(401, "unauthorized", "Service role only.");
  const db = adminClient();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await db
    .from("notifications")
    .select("id, user_id, type, payload, actor:profiles!notifications_actor_id_fkey(handle), game:games(name, slug)")
    .is("pushed_at", null)
    .gte("created_at", since)
    .order("created_at", { ascending: true })
    .limit(500);
  if (error) throw error;
  const rows = (data ?? []) as unknown as Row[];
  if (rows.length === 0) return json(req, { sent: 0, skipped: 0 });

  const userIds = [...new Set(rows.map((r) => r.user_id))];
  const { data: tokens, error: tErr } = await db.from("push_tokens").select("user_id, token").in("user_id", userIds);
  if (tErr) throw tErr;
  const byUser = new Map<string, string[]>();
  for (const t of tokens ?? []) byUser.set(t.user_id, [...(byUser.get(t.user_id) ?? []), t.token]);

  const messages: { to: string; title: string; body: string; data: { url: string; notificationId: string }; sound: "default" }[] = [];
  let skipped = 0;
  for (const r of rows) {
    const copy = pushCopy({
      type: r.type,
      payload: r.payload,
      actorHandle: r.actor?.handle ?? null,
      gameName: r.game?.name ?? null,
      gameSlug: r.game?.slug ?? null,
    });
    const userTokens = byUser.get(r.user_id) ?? [];
    if (!copy || userTokens.length === 0) {
      skipped++;
      continue;
    }
    for (const to of userTokens) messages.push({ to, title: copy.title, body: copy.body, data: { url: copy.url, notificationId: r.id }, sound: "default" });
  }

  let sent = 0;
  const dead: string[] = [];
  for (let i = 0; i < messages.length; i += 100) {
    const chunk = messages.slice(i, i + 100);
    const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json" };
    if (EXPO_ACCESS_TOKEN) headers.Authorization = `Bearer ${EXPO_ACCESS_TOKEN}`;
    try {
      const res = await fetch(EXPO_PUSH_URL, { method: "POST", headers, body: JSON.stringify(chunk) });
      const out = (await res.json()) as { data?: ExpoTicket[] };
      (out.data ?? []).forEach((t, j) => {
        if (t.status === "ok") sent++;
        else if (t.details?.error === "DeviceNotRegistered") dead.push(chunk[j]!.to);
      });
    } catch (e) {
      console.error("notify: expo push failed", e);
    }
  }
  if (dead.length) await db.from("push_tokens").delete().in("token", dead);

  const { error: uErr } = await db.from("notifications").update({ pushed_at: new Date().toISOString() }).in("id", rows.map((r) => r.id));
  if (uErr) throw uErr;
  return json(req, { sent, skipped });
});
