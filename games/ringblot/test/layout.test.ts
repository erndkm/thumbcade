import { describe, expect, it } from "vitest";
import { COLS, ROWS } from "../src/grid.ts";
import { FOOT, HUD_H, sheetLayout, SIDE } from "../src/layout.ts";

/** The three phones the simulator and the reviewer use: the game's viewport (screen less the bottom bar) and the status bar. */
const PHONES = [
  { name: "android 360", w: 360, h: 800 - 56 - 20, top: 28 },
  { name: "iphone 390", w: 390, h: 844 - 56 - 34, top: 47 },
  { name: "pro max 430", w: 430, h: 932 - 56 - 34, top: 59 },
];

describe("the sheet fills the phone", () => {
  it("sits under the tickets, inside the screen, on every phone", () => {
    for (const p of PHONES) {
      const { cs, fx, fy } = sheetLayout(p.w, p.h, p.top);
      expect(fx, p.name).toBeGreaterThanOrEqual(SIDE - 1e-9);
      expect(fx + COLS * cs, p.name).toBeLessThanOrEqual(p.w - SIDE + 1e-9);
      expect(fy, p.name).toBeGreaterThanOrEqual(p.top + HUD_H - 1e-9);
      expect(fy + ROWS * cs, p.name).toBeLessThanOrEqual(p.h - FOOT + 1e-9);
      // Centred left to right.
      expect(fx).toBeCloseTo(p.w - (fx + COLS * cs), 6);
    }
  });

  it("takes at least nine tenths of the room under the tickets, and at least three quarters of the whole screen", () => {
    for (const p of PHONES) {
      const { cs } = sheetLayout(p.w, p.h, p.top);
      const sheet = COLS * cs * ROWS * cs;
      const room = (p.w - SIDE * 2) * (p.h - p.top - HUD_H - FOOT);
      expect(sheet / room, p.name).toBeGreaterThanOrEqual(0.9);
      expect(sheet / (p.w * p.h), p.name).toBeGreaterThanOrEqual(0.75);
      // It touches the screen's sides or its top and bottom: no smaller than it has to be.
      const wide = Math.abs(COLS * cs - (p.w - SIDE * 2)) < 1e-6;
      const tall = Math.abs(ROWS * cs - (p.h - p.top - HUD_H - FOOT)) < 1e-6;
      expect(wide || tall, p.name).toBe(true);
    }
  });

  it("keeps a square big enough for a thumb to follow", () => {
    for (const p of PHONES) expect(sheetLayout(p.w, p.h, p.top).cs, p.name).toBeGreaterThanOrEqual(22);
  });
});
