/**
 * Everything on my desk, drawn in ballpoint: the pieces of the forts (baked once per size into three boil variants
 * each, then only blitted), the doodles (drawn live, because their eyes follow the wad), my textbooks, the pencil
 * case and the launcher (two pencils stuck in an eraser, a teal rubber band between their points).
 *
 * Sprites are drawn in screen orientation (y down) at `k` CSS px per metre; a body's world angle a is a screen
 * rotation of -a.
 */
import { begin, ellipse, ellipsePts, fillBuf, hash, hatch, hand, ink, line, makeSprite, PAL, pt, shash, write, type Sprite } from "./ink.ts";
import type { Book } from "./pages.ts";
import { CUP, MITES, PIECES, TAPE, WAD, type MiteKind, type PieceKind } from "./pieces.ts";

export const COL = {
  pencil: "#F6C945",
  pencilDark: "#E0A92B",
  pencilLight: "#FBE08A",
  wood: "#F1D6A8",
  graphite: "#4A4E57",
  ferrule: "#BFC4CC",
  eraser: "#F4A3AE",
  eraserDark: "#E47F8E",
  eraserLight: "#F9C6CD",
  pad: "#FFE873",
  padDark: "#F2CF3E",
  ruler: "rgba(160,200,236,0.55)",
  cupRed: "#E0503F",
  cupBlue: "#5C86D6",
  wad: "#F6F2E6",
  wadShade: "#E2DBC8",
  tape: "#C9CED6",
  tapeDark: "#9AA1AC",
  caseFill: "#D9CDF3",
  caseDark: "#B7A6E6",
} as const;

/** Highlighter fills for the doodles: no green, nothing round. */
export const MITE_FILL: Record<MiteKind, string> = { tick: "#FFE14A", stub: "#FF9CCB", lanky: "#FFB15E" };
export const BOOK_TONES = ["#9CC8F2", "#FF9CCB", "#FFD37A", "#C9E7A8", "#D6C2F0", "#F7B7A3"];

export type PieceSprites = Record<PieceKind | "wad" | "tape", Sprite[]>;

const PAD = 6;

/** Bakes three boil variants of every piece at `k` CSS px per metre and `scale` device px per CSS px. */
export function bakePieces(k: number, scale: number): PieceSprites {
  const out = {} as PieceSprites;
  const kinds: Array<PieceKind | "wad" | "tape"> = ["pencil", "pencilTip", "pencilEnd", "eraser", "pad", "ruler", "cup", "wad", "tape"];
  for (const kind of kinds) {
    const hw = kind === "wad" ? WAD.r : kind === "tape" ? TAPE.r : PIECES[kind].hw;
    const hh = kind === "wad" ? WAD.r : kind === "tape" ? TAPE.r : PIECES[kind].hh;
    out[kind] = [0, 1, 2].map((v) => makeSprite(hw * 2 * k + PAD * 2, hh * 2 * k + PAD * 2, scale, (ctx) => drawPiece(ctx, kind, hw * k, hh * k, 1000 + v * 7, k)));
  }
  return out;
}

