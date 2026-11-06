import { FONT_DISPLAY } from "@thumbcade-games/kit/fonts";
import { rgba, shade } from "@thumbcade-games/kit/color";
import { roundRect } from "@thumbcade-games/kit/ui";

/**
 * Everything drawn in code. The kid, the desk and the chalkboard are laid out in "stage" units: origin at the
 * middle of the desk's top edge, y up is negative, about 400 units wide. The caller translates and scales.
 */

export const PAL = {
  bg: "#0C1019",
  wallTop: "#121A2A",
  wallLow: "#0C1019",
  accent: "#8C6CFF",
  accentDeep: "#4A35B0",
  accentHi: "#C2B3FF",
  board: "#13221C",
  boardDeep: "#0E1915",
  frame: "#2A3142",
  chalk: "#E3EDE6",
  skin: "#E3A77E",
  skinShade: "#C0805A",
  skinHi: "#F3C6A2",
  palm: "#F6CDAE",
  hair: "#2B1C3E",
  hairHi: "#4B3470",
  mouth: "#3A0E1E",
  tongue: "#FF7C8E",
  teeth: "#FFF8EE",
  pupil: "#16111C",
  blush: "#FF6F7A",
  sweat: "#9EDBFF",
  deskTop: "#5B3F2F",
  deskEdge: "#7B5641",
  deskFront: "#2C1F19",
  deskDeep: "#1D1511",
  paper: "#F3F0E8",
  dim: "#A7A3AE",
  mute: "#6E6A78",
  ink: "#0D0D10",
  heat: "#FF4A3D",
  teacher: "#222A3B",
  teacherHair: "#121722",
  teacherBody: "#182031",
} as const;

export type Mood = "happy" | "confused" | "innocent" | "shock" | "out";

export interface KidPose {
  /** Hand heights: -1 raised, 0 level, +1 lowered. */
  left: number;
  right: number;
  /** 0-1, set to 1 when that hand is pushed up; draws speed marks. */
  kickLeft: number;
  kickRight: number;
  /** Body bob (stage units, + is down). */
  bob: number;
  tilt: number;
  lookX: number;
  lookY: number;
  /** Mouth open 0-1. */
  shout: number;
  /** Hair tuft lean (radians). */
  sway: number;
  mood: Mood;
  /** Combo tier 0-3. */
  tier: number;
  /** Game-over deflation 0-1. */
  slump: number;
  t: number;
}

export const restPose = (): KidPose => ({
  left: 0,
  right: 0,
  kickLeft: 0,
  kickRight: 0,
  bob: 0,
  tilt: 0,
  lookX: 0,
  lookY: 0,
  shout: 0,
  sway: 0,
  mood: "happy",
  tier: 0,
  slump: 0,
  t: 0,
});

const TAU = Math.PI * 2;

function ellipse(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, rot = 0): void {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, rot, 0, TAU);
}

function line(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number): void {
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
}

// ---------------------------------------------------------------------------------------------------------------
// Room
// ---------------------------------------------------------------------------------------------------------------

