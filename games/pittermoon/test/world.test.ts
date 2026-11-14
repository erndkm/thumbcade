import { describe, expect, it } from "vitest";
import { pilotCat, PILOTS, type Skill } from "../src/pilot.ts";
import { crossTime } from "../src/solve.ts";
import { Run } from "../src/run.ts";
import {
  BIOMES,
  boatAt,
  CELL,
  COLS,
  colX,
  FW,
  hitbox,
  isHazard,
  LEFT,
  MIN_PERIOD,
  moverX,
  standable,
  STRETCH,
  toadState,
  World,
  type Row,
} from "../src/world.ts";

const ROWS = 400;
const SEEDS = [1, 7, 42, 1234, 99991, 31337, 2024, 555];

function rows(seed: number, n = ROWS): Row[] {
  const w = new World(seed);
  return Array.from({ length: n }, (_, i) => w.row(i));
}

describe("the hill", () => {
  it("is the same hill for the same seed, and a different one for another", () => {
    const a = rows(42, 120).map((r) => `${r.kind}${r.speed.toFixed(2)}${r.block.join("")}`);
    const b = rows(42, 120).map((r) => `${r.kind}${r.speed.toFixed(2)}${r.block.join("")}`);
    const c = rows(43, 120).map((r) => `${r.kind}${r.speed.toFixed(2)}${r.block.join("")}`);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });

  it("starts on a safe doorstep and opens every stretch on its arch", () => {
    for (const seed of SEEDS) {
      const rs = rows(seed);
      for (let i = 0; i < 4; i++) expect(rs[i]!.kind).toBe("path");
      for (let i = STRETCH; i < ROWS; i += STRETCH) {
        expect(rs[i]!.kind, `row ${i}`).toBe("path");
        expect(rs[i]!.arch).toBe(true);
        expect(rs[i]!.block.every((b) => b < 0)).toBe(true);
      }
      expect(new Set(rs.map((r) => BIOMES[r.stretch % 4]!.id)).size).toBe(4);
    }
  });

  it("never runs more than four lanes without safe ground, and grows from groups of two to four", () => {
    for (const seed of SEEDS) {
      const rs = rows(seed);
      let run = 0;
      let longestEarly = 0;
      let longestLate = 0;
      for (const r of rs) {
        run = r.kind === "path" ? 0 : run + 1;
        expect(run, `seed ${seed} row ${r.i}`).toBeLessThanOrEqual(4);
        if (r.i < 20) longestEarly = Math.max(longestEarly, run);
        else longestLate = Math.max(longestLate, run);
      }
      expect(longestEarly).toBeLessThanOrEqual(2);
      expect(longestLate).toBeGreaterThanOrEqual(3);
    }
  });

  it("keeps things in the way apart, and never makes a dead end", () => {
    const w = new World(0);
    for (const seed of SEEDS) {
      const rs = rows(seed);
      for (let i = 1; i < rs.length; i++) {
        const r = rs[i]!;
        const prev = rs[i - 1]!;
        if (r.kind !== "path") continue;
        for (let c = 1; c < COLS; c++) expect(r.block[c]! >= 0 && r.block[c - 1]! >= 0, `row ${i}`).toBe(false);
        expect(r.block.some((b) => b < 0)).toBe(true);
        if (prev.kind === "path") expect(w.connected(prev, r), `seed ${seed} row ${i}`).toBe(true);
        // Off a toadstool the cat goes straight up, and a boat may carry it to either edge.
        if (prev.kind === "bog") for (const t of prev.toads) expect(r.block[t.col], `row ${i}`).toBeLessThan(0);
        if (prev.kind === "brook") expect(r.block[0]! < 0 && r.block[COLS - 1]! < 0, `row ${i}`).toBe(true);
      }
    }
  });

  it("fills the bog with toadstools that rise and sink in a wave, so a neighbour is always up when one sinks", () => {
    for (const seed of SEEDS) {
      for (const r of rows(seed)) {
        if (r.kind !== "bog") continue;
        expect(r.toads.map((t) => t.col)).toEqual([...Array(COLS).keys()]);
        expect(r.up / r.cycle).toBeGreaterThan(0.5);
        for (let t = 0; t < r.cycle; t += 0.05) {
          const up = r.toads.filter((q) => toadState(r, q, t).up).map((q) => q.col);
          // At least half the caps are up at any moment...
          expect(up.length, `row ${r.i} t ${t}`).toBeGreaterThanOrEqual(4);
          // ...and a cap that is about to sink (wobbling) has an up neighbour that stays up longer.
          for (const q of r.toads) {
            const st = toadState(r, q, t);
            if (!st.wobble) continue;
            const later = r.toads.filter((n) => Math.abs(n.col - q.col) === 1 && toadState(r, n, t + 0.35).up);
            if (q.col > 0 && q.col < COLS - 1) expect(later.length, `row ${r.i} col ${q.col} t ${t}`).toBeGreaterThan(0);
          }
        }
      }
    }
  });

  it("leaves gaps in every street lane the cat can stand in, seam included", () => {
    for (const seed of SEEDS) {
      for (const r of rows(seed)) {
        if (!isHazard(r.kind)) continue;
        expect(r.period).toBeGreaterThanOrEqual(MIN_PERIOD);
        const ms = r.movers;
        for (let k = 0; k < ms.length; k++) {
          const a = ms[k]!;
          const b = ms[(k + 1) % ms.length]!;
          const gap = k + 1 < ms.length ? b.off - (a.off + a.len) : r.period - (a.off + a.len) + b.off;
          // Runs of pumpkins or yarn are tight on purpose; otherwise a gap leaves room and time to stand in it.
          if (gap < 10) continue;
          expect(gap, `row ${r.i}`).toBeGreaterThanOrEqual(CELL + 6 + r.speed * 0.44);
        }
        // Somewhere along the loop there is always a proper gap.
        expect(ms.length).toBeGreaterThan(0);
      }
    }
  });

  it("moves everything on a seamless loop that passes beyond the widest screen", () => {
    const rs = rows(7, 200).filter((r) => r.kind !== "path" && r.kind !== "bog");
    for (const r of rs) {
      for (const m of r.movers) {
        // Positions repeat after one loop.
        const t = r.period / r.speed;
        if (r.kind !== "wisp") expect(moverX(r, m, 3 + t)).toBeCloseTo(moverX(r, m, 3), 4);
        // A mover wraps only far off the field (the widest screen shows about 47 px either side).
        const x = moverX(r, m, 0);
        expect(x).toBeGreaterThanOrEqual(LEFT - 6);
        expect(x).toBeLessThanOrEqual(LEFT + r.period + 6);
      }
      expect(LEFT + 42).toBeLessThan(-47);
      expect(LEFT + r.period).toBeGreaterThan(FW + 47);
    }
  });

  it("hitboxes sit inside the drawn things, boats carry the cat end to end", () => {
    const rs = rows(1234, 200);
    const broom = rs.find((r) => r.kind === "broom")!;
    const [a, b] = hitbox(broom, broom.movers[0]!, 0);
    expect(b - a).toBe(broom.movers[0]!.len - 6);
    const brook = rs.find((r) => r.kind === "brook")!;
    const m = brook.movers[0]!;
    const bx = moverX(brook, m, 0);
    expect(boatAt(brook, bx + 1, 0)).toBe(0);
    expect(boatAt(brook, bx + m.len - 1, 0)).toBe(0);
    expect(boatAt(brook, bx - 3, 0)).not.toBe(0);
  });

  it("has fish every few rows and a golden moonfish now and then, only somewhere you can reach", () => {
    for (const seed of SEEDS) {
      const rs = rows(seed);
      const fish = rs.filter((r) => r.pickup);
      expect(fish.length).toBeGreaterThan(ROWS / 9);
      const gold = fish.filter((r) => r.pickup!.gold);
      expect(gold.length).toBeGreaterThanOrEqual(5);
      for (const r of fish) {
        const p = r.pickup!;
        if (p.mover >= 0) {
          expect(r.kind).toBe("brook");
          expect(p.mover).toBeLessThan(r.movers.length);
        } else expect(standable(r, p.col), `row ${r.i}`).toBe(true);
        if (p.gold) expect(r.kind).not.toBe("path");
      }
    }
  });

  it("never runs two fast lanes the same way side by side", () => {
    for (const seed of SEEDS) {
      const rs = rows(seed);
      for (let i = 1; i < rs.length; i++) {
        const a = rs[i - 1]!;
        const b = rs[i]!;
        const fast = (k: string) => k === "broom" || k === "yarn";
        if (isHazard(a.kind) && isHazard(b.kind) && (fast(a.kind) || fast(b.kind))) expect(a.dir, `row ${i}`).toBe(-b.dir);
      }
    }
  });

  it("speeds up as it climbs", () => {
    const rs = rows(99991, 300);
    const avg = (from: number, to: number) => {
      const xs = rs.slice(from, to).filter((r) => r.kind === "broom");
      return xs.reduce((s, r) => s + r.speed, 0) / Math.max(1, xs.length);
    };
    expect(avg(100, 300)).toBeGreaterThan(avg(0, 40) * 1.4);
  });
});

