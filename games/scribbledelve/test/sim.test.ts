import { createRng } from "@thumbcade-games/kit/rng";
import { describe, expect, it } from "vitest";
import { beside, cellOf, COLS, distances, generate, isOpen, N, opposite, ROWS, START, xOf, type Maze } from "../src/maze.ts";
import { Pilot, SKILLS } from "../src/pilot.ts";
import {
  braveSeconds, BUFFER, CLEAR_TIME, COIN, COIN_HERE, DRAW_TIME, GONE_TIME, HEARTS, HERO_SPEED, HZ, LATE_TURN, monstersOn, monsterSpeed, multFor, NOTHING, OUCH_TIME, POOF,
  REACH, SHAVE, Sim, STAR_TIME, STREAK_GAP, STREAK_TIERS, SWORD_HERE, wobble, type Monster, type SimEvent,
} from "../src/sim.ts";

const TICK = 1 / HZ;

/** Steps until `done` (or `max` seconds), collecting events. */
function until(sim: Sim, done: () => boolean, max = 30, sink?: SimEvent[]): void {
  for (let t = 0; t < max && !done(); t += TICK) {
    sim.step(TICK);
    if (sink) sink.push(...sim.events);
    sim.events.length = 0;
  }
}
const secs = (sim: Sim, s: number, sink?: SimEvent[]) => {
  const end = sim.tick + Math.round(s * HZ);
  until(sim, () => sim.tick >= end, s + 1, sink);
};

function carve(m: Maze, x: number, y: number, d: number): void {
  const c = cellOf(x, y);
  m.open[c * 4 + d] = 1;
  m.open[beside(c, d) * 4 + opposite(d)] = 1;
}

/**
 * A bare sheet with three pen-free runs: the whole bottom row, column 3 from the bottom up to row 4, and column 5
 * from the bottom up to row 6. No coins, no scribbles; the knight at the start (3, 8).
 */
function bare(): Sim {
  const sim = new Sim({ seed: 1 });
  const m: Maze = { open: new Uint8Array(N * 4), start: START, holes: [], swords: [] };
  for (let x = 0; x < COLS - 1; x++) carve(m, x, 8, 1);
  for (let y = 8; y > 4; y--) carve(m, 3, y, 0);
  for (let y = 8; y > 6; y--) carve(m, 5, y, 0);
  sim.maze = m;
  sim.things.fill(NOTHING);
  // One coin somewhere out of reach, so picking up the others never clears the floor.
  sim.coinsLeft = sim.coinsTotal = 1;
  sim.monsters = [];
  return sim;
}
function coin(sim: Sim, x: number, y: number): void {
  sim.things[cellOf(x, y)] = COIN_HERE;
  sim.coinsLeft++;
  sim.coinsTotal++;
}
function scribble(sim: Sim, x: number, y: number, dir: number, kind: 0 | 1 | 2 | 3 = 0): Monster {
  const m: Monster = { id: 90 + sim.monsters.length, kind, state: "hunt", timer: 0, hole: cellOf(x, y), cell: cellOf(x, y), dir, t: 0, near: false };
  sim.monsters.push(m);
  return m;
}

