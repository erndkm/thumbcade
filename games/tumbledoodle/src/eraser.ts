/**
 * The erasers, drawn live because they emote: a pencil-cap eraser, a block eraser in its paper sleeve and a chalk
 * duster, each with a face that glares while it chases, sees stars after a scrub, smirks as it backs off and sweats
 * once you're big enough to eat it. Page units, facing +x (rotated to its heading by the caller).
 */
import { begin, ellipsePts, fillBuf, ink, PAL, pt } from "./ink.ts";
import type { EraserState } from "./sim.ts";

const PINK = "#F2A7A0";
const PINK_DEEP = "#D98078";
const SLEEVE = "#8FB8E8";
const WOODEN = "#C99A62";
const FELT = "#8D8A86";

function shape(ctx: CanvasRenderingContext2D, pts: number[], fill: string, pen: number, step: number, seed: number): void {
  begin();
  for (let i = 0; i < pts.length; i += 2) pt(pts[i]!, pts[i + 1]!);
  fillBuf(ctx, fill, 1);
  ink(ctx, seed, { width: pen, jitter: pen * 0.45, step, color: PAL.ink, closed: true });
}

function box(x0: number, y0: number, x1: number, y1: number): number[] {
  const mx = (x0 + x1) / 2;
  const my = (y0 + y1) / 2;
  return [x0, y0, mx, y0, x1, y0, x1, my, x1, y1, mx, y1, x0, y1, x0, my];
}

export function drawEraser(ctx: CanvasRenderingContext2D, level: number, s: number, state: EraserState, t: number, pen: number, step: number): void {
  const L = s * 0.95;
  const Wd = s * 0.62;
  if (level === 0) {
    shape(ctx, [-L * 0.9, -Wd * 0.85, L * 0.55, -Wd * 0.7, L * 0.95, -Wd * 0.3, L * 0.95, Wd * 0.3, L * 0.55, Wd * 0.7, -L * 0.9, Wd * 0.85], PINK, pen, step, 811);
    shape(ctx, box(-L * 0.95, -Wd * 0.9, -L * 0.6, Wd * 0.9), "#C8CBD2", pen, step, 812);
    begin();
    pt(L * 0.8, -Wd * 0.42);
    pt(L * 0.86, 0);
    pt(L * 0.8, Wd * 0.42);
    ink(ctx, 813, { width: pen * 1.6, jitter: pen * 0.3, step, color: PINK_DEEP, passes: 1 });
  } else if (level === 1) {
    shape(ctx, box(-L, -Wd, L, Wd), PINK, pen, step, 821);
    shape(ctx, box(-L * 1.0, -Wd * 1.04, L * 0.1, Wd * 1.04), SLEEVE, pen, step, 822);
    // A star doodled on the sleeve.
    begin();
    for (let i = 0; i <= 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const r = i % 2 ? s * 0.09 : s * 0.22;
      pt(-L * 0.45 + Math.cos(a) * r, Math.sin(a) * r);
    }
    ink(ctx, 823, { width: pen * 0.8, jitter: pen * 0.3, step, color: "#FFFDF6", passes: 1, closed: true });
  } else {
    shape(ctx, box(-L, -Wd * 1.05, L, Wd * 1.05), FELT, pen, step, 831);
    shape(ctx, box(-L * 0.9, -Wd * 0.78, L * 0.9, Wd * 0.78), WOODEN, pen, step, 832);
    begin();
    pt(-L * 0.6, 0);
    pt(L * 0.6, 0);
    ink(ctx, 833, { width: pen * 3, jitter: pen * 0.5, step, color: "#A47844", passes: 1 });
  }
  // The face, toward the front.
  const fx = level === 0 ? L * 0.35 : level === 1 ? L * 0.55 : L * 0.35;
  const ey = s * 0.17;
  const er = s * 0.12;
  const flee = state === "flee" || state === "fall";
  for (const side of [-1, 1]) {
    const cx = fx;
    const cy = side * ey;
    if (state === "stun") {
      ctx.strokeStyle = PAL.ink;
      ctx.lineWidth = pen * 0.9;
      ctx.beginPath();
      for (let i = 0; i <= 12; i++) {
        const a = (i / 12) * Math.PI * 3 + t * 9 * side;
        const r = er * (i / 12);
        if (i === 0) ctx.moveTo(cx, cy);
        else ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      }
      ctx.stroke();
      continue;
    }
    const big = flee ? 1.3 : 1;
    ellipsePts(cx, cy, er * big, er * 0.85 * big, 840 + side, 0.08, 10);
    fillBuf(ctx, "#FFFDF6");
    ink(ctx, 840 + side, { width: pen * 0.8, jitter: pen * 0.3, step, color: PAL.ink, passes: 1 });
    ctx.fillStyle = PAL.ink;
    ctx.beginPath();
    ctx.arc(cx + er * 0.35, cy - side * er * 0.1, er * (flee ? 0.3 : 0.45), 0, Math.PI * 2);
    ctx.fill();
    if (state === "chase") {
      // Cross brows, angled down toward the middle.
      begin();
      pt(cx - er * 1.1, cy + side * er * 1.6);
      pt(cx + er * 0.9, cy + side * er * 0.95);
      ink(ctx, 850 + side, { width: pen * 1.3, jitter: pen * 0.3, step, color: PAL.ink, passes: 1 });
    }
  }
  if (flee) {
    // A sweat drop.
    ctx.fillStyle = "#9CC8F2";
    ctx.beginPath();
    ctx.ellipse(fx - er * 2.2, -ey * 2.4, er * 0.45, er * 0.65, 0.4, 0, Math.PI * 2);
    ctx.fill();
  }
  // Mouth: a scowl, a smirk, or an "o".
  begin();
  const mx = fx + s * 0.32;
  if (state === "chase") {
    pt(mx, -s * 0.13);
    pt(mx - s * 0.05, 0);
    pt(mx, s * 0.13);
  } else if (state === "retreat") {
    pt(mx - s * 0.03, -s * 0.12);
    pt(mx + s * 0.04, 0);
    pt(mx + s * 0.02, s * 0.1);
  } else {
    ellipsePts(mx, 0, s * 0.06, s * 0.08, 860, 0.1, 8);
  }
  ink(ctx, 861, { width: pen, jitter: pen * 0.3, step, color: level === 2 ? "#3A2A1A" : PAL.ink, passes: 1 });
}
