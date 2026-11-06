/**
 * The playfield in world units, printed on the three plates: the red earth and its gullies, sand and salt,
 * termite mounds, rocks and fallen logs, low gum branches, dust devils, desert peas, and the kangaroo.
 * Solid things knock the plates out under themselves first, so they print clean instead of overprinting the
 * landscape behind them; the misregistration then leaves the thin paper slivers a real print has.
 */
import { clamp, lerp } from "@thumbcade-games/kit/ease";
import { hash, oval, type Cam } from "./land.ts";
import { BLUE, ORANGE, SUN, type Sky } from "./palette.ts";
import type { Press } from "./riso.ts";
import { obstacleTop, type Branch, type Devil, type Flower, type Gully, type Obstacle, type Patch, type World } from "./sim.ts";

export interface View {
  W: number;
  H: number;
  cam: Cam;
  sky: Sky;
  time: number;
  /** Reduced motion: no sway, no shimmer. */
  still: boolean;
}

const PLATES = [BLUE, ORANGE, SUN] as const;
type P2 = [number, number];
const DRAW_SCALE = 1.14;

/** A plate in world units. */
export function onWorld(press: Press, name: string, v: View): CanvasRenderingContext2D {
  const c = press.plate(name);
  const z = v.cam.z;
  press.transform(c, z, 0, 0, z, v.W / 2 - v.cam.x * z, v.H / 2 - v.cam.y * z);
  return c;
}

export function visibleX(v: View, margin = 60): [number, number] {
  const half = v.W / 2 / v.cam.z;
  return [v.cam.x - half - margin, v.cam.x + half + margin];
}

function bottomY(v: View): number {
  return v.cam.y + v.H / 2 / v.cam.z + 20;
}

function topY(v: View): number {
  return v.cam.y - v.H / 2 / v.cam.z - 20;
}

/** Clears a shape out of every plate (in world units). */
function knock(press: Press, v: View, path: Path2D): void {
  for (const n of PLATES) {
    const c = onWorld(press, n, v);
    c.globalCompositeOperation = "destination-out";
    c.fillStyle = "#000";
    c.fill(path);
    c.globalCompositeOperation = "source-over";
  }
}

function fillOn(press: Press, v: View, name: string, path: Path2D, level: number): void {
  if (level <= 0.01) return;
  const c = onWorld(press, name, v);
  c.fillStyle = press.screen(name, level);
  c.fill(path);
}

// -----------------------------------------------------------------------------------------------
// Ground
// -----------------------------------------------------------------------------------------------

export function drawGround(press: Press, w: World, v: View): void {
  const [x0, x1] = visibleX(v, 20);
  const bot = bottomY(v);
  const step = 6;
  const slab = new Path2D();
  slab.moveTo(x0, bot);
  for (let x = x0; x <= x1 + step; x += step) slab.lineTo(x, w.baseY(x));
  slab.lineTo(x1 + step, bot);
  slab.closePath();
  knock(press, v, slab);
  const o = onWorld(press, ORANGE, v);
  o.fillStyle = press.solid(ORANGE);
  o.fill(slab);
  fillOn(press, v, BLUE, slab, Math.max(0, v.sky.shade - 0.12) * 0.8);
  // Strata: two deeper bands, each a step darker.
  for (const [dy, add] of [
    [34, 0.12],
    [92, 0.24],
  ] as const) {
    const band = new Path2D();
    band.moveTo(x0, bot);
    for (let x = x0; x <= x1 + step; x += step) band.lineTo(x, w.baseY(x) + dy + Math.sin(x * 0.021 + dy) * 5 + Math.sin(x * 0.007) * 7);
    band.lineTo(x1 + step, bot);
    band.closePath();
    fillOn(press, v, BLUE, band, Math.max(0, v.sky.shade - 0.12) * 0.8 + add);
  }

  // Dry grass along the lip.
  const y = onWorld(press, SUN, v);
  y.fillStyle = press.screen(SUN, 0.85);
  y.beginPath();
  const cell = 7;
  for (let c = Math.floor(x0 / cell); c <= x1 / cell; c++) {
    if (hash(c, 7) > 0.62) continue;
    const x = c * cell + hash(c, 8) * cell;
    if (w.gullyAt(x - 3) || w.gullyAt(x + 3) || w.surfaceAt(x) === "salt") continue;
    const gy = w.baseY(x) + 1;
    const h = 2.5 + hash(c, 9) * 5;
    const lean = (hash(c, 10) - 0.5) * 3;
    y.moveTo(x - 2.6, gy);
    y.lineTo(x + lean, gy - h);
    y.lineTo(x + 2.6, gy);
  }
  y.fill();

  for (const p of w.patches) if (p.x1 > x0 && p.x0 < x1) drawPatch(press, w, v, p);
  for (const g of w.gullies) if (g.x1 > x0 && g.x0 < x1) drawGully(press, w, v, g);
}

