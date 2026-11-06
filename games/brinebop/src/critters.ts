/**
 * The rock-pool cast in juicefactory's sticker style: flat colour, a darker shade crescent, a white shine tick,
 * a fat ink outline and a hard offset shadow. Each kind has its own silhouette as well as its own colour, so the
 * pool reads without colour: crab (wide, claws up), puffer (spiky ball), scallop (fan), fish (sideways, tailed),
 * octopus (dome on legs), starfish (five points). Bodies are drawn once per size into bitmaps; eyes are live.
 */
import { makeSprite, PAL, shine, starPath, type Sprite } from "./comic.ts";

const TAU = Math.PI * 2;
const INK = PAL.ink;

export interface KindStyle {
  name: string;
  body: string;
  shade: string;
  hi: string;
  /** Eye centres and radius, in units of R. */
  eyes: Array<[number, number]>;
  eyeR: number;
}

export const KIND: KindStyle[] = [
  { name: "crab", body: "#FF4A38", shade: "#C9281E", hi: "#FF9C8A", eyes: [[-0.27, -0.7], [0.27, -0.7]], eyeR: 0.2 },
  { name: "puffer", body: "#FFD83A", shade: "#F4A51C", hi: "#FFEC8A", eyes: [[-0.3, -0.14], [0.3, -0.14]], eyeR: 0.25 },
  { name: "scallop", body: "#9AE43C", shade: "#58AB23", hi: "#C8F57E", eyes: [[-0.27, -0.02], [0.27, -0.02]], eyeR: 0.21 },
  { name: "fish", body: "#3D8BFF", shade: "#1B4FC4", hi: "#9CC4FF", eyes: [[-0.36, -0.12]], eyeR: 0.27 },
  { name: "octopus", body: "#FF7CC6", shade: "#D93F95", hi: "#FFB8E0", eyes: [[-0.27, -0.22], [0.27, -0.22]], eyeR: 0.22 },
  { name: "starfish", body: "#A46BFF", shade: "#6A3BD1", hi: "#D2B6FF", eyes: [[-0.21, -0.1], [0.21, -0.1]], eyeR: 0.18 },
];

export const CONCH_STYLE = { body: "#FFC93A", shade: "#E08A12", hi: "#FFF0A8", lip: "#FF8FB8", stripe: "#E8521E" };

type PathFn = (g: CanvasRenderingContext2D, R: number) => void;
interface Part {
  path: PathFn;
  fill: string;
  shade?: string;
  /** Drawn as a fat stroked line instead of a filled shape. */
  line?: number;
}

// ---------------------------------------------------------------------------------------------------------------
// Silhouettes (units of R, centred on the cell)
// ---------------------------------------------------------------------------------------------------------------

function ellipse(g: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number): void {
  g.ellipse(x, y, rx, ry, 0, 0, TAU);
}

/** A pincer: a ball with a V bitten out of the top. */
function pincer(g: CanvasRenderingContext2D, x: number, y: number, r: number, tilt: number): void {
  const a0 = -Math.PI / 2 + tilt + 0.55;
  const a1 = -Math.PI / 2 + tilt - 0.55 + TAU;
  g.moveTo(x + Math.cos(-Math.PI / 2 + tilt) * r * 0.15, y + Math.sin(-Math.PI / 2 + tilt) * r * 0.15);
  g.lineTo(x + Math.cos(a0) * r, y + Math.sin(a0) * r);
  g.arc(x, y, r, a0, a1);
  g.closePath();
}

