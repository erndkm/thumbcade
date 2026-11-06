/** The playfield in world units: terrain, floating ruins, lanterns on their chains, seeds, the line and the lamplighter. */
import { alpha, LAMP, LAMP_CORE, mixHex, SEED, type Sky } from "./palette.ts";
import type { Cam } from "./land.ts";
import { WEAR_MAX, type Anchor, type Island, type World } from "./sim.ts";

/** A soft round light, pre-rendered once per color. */
const sprites = new Map<string, HTMLCanvasElement>();
export function glowSprite(color: string): HTMLCanvasElement {
  let c = sprites.get(color);
  if (c) return c;
  c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, alpha(color, 1));
  grad.addColorStop(0.18, alpha(color, 0.55));
  grad.addColorStop(0.5, alpha(color, 0.16));
  grad.addColorStop(1, alpha(color, 0));
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  sprites.set(color, c);
  return c;
}

export function glow(ctx: CanvasRenderingContext2D, color: string, x: number, y: number, r: number, a: number): void {
  if (a <= 0.01) return;
  ctx.globalAlpha = Math.min(1, a);
  ctx.drawImage(glowSprite(color), x - r, y - r, r * 2, r * 2);
  ctx.globalAlpha = 1;
}

/** Sets the canvas transform so drawing happens in world units. */
export function worldTransform(ctx: CanvasRenderingContext2D, dpr: number, W: number, H: number, cam: Cam, ox = 0, oy = 0): void {
  const s = dpr * cam.z;
  ctx.setTransform(s, 0, 0, s, dpr * (W / 2 - cam.x * cam.z + ox), dpr * (H / 2 - cam.y * cam.z + oy));
}

export interface View {
  W: number;
  H: number;
  cam: Cam;
  sky: Sky;
  time: number;
}

/** World x range visible on screen (with margin). */
export function visibleX(v: View, margin = 60): [number, number] {
  const half = v.W / 2 / v.cam.z;
  return [v.cam.x - half - margin, v.cam.x + half + margin];
}

export function drawTerrain(ctx: CanvasRenderingContext2D, w: World, v: View): void {
  const [x0, x1] = visibleX(v, 20);
  const bottom = v.cam.y + v.H / 2 / v.cam.z + 40;
  ctx.fillStyle = v.sky.ink;
  ctx.beginPath();
  ctx.moveTo(x0, bottom);
  w.forGround(x0, x1, 4 / Math.min(1, v.cam.z), (x, y) => ctx.lineTo(x, Math.min(y, bottom)));
  ctx.lineTo(x1 + 8, bottom);
  ctx.closePath();
  ctx.fill();
}

export function drawIsland(ctx: CanvasRenderingContext2D, isl: Island, v: View): void {
  const p = isl.pts;
  ctx.fillStyle = v.sky.ink;
  ctx.beginPath();
  ctx.moveTo(p[0]!, p[1]!);
  for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i]!, p[i + 1]!);
  ctx.closePath();
  ctx.fill();
  // Hanging roots.
  ctx.strokeStyle = v.sky.ink;
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  const n = 3 + Math.floor(isl.seed * 4);
  for (let k = 0; k < n; k++) {
    const u = (k + 0.5) / n;
    const x = isl.x - isl.w * 0.32 + isl.w * 0.64 * u;
    const y = isl.y + 4 + isl.h * (1 - Math.abs(u - 0.5) * 2) ** 0.8 * 0.55;
    const len = 8 + ((isl.seed * 97 + k * 31) % 1) * 18;
    const sway = Math.sin(v.time * 0.9 + k + isl.seed * 9) * 2;
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + sway * 0.5, y + len * 0.6, x + sway, y + len);
  }
  ctx.stroke();
}

export function drawChain(ctx: CanvasRenderingContext2D, a: Anchor, v: View): void {
  ctx.strokeStyle = v.sky.ink;
  ctx.lineWidth = a.island ? 1.2 : 0.8;
  if (a.island) ctx.setLineDash([2.6, 1.6]);
  ctx.beginPath();
  ctx.moveTo(a.hx, a.hy);
  ctx.lineTo(a.x, a.y - 8);
  ctx.stroke();
  ctx.setLineDash([]);
  if (!a.island) drawSkyLantern(ctx, a, v);
}

