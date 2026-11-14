/**
 * Galebell's look, in the house style (midnight arcade): ink-filled shapes with a bright rim, an inner line and a
 * paper glint, one warm lamp colour for what's lit, the sea for the cabinet's cool light. Everything here is drawn
 * once into canvases (the static table, and each sprite's texture); the renderer only moves, turns and tints quads.
 * Drawing is in table units on a context scaled by `S` pixels per unit.
 */
import { mix, rgba } from "@thumbcade-games/kit/color";
import { mono } from "@thumbcade-games/kit/fonts";
import { BALL_R, GATE_TOP, LANE_GUIDES, LANE_TOP, MID_X, TABLE_W, type FlipperDef, type TableDef } from "./table.ts";

export const PAL = {
  ink: "#06080D",
  ink1: "#0C1019",
  ink2: "#141B28",
  ink3: "#1F2838",
  field: "#0A1220",
  fieldLo: "#070B14",
  paper: "#F3F0E8",
  paperDim: "#A7A3AE",
  paperMute: "#6E6A78",
  /** The manifest accent: a storm-lantern amber. */
  accent: "#C48600",
  lamp: "#FFB531",
  lampHi: "#FFE3A0",
  sea: "#2C8BA8",
  seaHi: "#7FD8EC",
  seaLo: "#123445",
  coral: "#FF6E55",
  kelp: "#4FD08E",
  gold: "#FFD24A",
  flagRed: "#E5533D",
  flagBlue: "#4C86E8",
  flagYellow: "#F2C230",
} as const;

/** Each buoy's colour and mark (a number drawn on the cap, so colour is never the only cue). */
export const BUOYS = [
  { color: PAL.coral, mark: "1" },
  { color: PAL.kelp, mark: "2" },
  { color: PAL.lamp, mark: "3" },
] as const;

/** Signal flags: a pattern each (cross, diagonal, square in square, stripes). */
export const FLAGS = [
  { bg: PAL.paper, fg: PAL.flagRed, pattern: "cross" },
  { bg: PAL.flagBlue, fg: PAL.paper, pattern: "square" },
  { bg: PAL.flagYellow, fg: PAL.ink2, pattern: "diagonal" },
  { bg: PAL.flagRed, fg: PAL.paper, pattern: "stripes" },
] as const;

/** Playfield inserts (lamps), in table units. */
export const INSERTS = {
  orbitL: { x: 31, y: 352, r: 9 },
  orbitR: { x: 307, y: 352, r: 9 },
  harbour: { x: MID_X, y: 340, r: 9 },
  berths: [
    { x: MID_X - 25, y: 266, r: 5 },
    { x: MID_X + 25, y: 266, r: 5 },
  ],
  lanes: [
    { x: 135, y: 108, r: 5 },
    { x: 169, y: 108, r: 5 },
    { x: 203, y: 108, r: 5 },
  ],
  /** The lighthouse: its tower windows show the storm tier, bottom to top. */
  tower: { x: MID_X, top: 352, bottom: 428 },
  windows: [0, 1, 2, 3, 4].map((i) => ({ x: MID_X, y: 418 - i * 15, r: 4 })),
  lamp: { x: MID_X, y: 350 },
  lifeboat: { x: MID_X, y: 616 },
} as const;

type G = CanvasRenderingContext2D;

export function canvas(w: number, h: number): { c: HTMLCanvasElement; g: G } {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return { c, g: c.getContext("2d")! };
}

function circle(g: G, x: number, y: number, r: number): void {
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
}

function poly(g: G, pts: readonly number[]): void {
  g.beginPath();
  g.moveTo(pts[0]!, pts[1]!);
  for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i]!, pts[i + 1]!);
  g.closePath();
}

/** A rail: a stroke with an ink core, a bright rim and an inner line. */
function rail(g: G, path: () => void, width: number, rim: string, core: string = PAL.ink2): void {
  g.lineCap = "round";
  g.lineJoin = "round";
  path();
  g.strokeStyle = PAL.ink;
  g.lineWidth = width + 2.2;
  g.stroke();
  path();
  g.strokeStyle = rim;
  g.lineWidth = width;
  g.stroke();
  path();
  g.strokeStyle = core;
  g.lineWidth = Math.max(0.6, width - 2.2);
  g.stroke();
  path();
  g.strokeStyle = rgba(PAL.paper, 0.18);
  g.lineWidth = 0.5;
  g.stroke();
}

