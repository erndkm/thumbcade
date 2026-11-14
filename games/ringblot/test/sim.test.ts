import { createRng } from "@thumbcade-games/kit/rng";
import { describe, expect, it } from "vitest";
import { RIVALS, type Brain } from "../src/brain.ts";
import { Pilot, SKILLS } from "../src/pilot.ts";
import {
  beside, cellOf, COLS, dryFor, goalFor, HERO, HERO_SPEED, HZ, INK_LOW, INK_MAX, INK_PER_LOOP, INK_PER_SQUARE, INK_SMUDGE, INK_SMUDGED, INK_START, LATE_TURN, N, PRINT_TIME, PULLS,
  refillFor, RESPAWN, rivalsOn, ROWS, SHAVE_PTS, SHEET_PTS, Sim, SMUDGE_PTS, tierFor, xOf, yOf, type SimEvent,
} from "../src/sim.ts";

const TICK = 1 / HZ;
const at = (sim: Sim) => [xOf(sim.hero.cell), yOf(sim.hero.cell)];

function until(sim: Sim, done: () => boolean, max = 30, sink?: SimEvent[]): void {
  for (let t = 0; t < max && !done(); t += TICK) {
    sim.step(TICK);
    if (sink) sink.push(...sim.events);
    sim.events.length = 0;
  }
}
/** Swipes `d` and walks until the beetle has just reached the `n`-th square that way (so the next swipe turns there). */
function go(sim: Sim, d: number, n: number, sink?: SimEvent[]): void {
  sim.steer(d);
  if (sink) sink.push(...sim.events);
  sim.events.length = 0;
  for (let i = 0; i < n; i++) {
    const from = sim.hero.cell;
    until(sim, () => sim.hero.cell !== from || sim.phase !== "play", 3, sink);
  }
}
/** A sheet where the rivals stand still (and can be posed by hand). */
function quiet(seed = 1, sheet = 1): Sim {
  const sim = new Sim({ seed });
  while (sim.sheet < sheet) {
    for (let c = 0; c < N && sim.share < sim.goal; c++) if (sim.owner[c] !== HERO) own(sim, c);
    go(sim, 0, 3);
    go(sim, 1, 1);
    go(sim, 2, 4);
    until(sim, () => sim.phase === "play" && sim.t > 0, PRINT_TIME + 1);
  }
  for (const b of sim.bugs) if (b.id !== HERO) b.speed = 0;
  sim.ink = INK_START;
  return sim;
}
function own(sim: Sim, c: number, id = HERO): void {
  const was = sim.owner[c]!;
  if (was === id) return;
  if (was) sim.held[was]!--;
  sim.owner[c] = id;
  sim.held[id]!++;
}
const counts = (sim: Sim) => [1, 2, 3].map((id) => sim.owner.reduce((a, o) => a + (o === id ? 1 : 0), 0));

describe("the sheet", () => {
  it("starts with a 3 × 3 print bottom middle for the player and one rival at the top", () => {
    const sim = new Sim({ seed: 3 });
    expect(sim.bugs).toHaveLength(1 + rivalsOn(1));
    expect(at(sim)).toEqual([7, ROWS - 4]);
    expect(counts(sim)).toEqual([9, 9, 0]);
    expect(sim.held.slice(1)).toEqual([9, 9, 0]);
    expect(sim.share).toBeCloseTo(9 / N, 9);
    expect(sim.goal).toBe(0.15);
    expect(sim.ink).toBe(INK_START);
    expect(sim.wet.every((w) => w === 0)).toBe(true);
  });

  it("asks for more, dries faster, pays back less and gets quicker rivals sheet by sheet", () => {
    expect([1, 2, 3, 8, 30].map(goalFor)).toEqual([0.15, 0.2, 0.25, 0.5, 0.5]);
    expect([1, 2, 9].map(rivalsOn)).toEqual([1, 2, 2]);
    for (let s = 1; s < 12; s++) {
      expect(dryFor(s + 1)).toBeGreaterThan(dryFor(s));
      expect(refillFor(s + 1)).toBeLessThanOrEqual(refillFor(s));
    }
    expect(refillFor(1)).toBe(10);
    expect(refillFor(30)).toBe(5);
    for (let i = 1; i < RIVALS.length; i++) {
      expect(RIVALS[i]!.speed).toBeGreaterThan(RIVALS[i - 1]!.speed);
      expect(RIVALS[i]!.cut).toBeGreaterThanOrEqual(RIVALS[i - 1]!.cut);
    }
    // The player is always the quickest beetle on the sheet.
    expect(RIVALS[RIVALS.length - 1]!.speed).toBeLessThan(HERO_SPEED);
    expect(RIVALS[0]!.cut).toBe(0);
  });
});

