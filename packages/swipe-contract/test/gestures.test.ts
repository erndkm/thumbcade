import { describe, expect, it } from "vitest";
import { claims, gestureConfigFor, resolveRelease, shouldShowDockCoach, THRESHOLDS, type CardPhase } from "../src/index.ts";

const NON_PLAYING: CardPhase[] = ["LOADING", "PREVIEW", "ENDED", "PAUSED", "OFFSCREEN", "FAILED"];

describe("ownership table (§5.2)", () => {
  it.each(NON_PLAYING)("%s: the feed owns vertical pans for every game", (phase) => {
    for (const vertical of [false, true]) {
      const c = gestureConfigFor(phase, { vertical });
      expect(c.surfacePan.enabled).toBe(true);
      expect(c.surfacePan.activationDistance).toBe(THRESHOLDS.idleActivation);
      expect(c.gameOwnsSurface).toBe(false);
      expect(c.bottomBar).toBe("tabbar");
      expect(c.overlay).toBe("full");
      expect(c.insets).toBe("preview");
      expect(c.dockPan.enabled).toBe(true);
    }
  });

  it("PLAYING + vertical:false — deliberate surface pans go to the feed with a stricter threshold", () => {
    const c = gestureConfigFor("PLAYING", { vertical: false });
    expect(c.surfacePan.enabled).toBe(true);
    expect(c.surfacePan.activationDistance).toBe(THRESHOLDS.playingActivation);
    expect(c.surfacePan.directionRatio).toBe(THRESHOLDS.playingRatio);
    expect(c.gameOwnsSurface).toBe(false);
    expect(c.bottomBar).toBe("dock");
    expect(c.overlay).toBe("hidden");
    expect(c.insets).toBe("play");
  });

  it("PLAYING + vertical:true — the game owns the surface; Dock and two-finger remain", () => {
    const c = gestureConfigFor("PLAYING", { vertical: true });
    expect(c.surfacePan.enabled).toBe(false);
    expect(c.gameOwnsSurface).toBe(true);
    expect(c.dockPan.enabled).toBe(true);
    expect(c.twoFingerPan.enabled).toBe(true);
    expect(c.bottomBar).toBe("dock");
  });

  it("PLAYING + multitouch disables the two-finger escape (Dock still works)", () => {
    const c = gestureConfigFor("PLAYING", { vertical: true, multitouch: true });
    expect(c.twoFingerPan.enabled).toBe(false);
    expect(c.dockPan.enabled).toBe(true);
  });

  it("the Dock is enabled in every phase for every game (the user always has a way out)", () => {
    for (const phase of [...NON_PLAYING, "PLAYING"] as CardPhase[])
      for (const vertical of [false, true])
        for (const multitouch of [false, true]) expect(gestureConfigFor(phase, { vertical, multitouch }).dockPan.enabled).toBe(true);
  });
});

describe("activation", () => {
  const idle = gestureConfigFor("PREVIEW", { vertical: false }).surfacePan;
  const play = gestureConfigFor("PLAYING", { vertical: false }).surfacePan;
  it("needs distance and a vertical direction", () => {
    expect(claims(idle, 0, 9)).toBe(false);
    expect(claims(idle, 0, -10)).toBe(true);
    expect(claims(idle, 10, 11)).toBe(false); // too diagonal (needs 12)
    expect(claims(idle, 10, 12)).toBe(true);
  });
  it("is stricter while playing", () => {
    expect(claims(play, 0, 20)).toBe(false);
    expect(claims(play, 0, 24)).toBe(true);
    expect(claims(play, 13, 25)).toBe(false);
  });
  it("never claims with a disabled rule", () => {
    expect(claims(gestureConfigFor("PLAYING", { vertical: true }).surfacePan, 0, 500)).toBe(false);
  });
});

describe("release", () => {
  const H = 800;
  it("commits on distance", () => {
    expect(resolveRelease(-161, 0, H)).toBe("next");
    expect(resolveRelease(161, 0, H)).toBe("prev");
    expect(resolveRelease(-150, 0, H)).toBe("stay");
  });
  it("commits on a fling in the same direction", () => {
    expect(resolveRelease(-30, -900, H)).toBe("next");
    expect(resolveRelease(30, 900, H)).toBe("prev");
  });
  it("stays when the fling opposes the displacement", () => {
    expect(resolveRelease(-300, 900, H)).toBe("stay");
  });
  it("respects edges", () => {
    expect(resolveRelease(300, 0, H, { canNext: true, canPrev: false })).toBe("stay");
    expect(resolveRelease(-300, 0, H, { canNext: false, canPrev: true })).toBe("stay");
  });
});

describe("dock coach", () => {
  it("shows only while playing a vertical game, at most 3 times", () => {
    expect(shouldShowDockCoach("PLAYING", { vertical: true }, 0)).toBe(true);
    expect(shouldShowDockCoach("PLAYING", { vertical: true }, 3)).toBe(false);
    expect(shouldShowDockCoach("PLAYING", { vertical: false }, 0)).toBe(false);
    expect(shouldShowDockCoach("PREVIEW", { vertical: true }, 0)).toBe(false);
  });
});