/** Arrow insert pointing up (unlit outline, or a lit fill when `fill` is set). */
export function arrowPath(g: G, x: number, y: number, r: number): void {
  g.beginPath();
  g.moveTo(x, y - r);
  g.lineTo(x + r * 0.9, y + r * 0.55);
  g.lineTo(x + r * 0.32, y + r * 0.3);
  g.lineTo(x, y + r);
  g.lineTo(x - r * 0.32, y + r * 0.3);
  g.lineTo(x - r * 0.9, y + r * 0.55);
  g.closePath();
}

function boatPath(g: G, x: number, y: number, s: number): void {
  g.beginPath();
  g.moveTo(x - 12 * s, y - 2 * s);
  g.lineTo(x + 12 * s, y - 2 * s);
  g.lineTo(x + 8 * s, y + 4 * s);
  g.lineTo(x - 8 * s, y + 4 * s);
  g.closePath();
  g.moveTo(x - 1 * s, y - 3 * s);
  g.lineTo(x - 1 * s, y - 12 * s);
  g.lineTo(x + 6 * s, y - 4 * s);
  g.closePath();
}

/** The lighthouse drawn on the playfield (side view, faint): the tier windows are inserts on its tower. */
function lighthouse(g: G): void {
  const t = INSERTS.tower;
  const x = t.x;
  g.save();
  // Rock at its foot.
  g.fillStyle = rgba(PAL.seaLo, 0.9);
  g.beginPath();
  g.ellipse(x, t.bottom + 2, 34, 6, 0, 0, Math.PI * 2);
  g.fill();
  // Beam rays (static, faint).
  for (const side of [-1, 1]) {
    const gr = g.createLinearGradient(x, t.top, x + side * 120, t.top);
    gr.addColorStop(0, rgba(PAL.lamp, 0.16));
    gr.addColorStop(1, rgba(PAL.lamp, 0));
    g.fillStyle = gr;
    g.beginPath();
    g.moveTo(x + side * 6, t.top - 2);
    g.lineTo(x + side * 120, t.top - 22);
    g.lineTo(x + side * 120, t.top + 14);
    g.closePath();
    g.fill();
  }
  // Tower: tapered, banded.
  const w0 = 9;
  const w1 = 15;
  poly(g, [x - w0, t.top + 6, x + w0, t.top + 6, x + w1, t.bottom, x - w1, t.bottom]);
  g.fillStyle = PAL.ink3;
  g.fill();
  g.strokeStyle = rgba(PAL.paperDim, 0.55);
  g.lineWidth = 1;
  g.stroke();
  g.save();
  poly(g, [x - w0, t.top + 6, x + w0, t.top + 6, x + w1, t.bottom, x - w1, t.bottom]);
  g.clip();
  g.fillStyle = rgba(PAL.paper, 0.07);
  for (let i = 0; i < 3; i++) g.fillRect(x - 20, t.top + 18 + i * 22, 40, 10);
  g.restore();
  // Gallery and lamp room.
  g.fillStyle = PAL.ink2;
  g.fillRect(x - 13, t.top + 2, 26, 4);
  g.strokeStyle = rgba(PAL.paperDim, 0.6);
  g.lineWidth = 0.8;
  g.strokeRect(x - 13, t.top + 2, 26, 4);
  g.fillStyle = PAL.ink1;
  g.fillRect(x - 7, t.top - 8, 14, 10);
  g.strokeRect(x - 7, t.top - 8, 14, 10);
  g.beginPath();
  g.moveTo(x - 9, t.top - 8);
  g.lineTo(x, t.top - 16);
  g.lineTo(x + 9, t.top - 8);
  g.closePath();
  g.fillStyle = PAL.ink2;
  g.fill();
  g.stroke();
  // Unlit windows (tier lamps).
  for (const wd of INSERTS.windows) {
    g.fillStyle = PAL.ink;
    g.fillRect(wd.x - wd.r, wd.y - wd.r, wd.r * 2, wd.r * 2);
    g.strokeStyle = rgba(PAL.paperDim, 0.5);
    g.lineWidth = 0.7;
    g.strokeRect(wd.x - wd.r, wd.y - wd.r, wd.r * 2, wd.r * 2);
  }
  g.restore();
}

