import { describe, expect, it } from "vitest";
import { coveredAtRest } from "../src/board.ts";
import { DOCKS, SHELF } from "../src/deal.ts";
import { multiplier, Run, TIER_LINES, TUNE, type RunEvent } from "../src/run.ts";

const types = (evs: RunEvent[]) => evs.map((e) => e.type);
const settle = (run: Run) => {
  for (let t = 0; t < 8 && run.phys.busy; t += 1 / 60) run.step(1 / 60);
  run.events.length = 0;
};
/** A run on the first seed that has a covered peg, a free peg with an open jar, and a free peg without one. */
function setup(): { run: Run; covered: number; direct: number; stray: number } {
  for (let s = 1; s < 400; s++) {
    const run = new Run(s);
    const free = run.freePegs();
    const covered = run.wall.pegs.findIndex((p) => coveredAtRest(run.wall, run.left, p.id));
    const direct = free.find((id) => run.jarFor(run.wall.pegs[id]!.color));
    const stray = free.find((id) => !run.jarFor(run.wall.pegs[id]!.color));
    if (covered >= 0 && direct !== undefined && stray !== undefined) return { run, covered, direct, stray };
  }
  throw new Error("no setup");
}

describe("a run", () => {
  it("a covered peg won't budge: it wiggles, names what's on top of it, and costs nothing", () => {
    const { run, covered } = setup();
    const ev = run.tap(covered);
    const e = ev.find((x) => x.type === "covered") as Extract<RunEvent, { type: "covered" }>;
    expect(e).toBeDefined();
    expect(e.by.length).toBeGreaterThan(0);
    for (const d of e.by) expect(run.wall.dishes[d]!.layer).toBeGreaterThan(run.wall.dishes[run.wall.pegs[covered]!.dish]!.layer);
    expect(run.left[covered]).toBe(1);
    expect(run.stats.coveredTaps).toBe(1);
    expect(run.score).toBe(0);
  });

  it("a peg goes into the open jar of its colour, or waits on the shelf", () => {
    const { run, direct, stray } = setup();
    const c = run.wall.pegs[direct]!.color;
    const jar = run.jarFor(c)!.jar;
    const ev = run.tap(direct);
    expect(ev[0]).toMatchObject({ type: "pull", peg: direct, dest: { to: "jar", jar: jar.id } });
    expect(jar.n).toBe(1);
    run.events.length = 0;
    settle(run);
    if (run.left[stray] && run.isFree(stray) && !run.jarFor(run.wall.pegs[stray]!.color)) {
      const ev2 = run.tap(stray);
      expect(ev2[0]).toMatchObject({ type: "pull", dest: { to: "shelf", index: 0 } });
      expect(run.shelf.length).toBe(1);
    }
  });

  it("a dish down to one peg swings; with none it drops, pays and gives time back", () => {
    for (let s = 1; s < 200; s++) {
      const run = new Run(s, { clock: 40 });
      const d = run.wall.dishes.find((x) => x.pegs.length === 2 && x.pegs.every((id) => run.isFree(id)));
      if (!d) continue;
      expect(types(run.tap(d.pegs[0]!))).toContain("swing");
      run.events.length = 0;
      settle(run);
      expect(run.isFree(d.pegs[1]!)).toBe(true);
      const before = run.clock;
      const ev = run.tap(d.pegs[1]!);
      const drop = ev.find((e) => e.type === "drop") as Extract<RunEvent, { type: "drop" }>;
      expect(drop).toBeDefined();
      expect(drop.points).toBeGreaterThanOrEqual(TUNE.dropPoints);
      expect(run.clock).toBeCloseTo(Math.min(TUNE.clockMax, before + TUNE.dropTime + (ev.some((e) => e.type === "ship") ? TUNE.shipTime : 0)), 9);
      expect(run.phys.bodies[d.id]!.state).toBe("falling");
      // It lands on the counter shortly after.
      run.events.length = 0;
      let landed = false;
      for (let t = 0; t < 2 && !landed; t += 1 / 60) landed = run.step(1 / 60).some((e) => e.type === "land" && e.dish === d.id);
      expect(landed).toBe(true);
      return;
    }
    throw new Error("no dish to drop");
  });

  it("three pegs ship a jar; the next one docks and pulls its colour off the shelf", () => {
    const run = new Run(5, { clock: 1e6 });
    let shipped = 0;
    let jumped = 0;
    for (const id of run.deal.witness) {
      settle(run);
      run.clock = 1e6;
      const ev = run.tap(id);
      shipped += ev.filter((e) => e.type === "ship").length;
      jumped += ev.filter((e) => e.type === "jump").length;
      for (const e of ev) if (e.type === "ship") expect(ev.some((x) => x.type === "dock" || run.upcoming() === null)).toBe(true);
      run.events.length = 0;
    }
    expect(shipped).toBe(run.deal.queue.length);
    expect(run.shelf.length).toBe(0);
    expect(run.stats.ships).toBe(shipped);
    void jumped;
  });

  it("a peg with nowhere to go: forgiven early, then once more, then by a magnet, then the end", () => {
    const fill = (run: Run) => {
      // The shelf full of pegs whose jars are later in the line-up.
      run.shelf = [];
      const later = run.deal.queue.slice(run.qi);
      for (let i = 0; i < run.shelfCap; i++) run.shelf.push({ peg: -1, color: later[i % later.length]! });
    };
    const { run, stray } = setup();
    fill(run);
    run.t = 3;
    expect(types(run.tap(stray))).toContain("save");
    expect(run.live).toBe(true);
    expect((run.events.find((e) => e.type === "save") as Extract<RunEvent, { type: "save" }>).why).toBe("safe");

    const b = setup();
    fill(b.run);
    b.run.t = 20;
    b.run.tap(b.stray);
    expect(b.run.events.find((e) => e.type === "save")).toMatchObject({ why: "grace" });
    expect(b.run.graceUsed).toBe(true);

    const c = setup();
    fill(c.run);
    c.run.t = 50;
    c.run.magnets = 1;
    c.run.tap(c.stray);
    expect(c.run.events.find((e) => e.type === "save")).toMatchObject({ why: "magnet" });
    expect(c.run.magnets).toBe(0);
    expect(c.run.rush.length + c.run.stats.ships).toBeGreaterThan(0);

    const d = setup();
    fill(d.run);
    d.run.t = 50;
    d.run.graceUsed = true;
    d.run.tap(d.stray);
    expect(d.run.over).toBe("full");
    expect(d.run.left[d.stray]).toBe(1);
  });

  it("a rushed-in jar takes the shelf's most common colour and frees room", () => {
    const { run, stray } = setup();
    const later = run.deal.queue.slice(run.qi);
    run.shelf = [];
    for (let i = 0; i < SHELF; i++) run.shelf.push({ peg: -1, color: later[0]! });
    run.t = 50;
    run.magnets = 1;
    run.tap(stray);
    expect(run.shelf.length).toBeLessThan(SHELF);
    const dock = run.events.find((e) => e.type === "dock" && e.rush) as Extract<RunEvent, { type: "dock" }>;
    expect(dock.color).toBe(later[0]);
    expect(dock.slot).toBeGreaterThanOrEqual(DOCKS);
  });

  it("the magnet works by hand too, and only when there's something on the shelf", () => {
    const { run } = setup();
    run.magnets = 1;
    run.useMagnet();
    expect(run.magnets).toBe(1);
    run.shelf = [{ peg: -1, color: run.deal.queue[run.qi]! }];
    run.useMagnet();
    expect(run.magnets).toBe(0);
    expect(run.shelf.length).toBe(0);
    expect(run.stats.magnetsUsed).toBe(1);
  });

  it("shipments and smashes in quick succession climb the multiplier tiers, each with its line", () => {
    expect([1, 2, 3, 6, 7, 11, 12, 17, 18, 24, 25, 60].map(multiplier)).toEqual([1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6]);
    for (let m = 2; m <= 6; m++) expect(TIER_LINES[m]!.length).toBeGreaterThan(3);
    const run = new Run(3);
    const hit = () => (run as unknown as { hit(): void }).hit();
    for (let i = 0; i < 12; i++) hit();
    expect(run.mult).toBe(4);
    expect(run.events.filter((e) => e.type === "tier").map((e) => (e as { mult: number }).mult)).toEqual([2, 3, 4]);
    // ×4 earns the spare shelf slot, once.
    expect(run.shelfCap).toBe(SHELF + 1);
    expect(run.events.filter((e) => e.type === "earn")).toHaveLength(1);
    // A lull resets the streak.
    run.step(TUNE.streakWindow + 0.1);
    expect(run.mult).toBe(1);
    hit();
    expect(run.streak).toBe(1);
  });

  it("burns the clock faster as the run goes on, and an idle run ends on its own", () => {
    const run = new Run(9);
    const b0 = run.burn;
    let t = 0;
    while (run.live && t < 60) {
      run.step(1 / 60);
      t += 1 / 60;
    }
    expect(run.over).toBe("time");
    expect(run.burn).toBeGreaterThan(b0);
    expect(t).toBeGreaterThan(20);
    expect(t).toBeLessThan(35);
  });

  it("clearing a wall pays, gives time back and hangs the next wall after a pause on the clock; every second wall earns a magnet", () => {
    const run = new Run(11, { clock: 30 });
    for (const id of run.deal.witness) {
      settle(run);
      run.clock = 30;
      run.tap(id);
    }
    const clear = run.events.find((e) => e.type === "clear") as Extract<RunEvent, { type: "clear" }>;
    expect(clear).toBeDefined();
    expect(clear.time).toBe(TUNE.wallTime);
    expect(run.magnets).toBe(0);
    expect(run.pause).toBeGreaterThan(0);
    const clock = run.clock;
    run.events.length = 0;
    for (let t = 0; t < TUNE.dealPause - 0.1; t += 1 / 60) run.step(1 / 60);
    expect(run.clock).toBe(clock);
    for (let t = 0; t < 0.3; t += 1 / 60) run.step(1 / 60);
    expect(run.wallNo).toBe(2);
    expect(run.events.some((e) => e.type === "deal")).toBe(true);
    run.events.length = 0;
    for (const id of run.deal.witness) {
      settle(run);
      run.clock = 30;
      run.tap(id);
    }
    expect(run.events.find((e) => e.type === "clear")).toMatchObject({ wall: 2, time: TUNE.wallTime - TUNE.wallTimeStep });
    expect(run.events.some((e) => e.type === "earn" && e.what === "magnet")).toBe(true);
    expect(run.magnets).toBe(1);
    // No more than one is held.
    run.magnets = TUNE.magnetsMax;
  });

  it("is deterministic, and dealing ahead of time changes nothing", () => {
    const play = (prepare: boolean) => {
      const run = new Run(21, { clock: 1e6 });
      const log: number[] = [];
      for (let w = 0; w < 3; w++) {
        for (const id of run.deal.witness) {
          for (let k = 0; k < 40; k++) {
            run.step(1 / 60);
            if (prepare) run.prepare(1, () => 0);
          }
          run.clock = 1e6;
          run.tap(id);
          log.push(run.score, run.shelf.length);
        }
        for (let t = 0; t < 2; t += 1 / 60) run.step(1 / 60);
      }
      return log;
    };
    expect(play(true)).toEqual(play(false));
  });
});
