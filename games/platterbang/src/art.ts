/**
 * Platterbang's kitchen in juicefactory's look: enamel crockery with fat ink outlines, polka dots and halftone, chunky
 * party pegs whose heads each have their own silhouette (so the wall reads without colour), googly-eyed glass jars with
 * a lid in the peg's colour, a tiled diner wall over a checkered counter, a cherry shelf and a horseshoe magnet. Every
 * piece is drawn once into a sprite and blitted with its pose.
 */
import type { Dish } from "./board.ts";
import { makeSprite, PAL, type Sprite } from "./comic.ts";
import type { Shape } from "./geom.ts";
import { PEG_R } from "./geom.ts";

export const INK = PAL.ink;
const TAU = Math.PI * 2;

/** The run's ground: diner jade (the accent), its rays and the tiles. */
export const JADE = "#14A87D";
export const JADE_RAY = "#2CC295";
export const JADE_DEEP = "#0C7F5E";
export const TILE = "#FFF6DE";
export const GROUT = "#E6D7B2";
export const CHERRY = "#E8333F";
export const CHERRY_SHADE = "#B01E2E";

export interface PegLook {
  name: string;
  fill: string;
  hi: string;
  shade: string;
}

/** Peg colours, each with its own head shape: ball, star, diamond, clover, heart, hexagon. */
export const PEGS: PegLook[] = [
  { name: "ball", fill: PAL.tomato, hi: "#FF9A8C", shade: PAL.tomatoShade },
  { name: "star", fill: PAL.banana, hi: PAL.bananaHi, shade: PAL.bananaShade },
  { name: "diamond", fill: PAL.cobalt, hi: PAL.cobaltHi, shade: PAL.cobaltShade },
  { name: "clover", fill: PAL.lime, hi: PAL.limeHi, shade: PAL.limeShade },
  { name: "heart", fill: PAL.bubblegum, hi: PAL.bubblegumHi, shade: PAL.bubblegumShade },
  { name: "hex", fill: "#A35BFF", hi: "#CDA6FF", shade: "#6E2FC9" },
];

/** Enamel paints for the dishes (body, well, pattern). */
export const PAINTS: Array<{ body: string; well: string; dot: string }> = [
  { body: "#B9F0D9", well: "#94E3C3", dot: "#FFFFFF" },
  { body: "#FFD3B3", well: "#FFBC8E", dot: "#FFFFFF" },
  { body: "#BCD6FF", well: "#9CC0FF", dot: "#FFFFFF" },
  { body: "#FFF0A6", well: "#FFE170", dot: "#FFFFFF" },
  { body: "#DCC8FF", well: "#C6A9FF", dot: "#FFFFFF" },
  { body: "#FFC4DA", well: "#FFA4C4", dot: "#FFFFFF" },
];

// -------------------------------------------------------------------------------------------------------------
// Peg heads
// -------------------------------------------------------------------------------------------------------------

/** The head's silhouette at radius `r` around the origin. */
export function headPath(g: CanvasRenderingContext2D, kind: number, r: number): void {
  g.beginPath();
  switch (kind) {
    case 1: {
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i / 10) * TAU;
        const k = i % 2 === 0 ? r * 1.2 : r * 0.58;
        if (i === 0) g.moveTo(Math.cos(a) * k, Math.sin(a) * k);
        else g.lineTo(Math.cos(a) * k, Math.sin(a) * k);
      }
      g.closePath();
      break;
    }
    case 2: {
      const k = r * 1.12;
      g.moveTo(0, -k);
      g.quadraticCurveTo(k * 0.12, -k * 0.12, k, 0);
      g.quadraticCurveTo(k * 0.12, k * 0.12, 0, k);
      g.quadraticCurveTo(-k * 0.12, k * 0.12, -k, 0);
      g.quadraticCurveTo(-k * 0.12, -k * 0.12, 0, -k);
      g.closePath();
      break;
    }
    case 3: {
      const d = r * 0.5;
      const lr = r * 0.56;
      for (let i = 0; i < 4; i++) {
        const a = Math.PI / 4 + (i * Math.PI) / 2;
        g.moveTo(Math.cos(a) * d + lr, Math.sin(a) * d);
        g.arc(Math.cos(a) * d, Math.sin(a) * d, lr, 0, TAU);
      }
      break;
    }
    case 4: {
      const k = r * 1.12;
      g.moveTo(0, k * 0.92);
      g.bezierCurveTo(-k * 1.3, k * 0.05, -k * 0.85, -k * 1.05, 0, -k * 0.42);
      g.bezierCurveTo(k * 0.85, -k * 1.05, k * 1.3, k * 0.05, 0, k * 0.92);
      g.closePath();
      break;
    }
    case 5: {
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU;
        if (i === 0) g.moveTo(Math.cos(a) * r * 1.06, Math.sin(a) * r * 1.06);
        else g.lineTo(Math.cos(a) * r * 1.06, Math.sin(a) * r * 1.06);
      }
      g.closePath();
      break;
    }
    default:
      g.arc(0, 0, r, 0, TAU);
  }
}

