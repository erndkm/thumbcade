/**
 * softbake's clay, drawn in Canvas 2D (helpers copied from Pinchbake): every lump, pot, tile and the hand are sculpted
 * once into sprites (lumpy outlines, a soft key light from the upper left, thumbprint dents, a warm bounce from below),
 * so the frame loop only blits them and draws faces. Lumphop's own pieces: eight kinds of clay lump, raw putty for the
 * covered ones, terracotta pots, the seal stamp and a Lisbon kitchen wall of hand-pressed azulejo tiles.
 */
import { CAP, KINDS, PUTTY, SHELL } from "./kinds.ts";

/** Every colour in the game that isn't a lump's. Warm studio, cool tiles, terracotta pots. */
export const PAL = {
  wallHi: "#F6E3CD",
  wall: "#EDCDAE",
  wallDeep: "#DDB08C",
  tile: "#6C8DC2",
  tileDeep: "#56769F",
  tileHi: "#8FAAD6",
  grout: "#E6D8C0",
  wood: "#C98F62",
  woodHi: "#E2AE80",
  woodDeep: "#9E6745",
  pot: "#C0724A",
  potDeep: "#924D2F",
  potHi: "#E29C72",
  potInside: "#5A3222",
  glaze: "#F3E4C9",
  glazeDeep: "#D9C29C",
  little: "#86B08E",
  littleDeep: "#5F8C69",
  littleHi: "#B5D4B9",
  ink: "#3B2219",
  cream: "#FBF1DE",
  creamDeep: "#E9D5B3",
  butter: "#F6D98B",
  butterDeep: "#E2B65A",
  salmon: "#F2A08A",
  salmonDeep: "#DB7D68",
  lavender: "#C8B5E8",
  lavenderDeep: "#A891D6",
  sage: "#A8C795",
  sageDeep: "#82AA74",
  powder: "#A7CBEA",
  powderDeep: "#7FAED8",
  choc: "#6E4533",
  chocDeep: "#4C2E22",
  skin: "#F1C3A3",
  skinDeep: "#D69A77",
  skinHi: "#FFE2CE",
  danger: "#F0775C",
  dangerDeep: "#C9513B",
  flour: "#FFFBF2",
  blush: "#F08C98",
} as const;

export const FONT = `"Fredoka", "Avenir Next Rounded", ui-rounded, system-ui, sans-serif`;
export const font = (size: number, weight = 700): string => `${weight} ${Math.round(size)}px ${FONT}`;

export interface Sprite {
  c: HTMLCanvasElement;
  /** Size and anchor in CSS px. */
  w: number;
  h: number;
  ox: number;
  oy: number;
}

/** A canvas at `k` pixels per CSS px, with the origin moved to the anchor. */
export function makeSprite(w: number, h: number, ox: number, oy: number, k: number, draw: (g: CanvasRenderingContext2D) => void): Sprite {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.ceil(w * k));
  c.height = Math.max(1, Math.ceil(h * k));
  const g = c.getContext("2d")!;
  g.scale(k, k);
  g.translate(ox, oy);
  g.lineCap = "round";
  g.lineJoin = "round";
  draw(g);
  return { c, w, h, ox, oy };
}

