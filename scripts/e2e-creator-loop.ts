/**
 * Proves the creator loop end to end against the local stack:
 *
 *   create-thumbcade-game → thumbcade publish → reviewer worker → creator-review-callback
 *   → approve_version → the game is in the `feed` response for a brand-new guest.
 *
 * Needs: `supabase start`, `supabase functions serve --env-file supabase/functions/.env` (pnpm dev does both).
 * Usage: pnpm exec tsx scripts/e2e-creator-loop.ts [--keep]
 */
import { execFileSync, execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { FeedResponseSchema } from "@thumbcade/protocol";

const root = resolve(import.meta.dirname, "..");
const keep = process.argv.includes("--keep");
const status = JSON.parse(execSync("supabase status -o json", { cwd: root, stdio: ["ignore", "pipe", "ignore"] }).toString()) as Record<string, string>;
const API = status.API_URL!;
const admin = createClient(API, status.SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

const t0 = Date.now();
const step = (n: number, msg: string) => console.log(`\x1b[33m${String(n).padStart(2, "0")}\x1b[0m ${msg} \x1b[2m(${((Date.now() - t0) / 1000).toFixed(1)}s)\x1b[0m`);
const ok = (msg: string) => console.log(`   \x1b[32m✓\x1b[0m ${msg}`);
function fail(msg: string): never {
  console.error(`   \x1b[31m✗ ${msg}\x1b[0m`);
  process.exit(1);
}
const run = (cmd: string, args: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {}) =>
  execFileSync(cmd, args, { cwd: opts.cwd ?? root, env: { ...process.env, ...opts.env }, stdio: ["ignore", "pipe", "pipe"] }).toString();

const stamp = Date.now().toString(36);
const name = `Loop ${stamp}`;
const slug = `loop-${stamp}`;
const tmp = mkdtempSync(join(tmpdir(), "thumbcade-e2e-"));
const dir = join(tmp, slug);
let versionId = "";

try {
  step(1, "Build the CLI and the scaffolder");
  run("pnpm", ["--filter", "@thumbcade/cli", "build"]);
  run("pnpm", ["--filter", "create-thumbcade-game", "build"]);
  ok("built");

  step(2, `Scaffold “${name}” from the Canvas 2D template`);
  run("node", ["packages/create-game/bin/create.js", dir, "--name", name, "--template", "canvas", "--yes", "--local", root]);
  ok(dir);

  step(3, "Issue a creator token");
  const token = run("pnpm", ["--filter", "@thumbcade/cli", "dev-token", "e2ecreator"]).trim().split("\n").pop()!.trim();
  if (!token.startsWith("tc_")) fail(`unexpected token output: ${token}`);
  ok(`${token.slice(0, 11)}…`);

  step(4, "thumbcade validate && thumbcade publish");
  const env = { THUMBCADE_TOKEN: token, THUMBCADE_NO_KEYCHAIN: "1", NO_COLOR: "1" };
  run("npx", ["thumbcade", "validate"], { cwd: dir, env });
  const out = run("npx", ["thumbcade", "publish", "--notes", "e2e creator loop"], { cwd: dir, env });
  versionId = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/.exec(out)?.[0] ?? "";
  if (!versionId) fail(`no version id in publish output:\n${out}`);
  ok(`version ${versionId}`);

  step(5, "Reviewer worker processes the job");
  run("pnpm", ["--filter", "@thumbcade/reviewer", "worker", "--once"]);
  // With `pnpm dev` running, its own worker may have claimed the job first: wait for whichever runs it.
  let v: { status: string; review_report: unknown } | null = null;
  for (let i = 0; i < 60; i++) {
    v = (await admin.from("game_versions").select("status, review_report").eq("id", versionId).single()).data as typeof v;
    if (v?.status !== "auto_checking" && v?.status !== "uploaded") break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (v?.status !== "pending_review") fail(`version is ${v?.status}, expected pending_review. Report: ${JSON.stringify(v?.review_report).slice(0, 400)}`);
  const report = v.review_report as { checks: { id: string; status: string }[] };
  ok(`pending_review · ${report.checks.filter((c) => c.status === "pass").length}/${report.checks.length} checks passed`);

  step(6, "Admin approves the version");
  const { error: aErr } = await admin.rpc("approve_version", { p_version_id: versionId, p_notes: "e2e" });
  if (aErr) fail(aErr.message);
  const { data: g } = await admin.from("games").select("status, live_version_id").eq("slug", slug).single();
  if (g?.status !== "live" || g.live_version_id !== versionId) fail(`game is ${g?.status} with live version ${g?.live_version_id}`);
  ok("live");

  step(7, "A brand-new guest gets it in the feed");
  const guest = createClient(API, status.ANON_KEY!, { auth: { persistSession: false } });
  const { data: session, error: sErr } = await guest.auth.signInAnonymously();
  if (sErr || !session.session) fail(`anonymous sign-in failed: ${sErr?.message}`);
  const res = await fetch(`${API}/functions/v1/feed?tab=foryou&limit=20&first=${slug}`, {
    headers: { Authorization: `Bearer ${session.session.access_token}`, apikey: status.ANON_KEY! },
  });
  if (!res.ok) fail(`feed returned ${res.status}: ${await res.text()}`);
  const feed = FeedResponseSchema.parse(await res.json());
  const card = feed.cards.find((c) => c.game.slug === slug);
  if (!card) fail(`not in the feed (got ${feed.cards.map((c) => c.game.slug).join(", ")})`);
  if (card.version.id !== versionId) fail(`feed serves version ${card.version.id}`);
  const entry = await fetch(card.version.entryUrl);
  if (!entry.ok) fail(`game host returned ${entry.status} for ${card.version.entryUrl}`);
  ok(`card ${card.cardId} → ${card.version.entryUrl} (${entry.status}, CSP ${entry.headers.get("content-security-policy") ? "set" : "MISSING"})`);

  console.log(`\n\x1b[32mCreator loop verified in ${((Date.now() - t0) / 1000).toFixed(1)}s.\x1b[0m`);
} finally {
  if (!keep) {
    if (versionId) {
      const { data: g } = await admin.from("games").select("id").eq("slug", slug).maybeSingle();
      if (g) await admin.from("games").delete().eq("id", g.id);
      const { data: files } = await admin.storage.from("game-bundles").list(`${slug}/${versionId}`, { limit: 1000 });
      if (files?.length) await admin.storage.from("game-bundles").remove(files.map((f) => `${slug}/${versionId}/${f.name}`));
    }
    rmSync(tmp, { recursive: true, force: true });
  }
}
