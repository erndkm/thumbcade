/**
 * swuple as its own brand, free of Thumbcade's colors, type and button: the name swiped across the app icon by a
 * finger, and the same handwriting, on one line, as the wordmark. Each palette is two neighbouring hues for the icon
 * (a gradient from the top right to the bottom left), one color for the swipe and one for the light at the fingertip.
 * The trail fades into the icon toward its start, the oldest part of the swipe. Drawing helpers: trail-kit.mjs.
 * Not final artwork.
 *
 *   node marketing/swuple/identity.mjs   -> marketing/swuple/concepts/identity-sheet.png, identity-homescreen.png
 */
import { appIcon, clamp, f, homeScreens, lerp, markSheet } from "./sketch-kit.mjs";
import { oneLine, script } from "./script-geometry.mjs";
import { END, WHITE_SKIN, blur, finger, group, id, line, linear, mix, radial, runs } from "./trail-kit.mjs";

const WHITE = "#FFFFFF";
const LIME = "#D9FF3D";
const SUN = "#FFE14A";

/**
 * `bg`: top right, bottom left. `fade`: how much of the swipe shows at its oldest end (colored swipes fade less, since
 * mixed into the icon they turn muddy). `ink`: the wordmark on light backgrounds.
 */
const PALETTES = [
  { title: "GRAPE", bg: ["#A24BFF", "#5B1FE6"], trail: WHITE, glow: LIME },
  { title: "GRAPE, LIME SWIPE", bg: ["#A24BFF", "#5B1FE6"], trail: LIME, glow: LIME, fade: 0.78 },
  { title: "COBALT", bg: ["#3DB2FF", "#2D4BFF"], trail: WHITE, glow: SUN },
  { title: "BUBBLEGUM", bg: ["#FF7EB8", "#EE2E7D"], trail: WHITE, glow: SUN },
  { title: "MANGO", bg: ["#FFC23A", "#FF6A1F"], trail: WHITE, glow: WHITE },
  { title: "TEAL", bg: ["#22D8B2", "#0B7C8C"], trail: WHITE, glow: SUN },
  { title: "MIDNIGHT, LIME SWIPE", bg: ["#33197A", "#0E0726"], trail: LIME, glow: LIME, fade: 0.78, ink: "#33197A" },
  { title: "LEMON, GRAPE SWIPE", bg: ["#FFF04A", "#FFC400"], trail: "#4A1FC8", glow: WHITE, fade: 0.72, ink: "#4A1FC8" },
];

/** The icon's background at a point: the gradient, plus the soft light at the top left. */
function bgAt(pal, [x, y]) {
  const base = mix(pal.bg[0], pal.bg[1], ((1024 - x) + y) / 2048);
  return mix(base, WHITE, 0.14 * clamp(1 - Math.hypot(x - 256, y - 154) / 720));
}
function background(pal) {
  const [g, light] = [id("bg"), id("light")];
  return `<defs>
      ${linear(g, 1, 0, 0, 1, [[0, pal.bg[0]], [1, pal.bg[1]]])}
      <radialGradient id="${light}" gradientUnits="userSpaceOnUse" cx="256" cy="154" r="720">
        <stop offset="0" stop-color="${WHITE}" stop-opacity="0.14"/><stop offset="1" stop-color="${WHITE}" stop-opacity="0"/>
      </radialGradient>
    </defs><rect width="1024" height="1024" fill="url(#${g})"/><rect width="1024" height="1024" fill="url(#${light})"/>`;
}

/** The finger in white, its shading and shadow tinted with the icon's deep hue. */
const skin = (pal) => ({
  ...WHITE_SKIN,
  body: [0.24, 0.05, 0, 0.1, 0.32].map((k) => mix(WHITE, pal.bg[1], k)),
  nail: [WHITE, mix(WHITE, pal.bg[1], 0.08)],
  nailLine: mix(WHITE, pal.bg[1], 0.28),
  crease: mix(WHITE, pal.bg[1], 0.38),
  shadow: mix(pal.bg[1], "#000000", 0.55),
});

/** The icon: the word swiped up across it, ending at a finger from the bottom right. */
function icon(pal) {
  // Older parts of the swipe show less: the trail's color is mixed into the background under it.
  const R = runs(script({ tail: END.thumb }), { w: 60, tail: 0.42, colors: (t, p) => mix(bgAt(pal, p), pal.trail, lerp(pal.fade ?? 0.42, 1, t ** 0.7)) });
  const shade = id("shade");
  const lift = `<defs>${blur(shade, 14)}</defs>` + group(R.list.map((rn) => line(rn, rn.w, mix(pal.bg[1], "#000000", 0.5))).join(""), `filter="url(#${shade})" opacity="0.3" transform="translate(0 12)"`);
  const body = group(R.list.map((rn) => line(rn, rn.w, rn.color)).join(""));
  return appIcon(background(pal) + lift + body + finger(R.head, 60, 160, { glow: pal.glow, skin: skin(pal), shadow: 0.5 }), pal.bg[1]);
}

// The wordmark: the same handwriting on one line, coming to a point where the swipe starts.
const LINE = oneLine();
const LINE_RUNS = runs(LINE, { w: 46, tail: 0.7, colors: [[0, WHITE], [1, WHITE]], point: [0, 300] });
const X_HEIGHT = 0.5; // of the lockup's type size
const wordmark = {
  width: (size) => (LINE.box[2] - LINE.box[0] + 46) * ((size * X_HEIGHT) / 190),
  draw: (m, x, baseline, size, light) => {
    const k = (size * X_HEIGHT) / 190;
    const color = light ? (m.pal.ink ?? m.pal.bg[1]) : WHITE;
    return `<g transform="translate(${f(x - (LINE.box[0] - 23) * k)} ${f(baseline - 400 * k)}) scale(${f(k)})">${group(LINE_RUNS.list.map((rn) => line(rn, rn.w, color)).join(""))}</g>`;
  },
};

const MARKS = PALETTES.map((pal, i) => ({ title: `${"ABCDEFGH"[i]}  ${pal.title}`, inset: 0, vis: [0, 1024], pal, draw: () => icon(pal) }));

await markSheet(MARKS, "identity-sheet.png", { wordmark });
await homeScreens(MARKS.map((m) => m.draw()), MARKS.map((m) => `${m.title[0]} swuple`), "identity-homescreen.png");