const crab: Part[] = [
  // Legs, three a side.
  {
    fill: "#FF4A38",
    line: 0.13,
    path: (g, R) => {
      for (const s of [-1, 1])
        for (let k = 0; k < 3; k++) {
          const x0 = s * R * (0.45 + k * 0.17);
          g.moveTo(x0, R * 0.32);
          g.quadraticCurveTo(s * R * (0.78 + k * 0.1), R * (0.42 + k * 0.05), s * R * (0.86 + k * 0.06), R * (0.74 - k * 0.04));
        }
    },
  },
  // Arms up to the claws.
  {
    fill: "#FF4A38",
    line: 0.16,
    path: (g, R) => {
      for (const s of [-1, 1]) {
        g.moveTo(s * R * 0.5, R * 0.0);
        g.quadraticCurveTo(s * R * 0.82, R * -0.05, s * R * 0.72, R * -0.42);
      }
    },
  },
  {
    fill: "#FF4A38",
    shade: "#C9281E",
    path: (g, R) => {
      pincer(g, -R * 0.7, -R * 0.52, R * 0.3, -0.35);
      pincer(g, R * 0.7, -R * 0.52, R * 0.3, 0.35);
    },
  },
  // Eye stalks.
  {
    fill: "#FF4A38",
    line: 0.11,
    path: (g, R) => {
      for (const s of [-1, 1]) {
        g.moveTo(s * R * 0.2, -R * 0.2);
        g.lineTo(s * R * 0.27, -R * 0.62);
      }
    },
  },
  { fill: "#FF4A38", shade: "#C9281E", path: (g, R) => ellipse(g, 0, R * 0.12, R * 0.78, R * 0.52) },
];

