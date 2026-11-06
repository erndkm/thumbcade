/**
 * The script direction: "swuple" written across the app icon in one connected cursive stroke, three rows of two
 * letters (sw / up / le). The rows join at alternating ends like the strokes of an S, just past the icon's edges, so
 * the stroke is the old swipe again, now writing the word. Same colors as the other logos: ink, heat, paper.
 * Not final artwork.
 *
 *   node marketing/swuple/script.mjs         -> marketing/swuple/concepts/script-sheet.png
 */
import { P, appIcon, markSheet } from "./sketch-kit.mjs";
import { entry, script, strokeSvg } from "./script-geometry.mjs";

const ICON = { inset: 0, vis: [0, 1024] };
/** The word as an app icon: `color` writing on `bg`, with the entry fading in from nothing when `fade` is set. */
function word(bg, color, { fade = false, ...opts } = {}) {
  const L = script(opts);
  return appIcon(strokeSvg(L.segs, { width: L.width, color, bg, fade: fade && [entry(L.segs), L.lead] }), bg);
}

const MARKS = [
  // The chosen logo.
  { title: "A  THE WORD", ...ICON, draw: () => word(P.ink1, P.heat) },
  // Comes in from nothing at the bottom left, like the swipe logo's trail.
  { title: "B  FADE IN", ...ICON, draw: () => word(P.ink1, P.heat, { fade: true }) },
  { title: "C  BOLD", ...ICON, draw: () => word(P.ink1, P.heat, { width: 66 }) },
  { title: "D  FINE", ...ICON, draw: () => word(P.ink1, P.heat, { width: 42 }) },
  { title: "E  UPRIGHT", ...ICON, draw: () => word(P.ink1, P.heat, { slant: 0 }) },
  { title: "F  RED ICON, INK WRITING", ...ICON, draw: () => word(P.heat, P.ink1) },
  { title: "G  PAPER ON INK", ...ICON, draw: () => word(P.ink1, P.paper) },
  { title: "H  PAPER ON RED", ...ICON, draw: () => word(P.heat, P.paper) },
];

await markSheet(MARKS, "script-sheet.png");
