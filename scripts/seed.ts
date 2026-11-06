/**
 * pnpm seed — idempotent local seed for Thumbcade.
 *
 *   pnpm seed                         dist/games/games-index.json, or the mobile dev fixtures if it's missing
 *   pnpm seed --index <path>          a specific GamesIndex file
 *   pnpm seed --with-fixtures         real games plus the two dev fixtures
 *
 * Wipes every `is_seed` row (seed auth users cascade to their profiles, games and social data) and
 * the seeded games' storage, then uploads bundles to `game-bundles/<slug>/<versionId>/…`, icons and
 * posters to `game-assets/<slug>/`, approves each version through `approve_version` (service role),
 * and writes a believable social graph: creators, ~40 players, follows, likes, saves, comments with
 * replies and a pinned creator note, scores and leaderboards, 14 days of stats and editorial rows.
 * Uses SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY, or reads them from `supabase status -o env`.
 */
import { execSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { GamesIndexSchema, SEED_CREATORS, bundleObjectPath, type GamesIndexEntry } from "@thumbcade/protocol";
import { CREATOR_REPLIES, poolFor } from "./seed/comments.ts";
import { DEMO_PEOPLE, DEMO_PLAYER } from "./seed/people.ts";
import { formatSeedScore, int, mulberry32, pick, plausibleScore, sample, worseScore, type Rng, type ScoreShape } from "./seed/random.ts";
import { seedStatDays, seedTotals, type SeedStatDay, type SeedTotals } from "./seed/stats.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIST_INDEX = join(ROOT, "dist/games/games-index.json");
const FIXTURE_INDEX = join(ROOT, "apps/mobile/dev-fixtures/games-index.json");
const SEED_EMAIL_DOMAIN = "seed.thumbcade.dev";
const EDITORIAL_SLUGS = ["staff-picks", "one-thumb", "brain-break"];
const DAY = 86_400_000;

// ---------------------------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------------------------

function config(): { url: string; serviceKey: string } {
  let url = process.env.SUPABASE_URL;
  let serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    const out = execSync("supabase status -o env", { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const vars = Object.fromEntries(
      out
        .split("\n")
        .map((l) => /^([A-Z_]+)="?(.*?)"?$/.exec(l.trim()))
        .filter((m): m is RegExpExecArray => m !== null)
        .map((m) => [m[1], m[2]]),
    ) as Record<string, string>;
    url ??= vars.API_URL;
    serviceKey ??= vars.SERVICE_ROLE_KEY;
  }
  if (!url || !serviceKey) throw new Error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, or start the local stack (supabase start).");
  return { url: url.replace(/\/$/, ""), serviceKey };
}

function args(): { index: string | null; withFixtures: boolean } {
  const a = process.argv.slice(2);
  const i = a.indexOf("--index");
  return { index: i >= 0 ? resolve(process.cwd(), a[i + 1] ?? "") : null, withFixtures: a.includes("--with-fixtures") };
}

interface Loaded {
  entry: GamesIndexEntry;
  baseDir: string;
}

function loadIndex(path: string): Loaded[] {
  const idx = GamesIndexSchema.parse(JSON.parse(readFileSync(path, "utf8")));
  return idx.games.map((entry) => ({ entry, baseDir: dirname(path) }));
}

async function pMap<T, R>(items: readonly T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!, i);
    }
  });
  await Promise.all(workers);
  return out;
}

