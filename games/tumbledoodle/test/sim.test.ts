import { describe, expect, it } from "vitest";
import { ERASERS, KIND_INDEX, KINDS } from "../src/catalog.ts";
import {
  COMBO_WINDOW,
  DRAWING,
  ERASER_AT,
  ERASER_BONUS,
  FALL_T,
  FALLING,
  FEAST,
  FIT,
  fits,
  Game,
  GONE,
  GULP_T,
  HINTS,
  LAST_BITES,
  MAX_CLOCK,
  needFor,
  PAGE_H,
  PAGE_W,
  radiusOf,
  REST,
  SCRUB_COST,
  SCRUB_METER,
  START_CLOCK,
  START_X,
  START_Y,
  STEP,
  TIER_BONUS,
  TIERS,
  TOP,
  viewOf,
  type Doodle,
  type Ev,
} from "../src/sim.ts";

/** A game with an empty page (so tests place exactly what they need) and no eraser unless asked for. */
function bare(seed = 1, o: { eraser?: boolean } = {}): Game {
  const g = new Game(seed);
  for (const d of g.doodles) if (d.state !== GONE) (g as unknown as { unlink(d: Doodle): void }).unlink(d);
  for (const d of g.doodles) d.state = GONE;
  g.doodles = [];
  if (!o.eraser) g.nextEraserAt = 1e9;
  // Keep the page from drawing itself back in under the test.
  (g as unknown as { spawnT: number }).spawnT = 1e9;
  return g;
}

/** Feeds the hole tier by tier (one swallow never skips a tier). */
function growTo(g: Game, tier: number): void {
  const feed = (f: number) => (g as unknown as { feed(f: number): void }).feed(f);
  while (g.hole.tier < tier) feed(needFor(g.hole.tier) + 1);
}

function run(g: Game, seconds: number, tx = g.hole.x, ty = g.hole.y, sink?: Ev[]): void {
  const n = Math.round(seconds / STEP);
  for (let i = 0; i < n; i++) {
    g.step(tx, ty);
    if (sink) sink.push(...g.events);
    g.events.length = 0;
  }
}

describe("sizes", () => {
  it("a doodle fits at up to FIT of the hole's radius", () => {
    expect(fits(FIT * 20, 20)).toBe(true);
    expect(fits(FIT * 20 + 0.01, 20)).toBe(false);
  });

  it("the hole grows a little inside a tier and bursts open at the tier-up; the view pulls back with it", () => {
    for (let t = 0; t < TOP; t++) {
      expect(radiusOf(t, 0)).toBe(TIERS[t]!.r);
      expect(radiusOf(t, 1)).toBeGreaterThan(radiusOf(t, 0));
      expect(radiusOf(t, 1)).toBeLessThan(radiusOf(t + 1, 0));
      expect(viewOf(t, 1)).toBeLessThan(viewOf(t + 1, 0));
      expect(viewOf(t + 1, 0) / viewOf(t, 0)).toBeGreaterThan(1.2);
    }
  });

  it("each tier unlocks its own doodles: none fit a tier early, all fit their own tier", () => {
    for (const k of KINDS) {
      expect(fits(k.s, radiusOf(k.tier, 0)), k.id).toBe(true);
      if (k.tier > 0) expect(fits(k.s, radiusOf(k.tier - 1, 0)), k.id).toBe(false);
    }
  });

  it("higher tiers need relatively more food", () => {
    const ratio = (t: number) => needFor(t) / (TIERS[t + 1]!.r ** 2 - TIERS[t]!.r ** 2);
    for (let t = 1; t < TOP; t++) expect(ratio(t)).toBeGreaterThan(ratio(t - 1));
  });

  it("every eraser becomes edible one or two tiers after it shows up", () => {
    expect(fits(ERASERS[0]!.s, radiusOf(2, 0))).toBe(false);
    expect(fits(ERASERS[0]!.s, radiusOf(3, 0))).toBe(true);
    expect(fits(ERASERS[1]!.s, radiusOf(3, 1))).toBe(false);
    expect(fits(ERASERS[1]!.s, radiusOf(4, 0))).toBe(true);
    expect(fits(ERASERS[2]!.s, radiusOf(4, 1))).toBe(false);
    expect(fits(ERASERS[2]!.s, radiusOf(5, 0))).toBe(true);
  });
});