/** The chalkboard behind the kid, in stage units. */
export function drawBoard(ctx: CanvasRenderingContext2D): void {
  const x = -190;
  const y = -452;
  const w = 380;
  const h = 250;
  ctx.fillStyle = PAL.frame;
  roundRect(ctx, x - 10, y - 10, w + 20, h + 20, 14);
  ctx.fill();
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, PAL.board);
  g.addColorStop(1, PAL.boardDeep);
  ctx.fillStyle = g;
  roundRect(ctx, x, y, w, h, 6);
  ctx.fill();
  // Old eraser smudges.
  ctx.fillStyle = rgba(PAL.chalk, 0.035);
  ellipse(ctx, -110, -380, 70, 26, -0.1);
  ctx.fill();
  ellipse(ctx, 120, -290, 60, 20, 0.15);
  ctx.fill();
  // The rule, and a tally of how often it was broken.
  ctx.save();
  ctx.fillStyle = rgba(PAL.chalk, 0.62);
  ctx.font = `900 13px ${FONT_DISPLAY}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText("RULE 1", x + 18, y + 32);
  ctx.font = `900 38px ${FONT_DISPLAY}`;
  ctx.fillText("NO", x + 18, y + 76);
  ctx.textAlign = "right";
  ctx.fillText("6 7", x + w - 18, y + 76);
  ctx.strokeStyle = rgba(PAL.chalk, 0.55);
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  line(ctx, x + 18, y + 88, x + 84, y + 86);
  line(ctx, x + w - 92, y + 88, x + w - 18, y + 90);
  // Tally marks: |||| crossed, twice, then three more.
  ctx.strokeStyle = rgba(PAL.chalk, 0.45);
  ctx.lineWidth = 2.5;
  const tx = x + w - 120;
  const ty = y + 150;
  for (let group = 0; group < 3; group++) {
    const n = group < 2 ? 4 : 3;
    const gx = tx + group * 38;
    for (let i = 0; i < n; i++) line(ctx, gx + i * 7, ty, gx + i * 7 + 1, ty + 26);
    if (group < 2) line(ctx, gx - 4, ty + 20, gx + 26, ty + 6);
  }
  // Chalk sums on the left.
  ctx.lineWidth = 2;
  ctx.strokeStyle = rgba(PAL.chalk, 0.32);
  line(ctx, x + 22, y + 140, x + 70, y + 140);
  line(ctx, x + 22, y + 158, x + 92, y + 158);
  line(ctx, x + 22, y + 176, x + 58, y + 176);
  ctx.restore();
  // Tray.
  ctx.fillStyle = shade(PAL.frame, 0.12);
  roundRect(ctx, x - 6, y + h + 6, w + 12, 9, 4);
  ctx.fill();
  ctx.fillStyle = PAL.chalk;
  roundRect(ctx, x + 40, y + h + 1, 22, 6, 3);
  ctx.fill();
}

/** The desk across the bottom, from the desk top (y = 0) down to `bottom` (stage units). */
export function drawDesk(ctx: CanvasRenderingContext2D, bottom: number, halfWidth: number): void {
  const hw = halfWidth;
  ctx.fillStyle = PAL.deskTop;
  ctx.beginPath();
  ctx.moveTo(-hw + 18, -14);
  ctx.lineTo(hw - 18, -14);
  ctx.lineTo(hw, 12);
  ctx.lineTo(-hw, 12);
  ctx.closePath();
  ctx.fill();
  // Wood grain.
  ctx.strokeStyle = rgba(PAL.deskEdge, 0.35);
  ctx.lineWidth = 1.5;
  line(ctx, -hw + 60, -6, -40, -7);
  line(ctx, 30, 2, hw - 50, 1);
  ctx.fillStyle = PAL.deskEdge;
  ctx.fillRect(-hw, 12, hw * 2, 6);
  const g = ctx.createLinearGradient(0, 18, 0, bottom);
  g.addColorStop(0, PAL.deskFront);
  g.addColorStop(1, PAL.deskDeep);
  ctx.fillStyle = g;
  ctx.fillRect(-hw, 18, hw * 2, Math.max(0, bottom - 18));
  ctx.fillStyle = rgba(PAL.ink, 0.35);
  ctx.fillRect(-hw, 18, hw * 2, 8);
  // A pencil and a notebook.
  ctx.save();
  ctx.translate(-118, -2);
  ctx.rotate(0.07);
  ctx.fillStyle = "#F2C14E";
  ctx.fillRect(-36, -4, 64, 8);
  ctx.fillStyle = "#E88A9A";
  ctx.fillRect(-44, -4, 8, 8);
  ctx.fillStyle = "#EAD9BF";
  ctx.beginPath();
  ctx.moveTo(28, -4);
  ctx.lineTo(40, 0);
  ctx.lineTo(28, 4);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  ctx.save();
  ctx.translate(92, -1);
  ctx.fillStyle = PAL.paper;
  ctx.beginPath();
  ctx.moveTo(-34, -9);
  ctx.lineTo(30, -9);
  ctx.lineTo(36, 7);
  ctx.lineTo(-38, 7);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = rgba(PAL.accent, 0.55);
  ctx.lineWidth = 1.2;
  line(ctx, -28, -4, 26, -4);
  line(ctx, -30, 1, 28, 1);
  ctx.restore();
}

// ---------------------------------------------------------------------------------------------------------------
// The kid
// ---------------------------------------------------------------------------------------------------------------

function drawHand(ctx: CanvasRenderingContext2D, side: -1 | 1, x: number, y: number, tilt: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(tilt);
  ctx.scale(side, 1);
  // Back of the hand, then the palm facing up, fingertips toward us, thumb out.
  ctx.fillStyle = PAL.skinShade;
  ellipse(ctx, 0, 5, 29, 15);
  ctx.fill();
  ctx.fillStyle = PAL.palm;
  ellipse(ctx, 0, 0, 27, 11.5);
  ctx.fill();
  ctx.strokeStyle = rgba(PAL.skinShade, 0.7);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(-2, -6, 12, 0.5, 2.4);
  ctx.stroke();
  ctx.fillStyle = PAL.skin;
  for (let i = 0; i < 4; i++) {
    ellipse(ctx, -16 + i * 10.5, 11, 6.2, 5.6);
    ctx.fill();
  }
  ctx.strokeStyle = PAL.skin;
  ctx.lineWidth = 12;
  ctx.lineCap = "round";
  line(ctx, 20, -1, 33, -15);
  ctx.restore();
}

function drawArm(ctx: CanvasRenderingContext2D, side: -1 | 1, p: KidPose, hand: number, kick: number): void {
  const sx = side * 70;
  const sy = -150 + p.bob;
  const wx = side * 150;
  const wy = -110 + hand * 34 + p.bob * 0.5;
  const ex = side * 104;
  const ey = -72 + p.bob + hand * 9;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = PAL.skin;
  ctx.lineWidth = 22;
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.lineTo(ex, ey);
  ctx.lineTo(wx, wy);
  ctx.stroke();
  ctx.strokeStyle = rgba(PAL.skinHi, 0.55);
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(sx - side * 4, sy + 8);
  ctx.lineTo(ex - side * 4, ey - 6);
  ctx.stroke();
  // Wristband.
  const bx = ex + (wx - ex) * 0.72;
  const by = ey + (wy - ey) * 0.72;
  const cx = ex + (wx - ex) * 0.86;
  const cy = ey + (wy - ey) * 0.86;
  ctx.strokeStyle = PAL.paper;
  ctx.lineWidth = 26;
  ctx.lineCap = "butt";
  line(ctx, bx, by, cx, cy);
  ctx.strokeStyle = PAL.accent;
  ctx.lineWidth = 26;
  line(ctx, bx + (cx - bx) * 0.4, by + (cy - by) * 0.4, bx + (cx - bx) * 0.6, by + (cy - by) * 0.6);
  drawHand(ctx, side, wx + side * 20, wy - 6, side * (-0.12 + hand * 0.1));
  if (kick > 0.05) {
    // Speed marks under a hand that just bounced up.
    ctx.strokeStyle = rgba(PAL.paper, 0.75 * kick);
    ctx.lineWidth = 3.5;
    ctx.lineCap = "round";
    const hx = wx + side * 20;
    for (let i = -1; i <= 1; i++) line(ctx, hx + i * 16, wy + 26 + Math.abs(i) * 4, hx + i * 18, wy + 26 + 18 * kick + Math.abs(i) * 4);
  }
}

function drawJersey(ctx: CanvasRenderingContext2D, p: KidPose): void {
  const b = p.bob;
  ctx.save();
  ctx.translate(0, b);
  ctx.beginPath();
  ctx.moveTo(-66, 30);
  ctx.lineTo(-66, -118);
  ctx.quadraticCurveTo(-66, -150, -46, -160);
  ctx.lineTo(-40, -178);
  ctx.lineTo(-25, -178);
  ctx.quadraticCurveTo(0, -136, 25, -178);
  ctx.lineTo(40, -178);
  ctx.lineTo(46, -160);
  ctx.quadraticCurveTo(66, -150, 66, -118);
  ctx.lineTo(66, 30);
  ctx.closePath();
  ctx.fillStyle = PAL.accent;
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.fillStyle = rgba(PAL.accentDeep, 0.55);
  ctx.fillRect(-66, -180, 16, 220);
  ctx.fillRect(50, -180, 16, 220);
  ctx.restore();
  // Trim.
  ctx.strokeStyle = PAL.paper;
  ctx.lineWidth = 5;
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(-25, -178);
  ctx.quadraticCurveTo(0, -136, 25, -178);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-66, -118);
  ctx.quadraticCurveTo(-66, -150, -46, -160);
  ctx.moveTo(66, -118);
  ctx.quadraticCurveTo(66, -150, 46, -160);
  ctx.stroke();
  ctx.font = `900 44px ${FONT_DISPLAY}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = PAL.accentDeep;
  ctx.fillText("67", 0, -70);
  ctx.fillStyle = PAL.paper;
  ctx.fillText("67", 0, -74);
  ctx.restore();
}

