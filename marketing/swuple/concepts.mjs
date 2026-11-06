/**
 * Sketches of alternative swuple logo directions, side by side, for choosing a direction. Not final artwork.
 *
 *   node marketing/swuple/concepts.mjs      -> marketing/swuple/concepts/concept-sheet.png
 *
 * 1 D-pad, up pressed   2 Word tiles SW·UP·LE   3 The card lifting off   4 Swup, a tile mascot
 * Each shows the app icon, small sizes, and a lockup with the wordmark on ink and on paper.
 */
import { P, f, glyphAt, icon, label, place, text, tile, writeSheet } from "./sketch-kit.mjs";

// ---------------------------------------------------------------------------
// The marks, each drawn in a 1024 box on a transparent background
// ---------------------------------------------------------------------------

/** 1. A D-pad in dark hardware plastic. Only up is pressed, in heat. */
function dpad() {
  const c = 512, A = 250, R = 330, r = 44;
  const cross = (fill) => `<rect x="${c - R}" y="${c - A / 2}" width="${2 * R}" height="${A}" rx="${r}" fill="${fill}"/><rect x="${c - A / 2}" y="${c - R}" width="${A}" height="${2 * R}" rx="${r}" fill="${fill}"/>`;
  const top = c - R, mid = c - A / 2 + 6;
  /** Outward chevron on an arm: angle 0 = up. */
  const chev = (deg, fill, dy = 0) => `<path d="M${c} ${c - 292 + dy} L${c + 50} ${c - 236 + dy} L${c - 50} ${c - 236 + dy} Z" fill="${fill}" transform="rotate(${deg} ${c} ${c})" stroke="${fill}" stroke-width="14" stroke-linejoin="round"/>`;
  return `<defs><linearGradient id="dp-body" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3A3A44"/><stop offset="1" stop-color="#26262D"/></linearGradient>
    <linearGradient id="dp-up" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FF6A5E"/><stop offset="1" stop-color="${P.heat}"/></linearGradient></defs>
    <g transform="translate(0 24)">${cross("#08080A")}</g>
    ${cross("url(#dp-body)")}
    <path d="M${c - A / 2} ${mid} V${top + r} Q${c - A / 2} ${top} ${c - A / 2 + r} ${top} H${c + A / 2 - r} Q${c + A / 2} ${top} ${c + A / 2} ${top + r} V${mid} Z" fill="url(#dp-up)" transform="translate(0 10)"/>
    <circle cx="${c}" cy="${c}" r="64" fill="#1C1C22"/><circle cx="${c}" cy="${c}" r="64" fill="none" stroke="#44444F" stroke-width="3"/>
    ${chev(0, P.ink1, 10)}
    ${[90, 180, 270].map((d) => chev(d, "#5A5A66")).join("")}`;
}

/** 2. The name on word-game tiles, read in pairs: SW / UP / LE. UP in heat. */
function tilesIcon() {
  const T = 236, G = 22;
  const rows = ["SW", "UP", "LE"];
  const x0 = 512 - (T + G / 2), y0 = 512 - (T + G);
  return rows
    .map((row, r) =>
      [...row]
        .map((ch, c) => {
          const cx = x0 + T / 2 + c * (T + G), cy = y0 + r * (T + G);
          const hot = r === 1;
          return tile(cx, cy, T, hot ? P.heat : P.ink3, 30) + glyphAt(ch, 150, cx, cy, hot ? P.ink1 : P.paper);
        })
        .join(""),
    )
    .join("");
}
/** The tiles as a horizontal wordmark: S W U P L E. */
function tilesRow(x, cy, T, light) {
  return [..."SWUPLE"]
    .map((ch, i) => {
      const hot = ch === "U" || ch === "P";
      const cx = x + T / 2 + i * (T * 1.1);
      return tile(cx, cy, T, hot ? P.heat : light ? P.ink1 : P.ink3, T * 0.13) + glyphAt(ch, T * 0.64, cx, cy, hot ? P.ink1 : P.paper);
    })
    .join("");
}

