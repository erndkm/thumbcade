/**
 * GET /functions/v1/account-export  ->  everything Thumbcade stores about the caller (GDPR Art. 15 and 20).
 * Used by the app (Settings → Download my data) and the portal (/account/export). Reads with the service role
 * so the copy also covers rows players can't read themselves (usage events, per-player aggregates); every
 * query is filtered by the caller's id. Guests can export too.
 */
import { RETENTION } from "../../../packages/legal/src/operator.ts";
import { json, serve } from "../_shared/http.ts";
import { adminClient, requireCaller } from "../_shared/supa.ts";

type Row = Record<string, unknown>;
const PAGE = 1000;

async function rows(table: string, column: string, value: string, select: string, order: string[]): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = adminClient().from(table).select(select).eq(column, value);
    for (const o of order) q = q.order(o);
    const { data, error } = await q.range(from, from + PAGE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    const page = (data ?? []) as unknown as Row[];
    out.push(...page);
    if (page.length < PAGE) return out;
  }
}

/** id -> selected columns for every id referenced by the export, so ids in the rows can be read. */
async function lookup(table: "games" | "profiles", select: string, ids: Set<string>): Promise<Record<string, Row>> {
  const all = [...ids];
  const out: Record<string, Row> = {};
  for (let i = 0; i < all.length; i += 200) {
    const { data, error } = await adminClient().from(table).select(`id, ${select}`).in("id", all.slice(i, i + 200));
    if (error) throw new Error(`${table}: ${error.message}`);
    for (const r of (data ?? []) as unknown as Row[]) {
      const { id, ...rest } = r;
      out[String(id)] = rest;
    }
  }
  return out;
}

function collect(ids: Set<string>, list: Row[], ...keys: string[]): void {
  for (const r of list) for (const k of keys) if (typeof r[k] === "string") ids.add(r[k] as string);
}

serve(["GET", "POST"], async (req) => {
  const caller = await requireCaller(req);
  const me = caller.id;
  const db = adminClient();
  const q = (table: string, column: string, select: string, ...order: string[]) => rows(table, column, me, select, order);

  const { data: auth, error: authErr } = await db.auth.admin.getUserById(me);
  if (authErr || !auth.user) throw authErr ?? new Error("auth user missing");
  const u = auth.user;

  const [
    profile, following, followers, likes, saves, comments, commentLikes, blocks, shares, reports,
    sessions, bestScores, dailyScores, gameSaves, gamePlayers, gamePlayerDays,
    events, affinity, notifications, pushTokens, games, tokens, milestones,
  ] = await Promise.all([
    q("profiles", "id", "*", "id"),
    q("follows", "follower_id", "followee_id, created_at", "followee_id"),
    q("follows", "followee_id", "follower_id, created_at", "follower_id"),
    q("likes", "user_id", "game_id, created_at", "game_id"),
    q("saves", "user_id", "game_id, created_at", "game_id"),
    q("comments", "user_id", "id, game_id, parent_id, body, status, like_count, reply_count, created_at", "id"),
    q("comment_likes", "user_id", "comment_id, created_at", "comment_id"),
    q("blocks", "blocker_id", "blocked_id, created_at", "blocked_id"),
    q("shares", "user_id", "code, game_id, channel, challenge_score, open_count, created_at", "id"),
    q("reports", "reporter_id", "target_type, target_id, reason, details, status, resolved_at, resolution_note, created_at", "id"),
    q("play_sessions", "user_id", "id, game_id, version_id, launch_reason, started_at, ended_at, duration_ms, active_ms, score, outcome, accepted, reject_reason, qualified_at", "id"),
    q("best_scores", "user_id", "game_id, best_score, achieved_at", "game_id"),
    q("daily_scores", "user_id", "game_id, day, best_score, achieved_at", "game_id", "day"),
    q("game_kv", "user_id", "game_id, key, value, updated_at", "game_id", "key"),
    q("game_players", "user_id", "game_id, first_played_at, last_played_at, plays, active_ms, days_played", "game_id"),
    q("game_player_days", "user_id", "game_id, day, plays, active_ms", "game_id", "day"),
    q("feed_events", "user_id", "type, game_id, version_id, card_id, feed_id, dwell_ms, state, score, duration_ms, meta, client_ts, created_at", "created_at", "id"),
    q("user_tag_affinity", "user_id", "tag, weight, updated_at", "tag"),
    q("notifications", "user_id", "type, actor_id, game_id, comment_id, payload, read_at, created_at", "id"),
    q("push_tokens", "user_id", "token, platform, created_at", "token"),
    q("games", "creator_id", "id, slug, name, description, tags, age_rating, status, play_count, like_count, comment_count, published_at, created_at", "id"),
    q("creator_tokens", "creator_id", "name, token_prefix, last_used_at, revoked_at, created_at", "id"),
    q("creator_milestones", "creator_id", "game_id, kind, threshold, value, detail, reached_at, share_code", "id"),
  ]);

  const gameIds = games.map((g) => String(g.id));
  const versions: Row[] = [];
  for (let i = 0; i < gameIds.length; i += 200) {
    const { data, error } = await db
      .from("game_versions")
      .select("id, game_id, semver, status, size_bytes, gzip_bytes, review_notes, release_notes, approved_at, created_at")
      .in("game_id", gameIds.slice(i, i + 200))
      .order("created_at");
    if (error) throw new Error(`game_versions: ${error.message}`);
    versions.push(...((data ?? []) as unknown as Row[]));
  }

  const gameRefs = new Set<string>();
  collect(gameRefs, [...likes, ...saves, ...comments, ...shares, ...sessions, ...bestScores, ...dailyScores, ...gameSaves, ...gamePlayers, ...gamePlayerDays, ...events, ...notifications], "game_id");
  const profileRefs = new Set<string>();
  collect(profileRefs, following, "followee_id");
  collect(profileRefs, followers, "follower_id");
  collect(profileRefs, blocks, "blocked_id");
  collect(profileRefs, notifications, "actor_id");
  const [gameIndex, profileIndex] = await Promise.all([lookup("games", "slug, name", gameRefs), lookup("profiles", "handle", profileRefs)]);

  const body = {
    exportedAt: new Date().toISOString(),
    about: `Everything Thumbcade stores about your account. Ids of games and players are resolved under \`references\`. Usage events are deleted after ${RETENTION.usageEventsDays} days, so older ones don't appear here.`,
    account: {
      id: u.id,
      email: u.email || null,
      phone: u.phone || null,
      guest: u.is_anonymous === true,
      createdAt: u.created_at,
      lastSignInAt: u.last_sign_in_at ?? null,
      signInMethods: (u.identities ?? []).map((i) => ({ provider: i.provider, email: i.identity_data?.email ?? null, linkedAt: i.created_at ?? null })),
    },
    profile: profile[0] ?? null,
    social: { following, followers, likes, saves, comments, commentLikes, blocks, shares, reportsFiled: reports },
    play: { sessions, bestScores, dailyScores, gameSaves, perGameTotals: gamePlayers, perGameDays: gamePlayerDays },
    feed: { usageEvents: events, interestWeights: affinity },
    notifications: { inbox: notifications, pushTokens },
    creator: { games, versions, apiTokens: tokens, milestones },
    references: { games: gameIndex, profiles: profileIndex },
  };
  const day = new Date().toISOString().slice(0, 10);
  return json(req, body, 200, { "Content-Disposition": `attachment; filename="thumbcade-export-${day}.json"` });
});
