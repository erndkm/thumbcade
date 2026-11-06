/**
 * The script logo, swiped: the same word and stroke as script.mjs, drawn as the trail a finger leaves on a phone
 * rather than a line of paint. What makes it a swipe and not writing: the trail is oldest at the bottom left, where it
 * starts as a point and is darkest, and newest at the top, where it is widest and brightest, and it ends at the finger
 * that is still on the glass. Colors stay ink, heat and paper; heat runs from deep to light along the trail.
 * Drawing helpers: trail-kit.mjs. Not final artwork.
 *
 *   node marketing/swuple/script-touch.mjs   -> marketing/swuple/concepts/script-touch-sheet.png, script-touch-homescreen.png
 */
import { P, appIcon, homeScreens, markSheet } from "./sketch-kit.mjs";
import { script } from "./script-geometry.mjs";
import { END, finger, id, linear, radial, runs, solid, touch } from "./trail-kit.mjs";

// Heat from old to new: deep where the swipe began, light where the finger is now.
const HEAT = [[0, "#8E1F17"], [0.25, P.heatDeep], [0.6, P.heat], [0.9, "#FF9A8C"], [1, "#FFE0D9"]];
// Heat all the way, lighter only at the finger.
const HEAT_EVEN = [[0, P.heat], [0.75, P.heat], [1, "#FFC9C1"]];
// Paper on a heat icon: dimmer where it's older.
const PAPER = [[0, "#F7A79F"], [0.5, "#FBD9D2"], [1, "#FFFFFF"]];
// Heat on a paper icon: paler where it's older.
const ON_PAPER = [[0, "#FF9A90"], [0.45, P.heat], [1, P.heat]];
// The finger in paper.
const PAPER_SKIN = {
  body: ["#D4CCBD", P.paper, "#FFFDF8", "#E4DDD0", "#B3A996"],
  nail: ["#FFFFFF", "#EAE2D5"],
  nailLine: "#CFC5B3",
  crease: "#B5AB98",
  ring: P.paper,
  shadow: "#000000",
};

/** Ink with depth: a little lighter at the top left. */
function ink() {
  const g = id("bg");
  return `<defs>${radial(g, "0.3", "0.2", "1", [[0, "#24232B"], [0.55, "#121216"], [1, "#060608"]])}</defs><rect width="1024" height="1024" fill="url(#${g})"/>`;
}
/** Heat with depth: light at the top right, deep at the bottom left. */
function heat() {
  const g = id("bg");
  return `<defs>${linear(g, 1, 0, 0, 1, [[0, "#FF7A66"], [0.45, P.heat], [1, "#B5241A"]])}</defs><rect width="1024" height="1024" fill="url(#${g})"/>`;
}

const word = (end) => script({ tail: END[end] });

/** The swipe ending at a finger from the bottom right. */
function swiped(bg, { colors = HEAT, tail = 0.4, F = 160, deg = 60, glow = P.heat, ripple = false, shadow = 0, halo = 0.5, w = 58 } = {}) {
  const R = runs(word("thumb"), { colors, tail, w });
  return bg() + solid(R, { shadow, glow: halo }) + finger(R.head, deg, F, { glow, ripple, skin: PAPER_SKIN });
}

const DRAW = {
  finger: () => appIcon(swiped(ink), P.ink1),
  ripple: () => appIcon(swiped(ink, { ripple: true }), P.ink1),
  even: () => appIcon(swiped(ink, { colors: HEAT_EVEN, tail: 0.75 }), P.ink1),
  thumb: () => appIcon(swiped(ink, { F: 210, deg: 52 }), P.ink1),
  flat: () => appIcon(swiped(ink, { halo: 0, glow: "" }), P.ink1),
  onHeat: () => appIcon(swiped(heat, { colors: PAPER, tail: 0.45, shadow: 0.3, halo: 0, glow: "#FFFFFF" }), P.heat),
  onPaper: () => appIcon(`<rect width="1024" height="1024" fill="${P.paper}"/>` + swiped(() => "", { colors: ON_PAPER, tail: 0.5, shadow: 0.15, halo: 0, glow: "" }), P.paper),
  touch: () => {
    const R = runs(word("corner"), { colors: HEAT });
    return appIcon(ink() + solid(R) + touch(R.head, 58, P.heat), P.ink1);
  },
};

const ICON = { inset: 0, vis: [0, 1024] };
const MARKS = [
  { title: "A  FINGER", ...ICON, draw: DRAW.finger },
  { title: "B  FINGER + TOUCH RINGS", ...ICON, draw: DRAW.ripple },
  { title: "C  EVEN TRAIL", ...ICON, draw: DRAW.even },
  { title: "D  THUMB", ...ICON, draw: DRAW.thumb },
  { title: "E  NO GLOW", ...ICON, draw: DRAW.flat },
  { title: "F  ON HEAT", ...ICON, draw: DRAW.onHeat },
  { title: "G  ON PAPER", ...ICON, draw: DRAW.onPaper },
  { title: "H  NO FINGER, TOUCH POINT", ...ICON, draw: DRAW.touch },
];

await markSheet(MARKS, "script-touch-sheet.png");
await homeScreens(await Promise.all(MARKS.map((m) => m.draw())), MARKS.map((m) => `${m.title[0]} swuple`), "script-touch-homescreen.png");
