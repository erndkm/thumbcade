import { readFileSync } from "node:fs";
import { claims, createCardState, gestureConfigFor, run } from "@thumbcade/swipe-contract";
import { describe, expect, it } from "vitest";

/**
 * Pittermoon is played with taps (up a row) and sideways swipes (a sidestep), never up or down, so it declares
 * `controls.vertical: false` and `horizontal: true`: the feed keeps a deliberate vertical swipe even during a run, and
 * a hop only happens on a tap's release, so a swipe the feed claims never moves the cat. Checked against the shipped
 * manifest.
 */
const manifest = JSON.parse(readFileSync(new URL("../thumbcade.json", import.meta.url), "utf8")) as {
  controls: { vertical: boolean; horizontal: boolean; multitouch: boolean; inputs: string[] };
  description: string;
  tags: string[];
  accentColor: string;
};
const controls = manifest.controls;

describe("Swipe Contract", () => {
  it("declares taps and sideways swipes, no vertical control, one finger", () => {
    expect(controls.vertical).toBe(false);
    expect(controls.horizontal).toBe(true);
    expect(controls.multitouch).toBe(false);
    expect(controls.inputs).toEqual(["tap", "swipe"]);
  });

  it("in PLAYING the feed claims a deliberate vertical swipe, never a sidestep or a tap's wobble", () => {
    const g = gestureConfigFor("PLAYING", controls);
    expect(g.gameOwnsSurface).toBe(false);
    expect(g.surfacePan.enabled).toBe(true);
    // A sidestep (the game reads it at 16 px, mostly sideways) is never the feed's.
    expect(claims(g.surfacePan, 16, 4)).toBe(false);
    expect(claims(g.surfacePan, -60, 20)).toBe(false);
    expect(claims(g.surfacePan, 40, 30)).toBe(false);
    // A tap that drifts (the game still hops on release within 26 px) is not the feed's either.
    expect(claims(g.surfacePan, 3, -20)).toBe(false);
    // A real swipe up or down goes to the feed, and the game's press is cancelled: no hop.
    expect(claims(g.surfacePan, 0, -40)).toBe(true);
    expect(claims(g.surfacePan, 5, 60)).toBe(true);
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

  it("has a feed-sized description, 3-5 tags and the first-light accent", () => {
    expect(manifest.description.length).toBeLessThanOrEqual(120);
    expect(manifest.tags.length).toBeGreaterThanOrEqual(3);
    expect(manifest.tags.length).toBeLessThanOrEqual(5);
    expect(manifest.accentColor).toBe("#F2B0C0");
  });
});
