/**
 * softbake's clay, drawn in Canvas 2D: every piece, the tin, the starter and the fingers are sculpted once at startup
 * into sprites (lumpy outlines, a soft key light from the upper left, thumbprint dents, a warm bounce from below),
 * so the frame loop only blits them. Nothing here runs per frame except the eyes, which blink and look around.
 */
import type { Layout } from "./layout.ts";
import { HOLD_Y, RIM, TIN_W } from "./run.ts";
import { TIERS } from "./tiers.ts";

/** Every colour in the game. Warm studio, cool tin, pastel clay. */
export const PAL = {
  wallHi: "#F6E3CD",
  wall: "#EDCDAE",
  wallDeep: "#DDB08C",
  counter: "#C98F62",
  counterHi: "#E2AE80",
  counterDeep: "#9E6745",
  enamel: "#F6EEE2",
  enamelDeep: "#D8C8B2",
  rim: "#45679A",
  rimDeep: "#2F4A73",
  rimHi: "#7194C7",
  inside: "#7593B4",
  insideDeep: "#5A7698",
  insideHi: "#9FB9D3",
  paper: "#FAF2E2",
  paperDeep: "#E4D4B8",
  starter: "#F4D9A0",
  starterDeep: "#D9AF6A",
  starterHi: "#FFF2D2",
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

function rgba(hex: string, a: number): string {
  const v = parseInt(hex.slice(1), 16);
  return `rgba(${(v >> 16) & 255},${(v >> 8) & 255},${v & 255},${a})`;
}

/** A hand-rolled circle: the radius wanders a little (low lobes), as if squished between palms. */
export function lumpPath(g: CanvasRenderingContext2D, r: number, seed: number, amp = 0.025, sx = 1, sy = 1, cy = 0, lobes = 0): void {
  const a = hash(seed, 1) * 6.28;
  const b = hash(seed, 2) * 6.28;
  const c = hash(seed, 3) * 6.28;
  const n = 56;
  g.beginPath();
  for (let k = 0; k <= n; k++) {
    const t = (k / n) * Math.PI * 2;
    let rr = 1 + amp * (Math.sin(3 * t + a) * 0.55 + Math.sin(5 * t + b) * 0.3 + Math.sin(2 * t + c) * 0.35);
    if (lobes) rr += amp * 0.9 * Math.abs(Math.sin((lobes / 2) * t)) - amp * 0.5;
    const x = Math.cos(t) * r * rr * sx;
    const y = Math.sin(t) * r * rr * sy + cy;
    if (k === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.closePath();
}

/** Base clay: the contact shadow, then the body lit from the upper left. */
function clayBase(g: CanvasRenderingContext2D, r: number, body: string, deep: string, hi: string, path: () => void): void {
  // A soft contact shadow, mostly hidden under the body: it shows as a dark edge at the lower right.
  const sh = g.createRadialGradient(r * 0.1, r * 0.2, r * 0.6, r * 0.1, r * 0.2, r * 1.14);
  sh.addColorStop(0, "rgba(46,28,22,0.34)");
  sh.addColorStop(1, "rgba(46,28,22,0)");
  g.fillStyle = sh;
  g.beginPath();
  g.arc(r * 0.1, r * 0.2, r * 1.14, 0, Math.PI * 2);
  g.fill();
  path();
  const gr = g.createRadialGradient(-r * 0.38, -r * 0.44, r * 0.04, -r * 0.1, -r * 0.1, r * 1.45);
  gr.addColorStop(0, hi);
  gr.addColorStop(0.42, body);
  gr.addColorStop(1, deep);
  g.fillStyle = gr;
  g.fill();
}

/** Clay finish over everything: thumbprint whorls, little dents, a unifying key light, the bounce and the edge. */
function clayFinish(g: CanvasRenderingContext2D, r: number, deep: string, seed: number, path: () => void, o: { spec?: number; prints?: number } = {}): void {
  g.save();
  path();
  g.clip();
  // A thumbprint: fine concentric ridges in a squashed oval.
  const prints = o.prints ?? 1;
  for (let p = 0; p < prints; p++) {
    const cx = (hash(seed, 10 + p) - 0.5) * r * 1.0;
    const cy = (hash(seed, 20 + p) - 0.3) * r * 0.9;
    const rot = hash(seed, 30 + p) * Math.PI;
    const rings = 6;
    for (let k = 1; k <= rings; k++) {
      const rad = k * r * 0.055;
      const a0 = hash(seed * 7 + k, p) * 6.28;
      g.lineWidth = Math.max(0.5, r * 0.016);
      g.strokeStyle = rgba(deep, 0.16 * (1 - k / (rings + 2)));
      g.beginPath();
      g.ellipse(cx, cy, rad * 1.35, rad, rot, a0, a0 + 4.4);
      g.stroke();
      g.strokeStyle = `rgba(255,248,236,${0.12 * (1 - k / (rings + 2))})`;
      g.beginPath();
      g.ellipse(cx - 0.6, cy - 0.6, rad * 1.35, rad, rot, a0, a0 + 4.4);
      g.stroke();
    }
  }
  // Pocks: a dark dent with a lit lower lip.
  const pocks = 3 + Math.floor(hash(seed, 40) * 4);
  for (let p = 0; p < pocks; p++) {
    const a = hash(seed, 50 + p) * 6.28;
    const d = Math.sqrt(hash(seed, 60 + p)) * r * 0.8;
    const pr = r * (0.025 + hash(seed, 70 + p) * 0.03);
    const x = Math.cos(a) * d;
    const y = Math.sin(a) * d;
    g.fillStyle = rgba(deep, 0.28);
    g.beginPath();
    g.ellipse(x, y, pr * 1.2, pr, a, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "rgba(255,250,240,0.25)";
    g.beginPath();
    g.ellipse(x + pr * 0.3, y + pr * 0.45, pr * 0.9, pr * 0.5, a, 0, Math.PI * 2);
    g.fill();
  }
  // One light over every feature, so icing and chips sit in the same light as the body.
  const lg = g.createRadialGradient(-r * 0.5, -r * 0.55, 0, -r * 0.2, -r * 0.2, r * 1.5);
  lg.addColorStop(0, "rgba(255,250,240,0.3)");
  lg.addColorStop(0.38, "rgba(255,250,240,0)");
  lg.addColorStop(0.66, "rgba(50,24,14,0)");
  lg.addColorStop(1, "rgba(50,24,14,0.26)");
  g.fillStyle = lg;
  g.fillRect(-r * 1.6, -r * 1.6, r * 3.2, r * 3.2);
  // Warm bounce light along the bottom edge.
  g.strokeStyle = "rgba(255,226,180,0.22)";
  g.lineWidth = r * 0.12;
  g.beginPath();
  g.arc(0, 0, r * 0.98, Math.PI * 0.2, Math.PI * 0.8);
  g.stroke();
  g.restore();
  // The edge: a darker rim so a piece reads against its neighbours.
  path();
  g.lineWidth = Math.max(1, r * 0.04);
  g.strokeStyle = rgba(deep, 0.75);
  g.stroke();
  // A soft specular sheen (clay is matte; the sugar pearl is glossy).
  const spec = o.spec ?? 0.32;
  const sg = g.createRadialGradient(-r * 0.4, -r * 0.48, 0, -r * 0.4, -r * 0.48, r * 0.3);
  sg.addColorStop(0, `rgba(255,255,255,${spec})`);
  sg.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = sg;
  g.beginPath();
  g.ellipse(-r * 0.4, -r * 0.48, r * 0.3, r * 0.2, -0.6, 0, Math.PI * 2);
  g.fill();
}

// ------------------------------------------------------------------------------------------------------------------
// Faces
// ------------------------------------------------------------------------------------------------------------------

/** Where a tier's eyes sit (in units of its radius), how big they are, and its resting look. */
export interface FaceSpec {
  ey: number;
  ex: number;
  er: number;
  sleepy: boolean;
}

export const FACES: readonly FaceSpec[] = [
  { ey: -0.02, ex: 0.32, er: 0.13, sleepy: false },
  { ey: 0.02, ex: 0.3, er: 0.11, sleepy: false },
  { ey: -0.06, ex: 0.3, er: 0.095, sleepy: false },
  { ey: 0.36, ex: 0.3, er: 0.085, sleepy: false },
  { ey: -0.04, ex: 0.3, er: 0.08, sleepy: true },
  { ey: -0.44, ex: 0.27, er: 0.075, sleepy: false },
  { ey: -0.22, ex: 0.25, er: 0.07, sleepy: false },
  { ey: -0.06, ex: 0.22, er: 0.062, sleepy: false },
  { ey: 0.16, ex: 0.25, er: 0.058, sleepy: false },
];

function mouth(g: CanvasRenderingContext2D, r: number, kind: "smile" | "open" | "grin" | "o" | "cat" | "big" | "laugh", y: number, w: number): void {
  g.strokeStyle = PAL.ink;
  g.fillStyle = PAL.ink;
  g.lineWidth = Math.max(1.2, r * 0.055);
  const hw = w * r;
  const yy = y * r;
  switch (kind) {
    case "smile":
      g.beginPath();
      g.arc(0, yy - hw * 0.6, hw, Math.PI * 0.22, Math.PI * 0.78);
      g.stroke();
      break;
    case "grin":
      g.beginPath();
      g.moveTo(-hw, yy - hw * 0.15);
      g.quadraticCurveTo(0, yy + hw * 0.9, hw, yy - hw * 0.15);
      g.stroke();
      break;
    case "o":
      g.beginPath();
      g.ellipse(0, yy, hw * 0.45, hw * 0.55, 0, 0, Math.PI * 2);
      g.fill();
      break;
    case "cat":
      g.beginPath();
      g.arc(-hw * 0.5, yy, hw * 0.5, 0.15, Math.PI - 0.15);
      g.arc(hw * 0.5, yy, hw * 0.5, 0.15, Math.PI - 0.15);
      g.stroke();
      break;
    case "open":
    case "big":
    case "laugh": {
      g.beginPath();
      g.moveTo(-hw, yy);
      g.quadraticCurveTo(0, yy + hw * (kind === "open" ? 1.1 : 1.45), hw, yy);
      g.closePath();
      g.fill();
      // A pink tongue.
      g.save();
      g.clip();
      g.fillStyle = "#E77A88";
      g.beginPath();
      g.ellipse(0, yy + hw * (kind === "open" ? 0.75 : 1.0), hw * 0.55, hw * 0.4, 0, 0, Math.PI * 2);
      g.fill();
      g.restore();
      break;
    }
  }
}

function cheeks(g: CanvasRenderingContext2D, r: number, y: number, x: number, a = 0.4): void {
  g.fillStyle = rgba(PAL.blush, a);
  for (const s of [-1, 1]) {
    g.beginPath();
    g.ellipse(s * x * r, y * r, r * 0.11, r * 0.065, 0, 0, Math.PI * 2);
    g.fill();
  }
}

export interface Look {
  /** -1..1 where the eyes point. */
  x: number;
  y: number;
  /** 0 open … 1 shut. */
  blink: number;
  mood: "plain" | "happy" | "worried" | "squeeze";
}

/** Bead eyes in the piece's own frame (origin at its centre). Sizes in CSS px. */
export function drawEyes(g: CanvasRenderingContext2D, tier: number, r: number, look: Look, lid: string): void {
  const f = FACES[tier]!;
  const er = Math.max(2.1, f.er * r);
  const ex = f.ex * r;
  const ey = f.ey * r;
  if (look.mood === "happy" || look.mood === "squeeze") {
    g.strokeStyle = PAL.ink;
    g.lineWidth = Math.max(1.3, er * 0.55);
    for (const s of [-1, 1]) {
      g.beginPath();
      if (look.mood === "happy") g.arc(s * ex, ey + er * 0.35, er * 0.95, Math.PI * 1.15, Math.PI * 1.85);
      else {
        g.moveTo(s * ex - er * s, ey - er * 0.7);
        g.lineTo(s * ex + er * 0.6 * s, ey);
        g.lineTo(s * ex - er * s, ey + er * 0.7);
      }
      g.stroke();
    }
    return;
  }
  const worried = look.mood === "worried";
  const big = worried ? 1.25 : 1;
  const dx = look.x * er * 0.45;
  const dy = look.y * er * 0.35;
  const open = 1 - look.blink * 0.88;
  for (const s of [-1, 1]) {
    const x = s * ex + dx;
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
    if (f.sleepy && !worried && look.blink < 0.5) {
      // Heavy lids, half down.
      g.fillStyle = lid;
      g.beginPath();
      g.ellipse(x, y - er * 0.55, er * 1.35, er * 0.9, 0, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = PAL.ink;
      g.lineWidth = Math.max(1, er * 0.35);
      g.beginPath();
      g.moveTo(x - er * 1.05, y + er * 0.12);
      g.lineTo(x + er * 1.05, y + er * 0.12);
      g.stroke();
    }
    if (worried) {
      g.strokeStyle = PAL.ink;
      g.lineWidth = Math.max(1.2, er * 0.45);
      g.beginPath();
      // Worried: the inner ends of the brows go up.
      g.moveTo(x - er * 1.1 * s, y - er * 2.5);
      g.lineTo(x + er * 0.9 * s, y - er * 1.9);
      g.stroke();
    }
  }
}

// ------------------------------------------------------------------------------------------------------------------
// The nine bakes
// ------------------------------------------------------------------------------------------------------------------

export interface PieceArt {
  body: Sprite;
  /** Colour of the eyelids (the face's clay). */
  lid: string;
  /** Radius it was sculpted at (CSS px). */
  r: number;
}

const SPRINKLES = ["#FBF1DE", "#9EC7EC", "#9CC98A", "#F6D98B", "#C4AEE8", "#F4AFC0"];

function sprinkles(g: CanvasRenderingContext2D, r: number, seed: number, n: number, inY: (y: number) => boolean, spread = 0.8): void {
  for (let k = 0; k < n; k++) {
    const a = hash(seed, 100 + k) * 6.28;
    const d = Math.sqrt(hash(seed, 200 + k)) * r * spread;
    const x = Math.cos(a) * d;
    const y = Math.sin(a) * d;
    if (!inY(y)) continue;
    const rot = hash(seed, 300 + k) * Math.PI;
    const len = r * 0.11;
    const w = Math.max(1.2, r * 0.045);
    g.strokeStyle = SPRINKLES[k % SPRINKLES.length]!;
    g.lineWidth = w;
    g.beginPath();
    g.moveTo(x - Math.cos(rot) * len * 0.5, y - Math.sin(rot) * len * 0.5);
    g.lineTo(x + Math.cos(rot) * len * 0.5, y + Math.sin(rot) * len * 0.5);
    g.stroke();
  }
}

/** Draws one bake, centred, radius `r` CSS px. */
function drawBake(g: CanvasRenderingContext2D, tier: number, r: number, seed: number): void {
  const t = TIERS[tier]!;
  switch (t.name) {
    case "pearl": {
      const path = () => lumpPath(g, r, seed, 0.012);
      clayBase(g, r, t.body, t.deep, t.hi, path);
      clayFinish(g, r, t.deep, seed, path, { spec: 0.85, prints: 0 });
      cheeks(g, r, 0.26, 0.5, 0.35);
      mouth(g, r, "smile", 0.36, 0.17);
      break;
    }
    case "gumdrop": {
      const path = () => lumpPath(g, r, seed, 0.02, 1.02, 0.98, r * 0.02);
      clayBase(g, r, t.body, t.deep, t.hi, path);
      clayFinish(g, r, t.deep, seed, path, { spec: 0.4 });
      // Sugar crystals.
      g.save();
      path();
      g.clip();
      for (let k = 0; k < 26; k++) {
        const a = hash(seed, 400 + k) * 6.28;
        const d = Math.sqrt(hash(seed, 500 + k)) * r * 0.92;
        const s = Math.max(1, r * (0.04 + hash(seed, 600 + k) * 0.04));
        const x = Math.cos(a) * d;
        const y = Math.sin(a) * d;
        if (Math.abs(y - 0.18 * r) < r * 0.22 && Math.abs(x) < r * 0.5) continue;
        g.fillStyle = k % 3 ? "rgba(255,255,255,0.75)" : rgba(t.hi, 0.9);
        g.save();
        g.translate(x, y);
        g.rotate(a);
        g.fillRect(-s / 2, -s / 2, s, s);
        g.restore();
      }
      g.restore();
      cheeks(g, r, 0.24, 0.5, 0.35);
      mouth(g, r, "open", 0.3, 0.17);
      break;
    }
    case "cookie": {
      const path = () => lumpPath(g, r, seed, 0.05, 1, 1, 0, 11);
      clayBase(g, r, t.body, t.deep, t.hi, path);
      g.save();
      path();
      g.clip();
      // Baked cracks.
      g.strokeStyle = rgba(t.deep, 0.55);
      g.lineWidth = Math.max(1, r * 0.035);
      for (let k = 0; k < 5; k++) {
        const a = hash(seed, 700 + k) * 6.28;
        const d = r * (0.45 + hash(seed, 710 + k) * 0.4);
        const x = Math.cos(a) * d;
        const y = Math.sin(a) * d;
        g.beginPath();
        g.moveTo(x, y);
        g.quadraticCurveTo(x + r * 0.12, y + r * 0.05, x + r * 0.2 * Math.cos(a + 1.4), y + r * 0.2 * Math.sin(a + 1.4));
        g.stroke();
      }
      // Chocolate chips, kept off the face.
      const spots: Array<[number, number]> = [[-0.55, -0.45], [0.18, -0.62], [0.62, -0.18], [-0.68, 0.22], [0.58, 0.5], [-0.25, 0.68], [0.05, -0.32]];
      spots.forEach(([cx, cy], k) => {
        const cr = r * (0.11 + hash(seed, 720 + k) * 0.05);
        g.fillStyle = "#5C3424";
        g.save();
        g.translate(cx * r, cy * r);
        lumpPath(g, cr, seed + k * 13, 0.12);
        g.fill();
        g.fillStyle = "rgba(255,230,210,0.35)";
        g.beginPath();
        g.arc(-cr * 0.3, -cr * 0.35, cr * 0.3, 0, Math.PI * 2);
        g.fill();
        g.restore();
      });
      g.restore();
      clayFinish(g, r, t.deep, seed, path, { spec: 0.25 });
      cheeks(g, r, 0.22, 0.52, 0.3);
      mouth(g, r, "grin", 0.3, 0.3);
      break;
    }
    case "donut": {
      const dough = "#E3AE6E";
      const path = () => lumpPath(g, r, seed, 0.02);
      clayBase(g, r, dough, "#C2894A", "#F5CF96", path);
      // Icing: a wavy pink blob with drips.
      const icing = () => {
        g.beginPath();
        const n = 64;
        for (let k = 0; k <= n; k++) {
          const a = (k / n) * Math.PI * 2;
          const drip = Math.max(0, Math.sin(a * 4 + seed)) ** 6 * 0.13 * (Math.sin(a) > 0 ? 1 : 0.3);
          const rr = r * (0.8 + 0.035 * Math.sin(a * 9 + seed) + drip);
          const x = Math.cos(a) * rr;
          const y = Math.sin(a) * rr - r * 0.05;
          if (k === 0) g.moveTo(x, y);
          else g.lineTo(x, y);
        }
        g.closePath();
      };
      icing();
      const ig = g.createRadialGradient(-r * 0.35, -r * 0.45, r * 0.05, 0, 0, r * 1.1);
      ig.addColorStop(0, t.hi);
      ig.addColorStop(0.5, t.body);
      ig.addColorStop(1, t.deep);
      g.fillStyle = ig;
      g.fill();
      g.strokeStyle = rgba(t.deep, 0.6);
      g.lineWidth = Math.max(1, r * 0.03);
      g.stroke();
      sprinkles(g, r, seed, 16, (y) => y < r * 0.2, 0.72);
      clayFinish(g, r, "#B57A40", seed, path, { spec: 0.4 });
      // The hole goes right through: whatever is behind shows.
      const hy = -r * 0.1;
      const hr = r * 0.24;
      g.save();
      g.globalCompositeOperation = "destination-out";
      g.beginPath();
      g.ellipse(0, hy, hr, hr * 0.9, 0, 0, Math.PI * 2);
      g.fill();
      g.restore();
      g.strokeStyle = "rgba(120,60,40,0.45)";
      g.lineWidth = Math.max(1.2, r * 0.06);
      g.beginPath();
      g.ellipse(0, hy, hr, hr * 0.9, 0, Math.PI * 1.05, Math.PI * 1.95);
      g.stroke();
      g.strokeStyle = "rgba(255,235,220,0.5)";
      g.lineWidth = Math.max(1, r * 0.04);
      g.beginPath();
      g.ellipse(0, hy, hr, hr * 0.9, 0, Math.PI * 0.15, Math.PI * 0.85);
      g.stroke();
      cheeks(g, r, 0.48, 0.52, 0.3);
      mouth(g, r, "o", 0.6, 0.15);
      break;
    }
    case "truffle": {
      const path = () => lumpPath(g, r, seed, 0.03);
      clayBase(g, r, t.body, t.deep, t.hi, path);
      g.save();
      path();
      g.clip();
      // Cocoa dust.
      for (let k = 0; k < 60; k++) {
        const a = hash(seed, 800 + k) * 6.28;
        const d = Math.sqrt(hash(seed, 900 + k)) * r;
        g.fillStyle = `rgba(214,170,140,${0.12 + hash(seed, 950 + k) * 0.2})`;
        g.beginPath();
        g.arc(Math.cos(a) * d, Math.sin(a) * d, Math.max(0.6, r * 0.018), 0, Math.PI * 2);
        g.fill();
      }
      // A drizzle across the top.
      g.strokeStyle = "#B8876A";
      g.lineWidth = Math.max(1.5, r * 0.06);
      g.beginPath();
      for (let k = 0; k <= 7; k++) {
        const x = -r * 0.85 + (k / 7) * r * 1.7;
        const y = -r * 0.55 + (k % 2 ? -r * 0.12 : r * 0.1) + Math.abs(x) * 0.25;
        if (k === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
      g.strokeStyle = "rgba(255,230,210,0.35)";
      g.lineWidth = Math.max(0.8, r * 0.02);
      g.stroke();
      g.restore();
      clayFinish(g, r, t.deep, seed, path, { spec: 0.22 });
      cheeks(g, r, 0.22, 0.5, 0.28);
      mouth(g, r, "smile", 0.34, 0.2);
      break;
    }
    case "macaron": {
      const path = () => lumpPath(g, r, seed, 0.02, 1.02, 0.97);
      clayBase(g, r, t.body, t.deep, t.hi, path);
      g.save();
      path();
      g.clip();
      // The filling, and the ruffled feet on both shells.
      const y0 = r * 0.02;
      const y1 = r * 0.24;
      g.fillStyle = "#FFF1DC";
      g.beginPath();
      g.moveTo(-r * 1.2, y0);
      for (let x = -r * 1.2; x <= r * 1.2; x += r * 0.1) g.lineTo(x, y0 + Math.sin(x * 9 / r + seed) * r * 0.02);
      g.lineTo(r * 1.2, y1);
      for (let x = r * 1.2; x >= -r * 1.2; x -= r * 0.1) g.lineTo(x, y1 + Math.sin(x * 7 / r + seed) * r * 0.02);
      g.closePath();
      g.fill();
      g.fillStyle = "rgba(200,160,120,0.25)";
      g.fillRect(-r * 1.2, y1 - r * 0.05, r * 2.4, r * 0.05);
      g.fillStyle = t.deep;
      for (let x = -r * 1.1; x <= r * 1.1; x += r * 0.13) {
        g.beginPath();
        g.arc(x + hash(seed, Math.round(x)) * 2, y0 - r * 0.03, r * 0.045, 0, Math.PI * 2);
        g.arc(x + 3, y1 + r * 0.035, r * 0.045, 0, Math.PI * 2);
        g.fill();
      }
      g.restore();
      clayFinish(g, r, t.deep, seed, path, { spec: 0.35 });
      cheeks(g, r, -0.26, 0.52, 0.35);
      mouth(g, r, "cat", -0.24, 0.1);
      break;
    }
    case "cupcake": {
      const path = () => lumpPath(g, r, seed, 0.022);
      clayBase(g, r, t.body, t.deep, t.hi, path);
      g.save();
      path();
      g.clip();
      // The pleated wrapper on the lower part.
      const wy = r * 0.2;
      g.fillStyle = PAL.butter;
      g.fillRect(-r * 1.2, wy, r * 2.4, r * 1.2);
      for (let k = -6; k <= 6; k++) {
        g.strokeStyle = k % 2 ? rgba(PAL.butterDeep, 0.8) : "rgba(255,248,220,0.7)";
        g.lineWidth = Math.max(1.2, r * 0.06);
        g.beginPath();
        g.moveTo(k * r * 0.18, wy);
        g.lineTo(k * r * 0.12, r * 1.2);
        g.stroke();
      }
      // Frosting overhang: a wavy edge over the wrapper, then piped swirls.
      g.fillStyle = t.body;
      g.beginPath();
      g.moveTo(-r * 1.2, wy - r * 0.2);
      for (let x = -r * 1.2; x <= r * 1.2; x += r * 0.05) g.lineTo(x, wy + r * 0.05 + Math.abs(Math.sin(x * 4.5 / r + seed)) * r * 0.1);
      g.lineTo(r * 1.2, -r * 1.3);
      g.lineTo(-r * 1.2, -r * 1.3);
      g.closePath();
      g.fill();
      g.strokeStyle = rgba(t.deep, 0.7);
      g.lineWidth = Math.max(1.4, r * 0.045);
      for (const [yy, ww] of [[-0.5, 0.62], [-0.02, 0.92]] as const) {
        g.beginPath();
        g.ellipse(0, yy * r, ww * r, r * 0.22, 0, Math.PI * 0.08, Math.PI * 0.92);
        g.stroke();
      }
      g.restore();
      sprinkles(g, r, seed, 14, (y) => y < -r * 0.45, 0.85);
      clayFinish(g, r, t.deep, seed, path, { spec: 0.35 });
      cheeks(g, r, -0.06, 0.48, 0.35);
      mouth(g, r, "big", -0.08, 0.15);
      break;
    }
    case "pie": {
      const path = () => lumpPath(g, r, seed, 0.035, 1, 1, 0, 18);
      clayBase(g, r, t.body, t.deep, t.hi, path);
      const fr = r * 0.72;
      // Jammy filling under a woven lattice.
      g.fillStyle = "#A9475F";
      g.beginPath();
      g.arc(0, 0, fr, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = "rgba(90,30,40,0.5)";
      g.lineWidth = Math.max(1.2, r * 0.03);
      g.stroke();
      g.save();
      g.beginPath();
      g.arc(0, 0, fr, 0, Math.PI * 2);
      g.clip();
      const sw = r * 0.17;
      const strip = (x: number, y: number, w: number, h: number) => {
        g.fillStyle = t.body;
        g.fillRect(x, y, w, h);
        g.fillStyle = rgba(t.hi, 0.6);
        if (w > h) g.fillRect(x, y, w, h * 0.3);
        else g.fillRect(x, y, w * 0.3, h);
        g.strokeStyle = rgba(t.deep, 0.8);
        g.lineWidth = Math.max(1, r * 0.022);
        g.strokeRect(x, y, w, h);
      };
      const lines = [-0.46, 0, 0.46];
      for (const ly of lines) strip(-fr, ly * r - sw / 2, fr * 2, sw);
      // Vertical strips go over and under alternately.
      lines.forEach((lx, a) => {
        lines.forEach((ly, b) => {
          const over = (a + b) % 2 === 0;
          const y0 = (b === 0 ? -fr : (lines[b - 1]! + ly) / 2 * r);
          const y1 = (b === lines.length - 1 ? fr : (ly + lines[b + 1]!) / 2 * r);
          if (over) strip(lx * r - sw / 2, y0, sw, y1 - y0);
          else {
            strip(lx * r - sw / 2, y0, sw, ly * r - sw / 2 - y0);
            strip(lx * r - sw / 2, ly * r + sw / 2, sw, y1 - ly * r - sw / 2);
          }
        });
      });
      g.restore();
      // Crimp marks around the crust.
      g.strokeStyle = rgba(t.deep, 0.7);
      g.lineWidth = Math.max(1, r * 0.025);
      for (let k = 0; k < 18; k++) {
        const a = (k / 18) * Math.PI * 2 + 0.17;
        g.beginPath();
        g.moveTo(Math.cos(a) * r * 0.78, Math.sin(a) * r * 0.78);
        g.lineTo(Math.cos(a) * r * 0.92, Math.sin(a) * r * 0.92);
        g.stroke();
      }
      clayFinish(g, r, t.deep, seed, path, { spec: 0.3, prints: 2 });
      // A clay plate for the face, pressed onto the lattice.
      g.fillStyle = PAL.cream;
      g.beginPath();
      g.ellipse(0, r * 0.04, r * 0.4, r * 0.3, 0, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = rgba(PAL.creamDeep, 1);
      g.lineWidth = Math.max(1, r * 0.025);
      g.stroke();
      cheeks(g, r, 0.12, 0.27, 0.45);
      mouth(g, r, "smile", 0.2, 0.12);
      break;
    }
    case "cake": {
      const path = () => lumpPath(g, r, seed, 0.018);
      clayBase(g, r, t.body, t.deep, t.hi, path);
      g.save();
      path();
      g.clip();
      // Cream poured over the top, running down in rounded drips.
      const y0 = -r * 0.44;
      g.fillStyle = "#FFF4E8";
      g.fillRect(-r * 1.2, -r * 1.3, r * 2.4, r * 1.3 + y0);
      for (let k = 0; k < 9; k++) {
        const x = -r * 0.95 + (k / 8) * r * 1.9 + (hash(seed, 1000 + k) - 0.5) * r * 0.08;
        const dw = r * (0.16 + hash(seed, 1050 + k) * 0.08);
        const len = r * (0.06 + hash(seed, 1100 + k) ** 1.5 * 0.34);
        g.beginPath();
        g.roundRect(x - dw / 2, y0 - dw, dw, len + dw * 1.5, dw / 2);
        g.fill();
      }
      g.restore();
      sprinkles(g, r, seed, 18, (y) => y < -r * 0.45, 0.95);
      // A ring of piped dots around the middle.
      for (let k = 0; k < 9; k++) {
        const x = -r * 0.66 + (k / 8) * r * 1.32;
        const y = r * 0.8 - Math.cos((x / r) * 1.4) * r * 0.06;
        if (Math.abs(x) > Math.sqrt(Math.max(0, r * r - y * y)) * 0.95) continue;
        g.fillStyle = "#FFF4E8";
        g.beginPath();
        g.arc(x, y, r * 0.07, 0, Math.PI * 2);
        g.fill();
      }
      clayFinish(g, r, t.deep, seed, path, { spec: 0.4, prints: 2 });
      // The candle.
      const cw = r * 0.13;
      const ch = r * 0.42;
      const cy = -r * 0.92;
      g.fillStyle = PAL.cream;
      g.fillRect(-cw / 2, cy - ch, cw, ch);
      g.fillStyle = PAL.powder;
      for (let k = 0; k < 4; k++) {
        g.beginPath();
        g.moveTo(-cw / 2, cy - ch * (0.12 + k * 0.24));
        g.lineTo(cw / 2, cy - ch * (0.02 + k * 0.24));
        g.lineTo(cw / 2, cy - ch * (0.1 + k * 0.24));
        g.lineTo(-cw / 2, cy - ch * (0.2 + k * 0.24));
        g.fill();
      }
      g.strokeStyle = rgba(PAL.creamDeep, 1);
      g.lineWidth = Math.max(1, r * 0.02);
      g.strokeRect(-cw / 2, cy - ch, cw, ch);
      g.strokeStyle = PAL.ink;
      g.lineWidth = Math.max(1, r * 0.025);
      g.beginPath();
      g.moveTo(0, cy - ch);
      g.lineTo(0, cy - ch - r * 0.07);
      g.stroke();
      cheeks(g, r, 0.3, 0.48, 0.4);
      mouth(g, r, "laugh", 0.34, 0.13);
      break;
    }
  }
}

/** One bake at radius `r` CSS px, rendered at `k` pixels per CSS px. */
export function makePiece(tier: number, r: number, k: number): PieceArt {
  const box = r * 3.1;
  const body = makeSprite(box, box, box / 2, box / 2 + r * 0.08, k, (g) => drawBake(g, tier, r, 11 + tier * 37));
  return { body, lid: tier === 3 ? "#F29A8C" : TIERS[tier]!.body, r };
}

/** All nine bakes at their tin size (`s` CSS px per tin unit). */
export function makePieces(s: number, k: number): PieceArt[] {
  return TIERS.map((t, tier) => makePiece(tier, t.r * s, k));
}

/** Small copies for the HUD, all about the same size (`px` for the smallest, growing a little with the tier). */
export function makeIcons(px: number, grow: number, k: number): PieceArt[] {
  return TIERS.map((_, tier) => makePiece(tier, px + tier * grow, k));
}

/** The candle's flame, drawn live (it sways). */
export function drawFlame(g: CanvasRenderingContext2D, r: number, sway: number, glow: number): void {
  const x = 0;
  const y = -r * 0.92 - r * 0.42 - r * 0.1;
  const fh = r * 0.2;
  for (let k = 3; k >= 1; k--) {
    g.fillStyle = `rgba(255,226,150,${0.12 * glow})`;
    g.beginPath();
    g.arc(x, y - fh * 0.3, r * 0.06 * k + r * 0.03, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = "#FFB347";
  g.beginPath();
  g.moveTo(x - r * 0.06, y + fh * 0.2);
  g.quadraticCurveTo(x - r * 0.07, y - fh * 0.5, x + sway * r * 0.05, y - fh);
  g.quadraticCurveTo(x + r * 0.07, y - fh * 0.5, x + r * 0.06, y + fh * 0.2);
  g.closePath();
  g.fill();
  g.fillStyle = "#FFF1B8";
  g.beginPath();
  g.ellipse(x, y, r * 0.025, r * 0.05, 0, 0, Math.PI * 2);
  g.fill();
}

// ------------------------------------------------------------------------------------------------------------------
// The stage: studio wall, counter, tin and parchment (static, one blit per frame)
// ------------------------------------------------------------------------------------------------------------------

export function makeStage(L: Layout, k: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = Math.ceil(L.W * k);
  c.height = Math.ceil(L.H * k);
  const g = c.getContext("2d")!;
  g.scale(k, k);
  g.lineCap = "round";
  g.lineJoin = "round";
  const { W, H, s, tx, ty, wall } = L;
  const tw = TIN_W * s;
  const rimY = ty - RIM * s;
  const counterY = ty + wall * 0.6;

  // The wall: warm plaster lit from the upper left.
  const wg = g.createLinearGradient(0, 0, 0, counterY);
  wg.addColorStop(0, PAL.wallHi);
  wg.addColorStop(0.55, PAL.wall);
  wg.addColorStop(1, PAL.wallDeep);
  g.fillStyle = wg;
  g.fillRect(0, 0, W, counterY);
  const key = g.createRadialGradient(W * 0.15, H * 0.1, 0, W * 0.15, H * 0.1, H * 0.7);
  key.addColorStop(0, "rgba(255,246,232,0.55)");
  key.addColorStop(1, "rgba(255,246,232,0)");
  g.fillStyle = key;
  g.fillRect(0, 0, W, counterY);
  // Big soft thumb smears in the plaster.
  for (let p = 0; p < 7; p++) {
    const x = hash(p, 5) * W;
    const y = hash(p, 6) * counterY;
    const rr = 26 + hash(p, 7) * 40;
    for (let ring = 1; ring <= 5; ring++) {
      g.strokeStyle = `rgba(170,120,90,${0.05 - ring * 0.006})`;
      g.lineWidth = 1.2;
      g.beginPath();
      g.ellipse(x, y, rr * ring * 0.2 * 1.3, rr * ring * 0.2, hash(p, 8) * 3, 0, Math.PI * 1.6);
      g.stroke();
    }
  }
  // Felt fibres: the studio backdrop is a big sheet of warm felt.
  for (let p = 0; p < 900; p++) {
    const x = hash(p, 31) * W;
    const y = hash(p, 32) * counterY;
    const a = hash(p, 33) * Math.PI;
    const l = 2 + hash(p, 34) * 5;
    g.strokeStyle = hash(p, 35) < 0.5 ? "rgba(150,100,70,0.07)" : "rgba(255,250,240,0.22)";
    g.lineWidth = 0.8;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
    g.stroke();
  }
  const vig = g.createRadialGradient(W / 2, H * 0.45, Math.min(W, H) * 0.35, W / 2, H * 0.45, Math.max(W, H) * 0.8);
  vig.addColorStop(0, "rgba(90,50,30,0)");
  vig.addColorStop(1, "rgba(90,50,30,0.22)");
  g.fillStyle = vig;
  g.fillRect(0, 0, W, H);

  // The counter.
  const cg = g.createLinearGradient(0, counterY, 0, H);
  cg.addColorStop(0, PAL.counterHi);
  cg.addColorStop(0.18, PAL.counter);
  cg.addColorStop(1, PAL.counterDeep);
  g.fillStyle = cg;
  g.fillRect(0, counterY, W, H - counterY);
  g.fillStyle = "rgba(255,240,220,0.5)";
  g.fillRect(0, counterY, W, 2);
  // Flour dusted on the counter.
  for (let p = 0; p < 70; p++) {
    const x = hash(p, 11) * W;
    const y = counterY + 6 + hash(p, 12) * (H - counterY - 8);
    g.fillStyle = `rgba(255,250,240,${0.08 + hash(p, 13) * 0.2})`;
    g.beginPath();
    g.arc(x, y, 0.8 + hash(p, 14) * 2.2, 0, Math.PI * 2);
    g.fill();
  }

  // The tin's shadow on the counter, then the tin: enamel walls with a blue rim, a deep inside.
  const sh = g.createRadialGradient(W / 2, counterY + 4, tw * 0.2, W / 2, counterY + 4, tw * 0.75);
  sh.addColorStop(0, "rgba(60,30,20,0.35)");
  sh.addColorStop(1, "rgba(60,30,20,0)");
  g.fillStyle = sh;
  g.beginPath();
  g.ellipse(W / 2, counterY + 6, tw * 0.75, wall * 1.6 + 10, 0, 0, Math.PI * 2);
  g.fill();

  // The parchment liner sticking up out of the tin at the back, softly crumpled.
  const holdY = ty - HOLD_Y * s;
  const py0 = holdY - s * 0.95;
  const paper = () => {
    g.beginPath();
    g.moveTo(tx - wall * 0.1, rimY + s * 0.3);
    g.lineTo(tx - wall * 0.1, py0 + 6);
    const n = 7;
    for (let i = 0; i < n; i++) {
      const x0 = tx - wall * 0.1 + ((tw + wall * 0.2) * i) / n;
      const x1 = tx - wall * 0.1 + ((tw + wall * 0.2) * (i + 1)) / n;
      g.quadraticCurveTo((x0 + x1) / 2, py0 - 5 + hash(i, 61) * 8, x1, py0 + 4 + hash(i, 62) * 6);
    }
    g.lineTo(tx + tw + wall * 0.1, rimY + s * 0.3);
    g.closePath();
  };
  paper();
  const pg = g.createLinearGradient(0, py0, 0, rimY);
  pg.addColorStop(0, "#FFFAF0");
  pg.addColorStop(1, "#EADCC2");
  g.fillStyle = pg;
  g.fill();
  g.strokeStyle = rgba(PAL.paperDeep, 1);
  g.lineWidth = 1.5;
  g.stroke();
  g.save();
  paper();
  g.clip();
  // Crumples: soft light and shade facets.
  for (let i = 0; i < 9; i++) {
    const x = tx + hash(i, 63) * tw;
    const w2 = s * (0.8 + hash(i, 64) * 1.4);
    const sg = g.createLinearGradient(x - w2, 0, x + w2, 0);
    sg.addColorStop(0, "rgba(190,160,120,0)");
    sg.addColorStop(0.5, hash(i, 65) < 0.5 ? "rgba(190,160,120,0.18)" : "rgba(255,255,255,0.45)");
    sg.addColorStop(1, "rgba(190,160,120,0)");
    g.fillStyle = sg;
    g.fillRect(x - w2, py0 - 10, w2 * 2, rimY - py0 + 20);
  }
  g.restore();

  // Inside of the tin: speckled blue enamel, shaded under the rim and into the corners.
  const ig = g.createLinearGradient(0, rimY, 0, ty);
  ig.addColorStop(0, PAL.insideDeep);
  ig.addColorStop(0.3, PAL.inside);
  ig.addColorStop(1, PAL.insideHi);
  g.fillStyle = ig;
  g.fillRect(tx, rimY, tw, ty - rimY);
  // A glossy sheen down the back wall.
  const gl = g.createLinearGradient(tx + tw * 0.12, 0, tx + tw * 0.32, 0);
  gl.addColorStop(0, "rgba(255,255,255,0)");
  gl.addColorStop(0.5, "rgba(255,255,255,0.1)");
  gl.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = gl;
  g.fillRect(tx + tw * 0.12, rimY, tw * 0.2, ty - rimY);
  for (const [x0, x1] of [[tx, tx + s * 1.1], [tx + tw, tx + tw - s * 1.1]] as const) {
    const sg = g.createLinearGradient(x0, 0, x1, 0);
    sg.addColorStop(0, "rgba(30,40,64,0.3)");
    sg.addColorStop(1, "rgba(30,40,64,0)");
    g.fillStyle = sg;
    g.fillRect(Math.min(x0, x1), rimY, s * 1.1, ty - rimY);
  }
  const rg = g.createLinearGradient(0, rimY, 0, rimY + s * 1.4);
  rg.addColorStop(0, "rgba(24,32,52,0.35)");
  rg.addColorStop(1, "rgba(24,32,52,0)");
  g.fillStyle = rg;
  g.fillRect(tx, rimY, tw, s * 1.4);
  // Graniteware speckles: pale and dark.
  for (let p = 0; p < 160; p++) {
    const light = hash(p, 25) < 0.6;
    g.fillStyle = light ? `rgba(240,246,252,${0.12 + hash(p, 21) * 0.18})` : `rgba(36,52,80,${0.1 + hash(p, 21) * 0.15})`;
    g.beginPath();
    g.arc(tx + hash(p, 22) * tw, rimY + hash(p, 23) * (ty - rimY), 0.6 + hash(p, 24) * 1.5, 0, Math.PI * 2);
    g.fill();
  }

  // The back rim: the tin's far edge, a rolled blue band right across. This is the line the pile must stay under.
  g.beginPath();
  g.roundRect(tx - 2, rimY - s * 0.1, tw + 4, s * 0.22, s * 0.11);
  const br = g.createLinearGradient(0, rimY - s * 0.1, 0, rimY + s * 0.12);
  br.addColorStop(0, PAL.rimHi);
  br.addColorStop(1, PAL.rim);
  g.fillStyle = br;
  g.fill();

  // The walls and floor of the tin: cream enamel, rounded.
  const enamel = (x: number, y: number, w: number, h: number, rad: number) => {
    g.beginPath();
    g.roundRect(x, y, w, h, rad);
    const eg = g.createLinearGradient(x, 0, x + w, 0);
    eg.addColorStop(0, PAL.enamelDeep);
    eg.addColorStop(0.35, PAL.enamel);
    eg.addColorStop(1, PAL.enamelDeep);
    g.fillStyle = eg;
    g.fill();
    g.strokeStyle = rgba("#A8957C", 0.8);
    g.lineWidth = 1.5;
    g.stroke();
  };
  enamel(tx - wall, rimY - s * 0.05, wall + 1, ty - rimY + wall + s * 0.05, wall * 0.5);
  enamel(tx + tw - 1, rimY - s * 0.05, wall + 1, ty - rimY + wall + s * 0.05, wall * 0.5);
  enamel(tx - wall, ty - 1, tw + wall * 2, wall + 1, wall * 0.5);
  // Rim caps: the rolled blue edge at the top of each wall.
  for (const x of [tx - wall, tx + tw - 1]) {
    g.beginPath();
    g.roundRect(x - 3, rimY - s * 0.16, wall + 7, s * 0.36, s * 0.18);
    const bg = g.createLinearGradient(0, rimY - s * 0.16, 0, rimY + s * 0.2);
    bg.addColorStop(0, PAL.rimHi);
    bg.addColorStop(1, PAL.rimDeep);
    g.fillStyle = bg;
    g.fill();
  }
  // A thin blue band low on the walls, as enamelware has.
  g.fillStyle = rgba(PAL.rim, 0.8);
  g.fillRect(tx - wall + 2, ty + wall * 0.35, tw + wall * 2 - 4, Math.max(2, wall * 0.18));
  return c;
}

/** The starter: a puffy dough sprite whose top is the surface. Two variants for a slow clay boil. */
export function makeStarter(L: Layout, k: number, variant: number): Sprite {
  const w = TIN_W * L.s;
  const h = (RIM + 1) * L.s;
  const bump = L.s * 0.32;
  return makeSprite(w, h + bump, 0, bump, k, (g) => {
    const top = () => {
      g.beginPath();
      g.moveTo(0, h);
      g.lineTo(0, bump * 0.2);
      const lobes = 7;
      for (let i = 0; i < lobes; i++) {
        const x0 = (w * i) / lobes;
        const x1 = (w * (i + 1)) / lobes;
        const up = bump * (0.6 + 0.4 * hash(i + variant * 31, 3));
        g.quadraticCurveTo((x0 + x1) / 2 + (hash(i, variant) - 0.5) * 6, -up, x1, bump * 0.15 * hash(i, 9 + variant));
      }
      g.lineTo(w, h);
      g.closePath();
    };
    top();
    const dg = g.createLinearGradient(0, -bump, 0, L.s * 5);
    dg.addColorStop(0, PAL.starterHi);
    dg.addColorStop(0.12, PAL.starter);
    dg.addColorStop(1, PAL.starterDeep);
    g.fillStyle = dg;
    g.fill();
    g.save();
    top();
    g.clip();
    // Folds where the starter was stirred and left to rise: soft darker curves with a lit edge.
    for (let p = 0; p < 9; p++) {
      const x = hash(p, 70 + variant) * w;
      const y = bump + L.s * 0.6 + hash(p, 71) * h;
      const fw = L.s * (0.8 + hash(p, 72) * 1.6);
      g.strokeStyle = "rgba(196,150,86,0.16)";
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(x - fw, y);
      g.quadraticCurveTo(x, y + L.s * (0.25 + hash(p, 73) * 0.3), x + fw, y - L.s * 0.05);
      g.stroke();
      g.strokeStyle = "rgba(255,246,222,0.3)";
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(x - fw * 0.9, y - 2.5);
      g.quadraticCurveTo(x, y + L.s * (0.25 + hash(p, 73) * 0.3) - 2.5, x + fw * 0.9, y - L.s * 0.05 - 2.5);
      g.stroke();
    }
    // Air bubbles through the dough, big and small.
    for (let p = 0; p < 110; p++) {
      const x = hash(p, 40 + variant) * w;
      const y = bump + hash(p, 41 + variant) * h;
      const br = L.s * (0.04 + hash(p, 42) ** 2.2 * 0.26);
      g.fillStyle = "rgba(190,150,90,0.35)";
      g.beginPath();
      g.ellipse(x, y, br, br * 0.8, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "rgba(255,248,226,0.6)";
      g.beginPath();
      g.ellipse(x + br * 0.2, y + br * 0.35, br * 0.7, br * 0.3, 0, 0, Math.PI * 2);
      g.fill();
    }
    // Flour dust and the thumb dents on the top.
    for (let p = 0; p < 40; p++) {
      g.fillStyle = `rgba(255,255,250,${0.3 + hash(p, 50) * 0.4})`;
      g.beginPath();
      g.arc(hash(p, 51 + variant) * w, hash(p, 52) * bump * 1.2, 0.8 + hash(p, 53) * 1.6, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
    top();
    g.strokeStyle = rgba(PAL.starterDeep, 0.9);
    g.lineWidth = 2;
    g.stroke();
  });
}

/**
 * The baker's hand, reaching down from above: a sleeve, a cuff, the arm and the palm with three curled knuckles
 * (thumb and index finger are drawn live, so they reach the piece whatever its size). Origin at the palm's centre.
 */
export function makeHand(s: number, reach: number, k: number): Sprite {
  const w = s * 2.6;
  return makeSprite(w, reach + s * 1.2, w / 2, reach, k, (g) => {
    // Sleeve and arm going up off the top of the screen.
    const aw = s * 1.05;
    const ag = g.createLinearGradient(-aw / 2, 0, aw / 2, 0);
    ag.addColorStop(0, PAL.skinHi);
    ag.addColorStop(0.45, PAL.skin);
    ag.addColorStop(1, PAL.skinDeep);
    g.fillStyle = ag;
    g.beginPath();
    g.roundRect(-aw / 2, -reach, aw, reach, aw * 0.4);
    g.fill();
    const sw = s * 1.5;
    const sg = g.createLinearGradient(-sw / 2, 0, sw / 2, 0);
    sg.addColorStop(0, "#C3DDB3");
    sg.addColorStop(0.45, PAL.sage);
    sg.addColorStop(1, PAL.sageDeep);
    g.fillStyle = sg;
    g.beginPath();
    g.roundRect(-sw / 2, -reach, sw, reach - s * 1.55, s * 0.35);
    g.fill();
    // The cuff, with stitches.
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
    // The palm.
    const palm = () => lumpPath(g, s * 0.82, 77, 0.04, 1.08, 0.86, 0);
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
    // Middle, ring and little finger curled under.
    for (let i = 0; i < 3; i++) {
      const x = s * (0.05 + i * 0.27);
      const y = s * (0.52 - i * 0.07);
      g.fillStyle = i % 2 ? PAL.skin : "#EDB997";
      g.beginPath();
      g.ellipse(x, y, s * 0.17, s * 0.22, 0.2, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = rgba(PAL.skinDeep, 0.85);
      g.lineWidth = 1.3;
      g.stroke();
    }
    // A whorl pressed into the back of the hand.
    g.strokeStyle = rgba(PAL.skinDeep, 0.25);
    g.lineWidth = 1;
    for (let i = 1; i <= 4; i++) {
      g.beginPath();
      g.ellipse(-s * 0.15, -s * 0.12, s * 0.07 * i * 1.3, s * 0.07 * i, 0.4, 0.3, 5.4);
      g.stroke();
    }
  });
}

/** One finger, live: a soft clay capsule from its base on the palm to its tip, with a nail. */
export function drawFinger(g: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, wid: number): void {
  g.lineCap = "round";
  g.strokeStyle = PAL.skinDeep;
  g.lineWidth = wid + 3;
  g.beginPath();
  g.moveTo(x0, y0);
  g.lineTo(x1, y1);
  g.stroke();
  g.strokeStyle = PAL.skin;
  g.lineWidth = wid;
  g.stroke();
  const dx = x1 - x0;
  const dy = y1 - y0;
  const l = Math.hypot(dx, dy) || 1;
  const nx = -dy / l;
  const ny = dx / l;
  // Light along the upper-left side.
  g.strokeStyle = "rgba(255,232,214,0.85)";
  g.lineWidth = wid * 0.22;
  g.beginPath();
  g.moveTo(x0 - nx * wid * 0.2 * Math.sign(nx || 1), y0 - Math.abs(ny) * wid * 0.2);
  g.lineTo(x1 - nx * wid * 0.2 * Math.sign(nx || 1) - (dx / l) * wid * 0.4, y1 - Math.abs(ny) * wid * 0.2 - (dy / l) * wid * 0.4);
  g.stroke();
  // The nail, near the tip, along the finger.
  const ang = Math.atan2(dy, dx);
  g.save();
  g.translate(x1 - (dx / l) * wid * 0.3, y1 - (dy / l) * wid * 0.3);
  g.rotate(ang);
  g.fillStyle = "rgba(255,238,230,0.95)";
  g.beginPath();
  g.ellipse(0, 0, wid * 0.36, wid * 0.27, 0, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = rgba(PAL.skinDeep, 0.6);
  g.lineWidth = 1;
  g.stroke();
  g.restore();
}

/** A soft contact shadow on the back wall, drawn scaled under each piece. */
export function makeShadow(k: number): Sprite {
  const r = 32;
  return makeSprite(r * 2.4, r * 2.4, r * 1.2, r * 1.2, k, (g) => {
    const sg = g.createRadialGradient(0, 0, r * 0.7, 0, 0, r * 1.2);
    sg.addColorStop(0, "rgba(26,36,60,0.32)");
    sg.addColorStop(1, "rgba(26,36,60,0)");
    g.fillStyle = sg;
    g.beginPath();
    g.arc(0, 0, r * 1.2, 0, Math.PI * 2);
    g.fill();
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
  g.roundRect(x + 2, y + 1.5, w - 4, h - 3, rad - 2);
  g.stroke();
}

/** Text in clay type: cream letters with a chocolate lip. */
export function clayText(g: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, o: { fill?: string; lip?: string; align?: CanvasTextAlign; weight?: number; lipY?: number; outline?: boolean } = {}): void {
  g.font = font(size, o.weight ?? 700);
  g.textAlign = o.align ?? "center";
  g.textBaseline = "middle";
  if (o.outline) {
    // A chocolate rim all round, for type floating over busy clay.
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
