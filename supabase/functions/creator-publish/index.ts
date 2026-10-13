/**
 * POST /functions/v1/creator-publish   (see packages/protocol/src/publish.ts)
 *   Authorization: Bearer tc_<creator token>
 *   multipart/form-data: manifest (JSON string), bundle (zip, thumbcade.json at the root), notes (optional)
 *   -> 201 PublishResponse { gameId, versionId, status: "auto_checking", reviewUrl }
 *   -> 4xx { error, message, issues? } when the upload can't become a version (bad token, invalid manifest,
 *      oversize, slug owned by someone else, version already published).
 *
 * GET /functions/v1/creator-publish                 -> who am I: { handle, displayName, role, games[] }
 * GET /functions/v1/creator-publish?versionId=<id>  -> review status of one of my versions
 *
 * Bundles are stored immutably at game-bundles/<slug>/<versionId>/<path>. The automated reviewer
 * (services/reviewer) picks up the review_jobs row; an admin approves in the portal.
 */
import { gzipSync, unzipSync } from "fflate";
import {
  adminClient,
  BUDGETS,
  bundleObjectPath,
  HttpError,
  json,
  MANIFEST_FILENAME,
  mimeFor,
  publicObjectUrl,
  requireCreator,
  reviewUrl,
  serve,
  STORAGE_BUCKETS,
  validateManifest,
  type Manifest,
  type PublishResponse,
} from "./shared.ts";

const MAX_FILES = 2000;
const MAX_PUBLISHES_PER_HOUR = 20;

serve(async (req) => {
  if (req.method === "GET") return status(req);
  if (req.method !== "POST") throw new HttpError(405, "method_not_allowed", "Use POST to publish, GET for status.");
  return publish(req);
});

