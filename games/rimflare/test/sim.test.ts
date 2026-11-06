import { createRng } from "@thumbcade-games/kit/rng";
import { describe, expect, it } from "vitest";
import { pilotFlick, SKILLS } from "../src/pilot.ts";
import { FIRST_BALL_T, motionFor, playRun } from "../src/runs.ts";
import {
  aimFor,
  assistCurve,
  BALL_SCREEN,
  BALL_Y,
  drainAt,
  flickFor,
  FRENZY_T,
  hoopX,
  launchFor,
  MAX_CLOCK,
  multFor,
  newFrames,
  project,
  readFlick,
  RIM_R,
  RIM_SCREEN,
  RIM_Y,
  Run,
  simulateShot,
  stageFor,
  START_CLOCK,
  STILL,
  viewFor,
  type Sample,
  type Shot,
} from "../src/sim.ts";

const frames = newFrames();

function path(dx: number, dy: number, ms: number, n = 12, x0 = 195, y0 = 630): Sample[] {
  return Array.from({ length: n }, (_, i) => {
    const u = i / (n - 1);
    return { x: x0 + dx * u, y: y0 + dy * u, t: ms * u };
  });
}

/** A ball launched at a point on the rim's plane (relative to the rim centre), from stage n's spot. */
function shotAt(n: number, dx: number, dz: number): Shot {
  const st = stageFor(n);
  return simulateShot(st.spot, launchFor(st.spot, { x: dx, y: RIM_Y, z: dz }), STILL, 0, frames);
}

describe("camera", () => {
  it("puts the ball and the rim where the HUD expects them, at every stage and screen shape", () => {
    for (const n of [0, 1, 4, 9]) {
      for (const [w, h] of [
        [390, 788],
        [430, 860],
        [360, 640],
      ] as const) {
        const st = stageFor(n);
        const v = viewFor(st.spot, w, h);
        const b = project(v, { x: st.spot.x, y: BALL_Y, z: st.spot.z });
        const r = project(v, { x: 0, y: RIM_Y, z: 0 });
        expect(b.y / h).toBeCloseTo(BALL_SCREEN, 2);
        expect(r.y / h).toBeCloseTo(RIM_SCREEN, 2);
        expect(Math.abs(b.x - w / 2)).toBeLessThan(1);
        expect(Math.abs(r.x - w / 2)).toBeLessThan(1);
      }
    }
  });
});

describe("reading a flick", () => {
  it("an upward flick is a shot; down, sideways and tiny ones are not", () => {
    expect(readFlick(path(0, -220, 130)).kind).toBe("shot");
    expect(readFlick(path(40, -200, 140)).kind).toBe("shot");
    expect(readFlick(path(0, 220, 130)).kind).toBe("none");
    expect(readFlick(path(220, -40, 130)).kind).toBe("none");
    expect(readFlick(path(0, -12, 60)).kind).toBe("none");
  });

  it("a short or slow push is soft (it doesn't leave your hands)", () => {
    expect(readFlick(path(0, -45, 120)).kind).toBe("soft");
    expect(readFlick(path(0, -120, 900)).kind).toBe("soft");
  });

  it("a thumb resting on the ball before it moves doesn't slow the flick down", () => {
    const rest: Sample[] = [
      { x: 195, y: 630, t: 0 },
      { x: 195, y: 631, t: 300 },
      ...path(0, -220, 130).map((p) => ({ ...p, t: p.t + 320 })),
    ];
    expect(readFlick(rest).speed).toBeGreaterThan(1200);
  });
});

describe("aim assist", () => {
  it("shrinks errors inside the window, fades out beyond it, and never reverses order", () => {
    expect(assistCurve(0.2, 0.5, 0.8)).toBeCloseTo(0.04, 5);
    expect(assistCurve(-0.2, 0.5, 0.8)).toBeCloseTo(-0.04, 5);
    expect(assistCurve(1.2, 0.5, 0.8)).toBeCloseTo(1.2, 5);
    let prev = -Infinity;
    for (let e = -1.5; e <= 1.5; e += 0.01) {
      const v = assistCurve(e, 0.5, 0.8);
      expect(v).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = v;
    }
  });

  it("a flick straight at the rim with the right length lands dead centre", () => {
    for (const n of [0, 1, 3, 5]) {
      const st = stageFor(n);
      const v = viewFor(st.spot, 390, 788);
      const f = flickFor(v, st, STILL, 0, 0, st.dist, 1600);
      const a = aimFor(v, st, STILL, 0, f);
      expect(Math.hypot(a.target.x, a.target.z)).toBeLessThan(0.03);
    }
  });

  it("on a moving hoop, flicking at where it is now and leading it properly both count early on", () => {
    const st = stageFor(2);
    const m = motionFor(st, 0);
    const v = viewFor(st.spot, 390, 788);
    const t0 = 1.9; // mid-slide, moving fast
    const naive = aimFor(v, st, m, t0, flickFor(v, st, m, t0, hoopX(m, t0), st.dist, 1600));
    const lead = aimFor(v, st, m, t0, flickFor(v, st, m, t0, hoopX(m, t0 + naive.flight), st.dist, 1600));
    for (const a of [naive, lead]) {
      const arrive = hoopX(m, t0 + a.flight);
      // Leading isn't punished; the naive throw keeps most of the forgiveness.
      expect(Math.abs(a.target.x - arrive)).toBeLessThan(0.12);
    }
  });

  it("assist tightens as the stages go on", () => {
    for (let n = 1; n < 12; n++) {
      expect(stageFor(n).assist).toBeLessThanOrEqual(stageFor(n - 1).assist + (n === 1 ? 0.1 : 0));
      expect(stageFor(n).winD).toBeLessThanOrEqual(stageFor(n - 1).winD);
    }
  });
});

