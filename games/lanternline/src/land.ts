/**
 * The backdrop: a big sky with its sun or moon, stars, cloud streaks, birds, and four parallax silhouette layers
 * that fade toward the sky with distance. Everything is flat fills; depth comes from color and fog.
 */
import { alpha, discAt, mixHex, type Sky } from "./palette.ts";

export interface Cam {
  x: number;
  y: number;
  z: number;
  /** Screen px the nearer backdrop layers sink by (attract framing). */
  drop: number;
}

// --- value noise ------------------------------------------------------------------------------

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

// --- layers -----------------------------------------------------------------------------------

type Kind = "mountains" | "turbines" | "forest" | "cliffs";

interface Layer {
  kind: Kind;
  p: number;
  depth: number;
  base: number;
  amp: number;
  freq: number;
  seed: number;
}

const LAYERS: Layer[] = [
  { kind: "mountains", p: 0.04, depth: 0.12, base: 6, amp: 175, freq: 1 / 260, seed: 11 },
  { kind: "turbines", p: 0.1, depth: 0.25, base: 52, amp: 70, freq: 1 / 170, seed: 23 },
  { kind: "forest", p: 0.22, depth: 0.42, base: 104, amp: 52, freq: 1 / 120, seed: 37 },
  { kind: "cliffs", p: 0.42, depth: 0.63, base: 158, amp: 96, freq: 1 / 150, seed: 51 },
];

function surface(l: Layer, lx: number): number {
  const n = fbm(lx * l.freq, l.seed);
  if (l.kind === "mountains") return l.amp * (0.25 + n * 0.85) * (0.75 + 0.25 * Math.sin(lx * 0.0011));
  if (l.kind === "cliffs") {
    // Ridged: mesas and broken cliffs.
    const r = 1 - Math.abs(noise(lx * l.freq * 0.8, l.seed + 3) * 2 - 1);
    return l.amp * (0.15 + Math.min(0.85, r ** 2.2 * 1.1) * 0.9 + n * 0.12);
  }
  return l.amp * (0.2 + n * 0.8);
}

function pinePath(ctx: CanvasRenderingContext2D, x: number, y: number, h: number, w: number): void {
  const tiers = h > 30 ? 4 : 3;
  ctx.moveTo(x, y - h);
  for (let i = 1; i <= tiers; i++) {
    const u = i / tiers;
    ctx.lineTo(x + w * u, y - h + h * u * 0.92);
    if (i < tiers) ctx.lineTo(x + w * u * 0.45, y - h + h * u * 0.92 - h * 0.04);
  }
  ctx.lineTo(x + 1, y);
  ctx.lineTo(x - 1, y);
  for (let i = tiers; i >= 1; i--) {
    const u = i / tiers;
    if (i < tiers) ctx.lineTo(x - w * u * 0.45, y - h + h * u * 0.92 - h * 0.04);
    ctx.lineTo(x - w * u, y - h + h * u * 0.92);
  }
  ctx.closePath();
}

export interface Backdrop {
  draw(ctx: CanvasRenderingContext2D, W: number, H: number, cam: Cam, sky: Sky, tod: number, time: number): void;
  /** Screen y of a layer's baseline (used for the fog and the title). */
  horizonY(H: number, cam: Cam): number;
}

interface Star {
  x: number;
  y: number;
  s: number;
  ph: number;
}

interface Bird {
  x: number;
  y: number;
  ph: number;
}

