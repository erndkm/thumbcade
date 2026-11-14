import { createRng } from "@thumbcade-games/kit/rng";
import { describe, expect, it } from "vitest";
import {
  BLOCK, CELL, CHAIN_CAP, clampAim, COLS, CREEP_FIRST, CREEP_NEXT, EMPTY, FLOOR, hpBase, HZ, LAUNCH_MARGIN, MAX_MARBLES, MIN_ELEV, multFor, PLUS, R, RECALL_AT, ROWS, Sim,
  SPEED, START_MARBLES, STREAK_TIERS, W, ZAP, type Ball, type SimEvent,
} from "../src/sim.ts";

const DT = 1 / 60;
const dir = (a: number): [number, number] => [Math.cos(a), -Math.sin(a)];

/** Steps until the phase is `phase` (or `max` seconds pass), collecting events. */
function until(sim: Sim, done: () => boolean, max = 30, dt = DT, sink?: SimEvent[]): void {
  for (let t = 0; t < max && !done(); t += dt) {
    sim.step(dt);
    if (sink) sink.push(...sim.events);
    sim.events.length = 0;
  }
}
/** Fires and plays the volley through to the next aim (or the end of the run). */
function volley(sim: Sim, a: number, sink?: SimEvent[]): void {
  until(sim, () => sim.phase === "aim" || sim.over, 5, 1 / 240, sink);
  expect(sim.fire(...dir(a))).toBe(true);
  until(sim, () => sim.phase !== "volley", 40, DT, sink);
  until(sim, () => sim.phase === "aim" || sim.over, 5, 1 / 240, sink);
}
/** An empty mat with the given blocks: [col, row, hp]. */
function bare(blocks: Array<[number, number, number]>, seed = 1): Sim {
  const sim = new Sim({ seed });
  sim.clear();
  for (const [c, r, hp] of blocks) sim.put(r * COLS + c, BLOCK, hp);
  return sim;
}
const snapshot = (sim: Sim) => `${sim.score}|${sim.turn}|${sim.marbles}|${sim.streak}|${sim.launcherX.toFixed(6)}|${[...sim.kind].join("")}|${[...sim.hp].join(",")}`;

