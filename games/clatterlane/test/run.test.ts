import { createRng } from "@thumbcade-games/kit/rng";
import { describe, expect, it } from "vitest";
import { PIN_COUNT } from "../src/lane.ts";
import type { Throw } from "../src/pins.ts";
import { BUMPER_RACKS, chainName, CLUTCH_T, drainAt, GLOW_EVERY, MAX_CLOCK, Run, START_CLOCK } from "../src/run.ts";

const all = (v: boolean) => Array.from({ length: PIN_COUNT }, () => v);
const rack = (...up: number[]) => Array.from({ length: PIN_COUNT }, (_, i) => up.includes(i + 1));

/** A throw result with nothing but what the run reads. */
function th(before: boolean[], after: boolean[], o: Partial<Throw> = {}): Throw {
  const knocked = before.filter((b, i) => b && !after[i]).length;
  return {
    input: { x0: 0, heading: 0, speed: 10, hook: 0, bumpers: false },
    before,
    after,
    knocked,
    impact: 1.1,
    decided: 1.8,
    end: 2.5,
    frames: 0,
    events: [],
    gutter: false,
    entryX: 0.06,
    entryAngle: 0,
    downAt: [],
    wobblers: 0,
    impacts: 10,
    path: new Float32Array(0),
    ...o,
  };
}
const strike = (r: Run) => r.settle(th(r.standing, all(false)));
/** Past the bumper racks, so gutters count. */
function later(): Run {
  const r = new Run(createRng(1));
  r.rack = BUMPER_RACKS;
  return r;
}

describe("the clock", () => {
  it("starts with enough to bowl a few racks, burns faster the longer you last, and runs out", () => {
    const r = new Run();
    expect(r.clock).toBe(START_CLOCK);
    expect(drainAt(0)).toBe(1);
    expect(drainAt(60)).toBeGreaterThan(drainAt(20));
    let t = 0;
    let out = false;
    while (!out && t < 60) {
      out = r.tick(1 / 60, false);
      t += 1 / 60;
    }
    expect(out).toBe(true);
    expect(r.buzzer).toBe(true);
    // An idle player hears the buzzer inside the reviewer's 25 s window.
    expect(t).toBeLessThan(24);
    expect(t).toBeGreaterThan(15);
  });

  it("waits while frozen (the sweep), and never banks more than the cap", () => {
    const r = new Run();
    r.tick(5, true);
    expect(r.clock).toBe(START_CLOCK);
    for (let i = 0; i < 8; i++) strike(r);
    expect(r.clock).toBeLessThanOrEqual(MAX_CLOCK);
  });
});

describe("strikes and chains", () => {
  it("a strike resets the rack at once, buys time and scores", () => {
    const r = new Run();
    const a = strike(r);
    expect(a.kind).toBe("strike");
    expect(a.refill).toBeGreaterThan(4);
    expect(a.points).toBe(300);
    expect(r.rack).toBe(1);
    expect(r.ball).toBe(1);
    expect(r.standing.every(Boolean)).toBe(true);
  });

  it("consecutive strikes escalate: double ×2, turkey ×3 with a bonus, up to ×5", () => {
    const r = new Run();
    const s = [strike(r), strike(r), strike(r), strike(r), strike(r), strike(r)];
    expect(s.map((a) => a.mult)).toEqual([1, 2, 3, 4, 5, 5]);
    expect(s.map((a) => a.tierUp)).toEqual([false, true, true, true, true, false]);
    expect(s[2]!.points).toBe(300 * 3 + 500);
    expect(s[2]!.refill).toBeGreaterThan(s[1]!.refill);
    expect(chainName(2)).toBe("DOUBLE");
    expect(chainName(3)).toBe("TURKEY");
    expect(r.bestChain).toBe(6);
  });

  it("the second ball goes at the leave; a spare ends the chain but pays time", () => {
    const r = new Run();
    strike(r);
    strike(r);
    const first = r.settle(th(r.standing, rack(7)));
    expect(first.kind).toBe("leave");
    expect(first.mult).toBe(2);
    expect(first.points).toBe(9 * 10 * 2);
    expect(r.ball).toBe(2);
    expect(r.standing).toEqual(rack(7));
    const spare = r.settle(th(r.standing, all(false)));
    expect(spare.kind).toBe("spare");
    expect(spare.refill).toBeGreaterThan(3);
    expect(r.chain).toBe(0);
    expect(r.rack).toBe(3);
  });

  it("an open frame resets to a fresh rack and the chain", () => {
    const r = new Run();
    strike(r);
    r.settle(th(r.standing, rack(4, 7)));
    const a = r.settle(th(r.standing, rack(7)));
    expect(a.kind).toBe("open");
    expect(a.left).toBe(1);
    expect(r.chain).toBe(0);
    expect(r.ball).toBe(1);
    expect(r.standing.every(Boolean)).toBe(true);
  });

  it("splits are flagged on the first ball and pay big when converted", () => {
    const r = new Run();
    const a = r.settle(th(r.standing, rack(4, 6)));
    expect(a.split).toBe(true);
    expect(a.leave).toBe("4-6");
    const b = r.settle(th(r.standing, all(false)));
    expect(b.converted).toBe(true);
    expect(b.points).toBe(2 * 10 + 150 + 500);
    expect(b.refill).toBeGreaterThan(5);
    const r2 = new Run();
    r2.settle(th(r2.standing, rack(7, 10)));
    const big = r2.settle(th(r2.standing, all(false)));
    expect(big.tags[0]).toBe("THE BIG ONE");
    expect(big.points).toBe(2 * 10 + 150 + 1500);
  });
});

