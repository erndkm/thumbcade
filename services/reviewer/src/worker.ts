/**
 * The review worker: polls `review_jobs` (no queue infra, §10.3), claims a job with an optimistic
 * update, downloads the immutable bundle from storage, runs the review, uploads screenshots and the
 * captured poster to game-assets/<slug>/, and reports through `creator-review-callback`.
 *
 * Env: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (falls back to `supabase status` locally),
 *      REVIEWER_POLL_MS (default 2000), SUPABASE_FUNCTIONS_URL (default <SUPABASE_URL>/functions/v1).
 */
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { STORAGE_BUCKETS, type ReviewCallbackRequest, type ReviewReport } from "@thumbcade/protocol";
import type { Browser } from "playwright";
import { launchBrowser } from "./driver.ts";
import { REVIEWER_VERSION, runReview } from "./review.ts";

const MAX_ATTEMPTS = 3;
const STALE_MS = 15 * 60 * 1000;

export interface WorkerEnv {
  url: string;
  key: string;
  functionsUrl: string;
}

export function workerEnv(): WorkerEnv {
  let url = process.env.SUPABASE_URL;
  let key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    try {
      const out = execFileSync("supabase", ["status", "-o", "env"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
      const env = Object.fromEntries(out.split("\n").map((l) => /^([A-Z_]+)="?(.*?)"?$/.exec(l)).filter((m): m is RegExpExecArray => !!m).map((m) => [m[1]!, m[2]!]));
      url ??= env.API_URL;
      key ??= env.SERVICE_ROLE_KEY;
    } catch {
      /* not a local dev machine */
    }
  }
  if (!url || !key) throw new Error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or run next to a local `supabase start`).");
  url = url.replace(/\/$/, "");
  return { url, key, functionsUrl: (process.env.SUPABASE_FUNCTIONS_URL ?? `${url}/functions/v1`).replace(/\/$/, "") };
}

interface Job {
  id: string;
  version_id: string;
  attempts: number;
}

interface VersionRow {
  id: string;
  bundle_path: string;
  manifest: { id: string; poster?: string };
  games: { slug: string };
}

class Rest {
  constructor(private env: WorkerEnv) {}
  private headers(extra: Record<string, string> = {}) {
    return { apikey: this.env.key, authorization: `Bearer ${this.env.key}`, ...extra };
  }
  async json<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(`${this.env.url}${path}`, { ...init, headers: { "content-type": "application/json", ...this.headers(init.headers as Record<string, string>) } });
    const text = await res.text();
    if (!res.ok) throw new Error(`${init.method ?? "GET"} ${path} -> ${res.status} ${text.slice(0, 300)}`);
    return (text ? JSON.parse(text) : null) as T;
  }
  async bytes(path: string): Promise<Buffer> {
    const res = await fetch(`${this.env.url}${path}`, { headers: this.headers() });
    if (!res.ok) throw new Error(`GET ${path} -> ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }
  async upload(bucket: string, path: string, data: Buffer, contentType: string): Promise<string> {
    const res = await fetch(`${this.env.url}/storage/v1/object/${bucket}/${path}`, {
      method: "POST",
      headers: this.headers({ "content-type": contentType, "x-upsert": "true", "cache-control": "max-age=3600" }),
      body: new Uint8Array(data),
    });
    if (!res.ok) throw new Error(`upload ${bucket}/${path} -> ${res.status} ${await res.text()}`);
    return `${this.env.url}/storage/v1/object/public/${bucket}/${path}`;
  }
  /** Recursively lists object paths under a prefix. */
  async list(bucket: string, prefix: string): Promise<string[]> {
    const out: string[] = [];
    const walk = async (p: string) => {
      for (let offset = 0; ; offset += 1000) {
        const items = await this.json<Array<{ name: string; id: string | null }>>(`/storage/v1/object/list/${bucket}`, {
          method: "POST",
          body: JSON.stringify({ prefix: p, limit: 1000, offset, sortBy: { column: "name", order: "asc" } }),
        });
        for (const it of items) {
          const full = `${p}${it.name}`;
          if (it.id === null) await walk(`${full}/`);
          else out.push(full);
        }
        if (items.length < 1000) break;
      }
    };
    await walk(prefix.endsWith("/") ? prefix : `${prefix}/`);
    return out;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function runWorker(opts: { once?: boolean; pollMs?: number; env?: WorkerEnv; log?: (s: string) => void } = {}): Promise<number> {
  const env = opts.env ?? workerEnv();
  const rest = new Rest(env);
  const log = opts.log ?? ((s: string) => console.log(`[reviewer] ${s}`));
  const pollMs = opts.pollMs ?? Number(process.env.REVIEWER_POLL_MS ?? 2000);
  const workerId = `${hostname()}:${process.pid}`;
  let browser: Browser | null = null;
  let processed = 0;
  let stopping = false;
  const stop = () => {
    stopping = true;
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  log(`reviewer ${REVIEWER_VERSION} polling ${env.url} every ${pollMs} ms`);
  try {
    while (!stopping) {
      await requeueStale(rest);
      const job = await claimNext(rest, workerId);
      if (!job) {
        if (opts.once) break;
        await sleep(pollMs);
        continue;
      }
      browser ??= await launchBrowser();
      log(`job ${job.id} (version ${job.version_id}, attempt ${job.attempts})`);
      try {
        const status = await processJob(rest, env, job, browser, log);
        log(`job ${job.id} -> ${status}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log(`job ${job.id} failed: ${message}`);
        await failJob(rest, env, job, message);
      }
      processed++;
      if (opts.once) break;
    }
  } finally {
    await browser?.close();
  }
  return processed;
}