describe("the mat and the marbles", () => {
  it("a marble never leaves the mat, never sits inside a block and never passes through one", () => {
    const rng = createRng(77);
    let ticks = 0;
    for (let n = 0; n < 60; n++) {
      const sim = new Sim({ seed: 500 + n });
      // A thick pile: play a few volleys so the rows build up, with hard blocks so they stay.
      for (let i = 0; i < sim.hp.length; i++) if (sim.kind[i] === BLOCK) sim.hp[i] = sim.max[i] = 400;
      for (let v = 0; v < 5 && !sim.over; v++) {
        until(sim, () => sim.phase === "aim" || sim.over, 5, 1 / 240);
        if (sim.over) break;
        for (let i = 0; i < sim.hp.length; i++) if (sim.kind[i] === BLOCK) sim.hp[i] = sim.max[i] = 400;
        sim.fire(...dir(rng.range(MIN_ELEV, Math.PI - MIN_ELEV)));
        while (sim.phase === "volley") {
          sim.step(1 / 240);
          sim.events.length = 0;
          ticks++;
          for (const b of sim.balls) {
            if (b.ghost) continue;
            expect(b.x).toBeGreaterThanOrEqual(R - 1e-6);
            expect(b.x).toBeLessThanOrEqual(W - R + 1e-6);
            expect(b.y).toBeGreaterThanOrEqual(R - 1e-6);
            expect(b.y).toBeLessThanOrEqual(FLOOR - R + 1e-6);
            const c = Math.floor(b.x / CELL);
            const r = Math.floor(b.y / CELL);
            if (r < ROWS) expect(sim.hp[r * COLS + c], `inside a block at ${b.x},${b.y}`).toBeLessThanOrEqual(0);
            for (let rr = Math.max(0, r - 1); rr <= Math.min(ROWS - 1, r + 1); rr++) {
              for (let cc = Math.max(0, c - 1); cc <= Math.min(COLS - 1, c + 1); cc++) {
                if (sim.hp[rr * COLS + cc]! <= 0) continue;
                const qx = Math.min((cc + 1) * CELL, Math.max(cc * CELL, b.x));
                const qy = Math.min((rr + 1) * CELL, Math.max(rr * CELL, b.y));
                expect(Math.hypot(b.x - qx, b.y - qy), `overlap at ${b.x},${b.y}`).toBeGreaterThan(R - 0.01);
              }
            }
          }
        }
      }
    }
    expect(ticks).toBeGreaterThan(50_000);
  });

  it("a marble keeps its speed through every bounce", () => {
    const sim = new Sim({ seed: 9 });
    for (let i = 0; i < sim.hp.length; i++) if (sim.kind[i] === BLOCK) sim.hp[i] = 400;
    sim.fire(...dir(1.1));
    for (let i = 0; i < 600 && sim.phase === "volley"; i++) {
      sim.step(1 / 240);
      for (const b of sim.balls) if (!b.ghost) expect(Math.hypot(b.vx, b.vy)).toBeCloseTo(SPEED, 6);
    }
  });

  it("a head-on knock sends the marble straight back and takes one off the number", () => {
    const sim = bare([[3, 4, 5]]);
    sim.launcherX = 3.5 * CELL;
    const ev: SimEvent[] = [];
    sim.marbles = 1;
    sim.fire(0, -1);
    until(sim, () => sim.phase !== "volley", 10, DT, ev);
    expect(sim.hp[4 * COLS + 3]).toBe(4);
    expect(ev.filter((e) => e.k === "hit")).toHaveLength(1);
    const land = ev.find((e) => e.k === "land");
    expect(land && land.k === "land" && land.x).toBeCloseTo(3.5 * CELL, 6);
  });

  it("two blocks side by side are one flat face: a marble on the seam bounces straight back", () => {
    for (const off of [-3, -1, -0.2, 0.2, 1, 3]) {
      const sim = bare([[2, 4, 9], [3, 4, 9]]);
      sim.launcherX = 3 * CELL + off;
      sim.marbles = 1;
      const ev: SimEvent[] = [];
      sim.fire(0, -1);
      until(sim, () => sim.phase !== "volley", 10, DT, ev);
      const land = ev.find((e) => e.k === "land");
      expect(land && land.k === "land" && land.x, `offset ${off}`).toBeCloseTo(3 * CELL + off, 6);
      expect(ev.filter((e) => e.k === "hit"), `offset ${off}`).toHaveLength(1);
    }
  });

  it("a lone block's corner deflects a marble sideways", () => {
    const sim = bare([[3, 4, 9]]);
    sim.launcherX = 4 * CELL + 4;
    sim.marbles = 1;
    const ev: SimEvent[] = [];
    sim.fire(0, -1);
    until(sim, () => sim.phase !== "volley", 10, DT, ev);
    expect(ev.filter((e) => e.k === "hit")).toHaveLength(1);
    const land = ev.find((e) => e.k === "land");
    expect(Math.abs((land && land.k === "land" ? land.x : 0) - (4 * CELL + 4))).toBeGreaterThan(10);
  });

  it("a flat rattle between the walls still comes down: every volley ends and every marble lands", () => {
    const rng = createRng(3);
    for (let n = 0; n < 40; n++) {
      const sim = new Sim({ seed: 900 + n });
      for (let i = 0; i < sim.hp.length; i++) if (sim.kind[i] === BLOCK) sim.hp[i] = 400;
      sim.marbles = rng.int(1, MAX_MARBLES);
      const fired = sim.marbles;
      const ev: SimEvent[] = [];
      // The flattest shot there is, either way.
      sim.fire(n % 2 ? 1 : -1, n % 3 ? 0 : 0.4);
      let physics = 0;
      while (sim.phase === "volley") {
        sim.step(1 / 240);
        physics = Math.max(physics, sim.vt);
        ev.push(...sim.events);
        sim.events.length = 0;
      }
      expect(physics / HZ).toBeLessThan(RECALL_AT + 2);
      expect(ev.filter((e) => e.k === "land")).toHaveLength(fired);
      expect(ev.filter((e) => e.k === "fire")).toHaveLength(fired);
      expect(sim.balls).toHaveLength(0);
    }
  });

  it("the stream speeds up twice and is then called home", () => {
    // A marble shut in between two rows that never break: only the recall ends the volley.
    const sim = bare([]);
    for (let c = 0; c < COLS; c++) sim.put(1 * COLS + c, BLOCK, 30000);
    for (let c = 0; c < COLS; c++) if (c !== 3) sim.put(7 * COLS + c, BLOCK, 30000);
    sim.launcherX = 3.5 * CELL;
    sim.marbles = 1;
    const ev: SimEvent[] = [];
    sim.fire(...dir(Math.PI / 2 - 0.05));
    until(sim, () => (sim.balls[0]?.y ?? 999) < 7 * CELL - R - 4, 5, 1 / 240, ev);
    sim.put(7 * COLS + 3, BLOCK, 30000);
    const t0 = sim.t;
    until(sim, () => sim.phase !== "volley", 30, DT, ev);
    const speeds = ev.filter((e) => e.k === "speed").map((e) => (e.k === "speed" ? e.scale : 0));
    expect(speeds).toEqual([1.6, 2.4, 1].slice(0, speeds.length));
    expect(speeds.slice(0, 2)).toEqual([1.6, 2.4]);
    expect(ev.some((e) => e.k === "recall")).toBe(true);
    expect(ev.filter((e) => e.k === "land")).toHaveLength(1);
    // 8.5 s of marble time take about 5 s on the clock.
    expect(sim.t - t0).toBeLessThan(6.5);
    expect(sim.t - t0).toBeGreaterThan(4);
  });

  it("the cannon rolls to where the first marble landed, and stays on the mat", () => {
    for (const a of [MIN_ELEV, 0.5, 1.2, Math.PI - 0.5, Math.PI - MIN_ELEV]) {
      const sim = bare([[0, 1, 999]]);
      const ev: SimEvent[] = [];
      volley(sim, a, ev);
      const first = ev.find((e) => e.k === "land" && e.first);
      const x = first && first.k === "land" ? first.x : -1;
      expect(sim.launcherX).toBeCloseTo(Math.min(W - LAUNCH_MARGIN, Math.max(LAUNCH_MARGIN, x)), 9);
      expect(sim.launcherX).toBeGreaterThanOrEqual(LAUNCH_MARGIN);
      expect(sim.launcherX).toBeLessThanOrEqual(W - LAUNCH_MARGIN);
    }
  });

  it("the guide shows the first marble's real path", () => {
    for (let n = 0; n < 30; n++) {
      const sim = new Sim({ seed: 40 + n });
      for (let i = 0; i < sim.hp.length; i++) if (sim.kind[i] === BLOCK) sim.hp[i] = 99;
      const a = MIN_ELEV + ((n + 0.5) / 30) * (Math.PI - 2 * MIN_ELEV);
      const pts = sim.trace(...dir(a), 2, 5000);
      expect(pts.length).toBeGreaterThanOrEqual(2);
      sim.marbles = 1;
      sim.fire(...dir(a));
      // Follow the real marble: it must pass through each traced corner.
      const seen = pts.map(() => 1e9);
      for (let i = 0; i < 2 * HZ && sim.phase === "volley"; i++) {
        sim.step(1 / 240);
        const b = sim.balls[0] as Ball | undefined;
        if (b) pts.forEach((p, j) => (seen[j] = Math.min(seen[j]!, Math.hypot(p.x - b.x, p.y - b.y))));
      }
      for (let j = 1; j < pts.length - 1; j++) expect(seen[j], `angle ${a} corner ${j}`).toBeLessThan(4);
    }
  });

  it("a shot is never flatter than the limit and never downward", () => {
    for (const [dx, dy] of [[1, 0], [-1, 0], [1, 0.5], [-1, 2], [0, 1], [0.999, -0.01]] as const) {
      const [x, y] = clampAim(dx, dy);
      expect(Math.hypot(x, y)).toBeCloseTo(1, 9);
      expect(Math.atan2(-y, Math.abs(x))).toBeGreaterThanOrEqual(MIN_ELEV - 1e-9);
      if (dx !== 0) expect(Math.sign(x)).toBe(Math.sign(dx));
    }
    expect(clampAim(0, -1)).toEqual([expect.closeTo(0, 9), -1]);
  });

  it("is deterministic, and plays out the same at 30, 60 and 120 frames a second", () => {
    const play = (fps: number) => {
      const sim = new Sim({ seed: 4242 });
      const rng = createRng(11);
      for (let v = 0; v < 14 && !sim.over; v++) {
        while (sim.phase !== "aim" && !sim.over) {
          sim.step(1 / fps);
          sim.events.length = 0;
        }
        if (sim.over) break;
        sim.fire(...dir(rng.range(MIN_ELEV, Math.PI - MIN_ELEV)));
        while (sim.phase === "volley") {
          sim.step(1 / fps);
          sim.events.length = 0;
        }
      }
      return snapshot(sim);
    };
    const at60 = play(60);
    expect(play(60)).toBe(at60);
    expect(play(30)).toBe(at60);
    expect(play(120)).toBe(at60);
    expect(at60.split("|")[0]).not.toBe("0");
  });
});

