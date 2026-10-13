import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { checkBundle, mb, type BundleCheck } from "@thumbcade/cli/checks";
import { BUDGETS, type Manifest, type ReviewCheck, type ReviewCheckId, type ReviewReport } from "@thumbcade/protocol";
import { FEED_LAYOUT } from "@thumbcade/sdk/host";
import type { Browser } from "playwright";
import { GameSession, launchBrowser, webglRenderer, type Point } from "./driver.ts";
import { startHarness, type HarnessServer } from "./harness/index.ts";
import { serveBundle, type GameServer } from "./server.ts";

export const REVIEWER_VERSION = "1.0.0";

const LABELS: Record<ReviewCheckId, string> = {
  manifest: "Manifest and assets are valid",
  size: "Size budget (3 MB gz before ready, 15 MB total)",
  static_scan: "No remote code, eval or off-origin URLs in the bundle",
  network: "No requests to other origins at runtime",
  loads: "Loads and connects to the shell",
  ready_budget: "ready() within 2.5 s (4× CPU, Fast 4G)",
  tap_starts: "A tap starts a run",
  no_swipe_start: "A swipe never starts a run",
  pause_stops_loop: "Pause stops the loop",
  pause_stops_audio: "Pause stops all audio",
  no_uncaught_errors: "No uncaught errors",
  fps: `Attract mode holds ${BUDGETS.minFps}+ fps`,
  long_tasks: `No long tasks over ${BUDGETS.longTaskMs} ms after ready()`,
  heap: `JS heap ≤ ${BUDGETS.heapBytes / 1048576} MB`,
  insets: "Respects the feed insets",
  gameplay_end: "gameplay.end() follows game over",
};

const ORDER: ReviewCheckId[] = [
  "manifest",
  "size",
  "static_scan",
  "network",
  "loads",
  "ready_budget",
  "tap_starts",
  "no_swipe_start",
  "pause_stops_loop",
  "pause_stops_audio",
  "gameplay_end",
  "no_uncaught_errors",
  "fps",
  "long_tasks",
  "heap",
  "insets",
];

export interface ReviewOptions {
  /** Bundle directory (thumbcade.json at its root). */
  dir: string;
  versionId?: string;
  browser?: Browser;
  /** Capture a 1080×1920 poster from attract mode (always when the manifest has none). */
  capturePoster?: boolean;
  /** Called with progress lines (CLI output). */
  log?: (line: string) => void;
}

export interface ReviewResult {
  report: ReviewReport;
  screenshots: Array<{ name: string; png: Buffer }>;
  poster: Buffer | null;
}

type CheckMap = Partial<Record<ReviewCheckId, Omit<ReviewCheck, "id" | "label">>>;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function fromBundle(c: BundleCheck): Omit<ReviewCheck, "id" | "label"> {
  const detail = c.findings
    .filter((f) => f.status !== "pass")
    .map((f) => `${f.status === "fail" ? "✗" : "!"} ${f.message}${f.file ? ` (${f.file})` : ""}`)
    .join("\n");
  return { status: c.status, ...(detail ? { detail } : {}), ...(c.value !== undefined ? { value: c.value } : {}), ...(c.budget !== undefined ? { budget: c.budget } : {}) };
}

/**
 * The automated review (§10.3): static checks, then the build in headless Chromium at 390×844 inside
 * the review harness (real iframe host + Swipe Contract machine), under the mid-tier profile for loading.
 */