function must<T>(res: { data: T; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data;
}

async function insertChunks(db: SupabaseClient, table: string, rows: object[], chunk = 500): Promise<void> {
  for (let i = 0; i < rows.length; i += chunk) {
    const { error } = await db.from(table).insert(rows.slice(i, i + chunk));
    if (error) throw new Error(`insert ${table}: ${error.message}`);
  }
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".gif": "image/gif",
  ".wasm": "application/wasm",
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
  ".bin": "application/octet-stream",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
};
const mimeOf = (file: string) => MIME[extname(file).toLowerCase()] ?? "application/octet-stream";

async function removePrefix(db: SupabaseClient, bucket: string, prefix: string): Promise<number> {
  const storage = db.storage.from(bucket);
  const walk = async (dir: string): Promise<string[]> => {
    const { data, error } = await storage.list(dir, { limit: 1000 });
    if (error || !data) return [];
    const files: string[] = [];
    for (const item of data) {
      const path = `${dir}/${item.name}`;
      if (item.id === null) files.push(...(await walk(path)));
      else files.push(path);
    }
    return files;
  };
  const files = await walk(prefix);
  for (let i = 0; i < files.length; i += 100) await storage.remove(files.slice(i, i + 100));
  return files.length;
}

// ---------------------------------------------------------------------------------------------
// Wipe
// ---------------------------------------------------------------------------------------------

async function wipe(db: SupabaseClient, slugs: string[]): Promise<{ users: number; games: number; files: number }> {
  const seedProfiles = must(await db.from("profiles").select("id").eq("is_seed", true), "list seed profiles") as { id: string }[];
  const ids = new Set(seedProfiles.map((p) => p.id));
  for (let page = 1; page < 50; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    for (const u of data.users) {
      if (u.email?.endsWith(`@${SEED_EMAIL_DOMAIN}`) || u.email === DEMO_PLAYER.email) ids.add(u.id);
    }
    if (data.users.length < 1000) break;
  }

  const seedGames = must(await db.from("games").select("slug").eq("is_seed", true), "list seed games") as { slug: string }[];
  must(await db.from("games").delete().eq("is_seed", true), "delete seed games");
  // Cascades touch shared counter rows, so clear the social graph in bulk first and delete users one by one
  // (parallel deletes deadlock on the counter triggers).
  const idList = [...ids];
  for (let i = 0; i < idList.length; i += 100) {
    const chunk = idList.slice(i, i + 100);
    for (const [table, column] of [["follows", "follower_id"], ["follows", "followee_id"], ["comment_likes", "user_id"], ["likes", "user_id"], ["saves", "user_id"]] as const) {
      must(await db.from(table).delete().in(column, chunk), `clear ${table}`);
    }
  }
  for (const id of idList) {
    const { error } = await db.auth.admin.deleteUser(id);
    if (error && !/not found/i.test(error.message)) throw new Error(`delete user ${id}: ${error.message}`);
  }
  must(await db.from("editorial_rows").delete().in("slug", EDITORIAL_SLUGS), "delete editorial rows");

  // Storage: previous seed games plus any slug we are about to seed that no real game owns.
  const owned = must(await db.from("games").select("slug").in("slug", slugs), "check slugs") as { slug: string }[];
  const ownedSet = new Set(owned.map((g) => g.slug));
  const storageSlugs = new Set([...seedGames.map((g) => g.slug), ...slugs.filter((s) => !ownedSet.has(s))]);
  let files = 0;
  for (const slug of storageSlugs) {
    files += await removePrefix(db, "game-bundles", slug);
    files += await removePrefix(db, "game-assets", slug);
  }
  return { users: ids.size, games: seedGames.length, files };
}

// ---------------------------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------------------------

interface Person {
  id: string;
  handle: string;
  activity: number;
  skill: number;
  creator: boolean;
}

interface SeededGame {
  id: string;
  slug: string;
  name: string;
  creatorId: string;
  versionId: string;
  shape: ScoreShape;
  tags: string[];
  vertical: boolean;
  inputs: string[];
  quality: number;
  publishedAt: Date;
}

async function createAccount(db: SupabaseClient, email: string, password: string, handle: string, displayName: string): Promise<string> {
  const { data, error } = await db.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { handle, display_name: displayName },
  });
  if (error || !data.user) throw new Error(`create ${email}: ${error?.message}`);
  return data.user.id;
}