const puffer: Part[] = [
  {
    fill: "#F4A51C",
    path: (g, R) => {
      const n = 13;
      for (let i = 0; i < n * 2; i++) {
        const a = (i / (n * 2)) * TAU - Math.PI / 2;
        const r = i % 2 === 0 ? R * 1.02 : R * 0.74;
        if (i === 0) g.moveTo(Math.cos(a) * r, Math.sin(a) * r);
        else g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      g.closePath();
    },
  },
  { fill: "#FFD83A", shade: "#F4A51C", path: (g, R) => g.arc(0, 0, R * 0.8, 0, TAU) },
  // Little side fins.
  {
    fill: "#FFEC8A",
    path: (g, R) => {
      for (const s of [-1, 1]) {
        g.moveTo(s * R * 0.62, R * 0.22);
        g.quadraticCurveTo(s * R * 0.98, R * 0.18, s * R * 0.9, R * 0.5);
        g.quadraticCurveTo(s * R * 0.75, R * 0.48, s * R * 0.6, R * 0.38);
        g.closePath();
      }
    },
  },
];

const SCALLOP_BUMPS = 6;
const scallop: Part[] = [
  {
    fill: "#9AE43C",
    shade: "#58AB23",
    path: (g, R) => {
      const cx = 0;
      const cy = R * 0.62;
      const rad = R * 1.32;
      const a0 = Math.PI * 1.2;
      const a1 = Math.PI * 1.8;
      g.moveTo(cx, cy);
      g.lineTo(cx + Math.cos(a0) * rad * 0.95, cy + Math.sin(a0) * rad * 0.95);
      for (let i = 0; i < SCALLOP_BUMPS; i++) {
        const b0 = a0 + ((a1 - a0) * i) / SCALLOP_BUMPS;
        const b1 = a0 + ((a1 - a0) * (i + 1)) / SCALLOP_BUMPS;
        const bm = (b0 + b1) / 2;
        g.quadraticCurveTo(cx + Math.cos(bm) * rad * 1.07, cy + Math.sin(bm) * rad * 1.07, cx + Math.cos(b1) * rad * 0.95, cy + Math.sin(b1) * rad * 0.95);
      }
      g.closePath();
    },
  },
];

const fish: Part[] = [
  {
    fill: "#3D8BFF",
    shade: "#1B4FC4",
    path: (g, R) => {
      // Tail.
      g.moveTo(R * 0.45, 0);
      g.quadraticCurveTo(R * 0.75, -R * 0.2, R * 1.0, -R * 0.55);
      g.quadraticCurveTo(R * 0.86, -R * 0.05, R * 0.95, R * 0.02);
      g.quadraticCurveTo(R * 0.86, R * 0.1, R * 1.0, R * 0.55);
      g.quadraticCurveTo(R * 0.75, R * 0.2, R * 0.45, 0);
      g.closePath();
    },
  },
  {
    fill: "#3D8BFF",
    path: (g, R) => {
      // Dorsal fin.
      g.moveTo(-R * 0.28, -R * 0.5);
      g.quadraticCurveTo(-R * 0.05, -R * 0.92, R * 0.34, -R * 0.62);
      g.quadraticCurveTo(R * 0.2, -R * 0.42, R * 0.05, -R * 0.4);
      g.closePath();
    },
  },
  {
    fill: "#3D8BFF",
    shade: "#1B4FC4",
    path: (g, R) => {
      g.moveTo(-R * 0.88, R * 0.02);
      g.bezierCurveTo(-R * 0.82, -R * 0.6, R * 0.25, -R * 0.68, R * 0.6, -R * 0.02);
      g.bezierCurveTo(R * 0.25, R * 0.62, -R * 0.8, R * 0.62, -R * 0.88, R * 0.02);
      g.closePath();
    },
  },
];

const octopus: Part[] = [
  {
    fill: "#FF7CC6",
    line: 0.26,
    path: (g, R) => {
      const xs = [-0.55, -0.2, 0.2, 0.55];
      xs.forEach((x, i) => {
        const s = x < 0 ? -1 : 1;
        g.moveTo(R * x * 0.8, R * 0.2);
        g.bezierCurveTo(R * (x + s * 0.05), R * 0.55, R * (x + s * 0.22), R * 0.62, R * (x + s * (i === 1 || i === 2 ? 0.05 : 0.3)), R * 0.82);
      });
    },
  },
  { fill: "#FF7CC6", shade: "#D93F95", path: (g, R) => ellipse(g, 0, -R * 0.16, R * 0.76, R * 0.66) },
];

function starfishPath(g: CanvasRenderingContext2D, R: number): void {
  const n = 5;
  const ro = R * 1.1;
  const ri = R * 0.52;
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < n * 2; i++) {
    const a = -Math.PI / 2 + (i / (n * 2)) * TAU;
    const r = i % 2 === 0 ? ro : ri;
    pts.push([Math.cos(a) * r, Math.sin(a) * r + R * 0.06]);
  }
  const last = pts[pts.length - 1]!;
  const first = pts[0]!;
  g.moveTo((last[0] + first[0]) / 2, (last[1] + first[1]) / 2);
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    const q = pts[(i + 1) % pts.length]!;
    g.arcTo(p[0], p[1], (p[0] + q[0]) / 2, (p[1] + q[1]) / 2, i % 2 === 0 ? R * 0.2 : R * 0.12);
  }
  g.closePath();
}

const starfish: Part[] = [{ fill: "#A46BFF", shade: "#6A3BD1", path: starfishPath }];

const PARTS: Part[][] = [crab, puffer, scallop, fish, octopus, starfish];

// ---------------------------------------------------------------------------------------------------------------
// Painting
// ---------------------------------------------------------------------------------------------------------------

/** Fill (or stroke, for line parts) one part's path; `grow` fattens it (outlines, shadow). */
function paintPart(g: CanvasRenderingContext2D, part: Part, R: number, color: string, grow: number): void {
  g.beginPath();
  part.path(g, R);
  if (part.line) {
    g.lineCap = "round";
    g.lineJoin = "round";
    g.strokeStyle = color;
    g.lineWidth = part.line * R + grow * 2;
    g.stroke();
  } else {
    g.fillStyle = color;
    g.fill();
    if (grow > 0) {
      g.lineJoin = "round";
      g.strokeStyle = color;
      g.lineWidth = grow * 2;
      g.stroke();
    }
  }
}

