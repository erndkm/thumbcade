/**
 * The notebook world in world units: ruled paper that travels with the camera, page breaks, the doodled ground
 * and everything standing on it (baked into chunk sprites, three boil variants each), and the live doodles that
 * move: warm air, storms, wires, kites, birds, stars, hoops, the trail and the plane itself.
 */
import { clamp } from "@thumbcade-games/kit/ease";
import { begin, boil, doodleArrow, ellipse, ellipsePts, fillBuf, hand, hash, hatch, highlight, ink, line, PAL, pt, shash, write, bold } from "./ink.ts";
import { HALF, PAGE_M, WU_PER_M, SINK_DEPTH, type Bird, type Body, type Column, type Gust, type Hoop, type Kite, type Prop, type Star, type Storm, type Wire, type World } from "./sim.ts";

/** Pagewing's extra inks on top of marginalia's palette. */
export const INK2 = {
  /** Highlighter for warm air. */
  warm: "#FFAE5C",
  /** Felt-tip for the plane's grade and the hoops. */
  red: PAL.red,
} as const;

export interface Cam {
  x: number;
  y: number;
  z: number;
}

export interface View {
  W: number;
  H: number;
  cam: Cam;
  time: number;
  dpr: number;
}

/** World units between ruled lines. */
export const RULE = 34;
/** World units per page (a page break every PAGE_M meters). */
export const PAGE_W = PAGE_M * WU_PER_M;

export function worldTransform(ctx: CanvasRenderingContext2D, v: View, ox = 0, oy = 0): void {
  const s = v.dpr * v.cam.z;
  ctx.setTransform(s, 0, 0, s, v.dpr * (v.W / 2 - v.cam.x * v.cam.z + ox), v.dpr * (v.H / 2 - v.cam.y * v.cam.z + oy));
}

export function visible(v: View, margin = 60): [number, number, number, number] {
  const hw = v.W / 2 / v.cam.z;
  const hh = v.H / 2 / v.cam.z;
  return [v.cam.x - hw - margin, v.cam.x + hw + margin, v.cam.y - hh - margin, v.cam.y + hh + margin];
}

// -----------------------------------------------------------------------------------------------
// Paper: grain in screen space (rendered once per size), rules and page breaks in world space.
// -----------------------------------------------------------------------------------------------

export function renderGrain(W: number, H: number, dpr: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = Math.round(W * dpr);
  c.height = Math.round(H * dpr);
  const ctx = c.getContext("2d", { alpha: false })!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = PAL.paper;
  ctx.fillRect(0, 0, W, H);
  const specks = Math.round((W * H) / 700);
  for (let i = 0; i < specks; i++) {
    const x = hash(i, 11) * W;
    const y = hash(i, 12) * H;
    const a = 0.03 + hash(i, 13) * 0.06;
    ctx.fillStyle = hash(i, 14) < 0.5 ? `rgba(120,100,70,${a})` : `rgba(90,90,100,${a})`;
    const s = 0.6 + hash(i, 15) * 1.1;
    ctx.fillRect(x, y, s, s);
  }
  ctx.lineWidth = 0.6;
  for (let i = 0; i < 40; i++) {
    const x = hash(i, 21) * W;
    const y = hash(i, 22) * H;
    const a = hash(i, 23) * Math.PI;
    const l = 4 + hash(i, 24) * 9;
    ctx.strokeStyle = "rgba(110,95,70,0.08)";
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + Math.cos(a) * l * 0.5 + 2, y + Math.sin(a) * l * 0.5, x + Math.cos(a) * l, y + Math.sin(a) * l);
    ctx.stroke();
  }
  return c;
}

/** Printed rules (straight: the hand-drawn things wobble, the paper doesn't). Screen space. */
export function drawRules(ctx: CanvasRenderingContext2D, v: View): void {
  const { W, H, cam } = v;
  const gap = RULE * cam.z;
  const first = Math.ceil((cam.y - H / 2 / cam.z) / RULE) * RULE;
  ctx.fillStyle = PAL.rule;
  for (let y = first; ; y += RULE) {
    const sy = (y - cam.y) * cam.z + H / 2;
    if (sy > H) break;
    ctx.fillRect(0, Math.round(sy) - 0.5, W, 1);
  }
  void gap;
}

/**
 * Page breaks, screen space at their world x: the gutter, punched holes, the next page's red margin and its
 * number written at the top.
 */