describe("swallowing", () => {
  it("a doodle under the hole tips in, falls, and is gone after the fall", () => {
    const g = bare();
    const d = g.add(KIND_INDEX.star!, START_X + 2, START_Y);
    const ev: Ev[] = [];
    run(g, STEP, START_X, START_Y, ev);
    expect(d.state).toBe(FALLING);
    expect(ev.some((e) => e.t === "swallow")).toBe(true);
    expect(g.stats.eaten).toBe(1);
    expect(g.stats.tally[KIND_INDEX.star!]).toBe(1);
    run(g, FALL_T + STEP);
    expect(d.state).toBe(GONE);
  });

  it("one leaning over the rim is pulled in, not left hanging", () => {
    const g = bare();
    const r = g.hole.r;
    const d = g.add(KIND_INDEX.shaving!, START_X + r + 2, START_Y);
    expect(d.state).toBe(REST);
    run(g, 0.6);
    expect(d.state).not.toBe(REST);
  });

  it("one just outside the rim stays put", () => {
    const g = bare();
    const d = g.add(KIND_INDEX.shaving!, START_X + g.hole.r + KINDS[KIND_INDEX.shaving!]!.s * 0.8, START_Y);
    run(g, 1);
    expect(d.state).toBe(REST);
  });

  it("a doodle too big for the hole wobbles on the rim and never falls in", () => {
    const g = bare();
    const d = g.add(KIND_INDEX.cat!, START_X + 4, START_Y);
    const ev: Ev[] = [];
    run(g, 1.5, START_X, START_Y, ev);
    expect(d.state).toBe(REST);
    expect(ev.filter((e) => e.t === "wobble").length).toBe(1);
    expect(Math.abs(d.wob) + Math.abs(d.wobV)).toBeGreaterThan(0);
  });

  it("a fast hole eats what it passes over between steps", () => {
    const g = bare();
    const d = g.add(KIND_INDEX.dot!, START_X + 40, START_Y);
    // Far target: the hole moves at its speed cap, more than its own diameter per step.
    let jumped = 0;
    for (let i = 0; i < 20 && d.state === REST; i++) {
      const x0 = g.hole.x;
      g.step(START_X + 400, START_Y);
      g.events.length = 0;
      jumped = Math.max(jumped, g.hole.x - x0);
    }
    expect(d.state).toBe(FALLING);
  });

  it("the run is deterministic", () => {
    const play = () => {
      const g = new Game(42);
      for (let i = 0; i < 60 * 20; i++) {
        const a = i * 0.013;
        g.step(g.hole.x + Math.cos(a) * 60, g.hole.y + Math.sin(a * 0.7) * 60);
        g.events.length = 0;
      }
      return [g.score, g.stats.eaten, g.hole.tier, g.clock.toFixed(4), g.stats.scrubs];
    };
    expect(play()).toEqual(play());
  });
});

describe("growing", () => {
  it("enough food opens the next tier, pays a bonus and gives back time (capped)", () => {
    const g = bare();
    const ev: Ev[] = [];
    let x = START_X;
    // Feed it stars one after another until it tiers up.
    for (let i = 0; i < 200 && g.hole.tier === 0; i++) {
      x += 1;
      g.add(KIND_INDEX.star!, x, START_Y);
      run(g, STEP, x, START_Y, ev);
    }
    expect(g.hole.tier).toBe(1);
    const tier = ev.find((e) => e.t === "tier");
    expect(tier).toBeTruthy();
    expect(g.clock).toBeLessThanOrEqual(MAX_CLOCK);
    expect(tier && tier.t === "tier" && tier.bonus).toBe(Math.min(TIER_BONUS, MAX_CLOCK - (g.clock - TIER_BONUS)));
  });

  it("never grows past the top tier", () => {
    const g = bare();
    growTo(g, TOP);
    for (let i = 0; i < 5; i++) (g as unknown as { feed(f: number): void }).feed(1e9);
    expect(g.hole.tier).toBe(TOP);
    expect(g.meter).toBe(1);
  });
});

describe("combos and feasts", () => {
  it("8 in a row is a feast at ×2, then ×3 and ×4; the streak ends with a burp", () => {
    const g = bare();
    const ev: Ev[] = [];
    const n = FEAST[2]! + 2;
    for (let i = 0; i < n; i++) {
      g.add(KIND_INDEX.star!, START_X + (i % 3), START_Y);
      run(g, STEP * 3, START_X, START_Y, ev);
      // Stay small so every star counts toward the combo.
      g.hole.food = 0;
    }
    const feasts = ev.filter((e) => e.t === "feast").map((e) => (e.t === "feast" ? e.level : 0));
    expect(feasts).toEqual([1, 2, 3]);
    expect(g.mult).toBe(4);
    run(g, COMBO_WINDOW + 0.1, START_X, START_Y, ev);
    expect(ev.some((e) => e.t === "burp")).toBe(true);
    expect(g.combo).toBe(0);
    expect(g.mult).toBe(1);
  });

  it("dust far smaller than the hole doesn't build a combo", () => {
    const g = bare();
    growTo(g, 3);
    g.hole.food = 0;
    for (let i = 0; i < 12; i++) {
      g.add(KIND_INDEX.dot!, START_X + i, START_Y);
      run(g, STEP, START_X, START_Y);
    }
    expect(g.stats.eaten).toBe(12);
    expect(g.combo).toBe(0);
  });
});