function drawTuft(ctx: CanvasRenderingContext2D, p: KidPose): void {
  ctx.save();
  ctx.translate(0, -56);
  ctx.rotate(p.sway * 0.4 + Math.sin(p.t * 2.1) * 0.02);
  const droop = p.slump;
  ctx.scale(1 + 0.25 * droop, 1 - 0.45 * droop);
  ctx.fillStyle = PAL.hair;
  ctx.beginPath();
  ctx.moveTo(-46, 6);
  ctx.quadraticCurveTo(-64, -40, -36, -64);
  ctx.quadraticCurveTo(-30, -42, -17, -36);
  ctx.quadraticCurveTo(-20, -82, 8, -98);
  ctx.quadraticCurveTo(12, -66, 19, -42);
  ctx.quadraticCurveTo(36, -60, 54, -54);
  ctx.quadraticCurveTo(42, -30, 48, 6);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = PAL.hairHi;
  ctx.lineWidth = 4;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(-6, -20);
  ctx.quadraticCurveTo(-6, -60, 6, -84);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-38, -8);
  ctx.quadraticCurveTo(-46, -34, -36, -52);
  ctx.stroke();
  ctx.restore();
}

function drawFace(ctx: CanvasRenderingContext2D, p: KidPose): void {
  const m = p.mood;
  // Brows.
  const lift = m === "shock" ? -10 : m === "out" ? 4 : m === "innocent" ? -6 : -2 - p.tier * 2 - p.shout * 4;
  const browL = m === "confused" ? -9 : lift;
  const browR = m === "confused" ? 3 : lift;
  ctx.strokeStyle = PAL.hair;
  ctx.lineWidth = 7;
  ctx.lineCap = "round";
  const sad = m === "out" ? 1 : 0;
  line(ctx, -40, -30 + browL + 4 * sad, -14, -34 + browL - 3 * sad);
  line(ctx, 14, -34 + browR - 3 * sad, 40, -30 + browR + 4 * sad);

  // Eyes.
  const big = m === "shock" ? 1.15 : 1;
  for (const s of [-1, 1] as const) {
    const ex = s * 26;
    const squint = m === "confused" && s === 1 ? 0.55 : 1;
    ctx.fillStyle = "#FFFFFF";
    ellipse(ctx, ex, -6, 16 * big, 19 * big * squint);
    ctx.fill();
    const pr = m === "shock" ? 4.5 : 8;
    const px = ex + p.lookX * 6;
    const py = -6 + p.lookY * 7 * squint;
    ctx.fillStyle = PAL.pupil;
    ellipse(ctx, px, py, pr, pr * Math.min(1, squint + 0.2));
    ctx.fill();
    ctx.fillStyle = "#FFFFFF";
    ellipse(ctx, px - 2.5, py - 3, pr * 0.32, pr * 0.32);
    ctx.fill();
    if (m === "out") {
      // Heavy lids.
      ctx.save();
      ellipse(ctx, ex, -6, 16.5, 19.5);
      ctx.clip();
      ctx.fillStyle = PAL.skin;
      ctx.fillRect(ex - 18, -28, 36, 21);
      ctx.restore();
      ctx.strokeStyle = PAL.skinShade;
      ctx.lineWidth = 3;
      line(ctx, ex - 15, -7, ex + 15, -7);
    }
  }

  // Nose, cheeks, freckles.
  ctx.fillStyle = rgba(PAL.skinShade, 0.8);
  ellipse(ctx, 0, 14, 7, 5);
  ctx.fill();
  ctx.fillStyle = rgba(PAL.blush, 0.32 + 0.12 * p.tier);
  ellipse(ctx, -44, 22, 13, 7);
  ctx.fill();
  ellipse(ctx, 44, 22, 13, 7);
  ctx.fill();
  ctx.fillStyle = rgba(PAL.skinShade, 0.9);
  for (const s of [-1, 1]) {
    ellipse(ctx, s * 36, 14, 1.8, 1.8);
    ctx.fill();
    ellipse(ctx, s * 44, 18, 1.8, 1.8);
    ctx.fill();
    ellipse(ctx, s * 39, 23, 1.8, 1.8);
    ctx.fill();
  }

  // Mouth.
  ctx.save();
  ctx.translate(0, 34);
  if (m === "innocent") {
    ctx.fillStyle = PAL.mouth;
    ellipse(ctx, 12, 2, 6, 7);
    ctx.fill();
    ctx.strokeStyle = PAL.skinShade;
    ctx.lineWidth = 3;
    ctx.stroke();
  } else if (m === "shock") {
    ctx.fillStyle = PAL.teeth;
    roundRect(ctx, -24, -6, 48, 20, 7);
    ctx.fill();
    ctx.strokeStyle = PAL.mouth;
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.lineWidth = 2;
    line(ctx, -22, 4, 22, 4);
    for (let i = -2; i <= 2; i++) line(ctx, i * 8, -5, i * 8, 13);
  } else if (m === "out") {
    ctx.strokeStyle = PAL.mouth;
    ctx.lineWidth = 4.5;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(-14, 8);
    ctx.quadraticCurveTo(0, -2, 14, 8);
    ctx.stroke();
  } else if (m === "confused") {
    ctx.strokeStyle = PAL.mouth;
    ctx.lineWidth = 4.5;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(-16, 4);
    ctx.quadraticCurveTo(-8, -2, 0, 4);
    ctx.quadraticCurveTo(8, 10, 16, 2);
    ctx.stroke();
  } else if (p.shout > 0.06) {
    const o = p.shout;
    const depth = 14 + 24 * o;
    ctx.beginPath();
    ctx.moveTo(-28, -4);
    ctx.quadraticCurveTo(0, -9, 28, -4);
    ctx.quadraticCurveTo(25, depth, 0, depth + 2);
    ctx.quadraticCurveTo(-25, depth, -28, -4);
    ctx.closePath();
    ctx.fillStyle = PAL.mouth;
    ctx.fill();
    ctx.save();
    ctx.clip();
    ctx.fillStyle = PAL.teeth;
    ctx.fillRect(-26, -10, 52, 10);
    ctx.fillStyle = PAL.mouth;
    ctx.fillRect(-2, -10, 4, 10);
    ctx.fillStyle = PAL.tongue;
    ellipse(ctx, 0, depth, 15, 7 + 5 * o);
    ctx.fill();
    ctx.restore();
  } else {
    ctx.strokeStyle = PAL.mouth;
    ctx.lineWidth = 5;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(-24, -2);
    ctx.quadraticCurveTo(0, 18, 24, -2);
    ctx.stroke();
    ctx.lineWidth = 3;
    line(ctx, -27, -5, -22, 1);
    line(ctx, 27, -5, 22, 1);
  }
  ctx.restore();
}

