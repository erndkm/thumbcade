import { describe, expect, it } from "vitest";
import { createRng } from "@thumbcade-games/kit/rng";
import { Run, STEP } from "../src/game.ts";
import { SKILLS } from "../src/pilot.ts";
import { playRun, type RunReport } from "../src/runs.ts";

/**
 * Whole runs played headless by the pilot through the same pull-and-release the thumb uses, at four skill levels:
 * runs stay feed-length, nobody is out in the first 10 s, an idle player and the reviewer's random swipes both reach
 * the end inside its window, and skill shows in how long a run lasts and how many pages it clears.
 */
const RUNS = 24;
const runs = Object.fromEntries(
  Object.entries(SKILLS).map(([k, s]) => [k, Array.from({ length: RUNS }, (_, i) => playRun(s, 500 + i * 7919))]),
) as Record<keyof typeof SKILLS, RunReport[]>;
const pct = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(p * xs.length))]!;
const med = (rs: RunReport[], k: keyof RunReport) => pct(rs.map((r) => r[k] as number), 0.5);

describe("pilot runs", () => {
  it("every run ends, none in the first 10 s", () => {
    for (const [name, rs] of Object.entries(runs)) {
      for (const r of rs) {
        expect(r.seconds, name).toBeGreaterThan(10);
        expect(r.seconds, name).toBeLessThan(240);
      }
    }
  });

  it("medians land near the feed's bands, and skill makes runs longer", () => {
    expect(med(runs.novice, "seconds")).toBeLessThan(55);
    expect(med(runs.casual, "seconds")).toBeGreaterThan(40);
    expect(med(runs.expert, "seconds")).toBeGreaterThan(65);
    expect(med(runs.expert, "seconds")).toBeLessThan(110);
    expect(med(runs.expert, "seconds")).toBeGreaterThan(med(runs.novice, "seconds"));
    expect(med(runs.good, "seconds")).toBeGreaterThan(med(runs.novice, "seconds"));
  });

  it("skill shows in pages cleared and score", () => {
    expect(med(runs.expert, "pages")).toBeGreaterThan(med(runs.novice, "pages"));
    expect(med(runs.expert, "score")).toBeGreaterThan(med(runs.casual, "score"));
    expect(med(runs.expert, "kos")).toBeGreaterThan(med(runs.novice, "kos"));
  });

  it("an idle player hears the end on its own, inside the reviewer's window", () => {
    const r = playRun(null, 77);
    expect(r.seconds).toBeGreaterThan(18);
    expect(r.seconds).toBeLessThan(35);
    expect(r.drains).toBeGreaterThan(2);
  });

  it("random swipes like the reviewer's reach the end within 95 s", () => {
    for (const seed of [3, 4, 5, 6, 7, 8]) {
      const rng = createRng(seed);
      const run = new Run(seed);
      let t = 0;
      let next = 0.5;
      while (run.phase !== "done" && t < 200) {
        if (t >= next) {
          // A tap or a swipe somewhere on the screen, in any direction (most of them aren't pulls at all).
          run.release(rng.range(-160, 160), rng.range(-160, 160));
          next = t + rng.range(0.4, 2.5);
        }
        run.step();
        run.events.length = 0;
        t += STEP;
      }
      expect(t, `seed ${seed}`).toBeLessThan(95);
    }
  });

  it("the pilot's game-over hints come from its run", () => {
    const hints = new Set(Object.values(runs).flat().map((r) => r.hint));
    expect(hints.size).toBeGreaterThan(2);
  });
});