/** A floating paper lantern that holds a lantern's cord up. */
function drawSkyLantern(ctx: CanvasRenderingContext2D, a: Anchor, v: View): void {
  const sky = v.sky;
  const bob = Math.sin(v.time * 0.9 + a.ph) * 1.5;
  const x = a.hx;
  const y = a.hy + bob;
  glow(ctx, LAMP, x, y - 13, 34 + sky.glow * 20, 0.25 + sky.glow * 0.45);
  ctx.fillStyle = mixHex(mixHex(sky.horizon, LAMP, 0.55), LAMP_CORE, 0.25 + sky.glow * 0.3);
  ctx.beginPath();
  ctx.moveTo(x - 8.5, y - 25);
  ctx.quadraticCurveTo(x, y - 29, x + 8.5, y - 25);
  ctx.lineTo(x + 6, y - 2);
  ctx.quadraticCurveTo(x, y, x - 6, y - 2);
  ctx.closePath();
  ctx.fill();
  // Ribs and the wire frame at the mouth, in ink.
  ctx.fillStyle = alpha(sky.ink, 0.35);
  ctx.fillRect(x - 0.4, y - 27, 0.8, 25);
  ctx.fillRect(x - 4.6, y - 26, 0.7, 24);
  ctx.fillRect(x + 3.9, y - 26, 0.7, 24);
  ctx.fillStyle = sky.ink;
  ctx.fillRect(x - 6.4, y - 2.4, 12.8, 1.8);
}

/** A hanging lantern; lit ones carry the warm light the lamplighter left. */
export function drawLantern(ctx: CanvasRenderingContext2D, a: Anchor, v: View, targeted: number, demo: boolean): void {
  const { x, y } = a;
  const sky = v.sky;
  const lit = a.lit;
  const worn = demo ? 0 : Math.min(1, a.wear / WEAR_MAX);
  const flick = 0.92 + 0.08 * Math.sin(v.time * 3.1 + a.id * 1.7) * Math.sin(v.time * 1.3 + a.id);
  const lampA = (0.35 + sky.glow * 0.65) * lit * flick * (1 - worn * 0.55);
  if (lampA > 0) glow(ctx, LAMP, x, y, 44 + sky.glow * 26, lampA * 0.75);
  if (targeted > 0 && lit < 0.5) glow(ctx, LAMP, x, y, 22, targeted * (0.25 + sky.glow * 0.35));
  const angle = Math.atan2(a.x - a.hx, a.y - a.hy);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-angle);
  ctx.fillStyle = sky.ink;
  // Ring, cap, body, finial.
  ctx.beginPath();
  ctx.arc(0, -9.5, 1.8, 0, Math.PI * 2);
  ctx.moveTo(-6.5, -5);
  ctx.lineTo(0, -8.6);
  ctx.lineTo(6.5, -5);
  ctx.closePath();
  ctx.rect(-4.6, -5, 9.2, 11.5);
  ctx.moveTo(-3, 6.5);
  ctx.lineTo(3, 6.5);
  ctx.lineTo(0, 10);
  ctx.closePath();
  ctx.fill();
  // The window: dark with a sleeping ember until lit.
  const ember = 0.35 + targeted * 0.65;
  const win = lit > 0 ? mixHex(mixHex(sky.ink, LAMP, 0.25 + ember * 0.3), LAMP_CORE, lit * (1 - worn * 0.5)) : mixHex(sky.ink, LAMP, 0.18 + ember * 0.4);
  ctx.fillStyle = win;
  ctx.fillRect(-2.9, -3.4, 5.8, 8.2);
  ctx.fillStyle = sky.ink;
  ctx.fillRect(-0.45, -3.4, 0.9, 8.2);
  ctx.restore();
}