function drawParts(g: CanvasRenderingContext2D, parts: Part[], R: number, shadow: boolean): void {
  const lw = Math.max(1.6, R * 0.1);
  if (shadow) {
    g.save();
    g.translate(R * 0.08, R * 0.11);
    for (const p of parts) paintPart(g, p, R, INK, lw / 2);
    g.restore();
  }
  for (const p of parts) {
    // Outline first (fattened ink), then the fill on top, so overlapping parts keep clean edges.
    paintPart(g, p, R, INK, lw / 2);
    paintPart(g, p, R, p.fill, 0);
    if (p.shade && !p.line) {
      g.save();
      g.beginPath();
      p.path(g, R);
      g.clip();
      g.fillStyle = p.shade;
      g.beginPath();
      g.ellipse(R * 0.32, R * 0.62, R * 1.0, R * 0.62, -0.35, 0, TAU);
      g.fill();
      g.restore();
    }
  }
}

/** Eye whites with their outline (pupils are drawn live). */
function drawEyeWhites(g: CanvasRenderingContext2D, s: KindStyle, R: number): void {
  const lw = Math.max(1.4, R * 0.075);
  for (const [ex, ey] of s.eyes) {
    g.beginPath();
    g.ellipse(ex * R, ey * R, s.eyeR * R, s.eyeR * R * 1.12, 0, 0, TAU);
    g.fillStyle = PAL.white;
    g.fill();
    g.lineWidth = lw;
    g.strokeStyle = INK;
    g.stroke();
  }
}

