/**
 * Creator analytics against the local database (supabase/migrations/*_creator_analytics.sql).
 * Runs only when the local stack is up; it creates its own users and game and removes them afterwards, so
 * it never touches seed or real data. award_milestones and rollup_game_stats run as the cron would.
 */
import { execSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  CreatorOverviewSchema,
  GameAnalyticsSchema,
  GameFunnelSchema,
  MilestoneCardSchema,
  QUALIFIED_PLAY_MS,
  VersionCompareSchema,
} from "@thumbcade/protocol";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

function localEnv(): { url: string; service: string; anon: string } | null {
  let url = process.env.SUPABASE_URL;
  let service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  let anon = process.env.SUPABASE_ANON_KEY;
  if (!url || !service || !anon) {
    try {
      const out = execSync("supabase status -o env", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 8000 });
      const vars = Object.fromEntries(out.split("\n").map((l) => /^([A-Z_]+)="?(.*?)"?$/.exec(l.trim())).filter((m) => m !== null).map((m) => [m![1], m![2]]));
      url ??= vars.API_URL;
      service ??= vars.SERVICE_ROLE_KEY;
      anon ??= vars.ANON_KEY;
    } catch {
      return null;
    }
  }
  return url && service && anon ? { url, service, anon } : null;
}

const env = localEnv();
const reachable = env
  ? await fetch(`${env.url}/rest/v1/`, { headers: { apikey: env.anon } }).then((r) => r.status < 500, () => false)
  : false;
const opts = { auth: { persistSession: false, autoRefreshToken: false } };