/** One piece centred at the origin, half extents w, h in px. */
function drawPiece(ctx: CanvasRenderingContext2D, kind: PieceKind | "wad" | "tape", w: number, h: number, step: number, k: number): void {
  const o = { step, jitter: 0.55, width: 1.6 };
  switch (kind) {
    case "pencil":
      pencil(ctx, -w, w, h, true, true, step);
      break;
    case "pencilTip":
      pencil(ctx, -w, w, h, false, true, step);
      break;
    case "pencilEnd":
      pencil(ctx, -w, w, h, true, false, step);
      break;
    case "eraser": {
      const r = h * 0.45;
      roundRect(ctx, -w, -h, w * 2, h * 2, r);
      ctx.fillStyle = COL.eraser;
      ctx.fill();
      // The top face catches the light, the bottom edge is in shade, and it's been used on one corner.
      ctx.fillStyle = COL.eraserLight;
      ctx.fillRect(-w + r * 0.6, -h + 1.5, w * 2 - r * 1.2, h * 0.5);
      ctx.fillStyle = COL.eraserDark;
      ctx.fillRect(-w + r * 0.6, h * 0.55, w * 2 - r * 1.2, h * 0.4);
      ctx.fillStyle = "rgba(98,102,110,0.28)";
      ctx.beginPath();
      ctx.ellipse(w * 0.62, -h * 0.25, w * 0.22, h * 0.38, 0.3, 0, Math.PI * 2);
      ctx.fill();
      roundPts(-w, -h, w * 2, h * 2, r);
      ink(ctx, 31, { ...o, closed: true, passes: 1 });
      line(ctx, -w + r, -h * 0.05, w - r, -h * 0.1, 32, { ...o, width: 1, passes: 1, color: "rgba(36,65,154,0.5)" });
      break;
    }
    case "pad": {
      ctx.fillStyle = COL.pad;
      ctx.fillRect(-w, -h, w * 2, h * 2);
      // Side view of a pad of sticky notes: a stack of sheets, the glued edge a shade darker, the top sheet lifting.
      ctx.fillStyle = COL.padDark;
      ctx.fillRect(-w, -h, w * 0.18, h * 2);
      for (let i = 1; i < 9; i++) {
        const y = -h + (i / 9) * h * 2;
        line(ctx, -w + 1, y, w - 1, y + shash(i, 41) * 0.6, 40 + i, { ...o, width: 0.7, passes: 1, jitter: 0.25, color: "rgba(160,120,20,0.45)" });
      }
      box(ctx, -w, -h, w * 2, h * 2, 49, o);
      begin();
      pt(w * 0.2, -h);
      pt(w * 0.7, -h - h * 0.16);
      pt(w + 1, -h - h * 0.1);
      ink(ctx, 48, { ...o, width: 1.2, passes: 1 });
      break;
    }
    case "ruler": {
      ctx.fillStyle = COL.ruler;
      ctx.fillRect(-w, -h, w * 2, h * 2);
      box(ctx, -w, -h, w * 2, h * 2, 51, { ...o, width: 1.4 });
      // Ticks every centimetre of my 30 cm ruler, longer every 5, numbers every 5.
      const n = 30;
      for (let i = 1; i < n; i++) {
        const x = -w + (i / n) * w * 2;
        const l = i % 5 === 0 ? h * 1.0 : h * 0.55;
        line(ctx, x, -h, x, -h + l, 52 + i, { ...o, width: 0.8, passes: 1, jitter: 0.2 });
        if (i % 10 === 0 && k > 30) write(ctx, `${i}`, x, h - 1, hand(Math.max(7, h * 0.95)), PAL.inkDeep, 90 + i, { align: "center", step });
      }
      break;
    }
    case "cup": {
      // Upturned: the base (narrow) on top, the rolled rim on the desk.
      const t = (CUP.top / CUP.bottom) * w;
      begin();
      pt(-t, -h);
      pt(t, -h);
      pt(w, h);
      pt(-w, h);
      fillBuf(ctx, "#FFFDF8");
      // A red zigzag band and blue stripes.
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(-t, -h);
      ctx.lineTo(t, -h);
      ctx.lineTo(w, h);
      ctx.lineTo(-w, h);
      ctx.closePath();
      ctx.clip();
      begin();
      for (let i = 0; i <= 10; i++) pt(-w + (i / 10) * w * 2, -h * 0.05 + (i % 2 ? -h * 0.18 : h * 0.18));
      ink(ctx, 61, { ...o, color: COL.cupRed, width: 2.4, passes: 1 });
      for (const yy of [-h * 0.55, h * 0.45]) line(ctx, -w, yy, w, yy, 62 + yy, { ...o, color: COL.cupBlue, width: 2, passes: 1 });
      ctx.restore();
      line(ctx, -t - 1, -h, t + 1, -h, 63, o);
      line(ctx, t, -h, w, h, 64, o);
      line(ctx, w + 1, h, -w - 1, h, 65, o);
      line(ctx, -w, h, -t, -h, 66, o);
      line(ctx, -w - 1, h - 2.2, w + 1, h - 2.2, 64, { ...o, width: 1.1, passes: 1 });
      break;
    }
    case "wad": {
      // A crumpled ball of ruled paper: lumpy outline, creases, bits of the blue rules.
      begin();
      for (let i = 0; i < 11; i++) {
        const a = (i / 11) * Math.PI * 2;
        const rr = w * (0.86 + hash(i, 71) * 0.22);
        pt(Math.cos(a) * rr, Math.sin(a) * rr);
      }
      fillBuf(ctx, COL.wad);
      ink(ctx, 72, { ...o, closed: true, width: 1.5 });
      ctx.fillStyle = COL.wadShade;
      ctx.beginPath();
      ctx.ellipse(w * 0.25, w * 0.3, w * 0.5, w * 0.35, 0.4, 0, Math.PI * 2);
      ctx.fill();
      for (let i = 0; i < 4; i++) {
        const a = hash(i, 73) * Math.PI * 2;
        const r0 = w * 0.1;
        const r1 = w * (0.55 + hash(i, 74) * 0.3);
        line(ctx, Math.cos(a) * r0, Math.sin(a) * r0, Math.cos(a + 0.5) * r1, Math.sin(a + 0.5) * r1, 75 + i, { ...o, width: 0.8, passes: 1, color: "rgba(36,65,154,0.55)" });
      }
      line(ctx, -w * 0.7, -w * 0.2, w * 0.1, -w * 0.45, 79, { ...o, width: 0.9, passes: 1, color: "rgba(112,156,214,0.8)" });
      break;
    }
    case "tape": {
      ellipsePts(0, 0, w, w, 81, 0.05, 14);
      fillBuf(ctx, COL.tape);
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      ctx.beginPath();
      ctx.ellipse(-w * 0.35, -w * 0.38, w * 0.32, w * 0.18, -0.6, 0, Math.PI * 2);
      ctx.fill();
      for (let i = 0; i < 4; i++) {
        const a = -0.9 + i * 0.6;
        ctx.save();
        ctx.rotate(a);
        ctx.beginPath();
        ctx.ellipse(0, 0, w * 0.98, w * (0.3 + i * 0.12), 0, 0, Math.PI);
        ctx.strokeStyle = COL.tapeDark;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.restore();
      }
      ellipsePts(0, 0, w, w, 82, 0.1, 14);
      ink(ctx, 82, { ...o, width: 1.8 });
      break;
    }
  }
}