function drawGully(press: Press, w: World, v: View, g: Gully): void {
  const wd = g.x1 - g.x0;
  const depth = 58 + wd * 0.38;
  const y0 = w.baseY(g.x0);
  const y1 = w.baseY(g.x1);
  const k = g.seed * 1e4;
  const notch = new Path2D();
  notch.moveTo(g.x0 - 1, y0 - 1);
  const n = 8;
  // Near wall: stepping in like eroded ledges.
  for (let i = 1; i <= n; i++) {
    const u = i / n;
    const step = i % 2 === 0 ? 0 : 5 + hash(i, k) * 5;
    notch.lineTo(g.x0 + wd * 0.3 * u ** 1.4 + step, y0 + depth * u);
  }
  notch.lineTo(lerp(g.x0, g.x1, 0.5), y0 + depth + 14);
  for (let i = n; i >= 1; i--) {
    const u = i / n;
    const step = i % 2 === 1 ? 0 : 5 + hash(i, k + 1) * 5;
    notch.lineTo(g.x1 - wd * 0.28 * u ** 1.4 - step, y1 + depth * u);
  }
  notch.lineTo(g.x1 + 1, y1 - 1);
  notch.closePath();
  // The far wall of the gully, seen through the gap: shaded, darker in bands toward the floor.
  fillOn(press, v, BLUE, notch, 0.42 + v.sky.shade * 0.3);
  const c = onWorld(press, BLUE, v);
  c.save();
  c.clip(notch);
  for (const [f, lvl] of [
    [0.32, 0.6],
    [0.62, 0.8],
  ] as const) {
    c.fillStyle = press.screen(BLUE, lvl + v.sky.shade * 0.15);
    c.beginPath();
    c.moveTo(g.x0 - 10, y0 + depth * f + Math.sin(k) * 4);
    for (let x = g.x0; x <= g.x1 + 10; x += 12) c.lineTo(x, lerp(y0, y1, (x - g.x0) / wd) + depth * f + Math.sin(x * 0.09 + k) * 3);
    c.lineTo(g.x1 + 10, y1 + depth * 2);
    c.lineTo(g.x0 - 10, y0 + depth * 2);
    c.closePath();
    c.fill();
  }
  c.restore();
  // Sunlit lip of the far wall.
  const ledge = new Path2D();
  ledge.moveTo(g.x0 + 6, y0 + 4);
  ledge.lineTo(g.x1 - 4, y1 + 3);
  ledge.lineTo(g.x1 - 6, y1 + 9);
  ledge.lineTo(g.x0 + 9, y0 + 10);
  ledge.closePath();
  const y = onWorld(press, SUN, v);
  y.save();
  y.clip(notch);
  y.fillStyle = press.screen(SUN, 0.6 * (1 - v.sky.night * 0.7));
  y.fill(ledge);
  y.restore();
}