describe("a shot", () => {
  it("dead centre is a swish from every stage", () => {
    for (let n = 0; n < 10; n++) {
      const s = shotAt(n, 0, 0);
      expect(s.outcome, `stage ${n + 1}`).toBe("swish");
      expect(s.rimHits).toBe(0);
      expect(s.scoredAt).toBeGreaterThan(0.8);
      expect(s.scoredAt).toBeLessThan(1.6);
    }
  });

  it("near misses touch iron; far misses are short, long or wide", () => {
    expect(shotAt(0, 0, 0.7).outcome).toBe("miss");
    expect(shotAt(0, 0, 0.7).miss).toBe("short");
    expect(shotAt(0, 0.8, 0).miss).toBe("wide");
    const rim = shotAt(0, 0, 0.19);
    expect(rim.rimHits).toBeGreaterThan(0);
  });

  it("a long shot that hits the glass can drop: bank shots exist", () => {
    let banks = 0;
    for (let dz = -0.6; dz <= -0.1; dz += 0.01) for (let dx = -0.3; dx <= 0.3; dx += 0.05) if (shotAt(1, dx, dz).outcome === "bank") banks++;
    expect(banks).toBeGreaterThan(3);
  });

  it("is deterministic", () => {
    const a = shotAt(3, 0.11, 0.05);
    const b = shotAt(3, 0.11, 0.05);
    expect(a.outcome).toBe(b.outcome);
    expect(a.decided).toBe(b.decided);
    expect(a.n).toBe(b.n);
  });

  it("knows the result well before the recording ends, so the game can react to it", () => {
    const s = shotAt(4, 0.05, 0.04);
    expect(s.decided).toBeLessThan(s.end);
  });

  it("goes through the ring only from above and inside it", () => {
    const s = shotAt(0, RIM_R + 0.05, 0);
    expect(s.scoredAt < 0 || s.rimHits > 0).toBe(true);
  });
});