/** Per-kind decoration drawn on top of the body (before the eyes). */
function details(g: CanvasRenderingContext2D, kind: number, R: number): void {
  const s = KIND[kind]!;
  const lw = Math.max(1.2, R * 0.07);
  g.lineCap = "round";
  g.lineJoin = "round";
  switch (kind) {
    case 0: {
      // Crab: a grin and two cheek dots.
      g.strokeStyle = INK;
      g.lineWidth = lw;
      g.beginPath();
      g.arc(0, R * 0.12, R * 0.22, 0.25, Math.PI - 0.25);
      g.stroke();
      g.fillStyle = s.hi;
      for (const x of [-0.46, 0.46]) {
        g.beginPath();
        g.ellipse(x * R, R * 0.22, R * 0.1, R * 0.06, 0, 0, TAU);
        g.fill();
      }
      shine(g, -R * 0.38, -R * 0.08, R * 0.12, -0.5);
      break;
    }
    case 1: {
      // Puffer: an "o" mouth and freckles.
      g.fillStyle = INK;
      g.beginPath();
      g.ellipse(0, R * 0.34, R * 0.11, R * 0.13, 0, 0, TAU);
      g.fill();
      g.fillStyle = s.shade;
      for (const [x, y] of [[-0.5, 0.18], [0.5, 0.2], [-0.12, 0.58], [0.2, 0.56]] as const) {
        g.beginPath();
        g.arc(x * R, y * R, R * 0.055, 0, TAU);
        g.fill();
      }
      shine(g, -R * 0.42, -R * 0.48, R * 0.14, -0.7);
      break;
    }
    case 2: {
      // Scallop: ridges fanning out of the hinge and a small smile.
      g.save();
      g.beginPath();
      scallop[0]!.path(g, R);
      g.clip();
      g.strokeStyle = s.shade;
      g.lineWidth = Math.max(1.4, R * 0.09);
      for (let i = 1; i < SCALLOP_BUMPS; i++) {
        const a = Math.PI * 1.2 + (Math.PI * 0.6 * i) / SCALLOP_BUMPS;
        g.beginPath();
        g.moveTo(0, R * 0.62);
        g.lineTo(Math.cos(a) * R * 1.4, R * 0.62 + Math.sin(a) * R * 1.4);
        g.stroke();
      }
      g.restore();
      g.strokeStyle = INK;
      g.lineWidth = lw;
      g.beginPath();
      g.arc(0, R * 0.2, R * 0.14, 0.3, Math.PI - 0.3);
      g.stroke();
      shine(g, -R * 0.55, -R * 0.38, R * 0.12, -0.9);
      break;
    }
    case 3: {
      // Fish: a lighter belly band, gill line and lips.
      g.save();
      g.beginPath();
      fish[2]!.path(g, R);
      g.clip();
      g.fillStyle = s.hi;
      g.beginPath();
      g.ellipse(-R * 0.1, R * 0.5, R * 0.8, R * 0.26, 0, 0, TAU);
      g.fill();
      g.restore();
      g.strokeStyle = INK;
      g.lineWidth = lw;
      g.beginPath();
      g.arc(-R * 0.02, R * 0.02, R * 0.32, -0.9, 0.9);
      g.stroke();
      g.beginPath();
      g.arc(-R * 0.78, R * 0.18, R * 0.09, -1.2, 1.6);
      g.stroke();
      shine(g, -R * 0.2, -R * 0.4, R * 0.1, -0.3);
      break;
    }
    case 4: {
      // Octopus: spots and a little beak smile.
      g.fillStyle = s.hi;
      for (const [x, y, r] of [[-0.42, -0.56, 0.1], [0.4, -0.6, 0.08], [0.52, -0.22, 0.06]] as const) {
        g.beginPath();
        g.arc(x * R, y * R, r * R, 0, TAU);
        g.fill();
      }
      g.strokeStyle = INK;
      g.lineWidth = lw;
      g.beginPath();
      g.arc(0, R * 0.04, R * 0.14, 0.35, Math.PI - 0.35);
      g.stroke();
      shine(g, -R * 0.36, -R * 0.52, R * 0.12, -0.7);
      break;
    }
    case 5: {
      // Starfish: bumpy dots down each arm.
      g.fillStyle = s.hi;
      for (let i = 0; i < 5; i++) {
        const a = -Math.PI / 2 + (i / 5) * TAU;
        for (const d of [0.55, 0.78]) {
          g.beginPath();
          g.arc(Math.cos(a) * d * R, Math.sin(a) * d * R + R * 0.06, R * (d > 0.6 ? 0.045 : 0.06), 0, TAU);
          g.fill();
        }
      }
      g.strokeStyle = INK;
      g.lineWidth = lw;
      g.beginPath();
      g.arc(0, R * 0.14, R * 0.1, 0.3, Math.PI - 0.3);
      g.stroke();
      break;
    }
  }
}

/** The conch: a golden spiral shell with a pink lip, no eyes (it's the special that calls them). */
function drawConchBody(g: CanvasRenderingContext2D, R: number): void {
  const C = CONCH_STYLE;
  const shell: Part[] = [
    {
      fill: C.lip,
      shade: "#E05A92",
      path: (g2, r) => {
        g2.moveTo(r * 0.1, -r * 0.3);
        g2.bezierCurveTo(r * 0.95, -r * 0.45, r * 1.0, r * 0.5, r * 0.55, r * 0.88);
        g2.bezierCurveTo(r * 0.35, r * 0.55, r * 0.2, r * 0.3, r * 0.05, r * 0.2);
        g2.closePath();
      },
    },
    {
      fill: C.body,
      shade: C.shade,
      path: (g2, r) => {
        // Spire to the top-left, body whorl, tapering to the canal at the bottom.
        g2.moveTo(-r * 0.42, -r * 0.98);
        g2.lineTo(-r * 0.12, -r * 0.62);
        g2.quadraticCurveTo(r * 0.38, -r * 0.62, r * 0.42, -r * 0.18);
        g2.quadraticCurveTo(r * 0.45, r * 0.42, r * 0.12, r * 0.95);
        g2.quadraticCurveTo(-r * 0.45, r * 0.55, -r * 0.7, r * 0.05);
        g2.quadraticCurveTo(-r * 0.82, -r * 0.42, -r * 0.42, -r * 0.98);
        g2.closePath();
      },
    },
  ];
  drawParts(g, shell, R, true);
  const lw = Math.max(1.3, R * 0.07);
  g.save();
  g.beginPath();
  shell[1]!.path(g, R);
  g.clip();
  // Spiral bands.
  g.strokeStyle = C.stripe;
  g.lineWidth = Math.max(1.6, R * 0.12);
  g.lineCap = "round";
  for (let k = 0; k < 3; k++) {
    g.beginPath();
    const y = -R * 0.5 + k * R * 0.42;
    g.moveTo(-R * 0.85, y + R * 0.25);
    g.quadraticCurveTo(-R * 0.1, y - R * 0.12, R * 0.55, y + R * 0.08);
    g.stroke();
  }
  g.restore();
  // Knobs along the shoulder.
  g.fillStyle = C.hi;
  g.strokeStyle = INK;
  g.lineWidth = lw;
  for (const [x, y] of [[-0.62, -0.2], [-0.3, -0.48], [0.05, -0.55], [0.32, -0.38]] as const) {
    g.beginPath();
    g.arc(x * R, y * R, R * 0.1, 0, TAU);
    g.fill();
    g.stroke();
  }
  shine(g, -R * 0.42, R * 0.15, R * 0.12, -1.1);
}

