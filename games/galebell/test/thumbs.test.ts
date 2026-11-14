import { describe, expect, it } from "vitest";
import { TAP_MS, Thumbs } from "../src/thumbs.ts";

const W = 390;

describe("two thumbs", () => {
  it("each half holds its own flipper, and both together work", () => {
    const t = new Thumbs();
    t.down(1, 60, 700, 0, W);
    expect(t.side(0)).toBe(true);
    expect(t.side(1)).toBe(false);
    t.down(2, 330, 700, 10, W);
    expect(t.side(0)).toBe(true);
    expect(t.side(1)).toBe(true);
    // Letting go of one keeps the other up.
    t.up(1, 60, 700, 400);
    expect(t.side(0)).toBe(false);
    expect(t.side(1)).toBe(true);
  });

  it("a thumb that slides across the middle keeps the flipper it started on", () => {
    const t = new Thumbs();
    t.down(1, 150, 700, 0, W);
    // (The pointer moves; only up/cancel matter.)
    expect(t.side(0)).toBe(true);
    expect(t.up(1, 260, 700, 800)).toBe(false);
    expect(t.side(0)).toBe(false);
  });

  it("a short, still press is a tap (it launches); a hold or a slide is not", () => {
    const t = new Thumbs();
    t.down(1, 300, 500, 0, W);
    expect(t.up(1, 302, 503, 80)).toBe(true);
    t.down(2, 300, 500, 0, W);
    expect(t.up(2, 300, 500, TAP_MS + 50)).toBe(false);
    t.down(3, 300, 500, 0, W);
    expect(t.up(3, 300, 540, 90)).toBe(false);
  });

  it("the feed taking the gesture lets go of everything, and a cancelled press is never a tap", () => {
    const t = new Thumbs();
    t.down(1, 60, 700, 0, W);
    t.down(2, 330, 700, 0, W);
    t.cancelAll();
    expect(t.side(0) || t.side(1)).toBe(false);
    expect(t.up(1, 60, 700, 50)).toBe(false);
    t.down(3, 60, 700, 0, W);
    t.cancel(3);
    expect(t.up(3, 60, 700, 40)).toBe(false);
    expect(t.count).toBe(0);
  });
});