/** A pencil lying along x from x0 to x1 (tip toward +x), half thickness h, with or without its ends. */
function pencil(ctx: CanvasRenderingContext2D, x0: number, x1: number, h: number, back: boolean, tip: boolean, step: number): void {
  const o = { step, jitter: 0.5, width: 1.4 };
  const len = x1 - x0;
  const tipL = tip ? Math.min(len * 0.22, h * 3.2) : 0;
  const ferL = back ? h * 1.4 : 0;
  const eraL = back ? h * 1.5 : 0;
  const b0 = x0 + ferL + eraL;
  const b1 = x1 - tipL;
  // Body: three faces of a hexagonal pencil.
  ctx.fillStyle = COL.pencil;
  ctx.fillRect(b0, -h, b1 - b0, h * 2);
  ctx.fillStyle = COL.pencilLight;
  ctx.fillRect(b0, -h, b1 - b0, h * 0.55);
  ctx.fillStyle = COL.pencilDark;
  ctx.fillRect(b0, h * 0.45, b1 - b0, h * 0.55);
  line(ctx, b0, -h * 0.4, b1, -h * 0.4, 11, { ...o, width: 0.7, passes: 1, color: "rgba(160,110,20,0.5)" });
  line(ctx, b0, h * 0.4, b1, h * 0.4, 12, { ...o, width: 0.7, passes: 1, color: "rgba(160,110,20,0.5)" });
  if (back) {
    ctx.fillStyle = COL.ferrule;
    ctx.fillRect(x0 + eraL, -h * 1.02, ferL, h * 2.04);
    for (let i = 1; i < 3; i++) line(ctx, x0 + eraL + (i / 3) * ferL, -h, x0 + eraL + (i / 3) * ferL, h, 13 + i, { ...o, width: 0.8, passes: 1, color: "rgba(60,60,70,0.6)" });
    roundRect(ctx, x0, -h * 0.95, eraL + 1, h * 1.9, h * 0.6);
    ctx.fillStyle = COL.eraser;
    ctx.fill();
  }
  if (tip) {
    ctx.fillStyle = COL.wood;
    ctx.beginPath();
    ctx.moveTo(b1, -h);
    ctx.lineTo(x1, 0);
    ctx.lineTo(b1, h);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = COL.graphite;
    ctx.beginPath();
    ctx.moveTo(x1 - tipL * 0.34, -h * 0.34);
    ctx.lineTo(x1, 0);
    ctx.lineTo(x1 - tipL * 0.34, h * 0.34);
    ctx.closePath();
    ctx.fill();
  }
  // The outline: round back, straight sides, the cone, or a splintered break.
  begin();
  if (back) {
    pt(x0 + h * 0.5, -h);
    pt(x0, -h * 0.5);
    pt(x0, h * 0.5);
    pt(x0 + h * 0.5, h);
  } else {
    for (let i = 0; i <= 4; i++) pt(x0 + (i % 2 ? h * 0.55 : 0) + shash(i, 17) * 1, h - (i / 4) * h * 2);
  }
  ink(ctx, 18, { ...o, closed: !back ? false : false });
  line(ctx, x0 + (back ? h * 0.5 : 0), -h, b1, -h, 19, o);
  line(ctx, x0 + (back ? h * 0.5 : 0), h, b1, h, 20, o);
  if (tip) {
    line(ctx, b1, -h, x1, 0, 21, o);
    line(ctx, b1, h, x1, 0, 22, o);
    line(ctx, b1, -h, b1, h, 23, { ...o, width: 0.9, passes: 1 });
  } else {
    begin();
    for (let i = 0; i <= 4; i++) pt(x1 - (i % 2 ? h * 0.55 : 0) + shash(i, 24) * 1, -h + (i / 4) * h * 2);
    ink(ctx, 25, o);
  }
  if (back) line(ctx, x0 + eraL, -h, x0 + eraL, h, 26, { ...o, width: 1, passes: 1 });
}

