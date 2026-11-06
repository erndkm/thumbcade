/**
 * The hole: a tear in the page you look down through. Each page below is torn a little smaller, so the tear is a
 * tunnel of paper edges, each casting a shadow on the next, into ink-dark at the bottom where two eyes watch where
 * you're going. Swallowed doodles fall inside it, under the rim. The rim is sketched round in ballpoint and boils.
 */
import { begin, hash, ink, PAL, pt, shash } from "./ink.ts";

const N = 56;
const LAYERS = [
  { k: 1, color: "#E6DDC8", seed: 11 },
  { k: 0.77, color: "#CDBFA3", seed: 23 },
  { k: 0.57, color: "#9A8C74", seed: 37 },
  { k: 0.38, color: "#2A2738", seed: 51 },
] as const;
const buf = new Float32Array(N * 2);

/** Fills `buf` with a torn outline of radius r around (x, y). */
function tear(x: number, y: number, r: number, seed: number, step: number): void {
  const pa = hash(seed, 1) * 6.28;
  const pb = hash(seed, 2) * 6.28;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    // Lumps, a torn zigzag (paper fibres tear in little teeth), and a hair of boil.
    const k = 1 + 0.045 * Math.sin(a * 3 + pa) + 0.03 * Math.sin(a * 7 + pb) + 0.022 * (hash(i, seed) - 0.5) * 2 + (i % 2 ? 0.014 : -0.014) + 0.006 * shash(i, seed, step);
    buf[i * 2] = x + Math.cos(a) * r * k;
    buf[i * 2 + 1] = y + Math.sin(a) * r * k;
  }
}

function path(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath();
  ctx.moveTo(buf[0]!, buf[1]!);
  for (let i = 1; i < N; i++) ctx.lineTo(buf[i * 2]!, buf[i * 2 + 1]!);
  ctx.closePath();
}

export interface HoleLook {
  x: number;
  y: number;
  r: number;
  /** Boil step. */
  step: number;
  /** Where the eyes look (unit-ish vector). */
  lookX: number;
  lookY: number;
  mood: "idle" | "happy" | "dizzy" | "scared" | "gulp";
  /** 0 open … 1 shut. */
  blink: number;
  /** Screen px per page unit (keeps the pen line about 2 px wide). */
  z: number;
  /** Rule positions for the page below (first rule y, gap). */
  rule0: number;
  ruleGap: number;
  accent: string;
  /** 0-1: the rim glows in the accent (last bites, final gulp). */
  glow: number;
}