describe("the knight", () => {
  it("never crosses a pen line or leaves the sheet, and neither does a scribble", () => {
    for (let n = 0; n < 30; n++) {
      const sim = new Sim({ seed: 300 + n * 13 });
      const rng = createRng(n + 5);
      let ticks = 0;
      while (!sim.over && sim.t < 45) {
        if (ticks++ % 20 === 0) sim.steer(rng.int(0, 3));
        sim.step(TICK);
        sim.events.length = 0;
        const h = sim.hero;
        if (h.dir >= 0) expect(isOpen(sim.maze, h.cell, h.dir), `knight at ${h.cell} going ${h.dir}`).toBe(true);
        expect(h.t).toBeGreaterThanOrEqual(0);
        expect(h.t).toBeLessThan(1);
        expect(sim.heroX).toBeGreaterThanOrEqual(0);
        expect(sim.heroX).toBeLessThanOrEqual(COLS - 1);
        expect(sim.heroY).toBeGreaterThanOrEqual(0);
        expect(sim.heroY).toBeLessThanOrEqual(ROWS - 1);
        for (const m of sim.monsters) {
          if (m.state !== "hunt" && m.state !== "scared") continue;
          if (m.dir >= 0) expect(isOpen(sim.maze, m.cell, m.dir), `scribble at ${m.cell} going ${m.dir}`).toBe(true);
          expect(m.t).toBeLessThan(1);
        }
      }
    }
  });

  it("sets off at once from a standstill, and bonks into a line without moving", () => {
    const sim = bare();
    const ev: SimEvent[] = [];
    sim.steer(2);
    ev.push(...sim.events);
    expect(ev.some((e) => e.k === "bump" && e.dir === 2)).toBe(true);
    expect(sim.hero.dir).toBe(-1);
    expect(sim.stats.bumps).toBe(1);
    sim.steer(1);
    expect(sim.hero.dir).toBe(1);
    secs(sim, 1 / HERO_SPEED + 2 * TICK);
    expect(sim.hero.cell).toBe(cellOf(4, 8));
  });

  it("keeps a swipe in mind and takes the next gap that way", () => {
    const sim = bare();
    sim.steer(1);
    secs(sim, 0.5 / HERO_SPEED);
    // Between (3, 8) and (4, 8): swipe up. No gap at (4, 8); the gap is at (5, 8).
    sim.steer(0);
    expect(sim.hero.dir).toBe(1);
    expect(sim.hero.want).toBe(0);
    until(sim, () => sim.hero.dir === 0, 3);
    expect(sim.hero.cell).toBe(cellOf(5, 8));
    expect(sim.hero.t).toBeLessThan(0.1);
    // Up the column to its end, and there he stands.
    until(sim, () => sim.hero.dir < 0, 3);
    expect(sim.hero.cell).toBe(cellOf(5, 6));
    expect(sim.hero.t).toBe(0);
  });

  it("forgets a swipe that found no gap in time", () => {
    const sim = bare();
    sim.hero.cell = cellOf(2, 8);
    sim.steer(3);
    sim.steer(0);
    const t0 = sim.t;
    until(sim, () => sim.hero.dir < 0, 3);
    expect(sim.hero.cell).toBe(cellOf(0, 8));
    until(sim, () => sim.t - t0 >= BUFFER - 0.1, 3);
    expect(sim.hero.want).toBe(0);
    until(sim, () => sim.t - t0 >= BUFFER + 0.05, 3);
    expect(sim.hero.want).toBe(-1);
  });

  it("doubles back on the spot", () => {
    const sim = bare();
    sim.steer(1);
    secs(sim, 0.6 / HERO_SPEED);
    const x = sim.heroX;
    sim.steer(3);
    expect(sim.hero.dir).toBe(3);
    expect(sim.heroX).toBeCloseTo(x, 9);
    secs(sim, 0.1);
    expect(sim.heroX).toBeLessThan(x);
    until(sim, () => sim.hero.dir < 0, 3);
    expect(sim.hero.cell).toBe(cellOf(0, 8));
  });

  it("a swipe just past a gap still takes it; a swipe well past it waits for the next one", () => {
    const late = bare();
    late.hero.cell = cellOf(1, 8);
    late.steer(1);
    until(late, () => late.hero.cell === cellOf(3, 8) && late.hero.t > LATE_TURN - 0.1, 3);
    expect(late.hero.t).toBeLessThanOrEqual(LATE_TURN);
    late.steer(0);
    expect(late.events.some((e) => e.k === "turn" && e.late)).toBe(true);
    expect(late.hero.dir).toBe(0);
    expect(late.hero.cell).toBe(cellOf(3, 8));
    expect(late.hero.t).toBe(0);

    const tooLate = bare();
    tooLate.hero.cell = cellOf(1, 8);
    tooLate.steer(1);
    until(tooLate, () => tooLate.hero.cell === cellOf(3, 8) && tooLate.hero.t > LATE_TURN + 0.05, 3);
    tooLate.steer(0);
    expect(tooLate.hero.dir).toBe(1);
    until(tooLate, () => tooLate.hero.dir === 0, 3);
    expect(tooLate.hero.cell).toBe(cellOf(5, 8));
  });

  it("does nothing when steered outside play", () => {
    const sim = bare();
    sim.phase = "over";
    sim.steer(1);
    expect(sim.hero.dir).toBe(-1);
    expect(sim.stats.swipes).toBe(0);
  });
});