/** A ballpoint box: four separate strokes that overshoot the corners a little, the way a quick hand draws one. */
export function box(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, seed: number, o: { step: number; width?: number; color?: string; jitter?: number; passes?: number }): void {
  const e = Math.min(2.5, Math.min(w, h) * 0.08);
  line(ctx, x - e, y, x + w + e * 0.6, y, seed, o);
  line(ctx, x + w, y - e * 0.6, x + w, y + h + e, seed + 1, o);
  line(ctx, x + w + e * 0.4, y + h, x - e * 0.8, y + h, seed + 2, o);
  line(ctx, x, y + h + e * 0.5, x, y - e, seed + 3, o);
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function roundPts(x: number, y: number, w: number, h: number, r: number): void {
  begin();
  const edge = (x0: number, y0: number, x1: number, y1: number) => {
    const n = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0) / 18));
    for (let i = 0; i < n; i++) pt(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n);
  };
  const corner = (cx: number, cy: number, a0: number) => {
    for (let i = 0; i < 3; i++) {
      const a = a0 + (i / 3) * (Math.PI / 2);
      pt(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    }
  };
  edge(x + r, y, x + w - r, y);
  corner(x + w - r, y + r, -Math.PI / 2);
  edge(x + w, y + r, x + w, y + h - r);
  corner(x + w - r, y + h - r, 0);
  edge(x + w - r, y + h, x + r, y + h);
  corner(x + r, y + h - r, Math.PI / 2);
  edge(x, y + h - r, x, y + r);
  corner(x + r, y + r, Math.PI);
}

export interface MiteLook {
  /** Where its eyes point (unit vector in screen space), and how much (0 = straight ahead). */
  lx: number;
  ly: number;
  /** "idle" | "worried" (the fort is moving) | "out" (knocked out: x eyes, scribbled over by `scribble`). */
  mood: "idle" | "worried" | "out";
  blink: number;
  /** 0-1: the red pen scribbling it out. */
  scribble: number;
  /** Squash along its height from an impact (1 = none). */
  squash: number;
  step: number;
  seed: number;
}