describe("walking", () => {
  it("sets off at once, keeps going, and stops at the edge of the sheet", () => {
    const sim = quiet();
    expect(sim.hero.dir).toBe(-1);
    sim.steer(3);
    expect(sim.hero.dir).toBe(3);
    until(sim, () => sim.hero.dir < 0, 5);
    expect(at(sim)).toEqual([0, ROWS - 4]);
    expect(sim.t).toBeCloseTo(7 / HERO_SPEED, 1);
    // A swipe at the edge goes nowhere and says so.
    sim.steer(3);
    expect(sim.events.some((e) => e.k === "bonk")).toBe(true);
    expect(sim.stats.bonks).toBe(1);
    expect(sim.hero.dir).toBe(-1);
  });

  it("takes a swipe at the next square, or at once if it has only just passed one", () => {
    const sim = quiet();
    sim.steer(0);
    until(sim, () => sim.hero.t > 0.6, 1);
    const y = yOf(sim.hero.cell);
    sim.steer(1);
    expect(sim.hero.dir).toBe(0);
    until(sim, () => sim.hero.dir === 1, 1);
    expect(at(sim)).toEqual([7, y - 1]);
    // Just past the middle of a square: the turn is taken there.
    until(sim, () => sim.hero.t > 0.1 && sim.hero.t < LATE_TURN, 1);
    const [x1, y1] = at(sim);
    sim.steer(0);
    expect(sim.events.some((e) => e.k === "turn" && e.late)).toBe(true);
    expect(sim.hero.dir).toBe(0);
    expect(sim.hero.t).toBe(0);
    expect(at(sim)).toEqual([x1, y1]);
  });

  it("turns round on the spot on its own print, but never back along a wet line", () => {
    const sim = quiet();
    // Three squares of print to walk on: start at its left edge.
    sim.hero.cell = cellOf(6, ROWS - 4);
    sim.steer(1);
    until(sim, () => sim.hero.t > 0.4, 1);
    const x = sim.hero.t;
    sim.steer(3);
    expect(sim.hero.dir).toBe(3);
    expect(sim.hero.t).toBeCloseTo(1 - x, 9);
    until(sim, () => sim.hero.dir < 0 || sim.hero.line.length > 0, 2);
    // Out onto the paper: now a swipe back is refused.
    until(sim, () => sim.hero.line.length >= 2, 2);
    const bonks = sim.stats.bonks;
    sim.steer(1);
    expect(sim.hero.dir).toBe(3);
    expect(sim.stats.bonks).toBe(bonks + 1);
  });

  it("ignores swipes when the run isn't on", () => {
    const sim = quiet();
    sim.phase = "over";
    sim.steer(0);
    expect(sim.hero.dir).toBe(-1);
    expect(sim.stats.swipes).toBe(0);
  });
});