export async function runReview(opts: ReviewOptions): Promise<ReviewResult> {
  const startedAt = new Date().toISOString();
  const log = opts.log ?? (() => undefined);
  const checks: CheckMap = {};
  const consoleLines: Array<{ level: string; text: string }> = [];
  const screenshots: Array<{ name: string; png: Buffer }> = [];
  const metrics: ReviewReport["metrics"] = { readyMs: null, initialPayloadGzipBytes: null, totalBytes: null, fps: null, longestTaskMs: null, heapBytes: null };
  let poster: Buffer | null = null;

  log("static checks");
  const bundle = await checkBundle(opts.dir);
  for (const c of bundle.checks) checks[c.id] = fromBundle(c);
  metrics.totalBytes = bundle.totals.totalBytes;
  metrics.initialPayloadGzipBytes = bundle.totals.initialGzipBytes;
  const manifest = bundle.manifest;

  let browser: Browser | null = null;
  let server: GameServer | null = null;
  let harness: HarnessServer | null = null;
  if (manifest) {
    try {
      browser = opts.browser ?? (await launchBrowser());
      consoleLines.push({ level: "info", text: `reviewer ${REVIEWER_VERSION} · WebGL: ${await webglRenderer(browser)}` });
      server = await serveBundle({ dir: opts.dir, slug: manifest.id, versionId: opts.versionId ?? "review", entry: manifest.entry });
      harness = await startHarness();
      await runtimeChecks({ browser, server, harness, manifest, checks, metrics, consoleLines, screenshots, log });
      if (opts.capturePoster || !manifest.poster) {
        log("poster");
        poster = await capturePosterWith(browser, harness, server, manifest).catch((err: unknown) => {
          consoleLines.push({ level: "warn", text: `poster capture failed: ${err instanceof Error ? err.message : String(err)}` });
          return null;
        });
      }
    } finally {
      await harness?.close();
      await server?.close();
      if (!opts.browser) await browser?.close();
    }
  }

  const list: ReviewCheck[] = ORDER.map((id) => ({
    id,
    label: LABELS[id],
    ...(checks[id] ?? { status: "skip" as const, detail: manifest ? "Not reached" : "Skipped: the manifest is invalid" }),
  }));
  const report: ReviewReport = {
    versionId: opts.versionId ?? randomUUID(),
    startedAt,
    finishedAt: new Date().toISOString(),
    passed: list.every((c) => c.status !== "fail") && !!manifest,
    checks: list,
    metrics,
    console: consoleLines.slice(0, 200),
    screenshots: [],
    posterCaptured: !!poster,
    reviewerVersion: REVIEWER_VERSION,
  };
  return { report, screenshots, poster };
}

interface RuntimeCtx {
  browser: Browser;
  server: GameServer;
  harness: HarnessServer;
  manifest: Manifest;
  checks: CheckMap;
  metrics: ReviewReport["metrics"];
  consoleLines: Array<{ level: string; text: string }>;
  screenshots: Array<{ name: string; png: Buffer }>;
  log: (line: string) => void;
}