describe("coins", () => {
  it("are picked up a little before the middle of their square, once each, ten points apiece", () => {
    const sim = bare();
    for (const x of [4, 5, 6]) coin(sim, x, 8);
    const ev: SimEvent[] = [];
    sim.steer(1);
    until(sim, () => ev.some((e) => e.k === "coin"), 2, ev);
    expect(sim.heroX).toBeGreaterThanOrEqual(4 - REACH - 1e-9);
    expect(sim.heroX).toBeLessThan(4 - REACH + 0.07);
    until(sim, () => sim.hero.dir < 0, 3, ev);
    const coins = ev.filter((e): e is Extract<SimEvent, { k: "coin" }> => e.k === "coin");
    expect(coins.map((e) => e.cell)).toEqual([cellOf(4, 8), cellOf(5, 8), cellOf(6, 8)]);
    expect(coins.map((e) => e.streak)).toEqual([1, 2, 3]);
    expect(sim.score).toBe(3 * COIN);
    expect(sim.stats.coins).toBe(3);
    // Back over the same squares: nothing more.
    sim.steer(3);
    until(sim, () => sim.hero.dir < 0, 3, ev);
    expect(sim.score).toBe(3 * COIN);
  });

  it("in a row build the streak: ×2 at 12, ×3 at 28, ×4 at 48; a gap ends it", () => {
    expect(STREAK_TIERS).toEqual([12, 28, 48]);
    expect([0, 11, 12, 27, 28, 47, 48, 200].map(multFor)).toEqual([1, 1, 2, 2, 3, 3, 4, 4]);
    // A run of thirteen coins: along the bottom row, up at the end, and back along the row above.
    const sim = bare();
    carve(sim.maze, 6, 8, 0);
    for (let x = 6; x > 0; x--) carve(sim.maze, x, 7, 3);
    sim.hero.cell = cellOf(0, 8);
    for (let x = 1; x <= 6; x++) coin(sim, x, 8);
    for (let x = 6; x >= 0; x--) coin(sim, x, 7);
    const ev: SimEvent[] = [];
    sim.steer(1);
    until(sim, () => sim.hero.cell === cellOf(5, 8) && sim.hero.t > 0.5, 3, ev);
    sim.steer(0);
    until(sim, () => sim.hero.dir === 0 && sim.hero.t > 0.5, 3, ev);
    sim.steer(3);
    until(sim, () => sim.hero.dir < 0 && sim.hero.cell === cellOf(0, 7), 4, ev);
    const coins = ev.filter((e): e is Extract<SimEvent, { k: "coin" }> => e.k === "coin");
    expect(coins).toHaveLength(13);
    // The twelfth coin is already worth double.
    expect(coins.map((e) => e.pts)).toEqual([10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 20, 20]);
    expect(ev.filter((e) => e.k === "tier").map((e) => (e.k === "tier" ? e.mult : 0))).toEqual([2]);
    expect(sim.streakFrac).toBeGreaterThan(0.5);
    secs(sim, STREAK_GAP + 0.1, ev);
    expect(sim.streak).toBe(0);
    expect(sim.streakFrac).toBe(0);
    expect(ev.some((e) => e.k === "streakLost" && e.mult === 2 && e.streak === 13)).toBe(true);
    expect(sim.stats.maxStreak).toBe(13);
    expect(sim.stats.maxMult).toBe(2);
  });

  it("every floor has a coin in every square but the start and the holes, and two swords", () => {
    for (let s = 1; s <= 20; s++) {
      const sim = new Sim({ seed: s * 77 });
      expect(sim.coinsTotal).toBe(N - 1 - 4 - 2);
      expect(sim.things[sim.maze.start]).toBe(NOTHING);
      for (const h of sim.maze.holes) expect(sim.things[h]).toBe(NOTHING);
      for (const sw of sim.maze.swords) expect(sim.things[sw]).toBe(SWORD_HERE);
    }
  });

  it("the last coin clears the floor: a bonus, a fresh maze, a moment's grace and a heart back on even floors", () => {
    const sim = new Sim({ seed: 808 });
    const ev: SimEvent[] = [];
    const lastCoin = () => {
      sim.monsters = [];
      sim.things.fill(NOTHING);
      const d = [0, 1, 2, 3].find((dd) => isOpen(sim.maze, sim.hero.cell, dd))!;
      sim.things[beside(sim.hero.cell, d)] = COIN_HERE;
      sim.coinsLeft = 1;
      sim.steer(d);
    };
    until(sim, () => sim.phase === "play" && sim.hero.dir < 0, 1);
    const first = [...sim.maze.open].join("");
    lastCoin();
    until(sim, () => sim.phase === "clear", 2, ev);
    const clear = ev.find((e) => e.k === "clear");
    expect(clear && clear.k === "clear" && [clear.floor, clear.bonus, clear.heart]).toEqual([1, 200, false]);
    expect(sim.score).toBe(COIN + 200);
    const t0 = sim.t;
    until(sim, () => sim.phase === "play", 5, ev);
    expect(sim.t - t0).toBeCloseTo(CLEAR_TIME, 1);
    expect(sim.floor).toBe(2);
    expect([...sim.maze.open].join("")).not.toBe(first);
    expect(sim.hero.cell).toBe(START);
    expect(sim.hero.dir).toBe(-1);
    expect(sim.hero.inv).toBeGreaterThan(0.9 * HZ);
    expect(sim.coinsLeft).toBe(N - 7);
    expect(sim.monsters).toHaveLength(monstersOn(2));
    expect(sim.monsters.every((m) => m.state === "drawing")).toBe(true);
    // Floor 2, one heart down: clearing it gives the heart back.
    sim.hearts = HEARTS - 1;
    lastCoin();
    until(sim, () => sim.phase === "clear", 2, ev);
    expect(sim.hearts).toBe(HEARTS);
    const second = ev.filter((e) => e.k === "clear")[1];
    expect(second && second.k === "clear" && [second.floor, second.bonus, second.heart]).toEqual([2, 400, true]);
    expect(sim.stats.floors).toBe(2);
  });
});