describe("the eraser", () => {
  it("walks in after a few seconds, from outside the view, and comes for you", () => {
    const g = bare(3, { eraser: true });
    const ev: Ev[] = [];
    run(g, ERASER_AT - 0.1, START_X, START_Y, ev);
    expect(g.eraser).toBeNull();
    run(g, 0.2, START_X, START_Y, ev);
    expect(ev.some((e) => e.t === "eraserIn")).toBe(true);
    const e = g.eraser!;
    const d0 = Math.hypot(e.x - g.hole.x, e.y - g.hole.y);
    expect(d0).toBeGreaterThan(g.view * 0.5);
    run(g, 1, START_X, START_Y);
    expect(Math.hypot(e.x - g.hole.x, e.y - g.hole.y)).toBeLessThan(d0);
  });

  it("a scrub costs seconds and a share of the meter, then it backs off before coming again", () => {
    const g = bare(4, { eraser: true });
    g.hole.food = needFor(0) * 0.8;
    const ev: Ev[] = [];
    let t = 0;
    while (!ev.some((e) => e.t === "scrub") && t < 30) {
      run(g, STEP, START_X, START_Y, ev);
      t += STEP;
    }
    expect(ev.some((e) => e.t === "scrub")).toBe(true);
    const at = g.time;
    expect(g.clock).toBeCloseTo(START_CLOCK - at - SCRUB_COST, 1);
    expect(g.hole.food).toBeCloseTo(needFor(0) * (0.8 - SCRUB_METER), 5);
    expect(g.eraser!.state).toBe("stun");
    expect(g.hole.invuln).toBeGreaterThan(1);
    run(g, 1.4, START_X, START_Y);
    expect(g.eraser!.state).toBe("retreat");
    // No second scrub while it is stunned or backing off.
    ev.length = 0;
    run(g, 1.2, START_X, START_Y, ev);
    expect(ev.some((e) => e.t === "scrub")).toBe(false);
  });

  it("rubs out the small doodles it runs over and leaves bigger ones", () => {
    const g = bare(5, { eraser: true });
    run(g, ERASER_AT + 0.1, START_X, START_Y);
    const e = g.eraser!;
    // Line doodles up between the eraser and the hole.
    const small: Doodle[] = [];
    const big: Doodle[] = [];
    for (let i = 1; i <= 4; i++) {
      const x = e.x + ((g.hole.x - e.x) * i) / 6;
      const y = e.y + ((g.hole.y - e.y) * i) / 6;
      if (i % 2) small.push(g.add(KIND_INDEX.heart!, x, y));
      else big.push(g.add(KIND_INDEX.castle!, x, y));
    }
    run(g, 2.5, START_X, START_Y);
    expect(small.filter((d) => d.state === GONE).length).toBeGreaterThan(0);
    for (const d of big) expect(d.state).toBe(REST);
  });

  it("runs once you're big enough to eat it, and eating it pays time and brings the next one", () => {
    const g = bare(6, { eraser: true });
    growTo(g, 3);
    g.hole.food = 0;
    const ev: Ev[] = [];
    run(g, ERASER_AT + 0.2, START_X, START_Y, ev);
    const e = g.eraser!;
    run(g, 0.3, START_X, START_Y, ev);
    expect(e.state).toBe("flee");
    expect(ev.some((x) => x.t === "flee")).toBe(true);
    const d0 = Math.hypot(e.x - g.hole.x, e.y - g.hole.y);
    run(g, 0.5, START_X, START_Y);
    expect(Math.hypot(e.x - g.hole.x, e.y - g.hole.y)).toBeGreaterThan(d0);
    // Chase it down.
    const clock0 = g.clock;
    let caught = false;
    for (let i = 0; i < 60 * 20 && !caught; i++) {
      const cur = g.eraser;
      if (!cur || cur.state === "fall") {
        caught = true;
        break;
      }
      g.step(cur.x, cur.y);
      for (const x of g.events) if (x.t === "eraserEaten") caught = true;
      g.events.length = 0;
    }
    expect(caught).toBe(true);
    expect(g.stats.erasersEaten).toBe(1);
    expect(g.eraserLevel).toBe(1);
    expect(g.clock).toBeGreaterThan(clock0 + ERASER_BONUS - 21);
  });

  it("the second eraser waits for a bigger hole", () => {
    const g = bare(7, { eraser: true });
    g.eraserLevel = 1;
    g.nextEraserAt = 0;
    run(g, 2, START_X, START_Y);
    expect(g.eraser).toBeNull();
  });
});