async function main(): Promise<void> {
  const t0 = Date.now();
  const { url, serviceKey } = config();
  const opts = args();
  const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const rng: Rng = mulberry32(0x7c0ffee);

  // --- index -----------------------------------------------------------------------------
  let indexPath = opts.index;
  if (!indexPath) indexPath = existsSync(DIST_INDEX) ? DIST_INDEX : FIXTURE_INDEX;
  if (!existsSync(indexPath)) throw new Error(`No games index at ${indexPath}. Run \`pnpm games:build\` (or build the fixtures).`);
  let games = loadIndex(indexPath);
  console.log(`seed: games from ${indexPath.replace(`${ROOT}/`, "")}${indexPath === FIXTURE_INDEX ? " (dev fixtures; run pnpm games:build for the launch library)" : ""}`);
  if (opts.withFixtures && indexPath !== FIXTURE_INDEX) {
    const known = new Set(games.map((g) => g.entry.manifest.id));
    games = [...games, ...loadIndex(FIXTURE_INDEX).filter((g) => !known.has(g.entry.manifest.id))];
  }

  // --- wipe ------------------------------------------------------------------------------
  const wiped = await wipe(db, games.map((g) => g.entry.manifest.id));
  console.log(`seed: wiped ${wiped.users} users, ${wiped.games} games, ${wiped.files} storage objects`);

  const taken = must(await db.from("games").select("slug").in("slug", games.map((g) => g.entry.manifest.id)), "check slugs") as { slug: string }[];
  for (const t of taken) console.warn(`seed: skipping ${t.slug} — a non-seed game already owns that slug`);
  const takenSet = new Set(taken.map((t) => t.slug));
  games = games.filter((g) => !takenSet.has(g.entry.manifest.id));

  // --- accounts --------------------------------------------------------------------------
  const creatorDefs = SEED_CREATORS.map((c) => ({ ...c, interests: [] as string[], activity: 0.5 }));
  const accountDefs = [
    ...creatorDefs.map((c) => ({ handle: c.handle, displayName: c.displayName, bio: c.bio, interests: c.interests, activity: c.activity, creator: true, verified: c.verified })),
    ...DEMO_PEOPLE.map((p) => ({ ...p, creator: false, verified: false })),
  ];
  const ids = await pMap(accountDefs, 8, (a) =>
    createAccount(db, `${a.handle}@${SEED_EMAIL_DOMAIN}`, randomBytes(18).toString("base64url"), a.handle, a.displayName),
  );
  const demoId = await createAccount(db, DEMO_PLAYER.email, DEMO_PLAYER.password, DEMO_PLAYER.handle, DEMO_PLAYER.displayName);

  const profileRows = accountDefs.map((a, i) => ({
    id: ids[i]!,
    bio: a.bio,
    role: a.creator ? "creator" : "user",
    verified: a.verified,
    interests: a.interests,
    age_band: "adult",
    is_guest: false,
    is_seed: true,
  }));
  profileRows.push({
    id: demoId,
    bio: DEMO_PLAYER.bio,
    role: "user",
    verified: false,
    interests: [...DEMO_PLAYER.interests],
    age_band: "adult",
    is_guest: false,
    is_seed: true,
  });
  await pMap(profileRows, 8, async (row) => {
    const { id, ...rest } = row;
    must(await db.from("profiles").update(rest).eq("id", id), `profile ${id}`);
  });
  const handles = must(await db.from("profiles").select("id, handle").in("id", [...ids, demoId]), "read handles") as { id: string; handle: string }[];
  const handleOf = new Map(handles.map((h) => [h.id, h.handle]));

  const people: Person[] = accountDefs.map((a, i) => ({
    id: ids[i]!,
    handle: handleOf.get(ids[i]!) ?? a.handle,
    activity: a.activity,
    skill: Math.min(0.98, Math.max(0.05, 0.25 + rng() * 0.6 + (a.activity - 0.6) * 0.3)),
    creator: a.creator,
  }));
  const demo: Person = { id: demoId, handle: DEMO_PLAYER.handle, activity: 0.7, skill: 0.55, creator: false };
  const creatorByHandle = new Map(people.filter((p) => p.creator).map((p) => [p.handle, p]));
  const players = people.filter((p) => !p.creator);
  const everyone = [...people, demo];
  console.log(`seed: ${people.length + 1} accounts (${creatorByHandle.size} creators, demo login ${DEMO_PLAYER.email} / ${DEMO_PLAYER.password})`);

  // --- games -----------------------------------------------------------------------------
  const seeded: SeededGame[] = [];
  const recentSlots = new Set(sample(rng, games.map((_, i) => i), Math.min(3, Math.max(1, Math.floor(games.length / 4)))));
  for (const [gi, { entry, baseDir }] of games.entries()) {
    const m = entry.manifest;
    const creator = creatorByHandle.get(entry.creatorHandle) ?? creatorByHandle.get("thumbcade")!;
    const gameId = randomUUID();
    const versionId = randomUUID();
    const bundleRoot = join(baseDir, entry.bundleDir);

    await pMap(entry.files, 8, async (file) => {
      const body = readFileSync(join(bundleRoot, file));
      const { error } = await db.storage
        .from("game-bundles")
        .upload(bundleObjectPath(m.id, versionId, file), body, { contentType: mimeOf(file), upsert: true, cacheControl: "31536000" });
      if (error) throw new Error(`upload ${m.id}/${file}: ${error.message}`);
    });
    const assetUrl = async (src: string, name: string): Promise<string> => {
      const target = `${m.id}/${name}${extname(src).toLowerCase()}`;
      const { error } = await db.storage
        .from("game-assets")
        .upload(target, readFileSync(join(baseDir, src)), { contentType: mimeOf(src), upsert: true, cacheControl: "3600" });
      if (error) throw new Error(`upload asset ${target}: ${error.message}`);
      return `${url}/storage/v1/object/public/game-assets/${target}?v=${versionId.slice(0, 8)}`;
    };
    const iconUrl = await assetUrl(entry.icon, "icon");
    const posterUrl = await assetUrl(entry.poster, "poster");

    const ageDays = recentSlots.has(gi) ? int(rng, 1, 5) : int(rng, 9, 48);
    const publishedAt = new Date(Date.now() - ageDays * DAY - int(rng, 0, 20) * 3_600_000);
    must(
      await db.from("games").insert({
        id: gameId,
        slug: m.id,
        creator_id: creator.id,
        name: m.name,
        description: m.description,
        icon_url: iconUrl,
        poster_url: posterUrl,
        accent_color: m.accentColor,
        tags: m.tags,
        age_rating: m.ageRating,
        controls: m.controls,
        session_length: m.session,
        audio: m.audio,
        score_config: m.score,
        status: "draft",
        is_seed: true,
        published_at: publishedAt.toISOString(),
        created_at: new Date(publishedAt.getTime() - 2 * DAY).toISOString(),
      }),
      `insert game ${m.id}`,
    );
    must(
      await db.from("game_versions").insert({
        id: versionId,
        game_id: gameId,
        semver: m.version,
        manifest: m,
        bundle_path: `${m.id}/${versionId}/`,
        size_bytes: entry.sizeBytes,
        gzip_bytes: entry.gzipBytes,
        status: "pending_review",
        release_notes: entry.notes ?? null,
        submitted_by: creator.id,
        created_at: new Date(publishedAt.getTime() - DAY).toISOString(),
      }),
      `insert version ${m.id}`,
    );
    must(await db.rpc("approve_version", { p_version_id: versionId, p_notes: "Launch build" }), `approve ${m.id}`);
    // The launch build went live when the game did (dashboards mark releases on their day).
    must(await db.from("game_versions").update({ approved_at: publishedAt.toISOString() }).eq("id", versionId), `approved_at ${m.id}`);

    seeded.push({
      id: gameId,
      slug: m.id,
      name: m.name,
      creatorId: creator.id,
      versionId,
      shape: { order: m.score.order, max: m.score.max, format: m.score.format },
      tags: m.tags,
      vertical: m.controls.vertical,
      inputs: m.controls.inputs,
      quality: 0.45 + rng() * 0.55,
      publishedAt,
    });
    console.log(`seed: ${m.id.padEnd(16)} ${entry.files.length} files  v${m.version}  @${entry.creatorHandle}  live`);
  }

  // --- follows ---------------------------------------------------------------------------
  const follows = new Map<string, { follower_id: string; followee_id: string; created_at: string }>();
  const follow = (a: Person, b: Person, daysAgo: number) => {
    if (a.id === b.id) return;
    const key = `${a.id}:${b.id}`;
    if (!follows.has(key)) follows.set(key, { follower_id: a.id, followee_id: b.id, created_at: new Date(Date.now() - daysAgo * DAY).toISOString() });
  };
  const creators = [...creatorByHandle.values()];
  const studio = creatorByHandle.get("thumbcade");
  for (const p of players) {
    if (studio && rng() < 0.85) follow(p, studio, int(rng, 1, 40));
    for (const c of sample(rng, creators, int(rng, 1, 4))) follow(p, c, int(rng, 1, 40));
    for (const o of sample(rng, players, Math.round(2 + p.activity * 6))) {
      follow(p, o, int(rng, 1, 30));
      if (rng() < 0.45) follow(o, p, int(rng, 1, 30));
    }
  }
  for (const c of creators) for (const o of sample(rng, creators, 3)) follow(c, o, int(rng, 5, 40));
  for (const c of sample(rng, creators, 4)) follow(demo, c, int(rng, 2, 10));
  for (const [i, o] of sample(rng, players, 9).entries()) {
    follow(demo, o, int(rng, 1, 10));
    if (i < 6) follow(o, demo, int(rng, 0, 5));
  }
  await insertChunks(db, "follows", [...follows.values()]);

  // --- likes & saves ----------------------------------------------------------------------
  const likes: object[] = [];
  const saves: object[] = [];
  const liked = new Set<string>();
  for (const p of everyone) {
    for (const g of seeded) {
      const ageDays = Math.max(1, (Date.now() - g.publishedAt.getTime()) / DAY);
      const p0 = (p.id === demo.id ? 0.35 : 0.15 + 0.55 * p.activity) * g.quality * Math.min(1, 0.4 + ageDays / 14);
      if (rng() < p0) {
        likes.push({ user_id: p.id, game_id: g.id, created_at: new Date(Date.now() - rng() * ageDays * DAY).toISOString() });
        liked.add(`${p.id}:${g.id}`);
      }
      if (rng() < p0 * 0.35) saves.push({ user_id: p.id, game_id: g.id, created_at: new Date(Date.now() - rng() * ageDays * DAY).toISOString() });
    }
  }
  await insertChunks(db, "likes", likes);
  await insertChunks(db, "saves", saves);

  // --- scores --------------------------------------------------------------------------------
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - DAY).toISOString().slice(0, 10);
  const best = new Map<string, number>();
  const sessions: object[] = [];
  const bestRows: object[] = [];
  const dailyRows: object[] = [];
  for (const g of seeded) {
    const ageDays = Math.max(1, (Date.now() - g.publishedAt.getTime()) / DAY);
    for (const p of everyone) {
      const plays = p.id === demo.id ? rng() < 0.6 : rng() < 0.35 + 0.6 * p.activity * g.quality;
      if (!plays) continue;
      const top = plausibleScore(rng, g.slug, g.shape, p.skill);
      const runs = int(rng, 1, 4);
      const bestAt = Date.now() - rng() * Math.min(ageDays, 30) * DAY;
      let bestSession = "";
      for (let r = 0; r < runs; r++) {
        const sid = randomUUID();
        const isBest = r === runs - 1;
        const score = isBest ? top : worseScore(rng, top, g.shape);
        const startedAt = isBest ? bestAt : Date.now() - rng() * Math.min(ageDays, 30) * DAY;
        const duration = g.shape.format === "ms" && g.shape.order === "asc" ? Math.max(1500, score + int(rng, 800, 4000)) : int(rng, 14_000, 95_000);
        if (isBest) bestSession = sid;
        const source = rng();
        sessions.push({
          id: sid,
          user_id: p.id,
          game_id: g.id,
          version_id: g.versionId,
          launch_reason: source < 0.75 ? "feed" : source < 0.9 ? "gamePage" : "challenge",
          started_at: new Date(startedAt).toISOString(),
          ended_at: new Date(startedAt + duration).toISOString(),
          duration_ms: duration,
          // Active playtime: the run minus a pause now and then. The game ended it, so it is a play.
          active_ms: Math.round(duration * (0.85 + rng() * 0.13)),
          qualified_at: new Date(startedAt + duration).toISOString(),
          // A creator's own runs never count (play_sessions_analytics skips excluded sessions).
          excluded: p.id === g.creatorId,
          score,
          outcome: "lose",
          accepted: true,
        });
      }
      best.set(`${p.id}:${g.id}`, top);
      bestRows.push({ game_id: g.id, user_id: p.id, best_score: top, achieved_at: new Date(bestAt).toISOString(), session_id: bestSession });
      if (rng() < 0.45) {
        const todays = rng() < 0.3 ? top : worseScore(rng, top, g.shape);
        dailyRows.push({ game_id: g.id, user_id: p.id, day: today, best_score: todays, achieved_at: new Date(Date.now() - rng() * 6 * 3_600_000).toISOString() });
      }
      if (rng() < 0.4) dailyRows.push({ game_id: g.id, user_id: p.id, day: yesterday, best_score: worseScore(rng, top, g.shape), achieved_at: new Date(Date.now() - DAY).toISOString() });
    }
  }
  await insertChunks(db, "play_sessions", sessions);
  await insertChunks(db, "best_scores", bestRows);
  await insertChunks(db, "daily_scores", dailyRows);

  // --- shares & challenges ---------------------------------------------------------------------
  // Only signed-in members can mint share codes, so seeded shares come from named demo members.
  // Challenges carry that member's real best on the game, so the challenge pages show plausible scores.
  const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  const code8 = () => Array.from({ length: 8 }, () => BASE62[Math.floor(rng() * 62)]).join("");
  const shareRows: object[] = [];
  for (const g of seeded) {
    const scorers = players.filter((p) => best.has(`${p.id}:${g.id}`));
    for (const p of sample(rng, scorers, Math.min(scorers.length, int(rng, 2, 5)))) {
      shareRows.push({
        code: code8(),
        user_id: p.id,
        game_id: g.id,
        channel: "challenge",
        challenge_score: best.get(`${p.id}:${g.id}`),
        open_count: int(rng, 0, 40),
        created_at: new Date(Date.now() - rng() * 14 * DAY).toISOString(),
      });
    }
    for (const p of sample(rng, players, int(rng, 1, 3))) {
      shareRows.push({
        code: code8(),
        user_id: p.id,
        game_id: g.id,
        channel: pick(rng, ["link", "system", "card"] as const),
        challenge_score: null,
        open_count: int(rng, 0, 25),
        created_at: new Date(Date.now() - rng() * 14 * DAY).toISOString(),
      });
    }
  }
  await insertChunks(db, "shares", shareRows);

  // --- comments ------------------------------------------------------------------------------
  const commentRows: { id: string; game_id: string; user_id: string; parent_id: string | null; body: string; score_badge: number | null; is_pinned: boolean; is_seed: boolean; created_at: string }[] = [];
  const replyRows: typeof commentRows = [];
  const fill = (tpl: string, g: SeededGame, who: Person): string | null => {
    const b = best.get(`${who.id}:${g.id}`);
    if (tpl.includes("{best}") && b === undefined) return null;
    return tpl.replaceAll("{name}", g.name).replaceAll("{best}", b === undefined ? "" : formatSeedScore(b, g.shape));
  };
  for (const g of seeded) {
    const pool = poolFor(g.slug);
    const creator = people.find((p) => p.id === g.creatorId)!;
    const ageMs = Math.max(DAY, Date.now() - g.publishedAt.getTime());
    commentRows.push({
      id: randomUUID(),
      game_id: g.id,
      user_id: creator.id,
      parent_id: null,
      body: pool.pinned.replaceAll("{name}", g.name),
      score_badge: best.get(`${creator.id}:${g.id}`) ?? null,
      is_pinned: true,
      is_seed: true,
      created_at: new Date(g.publishedAt.getTime() + 3_600_000).toISOString(),
    });
    const authors = sample(rng, players, Math.min(players.length, pool.top.length + 4));
    const texts = sample(rng, pool.top, pool.top.length);
    for (const who of authors) {
      if (texts.length === 0) break;
      // Use the first remaining template this author can fill ({best} needs a score on this game).
      let body: string | null = null;
      for (let k = 0; k < texts.length && body === null; k++) {
        body = fill(texts[k]!, g, who);
        if (body !== null) texts.splice(k, 1);
      }
      if (body === null) continue;
      const id = randomUUID();
      const createdAt = Date.now() - rng() * ageMs * 0.95;
      commentRows.push({
        id,
        game_id: g.id,
        user_id: who.id,
        parent_id: null,
        body,
        score_badge: best.get(`${who.id}:${g.id}`) ?? null,
        is_pinned: false,
        is_seed: true,
        created_at: new Date(createdAt).toISOString(),
      });
      const replies = rng() < 0.55 ? int(rng, 1, 2) : 0;
      for (let r = 0; r < replies; r++) {
        const replier = pick(rng, players.filter((x) => x.id !== who.id));
        replyRows.push({
          id: randomUUID(),
          game_id: g.id,
          user_id: replier.id,
          parent_id: id,
          body: pick(rng, pool.replies),
          score_badge: best.get(`${replier.id}:${g.id}`) ?? null,
          is_pinned: false,
          is_seed: true,
          created_at: new Date(createdAt + int(rng, 5, 600) * 60_000).toISOString(),
        });
      }
      if (rng() < 0.25) {
        replyRows.push({
          id: randomUUID(),
          game_id: g.id,
          user_id: creator.id,
          parent_id: id,
          body: pick(rng, CREATOR_REPLIES),
          score_badge: best.get(`${creator.id}:${g.id}`) ?? null,
          is_pinned: false,
          is_seed: true,
          created_at: new Date(createdAt + int(rng, 30, 900) * 60_000).toISOString(),
        });
      }
    }
  }
  // The demo account gets a couple of comments with replies, so its inbox has real replies in it.
  const demoGames = sample(rng, seeded, Math.min(2, seeded.length));
  const demoLines = ["ok this one is dangerous, I have a meeting in five minutes", "first run was rough, third run felt like I'd been playing for years"];
  for (const [i, g] of demoGames.entries()) {
    const id = randomUUID();
    const createdAt = Date.now() - int(rng, 6, 40) * 3_600_000;
    commentRows.push({ id, game_id: g.id, user_id: demo.id, parent_id: null, body: demoLines[i]!, score_badge: best.get(`${demo.id}:${g.id}`) ?? null, is_pinned: false, is_seed: true, created_at: new Date(createdAt).toISOString() });
    for (const replier of sample(rng, players, 2)) {
      replyRows.push({ id: randomUUID(), game_id: g.id, user_id: replier.id, parent_id: id, body: pick(rng, poolFor(g.slug).replies), score_badge: best.get(`${replier.id}:${g.id}`) ?? null, is_pinned: false, is_seed: true, created_at: new Date(createdAt + int(rng, 10, 300) * 60_000).toISOString() });
    }
  }
  await insertChunks(db, "comments", commentRows);
  await insertChunks(db, "comments", replyRows);

  const commentLikes = new Map<string, object>();
  for (const c of [...commentRows, ...replyRows]) {
    const n = c.is_pinned ? int(rng, 8, 22) : Math.floor(rng() ** 2 * 18);
    for (const p of sample(rng, everyone, n)) {
      if (p.id !== c.user_id) commentLikes.set(`${p.id}:${c.id}`, { user_id: p.id, comment_id: c.id, created_at: c.created_at });
    }
  }
  await insertChunks(db, "comment_likes", [...commentLikes.values()]);

  // --- a few score_beaten notifications for the demo account -----------------------------
  const demoBeaten = seeded
    .filter((g) => best.has(`${demo.id}:${g.id}`))
    .slice(0, 2)
    .map((g) => {
      const mine = best.get(`${demo.id}:${g.id}`)!;
      const rival = pick(rng, players);
      const theirs = g.shape.order === "asc" ? Math.max(1, Math.round(mine * 0.8)) : Math.min(g.shape.max, Math.round(mine * 1.25) + 1);
      return { user_id: demo.id, type: "score_beaten", actor_id: rival.id, game_id: g.id, payload: { score: theirs, theirBest: mine }, created_at: new Date(Date.now() - int(rng, 1, 30) * 3_600_000).toISOString() };
    });
  if (demoBeaten.length) await insertChunks(db, "notifications", demoBeaten);
  // Spread trigger-created notifications for the demo account over the last days and mark seed pushes done.
  const demoNotes = must(await db.from("notifications").select("id").eq("user_id", demo.id), "demo notifications") as { id: string }[];
  await pMap(demoNotes, 8, async (n) => {
    must(await db.from("notifications").update({ created_at: new Date(Date.now() - rng() * 4 * DAY).toISOString(), read_at: rng() < 0.4 ? new Date().toISOString() : null }).eq("id", n.id), "spread notification");
  });
  must(await db.from("notifications").update({ pushed_at: new Date().toISOString() }).is("pushed_at", null).in("user_id", everyone.map((p) => p.id)), "mark pushed");

  // --- stats (the last 28 days including today). Synthetic, but they follow the counting rules (scripts/seed/stats.ts), and
  // the rollup replaces a seeded day as soon as real events exist for it. Social numbers come from the rows
  // seeded above (the counters are final by now), so a creator's 14-day likes never exceed all-time likes.
  type Counters = { id: string; like_count: number; share_count: number; save_count: number; comment_count: number; play_count: number; player_count: number };
  const counters = new Map(
    (
      must(
        await db.from("games").select("id, like_count, share_count, save_count, comment_count, play_count, player_count").in("id", seeded.map((g) => g.id)),
        "game counters",
      ) as Counters[]
    ).map((r) => [r.id, r]),
  );
  const RECENT_SOCIAL_SHARE = 0.6;
  type StatRow = SeedStatDay & { game_id: string; version_id: string; likes: number; shares: number; saves: number; comments: number };
  const statRows: StatRow[] = [];
  const totals = new Map<string, SeedTotals>();
  const now = new Date();
  for (const g of seeded) {
    const shape = { quality: g.quality, publishedDaysAgo: Math.floor((Date.now() - g.publishedAt.getTime()) / DAY) };
    const rows: StatRow[] = seedStatDays(rng, shape, now).map((d) => ({ ...d, game_id: g.id, version_id: g.versionId, likes: 0, shares: 0, saves: 0, comments: 0 }));
    statRows.push(...rows);
    const sum = rows.reduce((a, r) => a + r.play_starts, 0);
    const c = counters.get(g.id);
    if (c && sum > 0) {
      // Largest-remainder split: the days add up to exactly 60 % of the all-time count.
      const spread = (total: number, key: "likes" | "shares" | "saves" | "comments") => {
        const target = Math.round(RECENT_SOCIAL_SHARE * total);
        const raw = rows.map((r) => (target * r.play_starts) / sum);
        rows.forEach((r, i) => (r[key] = Math.floor(raw[i]!)));
        let left = target - rows.reduce((a, r) => a + r[key], 0);
        for (const i of raw.map((v, i) => [v - Math.floor(v), i] as const).sort((a, b) => b[0] - a[0]).map(([, i]) => i)) {
          if (left-- <= 0) break;
          rows[i]![key]++;
        }
      };
      spread(c.like_count, "likes");
      spread(c.share_count, "shares");
      spread(c.save_count, "saves");
      spread(c.comment_count, "comments");
    }
    // play_count and player_count already hold the real seeded sessions (the session trigger counted them).
    totals.set(g.id, seedTotals(rng, shape, rows, { plays: c?.play_count ?? 0, players: c?.player_count ?? 0 }));
  }
  await insertChunks(db, "game_stats_daily", statRows);
  // Locally, playtime counts from the first seeded launch, so the dashboard's "measured since" matches the demo history.
  if (/127\.0\.0\.1|localhost/.test(url) && seeded.length) {
    const first = new Date(Math.min(...seeded.map((g) => g.publishedAt.getTime()))).toISOString().slice(0, 10);
    const cfg = must(await db.from("feed_config").select("value").eq("key", "analytics").single(), "analytics config") as { value: Record<string, unknown> };
    must(await db.from("feed_config").update({ value: { ...cfg.value, playtimeSince: first } }).eq("key", "analytics"), "playtimeSince");
  }
  await pMap(seeded, 6, async (g) => {
    const t = totals.get(g.id)!;
    must(await db.from("games").update({ play_count: t.play_count, player_count: t.player_count, play_ms_total: t.play_ms_total }).eq("id", g.id), `totals ${g.slug}`);
  });

  // --- milestones: everything award_milestones would hand out for these totals, spread over each game's
  // life and already seen, except the newest one of the biggest game, so the portal opens with a celebration.
  const milestoneCfg = (must(await db.from("feed_config").select("value").eq("key", "milestones").single(), "milestone config") as { value: { players: number[]; playtimeHours: number[] } }).value;
  const engaged = async (table: "likes" | "comments" | "shares", g: SeededGame) => {
    let q = db.from(table).select("game_id", { count: "exact", head: true }).eq("game_id", g.id).neq("user_id", g.creatorId);
    if (table === "shares") q = q.eq("channel", "challenge");
    if (table === "comments") q = q.eq("status", "visible");
    const { count } = await q;
    return (count ?? 0) > 0;
  };
  type MilestoneRow = { game_id: string; creator_id: string; kind: string; threshold: number; value: number; detail: object; reached_at: string; seen_at: string | null; is_seed: true };
  const milestoneRows: MilestoneRow[] = [];
  for (const g of seeded) {
    const t = totals.get(g.id)!;
    const life = Date.now() - g.publishedAt.getTime();
    const at = (progress: number) => new Date(g.publishedAt.getTime() + life * Math.min(0.97, Math.max(0.002, progress))).toISOString();
    const earned: { kind: string; threshold: number; value: number; progress: number }[] = [
      { kind: "first_player", threshold: 1, value: 1, progress: 0.002 },
      ...((await engaged("likes", g)) ? [{ kind: "first_like", threshold: 1, value: 1, progress: 0.01 + rng() * 0.02 }] : []),
      ...((await engaged("comments", g)) ? [{ kind: "first_comment", threshold: 1, value: 1, progress: 0.02 + rng() * 0.04 }] : []),
      ...((await engaged("shares", g)) ? [{ kind: "first_challenge", threshold: 1, value: 1, progress: 0.04 + rng() * 0.06 }] : []),
      ...milestoneCfg.players
        .filter((n) => n <= t.player_count)
        .map((n) => ({ kind: "players", threshold: n, value: Math.round(n * (1 + rng() * 0.02)), progress: (n / t.player_count) ** 0.7 })),
      ...milestoneCfg.playtimeHours
        .filter((h) => h * 3_600_000 <= t.play_ms_total)
        .map((h) => ({ kind: "playtime", threshold: h, value: h, progress: ((h * 3_600_000) / t.play_ms_total) ** 0.7 })),
    ];
    for (const e of earned) {
      const reached = at(e.progress);
      milestoneRows.push({
        game_id: g.id,
        creator_id: g.creatorId,
        kind: e.kind,
        threshold: e.threshold,
        value: e.value,
        detail: {},
        reached_at: reached,
        seen_at: new Date(new Date(reached).getTime() + 3_600_000).toISOString(),
        is_seed: true,
      });
    }
  }
  const biggest = [...seeded].sort((a, b) => totals.get(b.id)!.player_count - totals.get(a.id)!.player_count)[0];
  if (biggest) {
    const top = milestoneRows.filter((m) => m.game_id === biggest.id && m.kind === "players").sort((a, b) => b.threshold - a.threshold)[0];
    if (top) {
      top.reached_at = new Date(Date.now() - 3 * 3_600_000).toISOString();
      top.seen_at = null;
    }
    const bestDay = statRows.filter((r) => r.game_id === biggest.id && r.day < now.toISOString().slice(0, 10)).sort((a, b) => b.players - a.players)[0];
    if (bestDay) {
      milestoneRows.push({
        game_id: biggest.id,
        creator_id: biggest.creatorId,
        kind: "best_day",
        threshold: Number(bestDay.day.replaceAll("-", "")),
        value: bestDay.players,
        detail: { players: bestDay.players },
        reached_at: `${bestDay.day}T20:00:00.000Z`,
        seen_at: `${bestDay.day}T21:00:00.000Z`,
        is_seed: true,
      });
    }
  }
  await insertChunks(db, "creator_milestones", milestoneRows);
  const celebrating = biggest ? people.find((p) => p.id === biggest.creatorId)?.handle : undefined;

  // --- editorial rows ------------------------------------------------------------------------
  const byQuality = [...seeded].sort((a, b) => b.quality - a.quality);
  const oneThumb = seeded.filter((g) => !g.vertical && g.inputs.includes("tap"));
  const brainy = seeded.filter((g) => g.tags.some((t) => ["puzzle", "brain", "chess", "logic", "matching", "merge"].includes(t)));
  const editorial = [
    { slug: "staff-picks", title: "Staff picks", subtitle: "What the studio plays on the bus", game_ids: byQuality.slice(0, 6).map((g) => g.id), position: 0 },
    { slug: "one-thumb", title: "One thumb, zero tutorial", subtitle: "Tap to start. Tap to win. Mostly.", game_ids: oneThumb.map((g) => g.id), position: 1 },
    { slug: "brain-break", title: "Big brain break", subtitle: "Puzzles that fit between two meetings", game_ids: brainy.map((g) => g.id), position: 2 },
  ].filter((r) => r.game_ids.length >= 2);
  if (editorial.length) await insertChunks(db, "editorial_rows", editorial);

  must(await db.rpc("compute_trending"), "compute_trending");

  // --- push dispatch wiring (local only: the DB reaches the functions through kong) ---------
  if (/127\.0\.0\.1|localhost/.test(url)) {
    must(await db.rpc("set_runtime_secret", { p_name: "thumbcade_notify_url", p_value: "http://kong:8000/functions/v1/notify" }), "secret url");
    must(await db.rpc("set_runtime_secret", { p_name: "thumbcade_service_role_key", p_value: serviceKey }), "secret key");
  }

  console.log(
    `seed: done in ${((Date.now() - t0) / 1000).toFixed(1)}s — ${seeded.length} games, ${everyone.length} accounts, ${follows.size} follows, ` +
      `${likes.length} likes, ${saves.length} saves, ${commentRows.length + replyRows.length} comments, ${commentLikes.size} comment likes, ` +
      `${bestRows.length} best scores, ${shareRows.length} shares, ${sessions.length} sessions, ${statRows.length} stat days, ${editorial.length} editorial rows, ` +
      `${milestoneRows.length} milestones`,
  );
  if (celebrating) console.log(`seed: @${celebrating} (${celebrating}@${SEED_EMAIL_DOMAIN}, sign-in code via Mailpit) has an unseen milestone to celebrate in the portal`);
}

main().catch((e: unknown) => {
  console.error(`seed failed: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