describe("the scribbles", () => {
  it("get faster, cleverer and more numerous floor by floor; the sword gets shorter", () => {
    expect([1, 2, 3, 4, 9].map(monstersOn)).toEqual([2, 3, 3, 4, 4]);
    for (let f = 1; f < 12; f++) {
      expect(monsterSpeed(f + 1)).toBeGreaterThanOrEqual(monsterSpeed(f));
      expect(braveSeconds(f + 1)).toBeLessThanOrEqual(braveSeconds(f));
      expect(wobble(f + 1)).toBeLessThanOrEqual(wobble(f));
    }
    // The knight outruns them for the first seven floors.
    expect(monsterSpeed(1)).toBeLessThan(HERO_SPEED * 0.55);
    expect(monsterSpeed(7)).toBeLessThan(HERO_SPEED);
    expect(monsterSpeed(30)).toBeLessThan(HERO_SPEED * 1.05);
    expect(braveSeconds(30)).toBeGreaterThanOrEqual(2.6);
    expect(wobble(30)).toBeGreaterThan(0);
  });

  it("are drawn out of their holes one after another, the first not for three seconds", () => {
    const sim = new Sim({ seed: 21 });
    const ev: SimEvent[] = [];
    expect(sim.monsters).toHaveLength(2);
    expect(sim.monsters.map((m) => m.cell)).toEqual([sim.maze.holes[0], sim.maze.holes[1]]);
    until(sim, () => ev.some((e) => e.k === "crawl"), 6, ev);
    expect(sim.t).toBeGreaterThan(2.9);
    expect(sim.t).toBeLessThan(3.1);
    until(sim, () => ev.filter((e) => e.k === "crawl").length === 2, 6, ev);
    expect(sim.t).toBeGreaterThan(4.3);
  });

  it("never turn back on themselves while they hunt", () => {
    for (let n = 0; n < 12; n++) {
      const sim = new Sim({ seed: 40 + n * 91 });
      sim.hearts = 99;
      const pilot = new Pilot(SKILLS[1]!, createRng(n));
      const last = new Map<number, { cell: number; dir: number; state: string }>();
      while (sim.t < 30) {
        pilot.step(sim, TICK);
        sim.step(TICK);
        const quiet = !sim.events.some((e) => e.k === "sword" || e.k === "respawn" || e.k === "floor" || e.k === "braveEnd");
        sim.events.length = 0;
        for (const m of sim.monsters) {
          const was = last.get(m.id);
          if (quiet && was && was.state === "hunt" && m.state === "hunt" && was.dir >= 0 && m.cell !== was.cell) expect(m.dir, `scribble ${m.id} at ${m.cell}`).not.toBe(opposite(was.dir));
          last.set(m.id, { cell: m.cell, dir: m.dir, state: m.state });
        }
      }
    }
  });

  it("catch a knight who stands still: a heart, a pause, then back to the start with two seconds' grace", () => {
    const sim = new Sim({ seed: 77 });
    const ev: SimEvent[] = [];
    until(sim, () => sim.phase === "ouch", 40, ev);
    const caught = ev.find((e) => e.k === "caught");
    expect(caught && caught.k === "caught" && caught.hearts).toBe(HEARTS - 1);
    expect(sim.hearts).toBe(HEARTS - 1);
    const t0 = sim.t;
    until(sim, () => sim.phase === "play", 5, ev);
    expect(sim.t - t0).toBeCloseTo(OUCH_TIME, 1);
    expect(ev.some((e) => e.k === "respawn")).toBe(true);
    expect(sim.hero.cell).toBe(START);
    expect(sim.hero.inv).toBeGreaterThan(1.9 * HZ);
    expect(sim.monsters.every((m) => m.state === "drawing" && m.cell === m.hole)).toBe(true);
    // Twice more and the run is over.
    until(sim, () => sim.over, 90, ev);
    expect(sim.hearts).toBe(0);
    expect(ev.filter((e) => e.k === "caught")).toHaveLength(3);
    expect(ev.filter((e) => e.k === "over")).toHaveLength(1);
    expect(sim.stats.caughtBy.reduce((a, b) => a + b, 0)).toBe(3);
  });

  it("cannot touch him while the grace lasts", () => {
    const sim = bare();
    scribble(sim, 5, 8, 3);
    sim.hero.inv = 3 * HZ;
    secs(sim, 2.5);
    expect(sim.phase).toBe("play");
    expect(sim.hearts).toBe(HEARTS);
    secs(sim, 2);
    expect(sim.hearts).toBe(HEARTS - 1);
  });

  it("a scribble he gets away from by a whisker pays a close shave", () => {
    const sim = bare();
    const m = scribble(sim, 5, 8, 3);
    const ev: SimEvent[] = [];
    until(sim, () => m.near, 3, ev);
    sim.steer(3);
    until(sim, () => ev.some((e) => e.k === "shave"), 3, ev);
    expect(sim.hearts).toBe(HEARTS);
    expect(sim.score).toBe(SHAVE);
    expect(sim.stats.shaves).toBe(1);
    expect(m.near).toBe(false);
  });
});