/** A peg head: hard shadow, ink outline, the colour, a shade and a shine. `r` in CSS px. */
export function makePeg(kind: number, r: number, scale: number): Sprite {
  const p = PEGS[kind]!;
  const pad = r * 0.9;
  const size = r * 2.6 + pad;
  return makeSprite(size, size, size / 2 - r * 0.05, size / 2 - r * 0.05, (g) => {
    const lw = Math.max(1.6, r * 0.2);
    g.lineJoin = "round";
    // Hard shadow.
    g.save();
    g.translate(r * 0.14, r * 0.22);
    headPath(g, kind, r);
    g.fillStyle = INK;
    g.fill("nonzero");
    g.lineWidth = lw;
    g.strokeStyle = INK;
    g.stroke();
    g.restore();
    // Outline under the fill, so the clover's lobes merge into one outline.
    headPath(g, kind, r);
    g.lineWidth = lw * 2;
    g.strokeStyle = INK;
    g.stroke();
    g.fillStyle = p.fill;
    g.fill("nonzero");
    // A shade along the lower right and a shine at the upper left.
    g.save();
    headPath(g, kind, r);
    g.clip("nonzero");
    g.fillStyle = p.shade;
    g.beginPath();
    g.arc(r * 0.5, r * 0.6, r * 1.1, 0, TAU);
    g.fill();
    g.fillStyle = p.fill;
    g.beginPath();
    g.arc(-r * 0.08, -r * 0.1, r * 0.98, 0, TAU);
    g.fill();
    g.restore();
    g.fillStyle = PAL.white;
    g.beginPath();
    g.ellipse(-r * 0.36, -r * 0.42, r * 0.28, r * 0.13, -0.7, 0, TAU);
    g.fill();
    g.beginPath();
    g.arc(-r * 0.06, -r * 0.62, r * 0.07, 0, TAU);
    g.fill();
    // The cap's centre dot (it's a peg, not a sweet).
    g.fillStyle = p.shade;
    g.beginPath();
    g.arc(r * 0.06, r * 0.08, r * 0.16, 0, TAU);
    g.fill();
  }, scale);
}

/** A covered peg's ghost: its outline dashed, drawn faintly over the dish that hides it. */
export function makeGhost(kind: number, r: number, scale: number): Sprite {
  const size = r * 2.8;
  return makeSprite(size, size, size / 2, size / 2, (g) => {
    headPath(g, kind, r);
    g.fillStyle = PEGS[kind]!.fill;
    g.globalAlpha = 0.5;
    g.fill("nonzero");
    g.globalAlpha = 1;
    g.setLineDash([r * 0.32, r * 0.26]);
    g.lineWidth = Math.max(1.4, r * 0.16);
    g.strokeStyle = INK;
    g.stroke();
  }, scale);
}

// -------------------------------------------------------------------------------------------------------------
// Dishes
// -------------------------------------------------------------------------------------------------------------

