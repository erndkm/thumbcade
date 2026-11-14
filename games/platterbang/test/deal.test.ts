import { createRng } from "@thumbcade-games/kit/rng";
import { describe, expect, it } from "vitest";
import { freePegs, layoutWall, planFor, type Wall } from "../src/board.ts";
import { assignColors, dealSteps, dealWall, DOCKS, jarQueue, pullOrder, SHELF } from "../src/deal.ts";
import { Run } from "../src/run.ts";
import { playsOut, ranks, shelfAfter, solve } from "../src/solve.ts";

const rulesOf = (queue: number[], cap = SHELF) => ({ queue, docks: DOCKS, cap });

describe("dealing", () => {
  it("every dealt wall can be cleared: its witness plays out with the real jars and shelf (480 walls)", () => {
    for (let n = 1; n <= 12; n++) {
      const rng = createRng(4242 + n);
      for (let k = 0; k < 40; k++) {
        const d = dealWall(planFor(n), rng);
        const r = playsOut(d.wall, rulesOf(d.queue), d.witness);
        expect(r.ok, `wall ${n} deal ${k}`).toBe(true);
        expect(d.witness.length).toBe(d.wall.pegs.length);
        // Three pegs of each colour per jar of that colour, and every colour has a jar.
        const per = new Map<number, number>();
        for (const p of d.wall.pegs) per.set(p.color, (per.get(p.color) ?? 0) + 1);
        for (const [c, count] of per) expect(count, `colour ${c}`).toBe(3 * d.queue.filter((q) => q === c).length);
        expect(new Set(d.queue).size).toBe(Math.min(planFor(n).colors, d.queue.length));
      }
    }
  }, 120_000);

  it("the shelf as counts matches the shelf played peg by peg, for any order", () => {
    for (let s = 0; s < 60; s++) {
      const d = dealWall(planFor(1 + (s % 8)), createRng(s));
      const rng = createRng(s ^ 99);
      const left = new Uint8Array(d.wall.pegs.length).fill(1);
      const counts = new Uint8Array(6);
      const rank = ranks(d.queue);
      // Explicit simulation: docks, the shelf, arrivals pulling their colour off the shelf.
      let next = DOCKS;
      const docks: Array<{ id: number; n: number } | null> = d.queue.slice(0, DOCKS).map((_, id) => ({ id, n: 0 }));
      const shelf: number[] = [];
      const ship = (k: number) => {
        for (;;) {
          const j = docks[k];
          if (!j || j.n < 3) return;
          docks[k] = next < d.queue.length ? { id: next++, n: 0 } : null;
          const nj = docks[k];
          if (!nj) return;
          for (let i = shelf.length - 1; i >= 0 && nj.n < 3; i--) if (shelf[i] === d.queue[nj.id]) {
            shelf.splice(i, 1);
            nj.n++;
          }
        }
      };
      while (left.some((v) => v)) {
        const free = freePegs(d.wall, left);
        const id = free[Math.floor(rng() * free.length)]!;
        left[id] = 0;
        const c = d.wall.pegs[id]!.color;
        counts[c]!++;
        let k = -1;
        docks.forEach((j, i) => {
          if (j && d.queue[j.id] === c && j.n < 3 && (k < 0 || j.id < docks[k]!.id)) k = i;
        });
        if (k >= 0) {
          docks[k]!.n++;
          ship(k);
        } else shelf.push(c);
        expect(shelfAfter(rulesOf(d.queue), counts, rank)).toBe(shelf.length);
      }
      expect(shelf.length).toBe(0);
    }
  });

  it("clears wall after wall when a player follows each deal's witness through the real run (240 walls)", () => {
    for (let s = 0; s < 30; s++) {
      const run = new Run(7000 + s * 31, { clock: 1e9 });
      for (let w = 1; w <= 8; w++) {
        expect(run.wallNo).toBe(w);
        for (const id of run.deal.witness) {
          // Wait for the swings to settle, so what covers what is the resting pose the dealer used.
          for (let t = 0; t < 8 && run.phys.busy; t += 1 / 60) run.step(1 / 60);
          run.clock = 1e9;
          const ev = run.tap(id);
          expect(ev.some((e) => e.type === "covered" || e.type === "over" || e.type === "save"), `run ${s} wall ${w}`).toBe(false);
          run.events.length = 0;
        }
        expect(run.pegsLeft).toBe(0);
        expect(run.shelf.length).toBe(0);
        expect(run.stats.walls).toBe(w);
        for (let t = 0; t < 2 && run.wallNo === w; t += 1 / 60) run.step(1 / 60);
        run.events.length = 0;
      }
    }
  }, 120_000);

  it("the solver finds its own way through dealt walls, and its way plays out", () => {
    const rng = createRng(77);
    for (let k = 0; k < 60; k++) {
      const d = dealWall(planFor(1 + (k % 6)), rng);
      const path = solve(d.wall, rulesOf(d.queue));
      expect(path).not.toBeNull();
      expect(playsOut(d.wall, rulesOf(d.queue), path!).ok).toBe(true);
    }
  });

  it("the solver says no to a wall that can't be cleared", () => {
    // Every peg that is free at the start gets a colour whose jar isn't open, and the shelf has no room at all.
    let checked = 0;
    for (let s = 0; checked < 5 && s < 200; s++) {
      const wall: Wall = layoutWall(planFor(1), createRng(s));
      const left = new Uint8Array(wall.pegs.length).fill(1);
      const free = freePegs(wall, left);
      const jars = wall.pegs.length / 3;
      if (jars < 4 || free.length > 6) continue;
      const queue = [0, 1, 2, 3, ...Array.from({ length: jars - 4 }, () => 0)];
      const pool: number[] = [];
      queue.forEach((c) => pool.push(c, c, c));
      // Free pegs take the 2s and 3s first.
      const late = pool.filter((c) => c >= 2);
      const early = pool.filter((c) => c < 2);
      free.forEach((id, i) => (wall.pegs[id]!.color = late[i]!));
      const rest = [...late.slice(free.length), ...early];
      wall.pegs.filter((p) => !free.includes(p.id)).forEach((p, i) => (p.color = rest[i]!));
      expect(solve(wall, { queue, docks: DOCKS, cap: 0 }, 1_000_000)).toBeNull();
      // With a shelf the same wall clears.
      expect(solve(wall, { queue, docks: DOCKS, cap: SHELF })).not.toBeNull();
      checked++;
    }
    expect(checked).toBe(5);
  });

  it("keeps the dealer's witness under its shelf cap, and hands out exactly the jar line-up", () => {
    for (let s = 0; s < 80; s++) {
      const rng = createRng(s);
      const plan = planFor(1 + (s % 6));
      const wall = layoutWall(plan, rng);
      const queue = jarQueue(wall.pegs.length / 3, plan.colors, rng);
      const order = pullOrder(wall, rng);
      const colors = assignColors(order, rulesOf(queue), plan.witnessCap, plan.spread, rng)!;
      expect(colors).not.toBeNull();
      order.forEach((id, i) => (wall.pegs[id]!.color = colors[i]!));
      const r = playsOut(wall, rulesOf(queue), order);
      expect(r.ok).toBe(true);
      expect(r.peak).toBeLessThanOrEqual(plan.witnessCap);
    }
  });

  it("is deterministic, and dealing a step at a time gives the same wall", () => {
    const a = dealWall(planFor(7), createRng(3));
    const b = dealWall(planFor(7), createRng(3));
    expect(a.wall.pegs).toEqual(b.wall.pegs);
    expect(a.queue).toEqual(b.queue);
    const g = dealSteps(planFor(7), createRng(3));
    let r = g.next();
    let steps = 0;
    while (!r.done) {
      r = g.next();
      steps++;
    }
    expect(steps).toBeGreaterThan(3);
    expect(r.value.wall.pegs).toEqual(a.wall.pegs);
  });
});
