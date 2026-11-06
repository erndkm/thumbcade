import { createRng } from "@thumbcade-games/kit/rng";
import { describe, expect, it } from "vitest";
import { flickPath, SKILLS } from "../src/pilot.ts";
import { playRun } from "../src/runs.ts";
import {
  aimFor,
  assist,
  BALL_R,
  curlOf,
  difficulty,
  distanceOf,
  flickFor,
  flyStep,
  FRAME_STRIDE,
  GOAL_H,
  GOAL_HW,
  KEEPER_Y,
  MAX_BALLS,
  multFor,
  newFrames,
  project,
  readFlick,
  RINGS,
  Run,
  setupFor,
  simulateShot,
  solveKick,
  START_BALLS,
  viewFor,
  type Ball,
  type Setup,
  type Shot,
} from "../src/sim.ts";

const frames = newFrames();

/** An open goal: no wall, a keeper who never gets there. */
function open(spot = { x: 0, z: 20 }): Setup {
  return {
    n: 5,
    spot,
    wall: [],
    wallJump: 0,
    keeper: { react: 9, speed: 0, accel: 0, err: 0, reach: 0.5 },
    // Far outside the posts: he never moves.
    keeperX: 30,
    errX: 0,
    errY: 0,
    wind: 0,
    rings: RINGS,
  };
}

function crossing(shot: Shot) {
  expect(shot.cross).not.toBeNull();
  return shot.cross!;
}

/** Keeper hands x over the frames. */
function keeperXs(shot: Shot): number[] {
  const xs: number[] = [];
  for (let i = 0; i < shot.count; i++) xs.push(shot.frames[i * FRAME_STRIDE + 4]!);
  return xs;
}

describe("ball flight", () => {
  it("falls under gravity and slows with drag", () => {
    const b: Ball = { x: 0, y: 0, z: 0, vx: 0, vy: 10, vz: -25, wx: 0, wy: 0, wz: 0 };
    for (let i = 0; i < 240; i++) flyStep(b, 1 / 240, 0);
    // One second: a vacuum would give y = 10 - 4.9 = 5.1 and z = -25; drag takes a little off both.
    expect(b.y).toBeLessThan(5.1);
    expect(b.y).toBeGreaterThan(4);
    expect(b.z).toBeGreaterThan(-25);
    expect(b.z).toBeLessThan(-21);
    expect(b.x).toBe(0);
  });

  it("side spin bends the ball the way the curl says", () => {
    const right = solveKick({ x: 0, z: 22 }, { x: 0, y: 1.5 }, 26, 1);
    const left = solveKick({ x: 0, z: 22 }, { x: 0, y: 1.5 }, 26, -1);
    // To land on the same spot, a right-bending ball sets off to the left, and the other way round.
    expect(right.vx).toBeLessThan(-0.5);
    expect(left.vx).toBeGreaterThan(0.5);
    const s = simulateShot(open({ x: 0, z: 22 }), right, frames);
    expect(Math.abs(crossing(s).x)).toBeLessThan(0.08);
    expect(s.bend).toBeGreaterThan(1);
  });

  it("a full curl from 25 m bends a couple of metres, not across the goal", () => {
    const s = simulateShot(open({ x: 0, z: 25 }), solveKick({ x: 0, z: 25 }, { x: 0, y: 1.5 }, 26, 1), frames);
    expect(s.bend).toBeGreaterThan(1.5);
    expect(s.bend).toBeLessThan(3.5);
  });

  it("the solver hits what it aims at, curled or not", () => {
    for (const target of [
      { x: -3, y: 2 },
      { x: 3, y: 0.4 },
      { x: 0, y: 1.2 },
    ])
      for (const speed of [18, 24, 30])
        for (const curl of [-1, 0, 0.6]) {
          const spot = { x: 4, z: 21 };
          const c = crossing(simulateShot(open(spot), solveKick(spot, target, speed, curl), frames));
          expect(Math.hypot(c.x - target.x, c.y - target.y)).toBeLessThan(0.06);
        }
  });

  it("wind is the player's job: it pushes the ball off the aim point", () => {
    const s = { ...open(), wind: 2 };
    const c = crossing(simulateShot(s, solveKick(s.spot, { x: 0, y: 1.2 }, 25, 0), frames));
    expect(c.x).toBeGreaterThan(0.4);
  });

  it("harder strikes dip: they leave the boot steeper than the straight line needs", () => {
    const soft = solveKick({ x: 0, z: 20 }, { x: 0, y: 2 }, 17, 0);
    const hard = solveKick({ x: 0, z: 20 }, { x: 0, y: 2 }, 31, 0);
    expect(soft.wx).toBeLessThan(0);
    expect(hard.wx).toBeLessThan(soft.wx);
  });
});