describe("printing", () => {
  it("a line that comes home prints itself and everything inside the loop", () => {
    const sim = quiet();
    const ev: SimEvent[] = [];
    go(sim, 0, 4, ev);
    expect(at(sim)).toEqual([7, 18]);
    expect(sim.hero.line).toHaveLength(3);
    expect(ev.filter((e) => e.k === "out")).toHaveLength(1);
    go(sim, 1, 3, ev);
    go(sim, 2, 4, ev);
    expect(sim.score).toBe(0);
    const ink = sim.ink;
    go(sim, 3, 2, ev);
    const print = ev.find((e) => e.k === "print");
    if (!print || print.k !== "print") throw new Error("no print");
    // Eleven squares of line and the five bare squares it shut in.
    expect(print.squares).toBe(16);
    expect(print.tier).toBe(2);
    expect(print.pts).toBe(32);
    expect(sim.score).toBe(32);
    expect(sim.held[HERO]).toBe(25);
    for (const [x, y] of [[8, 19], [9, 19], [8, 20], [9, 20], [9, 21], [7, 18], [10, 20]]) expect(sim.owner[cellOf(x!, y!)], `${x},${y}`).toBe(HERO);
    expect(sim.owner[cellOf(11, 20)]).toBe(0);
    expect(sim.hero.line).toHaveLength(0);
    expect(sim.wet.every((w) => w === 0)).toBe(true);
    expect(sim.ink - ink).toBeGreaterThan(16 * INK_PER_SQUARE - 0.3);
    expect(sim.stats.biggest).toBe(16);
    expect(print.share).toBeCloseTo(25 / N, 9);
  });

  it("the edge of the sheet does not close a loop: only what the line itself shuts in is printed", () => {
    const sim = quiet();
    go(sim, 3, 7);
    expect(at(sim)).toEqual([0, 22]);
    go(sim, 0, 1);
    go(sim, 1, 6);
    // Two rows of line, six squares each: nothing between them, nothing beyond them.
    expect(sim.held[HERO]).toBe(9 + 12);
    expect(sim.owner[cellOf(0, 20)]).toBe(0);
    expect(sim.owner[cellOf(2, 23)]).toBe(0);
  });

  it("pays a square at ×1, ×2 from 10, ×3 from 25, ×4 from 50, and gives ink back up to a limit", () => {
    expect(PULLS).toEqual([10, 25, 50]);
    expect([1, 9, 10, 24, 25, 49, 50, 300].map(tierFor)).toEqual([1, 1, 2, 2, 3, 3, 4, 4]);
    const sim = quiet();
    sim.ink = 5;
    // A big loop: up nine, across to the right edge, down, and home.
    go(sim, 0, 10);
    go(sim, 1, 7);
    go(sim, 2, 10);
    const ev: SimEvent[] = [];
    go(sim, 3, 6, ev);
    const print = ev.find((e) => e.k === "print");
    if (!print || print.k !== "print") throw new Error("no print");
    expect(print.squares).toBeGreaterThanOrEqual(50);
    expect(print.tier).toBe(4);
    expect(print.pts).toBe(print.squares * 4);
    expect(print.ink).toBe(INK_PER_LOOP);
    expect(sim.stats.bestTier).toBe(4);
    sim.ink = INK_MAX - 0.5;
    go(sim, 0, 12);
    go(sim, 3, 3);
    go(sim, 2, 12);
    expect(sim.ink).toBeLessThanOrEqual(INK_MAX);
  });

  it("holding the goal's share finishes the sheet: a bonus, ink back, and a fresh sheet with a second rival", () => {
    const sim = quiet();
    for (let c = 0; c < 48; c++) own(sim, c);
    sim.ink = 8;
    const ev: SimEvent[] = [];
    go(sim, 0, 3, ev);
    go(sim, 1, 1, ev);
    go(sim, 2, 4, ev);
    expect(sim.phase).toBe("printed");
    const done = ev.find((e) => e.k === "sheet");
    expect(done && done.k === "sheet" && [done.sheet, done.bonus, done.clean]).toEqual([1, SHEET_PTS, true]);
    expect(sim.stats.sheets).toBe(1);
    expect(sim.ink).toBeGreaterThan(8 + refillFor(1) - 1.2);
    const inkThen = sim.ink;
    const t0 = sim.t;
    until(sim, () => sim.phase === "play", 5, ev);
    // The ink doesn't dry while the sheet is held up.
    expect(sim.ink).toBe(inkThen);
    expect(sim.t - t0).toBeCloseTo(PRINT_TIME, 1);
    expect(ev.some((e) => e.k === "fresh" && e.sheet === 2)).toBe(true);
    expect(sim.sheet).toBe(2);
    expect(sim.bugs).toHaveLength(3);
    expect(counts(sim)).toEqual([9, 9, 9]);
    expect(sim.goal).toBe(0.2);
    expect(at(sim)).toEqual([7, ROWS - 4]);
  });
});

