/**
 * The cascade in world units, printed on three plates: rock (teal + pink screens, a deep slate), water (teal
 * screens, deeper bands denser), falls (paper knocked out of everything, teal streaks running down), the koi
 * (pink + yellow = vermilion, white patches knocked out), the heron, branches and dragonflies.
 */
import type { Press } from "./riso.ts";
import type { Cam } from "./land.ts";
import type { Sky } from "./sky.ts";
import { KOI_LEN, LIP_D, type Branch, type Fly, type Heron, type Koi, type Pool, type World } from "./sim.ts";

export interface View {
  press: Press;
  W: number;
  H: number;
  cam: Cam;
  sky: Sky;
  time: number;
  reduced: boolean;
}

export type Plate = "teal" | "pink" | "yellow";
export const PLATES: Plate[] = ["teal", "pink", "yellow"];

/** Every plate set to world units. */
export function worldPlates(v: View): Record<Plate, CanvasRenderingContext2D> {
  const { press, cam, W, H } = v;
  const out = {} as Record<Plate, CanvasRenderingContext2D>;
  for (const p of PLATES) {
    const c = press.plate(p);
    press.transform(c, cam.z, 0, 0, cam.z, W / 2 - cam.x * cam.z, H / 2 - cam.y * cam.z);
    out[p] = c;
  }
  return out;
}

export function visibleX(v: View, margin = 60): [number, number] {
  const half = v.W / 2 / v.cam.z;
  return [v.cam.x - half - margin, v.cam.x + half + margin];
}

function knock(c: CanvasRenderingContext2D, draw: () => void): void {
  c.globalCompositeOperation = "destination-out";
  c.fillStyle = "#000";
  c.strokeStyle = "#000";
  draw();
  c.globalCompositeOperation = "source-over";
}