function drawHead(ctx: CanvasRenderingContext2D, p: KidPose): void {
  ctx.save();
  ctx.translate(0, -262 + p.bob + p.slump * 46);
  ctx.rotate(p.tilt + p.slump * 0.16);
  // Ears.
  for (const s of [-1, 1]) {
    ctx.fillStyle = PAL.skin;
    ellipse(ctx, s * 68, 6, 15, 17);
    ctx.fill();
    ctx.fillStyle = PAL.skinShade;
    ellipse(ctx, s * 69, 7, 7, 9);
    ctx.fill();
  }
  drawTuft(ctx, p);
  ctx.fillStyle = PAL.skin;
  ellipse(ctx, 0, 0, 70, 64);
  ctx.fill();
  ctx.save();
  ellipse(ctx, 0, 0, 70, 64);
  ctx.clip();
  ctx.fillStyle = rgba(PAL.skinShade, 0.35);
  ellipse(ctx, 6, 58, 72, 26);
  ctx.fill();
  ctx.fillStyle = rgba(PAL.skinHi, 0.4);
  ellipse(ctx, -26, -24, 26, 15, -0.3);
  ctx.fill();
  // Hair under the band.
  ctx.fillStyle = PAL.hair;
  ctx.fillRect(-72, -70, 144, 24);
  ctx.restore();
  // Headband, a touch wider than the head.
  ctx.save();
  ellipse(ctx, 0, 0, 73, 67);
  ctx.clip();
  ctx.fillStyle = PAL.paper;
  ctx.fillRect(-74, -50, 148, 17);
  ctx.fillStyle = PAL.accent;
  ctx.fillRect(-74, -45, 148, 6);
  ctx.restore();
  drawFace(ctx, p);
  // Sweat when it gets intense.
  if (p.tier >= 2 || p.mood === "out" || p.mood === "shock") {
    const k = Math.sin(p.t * 3) * 3;
    ctx.fillStyle = PAL.sweat;
    ctx.beginPath();
    ctx.moveTo(62, -40 + k);
    ctx.quadraticCurveTo(72, -24 + k, 62, -18 + k);
    ctx.quadraticCurveTo(52, -24 + k, 62, -40 + k);
    ctx.fill();
  }
  ctx.restore();
}