describe("reading the flick", () => {
  const up = (n: number, len: number, ms: number, bow = 0) => {
    const out: Array<{ x: number; y: number; t: number }> = [];
    flickPath({ kind: "kick", dx: 0, dy: -len, speed: (len / ms) * 1000, bow }, 200, 700, out, n);
    return out;
  };

  it("a straight upward flick is a kick with no bow", () => {
    const f = readFlick(up(12, 260, 160));
    expect(f.kind).toBe("kick");
    expect(Math.abs(f.bow)).toBeLessThan(0.01);
    expect(f.speed).toBeGreaterThan(1400);
    expect(curlOf(f.bow)).toBe(0);
  });

  it("a bowed path reads back as its bow, and a right bulge curls the ball left", () => {
    const f = readFlick(up(16, 260, 160, 0.12));
    expect(f.bow).toBeCloseTo(0.12, 1);
    expect(curlOf(f.bow)).toBeLessThan(-0.4);
    expect(curlOf(-f.bow)).toBeGreaterThan(0.4);
  });

  it("a lazy or short flick only dribbles, and taps, sideways and downward swipes are not kicks", () => {
    expect(readFlick(up(10, 200, 900)).kind).toBe("soft");
    expect(readFlick(up(6, 50, 90)).kind).toBe("soft");
    expect(readFlick(up(4, 12, 80)).kind).toBe("none");
    expect(
      readFlick([
        { x: 100, y: 500, t: 0 },
        { x: 300, y: 480, t: 120 },
      ]).kind,
    ).toBe("none");
    expect(
      readFlick([
        { x: 100, y: 300, t: 0 },
        { x: 110, y: 520, t: 120 },
      ]).kind,
    ).toBe("none");
  });

  it("ignores a thumb resting on the ball before it flicks", () => {
    const rest = [
      { x: 200, y: 700, t: 0 },
      { x: 201, y: 701, t: 400 },
    ];
    const move = up(10, 260, 150).map((p) => ({ ...p, t: p.t + 420 }));
    const f = readFlick([...rest, ...move]);
    expect(f.kind).toBe("kick");
    expect(f.speed).toBeGreaterThan(1400);
  });

  it("aiming round-trips: the flick the pilot makes lands where it meant", () => {
    const spot = { x: -3, z: 21 };
    const v = viewFor(spot, 390, 788);
    for (const target of [
      { x: 2.2, y: 1.6 },
      { x: -1.5, y: 0.7 },
    ]) {
      const f = flickFor(v, spot, target, 24, 0.5);
      const a = aimFor(v, spot, f, []);
      expect(Math.abs(a.x - target.x)).toBeLessThan(0.3);
      expect(Math.abs(a.y - target.y)).toBeLessThan(0.05);
      expect(a.curl).toBeCloseTo(0.5, 1);
      expect(a.speed).toBeCloseTo(24, 0);
    }
  });

  it("a longer flick aims higher; the screen and the world agree on where the ball is", () => {
    const spot = { x: 0, z: 18 };
    const v = viewFor(spot, 390, 788);
    const short = aimFor(v, spot, { kind: "kick", dx: 0, dy: -150, speed: 1500, bow: 0 }, []);
    const long = aimFor(v, spot, { kind: "kick", dx: 0, dy: -320, speed: 1500, bow: 0 }, []);
    expect(long.y).toBeGreaterThan(short.y + 1);
    const b = project(v, { x: 0, y: BALL_R, z: 18 });
    expect(b.x).toBeCloseTo(195, 0);
    expect(b.y).toBeGreaterThan(788 * 0.75);
    expect(b.y).toBeLessThan(788 * 0.95);
  });
});

