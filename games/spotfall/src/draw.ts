/**
 * Spotfall's print: three spot inks (blue, fluorescent pink, yellow) on warm paper, and six dot inks made from them,
 * three straight and three overprinted (green = blue over yellow, orange = pink over yellow, violet = blue over pink).
 * Every dot also carries its own printed mark, so the sheet reads without colour: ring, dot, plus, diamond, triangle,
 * bars. The registration mark (any ink) and the ink blot print on all three plates.
 */
import { BOMB, PLATES, WILD } from "./board.ts";
import { RISO, type Ink, type Press } from "./riso.ts";

export const PLATE = ["blue", "pink", "yellow"] as const;
export type PlateName = (typeof PLATE)[number];

/** Plate order matters only for registration: the blue key plate stays put. */
export const INKS: Ink[] = [
  { name: "blue", color: RISO.blue, angle: 0.26 },
  { name: "pink", color: RISO.fluoPink, angle: 1.31 },
  { name: "yellow", color: RISO.yellow, angle: 0.79 },
];

/** Which plates each dot kind prints on (specials on all three). */
export function platesOf(kind: number): ReadonlyArray<0 | 1 | 2> {
  if (kind === WILD || kind === BOMB) return [0, 1, 2];
  return PLATES[kind] ?? [0];
}

/** The plate to print a dot's popup and particles in (its darkest ink). */
export function mainPlate(kind: number): PlateName {
  const p = platesOf(kind);
  return PLATE[p.includes(0) ? 0 : p.includes(1) ? 1 : 2];
}

const TAU = Math.PI * 2;

export function hash(n: number, seed = 0): number {
  let h = Math.imul((n | 0) ^ 0x2c1b3c6d, 0x9e3779b1) ^ Math.imul(seed | 0, 0x85ebca77);
  h = Math.imul(h ^ (h >>> 15), 0x297a2d39);
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
}

// ---------------------------------------------------------------------------------------------------------------
// Marks
// ---------------------------------------------------------------------------------------------------------------

/** Adds the mark of ink `kind` to the current path, centred on the origin, for a dot `s` px across. */
function markPath(g: CanvasRenderingContext2D, kind: number, s: number): void {
  g.beginPath();
  switch (kind) {
    case 0: // ring
      g.arc(0, 0, s * 0.215, 0, TAU);
      g.arc(0, 0, s * 0.13, 0, TAU, true);
      break;
    case 1: {
      // star
      for (let i = 0; i < 10; i++) {
        const t = -Math.PI / 2 + (i * TAU) / 10;
        const k = i % 2 ? s * 0.095 : s * 0.235;
        if (i === 0) g.moveTo(Math.cos(t) * k, Math.sin(t) * k + s * 0.01);
        else g.lineTo(Math.cos(t) * k, Math.sin(t) * k + s * 0.01);
      }
      g.closePath();
      break;
    }
    case 2: {
      // plus
      const a = s * 0.2;
      const b = s * 0.055;
      g.rect(-a, -b, a * 2, b * 2);
      g.rect(-b, -a, b * 2, a * 2);
      break;
    }
    case 3: {
      // diamond
      const a = s * 0.19;
      g.moveTo(0, -a);
      g.lineTo(a, 0);
      g.lineTo(0, a);
      g.lineTo(-a, 0);
      g.closePath();
      break;
    }
    case 4: {
      // triangle
      const a = s * 0.21;
      for (let i = 0; i < 3; i++) {
        const t = -Math.PI / 2 + (i * TAU) / 3;
        if (i === 0) g.moveTo(Math.cos(t) * a, Math.sin(t) * a + s * 0.03);
        else g.lineTo(Math.cos(t) * a, Math.sin(t) * a + s * 0.03);
      }
      g.closePath();
      break;
    }
    default: {
      // bars
      const w = s * 0.19;
      const h = s * 0.05;
      g.rect(-w, -s * 0.085 - h, w * 2, h * 2);
      g.rect(-w, s * 0.085 - h, w * 2, h * 2);
    }
  }
}

