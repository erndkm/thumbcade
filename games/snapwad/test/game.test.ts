import { describe, expect, it } from "vitest";
import { aimFromDrag, ANGLE_MAX, ANGLE_MIN, DRAG_DEAD, dragFor, powerFor } from "../src/aim.ts";
import { chainName, CLEAR_T, DRAW_T, END_WAIT, HINTS, IDLE_GRACE, IDLE_STEP, KO_PER_WAD, MAX_TAPE, MAX_WADS, RELOAD, Run, START_WADS, STEP, TOPPLE_N, TURN_T, type Ev } from "../src/game.ts";
import { makeLayout, type Layout } from "../src/pages.ts";
import type { Thing } from "../src/physics.ts";
import { isMite, PIECES, TAPE, WAD } from "../src/pieces.ts";

/** The run's own rules, reached directly for the cases a scripted shot can't set up exactly. */
interface Inside {
  knockOut(th: Thing, how: string, direct?: boolean): void;
  clearPage(): void;
}
const inside = (r: Run) => r as unknown as Inside;
const steps = (r: Run, s: number, onEv?: (e: Ev) => void) => {
  for (let t = 0; t < s; t += STEP) {
    r.step();
    if (onEv) r.events.forEach(onEv);
    r.events.length = 0;
  }
};
const play = (r: Run) => steps(r, DRAW_T + STEP);

/** A stub on a book at the height of a flat shot, and other doodles to spare on a far book. */
function range(extra = 0): Layout {
  const pieces: Layout["pieces"] = [{ kind: "stub", x: 4, y: 5.85 + 0.28, angle: 0 }];
  for (let i = 0; i < extra; i++) pieces.push({ kind: "stub", x: 6.2 + i * 0.6, y: 1 + 0.28, angle: 0 });
  return {
    page: 1,
    seed: 1,
    piles: [
      { x0: 3.5, x1: 4.5, top: 5.85, books: [{ x0: 3.5, x1: 4.5, y0: 0, y1: 5.85, tone: 0, title: "t" }] },
      { x0: 6, x1: 7.9, top: 1, books: [{ x0: 6, x1: 7.9, y0: 0, y1: 1, tone: 1, title: "u" }] },
    ],
    pieces,
    star: null,
  };
}

describe("aiming", () => {
  it("a pull is the inverse of its aim, the middle is a cancel, and a wrong-way pull clamps", () => {
    for (const a of [ANGLE_MIN, 0.3, 0.9, 1.4, ANGLE_MAX]) {
      for (const p of [0, 0.4, 1]) {
        const d = dragFor(a, p);
        const back = aimFromDrag(d.dx, d.dy)!;
        expect(back.angle).toBeCloseTo(a, 9);
        expect(back.power).toBeCloseTo(p, 9);
      }
    }
    expect(aimFromDrag(DRAG_DEAD * 0.6, DRAG_DEAD * 0.6)).toBeNull();
    // Pulling the wrong way (straight up, or off to the right) aims at the nearer end of the range.
    expect(aimFromDrag(0, -120)!.angle).toBe(ANGLE_MIN);
    expect(aimFromDrag(120, 0)!.angle).toBe(ANGLE_MAX);
  });
});