/** The dish's silhouette in local units times `s` (px per unit). Subpaths union under the nonzero rule. */
export function dishPath(g: CanvasRenderingContext2D, sh: Shape, s: number, inset = 0): void {
  g.beginPath();
  const i = inset;
  switch (sh.kind) {
    case "plate":
      g.arc(0, 0, Math.max(0.01, sh.a - i) * s, 0, TAU);
      break;
    case "board": {
      const r = Math.max(0.01, sh.b - i) * s;
      g.arc(-sh.a * s, 0, r, Math.PI / 2, (Math.PI * 3) / 2);
      g.arc(sh.a * s, 0, r, -Math.PI / 2, Math.PI / 2);
      g.closePath();
      break;
    }
    case "tray":
      g.roundRect((-sh.a + i) * s, (-sh.b + i) * s, (sh.a - i) * 2 * s, (sh.b - i) * 2 * s, Math.max(0.01, sh.c - i * 0.5) * s);
      break;
    case "platter":
      g.ellipse(0, 0, Math.max(0.01, sh.a - i) * s, Math.max(0.01, sh.b - i) * s, 0, 0, TAU);
      break;
    case "wedge": {
      const R = (sh.a - 2 * sh.c) * s;
      const c = Math.max(0.01, sh.c - i) * s;
      const v = [0, 1, 2].map((k) => {
        const a = -Math.PI / 2 + (k * TAU) / 3;
        return [Math.cos(a) * R, Math.sin(a) * R] as const;
      });
      for (let k = 0; k < 3; k++) {
        const [x, y] = v[k]!;
        const a = -Math.PI / 2 + (k * TAU) / 3;
        g.arc(x, y, c, a - Math.PI / 3, a + Math.PI / 3);
      }
      g.closePath();
      break;
    }
    case "pan": {
      g.arc(0, 0, Math.max(0.01, sh.a - i) * s, 0, TAU);
      const x0 = sh.a * 0.6 * s;
      const x1 = (sh.a + sh.b - sh.c) * s;
      const r = Math.max(0.01, sh.c - i) * s;
      g.moveTo(x0, -r);
      g.lineTo(x1, -r);
      g.arc(x1, 0, r, -Math.PI / 2, Math.PI / 2);
      g.lineTo(x0, r);
      g.closePath();
      break;
    }
  }
}

/** Half the size of the box a dish sprite needs, in units. */
function reach(sh: Shape): number {
  switch (sh.kind) {
    case "board":
      return sh.a + sh.b;
    case "pan":
      return sh.a + sh.b;
    default:
      return Math.max(sh.a, sh.b);
  }
}

/** Where a dish's face sits (local units) and how big it is. */
export function faceSpot(sh: Shape): { x: number; y: number; r: number } {
  switch (sh.kind) {
    case "plate":
      return { x: 0, y: 0, r: sh.a * 0.42 };
    case "pan":
      return { x: 0, y: 0.04, r: sh.a * 0.46 };
    case "tray":
      return { x: 0, y: 0, r: Math.min(sh.a, sh.b) * 0.48 };
    case "platter":
      return { x: 0, y: 0, r: sh.b * 0.5 };
    case "wedge":
      return { x: 0, y: sh.a * 0.08, r: sh.a * 0.28 };
    default:
      return { x: 0, y: 0, r: sh.b * 0.7 };
  }
}

export interface DishArt {
  body: Sprite;
  shadow: Sprite;
}

