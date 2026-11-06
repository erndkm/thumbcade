/**
 * More swuple logo directions without a character: arrows, chevrons, a monogram, tiles, hardware. Most use the
 * smooth-to-pixel fade (sketch-kit.mjs): the leading edge stays smooth, the trail dissolves into game tiles.
 * Not final artwork.
 *
 *   node marketing/swuple/marks.mjs         -> marketing/swuple/concepts/marks-sheet.png
 */
import { P, f, fade, glyphAt, markSheet, tile } from "./sketch-kit.mjs";

const H = P.heat;

/** Each mark: `draw` returns 1024-box artwork; `vis` is its visible left and right edge, for spacing lockups. */
const MARKS = [
  {
    title: "A  ARROW, FADING",
    vis: [188, 836],
    // The shaft is 220 wide: 7 blocks of 220 / 7 fill it exactly, so the first rows don't overhang.
    draw: () =>
      fade(
        `<path d="M512 150 L800 452 L224 452 Z" fill="${H}" stroke="${H}" stroke-width="72" stroke-linejoin="round"/>
         <rect x="402" y="420" width="220" height="560" fill="${H}"/>`,
        { y0: 488, b0: 220 / 7, b1: 76 },
      ),
  },
  {
    title: "B  THREE CHEVRONS",
    vis: [220, 804],
    draw: () => {
      const chev = (y) => `<path d="M272 ${y + 124} L512 ${y} L752 ${y + 124}" fill="none" stroke="${H}" stroke-width="104" stroke-linecap="round" stroke-linejoin="round"/>`;
      return fade(chev(150) + chev(400) + chev(650), { y0: 350, b0: 24, b1: 72 });
    },
  },
  {
    title: "C  PLAY, TURNED UP",
    vis: [152, 872],
    // The play symbol, pointing up instead of right: play + up. Its base dissolves into tiles.
    draw: () =>
      fade(`<path d="M512 196 L832 740 L192 740 Z" fill="${H}" stroke="${H}" stroke-width="80" stroke-linejoin="round"/>`, {
        y0: 520,
        b0: 24,
        b1: 76,
      }),
  },
  {
    title: "D  S MONOGRAM, FADING",
    vis: [160, 864],
    draw: () => fade(glyphAt("s", 1135, 512, 512, H), { y0: 600, b0: 14, b1: 40, gap: 0.22 }),
  },
  {
    title: "E  THE TILE THAT ROSE",
    vis: [152, 872],
    // A word-game row of five; the middle tile has lifted out, leaving its slot and a trail.
    draw: () => {
      const row = [0, 1, 3, 4].map((i) => tile(512 + (i - 2) * 148, 700, 128, P.ink4, 24)).join("");
      const slot = `<rect x="452" y="640" width="120" height="120" rx="22" fill="none" stroke="${P.ink4}" stroke-width="8"/>`;
      return `${row}${slot}${tile(512, 572, 52, H, 10)}${tile(512, 500, 76, H, 14)}${tile(512, 316, 196, H, 38)}`;
    },
  },
  {
    title: "F  THE FADER",
    vis: [352, 672],
    // A hardware fader pushed all the way up; the travel it left behind is a trail of tiles in the slot.
    draw: () => {
      const ticks = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => `<rect x="372" y="${f(372 + i * 72)}" width="44" height="6" rx="3" fill="${P.ink4}"/>`).join("");
      const trail = [86, 72, 58, 44, 32, 22].map((s, i) => tile(512, 400 + i * 82, s, H, s * 0.18)).join("");
      return `<rect x="452" y="150" width="120" height="760" rx="60" fill="#18181D" stroke="${P.ink4}" stroke-width="6"/>${ticks}${trail}
        <rect x="352" y="160" width="320" height="170" rx="40" fill="${H}"/><rect x="384" y="240" width="256" height="10" rx="5" fill="${P.ink1}" opacity="0.85"/>`;
    },
  },
  {
    title: "G  THE FLICK",
    vis: [235, 725],
    draw: () =>
      fade(`<path d="M300 900 C360 760 470 640 560 520 S650 280 660 160" fill="none" stroke="${H}" stroke-width="130" stroke-linecap="round"/>`, {
        y0: 540,
        b0: 24,
        b1: 84,
      }),
  },
  {
    title: "H  PIXEL SUNRISE",
    vis: [136, 888],
    draw: async () => {
      const sun = await fade(`<circle cx="512" cy="480" r="230" fill="${H}"/>`, { y0: 470, b0: 22, b1: 64, gap: 0.22 });
      const horizon = [0, 1, 2, 3, 4, 5].map((i) => tile(512 + (i - 2.5) * 128, 790, 112, P.ink4, 22)).join("");
      return sun + horizon;
    },
  },
];

await markSheet(MARKS, "marks-sheet.png");
