/**
 * Mascot sketches for swuple: several characters, some drawn smooth and dissolving into pixels toward their trail.
 * Not final artwork.
 *
 *   node marketing/swuple/mascots.mjs       -> marketing/swuple/concepts/mascot-sheet.png
 *
 * Every character is drawn smooth in a 1024 box first. `fade` keeps it smooth above y0 and below that resamples it
 * into blocks that grow and pull apart toward the bottom: the trail of the swipe turning into game tiles.
 * `pixel` resamples the whole character on one grid.
 */
import { P, f, fade, icon, label, writeSheet } from "./sketch-kit.mjs";

// ---------------------------------------------------------------------------
// Characters, smooth, in a 1024 box
// ---------------------------------------------------------------------------

/** Two round eyes at (x, y), pupils high: looking up at the next game. */
function eyes(xs, y, { rx = 50, ry = 62, pr = 28, white = P.paper, pupil = P.ink1, look = [4, -26] } = {}) {
  return xs.map((x) => `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="${white}"/><circle cx="${x + look[0]}" cy="${y + look[1]}" r="${pr}" fill="${pupil}"/>`).join("");
}

const CHARACTERS = {
  /** A game tile with a face, hopping up out of its row; the smear under it becomes the trail. */
  tile: ({ body = P.heat, trail = P.heat, eye = {} } = {}) =>
    `<path d="M402 560 L622 560 L590 1000 L434 1000 Z" fill="${trail}"/>
     <rect x="312" y="170" width="400" height="400" rx="84" fill="${body}"/>${eyes([440, 584], 360, { rx: 46, ry: 58, pr: 26, ...eye })}`,
  /** The tile with a cowlick: one rounded up-chevron on its head. */
  tuft: () =>
    `<path d="M402 600 L622 600 L590 1000 L434 1000 Z" fill="${P.heat}"/>
     <path d="M440 196 L512 126 L584 196" fill="none" stroke="${P.heat}" stroke-width="44" stroke-linecap="round" stroke-linejoin="round"/>
     <rect x="312" y="220" width="400" height="390" rx="84" fill="${P.heat}"/>${eyes([440, 584], 405, { rx: 46, ry: 58, pr: 26 })}`,
  /** The button's arrow, alive: a rounded arrowhead with a face and a shaft for a trail. */
  arrow: () =>
    `<rect x="402" y="440" width="220" height="560" rx="40" fill="${P.heat}"/>
     <path d="M512 196 L782 520 L242 520 Z" fill="${P.heat}" stroke="${P.heat}" stroke-width="96" stroke-linejoin="round"/>
     ${eyes([458, 566], 440, { rx: 42, ry: 52, pr: 24, look: [3, -20] })}`,
  /** A comet: round head on top, a straight column of trail behind it. */
  comet: () =>
    `<rect x="402" y="380" width="220" height="620" rx="40" fill="${P.heat}"/>
     <circle cx="512" cy="360" r="222" fill="${P.heat}"/>${eyes([436, 588], 345)}`,
};

/**
 * Hand-drawn pixel sprites: H heat, W paper, I ink; a/b/c are trail tiles at 70, 45 and 28 % of a cell, drawn apart.
 * Eyes are 2 x 2 with the pupil top right: looking up at the next game.
 */
const SPRITES = {
  tile: [
    ".HHHHHHHH.",
    "HHHHHHHHHH",
    "HHWIHHWIHH",
    "HHWWHHWWHH",
    "HHWWHHWWHH",
    "HHHHHHHHHH",
    "HHHHHHHHHH",
    ".HHHHHHHH.",
    "...aaaa...",
    "....bb....",
    "....c.....",
  ],
  arrow: [
    ".....H.....",
    "....HHH....",
    "...HHHHH...",
    "..HWIHWIH..",
    ".HHWWHWWHH.",
    "HHHHHHHHHHH",
    "...HHHHH...",
    "...HHHHH...",
    "...aaaaa...",
    "....bbb....",
    ".....c.....",
  ],
  bunny: [
    "..HH..HH..",
    "..HH..HH..",
    "..HH..HH..",
    ".HHHHHHHH.",
    "HHHHHHHHHH",
    "HHWIHHWIHH",
    "HHWWHHWWHH",
    "HHHHHHHHHH",
    ".HHHHHHHH.",
    "..aaaaaa..",
    "...bbbb...",
    "....cc....",
  ],
};

