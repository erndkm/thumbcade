import { describe, expect, it } from "vitest";
import { Controller, CRITTERS, PILOTS } from "../src/ai.ts";
import { createRng } from "@thumbcade-games/kit/rng";
import { CAT, CRITTER, GX0, GX1, L, Table, W } from "../src/physics.ts";
import { burn, multiplier, pilotCat, Run, RULES, type RunEvent } from "../src/run.ts";
import { pct, playRun } from "../src/sim.ts";

/** Steps the run until the puck is in play (or `max` seconds pass). */
function untilPlay(run: Run, max = 5): void {
  const t0 = run.t;
  while (run.phase !== "play" && run.t - t0 < max) run.update(1 / 60);
}

/** Puts the stone just in front of a mouth, sliding in, with the critter parked aside. */
function slideIn(run: Run, into: 0 | 1, speed = 200, x = W / 2): RunEvent[] {
  untilPlay(run);
  const t = run.table;
  const c = t.mallets[CRITTER];
  c.x = 12;
  c.y = 40;
  const k = t.mallets[CAT];
  k.x = W - 12;
  k.y = L - 40;
  t.puck.x = x;
  t.puck.y = into === CRITTER ? 8 : L - 8;
  t.puck.vx = 0;
  t.puck.vy = into === CRITTER ? -speed : speed;
  const out: RunEvent[] = [];
  for (let i = 0; i < 30 && run.phase === "play"; i++) {
    run.update(1 / 240);
    out.push(...run.drain());
  }
  return out;
}

/** Plays out whatever beat follows (goal, knockout, lost bout) back to the drop. */
function settle(run: Run): RunEvent[] {
  const out: RunEvent[] = [];
  for (let i = 0; i < 600 && run.phase !== "play" && !run.over; i++) {
    run.update(1 / 60);
    out.push(...run.drain());
  }
  return out;
}

