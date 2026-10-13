import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Browser } from "playwright";
import { launchBrowser } from "../src/driver.ts";
import { runReview } from "../src/review.ts";
import { buildFixture } from "./fixtures/build.ts";

let browser: Browser;
beforeAll(async () => {
  browser = await launchBrowser();
});
afterAll(() => browser.close());

const status = (r: Awaited<ReturnType<typeof runReview>>["report"]) => Object.fromEntries(r.checks.map((c) => [c.id, c.status]));

describe("runReview (headless Chromium)", () => {
  it("passes a game that follows the contract, with screenshots and a captured poster", async () => {
    const { report, screenshots, poster } = await runReview({ dir: await buildFixture("good"), browser });
    expect(status(report)).toMatchObject({
      manifest: "pass",
      size: "pass",
      static_scan: "pass",
      loads: "pass",
      ready_budget: "pass",
      tap_starts: "pass",
      no_swipe_start: "pass",
      pause_stops_loop: "pass",
      pause_stops_audio: "pass",
      gameplay_end: "pass",
      no_uncaught_errors: "pass",
      insets: "pass",
    });
    expect(report.passed).toBe(true);
    expect(report.metrics.readyMs).toBeGreaterThan(0);
    expect(screenshots.map((s) => s.name)).toEqual(["attract", "playing", "ended"]);
    expect(poster?.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
  });

  it("fails a game that starts on a swipe, ignores pause, drones on and throws", async () => {
    const { report } = await runReview({ dir: await buildFixture("bad"), browser, capturePoster: false });
    expect(report.passed).toBe(false);
    expect(status(report)).toMatchObject({
      no_swipe_start: "fail",
      pause_stops_loop: "fail",
      pause_stops_audio: "fail",
      no_uncaught_errors: "fail",
      insets: "warn",
    });
    expect(report.checks.find((c) => c.id === "no_uncaught_errors")!.detail).toContain("kaboom");
  });
});
