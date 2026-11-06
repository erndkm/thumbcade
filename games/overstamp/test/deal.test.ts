import { createRng } from "@thumbcade-games/kit/rng";
import { describe, expect, it } from "vitest";
import { coverMap, PLANS, type Slip } from "../src/board.ts";
import { assignKinds, dealSheet, liftOrder, playsOut, riffleSheet, solve, TRAY } from "../src/deal.ts";

const kindsOf = (slips: readonly Slip[]) => {
  const m = new Map<number, number>();
  for (const s of slips) if (!s.gone) m.set(s.type, (m.get(s.type) ?? 0) + 1);
  return m;
};

describe("dealing", () => {
  it("every dealt sheet can be cleared: its witness plays out without filling the tray", () => {
    for (const [i, plan] of PLANS.entries()) {
      const rng = createRng(4242 + i);
      for (let n = 0; n < 120; n++) {
        const d = dealSheet(plan, rng);
        expect(d.slips.length).toBe(plan.tiles);
        expect(d.witness.length).toBe(plan.tiles);
        const r = playsOut(d.slips, d.above, d.witness);
        expect(r.ok, `plan ${i + 1} deal ${n}`).toBe(true);
        const kinds = kindsOf(d.slips);
        expect(kinds.size).toBe(plan.types);
        for (const c of kinds.values()) expect(c % 3).toBe(0);
      }
    }
  });

  it("the solver agrees on small sheets, and finds a clearing order of its own", () => {
    const rng = createRng(77);
    for (let n = 0; n < 80; n++) {
      const d = dealSheet(PLANS[n % 3]!, rng);
      const path = solve(d.slips, d.above);
      expect(path).not.toBeNull();
      expect(playsOut(d.slips, d.above, path!).ok).toBe(true);
    }
  });

  it("the solver says no to a heap that can't be cleared", () => {
    // Three columns of seven slips. Columns A and B hold kinds 0..6 from the top down, column C holds them in the
    // reverse order, so the first triple of any kind k needs k + 1 + k + 1 + 7 − k ≥ 9 lifts: the tray fills first.
    const slots: Array<{ x: number; y: number; z: number }> = [];
    const types: number[] = [];
    for (const [x, rev] of [[0, false], [4, false], [8, true]] as const) {
      for (let z = 0; z < 7; z++) {
        slots.push({ x, y: 0, z });
        types.push(rev ? z : 6 - z);
      }
    }
    const above = coverMap(slots);
    const slips: Slip[] = slots.map((s, id) => ({ ...s, id, type: types[id]!, gone: false }));
    for (const c of kindsOf(slips).values()) expect(c).toBe(3);
    expect(solve(slips, above, [], 1_000_000)).toBeNull();
    // The same columns with C in the same order as A and B clear easily.
    const easy = slips.map((s) => ({ ...s, type: s.x === 8 ? 6 - s.z : s.type }));
    expect(solve(easy, above)).not.toBeNull();
  });

  it("assignKinds keeps the dealer's tray within its cap", () => {
    const rng = createRng(5);
    for (let n = 0; n < 200; n++) {
      const plan = PLANS[n % PLANS.length]!;
      const slots = Array.from({ length: plan.tiles }, (_, i) => ({ x: (i % 6) * 2, y: Math.floor(i / 6) * 2, z: 0 }));
      const order = liftOrder(slots, coverMap(slots), rng);
      const triples = Array.from({ length: plan.types }, () => 1);
      for (let i = plan.types; i < plan.tiles / 3; i++) triples[i % plan.types]!++;
      const kinds = assignKinds(order, triples, new Map(), plan.witnessCap, rng, 0.7);
      expect(kinds).not.toBeNull();
      let fill = 0;
      const tray = new Map<number, number>();
      for (const k of kinds!) {
        const c = (tray.get(k) ?? 0) + 1;
        if (c === 3) {
          tray.delete(k);
          fill -= 2;
        } else {
          tray.set(k, c);
          fill++;
        }
        expect(fill).toBeLessThanOrEqual(plan.witnessCap);
      }
    }
  });

  it("a riffle re-deals the heap so it can be cleared from the tray as it stands, keeping the same kinds", () => {
    const rng = createRng(99);
    let tried = 0;
    for (let n = 0; n < 60; n++) {
      const d = dealSheet(PLANS[3 + (n % 4)]!, rng);
      // Lift a few slips carelessly to build an awkward tray.
      const tray: number[] = [];
      const counts = new Map<number, number>();
      for (let step = 0; step < 6; step++) {
        const free = d.slips.filter((s) => !s.gone && d.above[s.id]!.every((j) => d.slips[j]!.gone));
        const s = free[Math.floor(rng() * free.length)]!;
        const c = (counts.get(s.type) ?? 0) + 1;
        if (c < 3 && tray.length + 1 >= TRAY) break;
        s.gone = true;
        if (c === 3) {
          counts.delete(s.type);
          for (let i = tray.length - 1; i >= 0; i--) if (tray[i] === s.type) tray.splice(i, 1);
        } else {
          counts.set(s.type, c);
          tray.push(s.type);
        }
      }
      const before = [...kindsOf(d.slips).entries()].sort();
      const ok = riffleSheet(d.slips, d.above, tray, rng);
      if (!ok) continue;
      tried++;
      expect([...kindsOf(d.slips).entries()].sort()).toEqual(before);
      expect(solve(d.slips, d.above, tray, 200_000)).not.toBeNull();
    }
    expect(tried).toBeGreaterThan(40);
  });

  it("deals are deterministic for a seed", () => {
    const a = dealSheet(PLANS[4]!, createRng(123));
    const b = dealSheet(PLANS[4]!, createRng(123));
    expect(a.slips.map((s) => [s.x, s.y, s.z, s.type])).toEqual(b.slips.map((s) => [s.x, s.y, s.z, s.type]));
  });
});
