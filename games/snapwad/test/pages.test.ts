import { describe, expect, it } from "vitest";
import { coverFor, FORT_X0, FORT_X1, makeLayout, MAX_TOP, miteScale, mitesFor, type Placed } from "../src/pages.ts";
import { CUP, isMite, MITES, PIECES, type MiteKind, type PieceKind } from "../src/pieces.ts";
import { createRng } from "@thumbcade-games/kit/rng";

/** World-space bounding box of a placed piece (rotated boxes; the cup by its rim). */
function aabb(p: Placed): [number, number, number, number] {
  const s = p.s ?? 1;
  const spec = isMite(p.kind) ? MITES[p.kind as MiteKind] : PIECES[p.kind as PieceKind];
  const hw = (p.kind === "cup" ? CUP.bottom : spec.hw) * s;
  const hh = spec.hh * s;
  const c = Math.abs(Math.cos(p.angle));
  const sn = Math.abs(Math.sin(p.angle));
  const ex = hw * c + hh * sn;
  const ey = hw * sn + hh * c;
  return [p.x - ex, p.y - ey, p.x + ex, p.y + ey];
}

describe("the pages", () => {
  it("every fort sits on its books, inside the page, below the HUD, and nothing overlaps", () => {
    for (let p = 1; p <= 30; p++) {
      for (let seed = 1; seed <= 40; seed++) {
        const l = makeLayout(p, seed * 7919);
        const boxes = l.pieces.map(aabb);
        for (const [i, b] of boxes.entries()) {
          expect(b[0], `p${p} s${seed} ${l.pieces[i]!.kind}`).toBeGreaterThanOrEqual(FORT_X0 - 0.3);
          expect(b[2], `p${p} s${seed}`).toBeLessThanOrEqual(FORT_X1 + 0.3);
          expect(b[3], `p${p} s${seed}`).toBeLessThanOrEqual(MAX_TOP + 0.01);
          // On a pile: its bottom is at or above the top of the pile under it.
          const pile = l.piles.find((q) => (b[0] + b[2]) / 2 >= q.x0 - 0.01 && (b[0] + b[2]) / 2 <= q.x1 + 0.01);
          expect(pile, `p${p} s${seed} piece over no pile`).toBeTruthy();
          expect(b[1], `p${p} s${seed}`).toBeGreaterThanOrEqual(pile!.top - 1e-6);
        }
        // Touching is fine, overlapping isn't (the cup covers its tick, which sits inside it).
        for (let i = 0; i < boxes.length; i++) {
          for (let j = i + 1; j < boxes.length; j++) {
            const a = boxes[i]!;
            const b = boxes[j]!;
            const cupPair = l.pieces[i]!.kind === "cup" || l.pieces[j]!.kind === "cup";
            if (cupPair) continue;
            const ox = Math.min(a[2], b[2]) - Math.max(a[0], b[0]);
            const oy = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
            expect(ox > 1e-6 && oy > 1e-6, `p${p} s${seed}: ${l.pieces[i]!.kind} and ${l.pieces[j]!.kind} overlap`).toBe(false);
          }
        }
      }
    }
  });

  it("pages escalate: more doodles, more of them hidden, drawn smaller, a second pile of books", () => {
    const avg = (p: number, f: (seed: number) => number) => Array.from({ length: 40 }, (_, i) => f(i * 7919 + 3)).reduce((a, b) => a + b, 0) / 40;
    const mites = (p: number) => avg(p, (s) => makeLayout(p, s).pieces.filter((q) => isMite(q.kind)).length);
    const piles = (p: number) => avg(p, (s) => makeLayout(p, s).piles.length);
    expect(mites(1)).toBe(1);
    expect(mites(4)).toBeGreaterThan(mites(2));
    expect(mites(12)).toBeGreaterThan(mites(5));
    expect(piles(2)).toBe(1);
    expect(piles(12)).toBe(2);
    expect(coverFor(12)).toBeGreaterThan(coverFor(6));
    expect(miteScale(16)).toBeLessThan(miteScale(8));
    expect(miteScale(40)).toBeGreaterThanOrEqual(0.62);
    for (let p = 1; p <= 30; p++) expect(mitesFor(p, createRng(p))).toBeGreaterThanOrEqual(1);
  });

  it("introduces the desk things one page at a time", () => {
    const kinds = (p: number) => new Set(Array.from({ length: 30 }, (_, i) => makeLayout(p, i * 31 + 1).pieces.map((q) => q.kind)).flat());
    expect([...kinds(1)].sort()).toEqual(["pencil", "stub"]);
    expect(kinds(2).has("eraser")).toBe(true);
    expect(kinds(2).has("pad")).toBe(false);
    expect(kinds(3).has("pad")).toBe(true);
    expect(kinds(3).has("ruler")).toBe(false);
    expect(kinds(4).has("ruler")).toBe(true);
    expect(kinds(4).has("cup")).toBe(false);
    expect(kinds(5).has("cup")).toBe(true);
  });

  it("is deterministic per page and seed", () => {
    expect(makeLayout(9, 555)).toEqual(makeLayout(9, 555));
    expect(makeLayout(9, 555)).not.toEqual(makeLayout(9, 556));
  });
});