/** The whole static table (walls, art, unlit inserts) in table units. */
export function drawTable(g: G, def: TableDef): void {
  const W = TABLE_W;
  // Cabinet.
  g.fillStyle = PAL.ink;
  g.fillRect(-20, -20, W + 40, 720);
  // The playfield: left wall, arch, the right orbit's outer wall, the guides, and the drain between the flippers.
  const fl = def.flippers;
  const field = () => {
    g.beginPath();
    g.moveTo(12, 410);
    g.lineTo(12, 180);
    g.arc(180, 180, 168, Math.PI, 0);
    g.lineTo(348, 640);
    g.lineTo(326, 640);
    g.lineTo(326, 410);
    g.lineTo(fl[1].x - 4, 552);
    g.lineTo(fl[1].x + 4, 700);
    g.lineTo(fl[0].x - 4, 700);
    g.lineTo(fl[0].x + 4, 552);
    g.closePath();
  };
  field();
  const gr = g.createLinearGradient(0, 0, 0, 640);
  gr.addColorStop(0, "#0D1628");
  gr.addColorStop(0.55, PAL.field);
  gr.addColorStop(1, PAL.fieldLo);
  g.fillStyle = gr;
  g.fill();
  // The sea: wave crests across the lower field and in the drain.
  g.save();
  field();
  g.clip();
  g.strokeStyle = rgba(PAL.sea, 0.13);
  g.lineWidth = 0.8;
  for (let row = 0; row < 14; row++) {
    const y = 440 + row * 16;
    g.beginPath();
    for (let x = -10; x <= W + 10; x += 4) {
      const yy = y + Math.sin(x * 0.07 + row * 1.7) * 2.2;
      if (x === -10) g.moveTo(x, yy);
      else g.lineTo(x, yy);
    }
    g.stroke();
  }
  // A compass rose behind the buoys.
  g.strokeStyle = rgba(PAL.paper, 0.05);
  g.lineWidth = 0.8;
  circle(g, MID_X, 188, 64);
  g.stroke();
  circle(g, MID_X, 188, 44);
  g.stroke();
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const r0 = i % 4 === 0 ? 30 : 50;
    g.beginPath();
    g.moveTo(MID_X + Math.cos(a) * r0, 188 + Math.sin(a) * r0);
    g.lineTo(MID_X + Math.cos(a) * 70, 188 + Math.sin(a) * 70);
    g.stroke();
  }
  // Drain: deeper water under the flippers.
  g.save();
  g.translate(MID_X, 660);
  g.scale(1.4, 1);
  const dg = g.createRadialGradient(0, 0, 4, 0, 0, 90);
  dg.addColorStop(0, rgba(PAL.seaLo, 0.95));
  dg.addColorStop(1, rgba(PAL.seaLo, 0));
  g.fillStyle = dg;
  g.fillRect(-100, -100, 200, 120);
  g.restore();
  g.restore();

  // The drain channel under the flippers fades into the cabinet's dark.
  g.save();
  field();
  g.clip();
  const dk = g.createLinearGradient(0, 572, 0, 650);
  dk.addColorStop(0, rgba(PAL.ink, 0));
  dk.addColorStop(1, rgba(PAL.ink, 0.92));
  g.fillStyle = dk;
  g.fillRect(70, 560, 200, 140);
  g.restore();

  lighthouse(g);

  // The shooter lane.
  g.fillStyle = PAL.ink1;
  g.fillRect(326, LANE_TOP, 22, 640 - LANE_TOP);
  g.strokeStyle = rgba(PAL.sea, 0.25);
  g.lineWidth = 0.6;
  for (let y = LANE_TOP + 20; y < 600; y += 24) {
    g.beginPath();
    g.moveTo(331, y);
    g.lineTo(343, y);
    g.stroke();
  }
  // Plunger: spring and knob.
  g.strokeStyle = PAL.paperDim;
  g.lineWidth = 1;
  g.beginPath();
  for (let i = 0; i <= 8; i++) {
    const y = 630 + i * 1.6;
    g.lineTo(i % 2 ? 343 : 331, y);
  }
  g.stroke();
  g.fillStyle = PAL.paperDim;
  g.fillRect(329, def.plunger.floorY - 1, 16, 3);

  // Inserts (unlit).
  const insert = (draw: () => void) => {
    draw();
    g.fillStyle = PAL.ink1;
    g.fill();
    draw();
    g.strokeStyle = rgba(PAL.lamp, 0.35);
    g.lineWidth = 0.9;
    g.stroke();
  };
  for (const ins of [INSERTS.orbitL, INSERTS.orbitR, INSERTS.harbour]) insert(() => arrowPath(g, ins.x, ins.y, ins.r));
  for (const l of INSERTS.lanes) insert(() => circle(g, l.x, l.y, l.r));
  for (const b of INSERTS.berths) {
    circle(g, b.x, b.y, b.r + 2);
    g.fillStyle = PAL.ink;
    g.fill();
    g.strokeStyle = rgba(PAL.paperDim, 0.45);
    g.lineWidth = 0.8;
    g.stroke();
  }
  insert(() => boatPath(g, INSERTS.lifeboat.x, INSERTS.lifeboat.y, 0.7));

  // Small labels.
  g.fillStyle = rgba(PAL.paperDim, 0.55);
  g.font = mono(5.5);
  g.textAlign = "center";
  g.textBaseline = "middle";
  (g as unknown as { letterSpacing: string }).letterSpacing = "0.5px";
  g.fillText("ORBIT", INSERTS.orbitL.x, INSERTS.orbitL.y + 15);
  g.fillText("ORBIT", INSERTS.orbitR.x, INSERTS.orbitR.y + 15);
  g.fillText("LIFEBOAT", INSERTS.lifeboat.x, INSERTS.lifeboat.y + 9);
  g.fillText("VANE", 31, 306);

  // Harbour saucer.
  const hb = def.harbour;
  circle(g, hb.x, hb.y, hb.r + 3);
  g.fillStyle = PAL.ink3;
  g.fill();
  circle(g, hb.x, hb.y, hb.r);
  const hg = g.createRadialGradient(hb.x, hb.y - 2, 1, hb.x, hb.y, hb.r);
  hg.addColorStop(0, "#000000");
  hg.addColorStop(1, PAL.ink1);
  g.fillStyle = hg;
  g.fill();
  g.strokeStyle = rgba(PAL.paper, 0.45);
  g.lineWidth = 0.8;
  circle(g, hb.x, hb.y, hb.r + 3);
  g.stroke();

  // Buoy skirts (the caps are sprites).
  for (const b of def.bumpers) {
    circle(g, b.x, b.y, b.R + 1.5);
    g.fillStyle = PAL.ink;
    g.fill();
    g.strokeStyle = rgba(PAL.paperDim, 0.4);
    g.lineWidth = 0.8;
    g.stroke();
  }

  // Breakwaters (slingshots): dark block, rubber on all sides, the kicking face in sea light.
  for (const s of def.slings) {
    poly(g, s.pts);
    const sg = g.createLinearGradient(s.pts[0]!, s.pts[1]!, s.pts[4]!, s.pts[5]!);
    sg.addColorStop(0, PAL.ink3);
    sg.addColorStop(1, PAL.seaLo);
    g.fillStyle = sg;
    g.fill();
    g.strokeStyle = PAL.ink;
    g.lineWidth = 6;
    g.lineJoin = "round";
    g.stroke();
    poly(g, s.pts);
    g.strokeStyle = PAL.paperDim;
    g.lineWidth = 3.4;
    g.stroke();
    const [ax, ay, bx, by] = s.face;
    g.beginPath();
    g.moveTo(ax, ay);
    g.lineTo(bx, by);
    g.strokeStyle = PAL.sea;
    g.lineWidth = 3.4;
    g.lineCap = "round";
    g.stroke();
    // Stones on the block.
    poly(g, s.pts);
    g.save();
    g.clip();
    g.strokeStyle = rgba(PAL.paper, 0.1);
    g.lineWidth = 0.7;
    for (let k = -60; k < 60; k += 7) {
      g.beginPath();
      g.moveTo(s.pts[0]! + k, s.pts[1]!);
      g.lineTo(s.pts[0]! + k + 60, s.pts[1]! + 100);
      g.stroke();
    }
    g.restore();
  }

  // Walls.
  const wallRim = mix(PAL.paperDim, PAL.sea, 0.25);
  for (const s of def.segs) {
    if (s.tag >= 7 && s.tag <= 10) continue; // flags are sprites
    if (s.tag === 2 || s.tag === 3) continue; // sling faces drawn above
    if (s.tag === 1 && def.slings.some((sl) => sl.pts.includes(s.ax) && sl.pts.includes(s.bx))) continue;
    if (s.tag === 11) {
      // The gate: a thin hinged flap.
      g.strokeStyle = PAL.lamp;
      g.lineWidth = 1.4;
      g.lineCap = "round";
      g.beginPath();
      g.moveTo(s.ax, s.ay);
      g.lineTo(s.bx, s.by);
      g.stroke();
      continue;
    }
    if (s.tag === 12) continue;
    const w = Math.max(2.8, s.r * 2);
    rail(g, () => {
      g.beginPath();
      g.moveTo(s.ax, s.ay);
      g.lineTo(s.bx, s.by);
    }, w, s.tag === 13 ? PAL.paperDim : wallRim);
  }
  for (const a of def.arcs) {
    rail(g, () => {
      g.beginPath();
      g.arc(a.x, a.y, a.R, a.start, a.start + a.sweep);
    }, a.r * 2 + 0.8, wallRim);
  }
  for (const c of def.circles) {
    if (c.tag >= 4 && c.tag <= 6) continue;
    circle(g, c.x, c.y, c.R);
    g.fillStyle = PAL.ink2;
    g.fill();
    g.strokeStyle = c.R > 3 ? PAL.paperDim : wallRim;
    g.lineWidth = 1.2;
    g.stroke();
  }
  // The gate's hinge post and the arch's top lamp lane marks.
  circle(g, GATE_TOP[0], GATE_TOP[1], 1.6);
  g.fillStyle = PAL.lamp;
  g.fill();
  // Lane guide caps.
  for (const x of LANE_GUIDES) {
    circle(g, x, 62, 3.4);
    g.fillStyle = PAL.ink2;
    g.fill();
    g.strokeStyle = PAL.paper;
    g.lineWidth = 0.9;
    g.stroke();
  }
  // Flipper pivots' bushings.
  for (const f of def.flippers) {
    circle(g, f.x, f.y, 3);
    g.fillStyle = PAL.ink;
    g.fill();
  }
}

