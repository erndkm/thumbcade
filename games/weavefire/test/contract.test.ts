import { readFileSync } from "node:fs";
import { claims, createCardState, gestureConfigFor, run } from "@thumbcade/swipe-contract";
import { describe, expect, it } from "vitest";

/**
 * Weavefire's verb is a drag anywhere, in every direction, so the manifest declares vertical control. The Swipe
 * Contract then hands the whole surface to the game while PLAYING and keeps it with the feed in every other state.
 */
const manifest = JSON.parse(readFileSync(new URL("../thumbcade.json", import.meta.url), "utf8")) as {
  controls: { vertical: boolean; horizontal: boolean; multitouch: boolean; inputs: string[] };
};
const controls = manifest.controls;

describe("Swipe Contract", () => {
  it("declares vertical and horizontal drag", () => {
    expect(controls.vertical).toBe(true);
    expect(controls.horizontal).toBe(true);
    expect(controls.multitouch).toBe(false);
    expect(controls.inputs).toContain("drag");
  });

  it("a drag in PLAYING never reaches the feed; the Dock and a two-finger swipe still do", () => {
    const g = gestureConfigFor("PLAYING", controls);
    expect(g.surfacePan.enabled).toBe(false);
    expect(g.gameOwnsSurface).toBe(true);
    expect(claims(g.surfacePan, 0, -400)).toBe(false);
    expect(claims(g.surfacePan, 0, 400)).toBe(false);
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
});
