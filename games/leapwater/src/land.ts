/**
 * The backdrop, in screen space: sky, sun or moon, three ranges of halftone hills that sink as the koi climbs,
 * and mist where each range meets the next. Each range knocks out what lies behind it, so the sun sets behind
 * the peaks instead of printing through them.
 */
import type { Press } from "./riso.ts";
import type { Sky } from "./sky.ts";

export interface Cam {
  x: number;
  y: number;
  z: number;
}

function hash(n: number, seed: number): number {
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
  return noise(x, seed) * 0.6 + noise(x * 2.1, seed + 7) * 0.28 + noise(x * 4.7, seed + 13) * 0.12;
}

interface Range {
  /** Parallax: how far it moves for each wu the camera moves. */
  p: number;
  /** Baseline, in wu below the screen center at the start. */
  base: number;
  amp: number;
  freq: number;
  seed: number;
  kind: "peaks" | "ridge" | "forest";
  /** How far below the baseline the range reaches before the mist takes it (wu). */
  band: number;
}

const RANGES: Range[] = [
  { kind: "peaks", p: 0.02, base: 10, amp: 240, freq: 1 / 210, seed: 11, band: 30 },
  { kind: "ridge", p: 0.05, base: 90, amp: 130, freq: 1 / 150, seed: 23, band: 40 },
  { kind: "forest", p: 0.11, base: 190, amp: 80, freq: 1 / 110, seed: 37, band: 50 },
];

function surface(r: Range, lx: number): number {
  const n = fbm(lx * r.freq, r.seed);
  if (r.kind === "peaks") {
    // Sharp ridged peaks.
    const ridge = 1 - Math.abs(noise(lx * r.freq * 0.7, r.seed + 3) * 2 - 1);
    return r.amp * (0.2 + ridge ** 2.4 * 0.75 + n * 0.25);
  }
  return r.amp * (0.25 + n * 0.75);
}

export interface Backdrop {
  draw(press: Press, W: number, H: number, cam: Cam, sky: Sky, time: number, reduced: boolean): void;
}