/** The kid from the desk up, at stage origin. */
export function drawKid(ctx: CanvasRenderingContext2D, p: KidPose): void {
  const left = p.left + p.slump * 1.6;
  const right = p.right + p.slump * 1.6;
  ctx.save();
  // Shoulders and neck.
  ctx.fillStyle = PAL.skinShade;
  ctx.fillRect(-17, -212 + p.bob + p.slump * 30, 34, 50);
  ctx.fillStyle = PAL.skin;
  ellipse(ctx, 0, -150 + p.bob, 80, 24);
  ctx.fill();
  drawArm(ctx, -1, p, left, p.kickLeft);
  drawArm(ctx, 1, p, right, p.kickRight);
  drawJersey(ctx, p);
  drawHead(ctx, p);
  ctx.restore();
}

/** Where the palms sit (stage units), for popups and sparks. */
export function palm(side: -1 | 1, hand: number): { x: number; y: number } {
  return { x: side * 170, y: -116 + hand * 34 };
}

// ---------------------------------------------------------------------------------------------------------------
// The teacher
// ---------------------------------------------------------------------------------------------------------------

export type TeacherLook = "peek" | "watch" | "yell";

/**
 * The teacher leaning in from a screen edge. `side` -1 = from the left, +1 = from the right. Drawn facing the
 * middle of the screen, at the origin (head center), in stage units.
 */
