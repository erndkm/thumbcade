import { describe, expect, it } from "vitest";
import { COPY, LANE_CHARS, levelLine, newLump, partyLine, rewound, tierLine, wrap } from "../src/copy.ts";
import { PLANS } from "../src/deal.ts";
import { KINDS } from "../src/kinds.ts";
import { attractBoard, boardGeo, hitBox, playFrame, potAt, rowsFor } from "../src/layout.ts";
import { TIPS, tipFor } from "../src/tips.ts";
import type { RunStats } from "../src/run.ts";

/** Phones the feed runs on: game viewport and status bar. */
const PHONES = [
  { W: 360, H: 800 - 56 - 20, top: 28 },
  { W: 390, H: 844 - 56 - 34, top: 47 },
  { W: 430, H: 932 - 56 - 34, top: 59 },
];
const PREVIEW = (top: number) => ({ top: top + 44, right: 72, bottom: 148, left: 0 });

describe("copy", () => {
  it("every lane message fits its plate on the narrowest phone", () => {
    const lines = [COPY.teachLift, COPY.teachDrop, COPY.teachSeal, COPY.sealed, COPY.busy, COPY.covered, COPY.little, COPY.stuck, COPY.helpSpare, COPY.grace, COPY.spare, COPY.over, COPY.best, rewound(3)];
    for (let k = 0; k < KINDS.length; k++) lines.push(newLump(k));
    for (let m = 2; m <= 5; m++) lines.push(tierLine(m));
    lines.push(levelLine(12));
    for (const l of lines) expect(l.length, l).toBeLessThanOrEqual(LANE_CHARS);
  });

  it("the party, attract and game-over lines fit their plaques", () => {
    expect(partyLine(12, true).length).toBeLessThanOrEqual(24);
    expect(COPY.attractSub.length).toBeLessThanOrEqual(33);
    expect(COPY.again.length).toBeLessThanOrEqual(17);
    expect(COPY.firstBest.length).toBeLessThanOrEqual(24);
    expect(COPY.noScore.length).toBeLessThanOrEqual(24);
  });

  it("every tip wraps into at most two lines of the game-over strip", () => {
    for (const t of Object.values(TIPS)) {
      const lines = wrap(t, 34);
      expect(lines.length, t).toBeLessThanOrEqual(2);
      for (const l of lines) expect(l.length).toBeLessThanOrEqual(34);
    }
  });
});

describe("the game-over tip", () => {
  const base: RunStats = { levels: 2, seals: 6, bestStreak: 3, moves: 30, retargets: 1, nopes: 0, graces: 0, rewinds: 0, sparesUsed: 1, reveals: 2, partial: 0, seconds: 50, spareIdle: 0 };
  it("is picked from what happened in the run", () => {
    expect(tipFor({ ...base, moves: 0, levels: 0, seals: 0 }, 0)).toBe(TIPS.idle);
    expect(tipFor({ ...base, graces: 1, rewinds: 1 }, 0)).toBe(TIPS.dead);
    expect(tipFor({ ...base, nopes: 8, retargets: 6 }, 0)).toBe(TIPS.nope);
    expect(tipFor({ ...base, spareIdle: 20 }, 1)).toBe(TIPS.spare);
    expect(tipFor({ ...base, levels: 0 }, 0)).toBe(TIPS.stuckEarly);
    expect(tipFor({ ...base, bestStreak: 1 }, 0)).toBe(TIPS.streak);
    expect(tipFor({ ...base, partial: 4 }, 0)).toBe(TIPS.partial);
    expect(tipFor(base, 0)).toBe(TIPS.covered);
  });
});

describe("layout", () => {
  it("every level's pots fit the board on every phone, apart, big enough to tap", () => {
    for (const ph of PHONES) {
      const f = playFrame(ph.W, ph.H, { top: ph.top, right: 0, bottom: 0, left: 0 });
      for (const plan of PLANS) {
        const n = plan.kinds + plan.empty + (plan.little ? 1 : 0) + 1; // a spare pot too
        const g = boardGeo(n, f.board);
        expect(g.U, `${ph.W} n=${n}`).toBeGreaterThanOrEqual(40);
        for (let i = 0; i < n; i++) {
          const b = hitBox(g, i);
          expect(b.w).toBeGreaterThanOrEqual(44);
          expect(b.x).toBeGreaterThanOrEqual(f.board.x - 1);
          expect(b.x + b.w).toBeLessThanOrEqual(f.board.x + f.board.w + 1);
          expect(b.y).toBeGreaterThanOrEqual(f.board.y - 1);
          expect(b.y + b.h).toBeLessThanOrEqual(f.board.y + f.board.h + 1);
          // The centre of each pot's column taps that pot, and a near miss beside the board still finds one.
          expect(potAt(g, b.x + b.w / 2, b.y + b.h / 2)).toBe(i);
          for (let j = 0; j < i; j++) {
            const c = hitBox(g, j);
            const overlap = Math.min(b.x + b.w, c.x + c.w) - Math.max(b.x, c.x) > 0.5 && Math.min(b.y + b.h, c.y + c.h) - Math.max(b.y, c.y) > 0.5;
            expect(overlap).toBe(false);
          }
        }
      }
    }
  });

  it("rows: one row up to three pots, then two with the longer on top", () => {
    expect(rowsFor(3)).toEqual([3]);
    expect(rowsFor(5)).toEqual([3, 2]);
    expect(rowsFor(11)).toEqual([6, 5]);
  });

  it("the attract demo board sits between the title and the caption, clear of the action rail", () => {
    for (const ph of PHONES) {
      const pv = PREVIEW(ph.top);
      const titleBottom = pv.top + 146;
      const box = attractBoard(ph.W, ph.H, pv, titleBottom);
      expect(box.y).toBeGreaterThanOrEqual(titleBottom);
      expect(box.y + box.h).toBeLessThanOrEqual(ph.H - pv.bottom);
      expect(box.x + box.w).toBeLessThanOrEqual(ph.W - pv.right);
      for (const n of [3, 5, 6]) expect(boardGeo(n, box).U).toBeGreaterThan(30);
    }
  });
});
