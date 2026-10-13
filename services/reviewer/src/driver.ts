import { DEVICES, type DeviceProfile } from "@thumbcade/sdk/host";
import { PROBE_SOURCE, type ProbeSnapshot } from "@thumbcade/sdk/probe";
import type { ContractEvent } from "@thumbcade/swipe-contract";
import { chromium, type Browser, type BrowserContext, type CDPSession, type Frame, type Page } from "playwright";
import type { HarnessApi, HarnessEntry } from "./harness/client.ts";
import type { HarnessServer } from "./harness/index.ts";

/** Chrome DevTools "Fast 4G" preset: 9 Mbps down, 1.5 Mbps up, 60 ms RTT × 2.75 (DevTools' adjusted latency). */
export const FAST_4G = {
  offline: false,
  latency: 60 * 2.75,
  downloadThroughput: (9 * 1000 * 1000 * 0.9) / 8,
  uploadThroughput: (1.5 * 1000 * 1000 * 0.9) / 8,
} as const;
export const CPU_THROTTLE = 4;

/**
 * Chromium for reviews. One renderer for harness + game (site isolation off) so CPU/network throttling
 * applies to the game frame too. On macOS WebGL runs on the real GPU through ANGLE/Metal; elsewhere it
 * falls back to SwiftShader (CPU), which can't hold 60 fps for 3D games — run reviewers on GPU hosts.
 */
export async function launchBrowser(opts: { headless?: boolean } = {}): Promise<Browser> {
  const gpu = process.platform === "darwin" ? ["--use-angle=metal", "--enable-gpu"] : ["--enable-unsafe-swiftshader"];
  return chromium.launch({
    headless: opts.headless ?? true,
    args: [
      "--disable-site-isolation-trials",
      "--disable-features=IsolateOrigins,site-per-process",
      "--autoplay-policy=no-user-gesture-required",
      "--enable-precise-memory-info",
      "--ignore-gpu-blocklist",
      ...gpu,
    ],
  });
}

/** The WebGL renderer string the reviewer's Chromium reports (for the report's console). */
export async function webglRenderer(browser: Browser): Promise<string> {
  const page = await browser.newPage();
  try {
    await page.setContent("<canvas></canvas>");
    return await page.evaluate(
      "(() => { const gl = document.querySelector('canvas').getContext('webgl2') || document.querySelector('canvas').getContext('webgl'); if (!gl) return 'no WebGL'; const e = gl.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'WebGL'; })()",
    );
  } finally {
    await page.close();
  }
}

export interface OpenOptions {
  gameUrl: string;
  device?: DeviceProfile["id"];
  /** "feed": phone layout (game viewport + bottom bar); "poster": the game fills a 405×720 page at 8/3 DPR (1080×1920). */
  mode?: "feed" | "poster";
  muted?: boolean;
  /** Draw the preview-inset areas over the game (for screenshots meant for humans). */
  insetsOverlay?: boolean;
  /** Apply the mid-tier profile (4× CPU, Fast 4G) before loading. */
  throttle?: boolean;
  dpr?: number;
  id?: string;
  version?: string;
}

export interface Point {
  x: number;
  y: number;
}

export class GameSession {
  private constructor(
    readonly context: BrowserContext,
    readonly page: Page,
    readonly cdp: CDPSession,
    readonly device: DeviceProfile,
    readonly consoleLines: Array<{ level: string; text: string }>,
    readonly pageErrors: string[],
    readonly blockedRequests: string[],
  ) {}