describe("aim assist", () => {
  it("pulls a near miss inside the post and under the bar, but leaves a wild one alone", () => {
    const near = assist(GOAL_HW + 0.3, 1.2, []);
    expect(near.x).toBeLessThan(GOAL_HW);
    const high = assist(0, GOAL_H + 0.3, []);
    expect(high.y).toBeLessThan(GOAL_H);
    const wild = assist(GOAL_HW + 3, 1.2, []);
    expect(wild.x).toBeCloseTo(GOAL_HW + 3, 5);
  });

  it("draws a flick near a corner ring toward its centre", () => {
    const r = RINGS[1]!;
    const a = assist(r.x - 0.5, r.y - 0.3, RINGS);
    expect(Math.hypot(a.x - r.x, a.y - r.y)).toBeLessThan(Math.hypot(0.5, 0.3) * 0.85);
  });
});

describe("keeper", () => {
  const keeper = (over: Partial<Setup["keeper"]> = {}): Setup => ({
    ...open({ x: 0, z: 20 }),
    keeperX: 0,
    keeper: { react: 0.3, speed: 4, accel: 22, err: 0, reach: 0.55, ...over },
  });

  it("does nothing before his reaction time", () => {
    const s = keeper({ react: 0.4 });
    const shot = simulateShot(s, solveKick(s.spot, { x: 3, y: 1.8 }, 24, 0), frames);
    const xs = keeperXs(shot);
    const before = xs.slice(0, Math.floor(0.38 * 120));
    expect(before.every((x) => x === 0)).toBe(true);
    expect(Math.max(...xs.map(Math.abs))).toBeGreaterThan(0.5);
  });

  it("saves a soft shot near him", () => {
    const s = keeper();
    const shot = simulateShot(s, solveKick(s.spot, { x: 0.8, y: 1.1 }, 18, 0), frames);
    expect(shot.outcome).toBe("saved");
  });

  it("can't reach a hard shot into the top corner", () => {
    const s = keeper();
    const shot = simulateShot(s, solveKick(s.spot, { x: -3.1, y: 2.0 }, 30, 0), frames);
    expect(shot.outcome).toBe("goal");
  });

  it("reads the flight, not the future: a curler leaves him further from the ball than a straight shot", () => {
    const s = keeper();
    const target = { x: 1.2, y: 1.0 };
    const gap = (curl: number) => {
      const shot = simulateShot(s, solveKick(s.spot, target, 24, curl), frames, { exact: true });
      // Ball to gloves as the ball reaches the keeper's plane.
      for (let i = 0; i < shot.count; i++) {
        const o = i * FRAME_STRIDE;
        if (shot.frames[o + 3]! <= 0.32) return Math.hypot(shot.frames[o + 1]! - shot.frames[o + 4]!, shot.frames[o + 2]! - shot.frames[o + 5]!);
      }
      return 0;
    };
    const straight = gap(0);
    expect(gap(1)).toBeGreaterThan(straight + 0.08);
    expect(gap(-1)).toBeGreaterThan(straight + 0.08);
  });

  it("his misread is part of the setup, so a replayed kick plays out the same", () => {
    const s = setupFor(9, createRng(42));
    const l = solveKick(s.spot, { x: 2.5, y: 1.9 }, 27, 0.4);
    const a = simulateShot(s, l, newFrames());
    const b = simulateShot(s, l, newFrames());
    expect(a.outcome).toBe(b.outcome);
    expect(a.count).toBe(b.count);
    expect(Array.from(a.frames.subarray(0, a.count * FRAME_STRIDE))).toEqual(Array.from(b.frames.subarray(0, b.count * FRAME_STRIDE)));
  });

  it("starts at his set position and stays in the goal mouth", () => {
    const s = setupFor(12, createRng(3));
    const shot = simulateShot(s, solveKick(s.spot, { x: -3, y: 1.9 }, 25, 0), frames);
    expect(shot.frames[5]).toBeCloseTo(KEEPER_Y, 5);
    for (const x of keeperXs(shot)) expect(Math.abs(x)).toBeLessThan(GOAL_HW + 0.3);
  });
});