describe("the run", () => {
  const swish = shotAt(0, 0, 0);
  const miss = shotAt(0, 0, 0.7);

  it("a swish pays more and gives back more time than a plain make", () => {
    const r = new Run();
    r.clock = 10;
    const a = r.settle(swish, 4.2, false, false);
    expect(a.points).toBe(150);
    expect(r.clock).toBeGreaterThan(12);
    const r2 = new Run();
    r2.clock = 10;
    const rimIn = { ...swish, outcome: "rim" as const, rimHits: 1 };
    const b = r2.settle(rimIn, 4.2, false, false);
    expect(b.points).toBeLessThan(a.points);
    expect(r2.clock).toBeLessThan(r.clock);
  });

  it("three in a row is hot (×2), six on fire (×3), ten a rimflare (×4); a miss puts it out", () => {
    expect([1, 2, 3, 5, 6, 9, 10, 20].map(multFor)).toEqual([1, 1, 2, 2, 3, 3, 4, 4]);
    const r = new Run();
    const tiers: boolean[] = [];
    for (let i = 0; i < 10; i++) tiers.push(r.settle(swish, 4.2, false, false).tierUp);
    expect(tiers.map((t, i) => (t ? i + 1 : 0)).filter(Boolean)).toEqual([3, 6, 10]);
    r.settle(miss, 4.2, false, false);
    expect(r.streak).toBe(0);
    expect(r.bestStreak).toBe(10);
  });

  it("the clock never goes past its cap", () => {
    const r = new Run();
    for (let i = 0; i < 20; i++) r.settle(swish, 4.2, true, false);
    expect(r.clock).toBeLessThanOrEqual(MAX_CLOCK);
  });

  it("burns faster the longer you last, and sounds the buzzer at zero", () => {
    expect(drainAt(0)).toBe(1);
    expect(drainAt(60)).toBeGreaterThan(1.5);
    const r = new Run();
    let buzz = false;
    let t = 0;
    while (!buzz && t < 60) {
      buzz = r.tick(1 / 60);
      t += 1 / 60;
    }
    expect(buzz).toBe(true);
    expect(t).toBeLessThan(START_CLOCK);
    expect(r.tick(1 / 60)).toBe(false);
  });

  it("a ball in the air at the buzzer still counts (with a bonus) but buys no time", () => {
    const r = new Run();
    r.clock = 0;
    r.buzzer = true;
    const a = r.settle(swish, 4.2, false, true);
    expect(a.buzzer).toBe(true);
    expect(a.points).toBeGreaterThan(150);
    expect(a.refill).toBe(0);
    expect(r.clock).toBe(0);
  });

  it("makes in the final seconds count double", () => {
    const r = new Run();
    r.clock = FRENZY_T - 1;
    expect(r.frenzy).toBe(true);
    expect(r.settle(swish, 4.2, false, false).points).toBe(300);
  });

  it("clears a stage after its makes and waits for the balls in the air", () => {
    const r = new Run();
    const need = stageFor(0).makes;
    let up = 0;
    for (let i = 0; i < need; i++) if (r.settle(swish, 4.2, false, false).stageUp) up++;
    expect(up).toBe(1);
    expect(r.pendingStage).toBe(true);
    expect(r.advance().n).toBe(1);
    expect(r.pendingStage).toBe(false);
  });

  it("bonus balls come round from stage 2 on and pay double", () => {
    const r = new Run();
    const early = Array.from({ length: 12 }, () => r.take());
    expect(early.some(Boolean)).toBe(false);
    r.stage = 1;
    const later = Array.from({ length: 12 }, () => r.take());
    expect(later.filter(Boolean).length).toBe(2);
    expect(new Run().settle(swish, 4.2, true, false).points).toBe(300);
  });
});

describe("pilots", () => {
  it("a casual player makes 60-85% at the start and well under that deep in a run", () => {
    for (const [n, lo, hi] of [
      [0, 0.6, 0.88],
      [6, 0.2, 0.5],
    ] as const) {
      const st = stageFor(n);
      const v = viewFor(st.spot, 390, 788);
      const m = motionFor(st, 0);
      const rng = createRng(31 + n);
      let made = 0;
      const N = 300;
      for (let i = 0; i < N; i++) {
        const t = rng.range(0, 20);
        const a = aimFor(v, st, m, t, pilotFlick(v, st, m, t, SKILLS.casual, rng, 0));
        if (simulateShot(st.spot, launchFor(st.spot, a.target), m, t, frames).outcome !== "miss") made++;
      }
      expect(made / N, `stage ${n + 1}`).toBeGreaterThan(lo);
      expect(made / N, `stage ${n + 1}`).toBeLessThan(hi);
    }
  });

  it("every stage can be made by a steady hand, whatever the hoop is doing", () => {
    for (let n = 0; n < 12; n++) {
      const st = stageFor(n);
      const v = viewFor(st.spot, 390, 788);
      const m = motionFor(st, 0);
      let made = 0;
      for (let i = 0; i < 40; i++) {
        const t = i * 0.37;
        const steady = { ...SKILLS.expert, angle: 0, length: 0, speed: 0, blunder: 0, lead: 1 };
        const a = aimFor(v, st, m, t, pilotFlick(v, st, m, t, steady, createRng(i), 0));
        if (simulateShot(st.spot, launchFor(st.spot, a.target), m, t, frames).outcome !== "miss") made++;
      }
      expect(made, `stage ${n + 1}`).toBeGreaterThanOrEqual(36);
    }
  });

  it("runs last 20-100 s at every skill, longer for better players, and nobody is in danger in the first 10 s", () => {
    const med: number[] = [];
    for (const skill of Object.values(SKILLS)) {
      const secs: number[] = [];
      for (let i = 0; i < 24; i++) {
        const r = playRun(skill, createRng(500 + i * 131));
        secs.push(r.seconds);
        expect(r.minClock10).toBeGreaterThan(10);
      }
      secs.sort((a, b) => a - b);
      const m = secs[12]!;
      med.push(m);
      expect(secs[2]!, skill.name).toBeGreaterThan(20);
      expect(secs[21]!, skill.name).toBeLessThan(100);
    }
    for (let i = 1; i < med.length; i++) expect(med[i]!).toBeGreaterThan(med[i - 1]!);
  });

  it("an idle player hears the buzzer inside the reviewer's 25 s idle window", () => {
    const r = new Run();
    let t = 0;
    while (!r.buzzer && t < 60) {
      t += 1 / 60;
      r.tick(1 / 60, t < FIRST_BALL_T);
    }
    expect(t).toBeLessThan(24);
  });
});