/**
 * A doodle at the origin in its own frame (rotate the context first), `k` px per metre, scaled by `s`. Ballpoint
 * outline over a highlighter fill, eyes that look at the wad, stick limbs.
 */
export function drawMite(ctx: CanvasRenderingContext2D, kind: MiteKind, k: number, s: number, look: MiteLook): void {
  const spec = MITES[kind];
  const w = spec.hw * k * s;
  const h = spec.hh * k * s;
  const step = look.step;
  const seed = look.seed;
  const lw = Math.max(1.2, 1.7 * s);
  const o = { step, jitter: 0.6 * s, width: lw };
  ctx.save();
  if (look.squash !== 1) {
    ctx.translate(0, h);
    ctx.scale(1 / Math.sqrt(look.squash), look.squash);
    ctx.translate(0, -h);
  }
  // Limbs first (under the body).
  if (kind === "tick") {
    line(ctx, -w * 0.35, h * 0.95, -w * 0.45, h * 1.15, seed + 1, { ...o, passes: 1 });
    line(ctx, w * 0.35, h * 0.95, w * 0.45, h * 1.15, seed + 2, { ...o, passes: 1 });
    line(ctx, -w * 0.55, h * 0.15, -w * 0.95, h * 0.35, seed + 3, { ...o, passes: 1 });
    line(ctx, w * 0.55, h * 0.15, w * 0.95, h * 0.0, seed + 4, { ...o, passes: 1 });
  } else if (kind === "stub") {
    line(ctx, -w * 0.4, h, -w * 0.62, h, seed + 1, { ...o, passes: 1 });
    line(ctx, w * 0.4, h, w * 0.62, h, seed + 2, { ...o, passes: 1 });
    line(ctx, -w, h * 0.1, -w * 1.3, -h * 0.25, seed + 3, { ...o, passes: 1 });
    line(ctx, w, h * 0.1, w * 1.3, h * 0.35, seed + 4, { ...o, passes: 1 });
  } else {
    line(ctx, -w, -h * 0.1, -w * 1.5, h * 0.3, seed + 3, { ...o, passes: 1 });
    line(ctx, w, -h * 0.1, w * 1.45, h * 0.25, seed + 4, { ...o, passes: 1 });
  }
  // Body.
  begin();
  if (kind === "tick") {
    pt(-w, h);
    pt(w, h);
    pt(0, -h);
  } else if (kind === "stub") {
    const r = w * 0.28;
    pt(-w + r, -h);
    pt(w - r, -h);
    pt(w, -h + r);
    pt(w, h - r);
    pt(w - r, h);
    pt(-w + r, h);
    pt(-w, h - r);
    pt(-w, -h + r);
  } else {
    const r = w * 0.5;
    pt(-w + r, -h);
    pt(w - r, -h);
    pt(w, -h + r);
    pt(w, h);
    pt(-w, h);
    pt(-w, -h + r);
  }
  fillBuf(ctx, MITE_FILL[kind]);
  ink(ctx, seed, { ...o, closed: true });
  if (kind === "lanky") {
    // A curl of hair.
    begin();
    for (let i = 0; i <= 6; i++) {
      const a = (i / 6) * Math.PI * 1.6;
      pt(Math.cos(a) * w * 0.3 + i * w * 0.05, -h - w * 0.25 - Math.sin(a) * w * 0.3);
    }
    ink(ctx, seed + 5, { ...o, passes: 1, width: lw * 0.9 });
  }
  // Face.
  const ey = kind === "tick" ? h * 0.25 : kind === "stub" ? -h * 0.2 : -h * 0.55;
  const ex = kind === "tick" ? w * 0.24 : kind === "stub" ? w * 0.34 : w * 0.38;
  const er = Math.max(2.2, (kind === "lanky" ? w * 0.34 : w * 0.26) * 1);
  if (look.mood === "out") {
    for (const sx of [-1, 1]) {
      line(ctx, sx * ex - er * 0.7, ey - er * 0.7, sx * ex + er * 0.7, ey + er * 0.7, seed + 10 + sx, { ...o, passes: 1 });
      line(ctx, sx * ex + er * 0.7, ey - er * 0.7, sx * ex - er * 0.7, ey + er * 0.7, seed + 12 + sx, { ...o, passes: 1 });
    }
    ellipse(ctx, 0, ey + er * 1.9, er * 0.55, er * 0.45, seed + 14, { ...o, passes: 1 });
  } else {
    const open = 1 - look.blink;
    for (const sx of [-1, 1]) {
      ctx.fillStyle = "#FFFFFF";
      ctx.beginPath();
      ctx.ellipse(sx * ex, ey, er, er * Math.max(0.12, open), 0, 0, Math.PI * 2);
      ctx.fill();
      ellipse(ctx, sx * ex, ey, er, er * Math.max(0.12, open), seed + 20 + sx, { ...o, passes: 1, width: lw * 0.8, jitter: 0.3 * s });
      if (open > 0.3) {
        ctx.fillStyle = PAL.inkDeep;
        ctx.beginPath();
        ctx.arc(sx * ex + look.lx * er * 0.45, ey + look.ly * er * 0.45 * open, er * 0.48, 0, Math.PI * 2);
        ctx.fill();
      }
      if (look.mood === "worried") line(ctx, sx * ex - er * 0.9, ey - er * (sx > 0 ? 1.7 : 1.3), sx * ex + er * 0.9, ey - er * (sx > 0 ? 1.3 : 1.7), seed + 24 + sx, { ...o, passes: 1, width: lw * 0.8 });
    }
    // Mouth: a grin, or a wobbly worried line.
    const my = ey + er * (kind === "lanky" ? 2.2 : 1.9);
    begin();
    for (let i = 0; i <= 4; i++) {
      const t = i / 4 - 0.5;
      pt(t * er * 2.2, my + (look.mood === "worried" ? Math.sin(i * 2.4) * er * 0.25 : -t * t * er * 1.6 + er * 0.4));
    }
    ink(ctx, seed + 30, { ...o, passes: 1, width: lw * 0.85 });
    if (kind === "stub" && look.mood !== "worried") {
      line(ctx, -er * 0.3, my + er * 0.35, -er * 0.3, my + er * 0.7, seed + 31, { ...o, passes: 1, width: lw * 0.7 });
      line(ctx, er * 0.3, my + er * 0.35, er * 0.3, my + er * 0.7, seed + 32, { ...o, passes: 1, width: lw * 0.7 });
    }
  }
  // The red pen scribbling it out.
  if (look.scribble > 0) {
    const n = Math.max(2, Math.round(9 * look.scribble));
    begin();
    for (let i = 0; i <= n; i++) {
      const t = i / 9;
      pt(-w * 1.1 + (i % 2 ? w * 2.2 : 0) + shash(seed, i) * w * 0.2, -h * 1.05 + t * h * 2.1);
    }
    ink(ctx, seed + 40, { ...o, color: PAL.red, width: lw * 1.4, passes: 1 });
  }
  ctx.restore();
}