export function drawPageBreaks(ctx: CanvasRenderingContext2D, v: View, top: number | null): void {
  const { W, H, cam } = v;
  const x0 = cam.x - W / 2 / cam.z - 80;
  const x1 = cam.x + W / 2 / cam.z + 80;
  for (let p = Math.max(1, Math.ceil(x0 / PAGE_W)); p * PAGE_W < x1; p++) {
    const sx = (p * PAGE_W - cam.x) * cam.z + W / 2;
    // The gutter: the last page's edge with a soft shadow, then the next page.
    const g = ctx.createLinearGradient(sx - 14, 0, sx + 10, 0);
    g.addColorStop(0, "rgba(80,70,50,0)");
    g.addColorStop(0.55, "rgba(80,70,50,0.10)");
    g.addColorStop(0.6, "rgba(80,70,50,0.22)");
    g.addColorStop(1, "rgba(80,70,50,0)");
    ctx.fillStyle = g;
    ctx.fillRect(sx - 14, 0, 24, H);
    // Punched holes, spaced on the paper (they move with it vertically).
    const hx = sx + 24 * cam.z;
    const gap = 9 * RULE;
    const firstY = Math.floor((cam.y - H / 2 / cam.z) / gap) * gap;
    for (let y = firstY; y < cam.y + H / 2 / cam.z + gap; y += gap) {
      const hy = (y + RULE * 0.5 - cam.y) * cam.z + H / 2;
      const r = 8.5 * Math.max(0.7, cam.z);
      ctx.fillStyle = PAL.paperBack;
      ctx.beginPath();
      ctx.arc(hx, hy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(80,70,50,0.25)";
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(hx, hy, r * 0.92, Math.PI * 0.95, Math.PI * 1.9);
      ctx.stroke();
    }
    // The margin.
    ctx.fillStyle = PAL.margin;
    ctx.fillRect(Math.round(sx + 58 * cam.z) - 0.75, 0, 1.5, H);
    if (top !== null) write(ctx, `p. ${p + 1}`, sx + 66 * cam.z, top + 26, hand(22), PAL.graphite, 300 + p, { alpha: 0.75, rot: -0.03 });
  }
}

// -----------------------------------------------------------------------------------------------
// Ground chunks: the ground line, hatching and every prop, baked per boil variant.
// -----------------------------------------------------------------------------------------------

export const CHUNK_W = 420;
const CHUNK_TOP = -430;
const CHUNK_BOT = 110;
export const VARIANTS = 3;

interface Chunk {
  i: number;
  scale: number;
  canvases: Array<HTMLCanvasElement | null>;
}

export class Ground {
  private chunks = new Map<number, Chunk>();
  constructor(private world: World) {}

  reset(world: World): void {
    this.world = world;
    this.chunks.clear();
  }

  /** Bakes at most `budget` missing chunk variants that are (nearly) on screen. */
  prepare(v: View, scale: number, budget = 1): void {
    const [x0, x1] = visible(v, 260);
    const i0 = Math.floor(x0 / CHUNK_W);
    const i1 = Math.floor(x1 / CHUNK_W);
    for (const [i, c] of this.chunks) if (i < i0 - 1 || i > i1 + 1 || Math.abs(c.scale - scale) > scale * 0.25) this.chunks.delete(i);
    // The variant on screen right now first, then the others.
    const want = boil.step % VARIANTS;
    for (let pass = 0; pass < 2 && budget > 0; pass++) {
      for (let i = i0; i <= i1 && budget > 0; i++) {
        let c = this.chunks.get(i);
        if (!c) this.chunks.set(i, (c = { i, scale, canvases: [null, null, null] }));
        for (let k = 0; k < VARIANTS && budget > 0; k++) {
          const vv = pass === 0 ? want : k;
          if (c.canvases[vv]) continue;
          c.canvases[vv] = this.bake(i, vv, scale);
          budget--;
          if (pass === 0) break;
        }
      }
    }
  }

  draw(ctx: CanvasRenderingContext2D, v: View): void {
    const [x0, x1] = visible(v, 10);
    const want = boil.step % VARIANTS;
    for (let i = Math.floor(x0 / CHUNK_W); i <= Math.floor(x1 / CHUNK_W); i++) {
      const c = this.chunks.get(i);
      if (!c) continue;
      const canvas = c.canvases[want] ?? c.canvases.find((k) => k) ?? null;
      if (!canvas) continue;
      ctx.drawImage(canvas, i * CHUNK_W, CHUNK_TOP, CHUNK_W, CHUNK_BOT - CHUNK_TOP);
    }
  }

  private bake(i: number, variant: number, scale: number): HTMLCanvasElement {
    const c = document.createElement("canvas");
    c.width = Math.ceil(CHUNK_W * scale);
    c.height = Math.ceil((CHUNK_BOT - CHUNK_TOP) * scale);
    const ctx = c.getContext("2d")!;
    const x0 = i * CHUNK_W;
    ctx.setTransform(scale, 0, 0, scale, -x0 * scale, -CHUNK_TOP * scale);
    const step = 1000 + variant;
    const w = this.world;
    // Ponds first (under the ground line).
    for (const p of w.ponds) if (p.x1 > x0 - 20 && p.x0 < x0 + CHUNK_W + 20) drawPond(ctx, w, p.x0, p.x1, step);
    // Hatching under the ground, sparser as it goes down.
    const k0 = Math.floor((x0 - 30) / 7);
    const k1 = Math.ceil((x0 + CHUNK_W + 30) / 7);
    for (let k = k0; k <= k1; k++) {
      const x = k * 7;
      if (w.isWater(x)) continue;
      const gy = w.groundY(x);
      const l = 8 + hash(k, 61) * 13;
      const y0 = gy + 3 + hash(k, 62) * 2;
      line(ctx, x, y0, x - l * 0.45, y0 + l, 600 + k, { color: PAL.graphite, width: 0.9, passes: 1, jitter: 0.5, step, alpha: 0.5 });
    }
    // The ground line itself: global point indices, so neighbouring chunks meet exactly.
    groundLine(ctx, w, x0 - 40, x0 + CHUNK_W + 40, step);
    // Grass tufts.
    const t0 = Math.floor((x0 - 20) / 31);
    for (let t = t0; t * 31 < x0 + CHUNK_W + 20; t++) {
      const x = t * 31 + shash(t, 81) * 9;
      if (w.isWater(x) || hash(t, 83) < 0.35) continue;
      const gy = w.groundY(x);
      const k = 0.7 + hash(t, 82) * 0.6;
      for (let j = -1; j <= 1; j++) line(ctx, x + j * 3, gy, x + j * 6 * k, gy - 8 * k - (j === 0 ? 3 : 0), 800 + t * 5 + j, { width: 1.2, passes: 1, jitter: 0.5, step });
    }
    for (const p of w.props) {
      if (p.x + p.w + 40 < x0 || p.x - p.w - 40 > x0 + CHUNK_W) continue;
      drawProp(ctx, p, step);
    }
    return c;
  }
}

function groundLine(ctx: CanvasRenderingContext2D, w: World, x0: number, x1: number, step: number): void {
  const S = 18;
  const k0 = Math.floor(x0 / S);
  const k1 = Math.ceil(x1 / S);
  const j = 1.1 * boil.amp;
  for (const pass of [0, 1]) {
    ctx.beginPath();
    let first = true;
    let px = 0;
    let py = 0;
    for (let k = k0; k <= k1; k++) {
      const x = k * S + shash(k, 71 + pass * 3, step) * j * 0.6;
      const y = w.groundY(k * S) + shash(k, 72 + pass * 3, step) * j + (pass ? 0.6 : 0);
      if (first) {
        ctx.moveTo(x, y);
        first = false;
      } else ctx.quadraticCurveTo(px, py, (px + x) / 2, (py + y) / 2);
      px = x;
      py = y;
    }
    ctx.lineTo(px, py);
    ctx.strokeStyle = PAL.ink;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.globalAlpha = pass ? 0.4 : 0.92;
    ctx.lineWidth = pass ? 1.4 : 2.1;
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function drawPond(ctx: CanvasRenderingContext2D, w: World, x0: number, x1: number, step: number): void {
  const y = w.groundY((x0 + x1) / 2) - 1;
  const seed = Math.round(x0);
  // Water: a few wavy ballpoint lines, a lily pad, a duck if there's room.
  for (let r = 0; r < 3; r++) {
    begin();
    const yy = y + 4 + r * 6;
    const a = x0 + 6 + r * 8;
    const b = x1 - 6 - r * 8;
    for (let x = a; x <= b; x += 10) pt(x, yy + Math.sin(x * 0.3 + r) * 1.4);
    ink(ctx, seed + r, { color: PAL.ink, width: 1.1, passes: 1, alpha: 0.65 - r * 0.15, step });
  }
  ellipse(ctx, x0 + (x1 - x0) * 0.3, y + 4, 9, 3, seed + 9, { width: 1.2, passes: 1, step, color: PAL.ink });
  if (x1 - x0 > 110) {
    const dx = x0 + (x1 - x0) * 0.66;
    begin();
    pt(dx - 9, y);
    pt(dx - 8, y - 6);
    pt(dx + 2, y - 7);
    pt(dx + 4, y - 14);
    pt(dx + 9, y - 13);
    pt(dx + 8, y - 7);
    pt(dx + 10, y - 3);
    pt(dx + 6, y);
    pt(dx - 9, y);
    ink(ctx, seed + 11, { width: 1.4, step });
    line(ctx, dx + 10, y - 12, dx + 15, y - 11, seed + 12, { color: INK2.warm, width: 2, passes: 1, step });
  }
}

/** A prop standing on the ground at (p.x, p.y). */
export function drawProp(ctx: CanvasRenderingContext2D, p: Prop, step: number): void {
  const { x, y, w, h, seed } = p;
  const o = { step };
  switch (p.kind) {
    case "house": {
      const roof = h * 0.62;
      const L = x - w / 2;
      const R = x + w / 2;
      // Chimney first so the roof line crosses it.
      if (p.chimney !== undefined) {
        const cx = x + p.chimney;
        const ry = y - h - roof * (1 - Math.abs(p.chimney) / (w / 2 + 4));
        line(ctx, cx - 6, ry + 8, cx - 6, ry - 14, seed + 1, { width: 1.8, ...o });
        line(ctx, cx + 6, ry + 6, cx + 6, ry - 14, seed + 11, { width: 1.8, ...o });
        line(ctx, cx - 8, ry - 14, cx + 8, ry - 14, seed + 2, { width: 2, ...o });
      }
      line(ctx, L, y + 1, L + shash(seed, 1) * 1.5, y - h, seed + 3, { width: 2, ...o });
      line(ctx, R, y + 1, R + shash(seed, 2) * 1.5, y - h, seed + 13, { width: 2, ...o });
      line(ctx, L - 6, y - h + 2, x, y - h - roof, seed + 4, { width: 2.1, ...o });
      line(ctx, x, y - h - roof, R + 6, y - h + 2, seed + 14, { width: 2.1, ...o });
      line(ctx, L - 3, y - h + 1, R + 3, y - h + 1, seed + 24, { width: 1.4, passes: 1, ...o });
      hatch(
        ctx,
        () => {
          ctx.beginPath();
          ctx.moveTo(L - 4, y - h + 1);
          ctx.lineTo(x, y - h - roof + 3);
          ctx.lineTo(R + 4, y - h + 1);
          ctx.closePath();
        },
        L - 6,
        y - h - roof,
        w + 12,
        roof + 2,
        -0.7,
        4.5,
        seed + 5,
        { color: PAL.red, step, alpha: 0.75 },
      );
      // Door and a window with its cross.
      const dl = x - w * 0.28;
      const dr = x - w * 0.08;
      line(ctx, dl, y, dl, y - h * 0.5, seed + 6, { width: 1.5, passes: 1, ...o });
      line(ctx, dr, y, dr, y - h * 0.5, seed + 16, { width: 1.5, passes: 1, ...o });
      line(ctx, dl, y - h * 0.5, dr, y - h * 0.5, seed + 26, { width: 1.5, passes: 1, ...o });
      const wx = x + w * 0.2;
      const wy = y - h * 0.62;
      highlight(ctx, wx - 7, wy - 6, 14, 12, seed + 10, PAL.hiYellow, 0.55);
      line(ctx, wx - 8, wy - 7, wx + 8, wy - 7, seed + 7, { width: 1.5, passes: 1, ...o });
      line(ctx, wx + 8, wy - 7, wx + 8, wy + 7, seed + 17, { width: 1.5, passes: 1, ...o });
      line(ctx, wx + 8, wy + 7, wx - 8, wy + 7, seed + 27, { width: 1.5, passes: 1, ...o });
      line(ctx, wx - 8, wy + 7, wx - 8, wy - 7, seed + 37, { width: 1.5, passes: 1, ...o });
      line(ctx, wx, wy - 7, wx, wy + 7, seed + 8, { width: 1.1, passes: 1, ...o });
      line(ctx, wx - 8, wy, wx + 8, wy, seed + 9, { width: 1.1, passes: 1, ...o });
      break;
    }
    case "tree": {
      const cr = w / 2;
      const cy = y - h + cr;
      line(ctx, x - 2, y, x - 1.5, cy + cr * 0.4, seed, { width: 1.8, ...o });
      line(ctx, x + 2.5, y, x + 2, cy + cr * 0.4, seed + 1, { width: 1.8, ...o });
      // A cloudy crown: a lumpy loop with scribbled shading on one side.
      begin();
      const n = 11;
      for (let i = 0; i <= n + 1; i++) {
        const a = (i / n) * Math.PI * 2;
        const lump = 1 + 0.12 * Math.sin(a * 5 + seed);
        pt(x + Math.cos(a) * cr * lump, cy + Math.sin(a) * cr * 0.92 * lump);
      }
      ink(ctx, seed + 2, { width: 1.9, ...o });
      hatch(
        ctx,
        () => {
          ctx.beginPath();
          ctx.ellipse(x + cr * 0.25, cy + cr * 0.2, cr * 0.7, cr * 0.65, 0, 0, Math.PI * 2);
        },
        x - cr,
        cy - cr,
        cr * 2,
        cr * 2,
        0.9,
        4,
        seed + 3,
        { color: PAL.graphite, step, alpha: 0.6 },
      );
      break;
    }
    case "pine": {
      // One zigzag outline: each tier juts out and tucks back in.
      const tiers = Math.max(3, Math.round(h / 24));
      const top = y - h;
      const base = y - h * 0.14;
      const R: Array<[number, number]> = [];
      for (let i = 1; i <= tiers; i++) {
        const u = i / tiers;
        const ty = top + (base - top) * u;
        R.push([x + (w / 2) * u, ty], [x + (w / 2) * u * 0.45, ty - 2]);
      }
      begin();
      for (let i = R.length - 2; i >= 0; i--) pt(2 * x - R[i]![0], R[i]![1]);
      pt(x, top);
      for (let i = 0; i < R.length - 1; i++) pt(R[i]![0], R[i]![1]);
      ink(ctx, seed, { width: 1.7, jitter: 0.7, ...o });
      line(ctx, x - w / 2, base, x + w / 2, base, seed + 8, { width: 1.5, passes: 1, ...o });
      line(ctx, x, y, x, base, seed + 9, { width: 2, ...o });
      break;
    }
    case "pole": {
      line(ctx, x, y, x, y - h, seed, { width: 2.4, ...o });
      line(ctx, x - 10, y - h + 4, x + 10, y - h + 4, seed + 1, { width: 2, ...o });
      for (const dx of [-8, 8]) ellipse(ctx, x + dx, y - h + 1, 2, 2.5, seed + 2 + dx, { width: 1.2, passes: 1, ...o });
      break;
    }
    case "kid": {
      // A stick figure with the kite string in a raised hand.
      ellipse(ctx, x, y - 26, 4.5, 4.5, seed, { width: 1.6, passes: 1, ...o });
      line(ctx, x, y - 21.5, x, y - 10, seed + 1, { width: 1.6, passes: 1, ...o });
      line(ctx, x, y - 10, x - 4, y, seed + 2, { width: 1.6, passes: 1, ...o });
      line(ctx, x, y - 10, x + 4, y, seed + 3, { width: 1.6, passes: 1, ...o });
      line(ctx, x, y - 18, x + 4, y - 22, seed + 4, { width: 1.5, passes: 1, ...o });
      line(ctx, x, y - 18, x - 5, y - 14, seed + 5, { width: 1.5, passes: 1, ...o });
      break;
    }
    case "flower": {
      line(ctx, x, y, x + 1, y - h, seed, { width: 1.2, passes: 1, ...o });
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2;
        ellipse(ctx, x + 1 + Math.cos(a) * 3.6, y - h - 2 + Math.sin(a) * 3.6, 2.4, 2.4, seed + 3 + k, { width: 1, passes: 1, jitter: 0.4, color: PAL.red, ...o });
      }
      break;
    }
    case "rock": {
      ellipse(ctx, x, y - 4, w / 2, 6, seed, { width: 1.5, passes: 1, ...o });
      hatch(
        ctx,
        () => {
          ctx.beginPath();
          ctx.ellipse(x, y - 4, w / 2, 6, 0, 0, Math.PI * 2);
        },
        x - w / 2,
        y - 10,
        w,
        12,
        0.8,
        3.2,
        seed + 1,
        { color: PAL.graphite, step, alpha: 0.7 },
      );
      break;
    }
    case "fence": {
      const n = Math.max(2, Math.round(w / 22));
      for (let i = 0; i <= n; i++) line(ctx, x + (i / n) * w, y + 1, x + (i / n) * w + shash(seed, i) * 1.5, y - h, seed + i, { width: 1.6, passes: 1, ...o });
      line(ctx, x - 3, y - h * 0.75, x + w + 3, y - h * 0.72, seed + 40, { width: 1.4, passes: 1, ...o });
      line(ctx, x - 3, y - h * 0.32, x + w + 3, y - h * 0.3, seed + 41, { width: 1.4, passes: 1, ...o });
      break;
    }
    case "cat": {
      // A loaf of a cat, sitting, tail curled, watching the sky.
      begin();
      pt(x - 9, y);
      pt(x - 10, y - 9);
      pt(x - 6, y - 15);
      pt(x - 7, y - 21);
      pt(x - 3, y - 17);
      pt(x + 2, y - 17);
      pt(x + 5, y - 21);
      pt(x + 5, y - 14);
      pt(x + 8, y - 8);
      pt(x + 8, y);
      ink(ctx, seed, { width: 1.7, ...o });
      begin();
      pt(x + 8, y - 2);
      pt(x + 15, y - 3);
      pt(x + 17, y - 9);
      pt(x + 14, y - 12);
      ink(ctx, seed + 1, { width: 1.6, passes: 1, ...o });
      ctx.fillStyle = PAL.ink;
      ctx.fillRect(x - 4, y - 14, 1.6, 1.6);
      ctx.fillRect(x + 1, y - 14, 1.6, 1.6);
      break;
    }
    case "mug": {
      const L = x - w * 0.45;
      const R = x + w * 0.45;
      begin();
      pt(L, y - h);
      pt(L + 2, y - 3);
      pt(L + 6, y);
      pt(R - 6, y);
      pt(R - 2, y - 3);
      pt(R, y - h);
      ink(ctx, seed, { width: 2.2, ...o });
      ellipse(ctx, x, y - h, w * 0.45, 4.5, seed + 1, { width: 1.8, passes: 1, ...o });
      begin();
      pt(R - 1, y - h * 0.78);
      pt(R + 12, y - h * 0.74);
      pt(R + 14, y - h * 0.5);
      pt(R + 10, y - h * 0.3);
      pt(R - 2, y - h * 0.28);
      ink(ctx, seed + 2, { width: 2, ...o });
      highlight(ctx, L + 4, y - h * 0.62, w * 0.82, h * 0.3, seed + 3, INK2.warm, 0.5);
      write(ctx, "cocoa", x - w * 0.02, y - h * 0.38, hand(15), PAL.inkDeep, seed + 4, { align: "center", step, rot: -0.04 });
      break;
    }
    case "campfire": {
      line(ctx, x - 15, y - 2, x + 13, y - 9, seed, { width: 3, ...o });
      line(ctx, x - 13, y - 9, x + 15, y - 2, seed + 1, { width: 3, ...o });
      begin();
      pt(x - 9, y - 7);
      pt(x - 6, y - 18);
      pt(x - 2, y - 13);
      pt(x + 1, y - 24);
      pt(x + 5, y - 13);
      pt(x + 8, y - 17);
      pt(x + 9, y - 7);
      fillBuf(ctx, INK2.warm, 0.7);
      ink(ctx, seed + 2, { width: 1.8, color: PAL.red, ...o });
      for (const dx of [-14, -5, 6, 15]) ellipse(ctx, x + dx, y - 1, 3.5, 2.5, seed + 10 + dx, { width: 1.2, passes: 1, color: PAL.graphite, ...o });
      break;
    }
    case "kettle": {
      begin();
      pt(x - 22, y);
      pt(x - 24, y - 20);
      pt(x - 16, y - 36);
      pt(x + 16, y - 36);
      pt(x + 24, y - 20);
      pt(x + 22, y);
      pt(x - 22, y);
      ink(ctx, seed, { width: 2.1, ...o });
      begin();
      pt(x + 21, y - 18);
      pt(x + 34, y - 30);
      pt(x + 37, y - 40);
      ink(ctx, seed + 1, { width: 2, ...o });
      begin();
      pt(x - 14, y - 36);
      pt(x - 10, y - 48);
      pt(x + 10, y - 48);
      pt(x + 14, y - 36);
      ink(ctx, seed + 2, { width: 1.8, passes: 1, ...o });
      ellipse(ctx, x, y - 38, 3, 2.4, seed + 3, { width: 1.5, passes: 1, ...o });
      hatch(
        ctx,
        () => {
          ctx.beginPath();
          ctx.rect(x - 20, y - 30, 40, 26);
        },
        x - 22,
        y - 32,
        44,
        30,
        -0.8,
        4.2,
        seed + 4,
        { color: PAL.graphite, step, alpha: 0.55 },
      );
      break;
    }
    case "volcano": {
      begin();
      pt(x - w / 2, y + 4);
      pt(x - w * 0.2, y - h * 0.7);
      pt(x - 10, y - h);
      pt(x + 10, y - h);
      pt(x + w * 0.2, y - h * 0.7);
      pt(x + w / 2, y + 4);
      ink(ctx, seed, { width: 2.2, ...o });
      hatch(
        ctx,
        () => {
          ctx.beginPath();
          ctx.moveTo(x - w / 2 + 10, y);
          ctx.lineTo(x - 8, y - h + 4);
          ctx.lineTo(x + 8, y - h + 4);
          ctx.lineTo(x + w / 2 - 10, y);
          ctx.closePath();
        },
        x - w / 2,
        y - h,
        w,
        h,
        -0.75,
        6,
        seed + 1,
        { color: PAL.graphite, step, alpha: 0.5 },
      );
      begin();
      pt(x - 4, y - h + 1);
      pt(x - 8, y - h * 0.8);
      pt(x - 5, y - h * 0.62);
      ink(ctx, seed + 2, { color: PAL.red, width: 2.6, passes: 1, step });
      break;
    }
    case "pond":
      break;
  }
}

// -----------------------------------------------------------------------------------------------
// Live doodles
// -----------------------------------------------------------------------------------------------

/** Warm air: loose highlighter strokes up the column, its edges marked in wavy dashed pencil, arrows. */
export function drawColumnBack(ctx: CanvasRenderingContext2D, c: Column, v: View, label: boolean): void {
  const heat = c.heat;
  const top = c.top - 30;
  const hgt = c.base - top;
  const k = 0.25 + 0.75 * heat;
  // Three long, leaning highlighter strokes, each a little shorter than the last.
  const prev = ctx.globalCompositeOperation;
  ctx.globalCompositeOperation = "multiply";
  ctx.strokeStyle = INK2.warm;
  ctx.lineCap = "butt";
  for (let i = 0; i < 3; i++) {
    const off = (i - 1) * c.w * 0.55 + shash(c.seed, i) * 4;
    const len = hgt * (1 - i * 0.12) * (0.85 + 0.15 * hash(c.seed, i + 5));
    ctx.globalAlpha = (0.2 - i * 0.03) * k;
    ctx.lineWidth = c.w * (0.62 - i * 0.08);
    ctx.beginPath();
    ctx.moveTo(c.x + off, c.base - 6);
    ctx.quadraticCurveTo(c.x + off + shash(c.seed, i + 9) * 10, c.base - len * 0.5, c.x + off * 1.3 + shash(c.seed, i + 11) * 8, c.base - len);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = prev;
  // Wavy dashed edges: where the warm air ends.
  ctx.setLineDash([7, 9]);
  for (const side of [-1, 1]) {
    begin();
    const n = Math.max(6, Math.round(hgt / 40));
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      const y = c.base - 10 - u * (hgt - 30);
      const spread = c.w * (1 + u * 0.6);
      pt(c.x + side * spread + Math.sin(u * 9 + c.seed + v.time * 0.6) * 4, y);
    }
    ink(ctx, c.seed + side * 31, { color: PAL.graphite, width: 1.2, passes: 1, alpha: 0.45 * k, jitter: 0.5 });
  }
  ctx.setLineDash([]);
  // Pencil arrows up the middle.
  for (let i = 0; i < 3; i++) {
    const ay = c.base - 90 - i * (hgt / 3.3);
    if (ay < top + 60) break;
    const ax = c.x + (i % 2 ? -1 : 1) * c.w * 0.5;
    doodleArrow(ctx, ax, ay + 30, ax + shash(c.seed, i) * 3, ay - 12, 2, c.seed + i * 7, { color: PAL.graphite, width: 1.5, passes: 1, head: 8, alpha: 0.6 * k });
  }
  if (label) {
    write(ctx, "warm air!", c.x + c.w * 1.25 + 6, c.base - 110, hand(26), PAL.inkDeep, c.seed + 99, { rot: -0.08 });
    doodleArrow(ctx, c.x + c.w * 1.25 + 10, c.base - 100, c.x + c.w * 0.7, c.base - 70, 6, c.seed + 98, { width: 1.5, passes: 1, head: 8 });
  }
}

/** What rises: puffs of smoke off fires and chimneys, curls of steam off mugs and kettles. */
export function drawColumnSmoke(ctx: CanvasRenderingContext2D, c: Column, v: View, reduced: boolean): void {
  const heat = c.heat;
  const top = c.top;
  const hgt = c.base - top;
  const steam = c.kind === "mug" || c.kind === "kettle";
  const n = steam ? 8 : 7;
  const speed = reduced ? 35 : 75;
  for (let i = 0; i < n; i++) {
    const u = ((v.time * speed) / hgt + i / n) % 1;
    const y = c.base - 8 - u * hgt;
    const sway = Math.sin(u * 6 + i * 1.7 + c.seed) * c.w * 0.3 * (0.3 + u);
    const fade = Math.min(1, u * 5) * (1 - u) ** 0.7 * (0.2 + 0.8 * heat);
    if (fade < 0.05) continue;
    const ex = c.x + sway + (c.kind === "kettle" ? 34 * (1 - u) ** 3 : 0);
    const seed = c.seed + i * 13 + Math.floor(((v.time * speed) / hgt + i / n) | 0) * 101;
    if (steam) {
      const r = 7 + u * 12;
      begin();
      for (let k = 0; k <= 6; k++) pt(ex + Math.sin(k * 1.05 + i) * r * 0.55, y + r * 1.4 - k * r * 0.48);
      ink(ctx, seed, { color: PAL.ink, width: 1.6, passes: 1, alpha: fade * 0.75, jitter: 0.6 });
    } else {
      // A lumpy puff that grows as it rises.
      const r = 8 + u * 22;
      begin();
      const m = 9;
      for (let k = 0; k <= m + 1; k++) {
        const a = (k / m) * Math.PI * 2;
        const lump = 1 + 0.22 * Math.abs(Math.sin(a * 2.5 + seed));
        pt(ex + Math.cos(a) * r * lump, y + Math.sin(a) * r * 0.75 * lump);
      }
      ink(ctx, seed, { color: c.kind === "chimney" ? PAL.ink : PAL.graphite, width: 1.5, passes: 1, alpha: fade * 0.7, jitter: 0.8 });
    }
  }
}

/** Doodled fair-weather clouds on the page: scenery, nothing happens in them. */
export function drawClouds(ctx: CanvasRenderingContext2D, v: View): void {
  const [x0, x1, y0, y1] = visible(v, 160);
  const S = 380;
  for (let k = Math.floor(x0 / S); k * S < x1; k++) {
    if (hash(k, 701) < 0.35) continue;
    const x = k * S + hash(k, 702) * 200;
    const y = -280 - hash(k, 703) * 520;
    const w = 50 + hash(k, 704) * 60;
    if (y < y0 - 60 || y > y1 + 60) continue;
    // Bumps along the top, a flat underside left open on one end.
    begin();
    const bumps = 3 + Math.floor(hash(k, 705) * 2);
    pt(x - w * 0.55, y);
    for (let i = 0; i <= bumps * 3; i++) {
      const u = i / (bumps * 3);
      const bx = x - w * 0.5 + u * w;
      const ph = (u * bumps) % 1;
      pt(bx, y - 6 - Math.sin(ph * Math.PI) * (12 + hash(k, 706 + Math.floor(u * bumps)) * 10));
    }
    pt(x + w * 0.55, y);
    pt(x + w * 0.2, y + 1);
    ink(ctx, k * 7 + 1, { color: PAL.ink, width: 1.4, passes: 1, alpha: 0.5 });
  }
}

export function drawStorm(ctx: CanvasRenderingContext2D, s: Storm, v: View, reduced: boolean): void {
  const { x, y, w, h } = s;
  // Rain: dashes falling through the sinking air.
  const n = Math.round(w / 12);
  const fall = reduced ? 90 : 220;
  for (let i = 0; i < n; i++) {
    const rx = x - w / 2 + 8 + (i / n) * (w - 16) + shash(s.seed, i) * 4;
    const ph = hash(s.seed, i) * SINK_DEPTH;
    const ry = y + 8 + ((v.time * fall + ph) % SINK_DEPTH);
    const a = 0.55 * (1 - (ry - y) / SINK_DEPTH);
    line(ctx, rx, ry, rx - 3, ry + 10, s.seed + i, { color: PAL.graphite, width: 1.1, passes: 1, alpha: a, jitter: 0.3 });
  }
  // The cloud: a lumpy outline, scribbled dark.
  begin();
  const m = 13;
  for (let i = 0; i <= m + 1; i++) {
    const a = (i / m) * Math.PI * 2;
    const lump = 1 + 0.16 * Math.abs(Math.sin(a * 3.5 + s.seed));
    pt(x + Math.cos(a) * (w / 2) * lump, y - h * 0.3 + Math.sin(a) * (h / 2) * lump * (Math.sin(a) > 0 ? 0.6 : 1));
  }
  fillBuf(ctx, PAL.paper, 1);
  ink(ctx, s.seed, { width: 2.2 });
  hatch(
    ctx,
    () => {
      ctx.beginPath();
      ctx.ellipse(x, y - h * 0.3, w * 0.46, h * 0.42, 0, 0, Math.PI * 2);
    },
    x - w / 2,
    y - h,
    w,
    h,
    0.6,
    3.4,
    s.seed + 1,
    { color: PAL.inkDeep, alpha: 0.75 },
  );
  // A little bolt (static: it never flashes).
  begin();
  pt(x + w * 0.12, y + 4);
  pt(x + w * 0.05, y + 18);
  pt(x + w * 0.13, y + 17);
  pt(x + w * 0.06, y + 32);
  ink(ctx, s.seed + 2, { color: PAL.red, width: 1.8, passes: 1 });
  doodleArrow(ctx, x - w / 2 - 14, y + 4, x - w / 2 - 12, y + 44, -2, s.seed + 3, { color: PAL.graphite, width: 1.3, passes: 1, head: 7, alpha: 0.6 });
}

/** A gust: three wavy whoosh lines with arrowheads, drifting forward. */
export function drawGust(ctx: CanvasRenderingContext2D, g: Gust, v: View, label: boolean, reduced: boolean): void {
  const len = g.x1 - g.x0;
  const drift = ((v.time * (reduced ? 20 : 60)) % 40) - 20;
  for (let i = -1; i <= 1; i++) {
    const y = g.y + i * 17;
    const a = g.x0 + 10 + Math.abs(i) * 16 + drift * 0.5;
    const b = g.x1 - 6 - Math.abs(i) * 10 + drift * 0.5;
    begin();
    const n = Math.max(6, Math.round((b - a) / 18));
    for (let k = 0; k <= n; k++) {
      const x = a + ((b - a) * k) / n;
      pt(x, y + Math.sin(k * 1.3 + i + v.time * (reduced ? 1 : 3)) * 3.2);
    }
    ink(ctx, g.seed + i * 7, { color: PAL.inkDeep, width: 1.5, passes: 1, alpha: 0.7, jitter: 0.5 });
    line(ctx, b, y, b - 8, y - 5, g.seed + i * 7 + 1, { color: PAL.inkDeep, width: 1.5, passes: 1, alpha: 0.7 });
    line(ctx, b, y, b - 8, y + 5, g.seed + i * 7 + 2, { color: PAL.inkDeep, width: 1.5, passes: 1, alpha: 0.7 });
  }
  // A curl where the wind starts.
  begin();
  for (let k = 0; k <= 10; k++) {
    const t = (k / 10) * Math.PI * 1.6;
    pt(g.x0 + 4 + Math.cos(t + Math.PI) * (9 - k * 0.5), g.y + Math.sin(t + Math.PI) * (9 - k * 0.5));
  }
  ink(ctx, g.seed + 40, { color: PAL.graphite, width: 1.2, passes: 1, alpha: 0.7 });
  if (label) write(ctx, "wind! then hold", g.x0 + len * 0.15, g.y - 34, hand(22), PAL.graphite, g.seed + 41, { rot: -0.05 });
}

export function drawWire(ctx: CanvasRenderingContext2D, w: World, wire: Wire): void {
  begin();
  for (let i = 0; i <= 6; i++) {
    const x = wire.x0 + ((wire.x1 - wire.x0) * i) / 6;
    pt(x, w.wireY(wire, x));
  }
  ink(ctx, wire.seed, { width: 1.3, passes: 1, jitter: 0.5 });
}

export function drawKite(ctx: CanvasRenderingContext2D, w: World, k: Kite, t: number): void {
  const [kx, ky] = w.kitePos(k, t);
  // The string sags a little toward the kid.
  begin();
  for (let i = 0; i <= 5; i++) {
    const u = i / 5;
    pt(k.ax + (kx - k.ax) * u, k.ay + (ky + 10 - k.ay) * u + Math.sin(u * Math.PI) * 10);
  }
  ink(ctx, k.seed, { color: PAL.graphite, width: 1, passes: 1, jitter: 0.4 });
  // Diamond with spars, a red half, a tail of bows that swings.
  const tilt = Math.sin(t * 1.3 + k.ph) * 0.18;
  const c = Math.cos(tilt);
  const s = Math.sin(tilt);
  const P = (dx: number, dy: number) => pt(kx + dx * c - dy * s, ky + dx * s + dy * c);
  begin();
  P(0, -16);
  P(11, -2);
  P(0, 16);
  P(-11, -2);
  fillBuf(ctx, PAL.paper, 1);
  begin();
  P(0, -16);
  P(11, -2);
  P(0, 16);
  fillBuf(ctx, PAL.red, 0.35);
  begin();
  P(0, -16);
  P(11, -2);
  P(0, 16);
  P(-11, -2);
  P(0, -16);
  ink(ctx, k.seed + 1, { width: 1.8 });
  begin();
  P(0, -16);
  P(0, 16);
  ink(ctx, k.seed + 2, { width: 1, passes: 1 });
  begin();
  P(-11, -2);
  P(11, -2);
  ink(ctx, k.seed + 3, { width: 1, passes: 1 });
  begin();
  for (let i = 0; i <= 6; i++) P(Math.sin(t * 2.4 + i * 0.9 + k.ph) * 5 * (i / 6), 16 + i * 7);
  ink(ctx, k.seed + 4, { width: 1, passes: 1, color: PAL.graphite });
  for (let i = 1; i <= 3; i++) {
    const bx = kx + Math.sin(t * 2.4 + i * 1.8 + k.ph) * 5 * (i / 3);
    const by = ky + 16 + i * 13;
    line(ctx, bx - 4, by - 2, bx + 4, by + 2, k.seed + 10 + i, { width: 1.6, passes: 1, color: PAL.red });
  }
}

export function drawBird(ctx: CanvasRenderingContext2D, w: World, b: Bird, t: number): void {
  const x = w.birdX(b, t);
  const y = w.birdY(b, t);
  const flap = Math.sin(t * 9 + b.ph);
  begin();
  pt(x - 11, y - 2 - flap * 6);
  pt(x - 5, y - 5 - flap * 2);
  pt(x, y);
  pt(x + 5, y - 5 - flap * 2);
  pt(x + 11, y - 2 - flap * 6);
  ink(ctx, b.seed, { width: 2 });
  ctx.fillStyle = PAL.ink;
  ctx.beginPath();
  ctx.arc(x - 1, y - 1, 1.6, 0, Math.PI * 2);
  ctx.fill();
}

export function drawStar(ctx: CanvasRenderingContext2D, s: Star, t: number): void {
  const bob = Math.sin(t * 1.8 + s.ph) * 2.5;
  const x = s.x;
  const y = s.y + bob;
  const r = 9;
  begin();
  for (let i = 0; i <= 10; i++) {
    const a = -Math.PI / 2 + (i / 10) * Math.PI * 2 + Math.sin(t * 0.8 + s.ph) * 0.15;
    const rr = i % 2 ? r * 0.45 : r;
    pt(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  fillBuf(ctx, PAL.hiYellow, 0.85);
  ink(ctx, Math.round(s.ph * 1000), { width: 1.5, jitter: 0.5 });
}

/** A paper hoop seen almost edge-on; the back half is drawn before the plane, the front half after. */
export function drawHoop(ctx: CanvasRenderingContext2D, o: Hoop, half: "back" | "front"): void {
  const rx = o.r * 0.3;
  const ry = o.r;
  ellipsePts(o.x, o.y, rx, ry, o.seed, 0.08, 16);
  ctx.save();
  ctx.beginPath();
  if (half === "back") ctx.rect(o.x - rx * 2, o.y - ry * 2, rx * 2, ry * 4);
  else ctx.rect(o.x, o.y - ry * 2, rx * 2, ry * 4);
  ctx.clip();
  ink(ctx, o.seed, { color: o.taken ? PAL.graphite : PAL.red, width: half === "front" ? 2.6 : 1.8, alpha: o.taken ? 0.5 : 1 });
  ctx.restore();
}

/** Faint pencil notes up in the sky of each page: a reward for flying high. */
export function drawSkyNotes(ctx: CanvasRenderingContext2D, v: View): void {
  const [x0, x1, y0, y1] = visible(v, 80);
  const S = 520;
  for (let k = Math.floor(x0 / S); k * S < x1; k++) {
    if (k < 1) continue;
    const kind = Math.floor(hash(k, 501) * 7);
    const x = k * S + hash(k, 502) * 260;
    const y = -560 - hash(k, 503) * 380;
    if (y < y0 || y > y1) continue;
    const g = "rgba(98,102,110,0.5)";
    const o = { color: g, width: 1.2, passes: 1 as const };
    switch (kind) {
      case 0: {
        // A sun with spiral rays.
        ellipse(ctx, x, y, 16, 16, k, o);
        for (let i = 0; i < 9; i++) {
          const a = (i / 9) * Math.PI * 2;
          line(ctx, x + Math.cos(a) * 21, y + Math.sin(a) * 21, x + Math.cos(a) * 30, y + Math.sin(a) * 30, k * 10 + i, o);
        }
        break;
      }
      case 1:
        write(ctx, "x² + 3x = ?", x, y, hand(20), g, k, {});
        break;
      case 2: {
        for (let i = 1; i < 3; i++) {
          line(ctx, x + i * 14, y - 20, x + i * 14, y + 22, k * 10 + i, o);
          line(ctx, x - 2, y - 20 + i * 14, x + 42, y - 20 + i * 14, k * 10 + i + 5, o);
        }
        write(ctx, "x", x + 3, y - 9, hand(15), g, k + 1, {});
        write(ctx, "o", x + 17, y + 5, hand(15), g, k + 2, {});
        write(ctx, "x", x + 31, y + 19, hand(15), g, k + 3, {});
        break;
      }
      case 3:
        write(ctx, "so bored", x, y, hand(22), g, k, { rot: -0.1 });
        break;
      case 4: {
        begin();
        for (let i = 0; i <= 26; i++) {
          const a = i * 0.55;
          pt(x + Math.cos(a) * i * 0.9, y + Math.sin(a) * i * 0.9);
        }
        ink(ctx, k, o);
        break;
      }
      case 5:
        write(ctx, "is it friday yet", x, y, hand(19), g, k, { rot: 0.05 });
        break;
      default:
        write(ctx, "♥", x, y, bold(26), "rgba(210,51,47,0.35)", k, {});
    }
  }
}

// -----------------------------------------------------------------------------------------------
// The plane
// -----------------------------------------------------------------------------------------------

export interface PlanePose {
  x: number;
  y: number;
  /** Nose angle above the horizon. */
  pitch: number;
  /** 0..1: stall flutter. */
  flutter: number;
  /** 0..1: crumpled into a ball. */
  crumple: number;
  /** Seed for the crumple shape. */
  seed: number;
}

/** The plane is drawn larger than its collision points (nose and tail at ±HALF): the paper forgives. */
const PLANE_SCALE = 1.45;
/** Local plane geometry (nose to the right at +x, up is -y). */
const NOSE = HALF + 3;
const TAIL = -HALF - 2;

export function drawPlane(ctx: CanvasRenderingContext2D, p: PlanePose, t: number): void {
  ctx.save();
  ctx.translate(p.x, p.y);
  if (p.crumple > 0.02) {
    drawBall(ctx, p, t);
    ctx.restore();
    return;
  }
  ctx.rotate(-p.pitch);
  ctx.scale(PLANE_SCALE, PLANE_SCALE);
  const fl = p.flutter * Math.sin(t * 38) * 2.2;
  // Far wing (a sliver peeking out behind), near wing on top, the keel below. Folded notebook paper.
  begin();
  pt(NOSE, -0.5);
  pt(TAIL + 2, -9 - fl * 0.5);
  pt(TAIL + 7, -14 - fl);
  pt(NOSE, -0.5);
  fillBuf(ctx, PAL.paperBack, 1);
  ink(ctx, 4401, { width: 1.2, passes: 1 });
  begin();
  pt(NOSE, 0);
  pt(TAIL, 1 + fl * 0.3);
  pt(TAIL + 4, -11 - fl);
  pt(NOSE, 0);
  fillBuf(ctx, PAL.paper, 1);
  // Ruled lines on the wing, and a red grade.
  ctx.strokeStyle = PAL.rule;
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  for (let k = 1; k <= 3; k++) {
    const u = k / 4;
    ctx.moveTo(TAIL + 1 + 3 * u, 1 - 12 * u);
    ctx.lineTo(NOSE - (NOSE - TAIL) * 0.75 * u, -2.5 * u);
  }
  ctx.stroke();
  write(ctx, "B-", TAIL + 7, -2, bold(7.5), PAL.red, 4402, { step: 1, wobble: 0.3 });
  begin();
  pt(NOSE, 0);
  pt(TAIL, 1 + fl * 0.3);
  pt(TAIL + 4, -11 - fl);
  pt(NOSE, 0);
  ink(ctx, 4403, { width: 1.5 });
  // Keel and the centre fold.
  begin();
  pt(NOSE - 2, 0.6);
  pt(TAIL + 1, 1.5);
  pt(TAIL + 4, 8);
  pt(NOSE - 2, 0.6);
  fillBuf(ctx, PAL.paper, 1);
  ink(ctx, 4404, { width: 1.3 });
  line(ctx, NOSE - 3, 0.8, TAIL + 2, 4, 4405, { width: 0.8, passes: 1, color: PAL.graphite, jitter: 0.3 });
  ctx.restore();
}

/** Crumpled: a scribbly paper ball. */
function drawBall(ctx: CanvasRenderingContext2D, p: PlanePose, t: number): void {
  const r = (9 + 3 * (1 - p.crumple)) * PLANE_SCALE;
  ctx.rotate(p.pitch);
  ellipsePts(0, 0, r, r * 0.9, p.seed, 0.1, 12);
  fillBuf(ctx, PAL.paper, 1);
  ink(ctx, p.seed, { width: 1.7 });
  for (let i = 0; i < 4; i++) {
    const a = hash(p.seed, i) * Math.PI * 2;
    line(ctx, Math.cos(a) * r * 0.2, Math.sin(a) * r * 0.2, Math.cos(a + 1.3) * r * 0.85, Math.sin(a + 1.3) * r * 0.85, p.seed + i, { width: 1, passes: 1, color: PAL.graphite });
  }
  void t;
}

/** The dotted pencil line the plane leaves behind. */
export function drawTrail(ctx: CanvasRenderingContext2D, pts: Float32Array, count: number, head: number, cap: number): void {
  ctx.fillStyle = PAL.graphite;
  for (let i = 0; i < count; i += 2) {
    const idx = (head - i + cap) % cap;
    const x = pts[idx * 2]!;
    const y = pts[idx * 2 + 1]!;
    const k = 1 - i / count;
    ctx.globalAlpha = 0.55 * k;
    ctx.beginPath();
    ctx.arc(x, y, 0.8 + k * 0.9, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/** Speed dashes behind something fast. */
export function speedDashes(ctx: CanvasRenderingContext2D, b: Body, k: number, seed: number): void {
  if (k <= 0.02) return;
  const V = Math.hypot(b.vx, b.vy) || 1;
  const ux = b.vx / V;
  const uy = b.vy / V;
  for (let j = -1; j <= 1; j++) {
    const ox = b.x - ux * (22 + Math.abs(j) * 6) - uy * j * 7;
    const oy = b.y - uy * (22 + Math.abs(j) * 6) + ux * j * 7;
    const len = 10 + 12 * k;
    line(ctx, ox, oy, ox - ux * len, oy - uy * len, seed + j, { color: PAL.graphite, width: 1.1, passes: 1, alpha: clamp(k) * 0.7, jitter: 0.4 });
  }
}
