import { describe, expect, it } from "vitest";
import { SPECS } from "../src/board.ts";
import { textWidth } from "../src/font.ts";
import { attractBoard, CELL, HEARTH_H, hud, HUD_H, playBoard, PROMPT_H, RUG_PAD, SIGN_H } from "../src/layout.ts";

/**
 * The reviewer's phones as the pixel screen sees them: art pixels across and down, the status bar's height, and
 * what the feed leaves free outside a run (the top tabs, the action rail on the right, the caption at the bottom).
 */
const PHONES = [
  { name: "iphone", sw: 130, sh: 251, top: 16, safe: { x0: 0, y0: 31, x1: 106, y1: 202 } },
  { name: "promax", sw: 144, sh: 281, top: 20, safe: { x0: 0, y0: 35, x1: 119, y1: 231 } },
  { name: "android", sw: 135, sh: 272, top: 11, safe: { x0: 0, y0: 27, x1: 108, y1: 216 } },
];
/** The attract demo plays the first three rugs. */
const DEMO_RUGS = 3;

describe("layout", () => {
  it("every rug of a run fits on every phone, under the HUD and the hearth, fringe and all", () => {
    for (const p of PHONES) {
      for (const s of SPECS) {
        const o = playBoard(p.sw, p.sh, p.top, s.cols, s.rows);
        expect(o.x - RUG_PAD, `${p.name} ${s.cols}x${s.rows}`).toBeGreaterThanOrEqual(0);
        expect(o.x + s.cols * CELL + RUG_PAD).toBeLessThanOrEqual(p.sw);
        expect(o.y - RUG_PAD).toBeGreaterThanOrEqual(p.top + HUD_H + HEARTH_H);
        expect(o.y + s.rows * CELL + RUG_PAD).toBeLessThanOrEqual(p.sh);
        // Centred.
        expect(Math.abs(o.x + (s.cols * CELL) / 2 - p.sw / 2)).toBeLessThanOrEqual(1);
      }
    }
  });

  it("a square is at least 44 points across on every phone", () => {
    // Art pixels are 3 device pixels at 9 px/art px on the iPhones (3 pt) and 8/3 pt on the Android phone.
    expect(CELL * (8 / 3)).toBeGreaterThanOrEqual(44);
  });

  it("the attract demo's rugs sit between the sign and the prompt, clear of the rail and the caption", () => {
    for (const p of PHONES) {
      for (const s of SPECS.slice(0, DEMO_RUGS)) {
        const o = attractBoard(p.safe, s.cols, s.rows);
        expect(o.x - RUG_PAD, `${p.name} ${s.cols}x${s.rows}`).toBeGreaterThanOrEqual(p.safe.x0);
        expect(o.x + s.cols * CELL + RUG_PAD).toBeLessThanOrEqual(p.safe.x1);
        expect(o.y - RUG_PAD).toBeGreaterThanOrEqual(p.safe.y0 + SIGN_H);
        expect(o.y + s.rows * CELL + RUG_PAD).toBeLessThanOrEqual(p.safe.y1 - PROMPT_H);
      }
    }
  });

  it("the HUD's lanes never touch: score and purr on the left, the rug's number on the right, the candle under them", () => {
    for (const p of PHONES) {
      const h = hud(p.sw, p.top);
      expect(h.rowY).toBeGreaterThanOrEqual(p.top);
      const left = h.scoreX + textWidth("999,999") + 4 + textWidth("x5");
      const right = h.rugX - textWidth("rug 99");
      expect(left, p.name).toBeLessThan(right - 3);
      expect(h.candleY).toBeGreaterThanOrEqual(h.rowY + 10);
      expect(h.candleX + h.candleW + 5).toBeLessThanOrEqual(p.sw);
      expect(h.candleY + 5).toBeLessThanOrEqual(p.top + HUD_H - 12);
      expect(h.laneY).toBeGreaterThan(h.candleY + 4);
    }
  });
});
