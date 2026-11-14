import { describe, expect, it } from "vitest";
import { attractLayout, playLayout, summaryBox } from "../src/layout.ts";
import { COLS, VISIBLE } from "../src/pieces.ts";

/** The reviewer's phones: game viewport (screen less the bottom bar and home indicator) and status bar. */
const PHONES = [
  { name: "iphone", W: 390, H: 754, bar: 47 },
  { name: "promax", W: 430, H: 842, bar: 59 },
  { name: "android", W: 360, H: 724, bar: 28 },
];
const preview = (bar: number) => ({ top: bar + 44, right: 72, bottom: 148, left: 0 });
/** TC Mono advances 0.6 em, plus the label tracking. */
const labelW = (text: string, size: number) => text.length * size * 0.68;

describe("layout", () => {
  it("in a run the meter fills the width under the HUD, with segments wider than tall and thumb-sized bands", () => {
    for (const p of PHONES) {
      const L = playLayout(p.W, p.H, p.bar);
      const m = L.meter;
      expect(m.w, p.name).toBe(m.cw * COLS);
      expect(m.h, p.name).toBe(m.ch * VISIBLE);
      expect(m.x, p.name).toBeGreaterThanOrEqual(8);
      expect(m.x + m.w, p.name).toBeLessThanOrEqual(p.W - 8);
      expect(m.y + m.h + 20, p.name).toBeLessThanOrEqual(p.H);
      expect(m.cw, p.name).toBeGreaterThanOrEqual(40);
      expect(m.ch, p.name).toBeGreaterThanOrEqual(28);
      expect(m.cw, p.name).toBeGreaterThan(m.ch);
      expect(L.labelsY + 6, p.name).toBeLessThanOrEqual(p.H);
    }
  });

  it("the HUD's lanes never touch: score, then gain, level and rows, next, then the message lane, then the meter", () => {
    for (const p of PHONES) {
      const L = playLayout(p.W, p.H, p.bar);
      // Score (34 px digits) clears the status bar and the row under it.
      expect(L.score.y - 20, p.name).toBeGreaterThanOrEqual(p.bar);
      expect(L.score.y + 20, p.name).toBeLessThanOrEqual(L.gain.y);
      const info = labelW("LVL 14 · 188 ROWS", 11);
      expect(L.gain.x + 46 + 4 * 9, p.name).toBeLessThan(L.info.x - info / 2);
      expect(L.info.x + info / 2, p.name).toBeLessThan(L.next.x + L.next.w - 30 - 21);
      expect(L.gain.y + L.gain.h, p.name).toBeLessThanOrEqual(L.lane.y - 6);
      expect(L.lane.y + 8, p.name).toBeLessThanOrEqual(L.meter.y - 6);
      // The longest lane lines fit the screen.
      for (const text of ["BREAKER TRIPPED · FREE THIS EARLY", "CUT IN THE RED · +1,500", "THE NOISE FLOOR IS RISING", "WIDE OPEN · GAIN ×5"]) {
        expect(labelW(text, 12), text).toBeLessThanOrEqual(p.W - 16);
      }
    }
  });

  it("the attract screen keeps the title, the demo meter and the prompt clear of the rail, the caption and the top tabs", () => {
    for (const p of PHONES) {
      const ins = preview(p.bar);
      const L = attractLayout(p.W, p.H, ins);
      const m = L.meter;
      expect(L.title.y - 36, p.name).toBeGreaterThanOrEqual(ins.top);
      expect(L.best.y + 8, p.name).toBeLessThanOrEqual(m.y - 6);
      expect(m.x, p.name).toBeGreaterThanOrEqual(8);
      expect(m.x + m.w, p.name).toBeLessThanOrEqual(p.W - ins.right);
      expect(m.y + m.h + 18, p.name).toBeLessThanOrEqual(L.prompt.y - 13);
      expect(L.prompt.y + 13, p.name).toBeLessThanOrEqual(p.H - ins.bottom);
      expect(L.prompt.x + 86, p.name).toBeLessThanOrEqual(p.W - ins.right);
      expect(L.title.maxW, p.name).toBeLessThanOrEqual(p.W - ins.right - 16);
      expect(m.ch, p.name).toBeGreaterThanOrEqual(16);
    }
  });

  it("the game-over panel sits above the caption and left of the rail", () => {
    for (const p of PHONES) {
      const ins = preview(p.bar);
      for (const standalone of [false, true]) {
        for (const lines of [1, 2]) {
          const b = summaryBox(p.W, p.H, ins, standalone, lines);
          expect(b.x).toBeGreaterThanOrEqual(8);
          expect(b.x + b.w).toBeLessThanOrEqual(p.W - ins.right);
          expect(b.y + b.h + (standalone ? 34 : 0)).toBeLessThanOrEqual(p.H - ins.bottom);
          expect(b.y).toBeGreaterThan(p.H * 0.4);
        }
      }
    }
  });
});
