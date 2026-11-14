import { createRng } from "@thumbcade-games/kit/rng";
import { describe, expect, it } from "vitest";
import { DEMO, Pilot } from "../src/pilot.ts";
import { CAR_HALF_W, GATE_M, HALF, isBend, OFF, WARM_M, wrap, type Seg } from "../src/road.ts";
import {
  DRIFT_PTS,
  GAPS,
  GRADE_POINTS,
  gradeFor,
  holdCurvature,
  K_HOLD,
  multFor,
  Run,
  TIERS,
  vTarget,
  type RunEvent,
} from "../src/sim.ts";

/** Puts the cart at `s`, `d` metres left of the centre, heading `off` radians left of the road. */
function place(run: Run, s: number, d = 0, off = 0, v = 15): void {
  const c = run.course;
  c.ensure(s + 400);
  const p = c.point(s, d);
  const a = c.pose(s).a;
  run.x = p.x;
  run.y = p.y;
  run.a = a + off;
  run.s = s;
  run.d = d;
  run.seg = c.indexAt(s);
  run.v = v;
  run.kappa = 0;
}

function firstBend(run: Run, after = WARM_M): Seg {
  run.course.ensure(after + 600);
  return run.course.segs.find((g) => g.s0 > after && isBend(g))!;
}

function drive(run: Run, seconds: number, hold: (t: number) => boolean = () => false): RunEvent[] {
  const out: RunEvent[] = [];
  for (let t = 0; t < seconds && run.phase === "drive"; t += 1 / 60) {
    run.setHold(hold(t));
    run.step(1 / 60);
    out.push(...run.events);
    run.events.length = 0;
  }
  return out;
}

describe("the hold", () => {
  it("swings the cart into the bend ahead, whichever way it goes, and keeps that way for the press", () => {
    let lefts = 0;
    let rights = 0;
    for (let seed = 1; seed < 30; seed++) {
      const run = new Run(seed);
      const g = firstBend(run, GATE_M + 10);
      place(run, g.s0 - 6);
      const a0 = run.a;
      run.setHold(true);
      const dir = Math.sign(g.k);
      expect(run.dir).toBe(dir);
      expect(run.holdK).toBeCloseTo(holdCurvature(g.k), 9);
      drive(run, 0.5, () => true);
      expect(Math.sign(run.kappa)).toBe(dir);
      expect(Math.sign(wrap(run.a - a0))).toBe(dir);
      expect(run.dir).toBe(dir);
      if (dir > 0) lefts++;
      else rights++;
    }
    expect(lefts).toBeGreaterThan(3);
    expect(rights).toBeGreaterThan(3);
  });

  it("turns a little tighter than the bend it swings into, never past the cap", () => {
    for (const k of [0.022, 0.03, 0.05, 0.08, 1 / 11.5]) {
      expect(holdCurvature(k)).toBeGreaterThan(k);
      expect(holdCurvature(-k)).toBe(holdCurvature(k));
      expect(holdCurvature(k)).toBeLessThanOrEqual(K_HOLD);
    }
    // The tightest bend the road makes still leaves room to catch up.
    expect(K_HOLD).toBeGreaterThan((1 / 11.5) * 1.3);
  });

  it("held through a bend from the middle, tucks the cart toward its inside", () => {
    for (let seed = 3; seed < 15; seed++) {
      const run = new Run(seed);
      const g = firstBend(run, GATE_M + 10);
      place(run, g.s0 - 2);
      const dir = Math.sign(g.k);
      let inside = -Infinity;
      for (let t = 0; t < 3 && run.s < g.s0 + g.len * 0.6 && run.phase === "drive"; t += 1 / 60) {
        run.setHold(dir * run.d < HALF - CAR_HALF_W - 0.3);
        run.step(1 / 60);
        run.events.length = 0;
        inside = Math.max(inside, dir * run.d);
      }
      expect(inside, `seed ${seed}`).toBeGreaterThan(1.5);
    }
  });

  it("let go, straightens a cart turned toward the next bend; pressing straightens one turned away from it", () => {
    for (const mag of [0.2, 0.35]) {
      for (const sign of [1, -1]) {
        const run = new Run(9);
        // A long straight: the gate's.
        run.course.ensure(GATE_M + 200);
        place(run, GATE_M - 22, 0, 0);
        const into = run.course.bendAhead(run.s, 4);
        run.a += sign * into * mag;
        // Turned toward the bend ahead: let go. Turned away: hold until square, then let go.
        drive(run, 1.6, () => sign < 0 && wrap(run.course.pose(run.s).a - run.a) * into > 0.02);
        const p = run.course.pose(run.s);
        expect(Math.abs(wrap(p.a - run.a)), `${sign} ${mag}`).toBeLessThan(0.06);
        expect(Math.abs(run.d), `${sign} ${mag}`).toBeLessThan(HALF);
        expect(run.stats.scrapes).toBe(0);
      }
    }
  });

  it("follows the warm-up's easy sweeps with no input at all", () => {
    for (let seed = 1; seed < 40; seed++) {
      const run = new Run(seed * 7);
      const ev = drive(run, 30);
      expect(run.s).toBeGreaterThan(WARM_M);
      expect(ev.filter((e) => e.k === "verge" && run.s < WARM_M)).toEqual([]);
      void ev;
    }
  });
});