export function drawSeed(ctx: CanvasRenderingContext2D, x: number, y: number, time: number, ph: number, k: number, sky: Sky): void {
  const bob = Math.sin(time * 1.6 + ph) * 3;
  glow(ctx, SEED, x, y + bob, 15 + sky.glow * 6, (0.45 + sky.glow * 0.4) * k);
  ctx.save();
  ctx.translate(x, y + bob);
  ctx.rotate(Math.sin(time * 1.1 + ph) * 0.5);
  ctx.globalAlpha = k;
  ctx.fillStyle = mixHex(SEED, "#FFFFFF", 0.4);
  ctx.beginPath();
  ctx.moveTo(0, -4.4);
  ctx.quadraticCurveTo(3.2, -0.6, 0, 3.4);
  ctx.quadraticCurveTo(-3.2, -0.6, 0, -4.4);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.restore();
}

// -----------------------------------------------------------------------------------------------
// The lamplighter
// -----------------------------------------------------------------------------------------------

export interface Pose {
  x: number;
  y: number;
  rot: number;
  /** 0 = flying, 1 = hanging on the line. */
  hang: number;
  /** 0 = stretched, 1 = knees tucked. */
  tuck: number;
  vx: number;
  vy: number;
  /** Standing on the cliff before the leap. */
  stand: number;
  cloak: number;
}

function tp(p: Pose, lx: number, ly: number): [number, number] {
  const c = Math.cos(p.rot);
  const s = Math.sin(p.rot);
  return [p.x + lx * c - ly * s, p.y + lx * s + ly * c];
}

/** Where the hands are (the line starts here). */
export function hands(p: Pose): [number, number] {
  return tp(p, 0.6 * (1 - p.hang), -16 + 5 * (1 - p.hang));
}

const L = (a: number, b: number, t: number) => a + (b - a) * t;