// ---------------------------------------------------------------------------------------------------------------
// Cached sprites
// ---------------------------------------------------------------------------------------------------------------

export interface CritterArt {
  /** Body + eye whites, per kind (index KINDS = the conch). */
  body: Sprite[];
  /** The squirter's arrow pair (horizontal; rotate for vertical). */
  arrows: Sprite;
  /** The boomer's shake dashes (behind the body), its bomb badge and the fuse spark (at the badge's fuse tip). */
  burst: Sprite;
  bomb: Sprite;
  spark: Sprite;
  /** The conch's backing rays. */
  rays: Sprite;
  /** A soft lit disc for the selected critter. */
  glow: Sprite;
  R: number;
}

export function makeCritterArt(R: number, scale: number): CritterArt {
  const S = R * 2.7;
  const body = PARTS.map((parts, kind) =>
    makeSprite(S, S, S / 2, S / 2, (g) => {
      drawParts(g, parts, R, true);
      details(g, kind, R);
      drawEyeWhites(g, KIND[kind]!, R);
    }, scale),
  );
  body.push(makeSprite(S, S, S / 2, S / 2, (g) => drawConchBody(g, R * 0.95), scale));
  const AW = R * 3.2;
  const arrows = makeSprite(AW, R * 1.4, AW / 2, R * 0.7, (g) => {
    const lw = Math.max(1.6, R * 0.09);
    // A white band through the critter, an arrowhead out each side.
    g.lineJoin = "round";
    for (const s of [-1, 1]) {
      g.beginPath();
      g.moveTo(s * R * 1.48, 0);
      g.lineTo(s * R * 1.02, -R * 0.36);
      g.lineTo(s * R * 1.02, R * 0.36);
      g.closePath();
      g.fillStyle = PAL.white;
      g.fill();
      g.lineWidth = lw;
      g.strokeStyle = INK;
      g.stroke();
    }
  }, scale);
  const BW = R * 2.9;
  // The boomer: shake dashes all round and a cartoon bomb tucked in at the bottom right.
  const burst = makeSprite(BW, BW, BW / 2, BW / 2, (g) => {
    g.lineCap = "round";
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * TAU + 0.2;
      const r0 = R * 1.06;
      const r1 = R * 1.34;
      for (const [w, c] of [[R * 0.24, INK], [R * 0.12, PAL.white]] as const) {
        g.strokeStyle = c;
        g.lineWidth = w;
        g.beginPath();
        g.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
        g.lineTo(Math.cos(a) * r1, Math.sin(a) * r1);
        g.stroke();
      }
    }
  }, scale);
  const bomb = makeSprite(R * 1.5, R * 1.5, R * 0.55, R * 0.85, (g) => {
    const lw = Math.max(1.4, R * 0.08);
    g.lineCap = "round";
    // Fuse.
    g.strokeStyle = INK;
    g.lineWidth = R * 0.16;
    g.beginPath();
    g.moveTo(R * 0.12, -R * 0.28);
    g.quadraticCurveTo(R * 0.32, -R * 0.62, R * 0.55, -R * 0.55);
    g.stroke();
    g.strokeStyle = "#E0A45A";
    g.lineWidth = R * 0.07;
    g.stroke();
    g.beginPath();
    g.arc(0, 0, R * 0.33, 0, TAU);
    g.fillStyle = INK;
    g.fill();
    g.lineWidth = lw;
    g.strokeStyle = PAL.white;
    g.stroke();
    shine(g, -R * 0.14, -R * 0.14, R * 0.09, -0.8);
  }, scale);
  const spark = makeSprite(R * 0.9, R * 0.9, R * 0.45, R * 0.45, (g) => {
    starPath(g, R * 0.32, 6, 0.42);
    g.fillStyle = PAL.banana;
    g.fill();
    g.lineWidth = Math.max(1.2, R * 0.06);
    g.strokeStyle = INK;
    g.stroke();
  }, scale);
  const rays = makeSprite(BW, BW, BW / 2, BW / 2, (g) => {
    g.fillStyle = PAL.white;
    starPath(g, R * 1.3, 12, 0.62);
    g.fill();
    g.lineWidth = Math.max(1.4, R * 0.07);
    g.strokeStyle = INK;
    g.stroke();
  }, scale);
  const glow = makeSprite(BW, BW, BW / 2, BW / 2, (g) => {
    g.beginPath();
    g.arc(0, 0, R * 1.2, 0, TAU);
    g.fillStyle = "rgba(255,255,255,0.35)";
    g.fill();
    g.beginPath();
    g.arc(0, 0, R * 1.2, 0, TAU);
    g.lineWidth = Math.max(2, R * 0.12);
    g.strokeStyle = PAL.white;
    g.stroke();
  }, scale);
  return { body, arrows, burst, bomb, spark, rays, glow, R };
}