function hash(n: number, seed: number): number {
  let h = Math.imul(n | 0, 374761393) ^ Math.imul(seed | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// -----------------------------------------------------------------------------------------------
// Rock, water, falls
// -----------------------------------------------------------------------------------------------

function rockPath(c: CanvasRenderingContext2D, w: World, pools: Pool[], bottom: number): void {
  const first = pools[0]!;
  c.beginPath();
  c.moveTo(first.x0 - 900, bottom);
  c.lineTo(first.x0 - 900, first.s + LIP_D);
  for (let i = 0; i < pools.length; i++) {
    const p = pools[i]!;
    c.lineTo(p.x0, p.s + LIP_D);
    for (let x = p.x0 + 6; x < p.x1; x += 8) c.lineTo(x, w.floorOf(p, x));
    c.lineTo(p.x1, w.floorOf(p, p.x1));
    c.lineTo(p.x1, p.s - p.hFall + LIP_D);
  }
  const last = pools[pools.length - 1]!;
  c.lineTo(last.x1 + 1400, last.s - last.hFall + LIP_D);
  c.lineTo(last.x1 + 1400, bottom);
  c.closePath();
}

function waterPath(c: CanvasRenderingContext2D, w: World, p: Pool): void {
  c.beginPath();
  c.moveTo(p.x0, p.s);
  c.lineTo(p.x1, p.s);
  c.lineTo(p.x1, w.floorOf(p, p.x1));
  for (let x = p.x1 - 4; x > p.x0; x -= 8) c.lineTo(x, w.floorOf(p, x));
  c.lineTo(p.x0, p.s + LIP_D + 2);
  c.closePath();
}

/** The sheet of water pouring off the lip at x, from the upper surface `top` down to `base`. */
function sheetPath(c: CanvasRenderingContext2D, x: number, top: number, base: number): void {
  c.beginPath();
  c.moveTo(x + 7, top - 2);
  c.lineTo(x + 2, top + LIP_D + 1);
  c.lineTo(x - 1, base + 4);
  const n = 10;
  for (let i = n; i >= 0; i--) {
    const t = i / n;
    c.lineTo(x - 7 - 26 * t ** 0.6, top + (base - top) * t + (i === n ? 4 : 0));
  }
  c.closePath();
}

export function drawCascade(v: View, w: World, pl: Record<Plate, CanvasRenderingContext2D>): void {
  const [x0, x1] = visibleX(v, 120);
  const pools = w.pools.filter((p) => p.x1 > x0 - 200 && p.x0 < x1 + 200);
  if (!pools.length) return;
  const bottom = v.cam.y + v.H / 2 / v.cam.z + 60;
  const { press, sky, time } = v;
  const { teal, pink, yellow } = pl;

  // Rock: a slate of teal and pink screens, with a few knocked-out strata.
  // Rock: heavy teal and pink screens overprinted, a slate-plum nothing like the water's clear teal, crossed by
  // straight strata and a few cracks. It hides the hills behind it.
  for (const c of [pink, yellow]) {
    rockPath(c, w, pools, bottom);
    c.globalCompositeOperation = "destination-out";
    c.fillStyle = "#000";
    c.fill();
    c.globalCompositeOperation = "source-over";
  }
  rockPath(teal, w, pools, bottom);
  teal.fillStyle = press.screen("teal", 0.72 + sky.dark * 0.2);
  teal.fill();
  rockPath(pink, w, pools, bottom);
  pink.fillStyle = press.screen("pink", 0.62);
  pink.fill();
  // Only the visible part of the strata grid is drawn; the grid itself is fixed to the world.
  const topY = Math.max(Math.min(...pools.map((p) => p.s - p.hFall)) - 20, v.cam.y - v.H / 2 / v.cam.z - 20);
  for (const c of [teal, pink]) {
    c.save();
    rockPath(c, w, pools, bottom);
    c.clip();
    knock(c, () => {
      // Strata: straight, gently tilted beds, broken into lengths.
      c.lineWidth = 1.3;
      c.beginPath();
      // Beds of uneven thickness, each bed broken into blocks by short vertical joints.
      const ROW = 17;
      const CELL = 70;
      const slope = -0.04;
      for (let row = Math.floor(topY / ROW); row * ROW < bottom + 40; row++) {
        const y0 = row * ROW + (hash(row, 9) - 0.5) * 6;
        const y1 = (row + 1) * ROW + (hash(row + 1, 9) - 0.5) * 6;
        for (let cell = Math.floor((x0 - 60) / CELL); cell * CELL < x1 + 60; cell++) {
          const a = cell * CELL + hash(cell, row * 7 + 3) * 22;
          const b = (cell + 1) * CELL - 4 - hash(cell, row * 7 + 4) * 26;
          if (hash(cell, row * 7 + 5) < 0.18) continue;
          c.moveTo(a, y0 + a * slope);
          c.lineTo(b, y0 + b * slope);
          // A joint down to the next bed.
          if (hash(cell, row * 7 + 6) < 0.55) {
            const jx = b + 2;
            c.moveTo(jx, y0 + jx * slope);
            c.lineTo(jx - 2, y1 + jx * slope - 3);
          }
        }
      }
      c.stroke();
      // Cracks: zig-zags down each wall.
      c.lineWidth = 1.6;
      c.beginPath();
      for (const p of pools) {
        for (let k = 0; k < 2; k++) {
          let x = p.x1 + 10 + hash(k, p.i * 5 + 1) * 40;
          let y = p.s - p.hFall + 14 + hash(k, p.i * 5 + 2) * 30;
          c.moveTo(x, y);
          for (let j = 0; j < 6; j++) {
            x += (hash(j + k * 9, p.i * 5 + 3) - 0.5) * 18;
            y += 10 + hash(j + k * 9, p.i * 5 + 4) * 14;
            c.lineTo(x, y);
          }
        }
      }
      c.stroke();
    });
    c.restore();
  }
  // Moss (yellow over the slate) on the shoulders by each lip.
  for (const p of pools) {
    const top = p.s - p.hFall;
    yellow.fillStyle = press.screen("yellow", 0.6);
    yellow.beginPath();
    for (let k = 0; k < 5; k++) {
      const mx = p.x1 + 6 + k * 13 + hash(k, p.i + 40) * 6;
      const my = top + LIP_D + 6 + hash(k, p.i + 41) * 10;
      yellow.moveTo(mx + 8, my);
      yellow.arc(mx, my, 6 + hash(k, p.i + 42) * 5, 0, Math.PI * 2);
    }
    yellow.fill();
  }

  // Water: the clear, bright element. A light teal screen, a little denser in two bands below.
  for (const p of pools) {
    waterPath(teal, w, p);
    // Clear the rock's ink where water sits (the floor line is shared).
    for (const c of [teal, pink, yellow]) {
      if (c !== teal) waterPath(c, w, p);
      c.globalCompositeOperation = "destination-out";
      c.fill();
      c.globalCompositeOperation = "source-over";
    }
    waterPath(teal, w, p);
    teal.fillStyle = press.screen("teal", 0.22 + sky.dark * 0.25);
    teal.fill();
    teal.save();
    teal.clip();
    teal.fillStyle = press.screen("teal", 0.12);
    teal.fillRect(p.x0, p.s + 80, p.x1 - p.x0, p.depth + 40);
    teal.fillStyle = press.screen("teal", 0.16);
    teal.fillRect(p.x0, p.s + 190, p.x1 - p.x0, p.depth + 40);
    teal.restore();
    // Shafts of light: yellow overprinted on the teal, drifting slowly.
    yellow.save();
    waterPath(yellow, w, p);
    yellow.clip();
    yellow.fillStyle = press.screen("yellow", 0.22 * (1 - sky.night * 0.8));
    yellow.beginPath();
    for (let k = 0; k < 2; k++) {
      const sx = p.x0 + ((hash(k, p.i * 3 + 9) * (p.x1 - p.x0) + time * 6) % (p.x1 - p.x0));
      const wd = 8 + hash(k, p.i * 3 + 10) * 10;
      yellow.moveTo(sx, p.s);
      yellow.lineTo(sx + wd, p.s);
      yellow.lineTo(sx - 50 + wd * 2.4, p.s + p.depth);
      yellow.lineTo(sx - 50, p.s + p.depth);
      yellow.closePath();
    }
    yellow.fill();
    yellow.restore();
    // Bubbles rising from the bed, paper knocked out of the teal.
    knock(teal, () => {
      teal.beginPath();
      for (let k = 0; k < 6; k++) {
        const bx = p.x0 + 30 + hash(k, p.i * 9 + 21) * (p.x1 - p.x0 - 80);
        const t = (time * (v.reduced ? 0.08 : 0.22) + hash(k, p.i * 9 + 22)) % 1;
        const fy = w.floorOf(p, bx);
        const by = fy - 6 - t * (fy - p.s - 10);
        const r = 1.2 + hash(k, p.i * 9 + 23) * 1.6 + t * 0.8;
        teal.moveTo(bx + Math.sin(t * 12 + k) * 2 + r, by);
        teal.arc(bx + Math.sin(t * 12 + k) * 2, by, r, 0, Math.PI * 2);
      }
      teal.fill();
    });
    // The surface: a heavy teal rule with small crests, ripple dashes just under it drifting downstream, glints.
    teal.fillStyle = press.solid("teal");
    teal.beginPath();
    const crest = v.reduced ? 0 : time * 1.6;
    teal.moveTo(p.x0, p.s + 1.2);
    for (let x = p.x0; x <= p.x1; x += 6) teal.lineTo(x, p.s - 1 - Math.max(0, Math.sin(x * 0.11 + crest + p.i)) * 1.6);
    teal.lineTo(p.x1, p.s + 1.2);
    teal.closePath();
    teal.fill();
    const drift = (v.reduced ? 0 : time * 14) % 40;
    for (let k = 0; k < 14; k++) {
      const rx = p.x0 + ((hash(k, p.i + 31) * (p.x1 - p.x0) - drift * (1 + (k % 3) * 0.4) + 4000) % (p.x1 - p.x0));
      const ry = p.s + 6 + (k % 3) * 6 + hash(k, p.i + 32) * 3;
      const len = 5 + hash(k, p.i + 33) * 10;
      teal.fillRect(rx, ry, len, 1.2);
    }
    knock(teal, () => {
      for (let k = 0; k < 7; k++) {
        const gx = p.x0 + ((hash(k, p.i + 77) * (p.x1 - p.x0) - time * 18 + 4000) % (p.x1 - p.x0));
        teal.fillRect(gx, p.s - 1.6, 6 + hash(k, p.i + 78) * 10, 2.2);
      }
    });
    // Boulders on the bed and pebbles at the lip, half sunk: rock ink with a paper rim catching the light.
    const stones: Array<[number, number, number]> = [];
    for (let k = 0; k < 6; k++) {
      const bx = p.x0 + 40 + hash(k, p.i * 11 + 1) * (p.x1 - p.x0 - 90);
      stones.push([bx, w.floorOf(p, bx) + 3, 7 + hash(k, p.i * 11 + 2) * 9]);
    }
    for (let k = 0; k < 3; k++) stones.push([p.x0 + 4 + k * 9, p.s + LIP_D + 3, 3.5 + hash(k, p.i * 11 + 3) * 2.5]);
    const stonePath = (c: CanvasRenderingContext2D) => {
      c.beginPath();
      for (const [sx, sy, r] of stones) {
        c.moveTo(sx - r * 1.3, sy);
        c.quadraticCurveTo(sx - r * 1.2, sy - r * 0.9, sx - r * 0.2, sy - r);
        c.quadraticCurveTo(sx + r * 1.1, sy - r * 0.95, sx + r * 1.3, sy);
        c.closePath();
      }
    };
    for (const c of [teal, yellow]) {
      stonePath(c);
      c.globalCompositeOperation = "destination-out";
      c.fill();
      c.globalCompositeOperation = "source-over";
    }
    stonePath(teal);
    teal.fillStyle = press.screen("teal", 0.72 + sky.dark * 0.2);
    teal.fill();
    stonePath(pink);
    pink.fillStyle = press.screen("pink", 0.62);
    pink.fill();
    for (const c of [teal, pink]) {
      knock(c, () => {
        c.lineWidth = 1.2;
        c.beginPath();
        for (const [sx, sy, r] of stones) {
          c.moveTo(sx - r * 0.9, sy - r * 0.62);
          c.quadraticCurveTo(sx - r * 0.3, sy - r * 0.95, sx + r * 0.4, sy - r * 0.85);
        }
        c.stroke();
      });
    }
  }

  // Falls: paper knocked out of every plate, teal streaks running down, foam where they land.
  for (const p of pools) {
    const up = p.s - p.hFall;
    for (const c of [teal, pink, yellow]) {
      sheetPath(c, p.x1, up, p.s);
      c.globalCompositeOperation = "destination-out";
      c.fill();
      c.globalCompositeOperation = "source-over";
    }
    sheetPath(teal, p.x1, up, p.s);
    teal.fillStyle = press.screen("teal", 0.16);
    teal.fill();
    teal.save();
    teal.clip();
    teal.strokeStyle = press.solid("teal");
    teal.lineWidth = 0.9;
    teal.beginPath();
    const speed = v.reduced ? 60 : 160;
    for (let k = 0; k < 6; k++) {
      const lx = p.x1 - 2 - k * 3.6;
      const ph = hash(k, p.i + 5) * 60;
      for (let y = up - 60 + ((time * speed + ph) % 60); y < p.s; y += 60) {
        teal.moveTo(lx - (y - up) * 0.04 * k, y);
        teal.lineTo(lx - (y + 26 - up) * 0.04 * k, y + 26);
      }
    }
    teal.stroke();
    teal.restore();
    // Foam: churning paper blobs at the foot.
    const fx = p.x1 - 20;
    const big = Math.min(1.6, 0.7 + p.hFall / 160);
    for (const c of [teal, pink, yellow]) {
      knock(c, () => {
        c.beginPath();
        for (let k = 0; k < 9; k++) {
          const a = time * (v.reduced ? 0.6 : 2.2) + k * 0.9;
          const bx = fx - 26 * big + k * 7 * big + Math.sin(a) * 3;
          const by = p.s - 3 + Math.cos(a * 1.3) * 2 - (k % 3) * 3 * big;
          const r = (5 + Math.sin(a * 0.7 + k) * 2) * big;
          c.moveTo(bx + r, by);
          c.arc(bx, by, r, 0, Math.PI * 2);
        }
        c.fill();
        // Mist rising off the plunge, in halftone.
        c.fillStyle = press.screen("teal", 0.5);
        c.beginPath();
        for (let k = 0; k < 4; k++) {
          const t = (time * (v.reduced ? 0.05 : 0.18) + k / 4) % 1;
          const r = (8 + t * 18) * big;
          const mx = fx - 10 + Math.sin(k * 2.1 + time * 0.3) * 10;
          const my = p.s - 10 - t * 50 * big;
          c.moveTo(mx + r, my);
          c.arc(mx, my, r, 0, Math.PI * 2);
        }
        c.fill();
      });
    }
    // Churn below the foam: bubbles in the plunge pool.
    knock(teal, () => {
      teal.beginPath();
      for (let k = 0; k < 9; k++) {
        const t = (time * 0.5 + hash(k, p.i + 90)) % 1;
        const bx = fx - 30 + hash(k, p.i + 91) * 40;
        const by = p.s + 10 + (1 - t) * 70;
        const r = 1 + hash(k, p.i + 92) * 2;
        teal.moveTo(bx + r, by);
        teal.arc(bx, by, r, 0, Math.PI * 2);
      }
      teal.fill();
    });
  }
}

// -----------------------------------------------------------------------------------------------
// Things in the stream
// -----------------------------------------------------------------------------------------------

/** A maple on the upper bank, one branch reaching out over the fall: the hazard is the branch. */
export function drawBranch(v: View, b: Branch, p: Pool, pl: Record<Plate, CanvasRenderingContext2D>): void {
  const { press } = v;
  const sway = v.reduced ? 0 : Math.sin(v.time * 0.8 + b.seed * 9) * 1.2;
  const up = p.s - p.hFall;
  const tx = b.x1 + 66;
  const path = (c: CanvasRenderingContext2D) => {
    c.beginPath();
    // Trunk, rising from the bank of the upper pool.
    c.moveTo(tx + 7, up + 2);
    c.quadraticCurveTo(tx + 2, (up + b.y) / 2, tx + 1, b.y - 18);
    c.lineTo(tx - 7, b.y - 20);
    c.quadraticCurveTo(tx - 6, (up + b.y) / 2, tx - 5, up + 2);
    c.closePath();
    // The branch.
    c.moveTo(tx - 2, b.y - b.th * 0.9);
    c.quadraticCurveTo((b.x0 + b.x1) / 2, b.y - b.th * 0.6 + sway, b.x0, b.y - 1 + sway);
    c.lineTo(b.x0 - 2, b.y + 1.5 + sway);
    c.quadraticCurveTo((b.x0 + b.x1) / 2, b.y + b.th * 0.5 + sway, tx - 2, b.y + b.th * 0.9);
    c.closePath();
    // Twigs.
    for (let k = 0; k < 4; k++) {
      const x = b.x0 + 10 + k * ((b.x1 - b.x0) / 4);
      c.moveTo(x, b.y + sway);
      c.lineTo(x - 9, b.y - 10 - hash(k, b.seed * 99) * 6 + sway);
      c.lineTo(x - 6, b.y - 11 - hash(k, b.seed * 99) * 6 + sway);
      c.lineTo(x + 3, b.y - 1 + sway);
      c.closePath();
    }
  };
  path(pl.teal);
  pl.teal.fillStyle = press.solid("teal");
  pl.teal.fill();
  path(pl.pink);
  pl.pink.fillStyle = press.screen("pink", 0.7);
  pl.pink.fill();
  // The crown: vermilion (pink and yellow), with a darker underside.
  const crown = (c: CanvasRenderingContext2D) => {
    c.beginPath();
    for (let k = 0; k < 7; k++) {
      const cx = tx - 30 + hash(k, b.seed * 70) * 56;
      const cy = b.y - 28 - hash(k, b.seed * 71) * 26 + sway * 0.6;
      const r = 13 + hash(k, b.seed * 72) * 10;
      c.moveTo(cx + r, cy);
      c.arc(cx, cy, r, 0, Math.PI * 2);
    }
  };
  crown(pl.pink);
  pl.pink.fillStyle = press.screen("pink", 0.85);
  pl.pink.fill();
  crown(pl.yellow);
  pl.yellow.fillStyle = press.solid("yellow");
  pl.yellow.fill();
  pl.teal.save();
  crown(pl.teal);
  pl.teal.clip();
  pl.teal.fillStyle = press.screen("teal", 0.3);
  pl.teal.fillRect(tx - 70, b.y - 34, 140, 40);
  pl.teal.restore();
  // Leaves along the branch.
  for (let k = 0; k < 7; k++) {
    const lx = b.x0 + 4 + hash(k, b.seed * 50) * (b.x1 - b.x0 + 40);
    const ly = b.y - 6 + hash(k, b.seed * 51) * 12 + sway;
    const r = 4 + hash(k, b.seed * 52) * 2;
    const rot = hash(k, b.seed * 53) * 6;
    maple(pl.pink, press.solid("pink"), lx, ly, r, rot);
    maple(pl.yellow, press.screen("yellow", 0.85), lx, ly, r, rot);
  }
}

/** A small leaf: an almond with a stem, `tumble` squashing it as it turns over in the air. */
export function maple(c: CanvasRenderingContext2D, fill: string | CanvasPattern, x: number, y: number, r: number, rot: number, tumble = 1): void {
  c.save();
  c.translate(x, y);
  c.rotate(rot);
  c.scale(1, tumble);
  c.fillStyle = fill;
  c.beginPath();
  c.moveTo(-r, 0);
  c.quadraticCurveTo(0, -r * 0.75, r, 0);
  c.quadraticCurveTo(0, r * 0.75, -r, 0);
  c.closePath();
  c.fill();
  c.fillRect(-r * 1.5, -0.4, r * 0.6, 0.8);
  c.restore();
}

export function drawFly(v: View, f: Fly, pl: Record<Plate, CanvasRenderingContext2D>): void {
  if (f.taken) return;
  const { press, time } = v;
  const fx = f.x + Math.sin(time * 1.3 + f.ph) * 4;
  const fy = f.y + Math.sin(time * 2.2 + f.ph) * 5;
  for (const p of PLATES) {
    pl[p].save();
    pl[p].translate(fx, fy);
    pl[p].scale(1.5, 1.5);
  }
  const x = 0;
  const y = 0;
  const flap = v.reduced ? 0.8 : 0.55 + 0.45 * Math.abs(Math.sin(time * 30 + f.ph));
  pl.yellow.fillStyle = press.screen("yellow", 0.9);
  pl.yellow.beginPath();
  pl.yellow.ellipse(x - 1, y - 3 * flap, 6, 2.4 * flap, -0.3, 0, Math.PI * 2);
  pl.yellow.ellipse(x + 2, y - 3 * flap, 6, 2.4 * flap, 0.3, 0, Math.PI * 2);
  pl.yellow.fill();
  pl.teal.fillStyle = press.screen("teal", 0.3);
  pl.teal.beginPath();
  pl.teal.ellipse(x - 1, y - 3 * flap, 6, 2.4 * flap, -0.3, 0, Math.PI * 2);
  pl.teal.fill();
  pl.teal.fillStyle = press.solid("teal");
  pl.teal.fillRect(x - 7, y - 0.8, 13, 1.6);
  pl.teal.beginPath();
  pl.teal.arc(x + 6.5, y, 1.8, 0, Math.PI * 2);
  pl.teal.fill();
  for (const p of PLATES) pl[p].restore();
}

export function drawHeron(v: View, hr: Heron, p: Pool, pl: Record<Plate, CanvasRenderingContext2D>): void {
  for (const k of PLATES) {
    pl[k].save();
    // Drawn 1.3× about its feet; the strike target is mapped back so the bill still lands where the sim says.
    pl[k].translate(hr.x, p.s);
    pl[k].scale(HERON_DRAW, HERON_DRAW);
    pl[k].translate(-hr.x, -p.s);
  }
  heronBody(v, hr, p, pl);
  for (const k of PLATES) pl[k].restore();
}

const HERON_DRAW = 1.3;

function heronBody(v: View, hr0: Heron, p: Pool, pl: Record<Plate, CanvasRenderingContext2D>): void {
  const { press } = v;
  // The aim in the scaled frame.
  const hr = { ...hr0, aimX: hr0.x + (hr0.aimX - hr0.x) / HERON_DRAW, aimY: p.s + (hr0.aimY - p.s) / HERON_DRAW };
  const f = hr.face;
  const s = p.s;
  const x = hr.x;
  // Pose: where the shoulders and the head sit.
  const shoulder: [number, number] = [x + f * 7, s - 46];
  let head: [number, number];
  let crouch = 0;
  if (hr.state === "cock") {
    const k = Math.min(1, hr.t / 0.25);
    head = [x - f * 3 * k + f * 6 * (1 - k), s - 62 + 8 * k];
    crouch = 4 * k;
  } else if (hr.state === "strike") {
    const k = Math.min(1, hr.t / 0.08);
    head = [x + f * 6 + (hr.aimX - x - f * 6) * k, s - 62 + (hr.aimY - s + 62) * k];
    crouch = 6 * (1 - Math.min(1, hr.t / 0.3));
  } else if (hr.state === "catch") {
    const k = Math.min(1, hr.t / 0.5);
    head = [hr.aimX + (x + f * 14 - hr.aimX) * k, hr.aimY + (s - 58 - hr.aimY) * k];
  } else {
    const k = hr.state === "rest" ? Math.min(1, hr.t / 0.4) : 1;
    head = [x + f * 6, s - 66 + (1 - k) * 8 + Math.sin(v.time * 0.9 + x) * 0.8];
  }
  const sh: [number, number] = [shoulder[0], shoulder[1] + crouch];
  // Legs, into the water.
  pl.teal.fillStyle = press.solid("teal");
  pl.teal.fillRect(x - 3, s - 32 + crouch, 1.3, 40);
  pl.teal.fillRect(x + 1.5, s - 32 + crouch, 1.3, 40);
  // Body: slate (teal + pink screens), tail feathers trailing back.
  const body = (c: CanvasRenderingContext2D) => {
    c.beginPath();
    c.ellipse(x - f * 2, s - 38 + crouch, 15, 8.5, f * -0.35, 0, Math.PI * 2);
    c.moveTo(x - f * 14, s - 36 + crouch);
    c.lineTo(x - f * 24, s - 28 + crouch);
    c.lineTo(x - f * 10, s - 32 + crouch);
    c.closePath();
  };
  body(pl.teal);
  pl.teal.fillStyle = press.screen("teal", 0.55);
  pl.teal.fill();
  body(pl.pink);
  pl.pink.fillStyle = press.screen("pink", 0.3);
  pl.pink.fill();
  // Neck: a curve from the shoulder to the head.
  const neck = (c: CanvasRenderingContext2D) => {
    c.beginPath();
    c.moveTo(sh[0], sh[1]);
    const mx = (sh[0] + head[0]) / 2 - f * 6;
    const my = (sh[1] + head[1]) / 2;
    c.quadraticCurveTo(mx, my, head[0], head[1]);
  };
  pl.teal.lineCap = "round";
  pl.teal.lineWidth = 3.6;
  neck(pl.teal);
  pl.teal.strokeStyle = press.screen("teal", 0.55);
  pl.teal.stroke();
  // Head, crest, bill and eye.
  const toward = hr.state === "strike" || hr.state === "catch" ? Math.atan2(hr.aimY - sh[1], hr.aimX - sh[0]) : f > 0 ? 0.15 : Math.PI - 0.15;
  pl.teal.fillStyle = press.screen("teal", 0.5);
  pl.teal.beginPath();
  pl.teal.arc(head[0], head[1], 3.4, 0, Math.PI * 2);
  pl.teal.fill();
  pl.teal.strokeStyle = press.solid("teal");
  pl.teal.lineWidth = 1.2;
  pl.teal.beginPath();
  pl.teal.moveTo(head[0] - Math.cos(toward) * 2, head[1] - 2);
  pl.teal.lineTo(head[0] - Math.cos(toward) * 10, head[1] - 3.5);
  pl.teal.stroke();
  for (const [c, fill] of [
    [pl.yellow, press.solid("yellow")],
    [pl.pink, press.screen("pink", 0.45)],
  ] as const) {
    c.fillStyle = fill;
    c.beginPath();
    c.moveTo(head[0] + Math.cos(toward + 1.4) * 1.6, head[1] + Math.sin(toward + 1.4) * 1.6);
    c.lineTo(head[0] + Math.cos(toward) * 15, head[1] + Math.sin(toward) * 15);
    c.lineTo(head[0] + Math.cos(toward - 1.4) * 1.6, head[1] + Math.sin(toward - 1.4) * 1.6);
    c.closePath();
    c.fill();
  }
  // The tell: a glint in the eye while it takes aim.
  if (hr.state === "cock") {
    knock(pl.teal, () => {
      pl.teal.beginPath();
      pl.teal.arc(head[0] + Math.cos(toward) * 1.2, head[1] - 0.8, 1.6, 0, Math.PI * 2);
      pl.teal.fill();
    });
    pl.yellow.fillStyle = press.solid("yellow");
    pl.yellow.beginPath();
    pl.yellow.arc(head[0] + Math.cos(toward) * 1.2, head[1] - 0.8, 2.2, 0, Math.PI * 2);
    pl.yellow.fill();
  } else {
    pl.teal.fillStyle = press.solid("teal");
    pl.teal.fillRect(head[0] + Math.cos(toward) * 1.2 - 0.7, head[1] - 1.5, 1.4, 1.4);
  }
}

// -----------------------------------------------------------------------------------------------
// The koi
// -----------------------------------------------------------------------------------------------

export interface KoiPose {
  x: number;
  y: number;
  /** Body angle (rad, positive = nose down) and which way it faces (1 right, -1 left, in between while turning). */
  rot: number;
  face: number;
  /** Tail beat phase and amplitude. */
  beat: number;
  amp: number;
  /** 0..1 under water (a light teal tint over it). */
  wet: number;
  /** Belly-up roll when spent (0..1). */
  roll: number;
}

/** The koi is drawn larger than its hit circle: it has to read on a phone. */
const KOI_DRAW = 1.7;
const N = 12;
const top: number[] = [];
const bot: number[] = [];
const spineX: number[] = [];
for (let i = 0; i <= N; i++) {
  const u = i / N;
  spineX.push(KOI_LEN * 0.5 - u * KOI_LEN * 0.88);
  const ht = 6.6 * Math.sqrt(u) * (1 - u) ** 0.62 * 1.75 + (u > 0.85 ? 1.2 : 0);
  top.push(-ht * 1.05);
  bot.push(ht * 0.9);
}

function koiOutline(c: CanvasRenderingContext2D, k: KoiPose): void {
  const off = (u: number) => Math.sin(k.beat - u * 3.4) * k.amp * u * u;
  c.beginPath();
  for (let i = 0; i <= N; i++) c.lineTo(spineX[i]!, top[i]! + off(i / N));
  // Tail fin: forked, its spread pulsing with the beat.
  const tx = spineX[N]!;
  const tw = off(1);
  const spread = 0.65 + 0.35 * Math.abs(Math.sin(k.beat));
  c.lineTo(tx - 9, tw - 8 * spread);
  c.lineTo(tx - 5, tw);
  c.lineTo(tx - 9, tw + 8 * spread);
  for (let i = N; i >= 0; i--) c.lineTo(spineX[i]!, bot[i]! + off(i / N));
  c.closePath();
}

function withKoi(c: CanvasRenderingContext2D, k: KoiPose, fn: () => void): void {
  c.save();
  c.translate(k.x, k.y);
  // Mirroring through zero squashes the body: a 2D koi turning around.
  c.scale(Math.abs(k.face) < 0.12 ? 0.12 * Math.sign(k.face || 1) : k.face, 1);
  c.rotate(k.rot);
  c.scale(KOI_DRAW, KOI_DRAW * (1 - 2 * k.roll));
  fn();
  c.restore();
}

export function drawKoi(v: View, k: KoiPose, pl: Record<Plate, CanvasRenderingContext2D>): void {
  const { press } = v;
  const off = (u: number) => Math.sin(k.beat - u * 3.4) * k.amp * u * u;
  // Clear what's behind on every plate so the koi reads as a solid thing, tinted teal under water.
  for (const p of PLATES) {
    const c = pl[p];
    withKoi(c, k, () => {
      koiOutline(c, k);
      c.globalCompositeOperation = "destination-out";
      c.fillStyle = "#000";
      c.fill();
      c.globalCompositeOperation = "source-over";
    });
  }
  withKoi(pl.teal, k, () => {
    if (k.wet > 0.05) {
      koiOutline(pl.teal, k);
      pl.teal.fillStyle = press.screen("teal", 0.2 * k.wet);
      pl.teal.fill();
    }
  });
  // Vermilion: pink and yellow solid, overprinted.
  withKoi(pl.pink, k, () => {
    koiOutline(pl.pink, k);
    pl.pink.fillStyle = press.solid("pink");
    pl.pink.fill();
    // Fins: pink only (a lighter red), the pectoral fin rowing.
    pl.pink.fillStyle = press.screen("pink", 0.7);
    pl.pink.beginPath();
    const fa = Math.sin(k.beat * 0.8) * 0.4;
    pl.pink.moveTo(7, 3.5);
    pl.pink.lineTo(3 - Math.cos(fa) * 3, 10 + Math.sin(fa) * 2);
    pl.pink.lineTo(0, 4);
    pl.pink.closePath();
    // Dorsal fin.
    pl.pink.moveTo(4, top[3]! + off(0.25));
    pl.pink.quadraticCurveTo(-4, top[5]! - 6 + off(0.42), -10, top[8]! + off(0.67));
    pl.pink.closePath();
    pl.pink.fill();
  });
  withKoi(pl.yellow, k, () => {
    koiOutline(pl.yellow, k);
    pl.yellow.fillStyle = press.solid("yellow");
    pl.yellow.fill();
  });
  // Kohaku: white patches knocked out of the red.
  for (const p of ["pink", "yellow"] as const) {
    const c = pl[p];
    withKoi(c, k, () => {
      c.save();
      koiOutline(c, k);
      c.clip();
      knock(c, () => {
        c.beginPath();
        c.ellipse(3 + off(0.4) * 0.2, 4 + off(0.4), 9, 4.5, 0.15, 0, Math.PI * 2);
        c.moveTo(-12, 0);
        c.ellipse(-14, 1.5 + off(0.8), 5, 5, 0, 0, Math.PI * 2);
        c.moveTo(16, 0);
        c.ellipse(16, 3, 3.5, 2.5, 0, 0, Math.PI * 2);
        c.fill();
      });
      c.restore();
    });
  }
  // Eye and barbels in teal.
  withKoi(pl.teal, k, () => {
    pl.teal.fillStyle = press.solid("teal");
    pl.teal.beginPath();
    pl.teal.arc(11.5, -1.6, 1.25, 0, Math.PI * 2);
    pl.teal.fill();
    pl.teal.strokeStyle = press.solid("teal");
    pl.teal.lineWidth = 0.7;
    pl.teal.beginPath();
    const bb = Math.sin(k.beat * 0.5) * 1.2;
    pl.teal.moveTo(16.5, 2);
    pl.teal.quadraticCurveTo(19, 5, 17 + bb, 8);
    pl.teal.stroke();
  });
}

/** Pose for the koi from the sim (main smooths the angle). */
export function koiTarget(k: Koi): { rot: number; face: number } {
  if (k.water && k.dir < 0) return { rot: k.head, face: -1 };
  return { rot: k.water ? k.head : Math.atan2(k.vy, k.vx), face: 1 };
}