  static async open(browser: Browser, harness: HarnessServer, o: OpenOptions): Promise<GameSession> {
    const device = DEVICES[o.device ?? "iphone"];
    const poster = o.mode === "poster";
    const context = await browser.newContext({
      viewport: poster ? { width: 405, height: 720 } : { width: device.width, height: device.height },
      deviceScaleFactor: o.dpr ?? (poster ? 8 / 3 : 3),
      isMobile: true,
      hasTouch: true,
      userAgent:
        "Mozilla/5.0 (Linux; Android 14; Pixel 7a) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36 ThumbcadeReviewer/1",
    });
    await context.addInitScript({ content: PROBE_SOURCE });
    const page = await context.newPage();
    const consoleLines: Array<{ level: string; text: string }> = [];
    const pageErrors: string[] = [];
    const blockedRequests: string[] = [];
    const gameOrigin = new URL(o.gameUrl).origin;
    const harnessOrigin = new URL(harness.origin).origin;
    page.on("console", (m) => {
      if (m.location().url?.startsWith(harnessOrigin)) return;
      if (consoleLines.length < 200) consoleLines.push({ level: m.type(), text: m.text().slice(0, 2000) });
    });
    page.on("pageerror", (e) => pageErrors.push(`${e.name}: ${e.message}`.slice(0, 2000)));
    // No external network for games: anything off the game origin (or the harness) is blocked and recorded.
    await context.route("**/*", (route) => {
      const url = route.request().url();
      const origin = url.startsWith("data:") || url.startsWith("blob:") ? null : new URL(url).origin;
      if (origin && origin !== gameOrigin && origin !== harnessOrigin) {
        blockedRequests.push(url.slice(0, 300));
        return route.abort("blockedbyclient");
      }
      return route.continue();
    });
    const cdp = await context.newCDPSession(page);
    if (o.throttle) {
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU_THROTTLE });
      await cdp.send("Network.enable");
      await cdp.send("Network.emulateNetworkConditions", { ...FAST_4G });
    }
    const session = new GameSession(context, page, cdp, device, consoleLines, pageErrors, blockedRequests);
    await page.goto(
      harness.url({
        game: o.gameUrl,
        device: device.id,
        mode: o.mode ?? "feed",
        muted: o.muted ?? true,
        insets: o.insetsOverlay ?? false,
        id: o.id,
        version: o.version,
      }),
    );
    return session;
  }

  /** The game's frame (null until attached). */
  gameFrame(): Frame | null {
    return this.page.frames().find((f) => f !== this.page.mainFrame()) ?? null;
  }

  async unthrottle(): Promise<void> {
    await this.cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
    await this.cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  }

  log(): Promise<HarnessEntry[]> {
    return this.page.evaluate(() => (window as unknown as { __harness: HarnessApi }).__harness.log);
  }

  violations(): Promise<HarnessApi["violations"]> {
    return this.page.evaluate(() => (window as unknown as { __harness: HarnessApi }).__harness.violations);
  }

  phase(): Promise<string> {
    return this.page.evaluate(() => (window as unknown as { __harness: HarnessApi }).__harness.state().phase);
  }

  now(): Promise<number> {
    return this.page.evaluate(() => performance.now());
  }

  /** Waits for an inbound game message of `type` seen after harness time `after`. */
  async waitFor(type: string, timeoutMs: number, after = 0): Promise<HarnessEntry | null> {
    try {
      const handle = await this.page.waitForFunction(
        ([t, a]) =>
          (window as unknown as { __harness?: HarnessApi }).__harness?.log.find((e) => e.dir === "in" && e.type === t && !e.dropped && e.t > (a as number)) ?? null,
        [type, after] as const,
        { timeout: timeoutMs, polling: 25 },
      );
      return (await handle.jsonValue()) as HarnessEntry;
    } catch {
      return null;
    }
  }

  /** performance.now() (harness clock) when the game iframe started loading. */
  startedAt(): Promise<number> {
    return this.page.evaluate(() => (window as unknown as { __harness: HarnessApi }).__harness.startedAt);
  }

  setInsetsOverlay(on: boolean): Promise<void> {
    return this.page.evaluate((v) => (window as unknown as { __harness: HarnessApi }).__harness.setInsetsOverlay(v), on);
  }

  dispatch(ev: ContractEvent): Promise<void> {
    return this.page.evaluate((e) => (window as unknown as { __harness: HarnessApi }).__harness.dispatch(e), ev);
  }

  send(type: string, payload?: unknown): Promise<void> {
    return this.page.evaluate(([t, p]) => (window as unknown as { __harness: HarnessApi }).__harness.send(t as string, p), [type, payload] as const);
  }

  /** Probe snapshot from inside the game frame. */
  async probe(): Promise<ProbeSnapshot | null> {
    const f = this.gameFrame();
    if (!f) return null;
    try {
      return await f.evaluate(() => (window as unknown as { __tcProbe?: { snapshot(): ProbeSnapshot } }).__tcProbe?.snapshot() ?? null);
    } catch {
      return null;
    }
  }

  async probeCall<T>(fn: string, arg?: number): Promise<T | null> {
    const f = this.gameFrame();
    if (!f) return null;
    try {
      return (await f.evaluate(
        ([name, a]) => {
          const p = (window as unknown as { __tcProbe?: Record<string, (x?: number) => unknown> }).__tcProbe;
          return p ? (p[name as string]!(a as number | undefined) as unknown) : null;
        },
        [fn, arg] as const,
      )) as T;
    } catch {
      return null;
    }
  }

  async gameNow(): Promise<number> {
    const f = this.gameFrame();
    return f ? f.evaluate(() => performance.now()) : 0;
  }

  async tap(p: Point): Promise<void> {
    await this.touch("touchStart", p);
    await this.page.waitForTimeout(60);
    await this.touch("touchEnd", p);
  }

  /** A finger swipe from `from` by (dx, dy) over `ms`. */
  swipe(from: Point, dx: number, dy: number, ms = 180, steps = 10): Promise<void> {
    return this.touchSequence(from, dx, dy, ms, undefined, steps);
  }

  /** A swipe with a hook after each move step (lets a test act like the feed mid-gesture). */
  async touchSequence(from: Point, dx: number, dy: number, ms: number, onStep?: (step: number) => Promise<void>, steps = 10): Promise<void> {
    await this.touch("touchStart", from);
    for (let i = 1; i <= steps; i++) {
      await this.page.waitForTimeout(ms / steps);
      await this.touch("touchMove", { x: from.x + (dx * i) / steps, y: from.y + (dy * i) / steps });
      await onStep?.(i);
    }
    await this.touch("touchEnd", { x: from.x + dx, y: from.y + dy });
  }

  private async touch(type: "touchStart" | "touchMove" | "touchEnd", p: Point): Promise<void> {
    await this.cdp.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: type === "touchEnd" ? [] : [{ x: p.x, y: p.y, radiusX: 4, radiusY: 4, force: 1, id: 1 }],
    });
  }

  async screenshot(opts: { path?: string; type?: "png" | "jpeg"; quality?: number; fullPhone?: boolean } = {}): Promise<Buffer> {
    const vp = this.page.viewportSize()!;
    return this.page.screenshot({
      path: opts.path,
      type: opts.type ?? "png",
      quality: opts.type === "jpeg" ? (opts.quality ?? 88) : undefined,
      clip: { x: 0, y: 0, width: vp.width, height: vp.height },
      animations: "allow",
    });
  }

  async close(): Promise<void> {
    await this.context.close();
  }
}
