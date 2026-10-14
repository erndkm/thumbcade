import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { supabase } from "../../lib/supabase";

/** Collects everything the user's RLS scope can read about them and hands it to the share sheet as JSON. */
export async function exportMyData(userId: string): Promise<void> {
  const q = async (table: string, column: string, select = "*") => {
    const { data, error } = await supabase.from(table).select(select).eq(column, userId);
    if (error) throw error;
    return data ?? [];
  };
  const [profile, likes, saves, following, followers, comments, sessions, best, daily, storage, notifications, reports, blocks, shares] = await Promise.all([
    q("profiles", "id"),
    q("likes", "user_id", "created_at, game:games(slug, name)"),
    q("saves", "user_id", "created_at, game:games(slug, name)"),
    q("follows", "follower_id", "created_at, followee:profiles!follows_followee_id_fkey(handle)"),
    q("follows", "followee_id", "created_at, follower:profiles!follows_follower_id_fkey(handle)"),
    q("comments", "user_id", "id, body, created_at, parent_id, game:games(slug)"),
    q("play_sessions", "user_id", "id, started_at, ended_at, duration_ms, score, outcome, accepted, reject_reason, launch_reason, game:games(slug)"),
    q("best_scores", "user_id", "best_score, achieved_at, game:games(slug)"),
    q("daily_scores", "user_id", "day, best_score, game:games(slug)"),
    q("game_kv", "user_id", "key, value, updated_at, game:games(slug)"),
    q("notifications", "user_id", "type, payload, created_at, read_at"),
    q("reports", "reporter_id", "target_type, reason, details, status, created_at"),
    q("blocks", "blocker_id", "created_at, blocked:profiles!blocks_blocked_id_fkey(handle)"),
    q("shares", "user_id", "code, channel, challenge_score, open_count, created_at, game:games(slug)"),
  ]);
  const doc = {
    exportedAt: new Date().toISOString(),
    note: "Everything Thumbcade stores about your account. Analytics events are tied only to your account id and are not included.",
    profile: profile[0] ?? null,
    likes,
    saves,
    following,
    followers,
    comments,
    playSessions: sessions,
    bestScores: best,
    dailyScores: daily,
    gameStorage: storage,
    notifications,
    reports,
    blocks,
    shares,
  };
  const file = new File(Paths.cache, `thumbcade-export-${new Date().toISOString().slice(0, 10)}.json`);
  if (file.exists) file.delete();
  file.create();
  file.write(JSON.stringify(doc, null, 2));
  await Sharing.shareAsync(file.uri, { mimeType: "application/json", dialogTitle: "Your Thumbcade data", UTI: "public.json" });
}
