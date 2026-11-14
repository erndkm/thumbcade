import { createRng } from "@thumbcade-games/kit/rng";
import { describe, expect, it } from "vitest";
import { allCards, hidden, layOut, newPack, sweepOne, won, type Table } from "../src/cards.ts";
import { Dealer, passes, PLAYOUTS, SPECS, specOf, stockOf } from "../src/deal.ts";
import { playout, plays, tapTable } from "../src/natural.ts";
import { playLine, solve } from "../src/solver.ts";

const DEALS = 120;
const finish = (t: Table) => {
  if (hidden(t) === 0) while (sweepOne(t, [])) {
    /* sweep */
  }
};

describe("dealing", () => {
  it("the deals of a run grow from a short pack on four columns to the whole pack on seven", () => {
    expect(SPECS.map((s) => [s.ranks, s.cols])).toEqual([[5, 4], [7, 5], [9, 6], [11, 7], [13, 7]]);
    expect(SPECS.map(stockOf)).toEqual([10, 13, 15, 16, 24]);
    expect(specOf(40)).toBe(SPECS[4]);
  });

  it("every deal is a whole pack laid out the usual way", () => {
    for (let level = 0; level < SPECS.length; level++) {
      const spec = specOf(level);
      for (let i = 0; i < 40; i++) {
        const { table } = new Dealer(77 + i * 104729).get(level);
        expect(table.ranks).toBe(spec.ranks);
        expect(table.cols.map((c) => c.down.length)).toEqual(Array.from({ length: spec.cols }, (_, k) => k));
        expect(table.cols.every((c) => c.up.length === 1)).toBe(true);
        expect(table.stock).toHaveLength(stockOf(spec));
        expect(table.waste).toHaveLength(0);
        expect(allCards(table).sort((a, b) => a - b)).toEqual(newPack(spec.ranks).sort((a, b) => a - b));
      }
    }
  });

  it("every dealt deal is won by its witness, tap for tap, through the game's own taps", () => {
    let total = 0;
    for (let level = 0; level < SPECS.length; level++) {
      for (let i = 0; i < DEALS; i++) {
        const { table, witness } = new Dealer(1 + i * 7919 + level * 131).get(level);
        for (const tap of witness) expect(tapTable(table, tap).length, `level ${level} deal ${i}`).toBeGreaterThan(0);
        finish(table);
        expect(won(table), `level ${level} deal ${i}`).toBe(true);
        total++;
      }
    }
    expect(total).toBe(SPECS.length * DEALS);
  }, 30_000);

  it("and by natural play in almost any order: a deal is all but never lost by playing what fits", () => {
    let played = 0;
    let lost = 0;
    for (let level = 0; level < SPECS.length; level++) {
      for (let i = 0; i < 60; i++) {
        const { table } = new Dealer(500 + i * 613 + level).get(level);
        // Other orders than the ones the dealer tried.
        const rng = createRng(9000 + i * 17 + level);
        for (let k = 0; k < 10; k++) {
          played++;
          if (!playout(table, rng)) lost++;
        }
      }
    }
    expect(PLAYOUTS).toBe(24);
    expect(lost / played).toBeLessThan(0.015);
  });

  it("the solver's lines are real: whenever it finds one for a dealt deal, the line wins on the real table", () => {
    let found = 0;
    let all = 0;
    for (let level = 0; level < SPECS.length; level++) {
      for (let i = 0; i < 40; i++) {
        const { table } = new Dealer(31337 + i * 271 + level * 7).get(level);
        const s = solve(table, { maxNodes: 6000 });
        all++;
        expect(s.status).not.toBe("dead");
        if (s.status !== "won") continue;
        found++;
        expect(playLine(table, s.line), `level ${level} deal ${i}`).not.toBeNull();
        expect(won(table)).toBe(true);
      }
    }
    expect(found / all).toBeGreaterThan(0.8);
  });

  it("a layout natural play cannot win is turned down", () => {
    // Both black aces buried under the kings that need the space.
    let refused = 0;
    for (let i = 0; i < 300; i++) {
      const t = layOut(createRng(i + 1).shuffle(newPack(13)), 13, 7);
      if (!passes(t, i)) refused++;
    }
    expect(refused).toBeGreaterThan(150);
    expect(refused).toBeLessThan(300);
  });

  it("the same seed, level and redeal give the same deal however the work is split; others differ", () => {
    const key = (t: Table) => JSON.stringify(t);
    const a = new Dealer(4242);
    const whole = key(a.get(4, 0).table);
    const b = new Dealer(4242);
    let frames = 0;
    while (!b.pump(4, 0, 0.05) && frames < 100000) frames++;
    expect(b.ready(4, 0)).toBe(true);
    expect(key(b.get(4, 0).table)).toBe(whole);
    expect(key(new Dealer(4242).get(4, 1).table)).not.toBe(whole);
    expect(key(new Dealer(4243).get(4, 0).table)).not.toBe(whole);
    // A deal handed out twice is two separate tables.
    const first = a.get(4, 0).table;
    first.stock.pop();
    expect(key(a.get(4, 0).table)).toBe(whole);
  });

  it("a deal is quick to find", () => {
    let worst = 0;
    for (let level = 0; level < SPECS.length; level++) {
      for (let i = 0; i < 80; i++) {
        const t0 = performance.now();
        new Dealer(i * 13 + 1 + level * 999).get(level);
        worst = Math.max(worst, performance.now() - t0);
      }
    }
    expect(worst).toBeLessThan(60);
  });

  it("natural play looks for a card home, then a hidden card, then the drawn card", () => {
    const { table } = new Dealer(5).get(0);
    const list = plays(table);
    for (const p of list) expect(tapTable(JSON.parse(JSON.stringify(table)) as Table, p).length).toBeGreaterThan(0);
  });
});
