/**
 * The marks printed on the slips: twelve of my own, mostly printer's sorts, each drawn as a stamp in one of four
 * inks. Every mark has its own silhouette, so the heap reads without colour: tall ones (pilcrow, dagger), round ones
 * (ring, crescent), clusters (asterism, three dots), lines (waves, saltire) and curls (section, leaf, ampersand).
 */
import { BLUE, INK, italic, rgba } from "./qm/palette.ts";

/** The stamp-pad violet of a date stamp (the game's accent) and an iron-gall brown. */
export const VIOLET = "#7D5BA6";
export const UMBER = "#8B5A33";

export interface Mark {
  name: string;
  ink: string;
}

export const MARKS: readonly Mark[] = [
  { name: "pilcrow", ink: INK },
  { name: "ring", ink: VIOLET },
  { name: "dagger", ink: BLUE },
  { name: "crescent", ink: UMBER },
  { name: "asterism", ink: INK },
  { name: "section", ink: VIOLET },
  { name: "diamond", ink: BLUE },
  { name: "leaf", ink: UMBER },
  { name: "therefore", ink: VIOLET },
  { name: "waves", ink: INK },
  { name: "saltire", ink: UMBER },
  { name: "ampersand", ink: BLUE },
];

type G = CanvasRenderingContext2D;

function stroke(g: G, w: number, color: string, alpha: number) {
  g.lineCap = "round";
  g.lineJoin = "round";
  g.strokeStyle = rgba(color, 0.1 * alpha);
  g.lineWidth = w * 1.9;
  g.stroke();
  g.strokeStyle = rgba(color, 0.92 * alpha);
  g.lineWidth = w;
  g.stroke();
}

function fill(g: G, color: string, alpha: number) {
  g.fillStyle = rgba(color, 0.92 * alpha);
  g.fill();
}

function dot(g: G, x: number, y: number, r: number) {
  g.moveTo(x + r, y);
  g.arc(x, y, r, 0, Math.PI * 2);
}

function asterisk(g: G, x: number, y: number, r: number, w: number, color: string, alpha: number) {
  g.beginPath();
  for (let i = 0; i < 3; i++) {
    const a = (i * Math.PI) / 3 + Math.PI / 2;
    g.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    g.lineTo(x - Math.cos(a) * r, y - Math.sin(a) * r);
  }
  stroke(g, w, color, alpha);
}

/**
 * Draws mark `kind` centred at (0, 0), `s` px across, in its own ink (or `color`), at `alpha`.
 * Line weights scale with `s`, so small tray copies read like the big ones.
 */
