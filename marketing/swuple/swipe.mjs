/**
 * The swipe direction: the app icon is the screen, and a swipe up runs across all of it. The stroke bends in a
 * gentle S, a hint of the name's first letter, but it should read as a thumb's path first. Its opacity carries the
 * motion: it fades in along the way, leaves echoes, or breaks into dashes. Same colors as the button logo: ink,
 * heat, paper. Not final artwork.
 *
 *   node marketing/swuple/swipe.mjs         -> marketing/swuple/concepts/swipe-sheet.png
 */
import { P, appIcon, f, markSheet } from "./sketch-kit.mjs";
import { LOGO, curve, stroke } from "./swipe-geometry.mjs";

/** A vertical opacity ramp in the 1024 box, `stops` as [y, opacity] from the bottom up. */
let rampId = 0;
function ramp(color, stops) {
  const id = `ramp${rampId++}`;
  const def = `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="0" y1="1024" x2="0" y2="0">${stops
    .map(([y, o]) => `<stop offset="${f((1024 - y) / 1024)}" stop-color="${color}" stop-opacity="${o}"/>`)
    .join("")}</linearGradient>`;
  return { def: `<defs>${def}</defs>`, fill: `url(#${id})` };
}

const H = P.heat;
const PATH = curve();
const W0 = 130, W1 = 168;
const ICON = { inset: 0, vis: [0, 1024] };
/** The trail fades in from nothing at the bottom edge to solid at the fingertip. */
const fadeIn = (color, low = 0) => ramp(color, [[1024, low], [700, 0.3], [380, 0.85], [220, 1]]);
const ring = (color) => `<circle cx="${PATH[3][0]}" cy="${PATH[3][1]}" r="104" fill="none" stroke="${color}" stroke-width="20"/>`;

const MARKS = [
  {
    title: "A  FADE IN",
    ...ICON,
    draw: () => {
      const r = fadeIn(H);
      return appIcon(`${r.def}<path d="${stroke(PATH, W0, W1)}" fill="${r.fill}"/>`, P.ink1);
    },
  },
  {
    title: "B  EDGE TO EDGE",
    ...ICON,
    // The swipe comes in below the icon and leaves above it: the whole icon is the screen it crosses. The chosen logo.
    draw: () => {
      const r = ramp(H, LOGO.ramp);
      return appIcon(`${r.def}<path d="${stroke(LOGO.path, LOGO.w0, LOGO.w1)}" fill="${r.fill}"/>`, P.ink1);
    },
  },
  {
    title: "C  RED ICON, INK FADE",
    ...ICON,
    draw: () => {
      const r = fadeIn(P.ink1);
      return appIcon(`${r.def}<path d="${stroke(PATH, W0, W1)}" fill="${r.fill}"/>`, H);
    },
  },
  {
    title: "D  DASHES, FAINT TO SOLID",
    ...ICON,
    draw: () => {
      const cuts = [0, 0.2, 0.37, 0.52, 0.65, 0.77, 1];
      const ops = [0.12, 0.24, 0.4, 0.58, 0.78, 1];
      // Square cuts with real gaps between them; only the fingertip end is round.
      const last = ops.length - 1;
      return appIcon(
        ops.map((o, i) => `<path d="${stroke(PATH, W0, W1, cuts[i] + (i ? 0.025 : 0), cuts[i + 1] - (i < last ? 0.025 : 0), i < last ? "both" : "start")}" fill="${H}" opacity="${o}"/>`).join(""),
        P.ink1,
      );
    },
  },
  {
    title: "E  THUMB WIDTH + CORE",
    ...ICON,
    // The band is the width of a thumb on glass; the solid core is the path it traced.
    draw: () => appIcon(`<path d="${stroke(PATH, 300, 330)}" fill="${H}" opacity="0.22"/><path d="${stroke(PATH, 70, 86)}" fill="${H}"/>`, P.ink1),
  },
  {
    title: "F  PAPER ON RED",
    ...ICON,
    draw: () => {
      const r = fadeIn(P.paper);
      return appIcon(`${r.def}<path d="${stroke(PATH, W0, W1)}" fill="${r.fill}"/>${ring(P.paper)}`, H);
    },
  },
  {
    title: "G  THE SWIPE BEFORE",
    ...ICON,
    // A ghost of the previous swipe beside this one: swipe after swipe, game after game.
    draw: () =>
      appIcon(
        `<path d="${stroke(curve({ from: [690, 1060], to: [850, 300] }), 110, 140)}" fill="${H}" opacity="0.2"/>
         <path d="${stroke(PATH, W0, W1)}" fill="${H}"/>`,
        P.ink1,
      ),
  },
  {
    title: "H  FADE IN + FINGERTIP",
    ...ICON,
    draw: () => {
      const r = fadeIn(H);
      return appIcon(`${r.def}<path d="${stroke(PATH, 112, 140)}" fill="${r.fill}"/>${ring(P.paper)}`, P.ink1);
    },
  },
];

await markSheet(MARKS, "swipe-sheet.png");