describe("lines and the streak", () => {
  it("grades by the gap to the inner edge", () => {
    expect(gradeFor(-0.3)).toBe("paint");
    expect(gradeFor(GAPS.paint)).toBe("paint");
    expect(gradeFor(GAPS.paint + 0.01)).toBe("kissed");
    expect(gradeFor(GAPS.kissed + 0.01)).toBe("tight");
    expect(gradeFor(GAPS.tight + 0.01)).toBe("clean");
    expect(gradeFor(GAPS.clean + 0.01)).toBe("wide");
    expect(GRADE_POINTS.paint).toBeGreaterThan(GRADE_POINTS.kissed);
    expect(GRADE_POINTS.kissed).toBeGreaterThan(GRADE_POINTS.tight);
    expect(GRADE_POINTS.tight).toBeGreaterThan(GRADE_POINTS.clean);
    expect(GRADE_POINTS.wide).toBe(0);
  });

  it("climbs ×2 … ×5 at the tier streaks", () => {
    expect([0, 1].map(multFor)).toEqual([1, 1]);
    TIERS.forEach((t, i) => {
      expect(multFor(t)).toBe(i + 2);
      expect(multFor(t - 1)).toBe(i + 1);
    });
    expect(multFor(100)).toBe(5);
  });

  it("pays every clean line times the multiplier, counts the streak, and a wide line or the gravel ends it", () => {
    let sawTier = false;
    let sawLost = false;
    for (let seed = 1; seed < 12; seed++) {
      const run = new Run(seed * 31);
      const pilot = new Pilot(DEMO, createRng(seed));
      let streak = 0;
      for (let t = 0; t < 120 && run.phase === "drive"; t += 1 / 60) {
        pilot.step(run, 1 / 60);
        run.step(1 / 60);
        for (const e of run.events) {
          if (e.k === "grade") {
            if (e.grade === "wide") {
              streak = 0;
              expect(e.points).toBe(0);
            } else if (e.grade === "scraped") streak = 0;
            else {
              streak++;
              expect(e.streak).toBe(streak);
              expect(e.mult).toBe(multFor(streak));
              expect(e.points).toBe(GRADE_POINTS[e.grade] * multFor(streak));
            }
          }
          if (e.k === "verge") streak = 0;
          if (e.k === "save") streak = 0;
          if (e.k === "tier") {
            sawTier = true;
            expect(TIERS).toContain(streak);
          }
          if (e.k === "lost") sawLost = true;
        }
        run.events.length = 0;
        expect(run.streak).toBe(streak);
      }
    }
    expect(sawTier).toBe(true);
    expect(sawLost).toBe(true);
  });

  it("builds drift while holding hard into a bend and banks it on letting go", () => {
    const run = new Run(21);
    const g = firstBend(run, GATE_M + 10);
    place(run, g.s0 - 1);
    run.streak = 5;
    const ev = drive(run, 0.8, (t) => t < 0.6);
    const bank = ev.find((e) => e.k === "bank");
    expect(bank).toBeDefined();
    if (bank && bank.k === "bank") {
      expect(bank.metres).toBeGreaterThan(4);
      expect(bank.points).toBeGreaterThan(0);
      expect(bank.points % run.mult).toBe(0);
      expect(bank.points).toBeLessThanOrEqual(Math.ceil(bank.metres * DRIFT_PTS) * run.mult + run.mult);
    }
  });

  it("spills the drift if the cart hits the gravel while holding", () => {
    const run = new Run(23);
    const g = firstBend(run, GATE_M + 10);
    const dir = Math.sign(g.k);
    place(run, g.s0 + 1, dir * (HALF - 1.2), dir * 0.25);
    const ev = drive(run, 1.2, () => true);
    expect(ev.some((e) => e.k === "verge")).toBe(true);
    const verge = ev.findIndex((e) => e.k === "verge");
    expect(ev.slice(verge).some((e) => e.k === "bank")).toBe(false);
  });
});