function drawPatch(press: Press, w: World, v: View, p: Patch): void {
  const step = 5;
  const top = new Path2D();
  const thick = p.kind === "sand" ? 12 : 5;
  top.moveTo(p.x0, w.baseY(p.x0) + 2);
  for (let x = p.x0; x <= p.x1; x += step) {
    const e = Math.min(1, (x - p.x0) / 24, (p.x1 - x) / 24);
    const hump = p.kind === "sand" ? (Math.sin(x * 0.07 + p.seed * 20) * 0.5 + 0.7) * 4 * e : 0.6 * e;
    top.lineTo(x, w.baseY(x) - hump);
  }
  for (let x = p.x1; x >= p.x0; x -= step) {
    const e = Math.min(1, (x - p.x0) / 30, (p.x1 - x) / 30);
    top.lineTo(x, w.baseY(x) + thick * e + Math.sin(x * 0.13) * 1.2 * e);
  }
  top.closePath();
  if (p.kind === "sand") {
    fillOn(press, v, SUN, top, 0.7);
    const o = onWorld(press, ORANGE, v);
    o.fillStyle = press.solid(ORANGE);
    o.fill(top);
    // Ripples.
    const b = onWorld(press, BLUE, v);
    b.strokeStyle = press.screen(BLUE, 0.55);
    b.lineWidth = 0.9;
    b.beginPath();
    for (let x = p.x0 + 14; x < p.x1 - 14; x += 9) {
      const yy = w.baseY(x) + 3 + Math.sin(x * 0.3) * 1.5;
      b.moveTo(x - 3, yy);
      b.quadraticCurveTo(x, yy - 1.6, x + 3, yy);
    }
    b.stroke();
  } else {
    // Salt: the paper itself, cracked into plates.
    knock(press, v, top);
    fillOn(press, v, BLUE, top, 0.08 + v.sky.shade * 0.4);
    const b = onWorld(press, BLUE, v);
    b.strokeStyle = press.solid(BLUE);
    b.lineWidth = 0.7;
    b.beginPath();
    for (let x = p.x0 + 10; x < p.x1 - 6; x += 13 + hash(Math.floor(x), 3) * 9) {
      const yy = w.baseY(x);
      b.moveTo(x, yy - 0.4);
      b.lineTo(x + 2 + hash(Math.floor(x), 4) * 3, yy + 2.4);
      b.lineTo(x - 1 + hash(Math.floor(x), 5) * 4, yy + 4.6);
    }
    b.stroke();
  }
}

// -----------------------------------------------------------------------------------------------
// Things on the plain
// -----------------------------------------------------------------------------------------------

function shadowOn(press: Press, v: View, x: number, y: number, rx: number, ry: number, level: number): void {
  const p = new Path2D();
  oval(p, x, y, rx, ry, 0);
  fillOn(press, v, BLUE, p, level);
}

export function drawObstacle(press: Press, v: View, o: Obstacle): void {
  const shape = new Path2D();
  const n = 22;
  shape.moveTo(o.x - o.w, o.base + 3);
  for (let k = 0; k <= n; k++) {
    const dx = -o.w + (2 * o.w * k) / n;
    shape.lineTo(o.x + dx, o.base - obstacleTop(o, dx));
  }
  shape.lineTo(o.x + o.w, o.base + 3);
  shape.closePath();
  shadowOn(press, v, o.x - o.w * 0.15, o.base + 1.5, o.w * 1.25, 3.4, 0.55);
  knock(press, v, shape);
  const ink = onWorld(press, ORANGE, v);
  if (o.kind === "log") {
    // A fallen gum: pale bark, a sawn end.
    fillOn(press, v, BLUE, shape, 0.32 + v.sky.shade * 0.3);
    fillOn(press, v, SUN, shape, 0.28);
    fillOn(press, v, ORANGE, shape, 0.15);
    const b = onWorld(press, BLUE, v);
    b.strokeStyle = press.solid(BLUE);
    b.lineWidth = 0.9;
    b.beginPath();
    for (let k = 0; k < 5; k++) {
      const yy = o.base - o.h * (0.2 + k * 0.15);
      const xa = o.x - o.w * 0.8 + hash(k, o.seed * 1e4) * 20;
      b.moveTo(xa, yy);
      b.lineTo(xa + 18 + hash(k + 3, o.seed * 1e4) * 26, yy + 0.6);
    }
    b.stroke();
    const end = new Path2D();
    oval(end, o.x + o.w * 0.9, o.base - o.h / 2, o.h * 0.22, o.h * 0.5, 0);
    ink.fillStyle = press.solid(ORANGE);
    ink.fill(end);
    fillOn(press, v, SUN, end, 0.6);
    b.beginPath();
    oval(b, o.x + o.w * 0.9, o.base - o.h / 2, o.h * 0.11, o.h * 0.26, 0);
    b.stroke();
    return;
  }
  ink.fillStyle = press.solid(ORANGE);
  ink.fill(shape);
  if (o.kind === "mound") {
    fillOn(press, v, BLUE, shape, 0.36 + v.sky.shade * 0.3);
    // Fluting down the face.
    const b = onWorld(press, BLUE, v);
    b.save();
    b.clip(shape);
    b.fillStyle = press.screen(BLUE, 0.75);
    for (let k = 0; k < 4; k++) {
      const dx = (k - 1.5) * o.w * 0.42 + (hash(k, o.seed * 1e4) - 0.5) * 4;
      b.fillRect(o.x + dx, o.base - o.h * (0.92 - Math.abs(dx) / o.w * 0.5), 1.6, o.h);
    }
    b.restore();
    // Sunlit flank.
    const lit = new Path2D();
    lit.moveTo(o.x + o.w * 0.1, o.base - o.h * 0.9);
    lit.lineTo(o.x + o.w * 0.95, o.base);
    lit.lineTo(o.x + o.w * 0.45, o.base);
    lit.closePath();
    const y = onWorld(press, SUN, v);
    y.save();
    y.clip(shape);
    y.fillStyle = press.screen(SUN, 0.5 * (1 - v.sky.night * 0.8));
    y.fill(lit);
    y.restore();
  } else {
    fillOn(press, v, BLUE, shape, 0.55 + v.sky.shade * 0.25);
    // Highlight: the blue lifts off the upper left.
    const hi = new Path2D();
    oval(hi, o.x - o.w * 0.25, o.base - o.h * 0.68, o.w * 0.45, o.h * 0.24, -0.4);
    const b = onWorld(press, BLUE, v);
    b.save();
    b.clip(shape);
    b.globalCompositeOperation = "destination-out";
    b.fillStyle = "#000";
    b.fill(hi);
    b.globalCompositeOperation = "source-over";
    b.fillStyle = press.screen(BLUE, 0.2 + v.sky.shade * 0.3);
    b.fill(hi);
    b.restore();
  }
}