// --- sprite textures (drawn in table units × S) --------------------------------------------------------------

export function drawBall(g: G, r: number): void {
  const gr = g.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.1, 0, 0, r);
  gr.addColorStop(0, "#FFFFFF");
  gr.addColorStop(0.35, "#D9DCE3");
  gr.addColorStop(0.75, "#7A8091");
  gr.addColorStop(1, "#3A3F4C");
  circle(g, 0, 0, r);
  g.fillStyle = gr;
  g.fill();
  // A warm reflection of the lamp along the bottom, and a ring.
  g.save();
  circle(g, 0, 0, r);
  g.clip();
  g.fillStyle = rgba(PAL.lamp, 0.35);
  g.beginPath();
  g.ellipse(r * 0.15, r * 0.75, r * 0.7, r * 0.3, 0, 0, Math.PI * 2);
  g.fill();
  g.restore();
  circle(g, 0, 0, r - 0.3);
  g.strokeStyle = rgba(PAL.ink, 0.8);
  g.lineWidth = 0.6;
  g.stroke();
}

export function drawGlow(g: G, r: number, color: string, core = 0.55): void {
  const gr = g.createRadialGradient(0, 0, 0, 0, 0, r);
  gr.addColorStop(0, rgba(color, core));
  gr.addColorStop(0.35, rgba(color, core * 0.45));
  gr.addColorStop(1, rgba(color, 0));
  g.fillStyle = gr;
  g.fillRect(-r, -r, r * 2, r * 2);
}