describe("the pile", () => {
  it("opens three rows deep with four marbles, the top row always clear", () => {
    for (let s = 1; s <= 40; s++) {
      const sim = new Sim({ seed: s });
      expect(sim.marbles).toBe(START_MARBLES);
      expect(sim.turn).toBe(1);
      expect(sim.lowestRow).toBe(3);
      for (let c = 0; c < COLS; c++) expect(sim.kind[c]).toBe(EMPTY);
      for (let i = 0; i < sim.hp.length; i++) if (sim.kind[i] === BLOCK) expect(sim.hp[i]).toBeLessThanOrEqual(4);
    }
  });

  it("every row has a gap, 2-6 blocks, at most one +1 and one zapper, and numbers that grow", () => {
    for (let s = 1; s <= 30; s++) {
      const sim = new Sim({ seed: s * 31 });
      const ids = new Set<number>();
      let lastMean = 0;
      for (let turn = 2; turn <= 30; turn++) {
        // Keep the pile from reaching the floor: clear everything below row 1 each time.
        for (let i = 2 * COLS; i < sim.kind.length; i++) sim.put(i, EMPTY, 0);
        until(sim, () => sim.turn === turn, 20);
        expect(sim.turn).toBe(turn);
        let blocks = 0;
        let plus = 0;
        let zap = 0;
        let sum = 0;
        for (let c = 0; c < COLS; c++) {
          expect(sim.kind[c]).toBe(EMPTY);
          const k = sim.kind[COLS + c];
          if (k === BLOCK) {
            blocks++;
            sum += sim.hp[COLS + c]!;
            expect(sim.hp[COLS + c]).toBeGreaterThanOrEqual(1);
            expect(sim.hp[COLS + c]).toBeLessThanOrEqual(Math.ceil(hpBase(turn) * 1.2) * 2);
          } else if (k === PLUS) plus++;
          else if (k === ZAP) zap++;
          if (k) {
            expect(ids.has(sim.ids[COLS + c]!)).toBe(false);
            ids.add(sim.ids[COLS + c]!);
          }
        }
        expect(blocks).toBeGreaterThanOrEqual(2);
        expect(blocks).toBeLessThanOrEqual(6);
        expect(plus).toBeLessThanOrEqual(1);
        expect(zap).toBeLessThanOrEqual(1);
        if (turn <= 6) expect(plus).toBe(1);
        if (turn === 10 || turn === 20 || turn === 30) {
          expect(sum / blocks).toBeGreaterThan(lastMean);
          lastMean = sum / blocks;
        }
      }
    }
    for (let t = 1; t < 40; t++) expect(hpBase(t + 1)).toBeGreaterThan(hpBase(t) - 1e-9);
    expect(hpBase(1)).toBe(1);
    expect(hpBase(10)).toBeGreaterThanOrEqual(20);
  });

  it("the run ends when a block is on the last row and the pile comes down again; a +1 there just goes", () => {
    const sim = bare([[2, ROWS - 2, 500]]);
    sim.put((ROWS - 1) * COLS + 5, PLUS, 0);
    const ev: SimEvent[] = [];
    volley(sim, Math.PI / 2, ev);
    expect(sim.over).toBe(false);
    expect(sim.kind[(ROWS - 1) * COLS + 2]).toBe(BLOCK);
    expect(sim.stats.plusMissed).toBe(1);
    expect(ev.some((e) => e.k === "danger" && e.level === 2)).toBe(true);
    volley(sim, Math.PI / 2, ev);
    expect(sim.over).toBe(true);
    const over = ev.find((e) => e.k === "over");
    expect(over && over.k === "over" && over.cols).toEqual([2]);
    expect(sim.fire(0, -1)).toBe(false);
  });
});