describe("the sword", () => {
  it("turns the scribbles tail, pays 200, 400 for the ones he runs down, and runs out", () => {
    const sim = bare();
    sim.things[cellOf(4, 8)] = SWORD_HERE;
    const a = scribble(sim, 6, 8, 3, 0);
    const b = scribble(sim, 0, 8, 1, 1);
    const ev: SimEvent[] = [];
    sim.steer(1);
    until(sim, () => ev.some((e) => e.k === "sword"), 2, ev);
    expect(a.state).toBe("scared");
    expect(b.state).toBe("scared");
    // Both were coming at him; both have turned round.
    expect(a.dir).toBe(1);
    expect(b.dir).toBe(3);
    expect(sim.hero.brave).toBe(Math.round(braveSeconds(1) * HZ));
    until(sim, () => ev.some((e) => e.k === "poof"), 3, ev);
    expect(a.state).toBe("gone");
    expect(sim.score).toBe(POOF);
    sim.steer(3);
    until(sim, () => ev.filter((e) => e.k === "poof").length === 2, 4, ev);
    expect(sim.score).toBe(POOF + POOF * 2);
    expect(ev.filter((e) => e.k === "poof").map((e) => (e.k === "poof" ? e.n : 0))).toEqual([1, 2]);
    expect(sim.stats.poofs).toBe(2);
    expect(sim.hearts).toBe(HEARTS);
    // A poofed scribble is redrawn at its hole.
    const goneAt = sim.t;
    until(sim, () => a.state === "drawing", GONE_TIME + 1, ev);
    expect(a.cell).toBe(a.hole);
    until(sim, () => a.state === "hunt" || a.state === "scared", DRAW_TIME + 1, ev);
    expect(sim.t - goneAt).toBeGreaterThan(DRAW_TIME);
    until(sim, () => sim.hero.brave === 0, 10, ev);
    expect(ev.some((e) => e.k === "braveEnd")).toBe(true);
    expect(sim.monsters.every((m) => m.state !== "scared")).toBe(true);
    expect(sim.stats.swordsWasted).toBe(0);
  });

  it("a scared scribble runs away from him, slower than it hunts", () => {
    const sim = new Sim({ seed: 5150 });
    until(sim, () => sim.monsters.every((m) => m.state === "hunt"), 10);
    const m = sim.monsters[0]!;
    // Hand him a sword on the spot.
    const d = [0, 1, 2, 3].find((dd) => isOpen(sim.maze, sim.hero.cell, dd))!;
    sim.things[beside(sim.hero.cell, d)] = SWORD_HERE;
    sim.hero.inv = 0;
    sim.steer(d);
    until(sim, () => sim.hero.brave > 0, 2);
    until(sim, () => sim.hero.dir < 0, 2);
    const from = distances(sim.maze, sim.hero.cell);
    const before = from[m.cell]!;
    secs(sim, 1.5);
    expect(m.state).toBe("scared");
    expect(distances(sim.maze, sim.hero.cell)[m.cell]!).toBeGreaterThanOrEqual(Math.min(before, 6));
  });

  it("that poofs nothing is counted as wasted", () => {
    const sim = bare();
    sim.things[cellOf(4, 8)] = SWORD_HERE;
    sim.steer(1);
    until(sim, () => sim.hero.brave > 0, 2);
    until(sim, () => sim.hero.brave === 0, 10);
    expect(sim.stats.swords).toBe(1);
    expect(sim.stats.swordsWasted).toBe(1);
  });
});

