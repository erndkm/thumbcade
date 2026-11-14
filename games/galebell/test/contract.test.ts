import { readFileSync } from "node:fs";
import { claims, createCardState, gestureConfigFor, run, THRESHOLDS } from "@thumbcade/swipe-contract";
import { describe, expect, it } from "vitest";

/**
 * Galebell is played by holding the left or right half of the screen (one flipper each, both at once), and a tap
 * launches the ball. Nothing moves vertically, so `controls.vertical` is false; two thumbs hold at once, so
 * `controls.multitouch` is true. That costs the feed's two-finger escape while PLAYING; the Dock stays, and so does a
 * deliberate one-finger vertical swipe (the stricter PLAYING threshold), which a held thumb never makes.
 */
const manifest = JSON.parse(readFileSync(new URL("../thumbcade.json", import.meta.url), "utf8")) as {
  controls: { vertical: boolean; horizontal: boolean; multitouch: boolean; inputs: string[] };
  description: string;
  tags: string[];
  accentColor: string;
};
const controls = manifest.controls;

describe("Swipe Contract", () => {
  it("declares two-thumb holds and taps, no vertical motion", () => {
    expect(controls.vertical).toBe(false);
    expect(controls.horizontal).toBe(false);
    expect(controls.multitouch).toBe(true);
    expect(controls.inputs).toEqual(["tap", "hold"]);
  });

  it("in PLAYING the two-finger escape is off (two thumbs are play), the Dock still works", () => {
    const g = gestureConfigFor("PLAYING", controls);
    expect(g.twoFingerPan.enabled).toBe(false);
    expect(g.dockPan.enabled).toBe(true);
    expect(claims(g.dockPan, 0, -10)).toBe(true);
    expect(g.gameOwnsSurface).toBe(false);
  });

  it("a held thumb that wobbles never reaches the feed; a deliberate swipe does", () => {
    const g = gestureConfigFor("PLAYING", controls);
    expect(g.surfacePan.enabled).toBe(true);
    // A thumb resting on a flipper half drifts a few points.
    expect(claims(g.surfacePan, 6, 10)).toBe(false);
    expect(claims(g.surfacePan, 14, -18)).toBe(false);
    // A real swipe up the card.
    expect(claims(g.surfacePan, 0, -(THRESHOLDS.playingActivation + 10))).toBe(true);
  });

  it("a swipe in PREVIEW, ENDED and PAUSED goes to the feed", () => {
    for (const phase of ["PREVIEW", "ENDED", "PAUSED"] as const) {
      const g = gestureConfigFor(phase, controls);
      expect(g.surfacePan.enabled, phase).toBe(true);
      expect(claims(g.surfacePan, 0, -40), phase).toBe(true);
    }
  });

  it("the run starts on a tap", () => {
    const { state } = run([{ type: "ACTIVATE" }, { type: "READY" }, { type: "GAMEPLAY_START", trigger: "tap" }]);
    expect(state.phase).toBe("PLAYING");
    expect(createCardState().phase).not.toBe("PLAYING");
  });

  it("has a feed-sized description, 3-5 tags and the amber accent", () => {
    expect(manifest.description.length).toBeLessThanOrEqual(120);
    expect(manifest.tags.length).toBeGreaterThanOrEqual(3);
    expect(manifest.tags.length).toBeLessThanOrEqual(5);
    expect(manifest.accentColor).toBe("#C48600");
  });
});