describe("the edges", () => {
  it("the gravel slows the cart, counts a scrape and ends the streak", () => {
    const run = new Run(4);
    run.course.ensure(GATE_M + 200);
    place(run, GATE_M - 25, HALF - 0.3, 0.12);
    run.streak = 6;
    const v0 = run.v;
    const ev = drive(run, 0.4);
    expect(ev.filter((e) => e.k === "verge")).toHaveLength(1);
    expect(ev.some((e) => e.k === "lost" && e.streak === 6)).toBe(true);
    expect(run.streak).toBe(0);
    expect(run.v).toBeLessThan(v0 * 0.9);
    expect(run.stats.scrapes).toBe(1);
  });

  it("off the road without a crate, the run is over; with one, the crate goes and the cart bumps back on", () => {
    for (const side of [-1, 1]) {
      const a = new Run(8);
      a.course.ensure(GATE_M + 200);
      place(a, GATE_M - 25, side * (OFF - 0.5), side * 0.5);
      const ev = drive(a, 1);
      expect(ev.some((e) => e.k === "crash" && e.side === side)).toBe(true);
      expect(a.phase).toBe("crashed");
      expect(a.stats.end).not.toBeNull();

      const b = new Run(8);
      b.course.ensure(GATE_M + 200);
      place(b, GATE_M - 25, side * (OFF - 0.5), side * 0.5);
      b.crates = 1;
      const ev2 = drive(b, 0.3);
      expect(ev2.some((e) => e.k === "save" && e.side === side)).toBe(true);
      expect(b.crates).toBe(0);
      expect(b.phase).toBe("drive");
      expect(Math.abs(b.d)).toBeLessThanOrEqual(HALF);
      expect(b.stats.saves).toBe(1);
    }
  });

  it("knows how a cart left the road: off the outside of a bend (wide) or over its inside (held too long)", () => {
    const run = new Run(12);
    const g = firstBend(run, GATE_M + 10);
    const dir = Math.sign(g.k);
    place(run, g.s0 + g.len * 0.4, -dir * (OFF - 0.3), -dir * 0.4);
    drive(run, 1);
    expect(run.stats.end).toBe("wide");
    const r2 = new Run(12);
    const g2 = firstBend(r2, GATE_M + 10);
    place(r2, g2.s0 + g2.len * 0.4, dir * (OFF - 0.3), dir * 0.4);
    drive(r2, 1, () => true);
    expect(r2.stats.end).toBe("inside");
  });
});