/** The tapered rubber in its own frame (pivot at the origin, tip along +x). */
export function flipperPath(g: G, d: FlipperDef, grow = 0): void {
  const r0 = d.r0 + grow;
  const r1 = d.r1 + grow;
  const bb = (d.r0 - d.r1) / d.len;
  const a = Math.acos(bb);
  g.beginPath();
  g.arc(0, 0, r0, a, Math.PI * 2 - a);
  g.arc(d.len, 0, r1, -a, a);
  g.closePath();
}

export function drawFlipper(g: G, d: FlipperDef, lit: boolean): void {
  flipperPath(g, d, 0.9);
  g.fillStyle = PAL.ink;
  g.fill();
  flipperPath(g, d);
  const gr = g.createLinearGradient(0, -d.r0, 0, d.r0);
  gr.addColorStop(0, lit ? "#3A3226" : PAL.ink3);
  gr.addColorStop(1, PAL.ink2);
  g.fillStyle = gr;
  g.fill();
  flipperPath(g, d);
  g.strokeStyle = lit ? PAL.lampHi : PAL.paper;
  g.lineWidth = 1.6;
  g.stroke();
  // Accent stripe along the rubber.
  g.beginPath();
  g.moveTo(4, 0);
  g.lineTo(d.len - 2, 0);
  g.strokeStyle = lit ? PAL.lampHi : PAL.accent;
  g.lineWidth = 1.6;
  g.lineCap = "round";
  g.stroke();
  // Pivot cap.
  circle(g, 0, 0, 3.4);
  g.fillStyle = PAL.ink;
  g.fill();
  g.strokeStyle = rgba(PAL.paper, 0.7);
  g.lineWidth = 0.8;
  g.stroke();
}