/** A tapered limb along a quadratic curve from (ax, ay) through (cx, cy) to (bx, by). */
function limbPath(p: Path2D, ax: number, ay: number, cx: number, cy: number, bx: number, by: number, w0: number, w1: number): void {
  const n = 12;
  const left: P2[] = [];
  const right: P2[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = (1 - t) * (1 - t) * ax + 2 * (1 - t) * t * cx + t * t * bx;
    const y = (1 - t) * (1 - t) * ay + 2 * (1 - t) * t * cy + t * t * by;
    const dx = 2 * (1 - t) * (cx - ax) + 2 * t * (bx - cx);
    const dy = 2 * (1 - t) * (cy - ay) + 2 * t * (by - cy);
    const l = Math.hypot(dx, dy) || 1;
    const w = lerp(w0, w1, t) / 2;
    left.push([x - (dy / l) * w, y + (dx / l) * w]);
    right.push([x + (dy / l) * w, y - (dx / l) * w]);
  }
  p.moveTo(left[0]![0], left[0]![1]);
  for (const q of left) p.lineTo(q[0], q[1]);
  for (let i = right.length - 1; i >= 0; i--) p.lineTo(right[i]![0], right[i]![1]);
  p.closePath();
}

export function drawBranch(press: Press, v: View, br: Branch): void {
  const top = topY(v);
  const x0 = br.x0;
  const x1 = br.x1;
  const k = br.seed * 1e4;
  const mid = (x0 + x1) / 2;
  // A big gum leans in from above: its trunk comes down out of the sky into a heavy crown whose lowest leaves
  // are the line you have to stay under.
  const trunk = new Path2D();
  limbPath(trunk, x1 + 70, top, x1 + 40, br.y - 150, mid + 10, br.y - 70, 26, 12);
  limbPath(trunk, x1 + 30, br.y - 120, x1 - 10, br.y - 70, x0 + 10, br.y - 50, 9, 3);
  limbPath(trunk, mid + 30, br.y - 80, mid - 10, br.y - 110, x0 - 20, br.y - 120, 7, 2);

  const crown = new Path2D();
  // Rows of leaf masses, biggest high up, clumps along the bottom edge.
  const rows: Array<[number, number, number]> = [
    [br.y - 104, 28, 0.6],
    [br.y - 76, 24, 0.85],
    [br.y - 48, 19, 1],
    [br.y - 20, 13, 1],
  ];
  rows.forEach(([cy, r, spread], ri) => {
    const n = Math.max(3, Math.round(((x1 - x0) * spread + 60) / (r * 1.25)));
    for (let i = 0; i <= n; i++) {
      const x = lerp(mid - ((x1 - x0) * spread) / 2 - 24, mid + ((x1 - x0) * spread) / 2 + 30, i / n) + (hash(i + ri * 31, k) - 0.5) * r * 0.5;
      const rr = r * (0.8 + hash(i + ri * 31, k + 1) * 0.4);
      // The bottom row never reaches below the branch line.
      const y = ri === 3 ? br.y - rr * 0.62 - 1 : cy + (hash(i + ri * 31, k + 2) - 0.5) * r * 0.5;
      oval(crown, x, y, rr * 1.2, ri === 3 ? rr * 0.62 : rr * 0.95, (hash(i + ri * 31, k + 3) - 0.5) * 0.4);
    }
  });
  const tips = new Path2D();
  const m = Math.max(4, Math.round((x1 - x0) / 8));
  for (let i = 0; i <= m; i++) {
    const x = lerp(x0 + 3, x1 - 3, i / m) + (hash(i, k + 9) - 0.5) * 3;
    const len = 7 + hash(i, k + 10) * 5;
    const a = (hash(i, k + 11) - 0.5) * 0.4;
    oval(tips, x + Math.sin(a) * len * 0.5, br.y - len / 2, 1.9, len / 2, a);
  }
  knock(press, v, crown);
  knock(press, v, tips);
  fillOn(press, v, BLUE, crown, 0.4 + v.sky.night * 0.25);
  fillOn(press, v, SUN, crown, 1 - v.sky.night * 0.45);
  // Shadowed clumps inside the crown.
  const shade = new Path2D();
  for (let i = 0; i < 10; i++) {
    const x = lerp(x0 - 10, x1 + 20, hash(i, k + 20));
    const y = lerp(br.y - 120, br.y - 30, hash(i, k + 21));
    oval(shade, x, y, 10 + hash(i, k + 22) * 9, 5 + hash(i, k + 23) * 4, 0.2);
  }
  const b = onWorld(press, BLUE, v);
  b.save();
  b.clip(crown);
  b.fillStyle = press.screen(BLUE, 0.72);
  b.fill(shade);
  b.restore();
  fillOn(press, v, BLUE, tips, 0.6);
  fillOn(press, v, SUN, tips, 1 - v.sky.night * 0.45);
  // The trunk and limbs over the leaves: dark bark.
  knock(press, v, trunk);
  fillOn(press, v, BLUE, trunk, 0.62 + v.sky.night * 0.2);
  fillOn(press, v, ORANGE, trunk, 0.5);
}