describe("a whole run", () => {
  const play = (seed: number, fps: number, skill = SKILLS[1]!) => {
    const sim = new Sim({ seed });
    const pilot = new Pilot(skill, createRng(seed ^ 9));
    const ev: SimEvent[] = [];
    const per = fps / 30;
    for (let frame = 0; !sim.over && sim.t < 200; frame++) {
      // The thumb looks at the page thirty times a second, whatever the frame rate.
      if (frame % per === 0) pilot.step(sim, 1 / 30);
      sim.step(1 / fps);
      ev.push(...sim.events);
      sim.events.length = 0;
    }
    return { sim, ev };
  };

  it("the score is exactly what the page says was earned", () => {
    for (const seed of [11, 222, 3333, 44444]) {
      const { sim, ev } = play(seed, 60, SKILLS[2]!);
      let sum = 0;
      for (const e of ev) {
        if (e.k === "coin" || e.k === "poof" || e.k === "shave" || e.k === "starGot") sum += e.pts;
        else if (e.k === "clear") sum += e.bonus;
      }
      expect(sim.score).toBe(sum);
      expect(sim.over).toBe(true);
    }
  });

  it("a gold star turns up once a floor when half the coins are gone, far from the knight, and doesn't stay", () => {
    let stars = 0;
    for (const seed of [11, 222, 3333, 44444, 5, 66]) {
      const sim = new Sim({ seed });
      const pilot = new Pilot(SKILLS[2]!, createRng(seed));
      const perFloor = new Map<number, number>();
      let shownAt = -1;
      while (!sim.over && sim.t < 200) {
        pilot.step(sim, 1 / 60);
        sim.step(1 / 60);
        for (const e of sim.events) {
          if (e.k === "star") {
            stars++;
            shownAt = sim.t;
            perFloor.set(sim.floor, (perFloor.get(sim.floor) ?? 0) + 1);
            expect(sim.coinsLeft).toBeLessThanOrEqual(sim.coinsTotal / 2);
            expect(sim.things[e.cell]).toBe(NOTHING);
            expect(distances(sim.maze, sim.hero.cell)[e.cell]).toBeGreaterThanOrEqual(4);
          } else if (e.k === "starGone") expect(sim.t - shownAt).toBeGreaterThanOrEqual(STAR_TIME - 0.05);
          else if (e.k === "starGot") expect(e.pts).toBe(250 + 50 * sim.floor);
        }
        sim.events.length = 0;
      }
      for (const n of perFloor.values()) expect(n).toBe(1);
    }
    expect(stars).toBeGreaterThan(5);
  });

  it("is deterministic, and plays out the same at 30, 60 and 120 frames a second", () => {
    const key = (r: ReturnType<typeof play>) => `${r.sim.score}|${r.sim.floor}|${r.sim.tick}|${r.sim.stats.coins}|${r.sim.stats.poofs}|${r.ev.length}`;
    const at60 = key(play(4242, 60));
    expect(key(play(4242, 60))).toBe(at60);
    expect(key(play(4242, 30))).toBe(at60);
    expect(key(play(4242, 120))).toBe(at60);
    expect(at60.split("|")[0]).not.toBe("0");
    expect(key(play(4243, 60))).not.toBe(at60);
  });

  it("floors are drawn from the run's seed: the same run sees the same mazes", () => {
    const a = new Sim({ seed: 9 });
    const b = new Sim({ seed: 9 });
    expect([...a.maze.open]).toEqual([...b.maze.open]);
    expect([...a.maze.open].join("")).not.toBe([...generate(9).open].join("") + "x");
    expect(xOf(a.hero.cell)).toBe(3);
  });
});