async function requeueStale(rest: Rest): Promise<void> {
  const cutoff = new Date(Date.now() - STALE_MS).toISOString();
  await rest.json(`/rest/v1/review_jobs?status=eq.running&locked_at=lt.${encodeURIComponent(cutoff)}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "queued", locked_by: null }),
  });
}

async function claimNext(rest: Rest, workerId: string): Promise<Job | null> {
  const queued = await rest.json<Job[]>("/rest/v1/review_jobs?status=eq.queued&order=created_at.asc&limit=5&select=id,version_id,attempts");
  for (const job of queued) {
    const claimed = await rest.json<Job[]>(`/rest/v1/review_jobs?id=eq.${job.id}&status=eq.queued`, {
      method: "PATCH",
      headers: { prefer: "return=representation" },
      body: JSON.stringify({ status: "running", locked_by: workerId, locked_at: new Date().toISOString(), attempts: job.attempts + 1 }),
    });
    if (claimed.length) return claimed[0]!;
  }
  return null;
}

async function loadVersion(rest: Rest, versionId: string): Promise<VersionRow> {
  const rows = await rest.json<VersionRow[]>(`/rest/v1/game_versions?id=eq.${versionId}&select=id,bundle_path,manifest,games!game_versions_game_id_fkey!inner(slug)`);
  if (!rows[0]) throw new Error(`version ${versionId} not found`);
  return rows[0];
}

async function processJob(rest: Rest, env: WorkerEnv, job: Job, browser: Browser, log: (s: string) => void): Promise<string> {
  const version = await loadVersion(rest, job.version_id);
  const slug = version.games.slug;
  const dir = await mkdtemp(join(tmpdir(), `tc-review-${slug}-`));
  try {
    const prefix = version.bundle_path.replace(/\/?$/, "/");
    const paths = await rest.list(STORAGE_BUCKETS.gameBundles, prefix);
    if (!paths.length) throw new Error(`no files under ${STORAGE_BUCKETS.gameBundles}/${prefix}`);
    for (const p of paths) {
      const file = join(dir, p.slice(prefix.length));
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, await rest.bytes(`/storage/v1/object/${STORAGE_BUCKETS.gameBundles}/${p.split("/").map(encodeURIComponent).join("/")}`));
    }
    const { report, screenshots, poster } = await runReview({ dir, versionId: version.id, browser, capturePoster: !version.manifest.poster, log: (l) => log(`  ${l}`) });
    report.screenshots = [];
    for (const shot of screenshots) {
      report.screenshots.push(await rest.upload(STORAGE_BUCKETS.gameAssets, `${slug}/reviews/${version.id}/${shot.name}.png`, shot.png, "image/png"));
    }
    let posterPath: string | undefined;
    if (poster) {
      posterPath = `${slug}/posters/${version.id}.jpg`;
      await rest.upload(STORAGE_BUCKETS.gameAssets, posterPath, poster, "image/jpeg");
    }
    return await callback(env, { jobId: job.id, report, ...(posterPath ? { posterPath } : {}) });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function callback(env: WorkerEnv, body: ReviewCallbackRequest): Promise<string> {
  const res = await fetch(`${env.functionsUrl}/creator-review-callback`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${env.key}`, apikey: env.key },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`creator-review-callback -> ${res.status} ${text.slice(0, 300)}`);
  return (JSON.parse(text) as { status: string }).status;
}

/** Retries a crashed review; after the last attempt the version fails with an explanatory report. */
async function failJob(rest: Rest, env: WorkerEnv, job: Job, message: string): Promise<void> {
  if (job.attempts < MAX_ATTEMPTS) {
    await rest.json(`/rest/v1/review_jobs?id=eq.${job.id}`, { method: "PATCH", body: JSON.stringify({ status: "queued", locked_by: null, error: message.slice(0, 1000) }) });
    return;
  }
  const now = new Date().toISOString();
  const report: ReviewReport = {
    versionId: job.version_id,
    startedAt: now,
    finishedAt: now,
    passed: false,
    checks: [{ id: "loads", label: "Loads and connects to the shell", status: "fail", detail: `The reviewer couldn't complete after ${MAX_ATTEMPTS} attempts: ${message.slice(0, 500)}` }],
    metrics: { readyMs: null, initialPayloadGzipBytes: null, totalBytes: null, fps: null, longestTaskMs: null, heapBytes: null },
    console: [],
    screenshots: [],
    posterCaptured: false,
    reviewerVersion: REVIEWER_VERSION,
  };
  try {
    await callback(env, { jobId: job.id, report });
  } finally {
    await rest.json(`/rest/v1/review_jobs?id=eq.${job.id}`, { method: "PATCH", body: JSON.stringify({ status: "failed", error: message.slice(0, 1000), finished_at: now }) });
  }
}
