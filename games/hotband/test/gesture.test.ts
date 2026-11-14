import { describe, expect, it } from "vitest";
import { Gesture, TOUCH } from "../src/gesture.ts";
import { COLS, ROWS } from "../src/pieces.ts";
import { Run } from "../src/run.ts";
import { lit } from "../src/well.ts";

const COL = 44;
const setup = () => {
  const run = new Run(7).start();
  run.step(1 / 60);
  return { run, g: new Gesture(COL) };
};
/** Drags from (x0, y0) by (dx, dy) over `ms`, in 8 ms steps. */
const drag = (g: Gesture, run: Run, x0: number, y0: number, dx: number, dy: number, ms: number, t0 = 0) => {
  const steps = Math.max(1, Math.round(ms / 8));
  for (let i = 1; i <= steps; i++) g.move(x0 + (dx * i) / steps, y0 + (dy * i) / steps, t0 + (ms * i) / steps, run);
};

describe("one thumb", () => {
  it("a tap turns the piece; a tap that wandered or lingered does not", () => {
    const { run, g } = setup();
    g.press(200, 500, 0, run);
    expect(g.release(203, 498, 120, run)).toBe("turn");
    expect(run.active!.rot).toBe(1);
    g.press(200, 500, 1000, run);
    expect(g.release(200, 500, 1000 + TOUCH.tapMs + 30, run)).toBe("none");
    g.press(200, 500, 2000, run);
    g.move(200, 500 - TOUCH.tapSlop - 4, 2040, run);
    expect(g.release(200, 500, 2080, run)).toBe("none");
    expect(run.active!.rot).toBe(1);
  });

  it("a drag slides the piece band by band from wherever the thumb went down, and back again", () => {
    const { run, g } = setup();
    const x0 = run.active!.x;
    g.press(300, 600, 0, run);
    drag(g, run, 300, 600, -COL * 1.8, 0, 200);
    expect(run.active!.x).toBe(x0 - 2);
    drag(g, run, 300 - COL * 1.8, 600, COL * 1.8 + COL, 0, 200, 200);
    expect(run.active!.x).toBe(x0 + 1);
    // Lifting after a drag is not a tap.
    expect(g.release(300 + COL, 600, 420, run)).toBe("none");
    expect(run.active!.rot).toBe(0);
  });

  it("small wobbles under the slop move nothing", () => {
    const { run, g } = setup();
    const x0 = run.active!.x;
    g.press(100, 400, 0, run);
    g.move(100 + TOUCH.dragSlop - 1, 402, 30, run);
    expect(run.active!.x).toBe(x0);
  });

  it("pushing on against a wall is forgotten: the way back answers at once", () => {
    const { run, g } = setup();
    g.press(200, 600, 0, run);
    drag(g, run, 200, 600, -COL * 7, 0, 300);
    expect(run.active!.x).toBe(0);
    // One band's worth back to the right moves one band, not nothing.
    drag(g, run, 200 - COL * 7, 600, COL, 0, 100, 300);
    expect(run.active!.x).toBe(1);
  });

  it("a flick down slams the piece once; the rest of that touch does nothing", () => {
    const { run, g } = setup();
    g.press(200, 300, 0, run);
    drag(g, run, 200, 300, 6, 120, 90);
    expect(run.active).toBeNull();
    expect(lit(run.well)).toBe(3);
    expect(run.stats.slams).toBe(1);
    for (let i = 0; i < 20; i++) run.step(1 / 60);
    const x = run.active!.x;
    drag(g, run, 206, 420, -150, 60, 200, 100);
    expect(run.active!.x).toBe(x);
    expect(g.release(56, 480, 320, run)).toBe("none");
    expect(run.stats.slams).toBe(1);
  });

  it("a sideways swipe with a little downward drift is a slide, never a slam", () => {
    const { run, g } = setup();
    g.press(100, 300, 0, run);
    drag(g, run, 100, 300, 160, 40, 90);
    expect(run.stats.slams).toBe(0);
    expect(run.active!.x).toBeGreaterThan(3);
  });

  it("a slow pull down lets the piece fall fast until the thumb comes back up or lifts", () => {
    const { run, g } = setup();
    g.press(200, 300, 0, run);
    drag(g, run, 200, 300, 0, TOUCH.pullPx + 8, 400);
    expect(run.soft).toBe(true);
    expect(run.stats.slams).toBe(0);
    drag(g, run, 200, 300 + TOUCH.pullPx + 8, 0, -TOUCH.pullPx, 300, 400);
    expect(run.soft).toBe(false);
    drag(g, run, 200, 308, 0, TOUCH.pullPx + 8, 400, 700);
    expect(run.soft).toBe(true);
    // A pull is not a tap either.
    expect(g.release(200, 346, 1200, run)).toBe("none");
    expect(run.soft).toBe(false);
    expect(run.active!.rot).toBe(0);
  });

  it("a new piece arriving under a thumb that is still down starts from where the thumb is", () => {
    const { run, g } = setup();
    g.press(200, 600, 0, run);
    drag(g, run, 200, 600, COL * 2.6, 0, 200);
    expect(run.active!.x).toBe(2 + 3);
    // The piece falls and locks while the thumb rests.
    while (run.pieceCount === 1) run.step(1 / 60);
    const x = run.active!.x;
    g.move(200 + COL * 2.6 + 2, 600, 9000, run);
    expect(run.active!.x).toBe(x);
    drag(g, run, 200 + COL * 2.6 + 2, 600, -COL, 0, 100, 9000);
    expect(run.active!.x).toBe(x - 1);
  });

  it("a cancelled touch leaves nothing half-done: no turn, no pull", () => {
    const { run, g } = setup();
    g.press(200, 300, 0, run);
    drag(g, run, 200, 300, 0, TOUCH.pullPx + 8, 400);
    g.cancel(run);
    expect(run.soft).toBe(false);
    expect(g.release(200, 300, 500, run)).toBe("none");
    g.press(200, 300, 600, run);
    g.cancel(run);
    expect(g.release(200, 300, 650, run)).toBe("none");
    expect(run.active!.rot).toBe(0);
    expect([COLS, ROWS]).toEqual([8, 18]);
  });
});