export function createBackdrop(seed: number): Backdrop {
  const stars: Star[] = [];
  for (let i = 0; i < 110; i++) {
    stars.push({ x: hash(i, seed + 1), y: hash(i, seed + 2) ** 1.4 * 0.62, s: 0.6 + hash(i, seed + 3) * 1.2, ph: hash(i, seed + 4) * 6.28 });
  }
  const streaks = Array.from({ length: 6 }, (_, i) => ({
    y: 0.12 + hash(i, seed + 9) * 0.34,
    x: hash(i, seed + 10),
    len: 0.5 + hash(i, seed + 11) * 0.9,
    th: 6 + hash(i, seed + 12) * 12,
    v: 0.004 + hash(i, seed + 13) * 0.006,
  }));
  let flock: Bird[] = [];
  let flockX = -9999;
  let flockY = 0;
  let flockWait = 3;

  const layerY = (l: Layer, H: number, cam: Cam) => H * 0.5 + (l.base - cam.y * l.p) * cam.z + cam.drop * l.p * 2.2;

  function drawSky(ctx: CanvasRenderingContext2D, W: number, H: number, cam: Cam, sky: Sky, tod: number, time: number): void {
    const hz = layerY(LAYERS[1]!, H, cam);
    const g = ctx.createLinearGradient(0, 0, 0, hz);
    g.addColorStop(0, sky.top);
    g.addColorStop(0.55, sky.mid);
    g.addColorStop(1, sky.horizon);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // Stars.
    if (sky.stars > 0.01) {
      ctx.fillStyle = "#F2F4E8";
      const shift = cam.x * cam.z * 0.004;
      for (const s of stars) {
        const a = sky.stars * (0.55 + 0.45 * Math.sin(time * 0.7 + s.ph));
        if (a < 0.05) continue;
        ctx.globalAlpha = a * 0.9;
        const x = (((s.x * W * 1.3 - shift) % (W * 1.3)) + W * 1.3) % (W * 1.3);
        ctx.fillRect(x - s.s / 2, s.y * H, s.s, s.s);
      }
      ctx.globalAlpha = 1;
    }

    // Sun or moon: a big soft disc.
    const d = discAt(tod);
    const r = Math.min(W, H) * (d.moon ? 0.085 : 0.13) * (1 + (1 - d.rise) * 0.18);
    const dx = W * (0.72 - d.drift * 0.36);
    const dy = hz - (hz - H * 0.13) * d.rise + r * 0.25;
    if (d.rise > -0.25) {
      const bloom = ctx.createRadialGradient(dx, dy, r * 0.6, dx, dy, r * 4.2);
      bloom.addColorStop(0, alpha(sky.disc, d.moon ? 0.16 : 0.42));
      bloom.addColorStop(1, alpha(sky.disc, 0));
      ctx.fillStyle = bloom;
      ctx.fillRect(dx - r * 4.2, dy - r * 4.2, r * 8.4, r * 8.4);
      ctx.fillStyle = sky.disc;
      ctx.beginPath();
      if (d.moon) {
        // A crescent: the disc minus an offset disc.
        ctx.save();
        ctx.arc(dx, dy, r, 0, Math.PI * 2);
        ctx.clip();
        ctx.beginPath();
        ctx.rect(dx - r - 2, dy - r - 2, r * 2 + 4, r * 2 + 4);
        ctx.arc(dx + r * 0.42, dy - r * 0.18, r * 0.9, 0, Math.PI * 2);
        ctx.fill("evenodd");
        ctx.restore();
      } else {
        ctx.arc(dx, dy, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Long cloud streaks, warm by day, gone at night.
    const day = 1 - sky.night * 0.85;
    for (const s of streaks) {
      const len = s.len * W;
      const x = ((((s.x - time * s.v) * W * 2 - cam.x * cam.z * 0.02) % (W * 2)) + W * 2) % (W * 2) - len * 0.5;
      const y = s.y * H + (-cam.y * 0.015 * cam.z);
      const grad = ctx.createLinearGradient(0, y - s.th, 0, y + s.th);
      const c = mixHex(sky.horizon, "#FFFFFF", 0.35);
      grad.addColorStop(0, alpha(c, 0));
      grad.addColorStop(0.5, alpha(c, 0.32 * day));
      grad.addColorStop(1, alpha(c, 0));
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.ellipse(x + len / 2, y, len / 2, s.th, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawBirds(ctx: CanvasRenderingContext2D, W: number, H: number, cam: Cam, color: string, time: number, dt: number): void {
    if (flock.length === 0) {
      flockWait -= dt;
      if (flockWait <= 0) {
        flockX = W + 30;
        flockY = H * (0.2 + Math.random() * 0.18);
        const n = 4 + Math.floor(Math.random() * 4);
        flock = Array.from({ length: n }, (_, i) => ({ x: i * 14 + Math.random() * 8, y: Math.abs(i - n / 2) * 7 + Math.random() * 5, ph: Math.random() * 6 }));
      }
      return;
    }
    flockX -= dt * (26 + cam.z * 6);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.3;
    ctx.lineCap = "round";
    ctx.beginPath();
    for (const b of flock) {
      const x = flockX + b.x;
      const y = flockY + b.y + Math.sin(time * 0.6 + b.ph) * 3;
      const f = Math.sin(time * 5 + b.ph) * 2.6;
      ctx.moveTo(x - 5, y - f);
      ctx.quadraticCurveTo(x - 2, y - 1.5, x, y);
      ctx.quadraticCurveTo(x + 2, y - 1.5, x + 5, y - f);
    }
    ctx.stroke();
    if (flockX < -160) {
      flock = [];
      flockWait = 6 + Math.random() * 8;
    }
  }

  function drawLayer(ctx: CanvasRenderingContext2D, l: Layer, W: number, H: number, cam: Cam, color: string, time: number): void {
    const Y = layerY(l, H, cam);
    const z = cam.z;
    const toL = (sx: number) => (sx - W / 2) / z + cam.x * l.p;
    const toS = (lx: number) => (lx - cam.x * l.p) * z + W / 2;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(-2, H + 2);
    const step = 6;
    for (let sx = -2; sx <= W + step; sx += step) ctx.lineTo(sx, Y - surface(l, toL(sx)) * z);
    ctx.lineTo(W + 8, H + 2);
    ctx.closePath();

    const l0 = toL(-60);
    const l1 = toL(W + 60);
    if (l.kind === "forest" || l.kind === "cliffs") {
      const cw = l.kind === "forest" ? 11 : 26;
      for (let c = Math.floor(l0 / cw); c <= Math.ceil(l1 / cw); c++) {
        const hsh = hash(c, l.seed + 101);
        const dens = l.kind === "forest" ? 0.25 + fbm(c * 0.05, l.seed + 5) * 0.75 : 0.32;
        if (hsh > dens) continue;
        const lx = (c + 0.5 + (hash(c, l.seed + 102) - 0.5) * 0.7) * cw;
        const ph = hash(c, l.seed + 103);
        const ph2 = l.kind === "forest" ? 14 + ph * 26 : 30 + ph * 62;
        const base = Y - surface(l, lx) * z + 3 * z;
        pinePath(ctx, toS(lx), base, ph2 * z, ph2 * 0.3 * z);
      }
    }
    ctx.fill();

    if (l.kind === "turbines") {
      const cw = 150;
      ctx.beginPath();
      const blades: Array<[number, number, number, number]> = [];
      for (let c = Math.floor(l0 / cw); c <= Math.ceil(l1 / cw); c++) {
        if (hash(c, l.seed + 201) > 0.42) continue;
        for (let k = 0; k < (hash(c, l.seed + 204) > 0.6 ? 2 : 1); k++) {
          const lx = (c + 0.3 + hash(c, l.seed + 202) * 0.4) * cw + k * 46;
          const sx = toS(lx);
          const base = Y - surface(l, lx) * z + 4 * z;
          const th = (64 + hash(c + k, l.seed + 203) * 34) * z;
          ctx.moveTo(sx - 1.6 * z, base);
          ctx.lineTo(sx - 0.7 * z, base - th);
          ctx.lineTo(sx + 0.7 * z, base - th);
          ctx.lineTo(sx + 1.6 * z, base);
          ctx.closePath();
          blades.push([sx, base - th, th * 0.42, time * 0.55 + hash(c + k, l.seed + 205) * 6.28]);
        }
      }
      ctx.fill();
      ctx.beginPath();
      for (const [x, y, len, a] of blades) {
        ctx.moveTo(x + 2 * z, y);
        ctx.arc(x, y, 2 * z, 0, Math.PI * 2);
        for (let b = 0; b < 3; b++) {
          const ang = a + (b * Math.PI * 2) / 3;
          const cs = Math.cos(ang);
          const sn = Math.sin(ang);
          ctx.moveTo(x - sn * 1.3 * z, y + cs * 1.3 * z);
          ctx.lineTo(x + cs * len, y + sn * len);
          ctx.lineTo(x + sn * 1.3 * z, y - cs * 1.3 * z);
          ctx.closePath();
        }
      }
      ctx.fill();
    }

    if (l.kind === "cliffs") {
      // A broken aqueduct now and then.
      const cw = 420;
      ctx.strokeStyle = color;
      ctx.lineCap = "butt";
      for (let c = Math.floor(l0 / cw); c <= Math.ceil(l1 / cw); c++) {
        if (hash(c, l.seed + 301) > 0.5) continue;
        const lx = (c + 0.25) * cw;
        const n = 2 + Math.floor(hash(c, l.seed + 302) * 3);
        const span = 34;
        const top = Y - surface(l, lx) * z - 46 * z;
        ctx.lineWidth = 7 * z;
        ctx.beginPath();
        for (let k = 0; k < n; k++) {
          const sx = toS(lx + k * span);
          ctx.moveTo(sx, top + 14 * z);
          ctx.arc(sx + (span / 2) * z, top + 14 * z, (span / 2) * z, Math.PI, 0);
        }
        ctx.stroke();
        ctx.beginPath();
        for (let k = 0; k <= n; k++) {
          if (k === n && hash(c + k, l.seed + 303) > 0.5) continue;
          const sx = toS(lx + k * span);
          ctx.rect(sx - 3.5 * z, top + 14 * z, 7 * z, H);
        }
        ctx.rect(toS(lx) - 3.5 * z, top + 2 * z, (span * n * 0.7) * z, 6 * z);
        ctx.fillStyle = color;
        ctx.fill();
      }
    }
  }

  function fog(ctx: CanvasRenderingContext2D, W: number, H: number, y0: number, y1: number, color: string, a: number): void {
    const g = ctx.createLinearGradient(0, y0, 0, y1);
    g.addColorStop(0, alpha(color, 0));
    g.addColorStop(1, alpha(color, a));
    ctx.fillStyle = g;
    ctx.fillRect(0, y0, W, H - y0);
  }

  let lastTime = 0;
  return {
    horizonY(H, cam) {
      return layerY(LAYERS[1]!, H, cam);
    },
    draw(ctx, W, H, cam, sky, tod, time) {
      const dt = Math.min(0.1, Math.max(0, time - lastTime));
      lastTime = time;
      drawSky(ctx, W, H, cam, sky, tod, time);
      for (let i = 0; i < LAYERS.length; i++) {
        const l = LAYERS[i]!;
        const color = mixHex(sky.fog, sky.ink, l.depth);
        drawLayer(ctx, l, W, H, cam, color, time);
        if (i === 1) drawBirds(ctx, W, H, cam, mixHex(sky.fog, sky.ink, 0.36), time, dt);
        const Y = layerY(l, H, cam);
        fog(ctx, W, H, Y - l.amp * cam.z * 0.5, Y + 40 * cam.z, sky.fog, i === LAYERS.length - 1 ? 0.5 : 0.62);
      }
    },
  };
}