async function publish(req: Request): Promise<Response> {
  const creator = await requireCreator(req);
  const db = adminClient();

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new HttpError(400, "invalid_body", "Send multipart/form-data with manifest, bundle and optional notes.");
  }
  const bundle = form.get("bundle");
  const manifestField = form.get("manifest");
  const notes = typeof form.get("notes") === "string" ? String(form.get("notes")).trim().slice(0, 500) : null;
  if (!(bundle instanceof File)) throw new HttpError(400, "missing_bundle", "Attach the zipped build as `bundle`.");
  if (bundle.size > BUDGETS.totalBundleBytes) {
    throw new HttpError(413, "too_large", `The zip is ${(bundle.size / 1048576).toFixed(1)} MB; the hard cap is ${BUDGETS.totalBundleBytes / 1048576} MB.`);
  }

  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(new Uint8Array(await bundle.arrayBuffer()));
  } catch {
    throw new HttpError(400, "bad_zip", "The bundle isn't a readable zip file.");
  }
  // Drop directory entries; refuse anything that could escape the version folder.
  const entries = Object.entries(files).filter(([p]) => !p.endsWith("/"));
  const issues: string[] = [];
  for (const [path] of entries) {
    if (path.startsWith("/") || path.split("/").includes("..") || path.includes("\\") || /[\u0000-\u001f]/.test(path)) issues.push(`Unsafe path in zip: ${path}`);
  }
  if (entries.length === 0) issues.push("The zip is empty.");
  if (entries.length > MAX_FILES) issues.push(`The bundle has ${entries.length} files; the limit is ${MAX_FILES}.`);
  const totalBytes = entries.reduce((n, [, d]) => n + d.length, 0);
  if (totalBytes > BUDGETS.totalBundleBytes) issues.push(`Unzipped, the bundle is ${(totalBytes / 1048576).toFixed(1)} MB; the hard cap is ${BUDGETS.totalBundleBytes / 1048576} MB.`);
  if (issues.length) throw new HttpError(422, "invalid_bundle", issues[0]!, issues);

  const zipManifest = files[MANIFEST_FILENAME];
  if (!zipManifest) throw new HttpError(422, "missing_manifest", `${MANIFEST_FILENAME} must be at the root of the zip.`);
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(zipManifest));
  } catch {
    throw new HttpError(422, "invalid_manifest", `${MANIFEST_FILENAME} is not valid JSON.`);
  }
  const parsed = validateManifest(raw);
  if (!parsed.ok) throw new HttpError(422, "invalid_manifest", "thumbcade.json doesn't match the manifest schema.", parsed.issues);
  const manifest: Manifest = parsed.manifest;
  if (typeof manifestField === "string") {
    try {
      const sent = JSON.parse(manifestField) as { id?: string; version?: string };
      if (sent.id !== manifest.id || sent.version !== manifest.version) {
        throw new HttpError(422, "manifest_mismatch", "The manifest field and the thumbcade.json inside the zip disagree (id/version). Rebuild and publish again.");
      }
    } catch (e) {
      if (e instanceof HttpError) throw e;
      throw new HttpError(422, "invalid_manifest", "The manifest field is not valid JSON.");
    }
  }
  const missing = [manifest.entry, manifest.icon, ...(manifest.poster ? [manifest.poster] : [])].filter((p) => !files[p]);
  if (missing.length) throw new HttpError(422, "missing_files", `Missing from the bundle: ${missing.join(", ")}.`, missing.map((m) => `${m} is referenced by thumbcade.json but not in the zip`));

  // The slug is the game's identity: first publish claims it, nobody else can take it.
  const { data: existing, error: gErr } = await db.from("games").select("id, slug, creator_id, status, icon_url, poster_url").eq("slug", manifest.id).maybeSingle();
  if (gErr) throw gErr;
  if (existing && existing.creator_id !== creator.id) {
    throw new HttpError(409, "slug_taken", `The id "${manifest.id}" belongs to another creator. Pick a different "id" in thumbcade.json.`);
  }

  let gameId = existing?.id as string | undefined;
  if (gameId) {
    const { count: dup } = await db.from("game_versions").select("id", { count: "exact", head: true }).eq("game_id", gameId).eq("semver", manifest.version);
    if (dup) throw new HttpError(409, "version_exists", `Version ${manifest.version} is already published. Bump "version" in thumbcade.json.`);
    const since = new Date(Date.now() - 3600_000).toISOString();
    const { count: recent } = await db.from("game_versions").select("id", { count: "exact", head: true }).eq("game_id", gameId).gte("created_at", since);
    if ((recent ?? 0) >= MAX_PUBLISHES_PER_HOUR) throw new HttpError(429, "rate_limited", "That's a lot of publishes in an hour. Take a breath and try again later.");
  } else {
    const { data: created, error: cErr } = await db
      .from("games")
      .insert({
        slug: manifest.id,
        creator_id: creator.id,
        name: manifest.name,
        description: manifest.description,
        accent_color: manifest.accentColor,
        tags: manifest.tags,
        age_rating: manifest.ageRating,
        controls: manifest.controls,
        session_length: manifest.session,
        audio: manifest.audio,
        score_config: manifest.score,
        status: "in_review",
      })
      .select("id")
      .single();
    if (cErr) {
      if (cErr.code === "23505") throw new HttpError(409, "slug_taken", `The id "${manifest.id}" was just taken. Pick another.`);
      throw cErr;
    }
    gameId = created.id as string;
  }

  // Upload every file under an immutable, unguessable version path.
  const versionId = crypto.randomUUID();
  const storage = db.storage.from(STORAGE_BUCKETS.gameBundles);
  let gzipBytes = 0;
  const queue = [...entries];
  const worker = async () => {
    for (let item = queue.shift(); item; item = queue.shift()) {
      const [path, data] = item;
      gzipBytes += gzipSync(data, { level: 6 }).length;
      const { error } = await storage.upload(bundleObjectPath(manifest.id, versionId, path), data, {
        contentType: mimeFor(path),
        cacheControl: "31536000",
        upsert: false,
      });
      if (error) throw new HttpError(502, "storage_failed", `Upload of ${path} failed: ${error.message}`);
    }
  };
  try {
    await Promise.all(Array.from({ length: 6 }, worker));
  } catch (e) {
    await removeVersionFiles(manifest.id, versionId, entries.map(([p]) => p));
    throw e;
  }

  const { error: vErr } = await db.from("game_versions").insert({
    id: versionId,
    game_id: gameId,
    semver: manifest.version,
    manifest: raw,
    bundle_path: `${manifest.id}/${versionId}/`,
    size_bytes: totalBytes,
    gzip_bytes: gzipBytes,
    status: "auto_checking",
    release_notes: notes || null,
    submitted_by: creator.id,
  });
  if (vErr) {
    await removeVersionFiles(manifest.id, versionId, entries.map(([p]) => p));
    if (vErr.code === "23505") throw new HttpError(409, "version_exists", `Version ${manifest.version} is already published. Bump "version" in thumbcade.json.`);
    throw vErr;
  }
  const { error: jErr } = await db.from("review_jobs").insert({ version_id: versionId });
  if (jErr) throw jErr;

  // First publish: the bundle's icon (and poster) become the game's profile picture until edited in the portal.
  const assetUpdate: Record<string, string> = {};
  const assets = db.storage.from(STORAGE_BUCKETS.gameAssets);
  if (!existing?.icon_url) {
    const path = `${manifest.id}/icon.png`;
    const { error } = await assets.upload(path, files[manifest.icon]!, { contentType: "image/png", upsert: true });
    if (!error) assetUpdate.icon_url = publicObjectUrl(STORAGE_BUCKETS.gameAssets, path);
  }
  if (!existing?.poster_url && manifest.poster) {
    const ext = manifest.poster.toLowerCase().endsWith(".png") ? "png" : "jpg";
    const path = `${manifest.id}/poster.${ext}`;
    const { error } = await assets.upload(path, files[manifest.poster]!, { contentType: ext === "png" ? "image/png" : "image/jpeg", upsert: true });
    if (!error) assetUpdate.poster_url = publicObjectUrl(STORAGE_BUCKETS.gameAssets, path);
  }
  if (existing && (existing.status === "draft" || existing.status === "rejected")) assetUpdate.status = "in_review";
  if (Object.keys(assetUpdate).length) await db.from("games").update(assetUpdate).eq("id", gameId);

  const body: PublishResponse = { gameId: gameId!, versionId, status: "auto_checking", reviewUrl: reviewUrl(manifest.id, versionId) };
  return json(body, 201);
}