/** A dish drawn once: enamel, rim, pattern, halftone, the holes its pegs sit in, and an ink outline. `u` px per unit. */
export function makeDish(d: Dish, holes: ReadonlyArray<readonly [number, number]>, u: number, scale: number): DishArt {
  const sh = d.shape;
  const R = reach(sh) * u + 8;
  const paint = PAINTS[d.paint % PAINTS.length]!;
  const lw = Math.max(2.2, u * 0.055);
  const body = makeSprite(R * 2, R * 2, R, R, (g) => {
    g.lineJoin = "round";
    dishPath(g, sh, u);
    g.lineWidth = lw * 2;
    g.strokeStyle = INK;
    g.stroke();
    g.fillStyle = d.fancy ? "#FFFFFF" : paint.body;
    g.fill("nonzero");
    g.save();
    dishPath(g, sh, u);
    g.clip("nonzero");
    decorate(g, d, u, paint);
    // Halftone on the lower right, the juicefactory shade.
    g.fillStyle = "rgba(22,18,28,0.12)";
    const sp = Math.max(4, u * 0.12);
    for (let y = -R; y < R; y += sp * 0.5) {
      const row = Math.round(y / (sp * 0.5));
      for (let x = -R + (row % 2 ? sp / 2 : 0); x < R; x += sp) {
        const k = (x + y) / (R * 1.4) - 0.15;
        if (k <= 0) continue;
        const rr = Math.min(0.42, k * 0.5) * sp;
        if (rr < 0.5) continue;
        g.beginPath();
        g.arc(x, y, rr, 0, TAU);
        g.fill();
      }
    }
    g.restore();
    // The holes the pegs sit in (seen once a peg is out).
    for (const [x, y] of holes) {
      g.beginPath();
      g.arc(x * u, y * u, PEG_R * u * 0.72, 0, TAU);
      g.fillStyle = "#2A2233";
      g.fill();
      g.lineWidth = Math.max(1.5, u * 0.04);
      g.strokeStyle = "rgba(255,255,255,0.65)";
      g.beginPath();
      g.arc(x * u, y * u, PEG_R * u * 0.86, Math.PI * 0.15, Math.PI * 0.85);
      g.stroke();
    }
  }, scale);
  const shadow = makeSprite(R * 2, R * 2, R, R, (g) => {
    dishPath(g, sh, u);
    g.lineWidth = lw * 2;
    g.strokeStyle = INK;
    g.stroke();
    g.fillStyle = INK;
    g.fill("nonzero");
  }, Math.min(scale, 1.5));
  return { body, shadow };
}