export function drawMark(g: G, kind: number, s: number, alpha = 1, color?: string): void {
  const m = MARKS[kind % MARKS.length]!;
  const c = color ?? m.ink;
  const w = Math.max(1.4, s * 0.085);
  const h = s / 2;
  g.save();
  switch (m.name) {
    case "pilcrow": {
      // A filled bowl on the left, two stems down.
      g.beginPath();
      g.moveTo(h * 0.05, -h * 0.82);
      g.lineTo(-h * 0.3, -h * 0.82);
      g.bezierCurveTo(-h * 0.92, -h * 0.82, -h * 0.92, h * 0.02, -h * 0.3, h * 0.02);
      g.lineTo(h * 0.05, h * 0.02);
      g.closePath();
      fill(g, c, alpha);
      g.beginPath();
      g.moveTo(h * 0.05, -h * 0.82);
      g.lineTo(h * 0.05, h * 0.86);
      g.moveTo(h * 0.46, -h * 0.82);
      g.lineTo(h * 0.46, h * 0.86);
      g.moveTo(-h * 0.3, -h * 0.82);
      g.lineTo(h * 0.62, -h * 0.82);
      stroke(g, w, c, alpha);
      break;
    }
    case "ring": {
      g.beginPath();
      g.arc(0, 0, h * 0.74, 0, Math.PI * 2);
      stroke(g, w * 1.05, c, alpha);
      g.beginPath();
      dot(g, 0, 0, h * 0.24);
      fill(g, c, alpha);
      break;
    }
    case "dagger": {
      g.beginPath();
      g.moveTo(0, -h * 0.84);
      g.lineTo(0, h * 0.4);
      g.moveTo(-h * 0.5, -h * 0.4);
      g.lineTo(h * 0.5, -h * 0.4);
      stroke(g, w * 1.45, c, alpha);
      // A knob on top and a long pointed foot.
      g.beginPath();
      dot(g, 0, -h * 0.84, w * 1.05);
      g.moveTo(-w * 1.05, h * 0.2);
      g.lineTo(0, h * 0.96);
      g.lineTo(w * 1.05, h * 0.2);
      g.closePath();
      fill(g, c, alpha);
      break;
    }
    case "crescent": {
      g.beginPath();
      g.arc(0, 0, h * 0.78, Math.PI * 0.32, Math.PI * 1.68, false);
      g.arc(h * 0.34, -h * 0.06, h * 0.6, Math.PI * 1.55, Math.PI * 0.45, true);
      g.closePath();
      fill(g, c, alpha);
      break;
    }
    case "asterism": {
      const r = h * 0.34;
      asterisk(g, 0, -h * 0.36, r, w * 0.8, c, alpha);
      asterisk(g, -h * 0.42, h * 0.36, r, w * 0.8, c, alpha);
      asterisk(g, h * 0.42, h * 0.36, r, w * 0.8, c, alpha);
      break;
    }
    case "section": {
      // Two linked esses, the way a printer's section mark loops.
      g.beginPath();
      g.moveTo(h * 0.38, -h * 0.66);
      g.bezierCurveTo(h * 0.2, -h * 0.94, -h * 0.5, -h * 0.9, -h * 0.4, -h * 0.5);
      g.bezierCurveTo(-h * 0.3, -h * 0.14, h * 0.48, -h * 0.12, h * 0.42, h * 0.22);
      g.bezierCurveTo(h * 0.36, h * 0.5, -h * 0.1, h * 0.5, -h * 0.2, h * 0.3);
      g.moveTo(-h * 0.38, h * 0.66);
      g.bezierCurveTo(-h * 0.2, h * 0.94, h * 0.5, h * 0.9, h * 0.4, h * 0.5);
      g.bezierCurveTo(h * 0.3, h * 0.14, -h * 0.48, h * 0.12, -h * 0.42, -h * 0.22);
      g.bezierCurveTo(-h * 0.36, -h * 0.5, h * 0.1, -h * 0.5, h * 0.2, -h * 0.3);
      stroke(g, w * 0.95, c, alpha);
      break;
    }
    case "diamond": {
      g.beginPath();
      g.moveTo(0, -h * 0.86);
      g.lineTo(h * 0.62, 0);
      g.lineTo(0, h * 0.86);
      g.lineTo(-h * 0.62, 0);
      g.closePath();
      stroke(g, w * 1.05, c, alpha);
      g.beginPath();
      g.moveTo(0, -h * 0.3);
      g.lineTo(h * 0.22, 0);
      g.lineTo(0, h * 0.3);
      g.lineTo(-h * 0.22, 0);
      g.closePath();
      fill(g, c, alpha);
      break;
    }
    case "leaf": {
      // A hedera leaf with a curled stem.
      g.beginPath();
      g.moveTo(0, h * 0.42);
      g.bezierCurveTo(-h * 0.95, -h * 0.1, -h * 0.55, -h * 0.95, 0, -h * 0.42);
      g.bezierCurveTo(h * 0.55, -h * 0.95, h * 0.95, -h * 0.1, 0, h * 0.42);
      g.closePath();
      fill(g, c, alpha);
      g.beginPath();
      g.moveTo(0, h * 0.4);
      g.bezierCurveTo(0, h * 0.75, h * 0.42, h * 0.85, h * 0.5, h * 0.6);
      stroke(g, w * 0.85, c, alpha);
      break;
    }
    case "therefore": {
      g.beginPath();
      const r = h * 0.25;
      dot(g, 0, -h * 0.44, r);
      dot(g, -h * 0.46, h * 0.38, r);
      dot(g, h * 0.46, h * 0.38, r);
      fill(g, c, alpha);
      break;
    }
    case "waves": {
      g.beginPath();
      for (const y of [-h * 0.3, h * 0.3]) {
        g.moveTo(-h * 0.78, y + h * 0.06);
        g.bezierCurveTo(-h * 0.45, y - h * 0.34, -h * 0.15, y - h * 0.3, 0, y);
        g.bezierCurveTo(h * 0.15, y + h * 0.3, h * 0.45, y + h * 0.34, h * 0.78, y - h * 0.06);
      }
      stroke(g, w * 1.1, c, alpha);
      break;
    }
    case "saltire": {
      g.beginPath();
      g.moveTo(-h * 0.62, -h * 0.62);
      g.lineTo(h * 0.62, h * 0.62);
      g.moveTo(h * 0.62, -h * 0.62);
      g.lineTo(-h * 0.62, h * 0.62);
      stroke(g, w * 1.5, c, alpha);
      break;
    }
    case "ampersand": {
      g.fillStyle = rgba(c, 0.94 * alpha);
      g.textAlign = "center";
      g.textBaseline = "alphabetic";
      g.font = italic(s * 1.08);
      g.fillText("&", 0, s * 0.33);
      break;
    }
  }
  g.restore();
}
