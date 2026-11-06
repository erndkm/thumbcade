/**
 * The thumbprint, swiped: Thumbcade's print (ridges around a hooked core, smooth at the top, then half pixels, then
 * full pixels toward the bottom) with a swipe toward the top right that smears it. The ridges on the right of the
 * print bend into the swipe and run out of the print as streaks, the inner ones furthest, thinning as the ink runs
 * out. The left of the print and its pixel bottom stay as they were, so it still reads as the old print.
 * Colors stay ink, heat and paper. Not final artwork.
 *
 *   node marketing/swuple/smear.mjs   -> marketing/swuple/concepts/smear-sheet.png, smear-homescreen.png, smear-icon.png
 */
import { P, appIcon, f, homeScreens, markSheet, writeSheet } from "./sketch-kit.mjs";

const rad = (d) => (d * Math.PI) / 180;

/**
 * A print is authored like build-brand.ts authors Thumbcade's: ring k is a circle of radius (2k + 1) * cell around the
 * print center, one cell wide, so its lower part can resolve into pixels on the cell grid.
 *
 * A ridge is an arc of ring k from `from` to `to` (degrees, 0 = 3 o'clock, clockwise). With `streak` (cells) it then
 * bends into the swipe on a radius of `bend` cells and runs straight on, thinning to `taper` of its width. `trim`
 * shortens the arc from its start until it clears every other ridge by a full cell, so ridges stop short of the
 * streaks that cross them. `dash` breaks the end of the streak off: [gap, dash length] in cells.
 */
const PRINT = {
  cell: 42,
  halfPixelsFrom: 1.5,
  fullPixelsFrom: 3.5,
  ridges: [
    { k: 0, from: 280, to: 490 },
    { k: 1, from: 335, to: 185, trim: true },
    { k: 1, from: 165, to: 0, streak: 11, bend: 0.8 },
    { k: 2, from: 340, to: 268, trim: true },
    { k: 2, from: 248, to: 0, streak: 9 },
    { k: 3, from: 345, to: 212, trim: true },
    { k: 3, from: 198, to: 0, streak: 7, bend: 1.2 },
  ],
};

/** Three wide ridges, like Thumbcade's bold print: fewer, wider streaks that hold up at small sizes. */
const BOLD = {
  cell: 50,
  halfPixelsFrom: 1,
  fullPixelsFrom: 2.5,
  ridges: [
    { k: 0, from: 280, to: 490 },
    { k: 1, from: 335, to: 205, trim: true },
    { k: 1, from: 185, to: 0, streak: 10, bend: 0.8 },
    { k: 2, from: 345, to: 240, trim: true },
    { k: 2, from: 222, to: 0, streak: 7.5, bend: 1.2 },
  ],
};

/** The streaks keep the ridges' full weight to their round ends. */
const FULL = { ...PRINT, ridges: PRINT.ridges.map((r) => (r.streak ? { ...r, taper: 1 } : r)) };

/** The streaks run on past the top right corner, out of the icon. The print stays where it is in PRINT. */
const LONG = { ...PRINT, ridges: PRINT.ridges.map((r) => (r.streak ? { ...r, streak: r.streak + 5 } : r)) };

/** The ink runs out: each streak breaks off before its tip. */
const DASHED = { ...PRINT, ridges: PRINT.ridges.map((r) => (r.streak ? { ...r, streak: r.streak + 1.2, dash: [0.7, 1.6] } : r)) };

/** The swipe heads up and to the right. */
const SWIPE = rad(-45);