function decorate(g: CanvasRenderingContext2D, d: Dish, u: number, paint: { body: string; well: string; dot: string }): void {
  const sh = d.shape;
  const lw = Math.max(1.4, u * 0.035);
  if (sh.kind === "pan") {
    // The enamel outside, a dark inside with a shine, a handle in the deeper paint.
    g.fillStyle = paint.well;
    g.fillRect(sh.a * 0.75 * u, -sh.c * u * 1.2, (sh.b + sh.a) * u, sh.c * 2.4 * u);
    g.beginPath();
    g.arc(0, 0, sh.a * 0.8 * u, 0, TAU);
    g.fillStyle = "#3A3147";
    g.fill();
    g.lineWidth = lw;
    g.strokeStyle = INK;
    g.stroke();
    g.strokeStyle = "rgba(255,255,255,0.5)";
    g.lineWidth = Math.max(2, u * 0.07);
    g.lineCap = "round";
    g.beginPath();
    g.arc(0, 0, sh.a * 0.6 * u, Math.PI * 1.05, Math.PI * 1.45);
    g.stroke();
    return;
  }
  if (d.fancy) {
    // Fine china: a gold rim, a cobalt flower, little sparkles.
    dishPath(g, sh, u, 0.09);
    g.lineWidth = Math.max(3, u * 0.09);
    g.strokeStyle = PAL.banana;
    g.stroke();
    g.lineWidth = lw * 0.7;
    g.strokeStyle = PAL.bananaShade;
    g.stroke();
    g.fillStyle = PAL.cobaltHi;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU;
      g.beginPath();
      g.ellipse(Math.cos(a) * u * 0.22, Math.sin(a) * u * 0.22, u * 0.16, u * 0.08, a, 0, TAU);
      g.fill();
    }
    g.fillStyle = PAL.cobalt;
    g.beginPath();
    g.arc(0, 0, u * 0.1, 0, TAU);
    g.fill();
    return;
  }
  // A well a shade deeper, inset from the rim (boards get a band instead).
  if (sh.kind === "board") {
    g.fillStyle = paint.well;
    g.fillRect(-sh.a * u, -sh.b * 0.42 * u, sh.a * 2 * u, sh.b * 0.84 * u);
  } else {
    dishPath(g, sh, u, sh.kind === "wedge" ? 0.26 : 0.24);
    g.fillStyle = paint.well;
    g.fill();
    g.lineWidth = lw * 0.8;
    g.strokeStyle = "rgba(22,18,28,0.28)";
    g.stroke();
  }
  // Pattern: polka dots, stripes or a cherry print on the rim.
  g.fillStyle = paint.dot;
  g.strokeStyle = paint.dot;
  const R = reach(sh) * u;
  switch (d.pattern % 3) {
    case 0: {
      const sp = u * 0.42;
      for (let y = -R; y <= R; y += sp)
        for (let x = -R + ((Math.round(y / sp) % 2) * sp) / 2; x <= R; x += sp) {
          g.beginPath();
          g.arc(x, y, u * 0.07, 0, TAU);
          g.fill();
        }
      break;
    }
    case 1: {
      g.lineWidth = u * 0.09;
      g.globalAlpha = 0.75;
      for (let x = -R * 2; x <= R * 2; x += u * 0.36) {
        g.beginPath();
        g.moveTo(x, -R);
        g.lineTo(x + R, R);
        g.stroke();
      }
      g.globalAlpha = 1;
      break;
    }
    default: {
      // Two cherries in the middle.
      for (const sx of [-1, 1]) {
        g.fillStyle = CHERRY;
        g.beginPath();
        g.arc(sx * u * 0.13, u * 0.08, u * 0.12, 0, TAU);
        g.fill();
        g.lineWidth = lw * 0.8;
        g.strokeStyle = INK;
        g.stroke();
      }
      g.strokeStyle = INK;
      g.lineWidth = lw * 0.8;
      g.beginPath();
      g.moveTo(-u * 0.13, -u * 0.03);
      g.quadraticCurveTo(0, -u * 0.25, u * 0.06, -u * 0.3);
      g.moveTo(u * 0.13, -u * 0.03);
      g.quadraticCurveTo(u * 0.1, -u * 0.2, u * 0.06, -u * 0.3);
      g.stroke();
    }
  }
}

// -------------------------------------------------------------------------------------------------------------
// Eyes
// -------------------------------------------------------------------------------------------------------------

export type Mood = "calm" | "worried" | "scream" | "happy";

/** Two googly eyes and a mouth at the origin, `r` px across the face. */
export function drawFace(g: CanvasRenderingContext2D, r: number, lookX: number, lookY: number, mood: Mood, blink: number): void {
  const er = r * 0.34;
  const lw = Math.max(1.4, r * 0.09);
  for (const sx of [-1, 1]) {
    const x = sx * r * 0.42;
    const y = -r * 0.18;
    g.beginPath();
    g.ellipse(x, y, er, er * 1.1, 0, 0, TAU);
    g.fillStyle = PAL.white;
    g.fill();
    g.lineWidth = lw;
    g.strokeStyle = INK;
    g.stroke();
    if (mood === "happy") {
      g.beginPath();
      g.moveTo(x - er * 0.6, y + er * 0.2);
      g.lineTo(x, y - er * 0.4);
      g.lineTo(x + er * 0.6, y + er * 0.2);
      g.lineCap = "round";
      g.stroke();
      continue;
    }
    const pr = er * (mood === "scream" ? 0.32 : mood === "worried" ? 0.42 : 0.55);
    const px = x + lookX * er * 0.42;
    const py = y + lookY * er * 0.42;
    g.fillStyle = INK;
    g.beginPath();
    g.arc(px, py, pr, 0, TAU);
    g.fill();
    g.fillStyle = PAL.white;
    g.beginPath();
    g.arc(px - pr * 0.35, py - pr * 0.38, pr * 0.34, 0, TAU);
    g.fill();
    if (blink > 0.02 && mood === "calm") {
      g.save();
      g.beginPath();
      g.ellipse(x, y, er * 1.02, er * 1.12, 0, 0, TAU);
      g.clip();
      g.fillStyle = "#F2E6C8";
      g.fillRect(x - er * 1.2, y - er * 1.2, er * 2.4, er * 2.4 * blink);
      g.restore();
    }
    if (mood === "worried") {
      // Brows up.
      g.beginPath();
      g.moveTo(x - er * 0.8 * sx, y - er * 1.35);
      g.lineTo(x + er * 0.5 * sx, y - er * 1.6);
      g.lineCap = "round";
      g.stroke();
    }
  }
  g.lineCap = "round";
  g.lineWidth = lw;
  g.strokeStyle = INK;
  g.beginPath();
  if (mood === "scream") {
    g.ellipse(0, r * 0.38, r * 0.18, r * 0.24, 0, 0, TAU);
    g.fillStyle = "#5A1E2A";
    g.fill();
    g.stroke();
  } else if (mood === "worried") {
    g.moveTo(-r * 0.22, r * 0.42);
    g.quadraticCurveTo(0, r * 0.26, r * 0.22, r * 0.42);
    g.stroke();
  } else {
    g.moveTo(-r * 0.24, r * 0.28);
    g.quadraticCurveTo(0, r * 0.5, r * 0.24, r * 0.28);
    g.stroke();
  }
}

