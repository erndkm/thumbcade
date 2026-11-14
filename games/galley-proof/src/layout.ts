/**
 * Where everything sits, as pure functions of the viewport and the insets, so the game, the tests and
 * scripts/shoot-plan.ts agree on every key and every letter's place.
 */
import { LETTERS } from "./marks.ts";
import type { Key } from "./run.ts";

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface KeyBox extends Box {
  key: Key;
  row: number;
}

export interface Keyboard {
  keys: KeyBox[];
  /** Everything the keyboard covers, letters and the bottom row. */
  box: Box;
  pitch: number;
  /** Bottom edge of the letter rows, and top of the bottom row (erase, pencil, write). */
  lettersBottom: number;
  actionsTop: number;
}

export interface Slip {
  card: Box;
  /** Header band (kicker and line count) and the note band under the lines. */
  head: Box;
  note: Box;
  /** Centre x of each letter place. */
  cx: number[];
  /** Baseline of line 0; each line is `line` lower. */
  base0: number;
  line: number;
  cell: number;
  /** Type size of the letters. */
  type: number;
}

export interface Frame {
  L: number;
  R: number;
  top: number;
  /** The clock's ink rule under the HUD (play only). */
  rule: number;
  msg: Box;
  slip: Slip;
  kb: Keyboard | null;
}

export const ROWS = ["qwertyuiop", "asdfghjkl", "zxcvbnm"] as const;
export const LINES = 6;

/** The keyboard along the bottom of the viewport: three rows of letters, then erase, pencil and write on their own. */
export function keyboard(W: number, bottom: number, H: number): Keyboard {
  const side = 4;
  const pitch = (W - side * 2) / 10;
  const kh = Math.max(40, Math.min(54, Math.round(H * 0.066)));
  const ah = Math.max(38, Math.min(48, kh - 4));
  const gap = 8;
  const bigGap = 14;
  const keys: KeyBox[] = [];
  const top = bottom - ah - bigGap - kh * 3 - gap * 2;
  ROWS.forEach((row, r) => {
    const x0 = side + (r === 1 ? pitch / 2 : r === 2 ? pitch * 1.5 : 0);
    const y = top + r * (kh + gap);
    for (let i = 0; i < row.length; i++) keys.push({ key: row[i]!, row: r, x: x0 + i * pitch + 2.5, y, w: pitch - 5, h: kh });
  });
  const lettersBottom = top + kh * 3 + gap * 2;
  const ay = lettersBottom + bigGap;
  keys.push({ key: "erase", row: 3, x: side + 2.5, y: ay, w: pitch * 2.8 - 5, h: ah });
  keys.push({ key: "pencil", row: 3, x: side + pitch * 3.25 + 2.5, y: ay, w: pitch * 3 - 5, h: ah });
  keys.push({ key: "write", row: 3, x: side + pitch * 6.7 + 2.5, y: ay, w: pitch * 3.3 - 5, h: ah });
  return { keys, box: { x: 0, y: top, w: W, h: bottom - top }, pitch, lettersBottom, actionsTop: ay };
}

/**
 * The key under (x, y). Letters are forgiving: the gaps between them belong to the nearest key of the row, and a
 * touch a little past the end of a row still finds its last key. The bottom row is strict (its own boxes plus 4 px),
 * and a dead band separates it from the letters, so reaching for Z never erases and reaching for M never writes.
 */
export function keyAt(kb: Keyboard, x: number, y: number): KeyBox | null {
  const letters = kb.keys.filter((k) => k.row < 3);
  const first = letters[0]!;
  const rowH = first.h + 8;
  if (y >= first.y - 6 && y < kb.lettersBottom + 3) {
    const r = Math.max(0, Math.min(2, Math.floor((y - first.y + 4) / rowH)));
    let best: KeyBox | null = null;
    let bd = Infinity;
    for (const k of letters) {
      if (k.row !== r) continue;
      const d = Math.abs(x - (k.x + k.w / 2));
      if (d < bd) {
        bd = d;
        best = k;
      }
    }
    return best && bd <= kb.pitch * 0.85 ? best : null;
  }
  for (const k of kb.keys) {
    if (k.row !== 3) continue;
    if (x >= k.x - 4 && x <= k.x + k.w + 4 && y >= k.y - 4 && y <= k.y + k.h + 6) return k;
  }
  return null;
}