describe("wall and woodwork", () => {
  it("a low hard shot through the wall is blocked", () => {
    const s = setupFor(6, createRng(7));
    const m = s.wall[Math.floor(s.wall.length / 2)]!;
    // Aim straight through the middle mannequin at knee height.
    const k = -s.spot.z / (m.y - s.spot.z);
    const aimX = s.spot.x + (m.x - s.spot.x) * k;
    const shot = simulateShot(s, solveKick(s.spot, { x: aimX, y: 0.2 }, 30, 0), frames);
    expect(shot.outcome).toBe("blocked");
    expect(shot.events[0]!.kind).toBe("wall");
  });

  it("the wall stands 9.15 m out", () => {
    const s = setupFor(5, createRng(2));
    for (const m of s.wall) expect(Math.hypot(m.x - s.spot.x, m.y - s.spot.z)).toBeCloseTo(9.15, 0);
  });

  it("a shot at the post rattles it, and gets a slow-motion beat", () => {
    const s = open();
    const shot = simulateShot(s, solveKick(s.spot, { x: GOAL_HW, y: 1.2 }, 26, 0), frames);
    expect(shot.events.some((e) => e.kind === "post")).toBe(true);
    expect(shot.slow.length).toBeGreaterThan(0);
  });

  it("a goal through a ring counts as a corner", () => {
    const s = open();
    const r = RINGS[0]!;
    const shot = simulateShot(s, solveKick(s.spot, { x: r.x, y: r.y }, 27, 0), frames);
    expect(shot.outcome).toBe("goal");
    expect(shot.corner).toBe(0);
  });
});

describe("the run", () => {
  const goal = (corner = -1, extra: Partial<Shot> = {}): Shot => ({ ...simulateShot(open(), solveKick({ x: 0, z: 20 }, { x: 0, y: 1 }, 24, 0), newFrames()), corner, ...extra });
  const miss = (outcome: Shot["outcome"]): Shot => ({ ...goal(), outcome });

  it("the first two kicks are free: missing them costs nothing", () => {
    const r = new Run();
    r.take();
    r.settle(miss("saved"), 20);
    r.take();
    r.settle(miss("wide"), 20);
    expect(r.balls).toBe(START_BALLS);
    r.take();
    r.settle(miss("over"), 20);
    expect(r.balls).toBe(START_BALLS - 1);
  });

  it("a goal gives the ball back, a corner gives two back (never past the cap), a miss loses it", () => {
    const r = new Run();
    r.take();
    r.take();
    r.settle(goal(), 20);
    r.take();
    r.settle(miss("blocked"), 20);
    expect(r.balls).toBe(START_BALLS - 1);
    r.take();
    const a = r.settle(goal(1), 20);
    expect(a.refund).toBe(2);
    expect(a.tags).toContain("TOP CORNER");
    expect(r.balls).toBe(Math.min(MAX_BALLS, START_BALLS));
    r.take();
    r.settle(goal(0), 20);
    expect(r.balls).toBeLessThanOrEqual(MAX_BALLS);
  });

  it("ends when the bag is empty", () => {
    const r = new Run();
    r.kicks = 5;
    for (let i = 0; i < START_BALLS; i++) {
      r.take();
      r.settle(miss("saved"), 20);
    }
    expect(r.over).toBe(true);
  });

  it("goals in a row multiply, and a miss resets the streak", () => {
    expect([1, 2, 3, 5, 6, 9, 10, 20].map(multFor)).toEqual([1, 1, 2, 2, 3, 3, 4, 4]);
    const r = new Run();
    let last = 0;
    for (let i = 0; i < 6; i++) {
      r.take();
      last = r.settle(goal(), 16).points;
    }
    expect(r.mult).toBe(3);
    expect(last).toBe(100 * 3);
    r.take();
    r.settle(miss("saved"), 20);
    expect(r.streak).toBe(0);
    expect(r.bestStreak).toBe(6);
  });

  it("prices the extras and remembers the best goal", () => {
    const r = new Run();
    r.take();
    const a = r.settle(goal(1, { bend: 1.4, postIn: true, tip: true, speed: 29 }), 26);
    expect(a.tags).toEqual(["TOP CORNER", "CURLER", "POST AND IN", "FINGERTIPS", "SCREAMER", "LONG RANGE"]);
    expect(a.points).toBe(100 + 60 + 150 + 60 + 75 + 50 + 40);
    expect(r.best?.points).toBe(a.points);
  });

  it("gives one concrete hint from what went wrong most", () => {
    const r = new Run();
    r.kicks = 3;
    for (const o of ["blocked", "blocked", "saved"] as const) {
      r.take();
      r.settle(miss(o), 20);
    }
    expect(r.hint()).toMatch(/OVER THE WALL/);
  });
});