describe("the clock and the ladder", () => {
  it("starts at 32 s, runs 1 s a second at first and faster later", () => {
    expect(new Run(1).clock).toBe(RULES.clock);
    expect(burn(10)).toBe(1);
    expect(burn(110)).toBeCloseTo(2, 5);
  });

  it("a goal of yours buys time and pays points; a streak multiplies", () => {
    const run = new Run(5);
    run.update(1);
    const before = run.clock;
    const ev = slideIn(run, CRITTER);
    const goal = ev.find((e) => e.type === "goal");
    expect(goal && goal.type === "goal" && goal.by).toBe(CAT);
    expect(run.clock).toBeCloseTo(before + RULES.goalTime[0]!, 1);
    expect(run.score).toBe(RULES.goalPts);
    expect(multiplier(1)).toBe(1);
    expect(multiplier(2)).toBe(2);
    expect(multiplier(4)).toBe(3);
    expect(multiplier(9)).toBe(4);
  });

  it("goals only count through the mouth", () => {
    const run = new Run(5);
    const ev = slideIn(run, CRITTER, 200, GX0 - 8);
    expect(ev.some((e) => e.type === "goal")).toBe(false);
    const run2 = new Run(5);
    expect(slideIn(run2, CRITTER, 200, GX1 - 7).some((e) => e.type === "goal")).toBe(true);
  });

  it("a fast one is a zinger and pays extra", () => {
    const run = new Run(5);
    const ev = slideIn(run, CRITTER, RULES.zinger + 20);
    const g = ev.find((e) => e.type === "goal");
    expect(g && g.type === "goal" && g.zinger).toBe(true);
    expect(run.score).toBe(RULES.goalPts + RULES.zingerPts);
  });

  it("knocks out pip after two goals, then bramble skates in for a bout of three", () => {
    const run = new Run(9);
    const events: RunEvent[] = [];
    for (let g = 0; g < 2; g++) {
      events.push(...slideIn(run, CRITTER));
      events.push(...settle(run));
    }
    const ko = events.find((e) => e.type === "ko");
    expect(ko && ko.type === "ko" && ko.critter).toBe(0);
    expect(ko && ko.type === "ko" && ko.shutout).toBe(true);
    expect(events.some((e) => e.type === "next")).toBe(true);
    expect(run.critter).toBe(1);
    expect(run.boutTo).toBe(3);
    expect(run.me).toBe(0);
    expect(run.stats.kos).toBe(1);
  });

  it("a lost bout costs time after the first ten seconds, never before", () => {
    const early = new Run(3);
    const c0 = early.clock;
    for (let g = 0; g < 2; g++) {
      slideIn(early, CAT);
      settle(early);
    }
    expect(early.stats.lostBouts).toBe(1);
    expect(early.t).toBeLessThan(RULES.grace);
    expect(early.clock).toBeGreaterThan(c0 - 10);
    const late = new Run(3);
    while (late.t < RULES.grace + 1) {
      late.update(1 / 60);
      late.clock = 30;
    }
    untilPlay(late);
    late.me = 0;
    late.them = 0;
    slideIn(late, CAT);
    settle(late);
    const before = late.clock;
    const ev = slideIn(late, CAT);
    ev.push(...settle(late));
    const lost = ev.find((e) => e.type === "lostBout");
    expect(lost && lost.type === "lostBout" && lost.time).toBe(RULES.lostBout);
    expect(late.clock).toBeLessThan(before - RULES.lostBout + 0.5);
    expect(late.me + late.them).toBe(0);
  });

  it("a comeback knockout pays the comeback bonus", () => {
    const run = new Run(11, { critter: 1 });
    run.update(1);
    for (let g = 0; g < 2; g++) {
      slideIn(run, CAT);
      settle(run);
    }
    const ev: RunEvent[] = [];
    for (let g = 0; g < 3; g++) {
      ev.push(...slideIn(run, CRITTER));
      ev.push(...settle(run));
    }
    const ko = ev.find((e) => e.type === "ko");
    expect(ko && ko.type === "ko" && ko.comeback).toBe(true);
    expect(run.stats.comebacks).toBe(1);
  });

  it("the last ten seconds pay double", () => {
    const run = new Run(4);
    untilPlay(run);
    run.clock = RULES.frenzy - 0.5;
    run.update(1 / 60);
    expect(run.drain().some((e) => e.type === "frenzy")).toBe(true);
    const ev = slideIn(run, CRITTER);
    const g = ev.find((e) => e.type === "goal");
    expect(g && g.type === "goal" && g.frenzy).toBe(true);
    expect(run.score).toBe(RULES.goalPts * 2);
  });

  it("a shot sliding in at the buzzer still counts", () => {
    const run = new Run(6);
    untilPlay(run);
    const t = run.table;
    t.mallets[CRITTER].x = 12;
    t.mallets[CRITTER].y = 40;
    t.puck.x = W / 2;
    t.puck.y = 70;
    t.puck.vx = 0;
    t.puck.vy = -160;
    run.clock = 0.01;
    const ev: RunEvent[] = [];
    for (let i = 0; i < 240 && !run.over; i++) {
      run.update(1 / 120);
      ev.push(...run.drain());
    }
    expect(ev.some((e) => e.type === "lastShot")).toBe(true);
    const g = ev.find((e) => e.type === "goal");
    expect(g && g.type === "goal" && g.buzzer).toBe(true);
    expect(run.over).toBe(true);
  });

  it("beating all five ends the run as pond champion, with the seconds left paid out", () => {
    const run = new Run(8);
    for (let c = 0; c < CRITTERS.length; c++) {
      for (let g = 0; g < RULES.boutTo[c]!; g++) {
        run.clock = 30;
        slideIn(run, CRITTER);
        settle(run);
      }
    }
    expect(run.over).toBe(true);
    expect(run.stats.champion).toBe(true);
    expect(run.stats.kos).toBe(5);
  });

  it("a stone left still in the cat's half drifts back into play", () => {
    const run = new Run(2);
    untilPlay(run);
    expect(run.table.puck.y).toBeGreaterThan(L / 2);
    const ev: RunEvent[] = [];
    for (let i = 0; i < 180; i++) {
      run.update(1 / 60);
      ev.push(...run.drain());
    }
    expect(ev.some((e) => e.type === "drift")).toBe(true);
  });

  it("is deterministic for a seed and a pilot", () => {
    const a = playRun("good", 77);
    const b = playRun("good", 77);
    expect(a.seconds).toBe(b.seconds);
    expect(a.score).toBe(b.score);
  });
});