describe("the run", () => {
  it("pays a point a metre", () => {
    const run = new Run(3);
    drive(run, 8);
    expect(run.s).toBeLessThan(WARM_M);
    expect(run.score).toBe(run.metres);
  });

  it("grows the speed along the road", () => {
    let last = 0;
    for (let s = 0; s <= 3000; s += 100) {
      expect(vTarget(s)).toBeGreaterThan(last);
      last = vTarget(s);
    }
    expect(vTarget(0)).toBeGreaterThan(12);
    expect(vTarget(2000)).toBeGreaterThan(vTarget(0) * 1.6);
  });

  it("loads a crate at a gate only for a cart that drove a clean line since the last one", () => {
    let gates = 0;
    let loaded = 0;
    for (let seed = 1; seed <= 16; seed++) {
      const run = new Run(seed * 53);
      // Half the runs with a tidy driver, half idle.
      const pilot = seed % 2 ? new Pilot(DEMO, createRng(seed)) : null;
      let clean = false;
      for (let t = 0; t < 90 && run.phase === "drive"; t += 1 / 60) {
        const before = run.crates;
        pilot?.step(run, 1 / 60);
        run.step(1 / 60);
        for (const e of run.events) {
          if (e.k === "grade" && e.grade !== "wide" && e.grade !== "scraped") clean = true;
          if (e.k === "gate") {
            gates++;
            expect(e.crate, `seed ${seed} gate ${e.n}`).toBe(clean && before < 1);
            if (e.crate) loaded++;
            clean = false;
          }
        }
        run.events.length = 0;
      }
    }
    expect(gates).toBeGreaterThan(10);
    expect(loaded).toBeGreaterThan(2);
  });

  it("picks up a lemon on the line it lies on", () => {
    const run = new Run(61);
    run.course.ensure(2000);
    const l = run.course.lemons.find((x) => x.s > GATE_M)!;
    place(run, l.s - 4, l.d);
    run.streak = 2;
    const ev = drive(run, 0.6, () => false);
    const hit = ev.find((e) => e.k === "lemon");
    expect(hit && hit.k === "lemon" && hit.points).toBe(25 * 2);
    expect(run.stats.lemons).toBe(1);
  });

  it("is deterministic for a seed and an input, and the same at 30, 60 and 120 frames a second", () => {
    // The hold flips on tenths of a second, so every frame rate sees the same input.
    const go = (fps: number) => {
      const run = new Run(1234);
      for (let f = 0; f < 30 * fps && run.phase === "drive"; f++) {
        const t = f / fps;
        run.setHold(Math.floor(t * 10 + 1e-6) % 7 < 2 && Math.floor(t * 10 + 1e-6) >= 120);
        run.step(1 / fps);
        run.events.length = 0;
      }
      return run;
    };
    const a = go(60);
    const b = go(60);
    expect([a.x, a.y, a.score]).toEqual([b.x, b.y, b.score]);
    for (const fps of [30, 120]) {
      const c = go(fps);
      expect(Math.hypot(a.x - c.x, a.y - c.y), `${fps} fps`).toBeLessThan(0.01);
    }
    // Uneven frames (50 Hz: 1/150 s substeps) stay close too.
    const e = go(50);
    expect(Math.hypot(a.x - e.x, a.y - e.y)).toBeLessThan(0.5);
  });

  it("ends an idle run on its own, inside the reviewer's patience", () => {
    const times: number[] = [];
    for (let seed = 1; seed <= 24; seed++) {
      const run = new Run(seed * 977);
      drive(run, 90);
      expect(run.phase, `seed ${seed}`).toBe("crashed");
      expect(run.time, `seed ${seed}`).toBeGreaterThan(18);
      expect(run.time, `seed ${seed}`).toBeLessThan(60);
      times.push(run.time);
    }
    times.sort((x, y) => x - y);
    expect(times[12]).toBeLessThan(36);
  });
});