export function drawFigure(ctx: CanvasRenderingContext2D, p: Pose, sky: Sky, time: number, lamp: number): void {
  const ink = sky.ink;
  const h = p.hang;
  const t = p.tuck;
  const st = p.stand;
  // Facing: always forward (right), slight lean.
  const sh: [number, number] = [0, -9];
  const hip: [number, number] = [0, 0];
  // Arms.
  const handUp: [number, number] = [0.6, -16.5];
  const handFlyA: [number, number] = [L(-7, -4, t), L(-6, -2, t)];
  const handFlyB: [number, number] = [L(7, 5, t), L(-13, -6, t)];
  const handStandA: [number, number] = [-2.5, -1];
  const handStandB: [number, number] = [2.5, -1];
  const mix2 = (a: [number, number], b: [number, number], k: number): [number, number] => [L(a[0], b[0], k), L(a[1], b[1], k)];
  const hA = mix2(mix2(handFlyA, handUp, h), handStandA, st);
  const hB = mix2(mix2(handFlyB, [handUp[0] - 0.4, handUp[1] + 1.2], h), handStandB, st);
  // Legs: knee and foot.
  const swing = Math.sin(time * 2.2) * (1 - t) * (1 - st) * 0.6;
  const kneeA: [number, number] = [L(L(1.2, 4.5, t), 0.8, st), L(L(5.5, 2.5, t), 5.5, st)];
  const footA: [number, number] = [L(L(-0.5 + swing, 1.5, t), 1, st), L(L(11.5, 7.5, t), 11.5, st)];
  const kneeB: [number, number] = [L(L(-1.5, 3, t), -1, st), L(L(5.5, 3.5, t), 5.5, st)];
  const footB: [number, number] = [L(L(-3.5 - swing, -0.5, t), -1.5, st), L(L(10.5, 8.5, t), 11.5, st)];

  // Cloak: streams back against the motion.
  const sp = Math.hypot(p.vx, p.vy);
  const back = sp > 20 ? Math.atan2(-p.vy, -p.vx) : Math.PI / 2 + 0.15;
  const len = 7 + Math.min(9, sp * 0.012);
  const [sx, sy] = tp(p, -1.4, -8.4);
  const [sx2, sy2] = tp(p, 1.2, -6.5);
  const wv = Math.sin(time * 9 + p.cloak) * Math.min(1, sp / 400) * 1.6;
  const tipX = sx + Math.cos(back) * len;
  const tipY = sy + Math.sin(back) * len + 2;
  ctx.fillStyle = ink;
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.quadraticCurveTo((sx + tipX) / 2 + wv, (sy + tipY) / 2 - wv, tipX, tipY);
  ctx.lineTo(tipX + Math.cos(back + 1.2) * 3, tipY + Math.sin(back + 1.2) * 3);
  ctx.quadraticCurveTo((sx2 + tipX) / 2 - wv, (sy2 + tipY) / 2 + wv, sx2, sy2);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = ink;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  // Legs.
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  let q = tp(p, ...hip);
  ctx.moveTo(q[0], q[1]);
  q = tp(p, ...kneeA);
  ctx.lineTo(q[0], q[1]);
  q = tp(p, ...footA);
  ctx.lineTo(q[0], q[1]);
  q = tp(p, ...hip);
  ctx.moveTo(q[0], q[1]);
  q = tp(p, ...kneeB);
  ctx.lineTo(q[0], q[1]);
  q = tp(p, ...footB);
  ctx.lineTo(q[0], q[1]);
  ctx.stroke();
  // Torso (a tapered coat).
  ctx.beginPath();
  q = tp(p, -2.3, -9.5);
  ctx.moveTo(q[0], q[1]);
  q = tp(p, 2.1, -9.5);
  ctx.lineTo(q[0], q[1]);
  q = tp(p, 2.9, 1.2);
  ctx.lineTo(q[0], q[1]);
  q = tp(p, -2.6, 1.6);
  ctx.lineTo(q[0], q[1]);
  ctx.closePath();
  ctx.fill();
  // Arms.
  ctx.lineWidth = 1.9;
  ctx.beginPath();
  q = tp(p, sh[0] - 1, sh[1]);
  ctx.moveTo(q[0], q[1]);
  q = tp(p, ...hA);
  ctx.lineTo(q[0], q[1]);
  q = tp(p, sh[0] + 1, sh[1]);
  ctx.moveTo(q[0], q[1]);
  q = tp(p, ...hB);
  ctx.lineTo(q[0], q[1]);
  ctx.stroke();
  // Head with a pointed hood.
  q = tp(p, 0.3, -12.6);
  ctx.beginPath();
  ctx.arc(q[0], q[1], 2.9, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  const hd1 = tp(p, -2.6, -13.6);
  const hd2 = tp(p, -6.2, -12.2 + Math.sin(time * 7) * 0.4);
  const hd3 = tp(p, -1.8, -11);
  ctx.moveTo(hd1[0], hd1[1]);
  ctx.lineTo(hd2[0], hd2[1]);
  ctx.lineTo(hd3[0], hd3[1]);
  ctx.closePath();
  ctx.fill();
  // The little lamp on the belt.
  const [lx, ly] = tp(p, 3.4, -0.4);
  glow(ctx, LAMP, lx, ly, 13 + sky.glow * 8, (0.35 + sky.glow * 0.5) * lamp);
  ctx.fillStyle = mixHex(LAMP, LAMP_CORE, 0.5);
  ctx.globalAlpha = 0.6 + 0.4 * lamp;
  ctx.beginPath();
  ctx.arc(lx, ly, 1.25, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
}

/** The line: taut while held, recoiling toward the lantern after letting go. */
export function drawLine(ctx: CanvasRenderingContext2D, from: [number, number], to: [number, number], sky: Sky, opts: { reach: number; slack: number; alpha: number; tremble: number; time: number }): void {
  if (opts.alpha <= 0.01) return;
  const ex = from[0] + (to[0] - from[0]) * opts.reach;
  const ey = from[1] + (to[1] - from[1]) * opts.reach;
  const mx = (from[0] + ex) / 2 + Math.sin(opts.time * 60) * opts.tremble;
  const my = (from[1] + ey) / 2 + opts.slack;
  ctx.strokeStyle = mixHex(sky.ink, LAMP, 0.15 + sky.night * 0.55);
  ctx.globalAlpha = opts.alpha;
  ctx.lineWidth = 1.15;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(from[0], from[1]);
  ctx.quadraticCurveTo(mx, my, ex, ey);
  ctx.stroke();
  ctx.globalAlpha = 1;
}