/** One textbook lying flat, in screen px (x0..x1, top..bottom). */
export function drawBook(ctx: CanvasRenderingContext2D, b: Book, x0: number, y0: number, x1: number, y1: number, seed: number): void {
  const step = 0;
  const h = y1 - y0;
  const fill = BOOK_TONES[b.tone % BOOK_TONES.length]!;
  // Cover, then the cream page block on the right, then the spine on the left.
  ctx.fillStyle = fill;
  ctx.fillRect(x0, y0, x1 - x0, h);
  const pageW = Math.min(16, (x1 - x0) * 0.1);
  ctx.fillStyle = "#FFF8E6";
  ctx.fillRect(x1 - pageW, y0 + h * 0.14, pageW - 1, h * 0.72);
  for (let i = 1; i < 4; i++) line(ctx, x1 - pageW, y0 + h * (0.14 + (0.72 * i) / 4), x1 - 1, y0 + h * (0.14 + (0.72 * i) / 4), seed + 40 + i, { step, width: 0.6, passes: 1, jitter: 0.2, color: "rgba(98,102,110,0.6)" });
  hatch(ctx, () => ctx.rect(x0, y0 + h * 0.62, x1 - x0 - pageW, h * 0.38), x0, y0 + h * 0.62, x1 - x0 - pageW, h * 0.38, -0.6, 4.5, seed + 3, { color: "rgba(36,65,154,0.22)", step });
  box(ctx, x0, y0, x1 - x0, h, seed, { step, width: 1.7, jitter: 0.6 });
  line(ctx, x0 + 10, y0, x0 + 10, y1, seed + 1, { step, width: 1, passes: 1 });
  line(ctx, x1 - pageW, y0 + h * 0.12, x1 - pageW, y1 - h * 0.12, seed + 2, { step, width: 1, passes: 1 });
  const fs = Math.min(15, h * 0.62);
  if (fs >= 8) write(ctx, b.title, (x0 + 10 + x1 - pageW) / 2, y0 + h * 0.5 + fs * 0.35, hand(fs), PAL.inkDeep, seed + 5, { align: "center", step });
  // Now and then a bookmark ribbon hangs out.
  if (hash(seed, 9) < 0.35) {
    const rx = x0 + 18 + hash(seed, 10) * (x1 - x0 - 40);
    ctx.fillStyle = PAL.red;
    ctx.beginPath();
    ctx.moveTo(rx, y1 - 1);
    ctx.lineTo(rx + 5, y1 - 1);
    ctx.lineTo(rx + 5, y1 + 9);
    ctx.lineTo(rx + 2.5, y1 + 6);
    ctx.lineTo(rx, y1 + 9);
    ctx.closePath();
    ctx.fill();
  }
}

