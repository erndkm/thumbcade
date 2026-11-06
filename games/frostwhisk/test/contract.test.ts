import { readFileSync } from "node:fs";
import { claims, createCardState, gestureConfigFor, run } from "@thumbcade/swipe-contract";
import { describe, expect, it } from "vitest";

/**
 * Frostwhisk is played by dragging the cat's mallet all over its half, up and down included, so it declares
 * `controls.vertical: true`: while PLAYING the surface belongs to the game, and the feed is reached through the Dock or
 * a two-finger swipe. In every other state a vertical swipe still goes to the feed. Checked against the shipped manifest.
 */
const manifest = JSON.parse(readFileSync(new URL("../thumbcade.json", import.meta.url), "utf8")) as {
  controls: { vertical: boolean; horizontal: boolean; multitouch: boolean; inputs: string[] };
  description: string;
  tags: string[];
};
const controls = manifest.controls;

describe("Swipe Contract", () => {
  it("declares vertical drag control, one finger", () => {
    expect(controls.vertical).toBe(true);
    expect(controls.horizontal).toBe(true);
    expect(controls.multitouch).toBe(false);
    expect(controls.inputs).toEqual(["drag"]);
  });

  it("a drag in PLAYING never reaches the feed; the Dock and a two-finger swipe still do", () => {
    const g = gestureConfigFor("PLAYING", controls);
    expect(g.surfacePan.enabled).toBe(false);
    expect(g.gameOwnsSurface).toBe(true);
    // A long, straight vertical drag (pulling the mallet back to the den) is not claimed.
    expect(claims(g.surfacePan, 4, 300)).toBe(false);
    expect(claims(g.surfacePan, 0, -300)).toBe(false);
    expect(g.dockPan.enabled).toBe(true);
    expect(claims(g.dockPan, 0, -10)).toBe(true);
    expect(g.twoFingerPan.enabled).toBe(true);
  });

  it("a swipe in PREVIEW, ENDED and PAUSED goes to the feed", () => {
    for (const phase of ["PREVIEW", "ENDED", "PAUSED"] as const) {
      const g = gestureConfigFor(phase, controls);
      expect(g.surfacePan.enabled, phase).toBe(true);
      expect(claims(g.surfacePan, 0, -40), phase).toBe(true);
    }
  });

  it("the run starts on a tap and the surface flips to the game", () => {
    const { state } = run([{ type: "ACTIVATE" }, { type: "READY" }, { type: "GAMEPLAY_START", trigger: "tap" }]);
    expect(state.phase).toBe("PLAYING");
    expect(gestureConfigFor(state.phase, controls).surfacePan.enabled).toBe(false);
    expect(createCardState().phase).not.toBe("PLAYING");
  });

  it("has a feed-sized description and 3-5 tags", () => {
    expect(manifest.description.length).toBeLessThanOrEqual(120);
    expect(manifest.tags.length).toBeGreaterThanOrEqual(3);
    expect(manifest.tags.length).toBeLessThanOrEqual(5);
  });
});