/** An ink blot: a lumpy disc with a few lobes. Deterministic in `seed`. */
export function blotPath(g: CanvasRenderingContext2D, x: number, y: number, r: number, seed: number, lobes = 9, rough = 0.22): void {
  g.beginPath();
  const n = lobes * 4;
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * TAU;
    const lobe = Math.sin(t * lobes + hash(seed, 1) * TAU) * 0.5 + 0.5;
    const k = 1 + (lobe * lobe - 0.3) * rough + (hash(i % n, seed) - 0.5) * rough * 0.35;
    const px = x + Math.cos(t) * r * k;
    const py = y + Math.sin(t) * r * k;
    if (i === 0) g.moveTo(px, py);
    else g.lineTo(px, py);
  }
  g.closePath();
}

// ---------------------------------------------------------------------------------------------------------------
// Dot sprites
// ---------------------------------------------------------------------------------------------------------------

export interface DotArt {
  /** Diameter in CSS px. */
  s: number;
  /** [kind][plate] → sprite or null. */
  sprites: Array<Array<HTMLCanvasElement | null>>;
  /** Sprite size in CSS px (square, centred). */
  box: number;
}

/** Draws every dot kind on every plate once, at device resolution. */
export function makeDotArt(s: number, scale: number): DotArt {
  const box = Math.ceil(s * 1.24);
  const sprites: Array<Array<HTMLCanvasElement | null>> = [];
  for (let kind = 0; kind <= BOMB; kind++) {
    const row: Array<HTMLCanvasElement | null> = [];
    for (let plate = 0; plate < 3; plate++) row.push(drawDot(kind, plate as 0 | 1 | 2, s, box, scale));
    sprites.push(row);
  }
  return { s, sprites, box };
}

function drawDot(kind: number, plate: 0 | 1 | 2, s: number, box: number, scale: number): HTMLCanvasElement | null {
  const color = INKS[plate]!.color;
  const on = platesOf(kind).includes(plate);
  // Yellow's mark is printed in blue (it would vanish knocked out of yellow), so the blue plate carries it.
  const yellowMark = kind === 2 && plate === 0;
  if (!on && !yellowMark) return null;
  const c = document.createElement("canvas");
  c.width = c.height = Math.ceil(box * scale);
  const g = c.getContext("2d")!;
  g.scale(scale, scale);
  g.translate(box / 2, box / 2);
  g.fillStyle = color;
  g.strokeStyle = color;
  const r = s * 0.47;
  if (yellowMark) {
    markPath(g, 2, s);
    g.fill();
    return c;
  }
  if (kind === WILD) {
    // A registration mark: two rings and a crosshair, on every plate.
    g.lineWidth = Math.max(1.4, s * 0.06);
    g.beginPath();
    g.arc(0, 0, r * 0.9, 0, TAU);
    g.stroke();
    g.beginPath();
    g.arc(0, 0, r * 0.42, 0, TAU);
    g.fill();
    g.globalCompositeOperation = "destination-out";
    g.beginPath();
    g.arc(0, 0, r * 0.26, 0, TAU);
    g.fill();
    g.globalCompositeOperation = "source-over";
    g.beginPath();
    g.moveTo(-r * 1.12, 0);
    g.lineTo(r * 1.12, 0);
    g.moveTo(0, -r * 1.12);
    g.lineTo(0, r * 1.12);
    g.stroke();
    return c;
  }
  if (kind === BOMB) {
    // An ink blot with a paper star knocked out of it.
    blotPath(g, 0, 0, r * 0.95, 17 + plate, 7, 0.3);
    g.fill();
    for (let i = 0; i < 3; i++) {
      const a = hash(i, 5) * TAU;
      g.beginPath();
      g.arc(Math.cos(a) * r * 1.12, Math.sin(a) * r * 1.12, r * (0.08 + hash(i, 6) * 0.07), 0, TAU);
      g.fill();
    }
    g.globalCompositeOperation = "destination-out";
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * TAU) / 10;
      const k = i % 2 ? r * 0.16 : r * 0.42;
      if (i === 0) g.moveTo(Math.cos(a) * k, Math.sin(a) * k);
      else g.lineTo(Math.cos(a) * k, Math.sin(a) * k);
    }
    g.closePath();
    g.fill();
    return c;
  }
  g.beginPath();
  g.arc(0, 0, r, 0, TAU);
  g.fill();
  g.globalCompositeOperation = "destination-out";
  // A small printed shine, knocked out to paper.
  g.beginPath();
  g.ellipse(-r * 0.5, -r * 0.52, r * 0.17, r * 0.09, -0.75, 0, TAU);
  g.fill();
  if (kind !== 2) {
    markPath(g, kind, s);
    g.fill();
  }
  return c;
}

