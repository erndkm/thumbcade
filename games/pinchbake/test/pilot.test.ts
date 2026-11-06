import { readFileSync } from "node:fs";
import { claims, gestureConfigFor, run as runContract } from "@thumbcade/swipe-contract";
import { describe, expect, it } from "vitest";
import { landing, median, simulate, SKILLS } from "../src/pilot.ts";
import { Run } from "../src/run.ts";
import { radius } from "../src/tiers.ts";

const manifest = JSON.parse(readFileSync(new URL("../thumbcade.json", import.meta.url), "utf8")) as {
  controls: { vertical: boolean; horizontal: boolean; multitouch: boolean; inputs: string[] };
};

describe("headless playtests", () => {
  it("lands every skill level in a feed-length run, safe for the first ten seconds, and better play lasts and scores more", () => {
    const meds: number[] = [];
    const scores: number[] = [];
    for (const skill of SKILLS) {
      const res = Array.from({ length: 10 }, (_, i) => simulate(900 + i * 613, skill));
      const secs = res.map((r) => r.seconds);
      expect(Math.min(...secs), skill.name).toBeGreaterThan(20);
      expect(Math.max(...secs), skill.name).toBeLessThan(95);
      meds.push(median(secs));
      scores.push(median(res.map((r) => r.score)));
    }
    expect(meds.every((m) => m >= 20 && m <= 90)).toBe(true);
    expect(meds[SKILLS.length - 1]).toBeGreaterThan(meds[0]!);
    for (let k = 1; k < scores.length; k++) expect(scores[k]).toBeGreaterThan(scores[k - 1]!);
  });

  it("is deterministic for a seed", () => {
    const a = simulate(77, SKILLS[2]!);
    const b = simulate(77, SKILLS[2]!);
    expect(a.score).toBe(b.score);
    expect(a.seconds).toBe(b.seconds);
    expect(a.run.stats).toEqual(b.run.stats);
  });

  it("predicts where a drop lands: on the dough, or on top of what is below", () => {
    const run = new Run(3);
    const w = run.world;
    expect(landing(w, 5, radius(0)).on).toBe(-1);
    w.add(4, 5, w.floor + radius(4), radius(4));
    const l = landing(w, 5, radius(0));
    expect(l.on).toBe(0);
    expect(l.y).toBeCloseTo(w.floor + 2 * radius(4) + radius(0), 6);
  });
});

describe("Swipe Contract", () => {
  it("declares vertical play, so a sloppy diagonal aiming drag never leaves the game mid-run", () => {
    expect(manifest.controls.vertical).toBe(true);
    expect(manifest.controls.horizontal).toBe(true);
    expect(manifest.controls.multitouch).toBe(false);
    expect(manifest.controls.inputs).toEqual(expect.arrayContaining(["drag", "tap"]));
    const playing = gestureConfigFor("PLAYING", manifest.controls);
    expect(playing.surfacePan.enabled).toBe(false);
    // A drag that wanders 60 pt down while aiming 40 pt sideways: the game keeps it.
    expect(claims(playing.surfacePan, 40, 60)).toBe(false);
    expect(claims(playing.surfacePan, 0, -220)).toBe(false);
    // The Dock and a two-finger swipe still reach the feed.
    expect(playing.dockPan.enabled).toBe(true);
    expect(playing.twoFingerPan.enabled).toBe(true);
  });

  it("hands vertical swipes to the feed outside a run", () => {
    for (const phase of ["PREVIEW", "ENDED", "PAUSED"] as const) {
      const g = gestureConfigFor(phase, manifest.controls);
      expect(claims(g.surfacePan, 0, -40), phase).toBe(true);
    }
    const { state } = runContract([{ type: "ACTIVATE" }, { type: "READY" }, { type: "GAMEPLAY_START", trigger: "tap" }]);
    expect(state.phase).toBe("PLAYING");
  });
});