describe("difficulty", () => {
  it("ramps from an open goal to walls, distance, a sharper keeper and wind", () => {
    const rng = createRng(1);
    const s0 = setupFor(0, rng);
    expect(s0.wall).toHaveLength(0);
    expect(s0.wind).toBe(0);
    expect(difficulty(2)).toBe(0);
    expect(difficulty(13)).toBe(1);
    const early = setupFor(3, createRng(5));
    const late = setupFor(16, createRng(5));
    expect(late.wall.length).toBeGreaterThanOrEqual(early.wall.length);
    expect(late.keeper.react).toBeLessThan(early.keeper.react);
    expect(late.keeper.speed).toBeGreaterThan(early.keeper.speed);
    expect(Math.abs(late.wind)).toBeGreaterThan(0);
    expect(late.wallJump).toBeGreaterThan(0);
  });

  it("every kick is taken from outside the box", () => {
    for (let n = 0; n < 40; n++) for (let seed = 0; seed < 10; seed++) expect(setupFor(n, createRng(seed * 31 + n)).spot.z).toBeGreaterThan(16.6);
  });

  it("every setup can be scored, all the way down the run", () => {
    const xs: number[] = [];
    for (let i = 0; i <= 10; i++) xs.push(-GOAL_HW + 0.35 + (i / 10) * (GOAL_HW * 2 - 0.7));
    for (const n of [0, 6, 14, 24, 36])
      for (let seed = 0; seed < 4; seed++) {
        const s = setupFor(n, createRng(seed * 7717 + n * 13));
        let found = false;
        for (const x of xs)
          for (const y of [0.3, 0.9, 1.5, 2.05])
            for (const v of [20.5, 24, 27.5, 31])
              for (const c of [-1, -0.5, 0, 0.5, 1]) {
                if (found) break;
                found = simulateShot(s, solveKick(s.spot, { x, y }, v, c), frames).outcome === "goal";
              }
        expect(found, `kick ${n}, seed ${seed} at ${distanceOf(s).toFixed(1)} m`).toBe(true);
      }
  });
});

describe("run lengths (headless pilot)", () => {
  const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
  it("lands in the 20-90 s window from novice to good, and the opening is hard to lose", () => {
    for (const skill of [SKILLS.novice, SKILLS.casual, SKILLS.good]) {
      const runs = Array.from({ length: 40 }, (_, i) => playRun(skill, createRng(900 + i * 7919)));
      const m = median(runs.map((r) => r.seconds));
      expect(m, skill.name).toBeGreaterThan(20);
      expect(m, skill.name).toBeLessThan(90);
      expect(runs.filter((r) => r.lostBy10s).length).toBe(0);
    }
  });
});