/** Centerline points [x, y, half width] of a ridge, around the print center. */
function centerline(ridge, cell) {
  const r = (2 * ridge.k + 1) * cell;
  const h = cell / 2;
  const sweep = ridge.to - ridge.from;
  const pts = [];
  const n = Math.max(2, Math.ceil(Math.abs(rad(sweep)) * r / 2));
  for (let i = 0; i <= n; i++) {
    const a = rad(ridge.from + (sweep * i) / n);
    pts.push([r * Math.cos(a), r * Math.sin(a), h]);
  }
  if (!ridge.streak) return [pts];
  // Bend from the arc's heading into the swipe, then run straight.
  const dir = Math.sign(sweep);
  const end = rad(ridge.to);
  let heading = Math.atan2(Math.cos(end) * dir, -Math.sin(end) * dir);
  const turn = Math.atan2(Math.sin(SWIPE - heading), Math.cos(SWIPE - heading));
  const rho = (ridge.bend ?? 1) * cell;
  let [x, y] = pts.at(-1);
  let run = 0;
  const steps = Math.ceil((Math.abs(turn) * rho) / 2);
  for (let i = 0; i < steps; i++) {
    heading += turn / steps;
    const ds = (Math.abs(turn) * rho) / steps;
    x += Math.cos(heading) * ds;
    y += Math.sin(heading) * ds;
    run += ds;
    pts.push([x, y, h]);
  }
  const straight = Math.max(0, ridge.streak * cell - run);
  const m = Math.ceil(straight / 2);
  const taper = ridge.taper ?? 0.4;
  const tail = [];
  for (let i = 1; i <= m; i++) {
    x += (Math.cos(heading) * straight) / m;
    y += (Math.sin(heading) * straight) / m;
    tail.push([x, y, h * (1 - (1 - taper) * (i / m)), (i * straight) / m]);
  }
  if (!ridge.dash) return [[...pts, ...tail.map(([px, py, ph]) => [px, py, ph])]];
  // Break the streak: a gap, then a last dash that keeps thinning to the tip.
  const [gap, dash] = ridge.dash.map((v) => v * cell);
  const cut = straight - dash - gap;
  return [
    [...pts, ...tail.filter((p) => p[3] <= cut).map(([px, py, ph]) => [px, py, ph])],
    tail.filter((p) => p[3] >= cut + gap).map(([px, py, ph]) => [px, py, ph]),
  ];
}

function segment(x, y, a, b) {
  const vx = b[0] - a[0], vy = b[1] - a[1];
  const l2 = vx * vx + vy * vy || 1e-9;
  const t = Math.max(0, Math.min(1, ((x - a[0]) * vx + (y - a[1]) * vy) / l2));
  return Math.hypot(x - a[0] - t * vx, y - a[1] - t * vy) - (a[2] + (b[2] - a[2]) * t);
}

/** Distance from (x, y) to the ink of a polyline (negative inside). */
function distance(x, y, pts) {
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) best = Math.min(best, segment(x, y, pts[i - 1], pts[i]));
  return best;
}

const length = (pts) => pts.reduce((s, p, i) => (i ? s + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : s), 0);

/** All ridge polylines of a print, trimmed clear of each other. */
function ridges(print) {
  const lines = print.ridges.map((r) => ({ trim: r.trim, parts: centerline(r, print.cell) }));
  for (const line of lines) {
    if (!line.trim) continue;
    const others = lines.filter((o) => o !== line).flatMap((o) => o.parts);
    const pts = line.parts[0];
    while (pts.length > 2 && Math.min(...others.map((o) => distance(pts[0][0], pts[0][1], o))) - pts[0][2] < print.cell - 2) pts.shift();
  }
  // A trimmed arc too short to read as a ridge goes.
  return lines.flatMap((l) => l.parts).filter((pts) => pts.length > 1 && length(pts) >= 1.2 * print.cell);
}

/** A polyline as a filled outline with round ends. */
function outline(pts) {
  const left = [], right = [];
  pts.forEach(([x, y, h], i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const nx = -(b[1] - a[1]) / l, ny = (b[0] - a[0]) / l;
    left.push([x + nx * h, y + ny * h]);
    right.push([x - nx * h, y - ny * h]);
  });
  const cap = (p, q) => {
    const l = Math.hypot(p[0] - q[0], p[1] - q[1]) || 1;
    const tx = (p[0] - q[0]) / l, ty = (p[1] - q[1]) / l;
    return Array.from({ length: 15 }, (_, i) => {
      const a = (Math.PI * (i + 1)) / 16;
      // From the left side (-ty, tx) round the tip to the right side.
      return [p[0] + p[2] * (-ty * Math.cos(a) + tx * Math.sin(a)), p[1] + p[2] * (tx * Math.cos(a) + ty * Math.sin(a))];
    });
  };
  return [...left, ...cap(pts.at(-1), pts.at(-2)), ...right.reverse(), ...cap(pts[0], pts[1])];
}

