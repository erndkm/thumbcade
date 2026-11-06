import { createRng } from "@thumbcade-games/kit/rng";
import { describe, expect, it } from "vitest";
import { CAT, clampMallet, CORNER, CRITTER, DT, GX0, GX1, L, MALLET_R, MAX_PUCK, PUCK_R, Table, W, type Hit } from "../src/physics.ts";

/** Is a puck centre inside the rink (boards and rounded corners), with a hair of tolerance? */
function inside(x: number, y: number): boolean {
  const e = 1e-6;
  if (x < PUCK_R - e || x > W - PUCK_R + e) return false;
  const inMouth = x > GX0 && x < GX1;
  if (!inMouth && (y < PUCK_R - e || y > L - PUCK_R + e)) return false;
  if (inMouth && (y < -e || y > L + e)) return false;
  for (const [cx, cy, sx, sy] of [
    [CORNER, CORNER, -1, -1],
    [W - CORNER, CORNER, 1, -1],
    [CORNER, L - CORNER, -1, 1],
    [W - CORNER, L - CORNER, 1, 1],
  ] as const) {
    if ((x - cx) * sx > 0 && (y - cy) * sy > 0 && Math.hypot(x - cx, y - cy) > CORNER - PUCK_R + 1e-5) return false;
  }
  return true;
}

function parkMallets(t: Table): void {
  // Out of the way, in the far corners of each half.
  for (const [i, x, y] of [
    [CAT, 12, L - 12],
    [CRITTER, W - 12, 12],
  ] as const) {
    const c = clampMallet(i, x, y);
    const m = t.mallets[i];
    m.x = m.tx = c.x;
    m.y = m.ty = c.y;
  }
}

