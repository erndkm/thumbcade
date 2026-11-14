import { describe, expect, it } from "vitest";
import { SHAPE_4, SHAPE_6 } from "../src/grid.ts";
import { attractGeometry, keyAt, keyRect, playGeometry, type Rect } from "../src/layout.ts";

// The game viewports of the phone profiles in @thumbcade/sdk/host (screen minus bottom bar and home indicator),
// with the feed's preview insets (status bar + 44 pt tabs on top, the 72 pt rail, the 148 pt caption).
const PHONES = [
  { name: "Android 360", w: 360, h: 724, top: 28 },
  { name: "iPhone 390", w: 390, h: 754, top: 47 },
  { name: "Pro Max 430", w: 430, h: 842, top: 59 },
];
const inside = (r: Rect, o: Rect) => r.x >= o.x - 0.01 && r.y >= o.y - 0.01 && r.x + r.w <= o.x + o.w + 0.01 && r.y + r.h <= o.y + o.h + 0.01;

describe("play layout", () => {
  for (const p of PHONES) {
    it(`${p.name}: keys stay tappable, the pad sits in the thumb's row, nothing collides`, () => {
      for (const shape of [SHAPE_4, SHAPE_6]) {
        const g = playGeometry(p.w, p.h, p.top, shape);
        // §12: hit targets ≥ 44 pt. A 6 × 6 key is at least 48 px wide on the 360 px phone.
        expect(g.board.cell).toBeGreaterThanOrEqual(shape.n === 6 ? 48 : 70);
        // 22 px either side for the lock marks.
        expect(g.board.x).toBeGreaterThanOrEqual(21.9);
        expect(g.board.x + g.board.w).toBeLessThanOrEqual(p.w - 21.9);
        expect(g.board.y).toBeGreaterThanOrEqual(g.hud + 20);
        // Board, then the meter row, then the pad.
        expect(g.board.y + g.board.h + 14).toBeLessThanOrEqual(g.meterY - 20);
        for (const k of g.pad) {
          expect(k.w).toBeGreaterThanOrEqual(48);
          expect(k.h).toBeGreaterThanOrEqual(56);
          expect(k.y).toBeGreaterThan(g.meterY + 20);
          expect(k.y + k.h).toBeLessThanOrEqual(p.h - 8);
          expect(k.x).toBeGreaterThanOrEqual(8);
          expect(k.x + k.w).toBeLessThanOrEqual(p.w - 8);
        }
        for (let i = 1; i < g.pad.length; i++) expect(g.pad[i]!.x).toBeGreaterThan(g.pad[i - 1]!.x + g.pad[i - 1]!.w);
        expect(g.lamp.x + g.lamp.w).toBeLessThanOrEqual(p.w - 8);
        expect(g.lamp.w).toBeGreaterThanOrEqual(44);
        expect(g.lamp.h).toBeGreaterThanOrEqual(44);
      }
    });
  }

  it("keys never overlap, boxes stand apart, and a touch in a gap goes to the nearest key", () => {
    const g = playGeometry(390, 754, 47, SHAPE_6);
    const b = g.board;
    const k0 = keyRect(b, 0);
    const k2 = keyRect(b, 2);
    const k3 = keyRect(b, 3);
    expect(k3.x - (k2.x + k2.w)).toBeGreaterThan(keyRect(b, 1).x - (k0.x + k0.w));
    expect(keyAt(b, k0.x + 5, k0.y + 5)).toBe(0);
    // In the gap between keys 2 and 3, nearer 3.
    expect(keyAt(b, k3.x - 2, k3.y + 10)).toBe(3);
    expect(keyAt(b, b.x - 40, b.y)).toBeNull();
  });
});

describe("attract layout", () => {
  for (const p of PHONES) {
    it(`${p.name}: title, board, pad and prompt stay inside the preview safe area`, () => {
      const safe = { x: 16, y: p.top + 44 + 16, w: p.w - 72 - 32, h: p.h - 148 - 16 - (p.top + 44 + 16) };
      for (const shape of [SHAPE_4, SHAPE_6]) {
        const a = attractGeometry(safe, shape);
        expect(inside({ x: a.board.x, y: a.board.y - 22, w: a.board.w, h: a.board.h + 22 }, safe)).toBe(true);
        for (const k of a.pad) expect(inside(k, safe)).toBe(true);
        expect(a.pad[0]!.y + a.pad[0]!.h).toBeLessThan(a.promptY - 14);
        expect(a.titleY - 40).toBeGreaterThanOrEqual(safe.y - 1);
        expect(a.board.y - 22).toBeGreaterThan(a.titleY + 50);
        expect(a.promptY).toBeLessThanOrEqual(safe.y + safe.h);
      }
    });
  }
});
