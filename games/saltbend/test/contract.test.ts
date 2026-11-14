import { readFileSync } from "node:fs";
import { claims, createCardState, gestureConfigFor, run } from "@thumbcade/swipe-contract";
import { describe, expect, it } from "vitest";
import { ACCENT } from "./accent.ts";

/**
 * Saltbend is played with one held thumb that never moves, so it declares `controls.vertical: false`: the feed keeps
 * vertical swipes in every state, and while PLAYING a deliberate vertical pan (24 pt, twice as vertical as wide) still
 * goes to the feed, while a hold, however long, stays with the game. This checks that against the shipped manifest.
 */
const manifest = JSON.parse(readFileSync(new URL("../thumbcade.json", import.meta.url), "utf8")) as {
  id: string;
  description: string;
  tags: string[];
  accentColor: string;
  controls: { vertical: boolean; horizontal: boolean; multitouch: boolean; inputs: string[] };
};
const controls = manifest.controls;

describe("Swipe Contract", () => {
  it("declares a hold game the feed keeps vertical swipes for", () => {
    expect(controls.vertical).toBe(false);
    expect(controls.multitouch).toBe(false);
    expect(controls.inputs).toEqual(["hold"]);
  });

  it("in PLAYING a resting or wobbling thumb stays with the game; a deliberate vertical swipe goes to the feed", () => {
    const g = gestureConfigFor("PLAYING", controls);
    expect(g.gameOwnsSurface).toBe(false);
    expect(g.surfacePan.enabled).toBe(true);
    // A hold: no movement, or the few points a resting thumb rolls.
    expect(claims(g.surfacePan, 0, 0)).toBe(false);
    expect(claims(g.surfacePan, 6, -9)).toBe(false);
    expect(claims(g.surfacePan, 14, 20)).toBe(false);
    // A real swipe up.
    expect(claims(g.surfacePan, 4, -40)).toBe(true);
    expect(g.dockPan.enabled).toBe(true);
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

  it("the manifest fits the feed: slug, short description, 3-5 tags, the accent", () => {
    expect(manifest.id).toBe("saltbend");
    expect(manifest.description.length).toBeLessThanOrEqual(120);
    expect(manifest.tags.length).toBeGreaterThanOrEqual(3);
    expect(manifest.tags.length).toBeLessThanOrEqual(5);
    expect(manifest.accentColor).toBe(ACCENT);
  });
});