// -------------------------------------------------------------------------------------------------------------
// Jars, the shelf, the magnet, the glove
// -------------------------------------------------------------------------------------------------------------

/** The jar's glass, anchored at its bottom centre, `w` × `h` CSS px (lid not included). */
export function makeJarGlass(w: number, h: number, scale: number): Sprite {
  return makeSprite(w + 14, h + 14, w / 2 + 4, h * 0.9 + 6, (g) => {
    const bw = w * 0.82;
    const bh = h * 0.72;
    const lw = Math.max(2.4, w * 0.045);
    // Hard shadow.
    g.beginPath();
    g.roundRect(-bw / 2 + 4, -bh + 5, bw, bh, bw * 0.24);
    g.fillStyle = INK;
    g.fill();
    g.beginPath();
    g.roundRect(-bw / 2, -bh, bw, bh, bw * 0.24);
    g.fillStyle = "#E4FAFF";
    g.fill();
    g.lineWidth = lw;
    g.strokeStyle = INK;
    g.stroke();
    // The neck.
    g.beginPath();
    g.roundRect(-bw * 0.42, -bh - h * 0.06, bw * 0.84, h * 0.09, 4);
    g.fillStyle = "#CDEFF7";
    g.fill();
    g.stroke();
    // Glass shine.
    g.fillStyle = "rgba(255,255,255,0.9)";
    g.beginPath();
    g.roundRect(-bw * 0.36, -bh * 0.86, bw * 0.1, bh * 0.62, bw * 0.05);
    g.fill();
    g.beginPath();
    g.arc(-bw * 0.31, -bh * 0.15, bw * 0.05, 0, TAU);
    g.fill();
  }, scale);
}

/** A jar's lid in a peg colour with that peg's shape stamped on it, centred. */
export function makeLid(kind: number, w: number, scale: number): Sprite {
  const p = PEGS[kind]!;
  const lw = w * 0.92;
  const lh = w * 0.3;
  return makeSprite(lw + 12, lh + 14, lw / 2 + 4, lh / 2 + 4, (g) => {
    g.lineJoin = "round";
    g.beginPath();
    g.roundRect(-lw / 2 + 3, -lh / 2 + 4, lw, lh, lh * 0.4);
    g.fillStyle = INK;
    g.fill();
    g.beginPath();
    g.roundRect(-lw / 2, -lh / 2, lw, lh, lh * 0.4);
    g.fillStyle = p.fill;
    g.fill();
    g.lineWidth = Math.max(2.4, w * 0.045);
    g.strokeStyle = INK;
    g.stroke();
    // Ridges along the lid.
    g.strokeStyle = p.shade;
    g.lineWidth = Math.max(1.5, w * 0.025);
    for (let k = -3; k <= 3; k++) {
      if (Math.abs(k) <= 1) continue;
      const x = (k / 3.6) * lw * 0.5;
      g.beginPath();
      g.moveTo(x, -lh * 0.28);
      g.lineTo(x, lh * 0.28);
      g.stroke();
    }
    // The peg's shape, in white with an ink line, so the jar reads without colour.
    g.save();
    headPath(g, kind, lh * 0.36);
    g.fillStyle = PAL.white;
    g.fill("nonzero");
    g.lineWidth = Math.max(1.4, w * 0.025);
    g.strokeStyle = INK;
    g.stroke();
    g.restore();
  }, scale);
}

