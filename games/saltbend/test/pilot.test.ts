import { createRng } from "@thumbcade-games/kit/rng";
import { describe, expect, it } from "vitest";
import { Coach, DEMO, Pilot, simulate, SKILLS } from "../src/pilot.ts";
import { Run } from "../src/sim.ts";

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
/** The brief's bands for the median run, with a little room for a smaller sample than the pilot script's. */
const BANDS: Record<string, [number, number]> = { novice: [27, 45], casual: [40, 62], good: [55, 85], expert: [72, 110] };

describe("pilots", () => {
  it("each skill's median run lands in its band, and nobody leaves the road in the first 10 s", () => {
    for (const skill of SKILLS) {
      const res = Array.from({ length: 40 }, (_, i) => simulate(500 + i * 104729, skill));
      const m = median(res.map((r) => r.seconds));
      const [lo, hi] = BANDS[skill.name]!;
      expect(m, skill.name).toBeGreaterThan(lo);
      expect(m, skill.name).toBeLessThan(hi);
      expect(res.some((r) => r.early), skill.name).toBe(false);
    }
  }, 60_000);

  it("better drivers go further, score more and draw tighter lines", () => {
    const at = (k: number) => Array.from({ length: 24 }, (_, i) => simulate(900 + i * 7919, SKILLS[k]!));
    const nov = at(0);
    const exp = at(3);
    expect(median(exp.map((r) => r.metres))).toBeGreaterThan(median(nov.map((r) => r.metres)) * 2);
    expect(median(exp.map((r) => r.score))).toBeGreaterThan(median(nov.map((r) => r.score)) * 4);
    const paint = (rs: typeof nov) => rs.reduce((a, r) => a + r.stats.grades.paint + r.stats.grades.kissed, 0) / rs.reduce((a, r) => a + Math.max(1, r.stats.bends), 0);
    expect(paint(exp)).toBeGreaterThan(paint(nov));
  }, 60_000);

  it("an idle thumb and the reviewer's random taps both end the run on their own", () => {
    for (let i = 0; i < 12; i++) {
      expect(simulate(77 + i * 31, null).seconds).toBeLessThan(60);
      expect(simulate(77 + i * 31, "tapper").seconds).toBeLessThan(90);
    }
  });

  it("the attract demo drives the demo road tidily for a whole loop", () => {
    let crashes = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const run = new Run(seed * 101, { demo: true });
      const p = new Pilot(DEMO, createRng(seed));
      for (let t = 0; t < 70 && run.phase === "drive"; t += 1 / 60) {
        p.step(run, 1 / 60);
        run.step(1 / 60);
        run.events.length = 0;
      }
      if (run.phase !== "drive") crashes++;
      expect(run.s).toBeGreaterThan(300);
    }
    expect(crashes).toBeLessThanOrEqual(2);
  });

  it("the first-run coach says hold as a bend arrives and let go once the cart is through", () => {
    const run = new Run(5);
    const coach = new Coach();
    let holds = 0;
    let flips = 0;
    let last = false;
    for (let t = 0; t < 40 && run.phase === "drive"; t += 1 / 60) {
      const w = coach.advise(run);
      run.setHold(w);
      if (w) holds++;
      if (w !== last) flips++;
      last = w;
      run.step(1 / 60);
      run.events.length = 0;
    }
    // Following its own advice keeps the cart on the road, with a press per bend or so.
    expect(run.phase).toBe("drive");
    expect(holds).toBeGreaterThan(30);
    expect(flips).toBeGreaterThan(6);
    expect(run.stats.scrapes).toBeLessThanOrEqual(1);
  });
});
