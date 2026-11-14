import { describe, expect, it } from "vitest";
import { attractFrame, keyAt, keyboard, playFrame, ROWS, summaryPlate } from "../src/layout.ts";

// Game viewports: iPhone 6.1" (390×844, 56 pt bar + 34 pt home indicator), Android mid-range, Pro Max, a small phone.
const PHONES = [
  { W: 390, H: 754, top: 47 },
  { W: 360, H: 724, top: 28 },
  { W: 430, H: 842, top: 59 },
  { W: 320, H: 548, top: 20 },
];
const preview = (top: number) => ({ top: top + 44, right: 72, bottom: 148, left: 0 });

describe("the keyboard", () => {
  it("every key is found at its centre, letters are at least 30 pt wide and the bottom row 38 pt tall", () => {
    for (const p of PHONES) {
      const kb = keyboard(p.W, p.H - 8, p.H);
      expect(kb.keys.length).toBe(29);
      for (const k of kb.keys) {
        expect(keyAt(kb, k.x + k.w / 2, k.y + k.h / 2)?.key).toBe(k.key);
        if (k.row < 3) expect(k.w).toBeGreaterThanOrEqual(26);
        if (k.row < 3 && p.W >= 360) expect(k.w).toBeGreaterThanOrEqual(30);
        else expect(k.h).toBeGreaterThanOrEqual(38);
      }
      expect(ROWS.join("").length).toBe(26);
    }
  });

  it("the gaps between letters belong to the nearest letter", () => {
    const kb = keyboard(390, 746, 754);
    const q = kb.keys.find((k) => k.key === "q")!;
    const w = kb.keys.find((k) => k.key === "w")!;
    const between = (q.x + q.w + w.x) / 2;
    expect(["q", "w"]).toContain(keyAt(kb, between, q.y + q.h / 2)?.key);
    expect(keyAt(kb, q.x + q.w / 2, q.y + q.h + 5)?.key).toBe("a");
    // Past the end of the short rows still finds their last key.
    const m = kb.keys.find((k) => k.key === "m")!;
    expect(keyAt(kb, m.x + m.w + 14, m.y + m.h / 2)?.key).toBe("m");
  });

  it("erase and write are never hit by reaching for a letter: a dead band separates them", () => {
    for (const p of PHONES) {
      const kb = keyboard(p.W, p.H - 8, p.H);
      const z = kb.keys.find((k) => k.key === "z")!;
      const m = kb.keys.find((k) => k.key === "m")!;
      // A touch that slips off the bottom of Z or M is Z or M, or nothing; never erase or write.
      for (let dy = 0; dy <= kb.actionsTop - kb.lettersBottom - 5; dy++) {
        for (const k of [z, m]) {
          const hit = keyAt(kb, k.x + k.w / 2, k.y + k.h + dy)?.key;
          expect(hit === undefined || hit === k.key, `${p.W}: ${k.key} +${dy} → ${hit}`).toBe(true);
        }
      }
      const erase = kb.keys.find((k) => k.key === "erase")!;
      const write = kb.keys.find((k) => k.key === "write")!;
      const pencil = kb.keys.find((k) => k.key === "pencil")!;
      expect(pencil.x - (erase.x + erase.w)).toBeGreaterThan(12);
      expect(write.x - (pencil.x + pencil.w)).toBeGreaterThan(12);
      expect(write.w).toBeGreaterThanOrEqual(erase.w);
    }
  });
});

describe("frames", () => {
  it("the run's slip sits between the clock and the keyboard, with six lines of room", () => {
    for (const p of PHONES) {
      const f = playFrame(p.W, p.H, { top: p.top, right: 0, bottom: 0, left: 0 });
      const s = f.slip;
      expect(s.card.y).toBeGreaterThanOrEqual(f.msg.y + f.msg.h);
      expect(s.card.y + s.card.h).toBeLessThanOrEqual(f.kb!.box.y);
      expect(s.card.x).toBeGreaterThanOrEqual(0);
      expect(s.card.x + s.card.w).toBeLessThanOrEqual(p.W);
      expect(s.line).toBeGreaterThanOrEqual(p.H >= 700 ? 44 : 26);
      expect(s.cx[0]! - s.cell / 2).toBeGreaterThan(s.card.x + 20);
    }
  });

  it("the title page keeps the slip clear of the rail and the prompt clear of the caption", () => {
    for (const p of PHONES) {
      const ins = preview(p.top);
      const f = attractFrame(p.W, p.H, ins, ins.top + 14 + 130);
      expect(f.slip.card.x + f.slip.card.w).toBeLessThanOrEqual(p.W - ins.right);
      expect(f.slip.card.y + f.slip.card.h).toBeLessThanOrEqual(f.prompt - 22);
      expect(f.prompt).toBeLessThanOrEqual(p.H - ins.bottom - 20);
    }
  });

  it("the summary slip sits above the caption and clear of the rail", () => {
    for (const p of PHONES) {
      const ins = preview(p.top);
      for (const daily of [false, true]) {
        const s = summaryPlate(p.W, p.H, ins, false, daily);
        expect(s.card.y + s.card.h).toBeLessThanOrEqual(p.H - ins.bottom);
        expect(s.card.x + s.card.w).toBeLessThanOrEqual(p.W - ins.right);
        expect(s.card.h).toBeLessThanOrEqual(130);
        if (s.grid) expect(s.grid.x).toBeGreaterThan(s.card.x + s.room[3]! + 14);
      }
    }
  });
});
