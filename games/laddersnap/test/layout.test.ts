import { describe, expect, it } from "vitest";
import { CARD_ASPECT, MAX_DEPTH, playGeometry } from "../src/layout.ts";

// The game viewports of the phone profiles in @thumbcade/sdk/host (screen minus bottom bar and home indicator).
const PHONES = [
  { name: "Android 360", w: 360, h: 724, top: 28 },
  { name: "iPhone 390", w: 390, h: 754, top: 47 },
  { name: "Pro Max 430", w: 430, h: 842, top: 59 },
];

describe("play layout", () => {
  for (const p of PHONES)
    it(`${p.name}: five columns fit, cards stay big, and nothing collides`, () => {
      for (let depth = 2; depth <= MAX_DEPTH; depth++) {
        const g = playGeometry(p.w, p.h, p.top, 5, depth);
        const half = g.cw / 2;
        expect(g.cw).toBeGreaterThanOrEqual(60);
        expect(g.colX[0]! - half).toBeGreaterThanOrEqual(4);
        expect(g.colX[4]! + half).toBeLessThanOrEqual(p.w - 4);
        for (let c = 1; c < 5; c++) expect(g.colX[c]! - g.colX[c - 1]!).toBeGreaterThan(g.cw);
        // The deepest column ends above the pile row, with room for the hint lines between.
        const bottom = g.top + (depth - 1) * g.band + g.cw * CARD_ASPECT;
        expect(bottom).toBeLessThanOrEqual(g.pile.y - (g.pile.w * CARD_ASPECT) / 2 - 40);
        expect(g.top).toBeGreaterThanOrEqual(g.hud);
        // A covered card always shows its rank and suit.
        expect(g.band).toBeGreaterThanOrEqual(g.cw * CARD_ASPECT * 0.4);
        // Stock and meter stay on screen.
        expect(g.stock.x + g.stock.w / 2).toBeLessThanOrEqual(p.w - 4);
        expect(g.meter.x).toBeGreaterThan(30);
      }
    });
});
