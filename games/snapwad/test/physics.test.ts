import { describe, expect, it } from "vitest";
import { velocityOf, V_MAX } from "../src/aim.ts";
import { Run } from "../src/game.ts";
import { makeLayout, REST, type Layout } from "../src/pages.ts";
import { Desk, STEP } from "../src/physics.ts";
import { isMite, PIECES, WAD } from "../src/pieces.ts";

const settle = (d: Desk, s: number) => {
  for (let t = 0; t < s; t += STEP) d.step();
};
const snapshot = (d: Desk) => d.things.filter((t) => !t.gone).flatMap((t) => [t.body.getPosition().x, t.body.getPosition().y, t.body.getAngle()]);

/** A bare desk with one upright pencil standing at x, and nothing else. */
function onePencil(x: number): Layout {
  return { page: 1, seed: 1, piles: [], pieces: [{ kind: "pencil", x, y: PIECES.pencil.hw, angle: Math.PI / 2 }], star: null };
}

/** One book at x0..x1 up to `top`, and a piece or a doodle standing on it. */
function onBook(kind: "pencil" | "stub", x: number, top: number): Layout {
  const upright = kind === "pencil";
  return {
    page: 1,
    seed: 1,
    piles: [{ x0: x - 0.5, x1: x + 0.5, top, books: [{ x0: x - 0.5, x1: x + 0.5, y0: 0, y1: top, tone: 0, title: "t" }] }],
    pieces: [{ kind, x, y: top + (upright ? PIECES.pencil.hw : 0.28), angle: upright ? Math.PI / 2 : 0 }],
    star: null,
  };
}