describe("the run", () => {
  it("every knock is a point, every smash pays ten times its place in the chain, and the chain is capped", () => {
    // A column of ones with a zapper in it, and a row of ones through the zapper: four marbles clear the mat.
    const blocks: Array<[number, number, number]> = [];
    for (let r = 1; r <= 8; r++) if (r !== 5) blocks.push([3, r, 1]);
    for (let c = 0; c < COLS; c++) if (c !== 3) blocks.push([c, 5, 1]);
    const sim = bare(blocks);
    sim.put(5 * COLS + 3, ZAP, 0);
    sim.launcherX = 3.5 * CELL;
    const ev: SimEvent[] = [];
    volley(sim, Math.PI / 2, ev);
    const smashes = ev.filter((e): e is Extract<SimEvent, { k: "smash" }> => e.k === "smash");
    expect(smashes.length).toBe(13);
    smashes.forEach((e, i) => {
      expect(e.chain).toBe(i + 1);
      expect(e.pts).toBe(10 * Math.min(i + 1, CHAIN_CAP) + (i === 0 ? 25 : 0));
    });
    expect(CHAIN_CAP).toBe(12);
    expect(smashes[12]!.pts).toBe(120);
    const end = ev.find((e) => e.k === "volleyEnd");
    const sweep = ev.find((e) => e.k === "sweep");
    expect(sweep && sweep.k === "sweep" && sweep.pts).toBe(100);
    expect(end && end.k === "volleyEnd" && end.pts).toBe(13 + smashes.reduce((a, e) => a + e.pts, 0) + 100);
    expect(sim.score).toBe(end && end.k === "volleyEnd" ? end.pts : -1);
    // A clean sweep is worth a marble.
    expect(sim.marbles).toBe(START_MARBLES + 1);
    expect(sim.stats.sweeps).toBe(1);
    expect(sim.stats.maxChain).toBe(13);
  });

  it("knocks are conserved: the numbers go down by exactly the knocks counted", () => {
    const sim = new Sim({ seed: 31 });
    const total = () => sim.hp.reduce((a, b) => a + b, 0);
    for (let v = 0; v < 6; v++) {
      until(sim, () => sim.phase === "aim", 5, 1 / 240);
      const before = total();
      const hits = sim.stats.hits;
      sim.fire(...dir(0.6 + v * 0.3));
      until(sim, () => sim.phase !== "volley", 40);
      expect(before - total()).toBe(sim.stats.hits - hits);
    }
  });

  it("a block smashed on the last row pays a close call", () => {
    const sim = bare([[3, ROWS - 1, 1], [0, 1, 999]]);
    sim.launcherX = 3.5 * CELL;
    sim.marbles = 1;
    const ev: SimEvent[] = [];
    sim.fire(0, -1);
    until(sim, () => sim.phase !== "volley", 10, DT, ev);
    const smash = ev.find((e) => e.k === "smash");
    expect(smash && smash.k === "smash" && smash.close).toBe(true);
    expect(smash && smash.k === "smash" && smash.pts).toBe(35);
    expect(sim.stats.closeCalls).toBe(1);
  });

  it("smashing something every volley builds the streak: ×2 at 3, ×3 at 6, ×4 at 10; a dud volley ends it", () => {
    expect(STREAK_TIERS).toEqual([3, 6, 10]);
    expect([0, 2, 3, 5, 6, 9, 10, 30].map(multFor)).toEqual([1, 1, 2, 2, 3, 3, 4, 4]);
    const sim = bare([]);
    const ev: SimEvent[] = [];
    for (let v = 1; v <= 10; v++) {
      until(sim, () => sim.phase === "aim", 5, 1 / 240);
      sim.clear();
      sim.put(4 * COLS + 3, BLOCK, 1);
      sim.put(1 * COLS + 0, BLOCK, 9999);
      sim.launcherX = 3.5 * CELL;
      sim.marbles = 1;
      const before = sim.score;
      sim.fire(0, -1);
      until(sim, () => sim.phase !== "volley", 10, DT, ev);
      expect(sim.streak).toBe(v);
      // The multiplier a smash pays is the one earned before this volley.
      expect(sim.score - before).toBe(1 + 10 * multFor(v - 1));
    }
    expect(sim.mult).toBe(4);
    expect(ev.filter((e) => e.k === "streak" && e.up).map((e) => (e.k === "streak" ? e.mult : 0))).toEqual([2, 3, 4]);
    until(sim, () => sim.phase === "aim", 5, 1 / 240);
    sim.clear();
    sim.put(1 * COLS + 0, BLOCK, 9999);
    sim.launcherX = 6.5 * CELL;
    sim.marbles = 1;
    sim.fire(0, -1);
    until(sim, () => sim.phase !== "volley", 10, DT, ev);
    expect(sim.streak).toBe(0);
    expect(ev.some((e) => e.k === "streakLost" && e.mult === 4)).toBe(true);
    expect(sim.stats.duds).toBe(1);
    expect(sim.stats.maxMult).toBe(4);
  });

  it("a +1 ring joins the stream when the volley ends, and the bag never holds more than its cap", () => {
    const sim = bare([[0, 1, 9999]]);
    sim.put(5 * COLS + 3, PLUS, 0);
    sim.launcherX = 3.5 * CELL;
    const ev: SimEvent[] = [];
    sim.fire(0, -1);
    until(sim, () => sim.gained > 0 || sim.phase !== "volley", 10, 1 / 240, ev);
    expect(sim.marbles).toBe(START_MARBLES);
    expect(sim.kind[5 * COLS + 3]).toBe(EMPTY);
    until(sim, () => sim.phase !== "volley", 10, DT, ev);
    expect(sim.marbles).toBe(START_MARBLES + 1);
    expect(ev.filter((e) => e.k === "plus")).toHaveLength(1);
    const full = bare([[0, 1, 9999]]);
    full.marbles = MAX_MARBLES;
    full.put(5 * COLS + 3, PLUS, 0);
    full.launcherX = 3.5 * CELL;
    full.fire(0, -1);
    until(full, () => full.phase !== "volley", 20);
    expect(full.marbles).toBe(MAX_MARBLES);
  });

  it("a zapper knocks its whole row and column once for each marble through it, then leaves", () => {
    const sim = bare([[0, 4, 50], [6, 4, 50], [3, 1, 50], [5, 2, 50]]);
    sim.put(4 * COLS + 3, ZAP, 0);
    sim.launcherX = 3.5 * CELL;
    sim.marbles = 3;
    const ev: SimEvent[] = [];
    sim.fire(0, -1);
    until(sim, () => sim.phase !== "volley", 10, DT, ev);
    // Each marble passes up through the zapper, knocks the block above it and passes back down: two zaps a marble.
    const zaps = ev.filter((e) => e.k === "zap").length;
    expect(zaps).toBe(6);
    expect(sim.hp[4 * COLS + 0]).toBe(50 - zaps);
    expect(sim.hp[4 * COLS + 6]).toBe(50 - zaps);
    expect(sim.hp[1 * COLS + 3]).toBe(50 - zaps - 3);
    expect(sim.hp[2 * COLS + 5]).toBe(50);
    until(sim, () => sim.phase === "aim", 5, 1 / 240);
    expect([...sim.kind].filter((k) => k === ZAP)).toHaveLength(sim.kind[COLS + 0] === ZAP || [...sim.kind.subarray(COLS, 2 * COLS)].includes(ZAP) ? 1 : 0);
    expect(sim.kind[5 * COLS + 3]).toBe(EMPTY);
  });

  it("a thumb that dawdles makes the pile creep: once after a long wait, then quickly, until it fires", () => {
    const sim = new Sim({ seed: 5 });
    const ev: SimEvent[] = [];
    until(sim, () => sim.turn === 2, 20, DT, ev);
    expect(sim.t).toBeGreaterThan(CREEP_FIRST - 0.05);
    expect(sim.t).toBeLessThan(CREEP_FIRST + 0.1);
    const t1 = sim.t;
    until(sim, () => sim.turn === 3, 20, DT, ev);
    expect(sim.t - t1).toBeGreaterThan(CREEP_NEXT);
    expect(sim.t - t1).toBeLessThan(CREEP_NEXT + 0.5);
    expect(ev.filter((e) => e.k === "advance" && e.creep)).toHaveLength(2);
    expect(sim.stats.creeps).toBe(2);
    // A shot buys the long wait back.
    until(sim, () => sim.phase === "aim", 5, 1 / 240);
    const turn = sim.turn;
    sim.fire(0.3, -1);
    until(sim, () => sim.phase !== "volley", 20);
    until(sim, () => sim.phase === "aim", 5, 1 / 240);
    const t2 = sim.t;
    until(sim, () => sim.turn === turn + 2 || sim.over, 20);
    if (!sim.over) expect(sim.t - t2).toBeGreaterThan(CREEP_FIRST - 0.1);
  });

  it("the fuse fills while the thumb waits, and a creep ends a streak", () => {
    const sim = bare([[3, 3, 1], [0, 1, 9999]]);
    sim.launcherX = 3.5 * CELL;
    sim.fire(0, -1);
    until(sim, () => sim.phase === "aim", 20, 1 / 240);
    expect(sim.streak).toBe(1);
    expect(sim.creepFrac).toBeLessThan(0.05);
    until(sim, () => sim.creepFrac > 0.5, 20);
    expect(sim.t).toBeGreaterThan(CREEP_FIRST * 0.5);
    until(sim, () => sim.stats.creeps > 0, 20);
    expect(sim.streak).toBe(0);
  });

  it("the attract demo never creeps", () => {
    const sim = new Sim({ seed: 5, demo: true });
    until(sim, () => false, 30);
    expect(sim.turn).toBe(1);
    expect(sim.creepFrac).toBe(0);
  });
});