/** Draws the tear; `inside` draws what is falling, clipped to the rim. */
export function drawHole(ctx: CanvasRenderingContext2D, h: HoleLook, inside: () => void): void {
  const { x, y, r } = h;
  // The tunnel of torn pages.
  for (let li = 0; li < LAYERS.length; li++) {
    const L = LAYERS[li]!;
    tear(x, y, r * L.k, L.seed, h.step);
    ctx.save();
    path(ctx);
    ctx.fillStyle = L.color;
    ctx.fill();
    ctx.clip();
    if (li === 0) {
      // The page below has rules too, a little out of line with this one.
      ctx.fillStyle = "rgba(112,156,214,0.35)";
      const lw = Math.max(1, 0.9 / h.z);
      const off = h.ruleGap * 0.37;
      const top = y - r * 1.1;
      let ry = h.rule0 + off + Math.ceil((top - h.rule0 - off) / h.ruleGap) * h.ruleGap;
      for (; ry < y + r * 1.1; ry += h.ruleGap) ctx.fillRect(x - r * 1.1, ry - lw / 2, r * 2.2, lw);
    }
    // The edge above casts a soft shadow onto this page.
    ctx.strokeStyle = li === LAYERS.length - 1 ? "rgba(10,8,20,0.55)" : "rgba(50,38,22,0.32)";
    ctx.lineWidth = r * L.k * 0.22;
    ctx.stroke();
    ctx.lineWidth = r * L.k * 0.08;
    ctx.strokeStyle = "rgba(50,38,22,0.22)";
    ctx.stroke();
    ctx.restore();
  }
  drawEyes(ctx, h);
  // What's falling, under the rim.
  tear(x, y, r, LAYERS[0].seed, h.step);
  ctx.save();
  path(ctx);
  ctx.clip();
  inside();
  ctx.restore();
  // The torn fringe: a ragged lighter lip, a sketched ballpoint outline and a few cracks.
  const pen = 2 / h.z;
  ctx.strokeStyle = "#FFFDF6";
  ctx.lineWidth = Math.max(pen * 1.4, r * 0.05);
  path(ctx);
  ctx.stroke();
  if (h.glow > 0.01) {
    ctx.globalAlpha = h.glow * 0.8;
    ctx.strokeStyle = h.accent;
    ctx.lineWidth = Math.max(pen * 2.2, r * 0.07);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  begin();
  for (let i = 0; i <= N + 2; i++) {
    const j = i % N;
    pt(x + (buf[j * 2]! - x) * 1.03, y + (buf[j * 2 + 1]! - y) * 1.03);
  }
  ink(ctx, 4441, { width: pen * 1.1, jitter: pen * 0.6, step: h.step, color: PAL.ink, closed: false });
  // Torn flaps of the page curling in over the edge.
  for (let c = 0; c < 3; c++) {
    const i = (Math.floor(hash(c, 77) * (N / 3)) + c * Math.floor(N / 3)) % N;
    const j = (i + 3) % N;
    const ax = buf[i * 2]!;
    const ay = buf[i * 2 + 1]!;
    const bx = buf[j * 2]!;
    const by = buf[j * 2 + 1]!;
    const mx = (ax + bx) / 2;
    const my = (ay + by) / 2;
    const depth = 0.16 + hash(c, 78) * 0.1;
    const tx = mx + (x - mx) * depth * 1.4 + (by - ay) * 0.25;
    const ty = my + (y - my) * depth * 1.4 - (bx - ax) * 0.25;
    ctx.fillStyle = "rgba(40,30,20,0.25)";
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(tx + (x - tx) * 0.12, ty + (y - ty) * 0.12);
    ctx.lineTo(bx, by);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#F4EEDF";
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(tx, ty);
    ctx.lineTo(bx, by);
    ctx.closePath();
    ctx.fill();
    begin();
    pt(ax, ay);
    pt(tx, ty);
    pt(bx, by);
    ink(ctx, 4500 + c, { width: pen * 0.8, jitter: pen * 0.3, step: h.step, color: PAL.ink, passes: 1 });
  }
}

function drawEyes(ctx: CanvasRenderingContext2D, h: HoleLook): void {
  const { x, y, r } = h;
  const ex = r * 0.15;
  const lx = Math.max(-1, Math.min(1, h.lookX));
  const ly = Math.max(-1, Math.min(1, h.lookY));
  const cy = y - r * 0.03 + ly * r * 0.04;
  const cx = x + lx * r * 0.05;
  ctx.lineCap = "round";
  for (const side of [-1, 1]) {
    const px = cx + side * ex;
    if (h.mood === "happy" || h.mood === "gulp") {
      ctx.strokeStyle = "#F7F1E2";
      ctx.lineWidth = r * 0.035;
      ctx.beginPath();
      ctx.arc(px, cy + r * 0.03, r * 0.06, Math.PI * 1.15, Math.PI * 1.85);
      ctx.stroke();
      continue;
    }
    if (h.mood === "dizzy") {
      ctx.strokeStyle = "#F7F1E2";
      ctx.lineWidth = r * 0.025;
      ctx.beginPath();
      for (let i = 0; i <= 14; i++) {
        const a = (i / 14) * Math.PI * 3.2 + h.step * 0.9 * side;
        const rr = r * 0.075 * (i / 14);
        if (i === 0) ctx.moveTo(px, cy);
        else ctx.lineTo(px + Math.cos(a) * rr, cy + Math.sin(a) * rr);
      }
      ctx.stroke();
      continue;
    }
    const big = h.mood === "scared" ? 1.25 : 1;
    const open = 1 - h.blink * 0.88;
    ctx.fillStyle = "#F7F1E2";
    ctx.beginPath();
    ctx.ellipse(px, cy, r * 0.075 * big, r * 0.095 * big * open, 0, 0, Math.PI * 2);
    ctx.fill();
    if (open > 0.3) {
      ctx.fillStyle = "#14121E";
      const pr = r * (h.mood === "scared" ? 0.028 : 0.042);
      ctx.beginPath();
      ctx.arc(px + lx * r * 0.03, cy + ly * r * 0.035 * open, pr, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  if (h.mood === "gulp") {
    ctx.fillStyle = "#F7F1E2";
    ctx.beginPath();
    ctx.ellipse(cx, cy + r * 0.13, r * 0.05, r * 0.06, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}