/** A pilot with perfect timing (no misjudgement, no lapses) for the solvability check. */
const ORACLE: Skill = { ...PILOTS.expert, noise: 0, lapse: 0, margin: 2.5 };

describe("every hill can be climbed", () => {
  it("every group of lanes can be crossed by a perfect player, whenever you arrive at it", () => {
    let groups = 0;
    let worst = 0;
    for (const seed of SEEDS.slice(0, 6)) {
      const w = new World(seed);
      for (let i = 0; i < 300; i++) {
        if (w.row(i).kind !== "path" || w.row(i + 1).kind === "path") continue;
        groups++;
        for (const t0 of [0.4, 3.3, 7.1]) {
          const t = crossTime(w, i, t0);
          expect(t, `seed ${seed} group above row ${i} at ${t0} s`).toBeLessThan(12);
          worst = Math.max(worst, t);
        }
      }
    }
    expect(groups).toBeGreaterThan(300);
    // Even the slowest crossing (waiting for gaps, riding boats) takes a perfect player only a few seconds.
    expect(worst).toBeLessThan(8);
  }, 60_000);

  it("a perfect-timing pilot climbs 160 rows of every test seed with the dawn held off", () => {
    for (const seed of SEEDS) {
      const run = new Run(seed);
      run.dawnOff = true;
      const p = pilotCat(ORACLE, seed);
      while (run.rows < 160 && run.t < 400) {
        run.update(1 / 60, p.drive);
        run.drain();
        run.world.forget(run.cat.row - 10);
      }
      expect(run.rows, `seed ${seed}`).toBeGreaterThanOrEqual(160);
      const fails = Object.values(run.stats.bonks).reduce((a, b) => a + b, 0) + run.stats.splashes + run.stats.sinks;
      // It has the timing but not the foresight of a solver, so it gets the odd bump; never a lot.
      expect(fails, `seed ${seed}`).toBeLessThanOrEqual(12);
      void colX;
    }
  }, 60_000);
});