/** A slip set inside `area`: a header, six lines of five letters, a note band. */
export function slipIn(area: Box, maxLine = 54, minLine = 26): Slip {
  const headH = 26;
  const noteH = 28;
  const pad = 6;
  const line = Math.max(minLine, Math.min(maxLine, Math.floor((area.h - headH - noteH - pad * 2) / LINES)));
  const cell = Math.max(minLine + 4, Math.min(60, Math.floor((area.w - 70) / LETTERS), Math.round(line * 1.18)));
  const w = Math.min(area.w, cell * LETTERS + 76);
  const h = headH + noteH + pad * 2 + line * LINES;
  const card: Box = { x: area.x + (area.w - w) / 2, y: area.y + Math.max(0, (area.h - h) / 2), w, h };
  const head: Box = { x: card.x, y: card.y, w, h: headH };
  const x0 = card.x + (w - cell * LETTERS) / 2 + cell / 2 + 6;
  const cx = Array.from({ length: LETTERS }, (_, i) => x0 + i * cell);
  const type = Math.round(line * 0.64);
  const base0 = card.y + headH + pad + line * 0.5 + type * 0.35;
  const note: Box = { x: card.x, y: card.y + headH + pad * 2 + line * LINES - 4, w, h: noteH };
  return { card, head, note, cx, base0, line, cell, type };
}

/** The run's layout: HUD and clock rule, a message lane, the slip, the keyboard. */
export function playFrame(W: number, H: number, ins: Insets): Frame {
  const L = ins.left + 16;
  const R = W - ins.right - 16;
  const top = ins.top + 6;
  const rule = top + 56;
  const msg: Box = { x: L, y: rule + 7, w: R - L, h: 28 };
  const kb = keyboard(W, H - 8, H);
  const sy = msg.y + msg.h + 4;
  const slip = slipIn({ x: 10, y: sy, w: W - 20, h: kb.box.y - 8 - sy });
  return { L, R, top, rule, msg, slip, kb };
}

/** The title page: the slip between the title block and the prompt, clear of the feed's rail and caption. */
export function attractFrame(W: number, H: number, ins: Insets, titleBottom: number): Frame & { prompt: number } {
  const L = ins.left + 20;
  const R = W - Math.max(ins.right + 8, 20);
  const top = ins.top + 14;
  const prompt = H - ins.bottom - 22;
  const area: Box = { x: L - 6, y: titleBottom + 6, w: R - L + 12, h: Math.max(120, prompt - 34 - titleBottom - 6) };
  return { L, R, top, rule: top, prompt, msg: { x: L, y: titleBottom, w: R - L, h: 0 }, slip: slipIn(area, 46, 12), kb: null };
}

/** Centre of letter place `i` on line `k`, and that line's baseline. */
export function placeOf(s: Slip, k: number, i: number): { x: number; base: number; mid: number } {
  const base = s.base0 + k * s.line;
  return { x: s.cx[i]!, base, mid: base - s.type * 0.34 };
}

export const keyCentre = (kb: Keyboard, key: Key): [number, number] => {
  const k = kb.keys.find((b) => b.key === key)!;
  return [Math.round(k.x + k.w / 2), Math.round(k.y + k.h / 2)];
};

export interface SummaryPlate {
  card: Box;
  /** Baselines of the rows: points, hint, stats, today's marks (when filed). */
  base: number[];
  /** Room for the text of each row, and for the first row when the "best" seal sits at its end. */
  room: number[];
  roomBest: number;
  /** The bar against the best, under the first row. */
  bar: number;
  /** Today's marks, a block on the right beside the last two rows. */
  grid: Box | null;
}

export const SUMMARY_PX = [19, 15, 15, 15] as const;

/** The summary slip after a run: above the caption, clear of the action rail (or near the foot when standalone). */
export function summaryPlate(W: number, H: number, ins: Insets, standalone: boolean, daily: boolean): SummaryPlate {
  const x = ins.left + 12;
  const w = W - ins.right - 8 - x;
  const n = daily ? 4 : 3;
  const h = 24 * n + 34;
  const bottom = standalone ? H - 64 : H - ins.bottom - 10;
  const y = bottom - h;
  const base = Array.from({ length: n }, (_, i) => y + 26 + i * 24 + (i > 0 ? 10 : 0));
  const gridW = 52;
  const grid: Box | null = daily ? { x: x + w - 14 - gridW, y: base[2]! - 17, w: gridW, h: 50 } : null;
  const room = base.map((_, i) => (i >= 2 && daily ? w - 28 - gridW - 10 : w - 28));
  return { card: { x, y, w, h }, base, room, roomBest: w - 28 - 58, bar: y + 36, grid };
}