describe("the rink", () => {
  it("keeps the stone inside at any speed and step size, and only lets it out through a mouth", () => {
    const rng = createRng(42);
    let goals = 0;
    for (let n = 0; n < 1500; n++) {
      const t = new Table();
      parkMallets(t);
      t.drop(rng.range(PUCK_R + 1, W - PUCK_R - 1), rng.range(40, L - 40));
      const a = rng() * Math.PI * 2;
      t.puck.vx = Math.cos(a) * MAX_PUCK;
      t.puck.vy = Math.sin(a) * MAX_PUCK;
      // Mallets wander too, so the puck meets moving ones.
      const dt = n % 3 === 0 ? 1 / 30 : DT;
      for (let s = 0; s < 3 / dt; s++) {
        if (s % 20 === 0) {
          t.mallets[CAT].tx = rng.range(0, W);
          t.mallets[CAT].ty = rng.range(L / 2, L);
          t.mallets[CRITTER].tx = rng.range(0, W);
          t.mallets[CRITTER].ty = rng.range(0, L / 2);
        }
        const hits = t.step(dt);
        const goal = hits.find((h): h is Extract<Hit, { kind: "goal" }> => h.kind === "goal");
        if (goal) {
          goals++;
          expect(goal.x).toBeGreaterThan(GX0);
          expect(goal.x).toBeLessThan(GX1);
          break;
        }
        expect(inside(t.puck.x, t.puck.y), `run ${n} step ${s} at ${t.puck.x.toFixed(2)},${t.puck.y.toFixed(2)}`).toBe(true);
        // The sweep alone kept it in: the safety net never had to step in.
        expect(t.corrections, `run ${n} step ${s}`).toBe(0);
        expect(Math.hypot(t.puck.vx, t.puck.vy)).toBeLessThanOrEqual(MAX_PUCK + 1e-6);
      }
    }
    expect(goals).toBeGreaterThan(100);
  });

  it("never lets a fast stone pass through a mallet in its way", () => {
    const rng = createRng(7);
    for (let n = 0; n < 400; n++) {
      const t = new Table();
      parkMallets(t);
      const m = t.mallets[CRITTER];
      m.x = m.tx = rng.range(20, W - 20);
      m.y = m.ty = rng.range(20, 70);
      // Aim straight at the mallet from below, at full speed, with a long step.
      const px = m.x + rng.range(-6, 6);
      t.drop(px, m.y + 60);
      const d = Math.hypot(m.x - px, -60);
      t.puck.vx = ((m.x - px) / d) * MAX_PUCK;
      t.puck.vy = (-60 / d) * MAX_PUCK;
      let touched = false;
      for (let s = 0; s < 20 && !touched; s++) touched = t.step(1 / 20).some((h) => h.kind === "mallet");
      expect(touched, `shot ${n}`).toBe(true);
      expect(Math.hypot(t.puck.x - m.x, t.puck.y - m.y)).toBeGreaterThanOrEqual(PUCK_R + MALLET_R - 1e-3);
    }
  });

  it("a faster swing sends the stone faster, never past the cap", () => {
    const speedAfter = (swing: number) => {
      const t = new Table(swing);
      parkMallets(t);
      const m = t.mallets[CAT];
      m.x = W / 2;
      m.y = L - 40;
      m.tx = W / 2;
      m.ty = L / 2 + 2;
      t.drop(W / 2, L - 40 - MALLET_R - PUCK_R - 6);
      for (let s = 0; s < 60; s++) if (t.step().some((h) => h.kind === "mallet")) break;
      return Math.hypot(t.puck.vx, t.puck.vy);
    };
    const slow = speedAfter(90);
    const mid = speedAfter(180);
    const fast = speedAfter(600);
    expect(slow).toBeGreaterThan(90);
    expect(mid).toBeGreaterThan(slow * 1.5);
    expect(fast).toBeLessThanOrEqual(MAX_PUCK + 1e-6);
    expect(fast).toBeGreaterThan(mid);
  });

  it("bounces off the side boards at the same angle, a little slower", () => {
    const t = new Table();
    parkMallets(t);
    t.drop(30, L / 2 - 20);
    t.puck.vx = -150;
    t.puck.vy = -150;
    let hit: Hit | undefined;
    for (let s = 0; s < 240 && !hit; s++) hit = t.step().find((h) => h.kind === "rail");
    expect(hit && hit.kind === "rail" && hit.side).toBe("left");
    expect(t.puck.vx).toBeGreaterThan(0);
    const ratio = Math.abs(t.puck.vx / t.puck.vy);
    expect(ratio).toBeGreaterThan(0.75);
    expect(ratio).toBeLessThan(0.95);
  });

  it("scores through the middle of the mouth and bounces off a post", () => {
    const shoot = (x: number) => {
      const t = new Table();
      parkMallets(t);
      t.drop(x, 40);
      t.puck.vy = -200;
      for (let s = 0; s < 240; s++) {
        const h = t.step().find((e) => e.kind === "goal" || e.kind === "post" || e.kind === "rail");
        if (h) return h.kind;
      }
      return "none";
    };
    expect(shoot(W / 2)).toBe("goal");
    expect(shoot(GX0 + PUCK_R + 1)).toBe("goal");
    expect(shoot(GX0)).toBe("post");
    expect(shoot(GX0 - PUCK_R - 2)).toBe("rail");
  });

  it("keeps each mallet in its own half and off the corners", () => {
    expect(clampMallet(CAT, W / 2, 10).y).toBeGreaterThan(L / 2);
    expect(clampMallet(CRITTER, W / 2, L - 10).y).toBeLessThan(L / 2);
    const c = clampMallet(CAT, 0, L);
    expect(Math.hypot(c.x - CORNER, c.y - (L - CORNER))).toBeLessThanOrEqual(CORNER - MALLET_R + 1e-9);
  });

  it("a mallet pressing the stone into a corner never pushes it out", () => {
    const t = new Table();
    parkMallets(t);
    t.drop(PUCK_R + 2, L - PUCK_R - 2);
    const m = t.mallets[CAT];
    m.x = 40;
    m.y = L - 40;
    m.tx = 0;
    m.ty = L;
    for (let s = 0; s < 480; s++) {
      t.step();
      expect(inside(t.puck.x, t.puck.y)).toBe(true);
    }
  });

  it("is deterministic", () => {
    const play = () => {
      const t = new Table();
      t.drop(50, 150);
      const rng = createRng(3);
      for (let s = 0; s < 2400; s++) {
        if (s % 30 === 0) {
          t.mallets[CAT].tx = rng.range(0, W);
          t.mallets[CAT].ty = rng.range(L / 2, L);
          t.mallets[CRITTER].tx = rng.range(0, W);
          t.mallets[CRITTER].ty = rng.range(0, L / 2);
        }
        t.step();
        if (!t.live) t.drop(W / 2, L / 2);
      }
      return [t.puck.x, t.puck.y, t.puck.vx, t.puck.vy, t.mallets[0].x, t.mallets[1].y];
    };
    expect(play()).toEqual(play());
  });
});