export function createBackdrop(): Backdrop {
  const stars = Array.from({ length: 70 }, (_, i) => ({ x: hash(i, 3), y: hash(i, 4) ** 1.3 * 0.55, s: 0.7 + hash(i, 5) * 1.3 }));

  const rangeY = (r: Range, H: number, cam: Cam) => H * 0.42 + (r.base - cam.y * r.p) * cam.z;

  function silhouette(c: CanvasRenderingContext2D, r: Range, W: number, H: number, cam: Cam): void {
    const Y = rangeY(r, H, cam);
    const z = cam.z;
    const toL = (sx: number) => (sx - W / 2) / z + cam.x * r.p;
    c.beginPath();
    c.moveTo(-4, Y + r.band * z);
    for (let sx = -4; sx <= W + 8; sx += 5) c.lineTo(sx, Y - surface(r, toL(sx)) * z);
    c.lineTo(W + 8, Y + r.band * z);
    c.closePath();
    if (r.kind === "forest") {
      // Pine tips along the crest.
      const cw = 9;
      const l0 = toL(-20);
      const l1 = toL(W + 20);
      for (let i = Math.floor(l0 / cw); i <= Math.ceil(l1 / cw); i++) {
        if (hash(i, r.seed + 1) > 0.55) continue;
        const lx = (i + hash(i, r.seed + 2) * 0.6) * cw;
        const sx = (lx - cam.x * r.p) * z + W / 2;
        const base = Y - surface(r, lx) * z + 3 * z;
        const h = (10 + hash(i, r.seed + 3) * 16) * z;
        const w = h * 0.28;
        c.moveTo(sx - w, base);
        c.lineTo(sx, base - h);
        c.lineTo(sx + w, base);
        c.closePath();
      }
    }
  }

  return {
    draw(press, W, H, cam, sky, time, reducedDrift) {
      const teal = press.plate("teal");
      const pink = press.plate("pink");
      const yellow = press.plate("yellow");
      const far = rangeY(RANGES[0]!, H, cam);

      // Sky tint: teal over everything at night, warm bands low on the horizon by day.
      if (sky.tealSky > 0.02) {
        teal.fillStyle = press.screen("teal", sky.tealSky);
        teal.fillRect(0, 0, W, H);
        // Stars knocked out of the night.
        if (sky.stars > 0.05) {
          teal.globalCompositeOperation = "destination-out";
          teal.fillStyle = "#000";
          const n = Math.floor(stars.length * sky.stars);
          for (let i = 0; i < n; i++) {
            const s = stars[i]!;
            const x = (((s.x * W * 1.2 - cam.x * cam.z * 0.01) % (W * 1.2)) + W * 1.2) % (W * 1.2);
            teal.fillRect(x, s.y * H, s.s, s.s);
          }
          teal.globalCompositeOperation = "source-over";
        }
      }
      const band = (c: CanvasRenderingContext2D, ink: string, cover: number, y0: number, y1: number) => {
        if (cover < 0.02) return;
        // Stepped coverage, the riso way to grade a sky: coarse bands, thinnest at the top, never quite empty.
        const steps = y0 <= 0 ? 6 : 4;
        for (let i = 0; i < steps; i++) {
          const k = (i + 1) / steps;
          c.fillStyle = press.screen(ink, Math.max(0.05, cover * k));
          const a = y0 + (y1 - y0) * (i / steps);
          c.fillRect(0, a, W, (y1 - y0) / steps + 1);
        }
      };
      band(yellow, "yellow", sky.yellowBand, 0, far + 20);
      band(pink, "pink", sky.pinkBand, far - H * 0.18, far + 20);

      // Sun (fluorescent pink, gold in the afternoon) or moon (paper, knocked out of the night).
      const r = Math.min(W, H) * 0.105;
      const sx = W * 0.74;
      if (sky.sun > -0.35) {
        const sy = far - H * 0.2 * sky.sun - r * 0.1;
        pink.fillStyle = press.solid("pink");
        pink.beginPath();
        pink.arc(sx, sy, r, 0, Math.PI * 2);
        pink.fill();
        if (sky.sunGold > 0.02) {
          yellow.fillStyle = press.screen("yellow", 0.25 + sky.sunGold * 0.7);
          yellow.beginPath();
          yellow.arc(sx, sy, r, 0, Math.PI * 2);
          yellow.fill();
        }
        // A few thin knocked-out lines across the low sun.
        if (sky.sun < 0.4) {
          pink.globalCompositeOperation = "destination-out";
          for (let i = 0; i < 4; i++) pink.fillRect(sx - r, sy + r * (0.15 + i * 0.2), r * 2, r * 0.05 * (1 + i * 0.6));
          pink.globalCompositeOperation = "source-over";
        }
      }
      if (sky.moon > 0.05) {
        const mx = W * 0.3;
        const my = H * 0.17;
        const mr = r * 0.62;
        teal.globalCompositeOperation = "destination-out";
        teal.globalAlpha = sky.moon;
        teal.beginPath();
        teal.arc(mx, my, mr, 0, Math.PI * 2);
        teal.fill();
        teal.globalAlpha = 1;
        teal.globalCompositeOperation = "source-over";
        yellow.fillStyle = press.screen("yellow", 0.3 * sky.moon);
        yellow.beginPath();
        yellow.arc(mx, my, mr, 0, Math.PI * 2);
        yellow.fill();
        // Craters, a few halftone dots.
        teal.fillStyle = press.screen("teal", 0.25 * sky.moon);
        teal.beginPath();
        teal.arc(mx - mr * 0.3, my - mr * 0.2, mr * 0.22, 0, Math.PI * 2);
        teal.arc(mx + mr * 0.25, my + mr * 0.3, mr * 0.16, 0, Math.PI * 2);
        teal.fill();
      }

      // Three ranges, far to near.
      const dark = sky.dark;
      const looks: Array<Array<[string, number]>> = [
        [
          ["pink", 0.17 + sky.pinkBand * 0.3],
          ["teal", 0.06 + dark * 0.4],
        ],
        [
          ["teal", 0.3 + dark * 0.4],
          ["pink", 0.05 + sky.pinkBand * 0.2],
        ],
        [
          ["teal", 0.55 + dark * 0.3],
          ["yellow", 0.55 * (1 - sky.night * 0.7)],
        ],
      ];
      RANGES.forEach((rg, i) => {
        const Y = rangeY(rg, H, cam);
        if (Y - rg.amp * cam.z > H + 10) return;
        // Clear the sky behind it on every plate, then print it.
        for (const c of [teal, pink, yellow]) {
          silhouette(c, rg, W, H, cam);
          c.globalCompositeOperation = "destination-out";
          c.fillStyle = "#000";
          c.fill();
          c.globalCompositeOperation = "source-over";
        }
        // Print it, the screen thinning in steps toward the foot where the mist takes it.
        const drift = reducedDrift ? 0 : Math.sin(time * 0.2 + i) * 3;
        const foot = Y + rg.band * cam.z + drift;
        const fade = (rg.band + rg.amp * 0.5) * cam.z;
        for (const [ink, cover] of looks[i]!) {
          if (cover < 0.02) continue;
          const c = press.plate(ink);
          c.save();
          silhouette(c, rg, W, H, cam);
          c.clip();
          c.fillStyle = press.screen(ink, cover);
          c.fillRect(0, 0, W, foot - fade);
          for (let k = 0; k < 4; k++) {
            c.fillStyle = press.screen(ink, cover * (1 - (k + 1) / 5));
            c.fillRect(0, foot - fade + (k * fade) / 4, W, fade / 4 + 0.5);
          }
          c.restore();
        }
        // Snow on the far peaks: knocked out above a line.
        if (rg.kind === "peaks") {
          for (const c of [teal, pink, yellow]) {
            c.save();
            silhouette(c, rg, W, H, cam);
            c.clip();
            c.globalCompositeOperation = "destination-out";
            c.fillStyle = "#000";
            c.fillRect(0, 0, W, Y - rg.amp * 0.62 * cam.z);
            c.restore();
          }
        }
      });
    },
  };
}
