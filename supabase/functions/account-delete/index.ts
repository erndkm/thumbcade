/**
 * POST /functions/v1/account-delete  ->  { deleted: true }
 * In-app account deletion (App Store 5.1.1(v)). Removes the caller's auth user (profile, social graph,
 * sessions, scores, storage rows cascade), their analytics events, avatar files, and the bundles/assets
 * of games they created.
 */
import { json, serve } from "../_shared/http.ts";
import { adminClient, requireCaller } from "../_shared/supa.ts";

async function removePrefix(bucket: string, prefix: string): Promise<number> {
  const storage = adminClient().storage.from(bucket);
  let removed = 0;
  const walk = async (dir: string): Promise<string[]> => {
    const { data, error } = await storage.list(dir, { limit: 1000 });
    if (error || !data) return [];
    const files: string[] = [];
    for (const item of data) {
      const path = dir ? `${dir}/${item.name}` : item.name;
      if (item.id === null) files.push(...(await walk(path)));
      else files.push(path);
    }
    return files;
  };
  const files = await walk(prefix);
  for (let i = 0; i < files.length; i += 100) {
    const { error } = await storage.remove(files.slice(i, i + 100));
    if (!error) removed += Math.min(100, files.length - i);
  }
  return removed;
}

serve(["POST"], async (req) => {
  const caller = await requireCaller(req);
  const db = adminClient();

  const { data: games } = await db.from("games").select("slug").eq("creator_id", caller.id);
  for (const g of games ?? []) {
    await removePrefix("game-bundles", g.slug);
    await removePrefix("game-assets", g.slug);
  }
  await removePrefix("avatars", caller.id);
  const { error: evErr } = await db.from("feed_events").delete().eq("user_id", caller.id);
  if (evErr) console.error("account-delete: events", evErr.message);

  const { error } = await db.auth.admin.deleteUser(caller.id);
  if (error) throw error;
  return json(req, { deleted: true });
});