/** 3. The feed: the top card lifts off up and away, the next one waits underneath. */
function cards() {
  const W = 430, H = 570, rx = 64;
  const card = (cx, cy, s, fill, extra = "") => `<rect x="${f(cx - (W * s) / 2)}" y="${f(cy - (H * s) / 2)}" width="${f(W * s)}" height="${f(H * s)}" rx="${f(rx * s)}" fill="${fill}" ${extra}/>`;
  const fx = 534, fy = 400;
  return `${card(512, 676, 0.84, P.ink3)}${card(512, 616, 0.94, P.ink4)}
    <g transform="rotate(-9 ${fx} ${fy})">${card(fx, fy, 1, P.heat)}
      <path d="M${fx - 92} ${fy + 34} L${fx} ${fy - 58} L${fx + 92} ${fy + 34}" fill="none" stroke="${P.ink1}" stroke-width="58" stroke-linecap="round" stroke-linejoin="round"/></g>`;
}

/** 4. Swup: a solid pixel sprite in heat, looking up, with a trail of shrinking tiles under its feet. */
function mascot() {
  // H heat, W paper (eye white), I ink (pupil, top right: looking up at the next game), a/b trail; '.' empty.
  const SPRITE = [
    "..HHHHHH..",
    ".HHHHHHHH.",
    "HHWIHHWIHH",
    "HHWWHHWWHH",
    "HHHHHHHHHH",
    "HHHHHHHHHH",
    ".HHHHHHHH.",
    ".HH....HH.",
    ".aa....aa.",
    ".bb....bb.",
  ];
  const cell = 64;
  const x0 = 512 - 5 * cell, y0 = 512 - 5 * cell + 20;
  const fills = { H: P.heat, W: P.paper, I: P.ink1 };
  const sizes = { a: 0.62, b: 0.34 };
  return SPRITE.map((row, r) =>
    [...row]
      .map((ch, c) => {
        if (ch === ".") return "";
        const [cx, cy] = [x0 + (c + 0.5) * cell, y0 + (r + 0.5) * cell];
        // The body is solid pixel art; only the trail breaks into separate tiles.
        if (sizes[ch]) return tile(cx, cy, cell * sizes[ch], P.heat, 10 * sizes[ch]);
        return `<rect x="${cx - cell / 2 - 2}" y="${cy - cell / 2 - 2}" width="${cell + 4}" height="${cell + 4}" fill="${fills[ch]}"/>`;
      })
      .join(""),
  ).join("");
}

/** `vis`: the mark's visible left and right edges in its 1024 box, so lockups space from the ink, not the box. */
const MARKS = [
  { title: "1  D-PAD, UP PRESSED", draw: dpad, vis: [182, 842] },
  { title: "2  WORD TILES  SW / UP / LE", draw: tilesIcon, tiles: true },
  { title: "3  THE CARD LIFTING OFF", draw: cards, vis: [270, 790] },
  { title: "4  SWUP, A PIXEL MASCOT", draw: mascot, vis: [192, 832] },
];

// ---------------------------------------------------------------------------
// Sheet
// ---------------------------------------------------------------------------

/** A lockup centered on (cx, cy). */
function lockup(m, cx, cy, light) {
  if (m.tiles) {
    const T = 72;
    return tilesRow(cx - (T * 1.1 * 5 + T) / 2, cy, T, light);
  }
  const s = 180, size = 72, gap = 32;
  const k = s / 1024;
  const markW = (m.vis[1] - m.vis[0]) * k;
  const wordW = text("swuple", size, 0, 0).width;
  const x = cx - (markW + gap + wordW) / 2;
  const w = text("swuple", size, x + markW + gap, cy + size * 0.27);
  return place(m.draw(), x - m.vis[0] * k, cy - s / 2, s) + `<path d="${w.d}" fill="${light ? P.ink1 : P.paper}"/>`;
}

const W = 2400, H = 1900;
let body = `<rect width="${W}" height="${H}" fill="#000000"/>`;
MARKS.forEach((m, i) => {
  const x = 60 + (i % 2) * 1180, y = 60 + Math.floor(i / 2) * 900;
  body += icon(m.draw(), x + 40, y + 40, 460);
  body += [96, 48, 32].map((s, k) => icon(m.draw(), x + 40 + [0, 120, 192][k], y + 560 + (96 - s) / 2, s)).join("");
  body += lockup(m, x + 850, y + 170, false);
  body += `<rect x="${x + 560}" y="${y + 330}" width="580" height="250" rx="8" fill="${P.paper}"/>`;
  body += lockup(m, x + 850, y + 455, true);
  body += label(m.title, x + 40, y + 760, P.paperDim, 26);
});
body += label("SKETCHES · NOT FINAL ARTWORK", 100, H - 40);

await writeSheet(body, W, H, "concept-sheet.png");
