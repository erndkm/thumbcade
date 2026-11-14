/**
 * Rowlock's look: a brass-and-ink keypad at midnight. Keys are raised caps on dark plates, one plate per box,
 * with clear space between boxes instead of ruled lines. Given digits are paper on raised keys; your digits are
 * brass on keys that stay pressed down, so the two read apart by shape as well as colour.
 */
import { FONT_DISPLAY, FONT_MONO, rgba, roundRect } from "@thumbcade-games/kit";

export const PAL = {
  bg: "#0A0C10",
  bgDeep: "#050608",
  plate: "#11151B",
  plateAlt: "#141920",
  plateLine: "#1D232C",
  key: "#1F252E",
  keyTop: "#262D37",
  keyLip: "#0B0E12",
  keyDown: "#171C23",
  accent: "#C6AA39",
  accentHot: "#EAD58A",
  accentDeep: "#5A4A12",
  heat: "#FF4A3D",
  paper: "#F3F0E8",
  dim: "#A7A3AE",
  mute: "#6E6A78",
  ink: "#0D0D10",
} as const;

export const digitFont = (px: number) => `900 ${Math.round(px)}px ${FONT_DISPLAY}`;
export const monoFont = (px: number) => `${Math.round(px)}px ${FONT_MONO}`;

export type KeyState = "empty" | "given" | "placed";

export interface KeyLook {
  state: KeyState;
  digit: number;
  /** 0-1 brass glow on the cap (a lock sweep, the armed digit). */
  glow: number;
  /** Pressed by a finger right now. */
  pressed: boolean;
  /** Lit by a lamp. */
  lit: boolean;
  /** Scale for pop-ins. */
  scale: number;
  alpha: number;
  /** Digit colour override (a wrong digit, the armed digit). */
  ink?: string;
}

/** One key: a raised cap (or a cap held down) with its digit. */
export function drawKey(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, k: KeyLook): void {
  if (k.alpha <= 0.01 || k.scale <= 0.01) return;
  ctx.save();
  ctx.globalAlpha = k.alpha;
  const cx = x + s / 2;
  const cy = y + s / 2;
  ctx.translate(cx, cy);
  ctx.scale(k.scale, k.scale);
  const r = s * 0.2;
  const lip = Math.max(2, s * 0.07);
  const down = k.state === "placed" || k.pressed;
  const sink = down ? lip * 0.75 : 0;
  // The lip under the cap: a raised key shows it, a pressed key has sunk onto it.
  ctx.fillStyle = PAL.keyLip;
  roundRect(ctx, -s / 2, -s / 2 + lip, s, s - lip, r);
  ctx.fill();
  ctx.fillStyle = down ? PAL.keyDown : k.state === "given" ? PAL.keyTop : PAL.key;
  roundRect(ctx, -s / 2, -s / 2 + sink, s, s - lip, r);
  ctx.fill();
  if (!down) {
    // A hair of light on the top edge of a raised cap.
    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-s / 2 + r, -s / 2 + 0.5);
    ctx.lineTo(s / 2 - r, -s / 2 + 0.5);
    ctx.stroke();
  } else {
    // A pressed key carries a short brass bar under its digit.
    ctx.fillStyle = rgba(PAL.accent, k.state === "placed" ? 0.55 : 0.2);
    roundRect(ctx, -s * 0.16, -s / 2 + sink + (s - lip) * 0.82, s * 0.32, Math.max(2, s * 0.045), 2);
    ctx.fill();
  }
  if (k.glow > 0.01) {
    // A lock sweep lights the cap brass for a moment.
    ctx.fillStyle = rgba(PAL.accent, 0.9 * k.glow);
    roundRect(ctx, -s / 2, -s / 2 + sink, s, s - lip, r);
    ctx.fill();
  }
  if (k.digit) {
    ctx.font = digitFont(s * 0.5);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = k.ink ?? (k.state === "given" ? PAL.paper : PAL.accent);
    ctx.fillText(String(k.digit), 0, sink - lip / 2 + s * 0.035);
  }
  if (k.lit) drawSpark(ctx, s * 0.3, -s * 0.3 + sink, s * 0.09, PAL.accentHot);
  ctx.restore();
}

/** A four-point star (the spark key, a lamp-lit key). */
export function drawSpark(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.quadraticCurveTo(x + r * 0.18, y - r * 0.18, x + r, y);
  ctx.quadraticCurveTo(x + r * 0.18, y + r * 0.18, x, y + r);
  ctx.quadraticCurveTo(x - r * 0.18, y + r * 0.18, x - r, y);
  ctx.quadraticCurveTo(x - r * 0.18, y - r * 0.18, x, y - r);
  ctx.fill();
}

/** A lamp: a round bulb on a short brass collar. */
export function drawLamp(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, color: string, filled: boolean): void {
  ctx.save();
  ctx.lineWidth = Math.max(1.5, s * 0.11);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y - s * 0.12, s * 0.32, Math.PI * 0.8, Math.PI * 2.2);
  ctx.lineTo(x + s * 0.14, y + s * 0.26);
  ctx.lineTo(x - s * 0.14, y + s * 0.26);
  ctx.closePath();
  if (filled) ctx.fill();
  else ctx.stroke();
  ctx.fillRect(x - s * 0.15, y + s * 0.32, s * 0.3, s * 0.09);
  ctx.fillRect(x - s * 0.1, y + s * 0.45, s * 0.2, s * 0.07);
  ctx.restore();
}

/** The rowlock mark: a U-shaped oar fork on a short stem (drawn on locked rows, columns and boxes). */
export function drawLockMark(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, angle: number, color: string): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.strokeStyle = color;
  ctx.lineCap = "round";
  ctx.lineWidth = Math.max(1.6, s * 0.18);
  ctx.beginPath();
  ctx.moveTo(-s * 0.36, -s * 0.42);
  ctx.lineTo(-s * 0.36, -s * 0.05);
  ctx.arc(0, -s * 0.05, s * 0.36, Math.PI, 0, true);
  ctx.lineTo(s * 0.36, -s * 0.42);
  ctx.moveTo(0, s * 0.31);
  ctx.lineTo(0, s * 0.5);
  ctx.stroke();
  ctx.restore();
}

/** A check mark (a finished digit on the pad). */
export function drawCheck(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, color: string): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1.5, s * 0.16);
  ctx.lineCap = "square";
  ctx.lineJoin = "miter";
  ctx.beginPath();
  ctx.moveTo(x - s * 0.4, y);
  ctx.lineTo(x - s * 0.12, y + s * 0.28);
  ctx.lineTo(x + s * 0.42, y - s * 0.3);
  ctx.stroke();
  ctx.restore();
}

/** A small calendar tab (today's grid). */
export function drawCalendar(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, color: string): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = Math.max(1.2, s * 0.12);
  roundRect(ctx, x - s / 2, y - s * 0.38, s, s * 0.86, s * 0.14);
  ctx.stroke();
  ctx.fillRect(x - s / 2, y - s * 0.38, s, s * 0.24);
  ctx.fillRect(x - s * 0.3, y - s * 0.56, s * 0.12, s * 0.26);
  ctx.fillRect(x + s * 0.18, y - s * 0.56, s * 0.12, s * 0.26);
  ctx.restore();
}