describe("smudging", () => {
  it("walking across a rival's wet line takes it off the sheet with its whole print, for points and ink", () => {
    const sim = quiet();
    const r = sim.bugs[1]!;
    const c = cellOf(7, 19);
    r.line = [c];
    sim.wet[c] = r.id;
    sim.ink = 10;
    const ev: SimEvent[] = [];
    go(sim, 0, 3, ev);
    const sm = ev.find((e) => e.k === "smudge");
    if (!sm || sm.k !== "smudge") throw new Error("no smudge");
    expect([sm.id, sm.by, sm.pts, sm.land.length]).toEqual([2, HERO, SMUDGE_PTS, 9]);
    expect(r.on).toBe(false);
    expect(sim.held[2]).toBe(0);
    expect(counts(sim)[1]).toBe(0);
    expect(sim.score).toBe(SMUDGE_PTS);
    expect(sim.ink).toBeGreaterThan(10 + INK_SMUDGE - 0.6);
    expect(sim.stats.smudges).toBe(1);
    expect(sim.wet[c]).toBe(HERO);
    // It crawls back on a few seconds later, somewhere away from the player, with a fresh patch.
    r.speed = 0;
    until(sim, () => r.on, RESPAWN + 1, ev);
    const crawl = ev.find((e) => e.k === "crawl");
    expect(crawl && crawl.k === "crawl" && crawl.id).toBe(2);
    expect(sim.held[2]).toBe(9);
    expect(Math.abs(xOf(r.cell) - xOf(sim.hero.cell)) + Math.abs(yOf(r.cell) - yOf(sim.hero.cell))).toBeGreaterThan(6);
  });

  it("a rival that walks across the player's wet line sends him back to where it began, and dries his ink", () => {
    const sim = quiet();
    go(sim, 0, 5);
    go(sim, 1, 1);
    until(sim, () => sim.hero.dir < 0 || xOf(sim.hero.cell) === 9, 2);
    sim.steer(2);
    until(sim, () => sim.hero.line.length >= 7, 2);
    const r = sim.bugs[1]!;
    // Pose the rival beside the line and send it across.
    r.cell = cellOf(6, 19);
    r.dir = 1;
    r.t = 0;
    r.speed = 6;
    r.line = [];
    r.brain = { choose: () => 1, reset: () => undefined } as unknown as Brain;
    const ink = sim.ink;
    const ev: SimEvent[] = [];
    until(sim, () => ev.some((e) => e.k === "smudged"), 2, ev);
    const sm = ev.find((e) => e.k === "smudged");
    if (!sm || sm.k !== "smudged") throw new Error("not smudged");
    expect(sm.by).toBe(2);
    expect(sm.line.length).toBeGreaterThanOrEqual(7);
    expect(at(sim)).toEqual([7, 21]);
    expect(sim.hero.dir).toBe(-1);
    expect(sim.hero.line).toHaveLength(0);
    expect(sim.wet.filter((w) => w === HERO)).toHaveLength(0);
    expect(ink - sim.ink).toBeGreaterThan(INK_SMUDGED - 0.1);
    expect(sim.stats.smudged).toBe(1);
    expect(sim.smudgedHere).toBe(true);
    expect(r.on).toBe(true);
  });

  it("his own wet line is a wall, and a line that can't get home any more is lost", () => {
    const sim = quiet();
    // A line round the top-left corner with the beetle inside it, one step from shutting itself in.
    const ring = [cellOf(2, 0), cellOf(2, 1), cellOf(2, 2), cellOf(1, 2), cellOf(0, 2)];
    const h = sim.hero;
    h.cell = cellOf(0, 2);
    h.line = [...ring];
    for (const c of ring) sim.wet[c] = HERO;
    h.gate = cellOf(7, 21);
    const ev: SimEvent[] = [];
    // Straight into his own line: refused.
    sim.steer(1);
    ev.push(...sim.events);
    expect(sim.hero.dir).toBe(-1);
    expect(ev.some((e) => e.k === "bonk")).toBe(true);
    // Up into the corner: now there is no way out that doesn't cross the line.
    go(sim, 0, 1, ev);
    const sm = ev.find((e) => e.k === "smudged");
    expect(sm && sm.k === "smudged" && sm.by).toBe(0);
    expect(sim.stats.selfCuts).toBe(1);
    expect(at(sim)).toEqual([7, 21]);
    expect(sim.wet.every((w) => w === 0)).toBe(true);
  });

  it("rivals step over each other's lines", () => {
    const sim = quiet(5, 2);
    const [a, b] = [sim.bugs[1]!, sim.bugs[2]!];
    const c = cellOf(7, 10);
    a.line = [c];
    sim.wet[c] = a.id;
    b.cell = cellOf(6, 10);
    b.dir = 1;
    b.t = 0;
    b.speed = 6;
    b.brain = { choose: () => 1, reset: () => undefined } as unknown as Brain;
    const ev: SimEvent[] = [];
    until(sim, () => xOf(b.cell) >= 9, 2, ev);
    expect(ev.some((e) => e.k === "smudge")).toBe(false);
    expect(a.on).toBe(true);
    expect(sim.wet[c]).toBe(a.id);
  });

  it("closing a loop with a rival right on the line pays a close shave", () => {
    const sim = quiet();
    const r = sim.bugs[1]!;
    r.cell = cellOf(6, 19);
    const ev: SimEvent[] = [];
    go(sim, 0, 3, ev);
    go(sim, 1, 1, ev);
    go(sim, 2, 2, ev);
    const shave = ev.find((e) => e.k === "shave");
    expect(shave && shave.k === "shave" && shave.pts).toBe(SHAVE_PTS);
    expect(sim.stats.shaves).toBe(1);
  });
});

