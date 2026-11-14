import { describe, expect, it } from "vitest";
import { indexPx } from "../src/art.ts";
import { SPECS } from "../src/deal.ts";
import { attractLayout, cardY, CARD_RATIO, colX, frameIn, homeX, hud, HUD_H, playRect, PROMPT_H, summaryPlate, TITLE_H, upStep } from "../src/layout.ts";

/** The reviewer's phones: game viewport (screen less the bottom bar and home indicator) and status bar. */
const PHONES = [
  { name: "iphone", W: 390, H: 754, bar: 47 },
  { name: "promax", W: 430, H: 842, bar: 59 },
  { name: "android", W: 360, H: 724, bar: 28 },
];
const preview = (bar: number) => ({ top: bar + 44, right: 72, bottom: 148, left: 0 });
/** The attract demo plays the first two deals. */
const DEMO_DEALS = 2;

describe("layout", () => {
  it("the table fills the phone for every deal: the columns span the width, homes under the HUD, the pack at the bottom", () => {
    for (const p of PHONES) {
      for (const s of SPECS) {
        const tag = `${p.name} ${s.cols} columns`;
        const f = frameIn(playRect(p.W, p.H, p.bar), s.cols, s.ranks);
        const width = s.cols * f.cw + (s.cols - 1) * f.gap;
        expect(width, tag).toBeGreaterThanOrEqual(p.W * 0.93);
        expect(colX(f, 0), tag).toBeGreaterThanOrEqual(6);
        expect(colX(f, s.cols - 1) + f.cw, tag).toBeLessThanOrEqual(p.W - 6);
        expect(f.homeY, tag).toBe(p.bar + HUD_H);
        expect(f.packY + f.ch, tag).toBe(p.H - 8);
        expect(f.stockX + f.cw, tag).toBe(colX(f, s.cols - 1) + f.cw);
        expect(homeX(f, 3) + f.cw, tag).toBeLessThanOrEqual(p.W - 6);
        // Top to bottom the table uses all the height there is.
        expect(f.packY + f.ch - f.homeY, tag).toBe(p.H - 8 - p.bar - HUD_H);
      }
    }
  });

  it("a card is at least 44 points wide on every phone, and four columns get cards twice that", () => {
    for (const p of PHONES) {
      for (const s of SPECS) {
        const f = frameIn(playRect(p.W, p.H, p.bar), s.cols, s.ranks);
        expect(f.cw, `${p.name} ${s.cols}`).toBeGreaterThanOrEqual(44);
        expect(Math.abs(f.ch / f.cw - CARD_RATIO), `${p.name} ${s.cols}`).toBeLessThan(0.03);
      }
      expect(frameIn(playRect(p.W, p.H, p.bar), 4, 5).cw).toBeGreaterThanOrEqual(80);
    }
  });

  it("the tallest column there can be (every hidden card, then a run from the top card to the ace) stays above the pack", () => {
    for (const p of PHONES) {
      for (const s of SPECS) {
        const f = frameIn(playRect(p.W, p.H, p.bar), s.cols, s.ranks);
        const down = s.cols - 1;
        const last = cardY(f, down, s.ranks, down + s.ranks - 1);
        expect(last + f.ch, `${p.name} ${s.cols}`).toBeLessThanOrEqual(f.packY - 6);
        // Even closed up that far, each covered card still shows its rank.
        expect(upStep(f, down, s.ranks), `${p.name} ${s.cols}`).toBeGreaterThanOrEqual(indexPx(f.cw) * 0.8 + 1);
        // A short run is fanned at least as wide as a long one.
        expect(upStep(f, 0, 2)).toBeGreaterThanOrEqual(upStep(f, down, s.ranks));
        expect(cardY(f, 2, 3, 1) - cardY(f, 2, 3, 0)).toBe(f.downStep);
      }
    }
  });

  it("a short run is fanned half a card apart; the longest column of the whole pack closes up just enough to fit", () => {
    const p = PHONES[2]!;
    const f = frameIn(playRect(p.W, p.H, p.bar), 7, 13);
    expect(upStep(f, 0, 2)).toBe(f.ch * 0.5);
    expect(upStep(f, 6, 13)).toBeLessThan(upStep(f, 0, 2));
    expect(upStep(f, 6, 13)).toBeGreaterThanOrEqual(f.ch * 0.25);
    // Closed up, the column ends exactly where its room does.
    expect(cardY(f, 6, 13, 18) + f.ch).toBeCloseTo(f.tableY + f.room, 5);
  });

  it("the drawn cards fan out left of the pack without reaching the first column's edge", () => {
    for (const p of PHONES) {
      for (const s of SPECS) {
        const f = frameIn(playRect(p.W, p.H, p.bar), s.cols, s.ranks);
        expect(f.wasteX + f.cw).toBeLessThanOrEqual(f.stockX - 4);
        expect(f.wasteX - 2 * f.fan).toBeGreaterThanOrEqual(f.x0 + 56);
      }
    }
  });

  it("the HUD's lanes never touch: the score, the clock's rule, one line of news, then the table", () => {
    for (const p of PHONES) {
      const h = hud(p.W, p.bar);
      expect(h.scoreY - 24).toBeGreaterThanOrEqual(p.bar);
      expect(h.clockY).toBeGreaterThanOrEqual(h.scoreY + 6);
      expect(h.laneY - 13).toBeGreaterThanOrEqual(h.clockY + 2);
      expect(h.laneY + 5).toBeLessThanOrEqual(p.bar + HUD_H);
      expect(h.clockX1 - h.clockX0).toBeGreaterThanOrEqual(p.W - 30);
    }
  });

  it("the attract screen keeps the title, the demo table and the prompt clear of the tabs, the rail and the caption", () => {
    for (const p of PHONES) {
      const ins = preview(p.bar);
      const L = attractLayout(p.W, p.H, ins);
      expect(L.y).toBeGreaterThanOrEqual(ins.top);
      expect(L.x + L.w).toBeLessThanOrEqual(p.W - ins.right);
      expect(L.table.y).toBe(L.y + TITLE_H);
      expect(L.table.y + L.table.h + PROMPT_H).toBeLessThanOrEqual(p.H - ins.bottom);
      expect(L.promptY + 10).toBeLessThanOrEqual(p.H - ins.bottom);
      for (const s of SPECS.slice(0, DEMO_DEALS)) {
        const f = frameIn(L.table, s.cols, s.ranks);
        expect(f.cw, `${p.name} ${s.cols}`).toBeGreaterThanOrEqual(36);
        expect(colX(f, 0)).toBeGreaterThanOrEqual(L.x);
        expect(colX(f, s.cols - 1) + f.cw).toBeLessThanOrEqual(L.x + L.w);
        expect(f.packY + f.ch).toBeLessThanOrEqual(L.promptY - 22);
        expect(cardY(f, s.cols - 1, s.ranks, s.cols - 1 + s.ranks - 1) + f.ch).toBeLessThanOrEqual(f.packY - 4);
      }
    }
  });

  it("the game-over slip sits above the caption and left of the rail", () => {
    for (const p of PHONES) {
      const ins = preview(p.bar);
      for (const standalone of [false, true]) {
        const b = summaryPlate(p.W, p.H, ins, standalone);
        expect(b.x).toBeGreaterThanOrEqual(8);
        expect(b.x + b.w).toBeLessThanOrEqual(p.W - ins.right);
        expect(b.y + b.h + (standalone ? 30 : 0)).toBeLessThanOrEqual(p.H - ins.bottom);
        expect(b.y).toBeGreaterThan(p.H * 0.4);
      }
    }
  });
});