export function drawDevil(press: Press, w: World, v: View, d: Devil): void {
  const gy = w.baseY(d.x);
  const o = onWorld(press, ORANGE, v);
  o.strokeStyle = press.screen(ORANGE, 0.55);
  o.lineWidth = 3.2;
  const t = v.time;
  const rings = 14;
  for (let k = 0; k < rings; k++) {
    const u = k / rings;
    const y = gy - 8 - u * 300;
    const sway = (v.still ? 0 : Math.sin(t * 1.3 + u * 4 + d.seed * 9)) * u * 18;
    const rx = d.w * (0.35 + u * 0.9);
    o.beginPath();
    const a0 = v.still ? 0 : t * 5 + k * 0.9;
    o.ellipse(d.x + sway, y, rx, 3 + u * 3, 0, a0, a0 + Math.PI * 1.3);
    o.stroke();
  }
  // Grit whirling around the column.
  o.fillStyle = press.solid(ORANGE);
  for (let i = 0; i < 26; i++) {
    const u = hash(i, d.seed * 1e4);
    const y = gy - 6 - u * 290;
    const a = (v.still ? 0 : t * (3 + hash(i, 5) * 2)) + hash(i, 6) * 6.28;
    const rx = d.w * (0.4 + u * 0.95);
    const sway = (v.still ? 0 : Math.sin(t * 1.3 + u * 4 + d.seed * 9)) * u * 18;
    o.fillRect(d.x + sway + Math.cos(a) * rx, y + Math.sin(a) * 3, 1.8, 1.8);
  }
}

export function drawFlower(press: Press, v: View, f: Flower): void {
  if (f.taken) return;
  const sway = v.still ? 0 : Math.sin(v.time * 1.7 + f.seed * 20) * 0.12;
  const x = f.x;
  const y = f.y;
  // Stem.
  const b = onWorld(press, BLUE, v);
  b.strokeStyle = press.screen(BLUE, 0.7);
  b.lineWidth = 1.2;
  b.beginPath();
  b.moveTo(x, y);
  b.lineTo(x + sway * 20, y - 9);
  b.stroke();
  // Sturt's desert peas: claw petals in orange, each with a dark boss.
  const petals = new Path2D();
  const bosses = new Path2D();
  for (let k = 0; k < 3; k++) {
    const a = -Math.PI / 2 + (k - 1) * 1.05 + sway;
    const cx = x + sway * 20 + Math.cos(a) * 4.5;
    const cy = y - 10 + Math.sin(a) * 4.5;
    oval(petals, cx + Math.cos(a) * 2.5, cy + Math.sin(a) * 2.5, 5.4, 2.4, a);
    oval(bosses, cx, cy, 1.9, 1.5, a);
  }
  knock(press, v, petals);
  const o = onWorld(press, ORANGE, v);
  o.fillStyle = press.solid(ORANGE);
  o.fill(petals);
  fillOn(press, v, SUN, petals, 0.2);
  b.fillStyle = press.solid(BLUE);
  b.fill(bosses);
}