describe("the critters", () => {
  it("each one stops most slow shots at its den from mid ice", () => {
    for (const c of CRITTERS) {
      let saves = 0;
      const n = 40;
      for (let i = 0; i < n; i++) {
        const t = new Table();
        const brain = new Controller(CRITTER, c.brain, createRng(100 + i));
        t.mallets[CAT].x = 12;
        t.mallets[CAT].y = L - 12;
        t.drop(W / 2 + ((i % 5) - 2) * 6, L / 2 - 5);
        t.puck.vx = ((i % 3) - 1) * 12;
        t.puck.vy = -95;
        let goal = false;
        for (let s = 0; s < 240 * 3 && t.live; s++) {
          brain.observe(t, 1 / 240);
          brain.think(t, 1 / 240, t.live);
          if (t.step().some((h) => h.kind === "goal" && h.into === CRITTER)) goal = true;
        }
        if (!goal) saves++;
      }
      expect(saves / n, c.id).toBeGreaterThan(0.75);
    }
  });

  it("can't react faster than its reaction time", () => {
    for (const c of CRITTERS) {
      // Two identical worlds; in one a shot is fired. The critter's plans may only part ways after its reaction time.
      const worlds = [0, 1].map(() => {
        const t = new Table();
        t.drop(30, 60);
        return { t, brain: new Controller(CRITTER, c.brain, createRng(9)) };
      });
      const step = () =>
        worlds.forEach(({ t, brain }) => {
          brain.observe(t, 1 / 240);
          brain.think(t, 1 / 240, true);
          t.step();
        });
      for (let s = 0; s < 120; s++) step();
      const p = worlds[0]!.t.puck;
      p.vx = 120;
      p.vy = -40;
      let parted = -1;
      for (let s = 1; s <= 240 && parted < 0; s++) {
        step();
        const [a, b] = worlds.map((w) => w.t.mallets[CRITTER]);
        if (Math.abs(a!.tx - b!.tx) > 1e-9 || Math.abs(a!.ty - b!.ty) > 1e-9) parted = s / 240;
      }
      expect(parted, c.id).toBeGreaterThanOrEqual(c.brain.reaction - 1 / 240);
    }
  });

  it("each has its own personality: bramble stays home, hoot banks, pip and ember attack", () => {
    const style = (i: number) => {
      let deep = 0;
      let banks = 0;
      let shots = 0;
      let time = 0;
      for (let s = 0; s < 6; s++) {
        const run = new Run(500 + s, { critter: i });
        const cat = pilotCat(PILOTS.good, 900 + s);
        while (run.t < 40 && run.critter === i && !run.over) {
          run.update(1 / 60, cat.drive);
          run.clock = 30;
          if (run.phase === "play") {
            time++;
            if (run.table.mallets[CRITTER].y > 45) deep++;
          }
          for (const e of run.drain()) {
            if (e.type === "hit" && e.who === CRITTER && e.impact > 60) {
              shots++;
              const p = run.table.puck;
              // Aimed off a side board: heading down but not straight at the den.
              const tx = p.x + (p.vx * (L - p.y)) / Math.max(1, p.vy);
              if (p.vy > 0 && (tx < 0 || tx > W)) banks++;
            }
          }
        }
      }
      return { deep: deep / time, bank: banks / Math.max(1, shots) };
    };
    const pip = style(0);
    const bramble = style(1);
    const hoot = style(2);
    const ember = style(3);
    expect(bramble.deep).toBeLessThan(pip.deep * 0.6);
    expect(bramble.deep).toBeLessThan(ember.deep * 0.6);
    expect(hoot.bank).toBeGreaterThan(pip.bank);
  });

  it("every critter can be beaten by a good thumb", () => {
    for (let i = 0; i < CRITTERS.length; i++) {
      let goals = 0;
      for (let s = 0; s < 4; s++) {
        const run = new Run(40 + s, { critter: i });
        const cat = pilotCat(PILOTS.expert, 60 + s);
        while (run.t < 45 && run.critter === i && !run.over) {
          run.update(1 / 60, cat.drive);
          run.clock = 30;
          for (const e of run.drain()) if (e.type === "goal" && e.by === CAT) goals++;
        }
      }
      expect(goals, CRITTERS[i]!.id).toBeGreaterThan(2);
    }
  });
});

describe("run lengths (pilots)", () => {
  const runs = 30;
  const lengths = (skill: Parameters<typeof playRun>[0]) => Array.from({ length: runs }, (_, i) => playRun(skill, 3000 + i * 101));

  it("an idle cat reaches game over inside the reviewer's window", () => {
    const res = lengths("idle");
    expect(Math.max(...res.map((r) => r.seconds))).toBeLessThan(60);
    expect(Math.min(...res.map((r) => r.seconds))).toBeGreaterThan(20);
  });

  it("nobody loses in the first ten seconds, and runs stay between 20 and 90 s", () => {
    for (const skill of ["novice", "casual", "good", "expert"] as const) {
      const res = lengths(skill);
      const secs = res.map((r) => r.seconds);
      expect(Math.min(...secs), skill).toBeGreaterThan(20);
      expect(Math.min(...res.map((r) => r.clockAt10)), skill).toBeGreaterThan(15);
      expect(pct(secs, 0.9), skill).toBeLessThanOrEqual(92);
    }
  });

  it("better play goes further up the ladder", () => {
    const med = (skill: Parameters<typeof playRun>[0]) => pct(lengths(skill).map((r) => r.score), 0.5);
    expect(med("expert")).toBeGreaterThan(med("casual"));
    expect(med("casual")).toBeGreaterThan(med("novice"));
  });
});