async function runtimeChecks(c: RuntimeCtx): Promise<void> {
  const { checks, metrics } = c;
  const s = await GameSession.open(c.browser, c.harness, { gameUrl: c.server.entryUrl, muted: false, throttle: true, id: c.manifest.id });
  try {
    const vp = await s.page.evaluate(() => (window as unknown as { __harness: { viewport: { width: number; height: number } } }).__harness.viewport);
    const W = vp.width;
    const H = vp.height;
    // Points inside the attract safe area: left of the rail, below the top tabs, above the caption.
    const safeX = (W - FEED_LAYOUT.actionRailWidth) / 2;
    const safeY = (top: number) => Math.round(top + (H - FEED_LAYOUT.captionHeight - top) * 0.55);
    const playTop = s.device.statusBar + FEED_LAYOUT.topBarHeight;
    const tapPoint: Point = { x: Math.round(safeX), y: safeY(playTop) };

    // --- loads + ready under the mid-tier profile -------------------------------------------------
    c.log("loading (4x CPU, Fast 4G)");
    const startedAt = await s.startedAt();
    const hello = await s.waitFor("hello", BUDGETS.loadTimeoutMs);
    checks.loads = hello
      ? { status: "pass", detail: `hello after ${Math.round(hello.t - startedAt)} ms` }
      : { status: "fail", detail: "The game never sent hello. Import @thumbcade/sdk and call tc.init() at startup." };
    // Warm Playwright's helper script into the game frame now, so its injection cost is never blamed on the game.
    if (hello) await s.gameNow();
    const ready = hello ? await s.waitFor("ready", BUDGETS.loadTimeoutMs) : null;
    if (ready) {
      const readyMs = Math.round(ready.t - startedAt);
      metrics.readyMs = readyMs;
      checks.ready_budget = {
        status: readyMs <= BUDGETS.readyMs ? "pass" : "fail",
        value: readyMs,
        budget: BUDGETS.readyMs,
        detail: `${(readyMs / 1000).toFixed(2)} s cold${readyMs > BUDGETS.readyMs ? ". Defer heavy assets until after ready() and keep the entry bundle small." : ""}`,
      };
      // What was actually requested before ready (gzip, deduplicated).
      const before = new Map<string, number>();
      for (const r of c.server.requests) if (r.status === 200 && r.at <= ready.t - startedAt + 50) before.set(r.file, r.gzipBytes);
      const measured = [...before.values()].reduce((a, b) => a + b, 0);
      metrics.initialPayloadGzipBytes = Math.max(metrics.initialPayloadGzipBytes ?? 0, measured);
      if (measured > BUDGETS.initialPayloadGzipBytes) {
        checks.size = { status: "fail", value: measured, budget: BUDGETS.initialPayloadGzipBytes, detail: `${mb(measured)} gzipped was requested before ready()` };
      } else if (checks.size) {
        checks.size = { ...checks.size, value: measured, budget: BUDGETS.initialPayloadGzipBytes };
      }
    } else {
      checks.ready_budget = { status: "fail", detail: hello ? `No ready() within ${BUDGETS.loadTimeoutMs / 1000} s. Call tc.ready() once the first frame is drawn.` : "Never connected." };
    }
    if (!ready) return;

    // --- attract mode: long tasks under throttle, then fps on the GPU --------------------------------
    c.log("attract mode");
    const gameReadyAt = (await s.gameNow()) - 50;
    await sleep(2500);
    await s.setInsetsOverlay(true);
    c.screenshots.push({ name: "attract", png: await s.screenshot() });
    await s.setInsetsOverlay(false);
    await s.unthrottle();
    const f0 = await s.probe();
    await sleep(3000);
    const f1 = await s.probe();
    if (f0 && f1) {
      const fps = Math.round(((f1.frames - f0.frames) / (f1.now - f0.now)) * 1000);
      metrics.fps = fps;
      checks.fps = {
        status: fps >= BUDGETS.minFps ? "pass" : fps >= 45 ? "warn" : "fail",
        value: fps,
        budget: BUDGETS.minFps,
        detail: `${fps} fps over 3 s of attract mode`,
      };
      checks.insets = f1.insetsRead
        ? { status: "pass", detail: "The game reads its insets (ctx.insets / tc.insets / insets events). Check the attract screenshot: title and prompt must sit outside the hatched areas." }
        : {
            status: "warn",
            detail: "The SDK never saw the game read its insets. If you lay out with the --tc-preview-inset-* CSS variables that's fine; otherwise keep essential UI out of the hatched areas in the attract screenshot.",
          };
    }

    // --- a swipe in preview must not start a run ----------------------------------------------------
    c.log("swipe test");
    const swipeAt = await s.now();
    const from: Point = { x: Math.round(safeX), y: Math.round(H * 0.62) };
    await s.touchSequence(from, 0, -220, 220, async (step) => {
      // Like the feed: claim the gesture once it passes 10 pt, which sends input.cancel + pause.
      if (step === 1) await s.dispatch({ type: "FEED_GESTURE_BEGIN" });
    });
    await s.dispatch({ type: "FEED_GESTURE_END", committed: false });
    await sleep(700);
    const swipeStart = (await s.log()).find((e) => e.dir === "in" && e.type === "gameplay.start" && e.t > swipeAt);
    const swipeViolations = (await s.violations()).filter((v) => v.code === "start_by_swipe");
    if (swipeStart || swipeViolations.length) {
      checks.no_swipe_start = { status: "fail", detail: "A vertical swipe in attract mode started a run. Start runs on the release of a tap, never on pointerdown or a swipe (Swipe Contract rule 1)." };
    }

    // --- offscreen pause in attract mode ------------------------------------------------------------
    c.log("pause (offscreen)");
    const loopIssues: string[] = [];
    const audioIssues: string[] = [];
    await pauseProbe(s, { type: "DEACTIVATE" }, { type: "ACTIVATE" }, "attract mode (offscreen)", loopIssues, audioIssues);

    // --- a tap starts a run --------------------------------------------------------------------------
    c.log("tap to start");
    let started: Awaited<ReturnType<typeof s.waitFor>> = null;
    for (const p of [tapPoint, { x: tapPoint.x, y: Math.round(H * 0.42) }, { x: Math.round(W * 0.3), y: Math.round(H * 0.5) }]) {
      const before = await s.now();
      await s.tap(p);
      started = await s.waitFor("gameplay.start", 1500, before);
      if (started) break;
    }
    if (!started) {
      checks.tap_starts = { status: "fail", detail: "Three taps in the attract safe area didn't call gameplay.start(). A tap anywhere must start a run." };
    } else {
      const trigger = (started.payload as { trigger?: string } | undefined)?.trigger ?? "none";
      checks.tap_starts = trigger === "tap" ? { status: "pass", detail: "gameplay.start() with trigger \"tap\"" } : { status: "warn", detail: `gameplay.start() arrived with trigger "${trigger}"` };
      if (trigger === "swipe") checks.no_swipe_start = { status: "fail", detail: "The run-starting input was classified as a swipe." };
    }
    checks.no_swipe_start ??= { status: "pass", detail: "A 220 pt vertical swipe in attract mode didn't start a run" };

    // --- during a run ---------------------------------------------------------------------------------
    let ended: Awaited<ReturnType<typeof s.waitFor>> = null;
    if (started) {
      await sleep(900);
      c.screenshots.push({ name: "playing", png: await s.screenshot() });
      c.log("pause (during a run)");
      ended = await s.waitFor("gameplay.end", 10, started.t);
      if (!ended) await pauseProbe(s, { type: "PAUSE", reason: "user" }, { type: "RESUME_PLAY" }, "a run", loopIssues, audioIssues);

      c.log("waiting for game over");
      const t0 = Date.now();
      ended = await s.waitFor("gameplay.end", 25_000, started.t);
      let how = "without input";
      if (!ended) {
        how = "after random taps";
        const until = Date.now() + 70_000;
        let i = 0;
        while (!ended && Date.now() < until) {
          const p = { x: Math.round(30 + ((i * 97) % (W - 60))), y: Math.round(playTop + 40 + ((i * 151) % (H - playTop - 80))) };
          if (c.manifest.controls.inputs.includes("swipe") && i % 3 === 2) {
            const dirs = [[0, -120], [0, 120], [-120, 0], [120, 0]] as const;
            const [dx, dy] = dirs[i % 4]!;
            await s.swipe(p, dx, dy, 120, 6);
          } else {
            await s.tap(p);
          }
          i++;
          ended = await s.waitFor("gameplay.end", 250, started.t);
          // A run that ends also lets the game sit "over"; a tap there would start a new run — stop now.
        }
      }
      if (ended) {
        const secs = ((Date.now() - t0) / 1000).toFixed(1);
        checks.gameplay_end = { status: "pass", detail: `gameplay.end(${JSON.stringify(ended.payload)}) arrived ${how} after ${secs} s` };
        await sleep(700);
        c.screenshots.push({ name: "ended", png: await s.screenshot() });
      } else {
        checks.gameplay_end = { status: "warn", detail: "No game over within 95 s of automated play. Make sure gameplay.end() fires within 1 s of game over; a human reviewer will check." };
      }
    }
    checks.pause_stops_loop = loopIssues.length ? { status: "fail", detail: loopIssues.join("\n") } : { status: "pass", detail: "No animation frames after pause (attract and mid-run)" };
    checks.pause_stops_audio = audioIssues.length ? { status: "fail", detail: audioIssues.join("\n") } : { status: "pass", detail: "Every AudioContext suspended / every source stopped while paused" };

    // --- errors, long tasks, heap ---------------------------------------------------------------------
    const snap = await s.probe();
    const lt = snap ? snap.longTasks.filter((t) => t.start >= gameReadyAt) : [];
    const longest = lt.reduce((m, t) => Math.max(m, t.duration), 0);
    metrics.longestTaskMs = Math.round(longest);
    checks.long_tasks = {
      status: longest <= BUDGETS.longTaskMs ? "pass" : "fail",
      value: Math.round(longest),
      budget: BUDGETS.longTaskMs,
      detail: lt.length
        ? `${lt.length} task(s) over 50 ms after ready(); longest ${Math.round(longest)} ms at +${((lt.find((t) => t.duration === longest)!.start - gameReadyAt) / 1000).toFixed(1)} s`
        : "No main-thread task over 50 ms after ready()",
    };
    metrics.heapBytes = snap?.heapBytes ?? null;
    checks.heap = snap?.heapBytes
      ? { status: snap.heapBytes <= BUDGETS.heapBytes ? "pass" : "fail", value: snap.heapBytes, budget: BUDGETS.heapBytes, detail: `${(snap.heapBytes / 1048576).toFixed(1)} MB` }
      : { status: "skip", detail: "Heap size unavailable" };

    const errors = [...s.pageErrors, ...(snap?.errors ?? [])];
    const unique = [...new Set(errors)];
    checks.no_uncaught_errors = unique.length ? { status: "fail", detail: unique.slice(0, 8).join("\n") } : { status: "pass" };
    const urls = [...new Set([...s.blockedRequests, ...(snap?.foreignRequests ?? [])])];
    checks.network = urls.length
      ? { status: "fail", detail: `Blocked by the content security policy: ${urls.slice(0, 5).join(", ")}${urls.length > 5 ? ` and ${urls.length - 5} more` : ""}` }
      : { status: "pass" };
    c.consoleLines.push(...s.consoleLines);
  } finally {
    await s.close();
  }
}

