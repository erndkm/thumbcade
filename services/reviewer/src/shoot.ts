import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { GameSession, launchBrowser } from "./driver.ts";
import { startHarness } from "./harness/index.ts";
import { serveBundle } from "./server.ts";

/** A scripted step for screenshots and demos. Coordinates are game-viewport CSS px. */
export type Action =
  | { wait: number }
  | { tap: [number, number] }
  | { taps: [number, number, number, number] } // x, y, count, interval ms
  | { swipe: [number, number, number, number] } // x, y, dx, dy
  | { shot: string };

export const DEFAULT_ACTIONS: Action[] = [{ wait: 1600 }, { shot: "attract" }, { tap: [195, 420] }, { wait: 1400 }, { shot: "play" }];

export interface ShootOptions {
  dir: string;
  slug: string;
  outDir: string;
  actions?: Action[];
  device?: "iphone" | "promax" | "android";
  insetsOverlay?: boolean;
  muted?: boolean;
}

/** Loads a built bundle in the review harness and captures named screenshots along a scripted run. */
export async function shoot(o: ShootOptions): Promise<{ files: string[]; console: string[]; errors: string[] }> {
  const manifest = JSON.parse(await readFile(join(o.dir, "thumbcade.json"), "utf8")) as { entry?: string };
  const server = await serveBundle({ dir: o.dir, slug: o.slug, entry: manifest.entry });
  const harness = await startHarness();
  const browser = await launchBrowser();
  const files: string[] = [];
  try {
    await mkdir(o.outDir, { recursive: true });
    const s = await GameSession.open(browser, harness, {
      gameUrl: server.entryUrl,
      device: o.device,
      muted: o.muted ?? true,
      insetsOverlay: o.insetsOverlay,
      id: o.slug,
    });
    const ready = await s.waitFor("ready", 10_000);
    if (!ready) throw new Error(`${o.slug}: ready() never arrived`);
    for (const a of o.actions ?? DEFAULT_ACTIONS) {
      if ("wait" in a) await s.page.waitForTimeout(a.wait);
      else if ("tap" in a) await s.tap({ x: a.tap[0], y: a.tap[1] });
      else if ("taps" in a) {
        for (let i = 0; i < a.taps[2]; i++) {
          await s.tap({ x: a.taps[0], y: a.taps[1] });
          await s.page.waitForTimeout(a.taps[3]);
        }
      } else if ("swipe" in a) await s.swipe({ x: a.swipe[0], y: a.swipe[1] }, a.swipe[2], a.swipe[3]);
      else if ("shot" in a) {
        const file = join(o.outDir, `${o.slug}-${a.shot}.png`);
        await s.screenshot({ path: file });
        files.push(file);
      }
    }
    const result = {
      files,
      console: s.consoleLines.map((l) => `${l.level}: ${l.text}`),
      errors: [...s.pageErrors, ...s.blockedRequests.map((u) => `blocked ${u}`)],
    };
    await s.close();
    return result;
  } finally {
    await browser.close();
    await harness.close();
    await server.close();
  }
}