// -----------------------------------------------------------------------------------------------
// The kangaroo
// -----------------------------------------------------------------------------------------------

export interface Pose {
  /** Feet point (the sim's x, y) and where planted feet are during a stance. */
  x: number;
  y: number;
  footX: number;
  footY: number;
  stance: boolean;
  /** 0..1 squat depth. */
  squat: number;
  /** 0 = legs trailing after takeoff, 1 = legs reaching for the ground. */
  reach: number;
  vy: number;
  /** -1..1: how much the joey is out of the pouch. */
  joey: number;
  /** Whole-body rotation (tumbling). */
  rot: number;
  /** Ear flop from speed and landings. */
  ears: number;
  /** Tail swing (rad) from the body's motion. */
  tail: number;
  blink: number;
}


/** Two-bone IK: knee position for a hip-to-heel chain (thigh a, shin b), bending forward (+x). */
function knee(hip: P2, heel: P2, a: number, b: number): P2 {
  const dx = heel[0] - hip[0];
  const dy = heel[1] - hip[1];
  let d = Math.hypot(dx, dy);
  d = Math.min(d, a + b - 0.01);
  const cosA = clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1);
  const base = Math.atan2(dy, dx);
  // The knee goes to the side that keeps it forward of the hip-heel line.
  const ang = base - Math.acos(cosA);
  return [hip[0] + Math.cos(ang) * a, hip[1] + Math.sin(ang) * a];
}

interface Rig {
  /** Filled body parts, each its own path so overlaps never cancel out. */
  parts: Path2D[];
  ears: Path2D;
  nearStroke: Array<[Path2D, number]>;
  farStroke: Array<[Path2D, number]>;
  belly: Path2D;
  tailTip: Path2D;
  joey: Path2D | null;
  dots: Path2D;
}

function limb(points: P2[], widths: number[]): Array<[Path2D, number]> {
  const out: Array<[Path2D, number]> = [];
  for (let i = 0; i < points.length - 1; i++) {
    const p = new Path2D();
    p.moveTo(points[i]![0], points[i]![1]);
    p.lineTo(points[i + 1]![0], points[i + 1]![1]);
    out.push([p, widths[i]!]);
  }
  return out;
}

