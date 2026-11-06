import { createRng } from "@thumbcade-games/kit/rng";
import { describe, expect, it } from "vitest";
import { coverMap, freeSlips, layoutHeap, overlaps, PLANS, XMAX, YMAX, type Slip } from "../src/board.ts";

describe("heaps", () => {
  it("every plan lays out exactly its slips, inside the page, one per spot", () => {
    for (const plan of PLANS) {
      for (let seed = 1; seed <= 60; seed++) {
        const slots = layoutHeap(plan, createRng(seed * 31 + plan.tiles));
        expect(slots.length).toBe(plan.tiles);
        const seen = new Set<string>();
        for (const s of slots) {
          expect(s.x).toBeGreaterThanOrEqual(0);
          expect(s.x).toBeLessThanOrEqual(XMAX);
          expect(s.y).toBeGreaterThanOrEqual(0);
          expect(s.y).toBeLessThanOrEqual(YMAX);
          expect(s.z).toBeLessThan(plan.layers);
          const k = `${s.x},${s.y},${s.z}`;
          expect(seen.has(k)).toBe(false);
          seen.add(k);
        }
        // Slips on one layer never overlap each other.
        for (const a of slots) for (const b of slots) if (a !== b && a.z === b.z) expect(overlaps(a, b)).toBe(false);
      }
    }
  });

  it("a slip above the bottom rests on the layer below", () => {
    for (const plan of PLANS) {
      for (let seed = 1; seed <= 40; seed++) {
        const slots = layoutHeap(plan, createRng(seed + 900));
        for (const s of slots) {
          if (s.z === 0) continue;
          const below = slots.filter((o) => o.z === s.z - 1 && overlaps(o, s));
          const square = below.some((o) => o.x === s.x && o.y === s.y);
          expect(below.length >= 2 || square, `${s.x},${s.y},${s.z}`).toBe(true);
        }
      }
    }
  });

  it("heaps are mostly mirrored left to right", () => {
    let mirrored = 0;
    let total = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const slots = layoutHeap(PLANS[3]!, createRng(seed));
      const keys = new Set(slots.map((s) => `${s.x},${s.y},${s.z}`));
      for (const s of slots) {
        total++;
        if (keys.has(`${XMAX - s.x},${s.y},${s.z}`)) mirrored++;
      }
    }
    expect(mirrored / total).toBeGreaterThan(0.85);
  });

  it("only uncovered slips are free, and lifting one frees what it covered", () => {
    const slots = [
      { x: 0, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 },
      { x: 1, y: 1, z: 1 },
      { x: 6, y: 0, z: 0 },
    ];
    const above = coverMap(slots);
    expect(above[0]).toEqual([2]);
    expect(above[1]).toEqual([2]);
    expect(above[3]).toEqual([]);
    const slips: Slip[] = slots.map((s, id) => ({ ...s, id, type: 0, gone: false }));
    expect(freeSlips(slips, above).sort()).toEqual([2, 3]);
    slips[2]!.gone = true;
    expect(freeSlips(slips, above).sort()).toEqual([0, 1, 3]);
  });
});