/** The cherry shelf with `n` peg cups, `pitch` apart. */
export function makeShelf(n: number, slot: number, pitch: number, scale: number): Sprite {
  const w = pitch * n + 16;
  const h = slot + 14;
  return makeSprite(w + 10, h + 12, 2, 2, (g) => {
    const lw = 3.2;
    g.beginPath();
    g.roundRect(5, 7, w, h, 14);
    g.fillStyle = INK;
    g.fill();
    g.beginPath();
    g.roundRect(0, 0, w, h, 14);
    g.fillStyle = CHERRY;
    g.fill();
    g.lineWidth = lw;
    g.strokeStyle = INK;
    g.stroke();
    g.fillStyle = "rgba(255,255,255,0.55)";
    g.beginPath();
    g.roundRect(10, 4, w - 20, 4, 2);
    g.fill();
    for (let i = 0; i < n; i++) {
      const cx = 8 + pitch * i + slot / 2 + 2;
      const cy = 7 + slot / 2;
      g.beginPath();
      g.arc(cx, cy, slot * 0.42, 0, TAU);
      g.fillStyle = CHERRY_SHADE;
      g.fill();
      g.lineWidth = 2.4;
      g.strokeStyle = INK;
      g.stroke();
      g.beginPath();
      g.arc(cx, cy, slot * 0.16, 0, TAU);
      g.fillStyle = "#6E1420";
      g.fill();
    }
  }, scale);
}

/** A horseshoe magnet, `s` px tall. */
export function makeMagnet(s: number, scale: number, lit: boolean): Sprite {
  return makeSprite(s * 1.3, s * 1.3, s * 0.65, s * 0.62, (g) => {
    const lw = s * 0.26;
    const r = s * 0.3;
    g.lineCap = "butt";
    const arc = (dx: number, dy: number, color: string, w: number) => {
      g.beginPath();
      g.moveTo(-r + dx, s * 0.3 + dy);
      g.lineTo(-r + dx, dy);
      g.arc(dx, dy, r, Math.PI, 0, false);
      g.lineTo(r + dx, s * 0.3 + dy);
      g.lineWidth = w;
      g.strokeStyle = color;
      g.stroke();
    };
    arc(3, 4, INK, lw + 5);
    arc(0, 0, INK, lw + 5);
    arc(0, 0, lit ? CHERRY : "#B9AFC4", lw);
    // White tips.
    for (const sx of [-1, 1]) {
      g.beginPath();
      g.rect(sx * r - lw / 2, s * 0.14, lw, s * 0.16);
      g.fillStyle = PAL.white;
      g.fill();
      g.lineWidth = 2.5;
      g.strokeStyle = INK;
      g.stroke();
    }
    g.fillStyle = "rgba(255,255,255,0.6)";
    g.beginPath();
    g.arc(-r * 0.55, -r * 0.55, s * 0.05, 0, TAU);
    g.fill();
  }, scale);
}

