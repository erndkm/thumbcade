/**
 * The backdrop, printed in screen space: a banded sky, the sun (or the moon and the stars), flat-topped mesas on
 * the horizon with heat shimmer under them, a ridge of rocky hills, and the near plain with ghost gums.
 * Every layer is halftone on the three plates; depth comes from coverage, not from new colors.
 */
import { clamp, lerp } from "@thumbcade-games/kit/ease";
import { BLUE, moonAt, ORANGE, SUN, sunAt, type Sky } from "./palette.ts";
import type { Press } from "./riso.ts";

export interface Cam {
  x: number;
  y: number;
  z: number;
}

/** A closed ellipse as its own subpath (a bare `ellipse()` joins the previous point with a line). */
export function oval(p: Path2D | CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, rot = 0): void {
  p.moveTo(x + Math.cos(rot) * rx, y + Math.sin(rot) * rx);
  p.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
}

export function hash(n: number, seed: number): number {
  let h = Math.imul(n | 0, 374761393) ^ Math.imul(seed | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function noise(x: number, seed: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  return hash(i, seed) * (1 - u) + hash(i + 1, seed) * u;
}

function fbm(x: number, seed: number): number {
  return noise(x, seed) * 0.6 + noise(x * 2.3, seed + 7) * 0.28 + noise(x * 5.1, seed + 13) * 0.12;
}

const sstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** Mesa skyline: flat tops where the noise crosses a threshold, steep shoulders, a low ripple elsewhere. */
function mesa(lx: number): number {
  const n = fbm(lx / 210, 11);
  const top = sstep(0.5, 0.56, n) * (0.7 + 0.3 * noise(lx / 700, 5));
  const butte = sstep(0.62, 0.66, fbm(lx / 90, 29)) * 0.45;
  return 0.12 + 0.06 * fbm(lx / 40, 3) + Math.max(top, butte);
}

function ridge(lx: number): number {
  return 0.25 + fbm(lx / 120, 41) * 0.75 + Math.abs(Math.sin(lx / 37)) * 0.04;
}

interface Star {
  x: number;
  y: number;
  r: number;
}

interface Bird {
  x: number;
  y: number;
  ph: number;
}

export interface Layout {
  /** Screen y of the far horizon, the ridge foot, the near plain's far edge and the playfield's ground. */
  horizon: number;
  ridge: number;
  plain: number;
  ground: number;
}

export function layout(H: number, groundY: number): Layout {
  // A low horizon: the kangaroo flies against the sky.
  const span = Math.max(36, H * 0.085);
  return { horizon: groundY - span, ridge: groundY - span * 0.55, plain: groundY - span * 0.22, ground: groundY };
}

export interface Backdrop {
  draw(press: Press, W: number, H: number, cam: Cam, L: Layout, sky: Sky, tod: number, time: number, dt: number, still: boolean): void;
}

export function createBackdrop(): Backdrop {
  const stars: Star[] = Array.from({ length: 90 }, (_, i) => ({ x: hash(i, 1), y: hash(i, 2) ** 1.3, r: 0.5 + hash(i, 3) ** 3 * 1.6 }));
  let flock: Bird[] = [];
  let flockX = -9999;
  let flockY = 0;
  let flockWait = 2.5;

  function sky(press: Press, W: number, L: Layout, s: Sky): void {
    // Poster bands: each band is one halftone step, so the gradient comes out stepped like a print.
    const bands = 9;
    const top = 0;
    const bot = L.horizon + 4;
    const bh = (bot - top) / bands;
    const b = press.plate(BLUE);
    const o = press.plate(ORANGE);
    const y = press.plate(SUN);
    for (let i = 0; i < bands; i++) {
      const u = (i + 0.5) / bands;
      const y0 = top + i * bh - 0.5;
      b.fillStyle = press.screen(BLUE, lerp(s.blueTop, s.blueLow, u ** 1.2));
      b.fillRect(0, y0, W, bh + 1);
      const ow = s.orange * u ** 2.2;
      if (ow > 0.02) {
        o.fillStyle = press.screen(ORANGE, ow);
        o.fillRect(0, y0, W, bh + 1);
      }
      const yw = s.sun * u ** 1.5;
      if (yw > 0.02) {
        y.fillStyle = press.screen(SUN, yw);
        y.fillRect(0, y0, W, bh + 1);
      }
    }
  }

  function stars_(press: Press, W: number, L: Layout, s: Sky, cam: Cam): void {
    if (s.night < 0.2) return;
    const b = press.plate(BLUE);
    const k = clamp((s.night - 0.2) / 0.6);
    b.save();
    b.globalCompositeOperation = "destination-out";
    b.fillStyle = "#000";
    const shift = cam.x * cam.z * 0.006;
    for (const st of stars) {
      const y = st.y * (L.horizon - 30);
      // Stars near the horizon wait for full dark.
      if (k < st.y * 0.8) continue;
      const x = ((((st.x * W * 1.4 - shift) % (W * 1.4)) + W * 1.4) % (W * 1.4)) - W * 0.2;
      b.beginPath();
      oval(b, x, y, st.r, st.r);
      b.fill();
    }
    b.restore();
  }

  function sunDisc(press: Press, W: number, H: number, L: Layout, s: Sky, tod: number): void {
    const sp = sunAt(tod);
    if (sp.rise > -0.3) {
      const r = Math.min(W * 0.21, H * 0.12);
      const x = W * sp.x;
      const y = L.horizon - (L.horizon - r * 1.4) * Math.max(-0.4, sp.rise) * 0.8 + r * 0.15;
      // Clear the sky under the disc so it prints as pure sunflower (and orange as it sets).
      for (const name of [BLUE, ORANGE]) {
        const c = press.plate(name);
        c.save();
        c.globalCompositeOperation = "destination-out";
        c.fillStyle = "#000";
        c.beginPath();
        oval(c, x, y, r, r);
        c.fill();
        c.restore();
      }
      const yc = press.plate(SUN);
      yc.fillStyle = press.solid(SUN);
      yc.beginPath();
      oval(yc, x, y, r, r);
      yc.fill();
      const oc = press.plate(ORANGE);
      oc.fillStyle = press.screen(ORANGE, s.sunRed);
      oc.beginPath();
      oval(oc, x, y, r, r);
      oc.fill();
      // A ring of coarse dots around it: the print's version of a glow.
      oc.fillStyle = press.screen(ORANGE, 0.1 + s.sunRed * 0.15);
      oc.beginPath();
      oval(oc, x, y, r * 1.45, r * 1.45);
      oc.moveTo(x + r * 1.02, y);
      oc.arc(x, y, r * 1.02, 0, Math.PI * 2, true);
      oc.fill();
    }
    const mp = moonAt(tod);
    if (mp.rise > -0.1) {
      const r = Math.min(W * 0.075, H * 0.045);
      const x = W * mp.x;
      const y = L.horizon - (L.horizon - H * 0.12) * mp.rise;
      const b = press.plate(BLUE);
      b.save();
      b.globalCompositeOperation = "destination-out";
      b.fillStyle = "#000";
      b.beginPath();
      oval(b, x, y, r, r);
      b.fill();
      b.restore();
      const yc = press.plate(SUN);
      yc.fillStyle = press.screen(SUN, 0.2);
      yc.beginPath();
      oval(yc, x, y, r, r);
      yc.fill();
      // Maria.
      b.fillStyle = press.screen(BLUE, 0.25);
      b.beginPath();
      oval(b, x - r * 0.25, y - r * 0.2, r * 0.32, r * 0.32);
      oval(b, x + r * 0.3, y + r * 0.25, r * 0.22, r * 0.22);
      b.fill();
    }
  }

  /** A silhouette along the screen, `f` = height in px at layer-x. */
  function bandPath(W: number, base: number, bottom: number, shift: number, f: (lx: number) => number, step = 4): Path2D {
    const p = new Path2D();
    p.moveTo(-4, bottom);
    for (let sx = -4; sx <= W + step; sx += step) p.lineTo(sx, base - f(sx + shift));
    p.lineTo(W + 8, bottom);
    p.closePath();
    return p;
  }

  /** A layer covers what is behind it: clear every plate under it, then print it with these coverages. */
  function printBand(press: Press, path: Path2D, inks: Array<[string, number]>): void {
    for (const name of [BLUE, ORANGE, SUN]) {
      const c = press.plate(name);
      c.globalCompositeOperation = "destination-out";
      c.fillStyle = "#000";
      c.fill(path);
      c.globalCompositeOperation = "source-over";
    }
    for (const [name, level] of inks) {
      if (level <= 0.01) continue;
      const c = press.plate(name);
      c.fillStyle = press.screen(name, level);
      c.fill(path);
    }
  }

  function far(press: Press, W: number, H: number, cam: Cam, L: Layout, s: Sky, time: number, still: boolean): void {
    const shift = cam.x * cam.z * 0.035;
    const amp = H * 0.075;
    const f = (lx: number) => mesa(lx) * amp;
    printBand(press, bandPath(W, L.horizon, L.ridge + 6, shift, f), [
      [BLUE, 0.3 + s.night * 0.35],
      [ORANGE, 0.22 + s.orange * 0.3],
      [SUN, s.sun * 0.25],
    ]);

    // Heat shimmer: broken rows of dots along the horizon, sliding against each other.
    if (s.heat > 0.05) {
      const y = press.plate(SUN);
      y.fillStyle = press.screen(SUN, 0.5 * s.heat);
      for (let row = 0; row < 3; row++) {
        const yy = L.horizon - 2 + row * 3.2;
        const drift = still ? 0 : Math.sin(time * (0.9 + row * 0.35) + row * 2) * 6;
        for (let k = 0; k < 9; k++) {
          const x = ((hash(k, row + 70) * W * 1.2 + drift - shift * 0.4) % (W * 1.2) + W * 1.2) % (W * 1.2) - W * 0.1;
          y.fillRect(x, yy, 18 + hash(k, row + 80) * 46, 1.6);
        }
      }
    }
  }

  function mid(press: Press, W: number, H: number, cam: Cam, L: Layout, s: Sky): void {
    const shift = cam.x * cam.z * 0.12;
    const amp = (L.ridge - L.horizon) * 0.5 + H * 0.012;
    const f = (lx: number) => ridge(lx) * amp;
    printBand(press, bandPath(W, L.ridge, L.plain + 6, shift, f, 3), [
      [ORANGE, 0.55 + s.orange * 0.2],
      [BLUE, 0.32 + s.night * 0.3],
    ]);
    // Spinifex freckles on the ridge face.
    const y = press.plate(SUN);
    y.fillStyle = press.screen(SUN, 0.75);
    const cell = 13;
    const l0 = Math.floor(shift / cell);
    for (let c = l0; c < l0 + W / cell + 2; c++) {
      if (hash(c, 91) > 0.55) continue;
      const lx = c * cell + hash(c, 92) * cell;
      const sx = lx - shift;
      const top = L.ridge - f(lx);
      const yy = lerp(top + 2, L.plain, 0.2 + hash(c, 93) * 0.6);
      if (yy > L.plain - 1) continue;
      y.beginPath();
      oval(y, sx, yy, 1.8 + hash(c, 94) * 1.6, 0.9 + hash(c, 95) * 0.6, 0);
      y.fill();
    }
  }

  function near(press: Press, W: number, cam: Cam, L: Layout, s: Sky, groundY: number): void {
    const shift = cam.x * cam.z * 0.36;
    const f = (lx: number) => 1 + fbm(lx / 60, 61) * 3;
    printBand(press, bandPath(W, L.plain, groundY + 2, shift, f), [
      [ORANGE, 0.72],
      [SUN, 0.5],
      [BLUE, s.shade * 0.45],
    ]);

    // Ghost gums: white trunks (the paper itself) under olive crowns.
    const cell = 150;
    const l0 = Math.floor((shift - 80) / cell);
    const scale = clamp((groundY - L.plain) / 22, 0.5, 1.2);
    for (let c = l0; c < l0 + W / cell + 3; c++) {
      if (hash(c, 101) > 0.55) continue;
      const lx = (c + 0.2 + hash(c, 102) * 0.6) * cell;
      const sx = lx - shift;
      const base = L.plain - f(lx) + 3;
      const h = (34 + hash(c, 103) * 30) * scale;
      tree(press, sx, base, h, hash(c, 104), s);
    }
  }

  function tree(press: Press, x: number, base: number, h: number, seed: number, s: Sky): void {
    const trunk = new Path2D();
    const lean = (seed - 0.5) * 0.3;
    const tx = x + lean * h;
    trunk.moveTo(x - h * 0.035, base);
    trunk.quadraticCurveTo(x + lean * h * 0.4, base - h * 0.5, tx - h * 0.02, base - h * 0.78);
    trunk.lineTo(tx + h * 0.02, base - h * 0.78);
    trunk.quadraticCurveTo(x + lean * h * 0.4 + h * 0.03, base - h * 0.5, x + h * 0.035, base);
    trunk.closePath();
    // Two limbs.
    trunk.moveTo(tx, base - h * 0.62);
    trunk.lineTo(tx - h * 0.26, base - h * 0.9);
    trunk.lineTo(tx - h * 0.22, base - h * 0.92);
    trunk.lineTo(tx + h * 0.012, base - h * 0.68);
    trunk.closePath();
    trunk.moveTo(tx, base - h * 0.7);
    trunk.lineTo(tx + h * 0.24, base - h * 0.96);
    trunk.lineTo(tx + h * 0.27, base - h * 0.94);
    trunk.lineTo(tx + h * 0.02, base - h * 0.64);
    trunk.closePath();
    const crown = new Path2D();
    for (let k = 0; k < 5; k++) {
      const a = -Math.PI / 2 + (k - 2) * 0.62;
      const cx = tx + Math.cos(a) * h * 0.24;
      const cy = base - h * 0.92 + Math.sin(a) * h * 0.12;
      oval(crown, cx, cy, h * (0.17 + hash(k, seed * 1e4) * 0.07), h * 0.09, 0);
    }
    const b = press.plate(BLUE);
    b.fillStyle = press.screen(BLUE, 0.32 + s.night * 0.3);
    b.fill(crown);
    const y = press.plate(SUN);
    y.fillStyle = press.screen(SUN, 0.6 - s.night * 0.3);
    y.fill(crown);
    for (const name of [BLUE, ORANGE, SUN]) {
      const c = press.plate(name);
      c.save();
      c.globalCompositeOperation = "destination-out";
      c.fillStyle = "#000";
      c.fill(trunk);
      c.restore();
    }
    b.fillStyle = press.screen(BLUE, 0.1 + s.night * 0.35);
    b.fill(trunk);
  }

  function birds(press: Press, W: number, H: number, dt: number, time: number, still: boolean): void {
    if (flock.length === 0) {
      flockWait -= dt;
      if (flockWait <= 0) {
        flockX = W + 30;
        flockY = H * (0.16 + Math.random() * 0.14);
        const n = 4 + Math.floor(Math.random() * 5);
        flock = Array.from({ length: n }, (_, i) => ({ x: i * 13 + Math.random() * 9, y: Math.abs(i - n / 2) * 6 + Math.random() * 6, ph: Math.random() * 6 }));
      }
      return;
    }
    flockX -= dt * 30;
    const b = press.plate(BLUE);
    b.strokeStyle = press.solid(BLUE);
    b.lineWidth = 1.4;
    b.lineCap = "round";
    b.beginPath();
    for (const bd of flock) {
      const x = flockX + bd.x;
      const y = flockY + bd.y + Math.sin(time * 0.6 + bd.ph) * 3;
      const f = still ? 1.4 : Math.sin(time * 5 + bd.ph) * 2.4;
      b.moveTo(x - 4.5, y - f);
      b.quadraticCurveTo(x - 2, y - 1.2, x, y);
      b.quadraticCurveTo(x + 2, y - 1.2, x + 4.5, y - f);
    }
    b.stroke();
    if (flockX < -150) {
      flock = [];
      flockWait = 7 + Math.random() * 9;
    }
  }

  return {
    draw(press, W, H, cam, L, s, tod, time, dt, still) {
      sky(press, W, L, s);
      stars_(press, W, L, s, cam);
      sunDisc(press, W, H, L, s, tod);
      birds(press, W, H, dt, time, still);
      far(press, W, H, cam, L, s, time, still);
      mid(press, W, H, cam, L, s);
      near(press, W, cam, L, s, L.ground);
    },
  };
}
