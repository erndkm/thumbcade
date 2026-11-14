/**
 * The notebook page behind everything: paper, grain, printed rules, the red margin, punched holes, a coffee ring,
 * a dog-ear, faint pencil homework and the desk line at the bottom (ballpoint with pencil hatching). Rendered once
 * per size into one opaque canvas and blitted 1:1 every frame.
 */
import { bold, hand, hash, ink, line, PAL, begin, pt, shash, write } from "./ink.ts";

export interface PageGeom {
  W: number;
  H: number;
  /** Screen y of the desk line (world y = 0). */
  deskY: number;
  marginX: number;
  rule0: number;
  ruleGap: number;
}

export function renderPaper(g: PageGeom, dpr: number, homework: number): HTMLCanvasElement {
  const { W, H } = g;
  const c = document.createElement("canvas");
  c.width = Math.round(W * dpr);
  c.height = Math.round(H * dpr);
  const ctx = c.getContext("2d", { alpha: false })!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = PAL.paper;
  ctx.fillRect(0, 0, W, H);
  // Grain: specks and fibres.
  const specks = Math.round((W * H) / 700);
  for (let i = 0; i < specks; i++) {
    const a = 0.03 + hash(i, 13) * 0.06;
    ctx.fillStyle = hash(i, 14) < 0.5 ? `rgba(120,100,70,${a})` : `rgba(90,90,100,${a})`;
    const s = 0.6 + hash(i, 15) * 1.1;
    ctx.fillRect(hash(i, 11) * W, hash(i, 12) * H, s, s);
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
  // Printed rules and the margin (straight: only the hand-drawn things wobble).
  ctx.fillStyle = PAL.rule;
  for (let y = g.rule0; y < g.deskY - 2; y += g.ruleGap) ctx.fillRect(0, Math.round(y) - 0.5, W, 1);
  ctx.fillStyle = PAL.margin;
  ctx.fillRect(Math.round(g.marginX) - 0.75, 0, 1.5, g.deskY);
  // Punched holes.
  const hx = Math.round(g.marginX * 0.42);
  for (const k of [0.14, 0.42]) {
    const hy = Math.round(H * k);
    ctx.fillStyle = PAL.paperBack;
    ctx.beginPath();
    ctx.arc(hx, hy, 8.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(80,70,50,0.25)";
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(hx, hy, 7.8, Math.PI * 0.95, Math.PI * 1.9);
    ctx.stroke();
  }
  coffeeRing(ctx, W * 0.2, g.rule0 + g.ruleGap * 6.4, 40);
  // Faint pencil homework, different on every page.
  const gr = "rgba(98,102,110,0.4)";
  const notes = HOMEWORK[homework % HOMEWORK.length]!;
  write(ctx, notes[0]!, g.marginX + 12, g.rule0 + g.ruleGap * 2 - 6, hand(15), gr, 4 + homework, { step: 0, rot: -0.02 });
  write(ctx, notes[1]!, g.marginX + 12, g.rule0 + g.ruleGap * 3 - 6, hand(15), gr, 5 + homework, { step: 0, rot: -0.01 });
  if (notes[2]) write(ctx, notes[2], W - 18, g.rule0 + g.ruleGap * 2 - 6, hand(14), "rgba(210,51,47,0.3)", 6 + homework, { step: 0, rot: 0.04, align: "right" });
  // The desk: the page ends on a ballpoint line with hatching under it.
  ctx.save();
  ctx.beginPath();
  ctx.rect(-2, g.deskY + 1, W + 4, H - g.deskY);
  ctx.clip();
  ctx.fillStyle = "#F1ECDF";
  ctx.fillRect(0, g.deskY, W, H - g.deskY);
  for (let x = -10, i = 0; x < W + 10; x += 6.5, i++) {
    const l = 9 + hash(i, 61) * 14;
    const y0 = g.deskY + 3 + hash(i, 62) * 2;
    line(ctx, x, y0, x - l * 0.45, y0 + l, 600 + i, { color: PAL.graphite, width: 0.9, passes: 1, jitter: 0.5, step: 0, alpha: 0.5 });
  }
  ctx.restore();
  begin();
  for (let x = -6, i = 0; x <= W + 6; x += 26, i++) pt(x, g.deskY + Math.sin(x * 0.021 + 1.3) * 0.8 + shash(i, 71) * 0.7);
  ink(ctx, 700, { width: 2.2, jitter: 0.6, step: 0 });
  write(ctx, "do NOT doodle in class", W - 16, H - 6, hand(13), "rgba(98,102,110,0.45)", 9, { step: 0, align: "right", rot: -0.01 });
  void bold;
  return c;
}

const HOMEWORK: Array<[string, string, string?]> = [
  ["hw: p.112, #4-18 (evens)", "F = m·a   (a = ouch)", "due fri!!"],
  ["ch. 7: forces + motion", "for every action there's a", "quiz tues"],
  ["notes: projectile motion", "45° goes farthest (in a vacuum)", "ask Ms. K"],
  ["vocab: momentum, impulse", "p = m·v   (my wad: big p)", ""],
  ["hw: read pp. 40-52", "Newton's 1st: stuff stays put", "!!"],
  ["lab: rubber bands + energy", "stretch it 2× = 4× the energy?", "check"],
];

function coffeeRing(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  ctx.fillStyle = "rgba(140,92,45,0.035)";
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  for (let i = 0; i < 48; i++) {
    const a0 = (i / 48) * Math.PI * 2;
    const a1 = ((i + 1.15) / 48) * Math.PI * 2;
    if (Math.abs(Math.sin((a0 - 2.4) / 2)) < 0.22) continue;
    const w = 1 + 2.2 * (0.5 + 0.5 * Math.sin(a0 * 3 + 1)) * (0.6 + hash(i, 41) * 0.4);
    ctx.strokeStyle = `rgba(140,92,45,${0.09 + hash(i, 42) * 0.07})`;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.arc(cx, cy, r - w / 2 + shash(i, 43) * 0.6, a0, a1);
    ctx.stroke();
  }
}