describe("the run", () => {
  it("starts with a pile of wads; a shot takes one; the band needs a moment between shots", () => {
    const r = new Run(1, { layout: range() });
    expect(r.ammo).toBe(START_WADS);
    expect(r.phase).toBe("draw");
    play(r);
    expect(r.fire(1.2, 0.5)).toBe(true);
    expect(r.ammo).toBe(START_WADS - 1);
    expect(r.fire(1.2, 0.5)).toBe(false);
    steps(r, RELOAD + STEP);
    expect(r.fire(1.2, 0.5)).toBe(true);
  });

  it("a pull let go while the page draws itself in waits for the page, then flies", () => {
    const r = new Run(1, { layout: range() });
    expect(r.release(...(Object.values(dragFor(1.2, 0.5)) as [number, number]))).not.toBeNull();
    expect(r.ammo).toBe(START_WADS);
    play(r);
    expect(r.ammo).toBe(START_WADS - 1);
  });

  it("a direct hit gives the wad back, once a shot", () => {
    const r = new Run(1, { layout: range(1) });
    play(r);
    const evs: Ev[] = [];
    r.fire(0.1, 0.6);
    steps(r, 2, (e) => evs.push(e));
    expect(r.stats.kos).toBe(1);
    expect(evs.filter((e) => e.t === "refund").map((e) => (e as { why: string }).why)).toEqual(["direct"]);
    expect(r.ammo).toBe(START_WADS);
  });

  it(`every ${KO_PER_WAD} other knock-outs draw a new wad; two or four with one wad give another; never above ${MAX_WADS}`, () => {
    const r = new Run(1, { layout: range(4) });
    play(r);
    r.fire(1.3, 0.2);
    r.wads = 1;
    const mites = r.desk.live();
    inside(r).knockOut(mites[0]!, "tip");
    expect(r.wads).toBe(1);
    expect(r.koMeter).toBe(1);
    // The second in one shot: the meter draws a wad, and a double knock gives one.
    inside(r).knockOut(mites[1]!, "fall");
    expect(r.wads).toBe(3);
    inside(r).knockOut(mites[2]!, "shove");
    expect(r.wads).toBe(3);
    inside(r).knockOut(mites[3]!, "bonk");
    expect(r.wads).toBe(5);
    expect(r.stats.bestChain).toBe(4);
    r.wads = MAX_WADS;
    inside(r).knockOut(mites[4]!, "tip");
    expect(r.wads).toBe(MAX_WADS);
  });

  it("names the chains", () => {
    expect(chainName(2)).toBe("double knock!");
    expect(chainName(3)).toBe("domino!");
    expect(chainName(4)).toBe("landslide!");
    expect(chainName(9)).toBe("the whole desk!");
  });

  it(`a big topple (${TOPPLE_N} pieces off the books with one wad) gives a wad back`, () => {
    let seed = 1;
    while (makeLayout(9, seed).pieces.filter((q) => !isMite(q.kind)).length < TOPPLE_N) seed++;
    const r = new Run(seed, { layout: makeLayout(9, seed) });
    play(r);
    r.fire(1.4, 0.1);
    const wads = r.wads;
    const evs: Ev[] = [];
    const pieces = r.desk.things.filter((t) => !isMite(t.kind) && t.kind !== "wad").slice(0, TOPPLE_N);
    expect(pieces.length).toBe(TOPPLE_N);
    // Knocked clean off: as if each had stood far above where it is now.
    for (const p of pieces) p.y0 = 99;
    steps(r, STEP, (e) => evs.push(e));
    expect(evs.some((e) => e.t === "refund" && e.why === "topple")).toBe(true);
    expect(evs.some((e) => e.t === "topple")).toBe(true);
    expect(r.wads).toBe(wads + 1);
  });

  it("clearing a page turns it; a one-shot page earns a tape ball, which flies next and hits harder", () => {
    const r = new Run(1, { layout: { ...range(1), page: 3 } });
    play(r);
    const evs: Ev[] = [];
    r.fire(1.3, 0.2);
    for (const m of r.desk.live()) inside(r).knockOut(m, "tip");
    steps(r, STEP, (e) => evs.push(e));
    expect(evs.find((e) => e.t === "clear")).toMatchObject({ oneShot: true, page: 3 });
    expect(r.tape).toBe(1);
    steps(r, CLEAR_T + TURN_T + DRAW_T + 0.05, (e) => evs.push(e));
    expect(r.page).toBe(4);
    expect(r.phase).toBe("play");
    expect(evs.some((e) => e.t === "page" && e.page === 4)).toBe(true);
    expect(r.nextIsTape).toBe(true);
    r.fire(1.2, 0.6);
    const shot = r.desk.things.find((t) => t.kind === "tape")!;
    expect(shot).toBeTruthy();
    expect(shot.mass / (Math.PI * WAD.r * WAD.r * WAD.density)).toBeGreaterThan(2.5);
    expect(TAPE.r).toBeGreaterThan(WAD.r);
    expect(r.tape).toBe(0);
    expect(MAX_TAPE).toBeGreaterThanOrEqual(1);
  });

  it("a gold star earns the ruler: the next shot shows its whole flight", () => {
    const l = range();
    const pw = powerFor(1.2, 3.0, 8.8)!;
    const r = new Run(1, { layout: { ...l, star: { x: 3.0, y: 8.8 } } });
    play(r);
    r.fire(1.2, pw);
    steps(r, 1.2);
    expect(r.stats.stars).toBe(1);
    expect(r.ruler).toBe(1);
    steps(r, RELOAD);
    const evs: Ev[] = [];
    r.fire(1.2, 0.5);
    r.events.forEach((e) => evs.push(e));
    expect(evs.find((e) => e.t === "fire")).toMatchObject({ ruled: true });
    expect(r.ruler).toBe(0);
  });

  it(`wads uncrumple after ${IDLE_GRACE} s without a shot, one every ${IDLE_STEP} s, and an idle run ends on its own`, () => {
    const r = new Run(1, { layout: range() });
    play(r);
    steps(r, IDLE_GRACE + IDLE_STEP + 0.05);
    expect(r.ammo).toBe(START_WADS - 1);
    const idle = new Run(9);
    let t = 0;
    while (idle.phase !== "done" && t < 120) {
      idle.step();
      idle.events.length = 0;
      t += STEP;
    }
    expect(t).toBeGreaterThan(20);
    expect(t).toBeLessThan(35);
  });

  it("ends when the wads are gone and the last shot has settled, not while it flies", () => {
    const r = new Run(1, { layout: range() });
    play(r);
    r.wads = 1;
    r.fire(1.45, 1);
    steps(r, 0.5);
    expect(r.phase).toBe("play");
    steps(r, END_WAIT + 3);
    expect(r.phase).toBe("done");
  });

  it("is deterministic over a whole scripted run", () => {
    const go = () => {
      const r = new Run(4242);
      let t = 0;
      let k = 0;
      while (r.phase !== "done" && t < 200) {
        if (r.phase === "play" && r.reload <= 0 && !r.flying && r.sinceLanding > 0.8) r.fire(0.9 + (k % 5) * 0.12, 0.55 + (k++ % 3) * 0.12);
        r.step();
        r.events.length = 0;
        t += STEP;
      }
      return { t, score: r.score, stats: r.stats };
    };
    expect(go()).toEqual(go());
  });

  it("picks the game-over hint from what happened", () => {
    const r = new Run(1);
    expect(r.hint()).toBe(HINTS.none);
    r.stats.shots = 6;
    r.stats.drains = 4;
    expect(r.hint()).toBe(HINTS.idle);
    r.stats.drains = 0;
    r.stats.over = 3;
    expect(r.hint()).toBe(HINTS.over);
    r.stats.over = 0;
    r.stats.short = 4;
    expect(r.hint()).toBe(HINTS.short);
    r.stats.short = 0;
    expect(r.hint()).toBe(HINTS.first);
    r.stats.pages = 3;
    r.stats.bestChain = 1;
    expect(r.hint()).toBe(HINTS.chain);
    r.stats.bestChain = 3;
    expect(r.hint()).toBe(HINTS.oneShot);
    r.stats.oneShots = 1;
    expect(r.hint()).toBe(HINTS.topple);
    void PIECES;
  });
});