describe("the page draws back and the run ends", () => {
  it("an emptied neighbourhood gets new doodles drawn in (crowds of small ones round one your size)", () => {
    const g = bare();
    (g as unknown as { spawnT: number }).spawnT = 0;
    const ev: Ev[] = [];
    run(g, 2, START_X, START_Y, ev);
    const spawned = ev.filter((e) => e.t === "spawn");
    expect(spawned.length).toBeGreaterThanOrEqual(4);
    expect(spawned.every((e) => e.t === "spawn" && e.d.state !== GONE)).toBe(true);
    expect(spawned.some((e) => e.t === "spawn" && fits(e.d.s, g.hole.r))).toBe(true);
    // They draw themselves in before they can be eaten.
    const fresh = g.add(KIND_INDEX.star!, START_X, START_Y, true);
    expect(fresh.state).toBe(DRAWING);
  });

  it("the last bites count double and flood the page; at zero the final gulp pulls things in, then it's over", () => {
    const g = bare();
    g.clock = LAST_BITES + 0.05;
    (g as unknown as { spawnT: number }).spawnT = 0;
    const ev: Ev[] = [];
    run(g, 0.1, START_X, START_Y, ev);
    expect(g.lastBites).toBe(true);
    expect(g.mult).toBe(2);
    expect(ev.some((e) => e.t === "lastBites")).toBe(true);
    run(g, 2, START_X, START_Y, ev);
    expect(ev.filter((e) => e.t === "spawn").length).toBeGreaterThanOrEqual(6);
    // Something within reach of the gulp but outside the rim.
    const d = g.add(KIND_INDEX.star!, START_X + g.hole.r * 2, START_Y);
    run(g, LAST_BITES, START_X, START_Y, ev);
    expect(ev.some((e) => e.t === "gulp")).toBe(true);
    run(g, GULP_T + FALL_T + 0.1, START_X, START_Y, ev);
    expect(d.state).toBe(GONE);
    expect(g.phase).toBe("done");
    expect(ev.filter((e) => e.t === "done").length).toBe(1);
    expect(g.stats.finalGulp).toBeGreaterThan(0);
  });
});

describe("the page", () => {
  it("starts full: every kind somewhere, the tear clear, nothing piled on anything", () => {
    const g = new Game(11);
    const kinds = new Set(g.doodles.map((d) => d.k));
    for (let k = 0; k < KINDS.length; k++) if (KINDS[k]!.tier <= 5) expect(kinds.has(k), KINDS[k]!.id).toBe(true);
    for (const d of g.doodles) {
      expect(d.x).toBeGreaterThanOrEqual(0);
      expect(d.x).toBeLessThanOrEqual(PAGE_W);
      expect(d.y).toBeGreaterThanOrEqual(0);
      expect(d.y).toBeLessThanOrEqual(PAGE_H);
      const ds = Math.hypot(d.x - START_X, d.y - START_Y);
      expect(ds).toBeGreaterThan(d.s);
      if (KINDS[d.k]!.tier > 1) expect(ds).toBeGreaterThan(120);
    }
    let overlaps = 0;
    for (let i = 0; i < g.doodles.length; i++)
      for (let j = i + 1; j < g.doodles.length; j++) {
        const a = g.doodles[i]!;
        const b = g.doodles[j]!;
        if (Math.hypot(a.x - b.x, a.y - b.y) < (a.s + b.s) * 0.9) overlaps++;
      }
    expect(overlaps).toBe(0);
    expect(g.doodles.length).toBeGreaterThan(600);
    // Plenty to eat right where the tear opens.
    expect(g.doodles.filter((d) => KINDS[d.k]!.tier === 0 && Math.hypot(d.x - START_X, d.y - START_Y) < 160).length).toBeGreaterThan(30);
  });

  it("hints quote the real rules and stay short enough for the card", () => {
    expect(HINTS.hunt).toContain(`+${ERASER_BONUS} s`);
    expect(HINTS.feast).toContain(`${FEAST[0]} in a row`);
    expect(HINTS.last).toContain(`${LAST_BITES} seconds`);
    for (const h of Object.values(HINTS)) expect(h.length).toBeLessThanOrEqual(90);
  });

  it("picks a hint from how the run went", () => {
    const g = new Game(1);
    g.stats.scrubs = 4;
    expect(g.hint()).toMatch(/eraser/);
    g.stats.scrubs = 0;
    expect(g.hint()).toMatch(/your size/);
  });
});