async function removeVersionFiles(slug: string, versionId: string, paths: string[]): Promise<void> {
  const storage = adminClient().storage.from(STORAGE_BUCKETS.gameBundles);
  for (let i = 0; i < paths.length; i += 100) {
    await storage.remove(paths.slice(i, i + 100).map((p) => bundleObjectPath(slug, versionId, p)));
  }
}

async function status(req: Request): Promise<Response> {
  const creator = await requireCreator(req);
  const db = adminClient();
  const versionId = new URL(req.url).searchParams.get("versionId");
  if (!versionId) {
    const { data: games } = await db
      .from("games")
      .select("slug, name, status, live_version_id")
      .eq("creator_id", creator.id)
      .order("created_at", { ascending: false });
    return json({
      handle: creator.handle,
      displayName: creator.displayName,
      role: creator.role,
      games: (games ?? []).map((g) => ({ slug: g.slug, name: g.name, status: g.status, liveVersionId: g.live_version_id })),
    });
  }
  if (!/^[0-9a-f-]{36}$/i.test(versionId)) throw new HttpError(400, "bad_version", "versionId must be a UUID.");
  const { data: v, error } = await db
    .from("game_versions")
    .select("id, semver, status, review_report, review_notes, created_at, games!game_versions_game_id_fkey!inner(slug, creator_id)")
    .eq("id", versionId)
    .maybeSingle();
  if (error) throw error;
  const game = (v as unknown as { games?: { slug: string; creator_id: string } } | null)?.games;
  if (!v || !game || game.creator_id !== creator.id) throw new HttpError(404, "not_found", "No version with that id in your games.");
  const report = v.review_report as { passed?: boolean; checks?: Array<{ id: string; label: string; status: string; detail?: string }> } | null;
  return json({
    versionId: v.id,
    slug: game.slug,
    semver: v.semver,
    status: v.status,
    reviewUrl: reviewUrl(game.slug, v.id),
    reviewNotes: v.review_notes,
    report: report ? { passed: report.passed ?? false, checks: report.checks ?? [] } : null,
  });
}