/** Prints a dot of `kind` centred at (x, y), `scale` times its size, rotated by `rot`. */
export function printDot(press: Press, art: DotArt, kind: number, x: number, y: number, scale = 1, rot = 0): void {
  const row = art.sprites[kind];
  if (!row) return;
  const b = art.box * scale;
  for (let p = 0; p < 3; p++) {
    const spr = row[p];
    if (!spr) continue;
    const g = press.plate(PLATE[p]!);
    if (rot) {
      g.translate(x, y);
      g.rotate(rot);
      g.drawImage(spr, -b / 2, -b / 2, b, b);
      press.plate(PLATE[p]!);
    } else g.drawImage(spr, x - b / 2, y - b / 2, b, b);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// The squid
// ---------------------------------------------------------------------------------------------------------------

export interface SquidPose {
  /** Tilt toward the aim (radians, 0 = upright). */
  tilt: number;
  /** 0..1: the squish after a shot. */
  recoil: number;
  /** Where the eyes look, -1..1. */
  lookX: number;
  lookY: number;
  /** 0..1 eyelids. */
  blink: number;
  /** 0..1: wide eyes near the line. */
  worry: number;
  /** 0..1: a wiggle after a big drop. */
  joy: number;
  time: number;
}

/**
 * The launcher: a small pink squid sitting in the ink pot, arms cupped round the dot it is about to throw. (x, y) is the
 * launch point (where the loaded dot sits); `s` is a dot's diameter.
 */
export function drawSquid(press: Press, x: number, y: number, s: number, pose: SquidPose, reduced: boolean): void {
  const pink = press.plate("pink");
  const blue = press.plate("blue");
  const t = pose.time;
  const wig = reduced ? 0 : Math.sin(t * 2.2) * 0.04 + pose.joy * Math.sin(t * 18) * 0.12;
  const sq = 1 - pose.recoil * 0.14;
  const headY = y + s * 0.78;
  for (const [g, pass] of [
    [pink, 0],
    [blue, 1],
  ] as const) {
    g.save();
    g.translate(x, headY);
    g.rotate(pose.tilt + wig);
    g.scale(1 + pose.recoil * 0.1, sq);
    if (pass === 0) {
      g.fillStyle = press.solid("pink");
      // Mantle: a long rounded cone going down into the pot, with two fins at its tip.
      g.beginPath();
      g.moveTo(-s * 0.4, s * 0.05);
      g.bezierCurveTo(-s * 0.46, s * 0.7, -s * 0.22, s * 1.25, 0, s * 1.55);
      g.bezierCurveTo(s * 0.22, s * 1.25, s * 0.46, s * 0.7, s * 0.4, s * 0.05);
      g.closePath();
      g.fill();
      g.beginPath();
      g.moveTo(-s * 0.12, s * 1.2);
      g.lineTo(-s * 0.5, s * 1.42);
      g.lineTo(-s * 0.05, s * 1.5);
      g.moveTo(s * 0.12, s * 1.2);
      g.lineTo(s * 0.5, s * 1.42);
      g.lineTo(s * 0.05, s * 1.5);
      g.fill();
      // Head.
      g.beginPath();
      g.ellipse(0, 0, s * 0.46, s * 0.36, 0, 0, TAU);
      g.fill();
      // Arms: six, cupped up round the dot, curling at the tips.
      g.lineCap = "round";
      g.strokeStyle = press.solid("pink");
      for (let i = 0; i < 6; i++) {
        const side = i < 3 ? -1 : 1;
        const j = i % 3;
        const sway = reduced ? 0 : Math.sin(t * 3.1 + i * 1.3) * 0.05;
        const spread = 1 + pose.recoil * 0.35;
        const bx = side * s * (0.1 + j * 0.12);
        const tipX = side * s * (0.28 + j * 0.12) * spread + sway * s;
        const tipY = -s * (0.42 + (2 - j) * 0.12) + pose.recoil * s * 0.08;
        g.lineWidth = s * (0.13 - j * 0.02);
        g.beginPath();
        g.moveTo(bx, -s * 0.18);
        g.quadraticCurveTo(side * s * (0.42 + j * 0.06) * spread, -s * 0.36, tipX, tipY);
        g.stroke();
        g.lineWidth = s * 0.06;
        g.beginPath();
        g.arc(tipX - side * s * 0.05, tipY, s * 0.05, side < 0 ? Math.PI : 0, side < 0 ? Math.PI * 2.2 : -Math.PI * 1.2, side > 0);
        g.stroke();
      }
      // Eyes: paper whites knocked out of the head.
      g.globalCompositeOperation = "destination-out";
      const ew = s * (0.12 + pose.worry * 0.03);
      for (const ex of [-0.19, 0.19]) {
        g.beginPath();
        g.ellipse(ex * s, -s * 0.02, ew, ew * (1 - pose.blink * 0.92), 0, 0, TAU);
        g.fill();
      }
      g.globalCompositeOperation = "source-over";
    } else {
      // Blue: a halftone shade down one side of the mantle (pink over blue prints violet), the pupils and the mouth.
      g.fillStyle = press.screen("blue", 0.42);
      g.beginPath();
      g.moveTo(s * 0.05, s * 0.2);
      g.bezierCurveTo(s * 0.18, s * 0.7, s * 0.12, s * 1.2, 0, s * 1.55);
      g.bezierCurveTo(s * 0.22, s * 1.25, s * 0.46, s * 0.7, s * 0.4, s * 0.05);
      g.closePath();
      g.fill();
      g.fillStyle = press.solid("blue");
      if (pose.blink < 0.6) {
        const pr = s * (0.06 - pose.worry * 0.015);
        for (const ex of [-0.19, 0.19]) {
          g.beginPath();
          g.arc(ex * s + pose.lookX * s * 0.05, -s * 0.02 + pose.lookY * s * 0.05, pr, 0, TAU);
          g.fill();
        }
      }
      g.lineWidth = s * 0.035;
      g.strokeStyle = press.solid("blue");
      g.lineCap = "round";
      g.beginPath();
      if (pose.worry > 0.5) g.arc(0, s * 0.2, s * 0.06, Math.PI * 1.15, Math.PI * 1.85);
      else g.arc(0, s * 0.12, s * (0.06 + pose.joy * 0.03), Math.PI * 0.15, Math.PI * 0.85);
      g.stroke();
    }
    g.restore();
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Furniture: the drum, the pot, registration marks, the thumbprint
// ---------------------------------------------------------------------------------------------------------------

/** Crosshair registration mark printed on every plate (each plate a hair off, as on a real sheet). */
export function registrationMark(press: Press, x: number, y: number, r: number): void {
  for (const ink of PLATE) {
    const c = press.plate(ink);
    c.strokeStyle = press.solid(ink);
    c.lineWidth = 1;
    c.beginPath();
    c.arc(x, y, r, 0, TAU);
    c.moveTo(x - r * 1.6, y);
    c.lineTo(x + r * 1.6, y);
    c.moveTo(x, y - r * 1.6);
    c.lineTo(x, y + r * 1.6);
    c.stroke();
  }
}

/**
 * The press drum across the top of the sheet: a blue roller with paper ridges that turn as it feeds, and a pink nip
 * line along its edge. `turn` scrolls the ridges, `shudder` (0..1) shakes it before a feed.
 */
export function drawDrum(press: Press, x0: number, x1: number, yBottom: number, h: number, turn: number, shudder: number, time: number, reduced: boolean): void {
  const blue = press.plate("blue");
  const jy = reduced ? 0 : Math.sin(time * 41) * shudder * 1.4;
  const top = yBottom - h + jy;
  blue.fillStyle = press.solid("blue");
  blue.fillRect(x0, top, x1 - x0, h);
  // Ridges.
  blue.save();
  blue.beginPath();
  blue.rect(x0, top, x1 - x0, h);
  blue.clip();
  blue.globalCompositeOperation = "destination-out";
  const gap = h / 3;
  const off = (((turn % 1) + 1) % 1) * gap;
  for (let y = top - gap + off; y < top + h; y += gap) blue.fillRect(x0, y, x1 - x0, Math.max(1, h * 0.09));
  blue.restore();
  const pink = press.plate("pink");
  pink.fillStyle = press.solid("pink");
  pink.fillRect(x0, yBottom + jy - 1.5, x1 - x0, 3);
  // The roller's upper half overprinted with a pink screen: it reads round.
  pink.fillStyle = press.screen("pink", 0.35);
  pink.fillRect(x0, top, x1 - x0, h * 0.45);
}

/** The ink pot along the bottom: a blue pool with a slow wavy surface, its depth screened darker. */
export function drawPot(press: Press, W: number, H: number, surface: number, time: number, ripples: Array<{ x: number; t: number; a: number }>, reduced: boolean): void {
  const blue = press.plate("blue");
  const wave = (x: number) => {
    let y = surface + (reduced ? 0 : Math.sin(x * 0.03 + time * 1.4) * 2 + Math.sin(x * 0.071 - time * 1.9) * 1.2);
    for (const r of ripples) {
      const d = Math.abs(x - r.x);
      const k = Math.max(0, 1 - r.t / 0.9);
      y -= Math.cos(d * 0.12 - r.t * 14) * Math.exp(-d / 30) * 5 * k * r.a;
    }
    return y;
  };
  blue.beginPath();
  blue.moveTo(0, H + 2);
  for (let x = 0; x <= W + 8; x += 8) blue.lineTo(x, wave(x));
  blue.lineTo(W, H + 2);
  blue.closePath();
  blue.fillStyle = press.screen("blue", 0.72);
  blue.fill();
  blue.fillStyle = press.solid("blue");
  blue.fillRect(0, surface + 26, W, H);
  // A pink sheen on the surface.
  const pink = press.plate("pink");
  pink.fillStyle = press.screen("pink", 0.3);
  pink.beginPath();
  pink.moveTo(0, H + 2);
  for (let x = 0; x <= W + 8; x += 8) pink.lineTo(x, wave(x) + 3);
  pink.lineTo(W, H + 2);
  pink.closePath();
  pink.fill();
}

/** A thumbprint, printed in a blue screen: the first-run ghost finger. */
export function drawThumb(press: Press, x: number, y: number, r: number, press01: number): void {
  const blue = press.plate("blue");
  const k = 1 - press01 * 0.12;
  blue.save();
  blue.translate(x, y);
  blue.scale(k, k);
  blue.fillStyle = press.screen("blue", 0.25);
  blue.beginPath();
  blue.ellipse(0, 0, r * 0.82, r, 0, 0, TAU);
  blue.fill();
  blue.strokeStyle = press.solid("blue");
  blue.lineWidth = 1.3;
  for (let i = 1; i <= 5; i++) {
    const f = i / 5.6;
    blue.beginPath();
    blue.ellipse(r * 0.05 * (1 - f), -r * 0.1 * (1 - f), r * 0.8 * f, r * f, 0.15, Math.PI * (0.1 + 0.08 * i), Math.PI * (2.15 - 0.05 * i));
    blue.stroke();
  }
  blue.restore();
}