/** A buoy seen from above: coloured ring, ink cap, its number; `lit` brightens it (a hit or the gold buoy). */
export function drawBuoy(g: G, R: number, color: string, mark: string, lit: boolean, gold = false): void {
  circle(g, 0, 0, R);
  g.fillStyle = lit ? mix(color, PAL.paper, 0.35) : color;
  g.fill();
  circle(g, 0, 0, R * 0.74);
  g.fillStyle = lit ? mix(PAL.ink2, color, 0.35) : PAL.ink1;
  g.fill();
  g.strokeStyle = rgba(PAL.paper, lit ? 0.9 : 0.5);
  g.lineWidth = 0.9;
  g.stroke();
  // Radial stripes like a buoy's bands.
  g.save();
  circle(g, 0, 0, R);
  g.clip();
  g.strokeStyle = rgba(PAL.ink, 0.35);
  g.lineWidth = 2.2;
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI;
    g.beginPath();
    g.moveTo(Math.cos(a) * R * 0.76, Math.sin(a) * R * 0.76);
    g.lineTo(Math.cos(a) * R, Math.sin(a) * R);
    g.moveTo(-Math.cos(a) * R * 0.76, -Math.sin(a) * R * 0.76);
    g.lineTo(-Math.cos(a) * R, -Math.sin(a) * R);
    g.stroke();
  }
  g.restore();
  if (gold) {
    // A star for the gold buoy.
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const r = i % 2 ? R * 0.26 : R * 0.6;
      g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    g.closePath();
    g.fillStyle = PAL.gold;
    g.fill();
    g.strokeStyle = PAL.ink;
    g.lineWidth = 0.8;
    g.stroke();
  } else {
    g.fillStyle = lit ? PAL.paper : mix(color, PAL.paper, 0.4);
    g.font = mono(R * 0.85);
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(mark, 0.3, 0.8);
  }
  circle(g, 0, 0, R);
  g.strokeStyle = PAL.ink;
  g.lineWidth = 1;
  g.stroke();
}