/** juicefactory's cartoon glove, pointing up; the fingertip is at (0.2, -0.06) × size from the anchor. */
export function makeGlove(size: number, scale: number): Sprite {
  const s = size;
  return makeSprite(s * 1.4, s * 1.7, s * 0.1, s * 0.12, (g) => {
    const lw = Math.max(2, s * 0.07);
    const parts: Array<(g2: CanvasRenderingContext2D) => void> = [
      (g2) => {
        g2.moveTo(s * 0.14, s * 1.05);
        g2.lineTo(s * 0.86, s * 1.05);
        g2.lineTo(s * 0.9, s * 1.36);
        g2.lineTo(s * 0.1, s * 1.36);
        g2.closePath();
      },
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

/** The tiled diner wall over a checkered counter, framed, in screen px (drawn once per layout). */
export function makeWallPanel(w: number, h: number, u: number, counterTop: number, scale: number): Sprite {
  const pad = 14;
  return makeSprite(w + pad * 2 + 6, h + pad * 2 + 8, pad, pad, (g) => {
    const frame = Math.max(7, u * 0.16);
    // Frame with a hard shadow.
    g.beginPath();
    g.roundRect(-frame + 5, -frame + 7, w + frame * 2, counterTop + frame * 2, frame + 8);
    g.fillStyle = INK;
    g.fill();
    g.beginPath();
    g.roundRect(-frame, -frame, w + frame * 2, counterTop + frame * 2, frame + 8);
    g.fillStyle = PAL.white;
    g.fill();
    g.lineWidth = 3.5;
    g.strokeStyle = INK;
    g.stroke();
    // Tiles.
    g.save();
    g.beginPath();
    g.roundRect(0, 0, w, counterTop, 8);
    g.clip();
    g.fillStyle = TILE;
    g.fillRect(0, 0, w, counterTop);
    const t = u * 0.75;
    g.strokeStyle = GROUT;
    g.lineWidth = Math.max(1.5, u * 0.04);
    for (let x = t; x < w; x += t) {
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, counterTop);
      g.stroke();
    }
    for (let y = t; y < counterTop; y += t) {
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(w, y);
      g.stroke();
    }
    // A soft halftone fade toward the bottom of the wall.
    g.fillStyle = "rgba(20,168,125,0.10)";
    const sp = Math.max(6, u * 0.18);
    for (let y = counterTop * 0.45; y < counterTop + sp; y += sp * 0.5) {
      const row = Math.round(y / (sp * 0.5));
      // The first row sits at k = 0, which floating point can land a hair below; arc() throws on a negative radius.
      const k = Math.min(1, Math.max(0, (y / counterTop - 0.45) / 0.55));
      if (k === 0) continue;
      for (let x = row % 2 ? sp / 2 : 0; x < w + sp; x += sp) {
        g.beginPath();
        g.arc(x, y, sp * 0.42 * k, 0, TAU);
        g.fill();
      }
    }
    g.restore();
    g.lineWidth = 3;
    g.strokeStyle = INK;
    g.beginPath();
    g.roundRect(0, 0, w, counterTop, 8);
    g.stroke();
    // The counter: a cream top, a checkered front.
    const ch = h - counterTop;
    g.beginPath();
    g.roundRect(-frame - 4 + 4, counterTop + 5, w + frame * 2 + 8, ch, 8);
    g.fillStyle = INK;
    g.fill();
    g.beginPath();
    g.roundRect(-frame - 4, counterTop, w + frame * 2 + 8, ch, 8);
    g.fillStyle = PAL.cream;
    g.fill();
    g.save();
    g.clip();
    const cs = ch * 0.5;
    for (let row = 0; row < 2; row++)
      for (let x = -frame - 4, i = 0; x < w + frame + 8; x += cs, i++) {
        if ((i + row) % 2) continue;
        g.fillStyle = INK;
        g.fillRect(x, counterTop + ch * 0.18 + row * cs * 0.82, cs, cs * 0.82);
      }
    g.fillStyle = CHERRY;
    g.fillRect(-frame - 4, counterTop, w + frame * 2 + 8, ch * 0.18);
    g.restore();
    g.lineWidth = 3.2;
    g.strokeStyle = INK;
    g.beginPath();
    g.roundRect(-frame - 4, counterTop, w + frame * 2 + 8, ch, 8);
    g.stroke();
  }, scale);
}
