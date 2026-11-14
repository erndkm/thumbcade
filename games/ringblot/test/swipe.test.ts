import { describe, expect, it } from "vitest";
import { readSwipe, startThumb, SWIPE } from "../src/swipe.ts";

describe("reading the thumb", () => {
  it("nothing until the finger has gone far enough, then the way it went", () => {
    const t = startThumb(1, 100, 500);
    expect(readSwipe(t, 100 + SWIPE - 1, 500)).toBe(-1);
    expect(readSwipe(t, 100 + SWIPE, 501)).toBe(1);
    expect(readSwipe(startThumb(1, 100, 500), 100 - SWIPE, 498)).toBe(3);
    expect(readSwipe(startThumb(1, 100, 500), 103, 500 - SWIPE)).toBe(0);
    expect(readSwipe(startThumb(1, 100, 500), 97, 500 + SWIPE)).toBe(2);
  });

  it("the bigger axis wins a diagonal", () => {
    expect(readSwipe(startThumb(1, 0, 0), 20, -12)).toBe(1);
    expect(readSwipe(startThumb(1, 0, 0), 12, -20)).toBe(0);
  });

  it("the thumb can stay down: every further stretch is another swipe", () => {
    const t = startThumb(1, 200, 600);
    expect(readSwipe(t, 220, 600)).toBe(1);
    // No repeat while it rests.
    expect(readSwipe(t, 224, 603)).toBe(-1);
    // Round the corner without lifting.
    expect(readSwipe(t, 226, 600 - SWIPE - 2)).toBe(0);
    expect(readSwipe(t, 226 - SWIPE - 1, 583)).toBe(3);
    // A long fast drag reads once per stretch, not once per pixel.
    let n = 0;
    for (let x = 210; x >= 110; x -= 2) if (readSwipe(t, x, 583) === 3) n++;
    expect(n).toBeLessThanOrEqual(Math.ceil(100 / SWIPE));
    expect(n).toBeGreaterThanOrEqual(5);
  });
});