describe("the desk's physics", () => {
  it("every page's fort stands exactly still once it has settled: no jitter, no creep over 12 s", () => {
    for (let p = 1; p <= 18; p++) {
      for (const seed of [11, 4242, 90001]) {
        const r = new Run(seed, { layout: makeLayout(p, seed) });
        const before = snapshot(r.desk);
        settle(r.desk, 12);
        const after = snapshot(r.desk);
        const drift = Math.max(...after.map((v, i) => Math.abs(v - before[i]!)));
        expect(drift, `page ${p} seed ${seed}`).toBeLessThan(1e-3);
        expect(r.desk.things.every((t) => t.gone || !t.body.isAwake()), `page ${p} seed ${seed} asleep`).toBe(true);
      }
    }
  });

  it("no doodle falls, tips or gets knocked out while a page just stands there", () => {
    for (let p = 1; p <= 18; p++) {
      for (const seed of [7, 31337]) {
        const r = new Run(seed, { layout: makeLayout(p, seed) });
        const live = r.live;
        for (let t = 0; t < 8; t += STEP) r.step();
        expect(r.events.some((e) => e.t === "ko"), `page ${p} seed ${seed}`).toBe(false);
        expect(r.live, `page ${p} seed ${seed}`).toBe(live);
      }
    }
  });

  it("never lets the wad pass through a pencil edge-on, at full pull or at three times that", () => {
    for (const speed of [V_MAX, V_MAX * 3]) {
      const d = new Desk(onePencil(4));
      settle(d, 1);
      const pencil = d.things[0]!;
      const wad = d.launch("wad", 2.5, 0.9, speed, 0);
      let touched = false;
      for (let t = 0; t < 1; t += STEP) {
        d.step();
        if (d.impacts.some((i) => (i.a === wad && i.b === pencil) || (i.a === pencil && i.b === wad))) touched = true;
        d.impacts.length = 0;
        // Never inside the pencil while it stands in the way (centres closer than the two half widths).
        const w = wad.body.getPosition();
        const p = pencil.body.getPosition();
        if (Math.abs(pencil.body.getAngle() - Math.PI / 2) < 0.2 && Math.abs(w.y - p.y) < PIECES.pencil.hw - 0.1) {
          expect(Math.abs(w.x - p.x), `speed ${speed}`).toBeGreaterThan(PIECES.pencil.hh + WAD.r - 0.03);
        }
      }
      expect(touched, `speed ${speed}`).toBe(true);
    }
  });

  it("never lets the wad through a flat ruler or a book from above", () => {
    const l: Layout = { page: 1, seed: 1, piles: [{ x0: 3, x1: 7, top: 1, books: [{ x0: 3, x1: 7, y0: 0, y1: 1, tone: 0, title: "t" }] }], pieces: [{ kind: "ruler", x: 5, y: 1 + PIECES.ruler.hh, angle: 0 }], star: null };
    const d = new Desk(l);
    settle(d, 1);
    const wad = d.launch("wad", 5, 6, 0, -V_MAX * 3);
    for (let t = 0; t < 1; t += STEP) {
      d.step();
      expect(wad.body.getPosition().y).toBeGreaterThan(1 + PIECES.ruler.hh * 2 + WAD.r - 0.05);
    }
  });

  it("is deterministic: the same page and the same shots give the same desk, to the bit", () => {
    const play = () => {
      const r = new Run(123, { layout: makeLayout(6, 123) });
      const shots: Array<[number, number]> = [
        [1.0, 0.8],
        [1.2, 0.7],
        [0.8, 0.9],
      ];
      let k = 0;
      for (let t = 0; t < 12; t += STEP) {
        if (k < shots.length && Math.abs(t - (1 + k * 3)) < STEP / 2) r.fire(...shots[k++]!);
        r.step();
      }
      return { pos: snapshot(r.desk), score: r.score, stats: { ...r.stats } };
    };
    expect(play()).toEqual(play());
  });

  it("a full pull leaves the band at the speed the preview and the pilot assume", () => {
    const d = new Desk(null);
    const v = velocityOf(0.9, 1);
    const wad = d.launch("wad", REST.x, REST.y, v.vx, v.vy);
    d.step();
    const p = wad.body.getPosition();
    expect(p.x).toBeCloseTo(REST.x + v.vx * STEP, 9);
  });

  it("snaps a pencil hit hard into two halves that keep its motion", () => {
    const d = new Desk(onePencil(4));
    settle(d, 1);
    d.launch("wad", 2.5, 1.2, V_MAX, 0);
    let snapped = false;
    for (let t = 0; t < 0.5; t += STEP) {
      d.step();
      for (const i of d.impacts) {
        if (i.a?.kind === "pencil" && i.dvA >= PIECES.pencil.breakDv) snapped = true;
        if (i.b?.kind === "pencil" && i.dvB >= PIECES.pencil.breakDv) snapped = true;
      }
      d.impacts.length = 0;
    }
    expect(snapped).toBe(true);
    const r = new Run(5, { layout: onBook("pencil", 4, 5.0) });
    r.fire(0.02, 1);
    for (let t = 0; t < 1.5 && r.stats.snaps === 0; t += STEP) r.step();
    expect(r.stats.snaps).toBe(1);
    const halves = r.desk.things.filter((t) => !t.gone && (t.kind === "pencilTip" || t.kind === "pencilEnd"));
    expect(halves.map((h) => h.kind).sort()).toEqual(["pencilEnd", "pencilTip"]);
  });

  it("a direct hit knocks a doodle out; a gentle nudge doesn't", () => {
    const l = onBook("stub", 4, 5.85);
    const hard = new Run(1, { layout: l });
    hard.fire(0.1, 0.6);
    for (let t = 0; t < 2; t += STEP) hard.step();
    expect(hard.stats.kos).toBe(1);
    const soft = new Desk(l);
    settle(soft, 1);
    const mite = soft.things[0]!;
    soft.launch("wad", 3.2, 6.15, 1.2, 0);
    let worst = 0;
    for (let t = 0; t < 1; t += STEP) {
      soft.step();
      for (const i of soft.impacts) worst = Math.max(worst, i.a === mite ? i.dvA : i.b === mite ? i.dvB : 0);
      soft.impacts.length = 0;
    }
    expect(isMite(mite.kind)).toBe(true);
    expect(worst).toBeLessThan(2);
  });
});