describe.skipIf(!reachable)("creator analytics (local database)", () => {
  const tag = randomBytes(4).toString("hex");
  const password = `pw-${randomBytes(12).toString("hex")}`;
  let db: SupabaseClient;
  const users: Record<"creator" | "p1" | "p2" | "outsider", string> = { creator: "", p1: "", p2: "", outsider: "" };
  let gameId = "";
  let versionId = "";
  const slug = `analytics-test-${tag}`;

  async function signedIn(who: keyof typeof users): Promise<SupabaseClient> {
    const c = createClient(env!.url, env!.anon, opts);
    const { error } = await c.auth.signInWithPassword({ email: `${who}-${tag}@analytics.test`, password });
    if (error) throw error;
    return c;
  }
  const game = async () =>
    (await db.from("games").select("play_count, player_count, play_ms_total").eq("id", gameId).single()).data as { play_count: number; player_count: number; play_ms_total: number };
  async function start(user: string, card = "feedT:0"): Promise<string> {
    const { data, error } = await db.rpc("start_play_session", { p_user: user, p_game: gameId, p_version: versionId, p_reason: "feed", p_card: card });
    if (error) throw error;
    return data as string;
  }
  async function backdate(session: string, ms: number) {
    const at = new Date(Date.now() - ms).toISOString();
    await db.from("play_sessions").update({ started_at: at, progress_at: null }).eq("id", session);
  }
  async function progress(session: string, user: string, activeMs: number) {
    await db.from("play_sessions").update({ progress_at: null }).eq("id", session);
    return db.rpc("record_session_progress", { p_session: session, p_user: user, p_active_ms: activeMs });
  }

  beforeAll(async () => {
    db = createClient(env!.url, env!.service, opts);
    for (const who of Object.keys(users) as (keyof typeof users)[]) {
      const { data, error } = await db.auth.admin.createUser({ email: `${who}-${tag}@analytics.test`, password, email_confirm: true });
      if (error) throw error;
      users[who] = data.user.id;
    }
    await db.from("profiles").update({ role: "creator", is_guest: false }).in("id", [users.creator, users.outsider]);
    await db.from("profiles").update({ is_guest: false }).in("id", [users.p1, users.p2]);
    const g = await db.from("games").insert({ slug, creator_id: users.creator, name: "Analytics Test", description: "Test game.", status: "live", published_at: new Date().toISOString() }).select("id").single();
    if (g.error) throw g.error;
    gameId = g.data.id as string;
    const v = await db
      .from("game_versions")
      .insert({ game_id: gameId, semver: "1.0.0", manifest: {}, bundle_path: `${slug}/v/`, status: "approved", approved_at: new Date().toISOString() })
      .select("id")
      .single();
    if (v.error) throw v.error;
    versionId = v.data.id as string;
    await db.from("games").update({ live_version_id: versionId }).eq("id", gameId);
  }, 30_000);

  afterAll(async () => {
    if (!db) return;
    if (gameId) await db.from("games").delete().eq("id", gameId);
    for (const id of Object.values(users)) if (id) await db.auth.admin.deleteUser(id);
  });

  it("clamps progress to wall-clock time, never lowers it, and qualifies at the threshold", async () => {
    const s = await start(users.p1);
    await backdate(s, 10_000);
    const first = await progress(s, users.p1, QUALIFIED_PLAY_MS - 1);
    expect(first.data).toEqual([{ stored_ms: QUALIFIED_PLAY_MS - 1, is_qualified: false }]);
    const forged = await progress(s, users.p1, 9_999_999);
    const stored = (forged.data as { stored_ms: number }[])[0]!.stored_ms;
    expect(stored).toBeGreaterThanOrEqual(10_000);
    expect(stored).toBeLessThanOrEqual(13_000);
    const lower = await progress(s, users.p1, 500);
    expect((lower.data as { stored_ms: number; is_qualified: boolean }[])[0]).toEqual({ stored_ms: stored, is_qualified: true });
    expect(await game()).toMatchObject({ play_count: 1, player_count: 1, play_ms_total: stored });
  });

  it("refuses progress on someone else's session and rate-limits a session", async () => {
    const s = await start(users.p2);
    const other = await db.rpc("record_session_progress", { p_session: s, p_user: users.p1, p_active_ms: 1000 });
    expect(other.error?.message).toMatch(/bad_session/);
    await db.rpc("record_session_progress", { p_session: s, p_user: users.p2, p_active_ms: 100 });
    const again = await db.rpc("record_session_progress", { p_session: s, p_user: users.p2, p_active_ms: 200 });
    expect(again.error?.message).toMatch(/rate_limited/);
  });

  it("never counts the creator's own runs", async () => {
    const before = await game();
    const s = await start(users.creator);
    await backdate(s, 5000);
    const fin = await db.rpc("finish_play_session", { p_session: s, p_user: users.creator, p_score: 5, p_duration_ms: 4000, p_outcome: "lose", p_active_ms: 4000 });
    expect(fin.error).toBeNull();
    const row = (await db.from("play_sessions").select("excluded, qualified_at").eq("id", s).single()).data as { excluded: boolean; qualified_at: string | null };
    expect(row.excluded).toBe(true);
    expect(await game()).toEqual(before);
  });

  it("qualifies a run the game ended early, counts it once, and keeps aggregates exact", async () => {
    const before = await game();
    const s = await start(users.p2, "feedT:1");
    await backdate(s, 2000);
    await db.rpc("finish_play_session", { p_session: s, p_user: users.p2, p_score: 3, p_duration_ms: 1800, p_outcome: "lose", p_active_ms: 1800 });
    // A second end is refused and changes nothing.
    await db.rpc("finish_play_session", { p_session: s, p_user: users.p2, p_score: 3, p_duration_ms: 1800, p_outcome: "lose", p_active_ms: 1800 });
    const after = await game();
    expect(after.play_count).toBe(before.play_count + 1);
    expect(after.player_count).toBe(before.player_count + 1);
    const p2 = (await db.from("game_players").select("plays, active_ms, days_played").eq("game_id", gameId).eq("user_id", users.p2).single()).data;
    // 100 ms from the rate-limited session above, plus this run.
    expect(p2).toEqual({ plays: 1, active_ms: 1900, days_played: 1 });
  });

  it("caps the public play count per person per day", async () => {
    const before = await game();
    const cap = 100;
    const existing = (await db.from("play_sessions").select("id", { count: "exact", head: true }).eq("game_id", gameId).eq("user_id", users.p1).not("qualified_at", "is", null)).count ?? 0;
    const startedAt = new Date().toISOString();
    for (let i = 0; i < cap - existing + 2; i++) {
      const { error } = await db.from("play_sessions").insert({ user_id: users.p1, game_id: gameId, version_id: versionId, started_at: startedAt, ended_at: startedAt, qualified_at: startedAt, active_ms: 0 });
      if (error) throw error;
    }
    expect((await game()).play_count).toBe(before.play_count + (cap - existing));
  }, 60_000);

  it("rolls the day up, awards milestones once, and only shows them to their creator", async () => {
    const r = await db.rpc("rollup_game_stats", { p_days: 2 });
    expect(r.error).toBeNull();
    const today = new Date().toISOString().slice(0, 10);
    const stats = (await db.from("game_stats_daily").select("players, new_players, plays, players_7d, plays_feed, version_id").eq("game_id", gameId).eq("day", today).single()).data;
    // p1: 102 plays, capped at 100; p2: 1.
    expect(stats).toMatchObject({ players: 2, new_players: 2, plays: 101, players_7d: 2, plays_feed: 103, version_id: versionId });

    await db.rpc("award_milestones");
    await db.rpc("award_milestones");
    const ms = (await db.from("creator_milestones").select("kind, threshold, seen_at").eq("game_id", gameId)).data ?? [];
    expect(ms.filter((m) => m.kind === "first_player")).toHaveLength(1);
    const notes = (await db.from("notifications").select("type, payload").eq("user_id", users.creator).eq("type", "milestone")).data ?? [];
    expect(notes).toHaveLength(1);

    const creator = await signedIn("creator");
    const outsider = await signedIn("outsider");
    expect((await creator.from("creator_milestones").select("id").eq("game_id", gameId)).data?.length).toBeGreaterThan(0);
    expect((await outsider.from("creator_milestones").select("id").eq("game_id", gameId)).data).toEqual([]);
  });

  it("serves the dashboard only to the owner, in the shapes the portal parses", async () => {
    const creator = await signedIn("creator");
    const outsider = await signedIn("outsider");

    const overview = await creator.rpc("creator_overview");
    expect(overview.error).toBeNull();
    const o = CreatorOverviewSchema.parse(overview.data);
    expect(o.games.find((g) => g.id === gameId)?.players).toBe(2);

    for (const range of ["today", "7d", "28d", "all"] as const) {
      const s = await creator.rpc("creator_game_summary", { p_game: gameId, p_range: range });
      expect(s.error, range).toBeNull();
      const parsed = GameAnalyticsSchema.parse(s.data);
      expect(parsed.current.players, range).toBe(2);
      GameFunnelSchema.parse((await creator.rpc("creator_game_funnel", { p_game: gameId, p_range: range })).data);
    }
    const versions = VersionCompareSchema.parse((await creator.rpc("creator_version_compare", { p_game: gameId })).data);
    // Today was rolled up while 1.0.0 was live, so its plays belong to it.
    expect(versions[0]).toMatchObject({ semver: "1.0.0", isLive: true, days: 1, plays: 101 });

    expect((await outsider.rpc("creator_game_summary", { p_game: gameId, p_range: "7d" })).error?.message).toMatch(/not your game/);
    expect((await outsider.rpc("creator_version_compare", { p_game: gameId })).error).not.toBeNull();
    // Per-player rows are never readable by clients, not even by the game's creator.
    expect((await creator.from("game_players").select("*").eq("game_id", gameId)).data ?? []).toEqual([]);
    expect((await creator.from("game_player_days").select("*").eq("game_id", gameId)).data ?? []).toEqual([]);
    expect((await creator.rpc("window_players", { p_game: gameId, p_day: "2026-10-14", p_days: 7 })).error).not.toBeNull();
  });

  it("makes a milestone public only once its creator shares it", async () => {
    const creator = await signedIn("creator");
    const anon = createClient(env!.url, env!.anon, opts);
    const m = (await db.from("creator_milestones").select("id").eq("game_id", gameId).eq("kind", "first_player").single()).data as { id: string };
    expect((await anon.from("creator_milestones").select("id").eq("id", m.id)).data).toEqual([]);
    const outsider = await signedIn("outsider");
    expect((await outsider.rpc("share_milestone", { p_id: m.id })).error).not.toBeNull();
    const shared = await creator.rpc("share_milestone", { p_id: m.id });
    expect(shared.error).toBeNull();
    expect((await creator.rpc("share_milestone", { p_id: m.id })).data).toBe(shared.data);
    const card = MilestoneCardSchema.parse((await anon.rpc("milestone_card", { p_code: shared.data })).data);
    expect(card).toMatchObject({ kind: "first_player", game: { slug } });
  });
});