function rig(p: Pose): Rig {
  const sq = p.squat;
  const x = p.x;
  const y = p.y;
  // Body landmarks relative to the feet point (they match the sim's collision points). In a squat the
  // haunch drops most and the head least: the animal sits into its legs, eyes up.
  const hip: P2 = [x - 5, y - 21 + sq * 12];
  const chest: P2 = [x + 11, y - 33 + sq * 8];
  const head: P2 = [x + 19, y - 45 + sq * 6];
  let heel: P2;
  let toe: P2;
  if (p.stance) {
    heel = [p.footX - 9, p.footY - 1.5];
    toe = [p.footX + 8, p.footY];
  } else {
    const r = p.reach;
    heel = [lerp(x - 19, x - 7, r), lerp(y - 5, y - 6, r)];
    toe = [lerp(x - 33, x + 8, r), lerp(y + 3, y - 1, r)];
  }
  const kneeP = knee(hip, heel, 14, 15);
  const parts: Path2D[] = [];
  const add = (f: (q: Path2D) => void) => {
    const q = new Path2D();
    f(q);
    parts.push(q);
  };
  const along = Math.atan2(chest[1] - hip[1], chest[0] - hip[0]);
  add((q) => oval(q, hip[0], hip[1], 14, 12.5, -0.35));
  add((q) => oval(q, (hip[0] + chest[0]) / 2 + 1, (hip[1] + chest[1]) / 2 - 1, 16, 11, along));
  add((q) => oval(q, chest[0], chest[1], 8.5, 8));
  add((q) => {
    q.moveTo(chest[0] - 3, chest[1] - 5);
    q.lineTo(head[0] - 5, head[1] + 1);
    q.lineTo(head[0] + 3, head[1] + 4);
    q.lineTo(chest[0] + 7, chest[1] - 1);
    q.closePath();
  });
  add((q) => oval(q, head[0], head[1], 6.6, 5.6, -0.2));
  add((q) => oval(q, head[0] + 6.4, head[1] + 1.6, 5, 3.3, 0.18));
  // Ears: long, swept back with speed.
  const earA = -1.95 - p.ears * 0.5;
  const ears = new Path2D();
  for (const [ox, k] of [
    [-2.2, 1],
    [0.6, 0.86],
  ] as const) {
    const bx = head[0] + ox;
    const by = head[1] - 3;
    oval(ears, bx + Math.cos(earA) * 5.8 * k, by + Math.sin(earA) * 5.8 * k, 7 * k, 2.7, earA);
  }
  parts.push(ears);
  // Tail: a thick root tapering out behind; a strut on the ground in a deep squat.
  const tailRoot: P2 = [hip[0] - 8, hip[1] + 3];
  let tip: P2;
  if (p.stance && sq > 0.2) tip = [hip[0] - 40, Math.min(p.footY - 1.5, lerp(hip[1] + 8, p.footY - 1.5, sq))];
  else {
    const a = Math.PI + 0.12 + p.tail;
    tip = [tailRoot[0] + Math.cos(a) * 38, tailRoot[1] - Math.sin(a) * 38];
  }
  const tmid: P2 = [(tailRoot[0] + tip[0]) / 2, (tailRoot[1] + tip[1]) / 2 + 3];
  const nl = Math.hypot(tip[0] - tailRoot[0], tip[1] - tailRoot[1]) || 1;
  const nx = -(tip[1] - tailRoot[1]) / nl;
  const ny = (tip[0] - tailRoot[0]) / nl;
  add((q) => {
    q.moveTo(tailRoot[0] + nx * 7, tailRoot[1] + ny * 7);
    q.quadraticCurveTo(tmid[0] + nx * 3.2, tmid[1] + ny * 3.2, tip[0], tip[1]);
    q.quadraticCurveTo(tmid[0] - nx * 3.2, tmid[1] - ny * 3.2, tailRoot[0] - nx * 7, tailRoot[1] - ny * 7);
    q.closePath();
  });
  const tailTip = new Path2D();
  oval(tailTip, lerp(tailRoot[0], tip[0], 0.86), lerp(tailRoot[1], tip[1], 0.86) + 0.5, 6, 1.9, Math.atan2(tip[1] - tailRoot[1], tip[0] - tailRoot[0]));

  // Legs: the near one over the far one, a hair apart.
  const nearLeg = limb([hip, kneeP, heel, toe], [11, 6, 4.4]);
  const off: P2 = [-3, -1.5];
  const farLeg = limb(
    [
      [hip[0] + off[0], hip[1] + off[1]],
      [kneeP[0] + off[0] - 1, kneeP[1] + off[1]],
      [heel[0] + off[0] - 2, heel[1] - 0.5],
      [toe[0] + off[0] - 2, toe[1] - 0.5],
    ],
    [10, 5.4, 4],
  );
  // Arms: short, held in front of the chest.
  const sh: P2 = [chest[0] + 2, chest[1] + 3];
  const paw: P2 = [sh[0] + (p.stance ? 7 : 5.5), sh[1] + 7];
  const nearArm = limb([sh, [sh[0] + 3, sh[1] + 4], paw], [3.6, 2.8]);
  const farArm = limb(
    [
      [sh[0] - 2, sh[1]],
      [sh[0] + 1, sh[1] + 5],
      [paw[0] - 2, paw[1] + 1],
    ],
    [3.2, 2.6],
  );

  const belly = new Path2D();
  oval(belly, chest[0] - 3, chest[1] + 7, 6.5, 8.5, -0.7);
  // The joey, peeking out of the pouch.
  let joey: Path2D | null = null;
  const jx = chest[0] - 3;
  const jy = chest[1] + 10 - p.joey * 5;
  const dots = new Path2D();
  if (p.blink < 0.5) oval(dots, head[0] + 1.6, head[1] - 0.8, 1.2, 1.4);
  else dots.rect(head[0] + 0.3, head[1] - 0.8, 2.6, 0.7);
  oval(dots, head[0] + 10.6, head[1] + 1.2, 1.5, 1.2);
  if (p.joey > -0.5) {
    joey = new Path2D();
    oval(joey, jx, jy, 3.6, 3.1);
    oval(joey, jx + 3, jy + 0.8, 2.2, 1.5, 0.2);
    oval(joey, jx - 1.6, jy - 3.6, 1.2, 3, -0.4);
    oval(joey, jx + 0.6, jy - 3.8, 1.1, 2.7, -0.15);
    oval(dots, jx + 1.2, jy - 0.3, 0.75, 0.85);
  }
  return { parts, ears, nearStroke: [...nearLeg, ...nearArm], farStroke: [...farLeg, ...farArm], belly, tailTip, joey, dots };
}