describe("the ink", () => {
  it("dries a second a second on the first sheet, says so when it is low, counts the last seconds, and ends the run", () => {
    const sim = new Sim({ seed: 9 });
    const ev: SimEvent[] = [];
    until(sim, () => sim.over, 60, ev);
    expect(sim.t).toBeGreaterThan(INK_START - 0.05);
    expect(sim.t).toBeLessThan(INK_START + 0.05);
    expect(sim.score).toBe(0);
    expect(ev.filter((e) => e.k === "low")).toHaveLength(1);
    expect(ev.filter((e) => e.k === "tick").map((e) => (e.k === "tick" ? e.left : 0))).toEqual([5, 4, 3, 2, 1]);
    expect(ev.filter((e) => e.k === "over")).toHaveLength(1);
    expect(INK_LOW).toBe(6);
    // The clock stops with the run.
    const t = sim.t;
    until(sim, () => false, 1);
    expect(sim.t).toBe(t);
  });
});

describe("a whole run", () => {
  const play = (seed: number, fps: number, skill = SKILLS[1]!) => {
    const sim = new Sim({ seed });
    const pilot = new Pilot(skill, createRng(seed ^ 9));
    const ev: SimEvent[] = [];
    const per = fps / 30;
    for (let frame = 0; !sim.over && sim.t < 300; frame++) {
      // The thumb looks at the sheet thirty times a second, whatever the frame rate.
      if (frame % per === 0) pilot.step(sim, 1 / 30);
      sim.step(1 / fps);
      ev.push(...sim.events);
      sim.events.length = 0;
    }
    return { sim, ev };
  };

  it("keeps its books straight: squares held, wet lines and the score all add up, tick by tick", () => {
    for (const seed of [11, 222, 3333]) {
      const sim = new Sim({ seed });
      const pilot = new Pilot(SKILLS[2]!, createRng(seed));
      let sum = 0;
      let n = 0;
      while (!sim.over && sim.t < 300) {
        pilot.step(sim, 1 / 60);
        sim.step(1 / 60);
        for (const e of sim.events) {
          if (e.k === "print" || e.k === "shave" || e.k === "smudge") sum += e.pts;
          else if (e.k === "sheet") sum += e.bonus;
        }
        sim.events.length = 0;
        if (n++ % 7) continue;
        expect(sim.held.slice(1)).toEqual(counts(sim));
        for (const b of sim.bugs) {
          expect(xOf(b.cell)).toBeLessThan(COLS);
          if (b.dir >= 0) expect(beside(b.cell, b.dir), `beetle ${b.id} walking off the sheet`).toBeGreaterThanOrEqual(0);
          for (const c of b.line) {
            expect(sim.owner[c]).not.toBe(b.id);
            expect(sim.wet[c]).not.toBe(0);
          }
          if (b.id === HERO) for (const c of b.line) expect(sim.wet[c]).toBe(HERO);
        }
        for (let c = 0; c < N; c++) if (sim.wet[c]) expect(sim.bugs[sim.wet[c]! - 1]!.line).toContain(c);
        expect(sim.ink).toBeLessThanOrEqual(INK_MAX);
      }
      expect(sim.over).toBe(true);
      expect(sim.score).toBe(sum);
    }
  });

  it("is deterministic, and plays out the same at 30, 60 and 120 frames a second", () => {
    const key = (r: ReturnType<typeof play>) => `${r.sim.score}|${r.sim.sheet}|${r.sim.tick}|${r.sim.stats.squares}|${r.sim.stats.prints}|${r.ev.length}`;
    const at60 = key(play(4242, 60));
    expect(key(play(4242, 60))).toBe(at60);
    expect(key(play(4242, 30))).toBe(at60);
    expect(key(play(4242, 120))).toBe(at60);
    expect(at60.split("|")[0]).not.toBe("0");
    expect(key(play(4243, 60))).not.toBe(at60);
  });
});