/** A signal flag (drop target) seen edge-on-ish: a plate with its pattern, `w` long along x. */
export function drawFlag(g: G, w: number, h: number, i: number): void {
  const f = FLAGS[i]!;
  g.fillStyle = PAL.ink;
  g.fillRect(-w / 2 - 0.8, -h / 2 - 0.8, w + 1.6, h + 1.6);
  g.fillStyle = f.bg;
  g.fillRect(-w / 2, -h / 2, w, h);
  g.save();
  g.beginPath();
  g.rect(-w / 2, -h / 2, w, h);
  g.clip();
  g.fillStyle = f.fg;
  g.strokeStyle = f.fg;
  if (f.pattern === "cross") {
    g.fillRect(-w / 2, -h * 0.17, w, h * 0.34);
    g.fillRect(-w * 0.09, -h / 2, w * 0.18, h);
  } else if (f.pattern === "square") {
    g.fillRect(-w * 0.22, -h * 0.28, w * 0.44, h * 0.56);
  } else if (f.pattern === "diagonal") {
    g.lineWidth = h * 0.45;
    g.beginPath();
    g.moveTo(-w / 2, h / 2);
    g.lineTo(w / 2, -h / 2);
    g.stroke();
  } else {
    for (let k = 0; k < 3; k++) g.fillRect(-w / 2 + (k * 2 + 0.5) * (w / 6), -h / 2, w / 6, h);
  }
  g.restore();
  g.strokeStyle = rgba(PAL.paper, 0.85);
  g.lineWidth = 0.6;
  g.strokeRect(-w / 2, -h / 2, w, h);
}

export function drawArrowLit(g: G, r: number): void {
  arrowPath(g, 0, 0, r);
  g.fillStyle = PAL.lamp;
  g.fill();
  g.strokeStyle = PAL.lampHi;
  g.lineWidth = 0.9;
  g.stroke();
}

export function drawDotLit(g: G, r: number): void {
  circle(g, 0, 0, r);
  g.fillStyle = PAL.lamp;
  g.fill();
  circle(g, 0, 0, r * 0.45);
  g.fillStyle = PAL.lampHi;
  g.fill();
}

export function drawWindowLit(g: G, r: number): void {
  g.fillStyle = PAL.lamp;
  g.fillRect(-r, -r, r * 2, r * 2);
  g.fillStyle = PAL.lampHi;
  g.fillRect(-r * 0.4, -r * 0.4, r * 0.8, r * 0.8);
}

export function drawBoatLit(g: G): void {
  boatPath(g, 0, 0, 0.7);
  g.fillStyle = PAL.kelp;
  g.fill();
  g.strokeStyle = PAL.paper;
  g.lineWidth = 0.7;
  g.stroke();
}

/** The lighthouse beam: a long soft wedge from the origin along +x. */
export function drawBeam(g: G, len: number, spread: number): void {
  const gr = g.createLinearGradient(0, 0, len, 0);
  gr.addColorStop(0, rgba(PAL.lampHi, 0.5));
  gr.addColorStop(0.2, rgba(PAL.lamp, 0.22));
  gr.addColorStop(1, rgba(PAL.lamp, 0));
  g.fillStyle = gr;
  g.beginPath();
  g.moveTo(0, -1.5);
  g.lineTo(len, -spread);
  g.lineTo(len, spread);
  g.lineTo(0, 1.5);
  g.closePath();
  g.fill();
}

export function drawSpinner(g: G, w: number): void {
  g.fillStyle = PAL.paper;
  g.fillRect(-w / 2, -2.2, w, 4.4);
  g.fillStyle = PAL.accent;
  g.fillRect(-w / 2, -0.7, w, 1.4);
  g.strokeStyle = PAL.ink;
  g.lineWidth = 0.6;
  g.strokeRect(-w / 2, -2.2, w, 4.4);
}

export function drawSpark(g: G, r: number): void {
  const gr = g.createRadialGradient(0, 0, 0, 0, 0, r);
  gr.addColorStop(0, "rgba(255,255,255,1)");
  gr.addColorStop(0.4, "rgba(255,255,255,0.5)");
  gr.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = gr;
  g.fillRect(-r, -r, r * 2, r * 2);
}

export function drawRing(g: G, r: number): void {
  circle(g, 0, 0, r * 0.85);
  g.strokeStyle = "#ffffff";
  g.lineWidth = r * 0.12;
  g.stroke();
}

/** A rain streak (white, tinted at draw time). */
export function drawStreak(g: G, len: number): void {
  const gr = g.createLinearGradient(0, -len / 2, 0, len / 2);
  gr.addColorStop(0, "rgba(255,255,255,0)");
  gr.addColorStop(1, "rgba(255,255,255,0.8)");
  g.fillStyle = gr;
  g.fillRect(-0.4, -len / 2, 0.8, len);
}

export { BALL_R };