function sprite(rows) {
  const cols = Math.max(...rows.map((r) => r.length));
  const cell = Math.min(760 / cols, 860 / rows.length);
  const x0 = 512 - (cols * cell) / 2, y0 = 512 - (rows.length * cell) / 2;
  const fills = { H: P.heat, W: P.paper, I: P.ink1 };
  const trail = { a: 0.7, b: 0.45, c: 0.28 };
  return rows
    .map((row, r) =>
      [...row]
        .map((ch, c) => {
          if (ch === ".") return "";
          const [x, y] = [x0 + c * cell, y0 + r * cell];
          if (trail[ch]) {
            const s = cell * trail[ch];
            return `<rect x="${f(x + (cell - s) / 2)}" y="${f(y + (cell - s) / 2)}" width="${f(s)}" height="${f(s)}" rx="${f(s * 0.18)}" fill="${P.heat}"/>`;
          }
          return `<rect x="${f(x - 0.6)}" y="${f(y - 0.6)}" width="${f(cell + 1.2)}" height="${f(cell + 1.2)}" fill="${fills[ch]}"/>`;
        })
        .join(""),
    )
    .join("");
}

async function render(v) {
  if (v.mode === "pixel") return sprite(SPRITES[v.who]);
  const body = CHARACTERS[v.who](v.opts);
  return v.mode === "smooth" ? body : fade(body, v);
}

// ---------------------------------------------------------------------------
// Sheet
// ---------------------------------------------------------------------------

const FADE = { b0: 28, b1: 96, gap: 0.3 };
/** The tile body is 400 wide around x = 512: 15 blocks of this size fill it exactly, so the first rows don't overhang. */
const TILE_FADE = { ...FADE, b0: 400 / 15 };
const VARIANTS = [
  { title: "A  TILE · FADE", who: "tile", mode: "fade", y0: 500, ...TILE_FADE },
  { title: "B  TILE · PIXEL", who: "tile", mode: "pixel" },
  { title: "C  TILE IN PAPER · FADE", who: "tile", opts: { body: P.paper, eye: { white: P.ink1, pupil: P.paper, pr: 14, look: [12, -26] } }, mode: "fade", y0: 500, ...TILE_FADE },
  { title: "D  TILE WITH A TUFT · FADE", who: "tuft", mode: "fade", y0: 540, ...TILE_FADE },
  { title: "E  ARROWHEAD · FADE", who: "arrow", mode: "fade", y0: 560, ...FADE },
  { title: "F  ARROWHEAD · PIXEL", who: "arrow", mode: "pixel" },
  { title: "G  COMET · FADE", who: "comet", mode: "fade", y0: 500, ...FADE },
  { title: "H  EARS UP · PIXEL", who: "bunny", mode: "pixel" },
];

const W = 2400, CELL_W = 600, CELL_H = 760;
const H = 2 * CELL_H + 80;

let sheet = `<rect width="${W}" height="${H}" fill="#000000"/>`;
for (const [i, v] of VARIANTS.entries()) {
  const art = await render(v);
  const x = (i % 4) * CELL_W + 50, y = Math.floor(i / 4) * CELL_H + 50;
  sheet += icon(art, x, y, 480, 0.08);
  sheet += [96, 48, 32].map((s, k) => icon(art, x + [0, 120, 192][k], y + 530 + (96 - s) / 2, s, 0.08)).join("");
  sheet += label(v.title, x, y + 690, P.paperDim);
}
sheet += label("SKETCHES · NOT FINAL ARTWORK", 50, H - 30, P.paperMute, 22);

await writeSheet(sheet, W, H, "mascot-sheet.png");
