/**
 * Where the table sits during a run, as a pure function of the viewport, so the game and the screenshot script
 * (scripts/shoot.ts) agree on every card position.
 */

export const CARD_ASPECT = 1.4;
/** Deepest column any hand deals (the layout is sized for it). */
export const MAX_DEPTH = 4;

export interface Slot {
  x: number;
  y: number;
  w: number;
}

export interface Geometry {
  cw: number;
  /** Vertical step between cards in a column (the visible part of a covered card). */
  band: number;
  colX: number[];
  /** Top edge of the back row of the tableau, for the hand being played. */
  top: number;
  pile: Slot;
  stock: Slot;
  /** Where the streak multiplier sits. */
  meter: { x: number; y: number };
  /** Bottom of the score and clock. */
  hud: number;
}

/**
 * The play layout for `cols` columns of `depth` cards on a W × H viewport whose status bar is `insetTop` tall.
 * Cards are as wide as five columns allow, and the pile and stock in the thumb's row are larger still. The spare
 * height goes into how much of each covered card shows (up to 58 %, so a column reads like a fanned hand rather
 * than a stack of slivers), and what is left is split above and below the tableau. Shallower hands sit lower, so
 * the playable row stays near the thumb.
 */
export function playGeometry(W: number, H: number, insetTop: number, cols: number, depth: number): Geometry {
  const gap = 6;
  const hud = insetTop + 100;
  const cw = Math.max(40, Math.min(84, (W - 16 - gap * (cols - 1)) / cols));
  const ch = cw * CARD_ASPECT;
  const pw = Math.min(cw * 1.45, 112);
  const pileY = H - 24 - (pw * CARD_ASPECT) / 2;
  const pileTop = pileY - (pw * CARD_ASPECT) / 2;
  // Room for the hint lines and popups between the tableau and the pile row.
  const tableBottom = pileTop - 48;
  const avail = Math.max(ch * 2, tableBottom - hud);
  const stack = Math.max(0.4, Math.min(0.58, (avail - 64 - ch) / ((MAX_DEPTH - 1) * ch)));
  const band = ch * stack;
  const colH = (d: number) => (Math.max(1, d) - 1) * band + ch;
  const top = hud + Math.max(0, avail - colH(depth)) * 0.55;
  const rowW = cols * cw + (cols - 1) * gap;
  const x0 = (W - rowW) / 2 + cw / 2;
  return {
    cw,
    band,
    colX: Array.from({ length: cols }, (_, i) => x0 + i * (cw + gap)),
    top,
    pile: { x: W / 2, y: pileY, w: pw },
    stock: { x: W / 2 + pw * 1.36, y: pileY, w: cw * 1.12 },
    meter: { x: W / 2 - pw * 1.36, y: pileY },
    hud,
  };
}