/** My pencil case: a zipped pouch with a star sticker, x0..x1 from the desk line up to `top` (screen px). */
export function drawCase(ctx: CanvasRenderingContext2D, x0: number, top: number, x1: number, desk: number, step: number): void {
  const r = (desk - top) * 0.3;
  roundRect(ctx, x0, top, x1 - x0, desk - top, r);
  ctx.fillStyle = COL.caseFill;
  ctx.fill();
  hatch(ctx, () => roundRect(ctx, x0, top + (desk - top) * 0.55, x1 - x0, (desk - top) * 0.45, r), x0, top, x1 - x0, desk - top, 0.7, 5, 140, { color: "rgba(120,90,200,0.35)", step });
  roundPts(x0, top, x1 - x0, desk - top, r);
  ink(ctx, 141, { step, width: 1.8, closed: true });
  // The zip: a line with teeth and a pull tab.
  const zy = top + (desk - top) * 0.22;
  line(ctx, x0 + r * 0.6, zy, x1 - r * 0.6, zy, 142, { step, width: 1.3, passes: 1 });
  for (let x = x0 + r * 0.7, i = 0; x < x1 - r * 0.7; x += 4.5, i++) line(ctx, x, zy - 2, x + 1, zy + 2, 150 + i, { step, width: 0.8, passes: 1, jitter: 0.2 });
  const tx = x1 - r * 1.4;
  ellipse(ctx, tx, zy + 8, 3.5, 6, 143, { step, width: 1.3, passes: 1 });
  // A star sticker.
  const sx = x0 + (x1 - x0) * 0.32;
  const sy = top + (desk - top) * 0.6;
  starPts(sx, sy, 9, 4);
  fillBuf(ctx, "#FFD23F");
  ink(ctx, 144, { step, width: 1.3, closed: true, passes: 1 });
}

/** A five-pointed star outline into the point buffer. */
export function starPts(x: number, y: number, r: number, ri: number, rot = 0): void {
  begin();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + rot + (i / 10) * Math.PI * 2;
    const rr = i % 2 ? ri : r;
    pt(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
}

/** One of the launcher's pencils, standing from (x, yBase) up to its point at (tx, ty), screen px. */
export function drawPost(ctx: CanvasRenderingContext2D, x: number, yBase: number, tx: number, ty: number, h: number, step: number, seed: number): void {
  const a = Math.atan2(ty - yBase, tx - x);
  const len = Math.hypot(tx - x, ty - yBase);
  ctx.save();
  ctx.translate(x, yBase);
  ctx.rotate(a);
  pencil(ctx, 0, len, h, false, true, step + seed);
  ctx.restore();
}