/** Deterministic [0, 1) from two integers. */
export function hash(n: number, s: number): number {
  let h = Math.imul(n | 0, 0x9e3779b1) ^ Math.imul((s | 0) + 0x7f4a7c15, 0x85ebca77);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

export function rgba(hex: string, a: number): string {
  const v = parseInt(hex.slice(1), 16);
  return `rgba(${(v >> 16) & 255},${(v >> 8) & 255},${v & 255},${a})`;
}

/** A hand-rolled outline: the radius wanders a little (low lobes), as if squished between palms. */
function wobble(t: number, seed: number, amp: number): number {
  const a = hash(seed, 1) * 6.28;
  const b = hash(seed, 2) * 6.28;
  const c = hash(seed, 3) * 6.28;
  return 1 + amp * (Math.sin(3 * t + a) * 0.55 + Math.sin(5 * t + b) * 0.3 + Math.sin(2 * t + c) * 0.35);
}

/** Traces a closed outline given as a polar function of the angle, with clay wobble. */
function polar(g: CanvasRenderingContext2D, f: (t: number) => [number, number], seed: number, amp: number, n = 72): void {
  g.beginPath();
  for (let k = 0; k <= n; k++) {
    const t = (k / n) * Math.PI * 2;
    const [x, y] = f(t);
    const w = wobble(t, seed, amp);
    if (k === 0) g.moveTo(x * w, y * w);
    else g.lineTo(x * w, y * w);
  }
  g.closePath();
}

/** Base clay: the contact shadow, then the body lit from the upper left. */
function clayBase(g: CanvasRenderingContext2D, r: number, body: string, deep: string, hi: string, path: () => void): void {
  const sh = g.createRadialGradient(r * 0.1, r * 0.2, r * 0.5, r * 0.1, r * 0.2, r * 1.1);
  sh.addColorStop(0, "rgba(30,26,40,0.3)");
  sh.addColorStop(1, "rgba(30,26,40,0)");
  g.fillStyle = sh;
  g.beginPath();
  g.ellipse(r * 0.08, r * 0.16, r * 1.08, r * 0.8, 0, 0, Math.PI * 2);
  g.fill();
  path();
  const gr = g.createRadialGradient(-r * 0.38, -r * 0.4, r * 0.04, -r * 0.1, -r * 0.1, r * 1.3);
  gr.addColorStop(0, hi);
  gr.addColorStop(0.45, body);
  gr.addColorStop(1, deep);
  g.fillStyle = gr;
  g.fill();
}

/** Clay finish over everything: a thumbprint whorl, little dents, a unifying key light, the bounce and the edge. */
function clayFinish(g: CanvasRenderingContext2D, r: number, deep: string, seed: number, path: () => void, o: { spec?: number; prints?: number } = {}): void {
  g.save();
  path();
  g.clip();
  const prints = o.prints ?? 1;
  for (let p = 0; p < prints; p++) {
    const cx = (hash(seed, 10 + p) - 0.5) * r * 1.1;
    const cy = (hash(seed, 20 + p) - 0.4) * r * 0.6;
    const rot = hash(seed, 30 + p) * Math.PI;
    for (let k = 1; k <= 6; k++) {
      const rad = k * r * 0.06;
      const a0 = hash(seed * 7 + k, p) * 6.28;
      g.lineWidth = Math.max(0.5, r * 0.018);
      g.strokeStyle = rgba(deep, 0.17 * (1 - k / 8));
      g.beginPath();
      g.ellipse(cx, cy, rad * 1.35, rad, rot, a0, a0 + 4.4);
      g.stroke();
      g.strokeStyle = `rgba(255,248,236,${0.13 * (1 - k / 8)})`;
      g.beginPath();
      g.ellipse(cx - 0.6, cy - 0.6, rad * 1.35, rad, rot, a0, a0 + 4.4);
      g.stroke();
    }
  }
  const pocks = 3 + Math.floor(hash(seed, 40) * 3);
  for (let p = 0; p < pocks; p++) {
    const a = hash(seed, 50 + p) * 6.28;
    const d = Math.sqrt(hash(seed, 60 + p)) * r * 0.75;
    const pr = r * (0.025 + hash(seed, 70 + p) * 0.03);
    const x = Math.cos(a) * d;
    const y = Math.sin(a) * d * 0.6;
    g.fillStyle = rgba(deep, 0.28);
    g.beginPath();
    g.ellipse(x, y, pr * 1.2, pr, a, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "rgba(255,250,240,0.25)";
    g.beginPath();
    g.ellipse(x + pr * 0.3, y + pr * 0.45, pr * 0.9, pr * 0.5, a, 0, Math.PI * 2);
    g.fill();
  }
  const lg = g.createRadialGradient(-r * 0.5, -r * 0.45, 0, -r * 0.2, -r * 0.15, r * 1.4);
  lg.addColorStop(0, "rgba(255,250,240,0.3)");
  lg.addColorStop(0.38, "rgba(255,250,240,0)");
  lg.addColorStop(0.66, "rgba(50,24,14,0)");
  lg.addColorStop(1, "rgba(50,24,14,0.24)");
  g.fillStyle = lg;
  g.fillRect(-r * 1.6, -r * 1.6, r * 3.2, r * 3.2);
  g.strokeStyle = "rgba(255,226,180,0.22)";
  g.lineWidth = r * 0.1;
  g.beginPath();
  g.ellipse(0, 0, r * 0.95, r * 0.62, 0, Math.PI * 0.2, Math.PI * 0.8);
  g.stroke();
  g.restore();
  path();
  g.lineWidth = Math.max(1, r * 0.045);
  g.strokeStyle = rgba(deep, 0.8);
  g.stroke();
  const spec = o.spec ?? 0.3;
  const sg = g.createRadialGradient(-r * 0.38, -r * 0.3, 0, -r * 0.38, -r * 0.3, r * 0.28);
  sg.addColorStop(0, `rgba(255,255,255,${spec})`);
  sg.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = sg;
  g.beginPath();
  g.ellipse(-r * 0.38, -r * 0.3, r * 0.28, r * 0.17, -0.5, 0, Math.PI * 2);
  g.fill();
}

function cheeks(g: CanvasRenderingContext2D, x: number, y: number, dx: number, r: number, a = 0.4): void {
  g.fillStyle = rgba(PAL.blush, a);
  for (const s of [-1, 1]) {
    g.beginPath();
    g.ellipse(x + s * dx, y, r * 0.11, r * 0.065, 0, 0, Math.PI * 2);
    g.fill();
  }
}

// ------------------------------------------------------------------------------------------------------------------
// The lumps. Local frame: centre at the origin, half width r; a lump is about 1.3 r tall.
// ------------------------------------------------------------------------------------------------------------------

const HH = 0.64;

function shapeOf(kind: number, r: number): (t: number) => [number, number] {
  const h = r * HH;
  switch (kind) {
    case 0: // bun: a dome on a flat bottom
      return (t) => {
        const s = Math.sin(t);
        const c = Math.cos(t);
        const x = Math.sign(c) * Math.abs(c) ** 0.8 * r * 0.98;
        const y = s < 0 ? s * h * 1.12 : Math.sign(s) * Math.abs(s) ** 0.45 * h * 0.62;
        return [x, y + h * 0.08];
      };
    case 1: // heart
      return (t) => {
        const x = 16 * Math.sin(t) ** 3;
        const y = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
        return [(x / 16) * r * 0.98, (y / 15) * h * 1.12 + h * 0.06];
      };
    case 2: // leaf: a lens, the tip turned up a little at the right
      return (t) => {
        const c = Math.cos(t);
        const s = Math.sin(t);
        const x = c * r * 0.98;
        const y = s * h * 0.95 * (1 - 0.15 * c) * Math.abs(s) ** 0.15 - c * c * c * h * 0.12;
        return [x, y];
      };
    case 3: // sardine: body tapering to the tail
      return (t) => {
        const c = Math.cos(t);
        const s = Math.sin(t);
        const x = c * r * 0.72 - r * 0.2;
        const taper = c > 0 ? 1 - c * 0.45 : 1 - c * c * 0.15;
        return [x, s * h * 0.78 * taper];
      };
    case 4: // star: five chubby points
      return (t) => {
        const k = 0.7 + 0.3 * Math.cos(5 * (t + Math.PI / 2));
        const R = h * 1.12 * (0.78 + 0.22 * k * k) * k;
        return [Math.cos(t) * R * 1.22, Math.sin(t) * R + h * 0.05];
      };
    case 6: // flower: six round petals
      return (t) => {
        const k = 0.82 + 0.18 * Math.abs(Math.cos(3 * t)) ** 0.7;
        return [Math.cos(t) * r * 0.86 * k, Math.sin(t) * h * 1.08 * k];
      };
    default:
      return (t) => [Math.cos(t) * r, Math.sin(t) * h];
  }
}

function drawBun(g: CanvasRenderingContext2D, r: number, seed: number): void {
  const k = KINDS[0]!;
  const path = () => polar(g, shapeOf(0, r), seed, 0.02);
  clayBase(g, r, k.body, k.deep, k.hi, path);
  g.save();
  path();
  g.clip();
  // A baked top, then two score marks with a lit lower lip.
  const top = g.createLinearGradient(0, -r * 0.7, 0, r * 0.1);
  top.addColorStop(0, "rgba(200,130,50,0.35)");
  top.addColorStop(1, "rgba(200,130,50,0)");
  g.fillStyle = top;
  g.fillRect(-r, -r, r * 2, r * 1.1);
  for (const sx of [-0.3, 0.22]) {
    g.strokeStyle = rgba(k.deep, 0.75);
    g.lineWidth = Math.max(1.2, r * 0.07);
    g.beginPath();
    g.moveTo((sx - 0.12) * r, -r * 0.42);
    g.quadraticCurveTo(sx * r, -r * 0.56, (sx + 0.14) * r, -r * 0.36);
    g.stroke();
    g.strokeStyle = "rgba(255,244,214,0.7)";
    g.lineWidth = Math.max(0.8, r * 0.03);
    g.beginPath();
    g.moveTo((sx - 0.1) * r, -r * 0.37);
    g.quadraticCurveTo(sx * r, -r * 0.5, (sx + 0.13) * r, -r * 0.31);
    g.stroke();
  }
  for (let p = 0; p < 18; p++) {
    g.fillStyle = `rgba(255,252,240,${0.25 + hash(seed, 300 + p) * 0.4})`;
    g.beginPath();
    g.arc((hash(seed, 310 + p) - 0.5) * r * 1.5, -r * 0.2 - hash(seed, 320 + p) * r * 0.45, 0.6 + hash(seed, 330 + p) * r * 0.025, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
  clayFinish(g, r, k.deep, seed, path, { spec: 0.25 });
  cheeks(g, 0, r * 0.2, r * 0.42, r, 0.35);
}

function drawHeart(g: CanvasRenderingContext2D, r: number, seed: number): void {
  const k = KINDS[1]!;
  const path = () => polar(g, shapeOf(1, r), seed, 0.015);
  clayBase(g, r, k.body, k.deep, k.hi, path);
  // A pressed ridge along the lobes.
  g.save();
  path();
  g.clip();
  g.strokeStyle = "rgba(255,220,210,0.4)";
  g.lineWidth = Math.max(1, r * 0.05);
  for (const s of [-1, 1]) {
    g.beginPath();
    g.arc(s * r * 0.45, -r * 0.18, r * 0.28, Math.PI * 1.1, Math.PI * 1.75);
    g.stroke();
  }
  g.restore();
  clayFinish(g, r, k.deep, seed, path, { spec: 0.4 });
  cheeks(g, 0, r * 0.06, r * 0.4, r, 0.4);
}

function drawLeaf(g: CanvasRenderingContext2D, r: number, seed: number): void {
  const k = KINDS[2]!;
  const path = () => polar(g, shapeOf(2, r), seed, 0.012);
  // The stem, behind the leaf.
  g.strokeStyle = k.deep;
  g.lineWidth = Math.max(2, r * 0.12);
  g.beginPath();
  g.moveTo(-r * 0.86, r * 0.02);
  g.quadraticCurveTo(-r * 1.08, r * 0.0, -r * 1.12, -r * 0.18);
  g.stroke();
  clayBase(g, r, k.body, k.deep, k.hi, path);
  g.save();
  path();
  g.clip();
  // The vein pressed in with a tool, and its side veins.
  g.strokeStyle = rgba(k.deep, 0.7);
  g.lineWidth = Math.max(1.2, r * 0.05);
  g.beginPath();
  g.moveTo(-r * 0.9, r * 0.02);
  g.quadraticCurveTo(0, -r * 0.06, r * 0.92, -r * 0.14);
  g.stroke();
  for (let i = 0; i < 4; i++) {
    const x = -r * 0.55 + i * r * 0.38;
    for (const s of [-1, 1]) {
      g.beginPath();
      g.moveTo(x, -r * 0.03 - i * r * 0.025);
      g.quadraticCurveTo(x + r * 0.1, s * r * 0.15, x + r * 0.22, s * r * 0.3);
      g.stroke();
    }
  }
  g.restore();
  clayFinish(g, r, k.deep, seed, path, { spec: 0.35 });
  cheeks(g, k.fx * r, r * 0.13, r * 0.36, r, 0.35);
}

function drawSardine(g: CanvasRenderingContext2D, r: number, seed: number): void {
  const k = KINDS[3]!;
  const h = r * HH;
  // The tail fins, then the body over them.
  const tail = () => {
    g.beginPath();
    g.moveTo(r * 0.42, 0);
    g.quadraticCurveTo(r * 0.75, -h * 0.25, r * 1.02, -h * 0.72);
    g.quadraticCurveTo(r * 0.9, -h * 0.05, r * 0.92, 0);
    g.quadraticCurveTo(r * 0.9, h * 0.05, r * 1.02, h * 0.72);
    g.quadraticCurveTo(r * 0.75, h * 0.25, r * 0.42, 0);
    g.closePath();
  };
  tail();
  g.fillStyle = "#7E98B7";
  g.fill();
  g.strokeStyle = rgba(k.deep, 0.9);
  g.lineWidth = Math.max(1, r * 0.04);
  g.stroke();
  const path = () => polar(g, shapeOf(3, r), seed, 0.01);
  clayBase(g, r, k.body, k.deep, k.hi, path);
  g.save();
  path();
  g.clip();
  // A blue-grey back, a silver belly, the gill and a row of spots, as on the painted tins.
  const back = g.createLinearGradient(0, -h, 0, h * 0.2);
  back.addColorStop(0, "#5D86A6");
  back.addColorStop(0.55, "#7EA2BF");
  back.addColorStop(1, "rgba(126,162,191,0)");
  g.fillStyle = back;
  g.fillRect(-r * 1.2, -h, r * 2.4, h * 1.2);
  g.fillStyle = "rgba(60,90,120,0.55)";
  for (let i = 0; i < 4; i++) {
    g.beginPath();
    g.arc(-r * 0.1 + i * r * 0.2, -h * 0.12, r * 0.04, 0, Math.PI * 2);
    g.fill();
  }
  g.strokeStyle = rgba(k.deep, 0.8);
  g.lineWidth = Math.max(1, r * 0.04);
  g.beginPath();
  g.arc(-r * 0.62, 0, h * 0.62, -0.9, 0.9);
  g.stroke();
  g.restore();
  clayFinish(g, r, k.deep, seed, path, { spec: 0.6, prints: 1 });
  // The fin on the back.
  g.fillStyle = "#6F8FB0";
  g.beginPath();
  g.moveTo(-r * 0.1, -h * 0.72);
  g.quadraticCurveTo(r * 0.05, -h * 1.08, r * 0.22, -h * 0.66);
  g.closePath();
  g.fill();
  cheeks(g, k.fx * r, r * 0.1, r * 0.2, r, 0.45);
}

function drawStar(g: CanvasRenderingContext2D, r: number, seed: number): void {
  const k = KINDS[4]!;
  const path = () => polar(g, shapeOf(4, r), seed, 0.012, 120);
  clayBase(g, r, k.body, k.deep, k.hi, path);
  g.save();
  path();
  g.clip();
  // A ridge pinched up each arm.
  g.strokeStyle = "rgba(255,250,255,0.35)";
  g.lineWidth = Math.max(1, r * 0.04);
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + (i * Math.PI * 2) / 5;
    g.beginPath();
    g.moveTo(Math.cos(a) * r * 0.25, Math.sin(a) * r * 0.2);
    g.lineTo(Math.cos(a) * r * 0.68, Math.sin(a) * r * 0.5);
    g.stroke();
  }
  g.restore();
  clayFinish(g, r, k.deep, seed, path, { spec: 0.35 });
  cheeks(g, 0, r * 0.12, r * 0.28, r, 0.4);
}

function drawSnail(g: CanvasRenderingContext2D, r: number, seed: number): void {
  const k = KINDS[5]!;
  const h = r * HH;
  // The foot, a soft cream slug, with the head rising at the left and two stalks.
  const foot = () => {
    g.beginPath();
    g.moveTo(-r * 0.98, h * 0.75);
    g.quadraticCurveTo(-r * 1.02, -h * 0.25, -r * 0.62, -h * 0.3);
    g.quadraticCurveTo(-r * 0.3, -h * 0.3, -r * 0.22, h * 0.3);
    g.lineTo(r * 0.98, h * 0.62);
    g.quadraticCurveTo(r * 1.02, h * 0.95, r * 0.6, h * 0.95);
    g.lineTo(-r * 0.8, h * 0.95);
    g.quadraticCurveTo(-r * 1.0, h * 0.95, -r * 0.98, h * 0.75);
    g.closePath();
  };
  g.strokeStyle = k.deep;
  g.lineWidth = Math.max(1.5, r * 0.06);
  for (const [x, y] of [[-0.78, -0.92], [-0.52, -0.95]] as const) {
    g.beginPath();
    g.moveTo(-r * 0.66, -h * 0.22);
    g.lineTo(x * r, y * h);
    g.stroke();
    g.fillStyle = k.body;
    g.beginPath();
    g.arc(x * r, y * h, r * 0.07, 0, Math.PI * 2);
    g.fill();
    g.stroke();
  }
  clayBase(g, r, k.body, k.deep, k.hi, foot);
  clayFinish(g, r, k.deep, seed, foot, { spec: 0.3, prints: 0 });
  // The shell: a spiral rolled from a snake of clay.
  const cx = r * 0.3;
  const cy = -h * 0.08;
  const R = h * 0.98;
  const shell = () => polar(g, (t) => [cx / wobble(t, seed + 9, 0.012) + Math.cos(t) * R * 1.05, cy / wobble(t, seed + 9, 0.012) + Math.sin(t) * R], seed + 9, 0.012);
  clayBase(g, R, SHELL.body, SHELL.deep, SHELL.hi, shell);
  g.strokeStyle = rgba(SHELL.deep, 0.9);
  g.lineWidth = Math.max(1.4, r * 0.07);
  g.beginPath();
  for (let i = 0; i <= 60; i++) {
    const a = i * 0.22 + 0.6;
    const rr = R * 0.88 * (1 - i / 64);
    const x = cx + Math.cos(a) * rr * 1.05;
    const y = cy + Math.sin(a) * rr;
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.stroke();
  clayFinish(g, R, SHELL.deep, seed + 3, shell, { spec: 0.35, prints: 0 });
  cheeks(g, k.fx * r, r * 0.18, r * 0.16, r, 0.45);
}

function drawFlower(g: CanvasRenderingContext2D, r: number, seed: number): void {
  const k = KINDS[6]!;
  const h = r * HH;
  const path = () => polar(g, shapeOf(6, r), seed, 0.01, 120);
  clayBase(g, r, k.body, k.deep, k.hi, path);
  g.save();
  path();
  g.clip();
  // Creases between the petals.
  g.strokeStyle = rgba(k.deep, 0.6);
  g.lineWidth = Math.max(1, r * 0.04);
  for (let i = 0; i < 6; i++) {
    const a = Math.PI / 6 + (i * Math.PI) / 3;
    g.beginPath();
    g.moveTo(Math.cos(a) * r * 0.42, Math.sin(a) * h * 0.5);
    g.lineTo(Math.cos(a) * r * 0.86, Math.sin(a) * h * 1.0);
    g.stroke();
  }
  g.restore();
  clayFinish(g, r, k.deep, seed, path, { spec: 0.3, prints: 0 });
  // The middle: a butter button the face sits on.
  const mid = () => polar(g, (t) => [Math.cos(t) * r * 0.42, Math.sin(t) * h * 0.56], seed + 5, 0.02);
  clayBase(g, r * 0.42, "#F6D98B", "#DDB04F", "#FFF2C8", mid);
  clayFinish(g, r * 0.42, "#C9993E", seed + 5, mid, { spec: 0.25, prints: 1 });
  cheeks(g, 0, r * 0.12, r * 0.25, r * 0.8, 0.45);
}

function drawMushroom(g: CanvasRenderingContext2D, r: number, seed: number): void {
  const k = KINDS[7]!;
  const h = r * HH;
  const stem = () => {
    g.beginPath();
    g.moveTo(-r * 0.4, -h * 0.1);
    g.quadraticCurveTo(-r * 0.5, h * 0.7, -r * 0.42, h * 0.98);
    g.quadraticCurveTo(0, h * 1.1, r * 0.42, h * 0.98);
    g.quadraticCurveTo(r * 0.5, h * 0.7, r * 0.4, -h * 0.1);
    g.closePath();
  };
  clayBase(g, r * 0.7, k.body, k.deep, k.hi, stem);
  clayFinish(g, r * 0.7, k.deep, seed, stem, { spec: 0.2, prints: 0 });
  const cap = () => {
    g.beginPath();
    const n = 40;
    for (let i = 0; i <= n; i++) {
      const t = Math.PI + (i / n) * Math.PI;
      const w = wobble(t, seed + 2, 0.02);
      g.lineTo(Math.cos(t) * r * 1.0 * w, -h * 0.02 + Math.sin(t) * h * 1.05 * w);
    }
    for (let i = 0; i <= 12; i++) {
      const x = r * (1 - (i / 12) * 2);
      g.lineTo(x * 0.98, h * 0.08 + Math.sin(i * 1.7 + seed) * h * 0.04);
    }
    g.closePath();
  };
  clayBase(g, r, CAP.body, CAP.deep, CAP.hi, cap);
  g.save();
  cap();
  g.clip();
  for (const [x, y, s] of [[-0.55, -0.45, 0.14], [0.05, -0.75, 0.12], [0.55, -0.35, 0.15], [-0.15, -0.3, 0.09], [0.82, -0.05, 0.08], [-0.85, -0.05, 0.08]] as const) {
    g.fillStyle = "#F7EAD2";
    g.beginPath();
    g.ellipse(x * r, y * h, s * r, s * r * 0.8, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "rgba(160,120,90,0.35)";
    g.beginPath();
    g.ellipse(x * r + s * r * 0.2, y * h + s * r * 0.25, s * r * 0.7, s * r * 0.35, 0, 0, Math.PI);
    g.fill();
  }
  g.restore();
  clayFinish(g, r, CAP.deep, seed, cap, { spec: 0.3 });
  cheeks(g, 0, h * 0.58, r * 0.24, r * 0.8, 0.45);
}

function drawPutty(g: CanvasRenderingContext2D, r: number, seed: number): void {
  const h = r * HH;
  const path = () => polar(g, (t) => [Math.cos(t) * r * 0.92, Math.sin(t) * h * (Math.sin(t) > 0 ? 0.82 : 1.02)], seed, 0.06);
  clayBase(g, r, PUTTY.body, PUTTY.deep, PUTTY.hi, path);
  g.save();
  path();
  g.clip();
  // Finger dents where it was squeezed off the block.
  for (let i = 0; i < 3; i++) {
    const x = (hash(seed, 400 + i) - 0.5) * r * 1.2;
    const y = (hash(seed, 410 + i) - 0.5) * h * 0.8;
    const dg = g.createRadialGradient(x - r * 0.04, y - r * 0.04, 0, x, y, r * 0.2);
    dg.addColorStop(0, "rgba(120,100,80,0.35)");
    dg.addColorStop(0.7, "rgba(120,100,80,0.1)");
    dg.addColorStop(1, "rgba(255,250,240,0.12)");
    g.fillStyle = dg;
    g.beginPath();
    g.ellipse(x, y, r * 0.2, r * 0.15, hash(seed, 420 + i) * 3, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
  clayFinish(g, r, PUTTY.deep, seed, path, { spec: 0.12, prints: 2 });
}

const DRAW = [drawBun, drawHeart, drawLeaf, drawSardine, drawStar, drawSnail, drawFlower, drawMushroom];

/** One lump sprite: kind (-1 = raw putty) at width `a` CSS px, variant 0 or 1 (a second sculpt for the clay boil). */
export function makeLump(kind: number, a: number, variant: number, k: number): Sprite {
  const r = a / 2;
  const seed = 17 + (kind + 2) * 41 + variant * 7;
  return makeSprite(a * 1.5, a * 1.35, a * 0.75, a * 0.7, k, (g) => {
    if (kind < 0) drawPutty(g, r, seed);
    else DRAW[kind]!(g, r, seed);
  });
}

/** Every kind and the putty, two sculpts each: `sprites[kind + 1][variant]`. */
export function makeLumps(a: number, k: number): Sprite[][] {
  const out: Sprite[][] = [];
  for (let kind = -1; kind < KINDS.length; kind++) out.push([makeLump(kind, a, 0, k), makeLump(kind, a, 1, k)]);
  return out;
}

// ------------------------------------------------------------------------------------------------------------------
// Faces (live): bead eyes and a mouth in the lump's own frame.
// ------------------------------------------------------------------------------------------------------------------

export type Mood = "plain" | "wide" | "happy" | "worried" | "squeeze" | "sleep";

export interface Look {
  x: number;
  y: number;
  blink: number;
  mood: Mood;
}

export function drawFace(g: CanvasRenderingContext2D, kind: number, r: number, look: Look): void {
  const f = kind < 0 ? { ex: 0.2, ey: 0, er: 0.07, my: 0.2, fx: 0 } : KINDS[kind]!;
  const cx = f.fx * r;
  const er = Math.max(1.6, f.er * r);
  const ex = f.ex * r;
  const ey = f.ey * r;
  const my = f.my * r;
  g.strokeStyle = PAL.ink;
  g.fillStyle = PAL.ink;
  g.lineCap = "round";
  const lw = Math.max(1.1, er * 0.5);
  if (look.mood === "sleep") {
    g.lineWidth = lw;
    for (const s of [-1, 1]) {
      g.beginPath();
      g.arc(cx + s * ex, ey - er * 0.3, er * 0.85, Math.PI * 0.15, Math.PI * 0.85);
      g.stroke();
    }
    return;
  }
  if (look.mood === "happy" || look.mood === "squeeze") {
    g.lineWidth = lw;
    for (const s of [-1, 1]) {
      g.beginPath();
      if (look.mood === "happy") g.arc(cx + s * ex, ey + er * 0.4, er * 0.95, Math.PI * 1.15, Math.PI * 1.85);
      else {
        g.moveTo(cx + s * ex - er * s, ey - er * 0.7);
        g.lineTo(cx + s * ex + er * 0.6 * s, ey);
        g.lineTo(cx + s * ex - er * s, ey + er * 0.7);
      }
      g.stroke();
    }
    g.beginPath();
    if (look.mood === "happy") {
      g.moveTo(cx - er * 1.6, my - er * 0.3);
      g.quadraticCurveTo(cx, my + er * 2.4, cx + er * 1.6, my - er * 0.3);
      g.closePath();
      g.fill();
    } else {
      g.moveTo(cx - er * 1.1, my + er * 0.2);
      g.lineTo(cx + er * 1.1, my + er * 0.2);
      g.lineWidth = lw;
      g.stroke();
    }
    return;
  }
  const wide = look.mood === "wide";
  const worried = look.mood === "worried";
  const big = wide ? 1.22 : worried ? 1.15 : 1;
  const dx = look.x * er * 0.45;
  const dy = look.y * er * 0.35;
  const open = 1 - look.blink * 0.88;
  for (const s of [-1, 1]) {
    const x = cx + s * ex + dx;
    const y = ey + dy;
    g.fillStyle = PAL.ink;
    g.beginPath();
    g.ellipse(x, y, er * big, er * 1.22 * big * open, 0, 0, Math.PI * 2);
    g.fill();
    if (open > 0.4) {
      g.fillStyle = "rgba(255,255,255,0.92)";
      g.beginPath();
      g.arc(x - er * 0.32, y - er * 0.42 * open, er * 0.34 * big, 0, Math.PI * 2);
      g.fill();
    }
    if (worried) {
      g.strokeStyle = PAL.ink;
      g.lineWidth = Math.max(1, er * 0.42);
      g.beginPath();
      g.moveTo(x - er * 1.1 * s, y - er * 2.3);
      g.lineTo(x + er * 0.8 * s, y - er * 1.8);
      g.stroke();
    }
  }
  g.fillStyle = PAL.ink;
  g.strokeStyle = PAL.ink;
  g.lineWidth = lw;
  g.beginPath();
  if (wide) {
    g.ellipse(cx, my + er * 0.4, er * 0.65, er * 0.85, 0, 0, Math.PI * 2);
    g.fill();
  } else if (worried) {
    g.moveTo(cx - er * 1.1, my + er * 0.5);
    g.quadraticCurveTo(cx - er * 0.5, my - er * 0.2, cx, my + er * 0.4);
    g.quadraticCurveTo(cx + er * 0.5, my + er, cx + er * 1.1, my + er * 0.2);
    g.stroke();
  } else {
    g.arc(cx, my - er * 0.6, er * 1.05, Math.PI * 0.22, Math.PI * 0.78);
    g.stroke();
  }
}

// ------------------------------------------------------------------------------------------------------------------
// Pots: a dark mouth drawn behind the lumps, the body drawn in front of the bottom one. Origin at the rim's centre.
// ------------------------------------------------------------------------------------------------------------------

export type PotStyle = "clay" | "little" | "spare";

function potColors(style: PotStyle): { body: string; deep: string; hi: string } {
  if (style === "little") return { body: PAL.little, deep: PAL.littleDeep, hi: PAL.littleHi };
  if (style === "spare") return { body: PAL.glaze, deep: PAL.glazeDeep, hi: "#FFFAF0" };
  return { body: PAL.pot, deep: PAL.potDeep, hi: PAL.potHi };
}

export function makePotBack(a: number, style: PotStyle, k: number): Sprite {
  const w = (style === "little" ? 0.96 : 1.14) * a;
  return makeSprite(w * 1.2, a * 0.5, w * 0.6, a * 0.25, k, (g) => {
    const gr = g.createLinearGradient(0, -a * 0.12, 0, a * 0.12);
    gr.addColorStop(0, "#2E1A12");
    gr.addColorStop(1, PAL.potInside);
    g.fillStyle = gr;
    g.beginPath();
    g.ellipse(0, 0, w * 0.46, a * 0.11, 0, 0, Math.PI * 2);
    g.fill();
  });
}

export function makePotFront(a: number, style: PotStyle, cap: number, k: number): Sprite {
  const w = (style === "little" ? 0.96 : 1.14) * a;
  const h = 0.58 * a;
  const c = potColors(style);
  return makeSprite(w * 1.3, h + a * 0.4, w * 0.65, a * 0.18, k, (g) => {
    // Shadow on the shelf.
    g.fillStyle = "rgba(40,24,16,0.28)";
    g.beginPath();
    g.ellipse(w * 0.04, h + a * 0.02, w * 0.46, a * 0.07, 0, 0, Math.PI * 2);
    g.fill();
    // The body: a flowerpot, wider at the top, a little lumpy.
    const body = () => {
      g.beginPath();
      g.moveTo(-w * 0.46, a * 0.02);
      g.quadraticCurveTo(-w * 0.44, h * 0.6, -w * 0.36, h);
      g.quadraticCurveTo(0, h + a * 0.06, w * 0.36, h);
      g.quadraticCurveTo(w * 0.44, h * 0.6, w * 0.46, a * 0.02);
      g.closePath();
    };
    body();
    const bg = g.createLinearGradient(-w * 0.5, 0, w * 0.5, 0);
    bg.addColorStop(0, c.hi);
    bg.addColorStop(0.35, c.body);
    bg.addColorStop(1, c.deep);
    g.fillStyle = bg;
    g.fill();
    g.save();
    body();
    g.clip();
    const vg = g.createLinearGradient(0, 0, 0, h);
    vg.addColorStop(0, "rgba(40,20,10,0.25)");
    vg.addColorStop(0.3, "rgba(40,20,10,0)");
    vg.addColorStop(1, "rgba(40,20,10,0.18)");
    g.fillStyle = vg;
    g.fillRect(-w, 0, w * 2, h + a * 0.1);
    // A thumbprint and a few pocks in the clay.
    for (let i = 1; i <= 5; i++) {
      g.strokeStyle = rgba(c.deep, 0.18 * (1 - i / 7));
      g.lineWidth = 0.8;
      g.beginPath();
      g.ellipse(w * 0.22, h * 0.62, i * a * 0.03 * 1.3, i * a * 0.03, 0.4, 0.3, 5.2);
      g.stroke();
    }
    g.restore();
    g.strokeStyle = rgba(c.deep, 0.9);
    g.lineWidth = Math.max(1, a * 0.025);
    body();
    g.stroke();
    // The rolled rim: a fat band, glazed cream on the clay pots, dripping a little.
    const rimH = a * 0.17;
    g.beginPath();
    g.roundRect(-w * 0.52, -a * 0.05, w * 1.04, rimH, rimH * 0.5);
    const rg = g.createLinearGradient(0, -a * 0.05, 0, -a * 0.05 + rimH);
    if (style === "clay") {
      rg.addColorStop(0, "#FFF8EA");
      rg.addColorStop(0.5, PAL.glaze);
      rg.addColorStop(1, PAL.glazeDeep);
    } else {
      rg.addColorStop(0, c.hi);
      rg.addColorStop(0.55, c.body);
      rg.addColorStop(1, c.deep);
    }
    g.fillStyle = rg;
    g.fill();
    if (style === "clay") {
      // A cobalt line under the glaze, as Lisbon pottery has.
      g.strokeStyle = rgba("#3F62A0", 0.7);
      g.lineWidth = Math.max(1.2, a * 0.028);
      g.beginPath();
      g.moveTo(-w * 0.45, a * 0.135);
      g.quadraticCurveTo(0, a * 0.16, w * 0.45, a * 0.135);
      g.stroke();
    }
    g.strokeStyle = style === "clay" ? rgba(PAL.glazeDeep, 1) : rgba(c.deep, 1);
    g.lineWidth = Math.max(1, a * 0.02);
    g.beginPath();
    g.roundRect(-w * 0.52, -a * 0.05, w * 1.04, rimH, rimH * 0.5);
    g.stroke();
    g.strokeStyle = "rgba(255,255,255,0.55)";
    g.lineWidth = Math.max(1, a * 0.018);
    g.beginPath();
    g.moveTo(-w * 0.44, -a * 0.02);
    g.lineTo(w * 0.3, -a * 0.02);
    g.stroke();
    // Dimples for each lump it holds (the game fills them in live).
    for (let i = 0; i < cap; i++) {
      const x = (i - (cap - 1) / 2) * a * 0.17;
      const y = h * 0.62;
      g.fillStyle = rgba(c.deep, 0.55);
      g.beginPath();
      g.arc(x, y, a * 0.045, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "rgba(255,240,220,0.35)";
      g.beginPath();
      g.arc(x + a * 0.012, y + a * 0.018, a * 0.03, 0, Math.PI);
      g.fill();
    }
  });
}

/** Where a pot's dimples sit (relative to the rim's centre), for the live fill dots. */
export const dimple = (a: number, cap: number, i: number): [number, number] => [(i - (cap - 1) / 2) * a * 0.17, 0.58 * a * 0.62];

/** The seal pressed on a full pot: a clay medallion in the kind's colour with a thumbprint. Origin at its centre. */
export function makeSeal(a: number, body: string, deep: string, k: number): Sprite {
  const r = a * 0.21;
  return makeSprite(r * 2.6, r * 2.6, r * 1.3, r * 1.3, k, (g) => {
    g.fillStyle = "rgba(40,20,10,0.3)";
    g.beginPath();
    g.ellipse(r * 0.1, r * 0.18, r * 1.05, r * 0.98, 0, 0, Math.PI * 2);
    g.fill();
    const path = () => polar(g, (t) => [Math.cos(t) * r, Math.sin(t) * r * 0.95], 5, 0.06);
    path();
    const gr = g.createRadialGradient(-r * 0.3, -r * 0.35, 0, 0, 0, r * 1.2);
    gr.addColorStop(0, "#FFFFFF");
    gr.addColorStop(0.25, body);
    gr.addColorStop(1, deep);
    g.fillStyle = gr;
    g.fill();
    for (let i = 1; i <= 6; i++) {
      g.strokeStyle = rgba(deep, 0.5 * (1 - i / 8));
      g.lineWidth = Math.max(0.7, r * 0.06);
      g.beginPath();
      g.ellipse(r * 0.05, r * 0.05, i * r * 0.13 * 1.2, i * r * 0.13, 0.3, 0.5, 5.6);
      g.stroke();
    }
    path();
    g.strokeStyle = rgba(deep, 0.95);
    g.lineWidth = Math.max(1, r * 0.1);
    g.stroke();
  });
}

// ------------------------------------------------------------------------------------------------------------------
// The stage: felt wall, a splashback of hand-pressed azulejo tiles, the counter. Static, one blit per frame.
// ------------------------------------------------------------------------------------------------------------------

export function makeStage(W: number, H: number, tileTop: number, counterY: number, k: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = Math.ceil(W * k);
  c.height = Math.ceil(H * k);
  const g = c.getContext("2d")!;
  g.scale(k, k);
  g.lineCap = "round";
  g.lineJoin = "round";

  // Felt wall.
  const wg = g.createLinearGradient(0, 0, 0, tileTop);
  wg.addColorStop(0, PAL.wallHi);
  wg.addColorStop(1, PAL.wall);
  g.fillStyle = wg;
  g.fillRect(0, 0, W, tileTop + 2);
  for (let p = 0; p < 360; p++) {
    const x = hash(p, 31) * W;
    const y = hash(p, 32) * tileTop;
    const a = hash(p, 33) * Math.PI;
    const l = 2 + hash(p, 34) * 5;
    g.strokeStyle = hash(p, 35) < 0.5 ? "rgba(150,100,70,0.08)" : "rgba(255,250,240,0.25)";
    g.lineWidth = 0.8;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
    g.stroke();
  }

  // Tiles: square, a little uneven, each glazed by hand, with a soft quatrefoil and corner quarter-rings that join
  // across tiles into circles. Kept low in contrast so the lumps stay the loudest thing.
  const T = Math.max(40, Math.min(56, W / 8));
  const cols = Math.ceil(W / T) + 1;
  const rows = Math.ceil((counterY - tileTop) / T) + 1;
  const ox = (W - Math.floor(W / T) * T) / 2 - T;
  g.fillStyle = PAL.grout;
  g.fillRect(0, tileTop, W, counterY - tileTop);
  g.save();
  g.beginPath();
  g.rect(0, tileTop, W, counterY - tileTop);
  g.clip();
  for (let ty = 0; ty < rows; ty++) {
    for (let tx = 0; tx <= cols; tx++) {
      const x = ox + tx * T + 1.5;
      const y = tileTop + ty * T + 1.5;
      const s = T - 3;
      const v = hash(tx * 31 + ty, 7);
      const tg = g.createLinearGradient(x, y, x + s, y + s);
      const base = v < 0.33 ? "#6A8CC2" : v < 0.66 ? "#6F90C4" : "#6787BC";
      tg.addColorStop(0, PAL.tileHi);
      tg.addColorStop(0.25, base);
      tg.addColorStop(1, PAL.tileDeep);
      g.fillStyle = tg;
      g.beginPath();
      g.roundRect(x + (hash(tx, ty) - 0.5), y + (hash(ty, tx) - 0.5), s, s, 4);
      g.fill();
      g.save();
      g.translate(x + s / 2, y + s / 2);
      g.strokeStyle = "rgba(205,222,245,0.2)";
      g.lineWidth = 2;
      for (let q = 0; q < 4; q++) {
        g.rotate(Math.PI / 2);
        g.beginPath();
        g.ellipse(0, -s * 0.17, s * 0.09, s * 0.16, 0, 0, Math.PI * 2);
        g.stroke();
        g.beginPath();
        g.arc(-s / 2, -s / 2, s * 0.28, 0, Math.PI / 2);
        g.stroke();
      }
      g.fillStyle = "rgba(225,235,250,0.25)";
      g.beginPath();
      g.arc(0, 0, s * 0.06, 0, Math.PI * 2);
      g.fill();
      g.restore();
      // The glaze's shine and a pooled edge.
      g.fillStyle = "rgba(255,255,255,0.12)";
      g.beginPath();
      g.ellipse(x + s * 0.3, y + s * 0.22, s * 0.22, s * 0.08, -0.5, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = "rgba(40,60,100,0.25)";
      g.lineWidth = 1;
      g.beginPath();
      g.roundRect(x, y, s, s, 4);
      g.stroke();
    }
  }
  // A shadow under the felt's edge, and soft light from the upper left.
  const lip = g.createLinearGradient(0, tileTop, 0, tileTop + 18);
  lip.addColorStop(0, "rgba(40,30,40,0.3)");
  lip.addColorStop(1, "rgba(40,30,40,0)");
  g.fillStyle = lip;
  g.fillRect(0, tileTop, W, 18);
  const key = g.createRadialGradient(W * 0.15, tileTop, 0, W * 0.15, tileTop, H * 0.8);
  key.addColorStop(0, "rgba(255,246,232,0.18)");
  key.addColorStop(1, "rgba(255,246,232,0)");
  g.fillStyle = key;
  g.fillRect(0, tileTop, W, counterY - tileTop);
  g.restore();
  // The felt's edge: a rolled clay trim between wall and tiles.
  g.fillStyle = PAL.wallDeep;
  g.beginPath();
  g.roundRect(-4, tileTop - 5, W + 8, 9, 4.5);
  g.fill();
  g.fillStyle = "rgba(255,246,232,0.6)";
  g.fillRect(0, tileTop - 4, W, 1.5);

  // The counter.
  const cg = g.createLinearGradient(0, counterY, 0, H);
  cg.addColorStop(0, PAL.woodHi);
  cg.addColorStop(0.16, PAL.wood);
  cg.addColorStop(1, PAL.woodDeep);
  g.fillStyle = cg;
  g.fillRect(0, counterY, W, H - counterY);
  g.fillStyle = "rgba(255,240,220,0.5)";
  g.fillRect(0, counterY, W, 2);
  for (let p = 0; p < 50; p++) {
    g.fillStyle = `rgba(255,250,240,${0.08 + hash(p, 13) * 0.2})`;
    g.beginPath();
    g.arc(hash(p, 11) * W, counterY + 6 + hash(p, 12) * (H - counterY - 8), 0.8 + hash(p, 14) * 2, 0, Math.PI * 2);
    g.fill();
  }
  const vig = g.createRadialGradient(W / 2, H * 0.45, Math.min(W, H) * 0.4, W / 2, H * 0.45, Math.max(W, H) * 0.8);
  vig.addColorStop(0, "rgba(60,30,30,0)");
  vig.addColorStop(1, "rgba(60,30,30,0.2)");
  g.fillStyle = vig;
  g.fillRect(0, 0, W, H);
  return c;
}

/** A wooden shelf with a lit edge, drawn live (two rounded slabs). */
export function drawShelf(g: CanvasRenderingContext2D, x0: number, x1: number, y: number, U: number): void {
  const th = Math.max(8, U * 0.16);
  g.fillStyle = "rgba(30,30,50,0.25)";
  g.beginPath();
  g.roundRect(x0 + 2, y + th * 0.6, x1 - x0, th * 1.1, th * 0.4);
  g.fill();
  g.fillStyle = PAL.woodDeep;
  g.beginPath();
  g.roundRect(x0, y + th * 0.35, x1 - x0, th * 0.8, th * 0.4);
  g.fill();
  g.fillStyle = PAL.wood;
  g.beginPath();
  g.roundRect(x0, y - th * 0.2, x1 - x0, th * 0.8, th * 0.4);
  g.fill();
  g.fillStyle = "rgba(255,235,210,0.55)";
  g.fillRect(x0 + th * 0.4, y - th * 0.12, x1 - x0 - th * 0.8, Math.max(1.2, th * 0.14));
}

/**
 * The studio hand, reaching down from above to pat a full pot: a sage sleeve, a cuff, the arm and the palm with three
 * curled knuckles (as Pinchbake's). Origin at the bottom of the palm.
 */
export function makeHand(s: number, reach: number, k: number): Sprite {
  const w = s * 2.6;
  return makeSprite(w, reach + s * 0.4, w / 2, reach, k, (g) => {
    g.translate(0, -s * 0.72);
    const aw = s * 1.05;
    const ag = g.createLinearGradient(-aw / 2, 0, aw / 2, 0);
    ag.addColorStop(0, PAL.skinHi);
    ag.addColorStop(0.45, PAL.skin);
    ag.addColorStop(1, PAL.skinDeep);
    g.fillStyle = ag;
    g.beginPath();
    g.roundRect(-aw / 2, -reach, aw, reach, aw * 0.4);
    g.fill();
    const sw = s * 1.3;
    const sg = g.createLinearGradient(-sw / 2, 0, sw / 2, 0);
    sg.addColorStop(0, "#C3DDB3");
    sg.addColorStop(0.45, PAL.sage);
    sg.addColorStop(1, PAL.sageDeep);
    g.fillStyle = sg;
    g.beginPath();
    g.roundRect(-sw / 2, -reach, sw, reach - s * 1.55, s * 0.35);
    g.fill();
    // Knitted ribs down the sleeve, so it reads as a jumper and not a slab.
    g.save();
    g.beginPath();
    g.roundRect(-sw / 2, -reach, sw, reach - s * 1.55, s * 0.35);
    g.clip();
    for (let i = -3; i <= 3; i++) {
      g.strokeStyle = i % 2 ? "rgba(90,120,70,0.22)" : "rgba(255,255,240,0.2)";
      g.lineWidth = s * 0.07;
      g.beginPath();
      g.moveTo(i * s * 0.17, -reach);
      g.lineTo(i * s * 0.17, -s * 1.5);
      g.stroke();
    }
    g.restore();
    g.fillStyle = PAL.sageDeep;
    g.beginPath();
    g.roundRect(-sw / 2 - 2, -s * 1.85, sw + 4, s * 0.42, s * 0.2);
    g.fill();
    g.strokeStyle = "rgba(255,250,235,0.7)";
    g.lineWidth = 1.2;
    g.setLineDash([3, 4]);
    g.beginPath();
    g.moveTo(-sw / 2 + 4, -s * 1.64);
    g.lineTo(sw / 2 - 4, -s * 1.64);
    g.stroke();
    g.setLineDash([]);
    const palm = () => {
      g.beginPath();
      g.ellipse(0, 0, s * 0.88, s * 0.72, 0, 0, Math.PI * 2);
    };
    palm();
    const pg = g.createRadialGradient(-s * 0.3, -s * 0.35, s * 0.05, 0, 0, s * 1.05);
    pg.addColorStop(0, PAL.skinHi);
    pg.addColorStop(0.5, PAL.skin);
    pg.addColorStop(1, PAL.skinDeep);
    g.fillStyle = pg;
    g.fill();
    g.strokeStyle = rgba(PAL.skinDeep, 0.9);
    g.lineWidth = 1.5;
    g.stroke();
    for (let i = 0; i < 4; i++) {
      const x = s * (-0.48 + i * 0.32);
      const y = s * 0.55;
      g.fillStyle = i % 2 ? PAL.skin : "#EDB997";
      g.beginPath();
      g.ellipse(x, y, s * 0.17, s * 0.2, 0, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = rgba(PAL.skinDeep, 0.85);
      g.lineWidth = 1.3;
      g.stroke();
    }
    g.strokeStyle = rgba(PAL.skinDeep, 0.25);
    g.lineWidth = 1;
    for (let i = 1; i <= 4; i++) {
      g.beginPath();
      g.ellipse(-s * 0.15, -s * 0.12, s * 0.07 * i * 1.3, s * 0.07 * i, 0.4, 0.3, 5.4);
      g.stroke();
    }
  });
}

/** A soft white puff for flour clouds (drawn scaled). */
export function makePuff(k: number): Sprite {
  const r = 32;
  return makeSprite(r * 2, r * 2, r, r, k, (g) => {
    const pg = g.createRadialGradient(-r * 0.2, -r * 0.2, 0, 0, 0, r);
    pg.addColorStop(0, "rgba(255,252,244,0.95)");
    pg.addColorStop(0.6, "rgba(255,248,236,0.7)");
    pg.addColorStop(1, "rgba(255,248,236,0)");
    g.fillStyle = pg;
    g.beginPath();
    g.arc(0, 0, r, 0, Math.PI * 2);
    g.fill();
  });
}

/** A rounded clay plaque, as squishputt's: a lit top, a darker lip and a soft drop shadow. */
export function plaque(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, body: string, deep: string, hi: string, rad = 14): void {
  g.fillStyle = "rgba(80,40,25,0.22)";
  g.beginPath();
  g.roundRect(x + 1, y + 5, w, h, rad);
  g.fill();
  g.fillStyle = deep;
  g.beginPath();
  g.roundRect(x, y + 3, w, h, rad);
  g.fill();
  const pg = g.createLinearGradient(0, y, 0, y + h);
  pg.addColorStop(0, hi);
  pg.addColorStop(0.5, body);
  pg.addColorStop(1, body);
  g.fillStyle = pg;
  g.beginPath();
  g.roundRect(x, y, w, h, rad);
  g.fill();
  g.strokeStyle = "rgba(255,255,255,0.45)";
  g.lineWidth = 1.5;
  g.beginPath();
  g.roundRect(x + 2, y + 1.5, w - 4, h - 3, Math.max(2, rad - 2));
  g.stroke();
}

/** Text in clay type: cream letters with a chocolate lip. */
export function clayText(g: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, o: { fill?: string; lip?: string; align?: CanvasTextAlign; weight?: number; lipY?: number; outline?: boolean } = {}): void {
  g.font = font(size, o.weight ?? 700);
  g.textAlign = o.align ?? "center";
  g.textBaseline = "middle";
  if (o.outline) {
    g.strokeStyle = o.lip ?? PAL.chocDeep;
    g.lineWidth = Math.max(3, size * 0.2);
    g.lineJoin = "round";
    g.strokeText(text, x, y + Math.max(1.5, size * 0.05));
  }
  g.fillStyle = o.lip ?? PAL.chocDeep;
  g.fillText(text, x, y + (o.lipY ?? Math.max(1.5, size * 0.07)));
  g.fillStyle = o.fill ?? PAL.cream;
  g.fillText(text, x, y);
}