/** Sends a pause through the state machine, then checks frames and audio while paused, then resumes. */
async function pauseProbe(
  s: GameSession,
  pause: Parameters<GameSession["dispatch"]>[0],
  resume: Parameters<GameSession["dispatch"]>[0],
  where: string,
  loopIssues: string[],
  audioIssues: string[],
): Promise<void> {
  const t0 = await s.gameNow();
  await s.dispatch(pause);
  await sleep(1100);
  const frames = (await s.probeCall<number>("callbacksSince", t0 + 300)) ?? 0;
  const audio = await s.probeCall<{ audible: boolean; activeSources: number; mediaPlaying: number }>("audio");
  if (frames > 2) loopIssues.push(`${frames} animation frames in the 0.8 s after pause in ${where}. Stop your loop on pause (tc.loop does it for you; Three.js: don't use setAnimationLoop; Pixi: stop the ticker).`);
  if (audio?.audible) audioIssues.push(`${audio.activeSources + audio.mediaPlaying} sound source(s) still playing after pause in ${where}. Suspend your AudioContext / pause media on pause.`);
  await s.dispatch(resume);
  await sleep(300);
}

/** Captures a 1080×1920 JPEG of attract mode (preview insets applied, muted). */
export async function capturePosterWith(browser: Browser, harness: HarnessServer, server: GameServer, manifest: Manifest): Promise<Buffer> {
  const s = await GameSession.open(browser, harness, { gameUrl: server.entryUrl, mode: "poster", muted: true, id: manifest.id });
  try {
    if (!(await s.waitFor("ready", BUDGETS.loadTimeoutMs))) throw new Error("ready() never arrived");
    await sleep(1800);
    return await s.screenshot({ type: "jpeg", quality: 88 });
  } finally {
    await s.close();
  }
}

/** Standalone poster capture for a bundle directory (games:build). */
export async function capturePoster(dir: string, browser?: Browser): Promise<Buffer> {
  const manifest = JSON.parse(await readFile(join(dir, "thumbcade.json"), "utf8")) as Manifest;
  const b = browser ?? (await launchBrowser());
  const server = await serveBundle({ dir, slug: manifest.id, entry: manifest.entry });
  const harness = await startHarness();
  try {
    return await capturePosterWith(b, harness, server, manifest);
  } finally {
    await harness.close();
    await server.close();
    if (!browser) await b.close();
  }
}