export interface Look {
  /** Pupil direction, roughly -1..1. */
  x: number;
  y: number;
  /** 0 open .. 1 shut. */
  blink: number;
  mood: "plain" | "happy" | "worried";
}

/** Pupils, lids and moods, drawn live on top of the cached body (call with the transform at the critter). */
export function drawEyes(g: CanvasRenderingContext2D, kind: number, R: number, look: Look): void {
  if (kind < 0) return;
  const s = KIND[kind]!;
  const er = s.eyeR * R;
  for (const [ex, ey] of s.eyes) {
    const x = ex * R;
    const y = ey * R;
    if (look.mood === "happy") {
      // Squeezed shut: "^" arcs over the whites.
      g.fillStyle = s.body;
      g.beginPath();
      g.ellipse(x, y, er * 1.08, er * 1.2, 0, 0, TAU);
      g.fill();
      g.strokeStyle = INK;
      g.lineWidth = Math.max(1.4, R * 0.08);
      g.lineCap = "round";
      g.beginPath();
      g.moveTo(x - er * 0.7, y + er * 0.25);
      g.lineTo(x, y - er * 0.45);
      g.lineTo(x + er * 0.7, y + er * 0.25);
      g.stroke();
      continue;
    }
    const pr = er * (look.mood === "worried" ? 0.38 : 0.52);
    const px = x + look.x * er * 0.38;
    const py = y + look.y * er * 0.4;
    g.fillStyle = INK;
    g.beginPath();
    g.arc(px, py, pr, 0, TAU);
    g.fill();
    g.fillStyle = PAL.white;
    g.beginPath();
    g.arc(px - pr * 0.35, py - pr * 0.4, pr * 0.34, 0, TAU);
    g.fill();
    if (look.blink > 0.02) {
      // The lid comes down in the body colour, inside the eye.
      const ly = y - er * 1.15 + er * 2.3 * look.blink;
      g.save();
      g.beginPath();
      g.ellipse(x, y, er * 1.02, er * 1.14, 0, 0, TAU);
      g.clip();
      g.fillStyle = s.body;
      g.fillRect(x - er * 1.2, y - er * 1.3, er * 2.4, ly - (y - er * 1.3));
      g.strokeStyle = INK;
      g.lineWidth = Math.max(1.2, R * 0.08);
      g.beginPath();
      g.moveTo(x - er * 1.1, ly);
      g.lineTo(x + er * 1.1, ly);
      g.stroke();
      g.restore();
    }
  }
}