/** Pixel runs [x, y, w, size] below the smooth part, on the cell grid around the print center. */
function pixels(print, lines) {
  const C = print.cell;
  const inside = (x, y) => lines.some((pts) => distance(x, y, pts) < 0);
  const bands = [
    [C / 2, print.halfPixelsFrom * C, print.fullPixelsFrom * C, 0],
    [C, print.fullPixelsFrom * C, Infinity, C / 2],
  ];
  const out = [];
  for (const [size, from, to, offset] of bands) {
    const n = Math.ceil(600 / size);
    for (let j = -n; j <= n; j++) {
      const top = j * size - offset;
      if (top < from || top >= to) continue;
      for (let i = -n; i <= n; i++) {
        const left = i * size - offset;
        if (!inside(left + size / 2, top + size / 2)) continue;
        const last = out.at(-1);
        if (last && last[1] === top && last[3] === size && last[0] + last[2] === left) last[2] += size;
        else out.push([left, top, size, size]);
      }
    }
  }
  return out;
}

/** Where the print center goes so that the ink of `spec` is centered in the 1024 box. */
function centered(spec) {
  const pts = ridges(spec).map(outline).flat();
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return [Math.round(512 - (Math.min(...xs) + Math.max(...xs)) / 2), Math.round(512 - (Math.min(...ys) + Math.max(...ys)) / 2)];
}

let uid = 0;
/** The print in a 1024 box in one color, its ink centered, or placed like the ink of `placeAs`. */
function print(spec, color, { placeAs = spec } = {}) {
  const lines = ridges(spec);
  const shapes = lines.map(outline);
  const [cx, cy] = centered(placeAs);
  const id = `smear${uid++}`;
  const smooth = shapes.map((s) => "M" + s.map(([x, y]) => `${f(cx + x)} ${f(cy + y)}`).join("L") + "Z").join("");
  const px = pixels(spec, lines).map(([x, y, w, s]) => `M${f(cx + x)} ${f(cy + y)}h${f(w)}v${f(s)}h${f(-w)}z`).join("");
  return `<defs><clipPath id="${id}"><rect x="-512" y="-512" width="2048" height="${f(512 + cy + spec.halfPixelsFrom * spec.cell + 0.5)}"/></clipPath></defs>
  <g clip-path="url(#${id})"><path d="${smooth}" fill="${color}"/></g><path d="${px}" fill="${color}"/>`;
}

const DRAW = {
  smear: () => appIcon(print(PRINT, P.heat), P.ink1),
  long: () => appIcon(print(LONG, P.heat, { placeAs: PRINT }), P.ink1),
  bold: () => appIcon(print(BOLD, P.heat), P.ink1),
  full: () => appIcon(print(FULL, P.heat), P.ink1),
  dashed: () => appIcon(print(DASHED, P.heat), P.ink1),
  inkOnHeat: () => appIcon(print(PRINT, P.ink1), P.heat),
  paperOnHeat: () => appIcon(print(PRINT, P.paper), P.heat),
  heatOnPaper: () => appIcon(print(PRINT, P.heat), P.paper),
};

const ICON = { inset: 0, vis: [0, 1024] };
const MARKS = [
  { title: "A  SMEAR", ...ICON, draw: DRAW.smear },
  { title: "B  OFF THE EDGE", ...ICON, draw: DRAW.long },
  { title: "C  BOLD, THREE RIDGES", ...ICON, draw: DRAW.bold },
  { title: "D  FULL-WEIGHT STREAKS", ...ICON, draw: DRAW.full },
  { title: "E  INK RUNS OUT", ...ICON, draw: DRAW.dashed },
  { title: "F  INK ON HEAT", ...ICON, draw: DRAW.inkOnHeat },
  { title: "G  PAPER ON HEAT", ...ICON, draw: DRAW.paperOnHeat },
  { title: "H  HEAT ON PAPER", ...ICON, draw: DRAW.heatOnPaper },
];

await markSheet(MARKS, "smear-sheet.png");
await homeScreens(await Promise.all(MARKS.map((m) => m.draw())), MARKS.map((m) => `${m.title[0]} swuple`), "smear-homescreen.png");
// A, large, to look at on its own.
await writeSheet(`<rect width="1024" height="1024" fill="#000000"/>${DRAW.smear()}`, 1024, 1024, "smear-icon.png");