export function drawTeacher(ctx: CanvasRenderingContext2D, side: -1 | 1, look: TeacherLook, glow: number, t: number): void {
  ctx.save();
  ctx.scale(-side, 1);
  // Shoulders and body.
  ctx.fillStyle = PAL.teacherBody;
  roundRect(ctx, -110, 52, 200, 360, 80);
  ctx.fill();
  ctx.fillStyle = shade(PAL.teacherBody, 0.08);
  ctx.beginPath();
  ctx.moveTo(-6, 60);
  ctx.lineTo(16, 120);
  ctx.lineTo(38, 60);
  ctx.closePath();
  ctx.fill();
  // Head, bun, hair.
  ctx.fillStyle = PAL.teacherHair;
  ellipse(ctx, -50, -50, 30, 28);
  ctx.fill();
  ctx.fillStyle = PAL.teacher;
  ellipse(ctx, 0, 0, 62, 66);
  ctx.fill();
  ctx.fillStyle = PAL.teacherHair;
  ctx.beginPath();
  ctx.ellipse(0, 0, 63, 67, 0, Math.PI * 1.02, Math.PI * 1.98);
  ctx.quadraticCurveTo(30, -36, -10, -30);
  ctx.quadraticCurveTo(-46, -26, -62, 4);
  ctx.closePath();
  ctx.fill();
  // Rim light on the side facing the room.
  const rim = look === "peek" ? PAL.accentHi : PAL.heat;
  ctx.strokeStyle = rgba(rim, 0.35 + 0.4 * glow);
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.ellipse(0, 0, 62, 66, 0, -0.9, 0.9);
  ctx.stroke();
  // Brows: stern.
  ctx.strokeStyle = PAL.teacherHair;
  ctx.lineWidth = 7;
  ctx.lineCap = "round";
  line(ctx, 4, -26, 26, -18);
  line(ctx, 58, -26, 38, -18);
  // Glasses.
  const lens = look === "peek" ? PAL.paper : PAL.heat;
  for (const gx of [16, 48]) {
    ctx.fillStyle = rgba(lens, 0.18 + 0.62 * glow);
    roundRect(ctx, gx - 14, -14, 28, 20, 6);
    ctx.fill();
    ctx.strokeStyle = "#0A0D14";
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.strokeStyle = rgba("#FFFFFF", 0.35 + 0.4 * glow);
    ctx.lineWidth = 2;
    line(ctx, gx - 8, -8, gx - 2, -12);
  }
  ctx.strokeStyle = "#0A0D14";
  ctx.lineWidth = 4;
  line(ctx, 30, -6, 34, -6);
  // Mouth.
  ctx.strokeStyle = "#0A0D14";
  if (look === "yell") {
    ctx.fillStyle = "#0A0D14";
    ellipse(ctx, 34, 34, 12, 14 + Math.sin(t * 30) * 2);
    ctx.fill();
  } else {
    ctx.lineWidth = 4;
    line(ctx, 22, 34, 46, 32);
  }
  ctx.restore();
}

/** A soft round glow sprite, cached per color. */
const glows = new Map<string, HTMLCanvasElement>();
export function glowSprite(color: string): HTMLCanvasElement {
  let c = glows.get(color);
  if (c) return c;
  c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, rgba(color, 0.55));
  grad.addColorStop(0.45, rgba(color, 0.18));
  grad.addColorStop(1, rgba(color, 0));
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  glows.set(color, c);
  return c;
}