/** juicefactory's cartoon glove, pointing up with the index finger (the demo hand and the first-run hint). */
export function makeGlove(size: number, scale: number): Sprite {
  const s = size;
  // Anchored at the drawing origin; the fingertip is at (0.2, -0.06) × size from it.
  return makeSprite(s * 1.4, s * 1.7, s * 0.1, s * 0.12, (g) => {
    const lw = Math.max(2, s * 0.07);
    const parts: Array<(g2: CanvasRenderingContext2D) => void> = [
      // Cuff.
      (g2) => {
        g2.moveTo(s * 0.14, s * 1.05);
        g2.lineTo(s * 0.86, s * 1.05);
        g2.lineTo(s * 0.9, s * 1.36);
        g2.lineTo(s * 0.1, s * 1.36);
        g2.closePath();
      },
      // Palm with the curled fingers.
      (g2) => {
        g2.moveTo(s * 0.08, s * 0.62);
        g2.quadraticCurveTo(s * 0.02, s * 0.42, s * 0.24, s * 0.4);
        g2.lineTo(s * 0.92, s * 0.42);
        g2.quadraticCurveTo(s * 1.08, s * 0.5, s * 0.98, s * 0.74);
        g2.quadraticCurveTo(s * 0.98, s * 1.08, s * 0.62, s * 1.1);
        g2.lineTo(s * 0.3, s * 1.1);
        g2.quadraticCurveTo(s * 0.06, s * 1.0, s * 0.08, s * 0.62);
        g2.closePath();
      },
      // Index finger, pointing up.
      (g2) => {
        g2.moveTo(s * 0.08, s * 0.66);
        g2.lineTo(s * 0.08, s * 0.06);
        g2.quadraticCurveTo(s * 0.08, -s * 0.06, s * 0.2, -s * 0.06);
        g2.quadraticCurveTo(s * 0.32, -s * 0.06, s * 0.32, s * 0.06);
        g2.lineTo(s * 0.32, s * 0.6);
        g2.closePath();
      },
    ];
    g.lineJoin = "round";
    g.save();
    g.translate(s * 0.06, s * 0.08);
    for (const p of parts) {
      g.beginPath();
      p(g);
      g.fillStyle = INK;
      g.fill();
      g.lineWidth = lw;
      g.strokeStyle = INK;
      g.stroke();
    }
    g.restore();
    for (const [i, p] of parts.entries()) {
      g.beginPath();
      p(g);
      g.fillStyle = i === 0 ? PAL.cream : PAL.white;
      g.fill();
      g.lineWidth = lw;
      g.strokeStyle = INK;
      g.stroke();
    }
    // Knuckle creases.
    g.strokeStyle = INK;
    g.lineWidth = lw * 0.7;
    g.lineCap = "round";
    for (const x of [0.5, 0.72]) {
      g.beginPath();
      g.moveTo(s * x, s * 0.44);
      g.lineTo(s * x, s * 0.64);
      g.stroke();
    }
  }, scale);
}