function strokeAll(c: CanvasRenderingContext2D, list: Array<[Path2D, number]>): void {
  c.lineCap = "round";
  c.lineJoin = "round";
  for (const [p, wdt] of list) {
    c.lineWidth = wdt;
    c.stroke(p);
  }
}

/** Fills/strokes the near silhouette (body, near limbs, joey) with the current styles. */
function silhouette(c: CanvasRenderingContext2D, r: Rig, far: boolean): void {
  for (const q of r.parts) c.fill(q);
  strokeAll(c, r.nearStroke);
  if (far) strokeAll(c, r.farStroke);
  if (r.joey) c.fill(r.joey);
}

export function drawKangaroo(press: Press, v: View, p: Pose, groundAt: (x: number) => number, clipBelow: number | null): void {
  const r = rig(p);
  // Shadow on the ground, shrinking with height.
  const gy = groundAt(p.x - 4);
  if (gy < 1000 && !p.rot) {
    const hgt = clamp((gy - p.y) / 200);
    shadowOn(press, v, p.x - 4, gy + 1, 22 * (1 - hgt * 0.5), 3.2 * (1 - hgt * 0.4), 0.6 * (1 - hgt * 0.6));
  }
  const pivotX = p.x;
  const pivotY = p.y - 26;
  // Drawn a little larger than the body the sim collides with: near misses read as near misses.
  const sx = p.stance ? p.footX : p.x;
  const sy = p.stance ? p.footY : p.y;
  const ctxFor = (name: string) => {
    const c = onWorld(press, name, v);
    c.save();
    if (clipBelow !== null) {
      c.beginPath();
      c.rect(p.x - 200, clipBelow - 600, 400, 600);
      c.clip();
    }
    c.translate(sx, sy);
    c.scale(DRAW_SCALE, DRAW_SCALE);
    c.translate(-sx, -sy);
    if (p.rot) {
      c.translate(pivotX, pivotY);
      c.rotate(p.rot);
      c.translate(-pivotX, -pivotY);
    }
    return c;
  };
  const knockout = (c: CanvasRenderingContext2D, f: () => void) => {
    c.globalCompositeOperation = "destination-out";
    c.fillStyle = "#000";
    c.strokeStyle = "#000";
    f();
    c.globalCompositeOperation = "source-over";
  };
  // 1. Clear the landscape under the whole animal.
  for (const n of PLATES) {
    const c = ctxFor(n);
    knockout(c, () => silhouette(c, r, true));
    c.restore();
  }
  // 2. Orange: everything solid; the belly a lighter screen.
  {
    const c = ctxFor(ORANGE);
    c.fillStyle = press.solid(ORANGE);
    c.strokeStyle = c.fillStyle;
    silhouette(c, r, true);
    knockout(c, () => c.fill(r.belly));
    c.fillStyle = press.screen(ORANGE, 0.45);
    c.fill(r.belly);
    if (r.joey) {
      c.fillStyle = press.solid(ORANGE);
      c.fill(r.joey);
    }
    c.restore();
  }
  // 3. Blue: the far limbs in shadow, hidden where the near body covers them; a warm shade over the body.
  {
    const c = ctxFor(BLUE);
    c.strokeStyle = press.screen(BLUE, 0.75);
    strokeAll(c, r.farStroke);
    knockout(c, () => silhouette(c, r, false));
    c.fillStyle = press.screen(BLUE, 0.32 + v.sky.shade * 0.25);
    c.strokeStyle = c.fillStyle;
    silhouette(c, r, false);
    knockout(c, () => c.fill(r.belly));
    if (r.joey) {
      c.fillStyle = press.screen(BLUE, 0.35);
      c.fill(r.joey);
    }
    c.fillStyle = press.screen(BLUE, 0.7);
    c.fill(r.tailTip);
    c.fillStyle = press.solid(BLUE);
    c.fill(r.dots);
    c.restore();
  }
  // 4. Sunflower: the inside of the ears and a warm chest.
  {
    const c = ctxFor(SUN);
    c.fillStyle = press.screen(SUN, 0.6);
    c.fill(r.ears);
    c.fillStyle = press.screen(SUN, 0.35);
    c.fill(r.belly);
    c.restore();
  }
}