describe("softening", () => {
  it("bumpers are up for the first racks only", () => {
    const r = new Run();
    expect(r.bumpers).toBe(true);
    for (let i = 0; i < BUMPER_RACKS; i++) strike(r);
    expect(r.bumpers).toBe(false);
  });

  it("the first gutter ball off a full rack is on the house, once", () => {
    const r = later();
    const g = r.settle(th(r.standing, all(true), { gutter: true }));
    expect(g.kind).toBe("mulligan");
    expect(r.ball).toBe(1);
    const g2 = r.settle(th(r.standing, all(true), { gutter: true }));
    expect(g2.kind).toBe("gutter");
    expect(r.ball).toBe(2);
    expect(r.gutters).toBe(2);
  });
});

describe("rhythm and the finish", () => {
  it("every fifth rack glows: double points and more time for a strike", () => {
    const r = new Run();
    for (let i = 0; i < GLOW_EVERY - 1; i++) {
      r.settle(th(r.standing, rack(1)));
      r.settle(th(r.standing, rack(1)));
    }
    expect(r.glow).toBe(true);
    const plain = new Run();
    plain.rack = GLOW_EVERY;
    const a = strike(r);
    const b = strike(plain);
    expect(a.glow).toBe(true);
    expect(a.points).toBe(b.points * 2);
    expect(a.refill).toBeGreaterThan(b.refill);
  });

  it("the last seconds count double", () => {
    const r = new Run();
    r.clock = CLUTCH_T - 0.5;
    expect(r.clutch).toBe(true);
    const a = r.settle(th(r.standing, rack(10)));
    expect(a.clutch).toBe(true);
    expect(a.points).toBe(9 * 10 * 2);
  });

  it("a ball still rolling at the buzzer counts, but buys no time", () => {
    const r = new Run();
    r.clock = 0;
    r.buzzer = true;
    const a = r.settle(th(r.standing, all(false)), true);
    expect(a.kind).toBe("strike");
    expect(a.buzzer).toBe(true);
    expect(a.points).toBeGreaterThan(0);
    expect(r.clock).toBe(0);
  });

  it("game over picks a hint from how it went", () => {
    const r = later();
    for (let i = 0; i < 3; i++) {
      r.settle(th(r.standing, all(true), { gutter: true }));
    }
    expect(r.hint()).toContain("INSIDE");
    const h = new Run();
    for (let i = 0; i < 4; i++) {
      h.settle(th(h.standing, rack(4, 7, 10), { entryX: 0 }));
      h.settle(th(h.standing, rack(7)));
    }
    expect(h.hint()).toContain("HEAD-ON");
  });
});
