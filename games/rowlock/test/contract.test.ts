import { readFileSync } from "node:fs";
import { claims, createCardState, gestureConfigFor, run } from "@thumbcade/swipe-contract";
import { describe, expect, it } from "vitest";

/**
 * Rowlock is tap only, so it declares `controls.vertical: false`: the feed keeps a deliberate vertical swipe even
 * while a run is on, and a key or digit only acts on release, so a swipe the feed claims never enters a digit. This
 * checks that against the shipped manifest.
 */
const manifest = JSON.parse(readFileSync(new URL("../thumbcade.json", import.meta.url), "utf8")) as {
  controls: { vertical: boolean; horizontal: boolean; multitouch: boolean; inputs: string[] };
  description: string;
  tags: string[];
};
const controls = manifest.controls;

describe("Swipe Contract", () => {
  it("declares tap input and no vertical control", () => {
    expect(controls.vertical).toBe(false);
    expect(controls.multitouch).toBe(false);
    expect(controls.inputs).toEqual(["tap"]);
    expect(manifest.description.length).toBeLessThanOrEqual(120);
    expect(manifest.tags.length).toBeGreaterThanOrEqual(3);
    expect(manifest.tags.length).toBeLessThanOrEqual(5);
  });

  it("in PLAYING the feed claims only a deliberate vertical swipe, never a tap's wobble", () => {
    const g = gestureConfigFor("PLAYING", controls);
    expect(g.gameOwnsSurface).toBe(false);
    expect(g.surfacePan.enabled).toBe(true);
    // A tap that drifts a little (the game still acts on release within 18 px)...
    expect(claims(g.surfacePan, 4, 18)).toBe(false);
    expect(claims(g.surfacePan, 20, -22)).toBe(false);
    // ...but a real swipe goes to the feed, and the game's press is cancelled.
    expect(claims(g.surfacePan, 0, -40)).toBe(true);
    expect(g.dockPan.enabled).toBe(true);
  });

  it("a swipe in PREVIEW, ENDED and PAUSED goes to the feed", () => {
    for (const phase of ["PREVIEW", "ENDED", "PAUSED"] as const) {
      const g = gestureConfigFor(phase, controls);
      expect(g.surfacePan.enabled, phase).toBe(true);
      expect(claims(g.surfacePan, 0, -12), phase).toBe(true);
    }
  });

  it("the run starts on a tap", () => {
    const { state } = run([{ type: "ACTIVATE" }, { type: "READY" }, { type: "GAMEPLAY_START", trigger: "tap" }]);
    expect(state.phase).toBe("PLAYING");
    expect(createCardState().phase).not.toBe("PLAYING");
  });
});
