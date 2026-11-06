/**
 * Frostwhisk's sprites. Keys: k ink, n night, d dusk, v mauve, r rose, b blush, e ember, o candle, y butter, c cream,
 * w wood, m moss, s sage, t teal, i mist, p pond, g glacier, f frost. `.` is clear.
 *
 * Every mallet is a round striker seen from above with its owner's face on it: a copper rim and the witch's black cat
 * for you, and one critter per rung of the ladder. Faces are placed pixel by pixel on a 17 px disc (radius 8, the
 * mallet's size on the ice) and change with the moment: watching, blinking, swinging, cheering, shocked, dizzy.
 */
import { outlineRows, sprite } from "./pixel.ts";

export type Species = "cat" | "frog" | "hedgehog" | "owl" | "fox" | "raccoon";
export type Mood = "look" | "blink" | "swing" | "cheer" | "shock" | "dizzy";

/** Sprite size: the 17 px disc plus room for ears and outline. The disc's centre is at (CX, CY). */
export const HEAD_W = 23;
export const HEAD_H = 25;
export const CX = 11;
export const CY = 14;

interface Look {
  rim: string;
  rimDark: string;
  fur: string;
  furDark: string;
  eye: string;
}

const LOOKS: Record<Species, Look> = {
  cat: { rim: "o", rimDark: "e", fur: "n", furDark: "k", eye: "y" },
  frog: { rim: "i", rimDark: "t", fur: "s", furDark: "m", eye: "k" },
  hedgehog: { rim: "s", rimDark: "m", fur: "b", furDark: "r", eye: "k" },
  owl: { rim: "y", rimDark: "o", fur: "v", furDark: "d", eye: "k" },
  fox: { rim: "b", rimDark: "r", fur: "o", furDark: "e", eye: "k" },
  raccoon: { rim: "r", rimDark: "e", fur: "d", furDark: "n", eye: "k" },
};

class Grid {
  rows: string[][];
  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.rows = Array.from({ length: h }, () => Array.from({ length: w }, () => "."));
  }
  set(x: number, y: number, k: string): void {
    if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.rows[y]![x] = k;
  }
  get(x: number, y: number): string {
    return this.rows[y]?.[x] ?? ".";
  }
  /** Stamps a small map (`.` skipped) with its top-left at (x, y). */
  stamp(x: number, y: number, map: readonly string[]): void {
    map.forEach((row, j) => [...row].forEach((ch, i) => ch !== "." && this.set(x + i, y + j, ch)));
  }
  toRows(): string[] {
    return this.rows.map((r) => r.join(""));
  }
}

const inDisc = (x: number, y: number, r: number) => (x - CX) ** 2 + (y - CY) ** 2 <= r * r + r * 0.6;

/** Ears, tufts, spikes and eyes-on-top, drawn before the disc so the rim overlaps their base. */
function topper(g: Grid, sp: Species, l: Look): void {
  switch (sp) {
    case "cat":
      g.stamp(CX - 8, CY - 10, ["n.....", "nn....", "nrn...", "nrrn..", "nnnnn."]);
      g.stamp(CX + 3, CY - 10, [".....n", "....nn", "...nrn", "..nrrn", ".nnnnn"]);
      break;
    case "fox":
      g.stamp(CX - 8, CY - 11, ["k.....", "kk....", "ook...", "obo...", "obbo..", "ooooo."]);
      g.stamp(CX + 3, CY - 11, [".....k", "....kk", "...koo", "...obo", "..obbo", ".ooooo"]);
      break;
    case "frog":
      // Eyes bulge over the rim.
      g.stamp(CX - 7, CY - 11, [".sss.", "sccc.", "sckcs", "sckcs", ".sss."]);
      g.stamp(CX + 3, CY - 11, [".sss.", ".cccs", "sckcs", "sckcs", ".sss."]);
      break;
    case "owl":
      g.stamp(CX - 7, CY - 10, ["v....", "vv...", "vdv..", ".vvv."]);
      g.stamp(CX + 3, CY - 10, ["....v", "...vv", "..vdv", ".vvv."]);
      break;
    case "hedgehog":
      // A crown of spikes round the top of the disc.
      for (let y = 0; y < g.h; y++) {
        for (let x = 0; x < g.w; x++) {
          const d = Math.hypot(x - CX, y - CY);
          const a = Math.atan2(y - CY, x - CX);
          if (y > CY + 3) continue;
          const tip = (((a + Math.PI) * 180) / Math.PI) % 30 < 11;
          if ((d >= 7.5 && d < 9.8) || (tip && d < 11.4 && d >= 9.8 && y < CY + 1)) g.set(x, y, d > 9.8 ? "e" : "w");
        }
      }
      break;
    case "raccoon":
      g.stamp(CX - 8, CY - 9, [".ddd.", "dnnnd", "dnnnd", ".ddd."]);
      g.stamp(CX + 4, CY - 9, [".ddd.", "dnnnd", "dnnnd", ".ddd."]);
      break;
  }
  void l;
}

function disc(g: Grid, l: Look): void {
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      if (!inDisc(x, y, 8)) continue;
      const inner = inDisc(x, y, 5.6);
      const lower = x - CX + (y - CY) * 1.2 > 4;
      if (inner) g.set(x, y, l.fur);
      else g.set(x, y, lower ? l.rimDark : l.rim);
    }
  }
  // A glint on the rim, upper left, and a soft fur shadow lower right.
  g.set(CX - 5, CY - 5, "c");
  g.set(CX - 6, CY - 4, "c");
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) if (inDisc(x, y, 5.6) && !inDisc(x - 1, y - 1, 5.6)) g.set(x, y, l.furDark);
}

/** Face details that never change (muzzles, masks, beaks). */
function markings(g: Grid, sp: Species): void {
  switch (sp) {
    case "fox":
      g.stamp(CX - 3, CY + 1, ["cc...cc", ".ccccc.", "..ccc.."]);
      break;
    case "hedgehog":
      g.stamp(CX - 2, CY + 1, [".ccc.", "ccccc", ".ccc."]);
      break;
    case "raccoon":
      g.stamp(CX - 5, CY - 2, ["kkkk.kkkk", ".kkk.kkk."]);
      g.stamp(CX - 2, CY + 1, [".ccc.", "ccccc", ".ccc."]);
      break;
    case "owl":
      break;
    case "frog":
      g.set(CX - 4, CY + 2, "r");
      g.set(CX + 4, CY + 2, "r");
      break;
    case "cat":
      break;
  }
}

/** Eyes and mouth for a mood. `lx`, `ly` (-1..1) shift the pupils toward what it's watching. */
function face(g: Grid, sp: Species, l: Look, mood: Mood, lx: number, ly: number): void {
  const ex = 2;
  const ey = CY - 1;
  const L = CX - ex - 1;
  const R = CX + ex;
  const eye = sp === "raccoon" ? "c" : l.eye;
  const dx = Math.round(lx);
  const dy = Math.round(ly);
  if (sp === "owl") {
    // Two big round eyes that take up half the face.
    for (const x of [CX - 5, CX + 1]) {
      if (mood === "cheer") {
        g.stamp(x, CY - 2, [".kk.", "k..k"]);
      } else if (mood === "blink") {
        g.stamp(x, CY - 2, ["kkkk"]);
      } else {
        g.stamp(x, CY - 3, [".cc.", "cccc", "cccc", ".cc."]);
        if (mood === "dizzy") g.stamp(x, CY - 3, ["k..k", ".kk.", ".kk.", "k..k"]);
        else if (mood === "shock") g.set(x + 1 + (dx > 0 ? 1 : 0), CY - 2 + (dy > 0 ? 1 : 0), "k");
        else {
          const px = x + 1 + (dx > 0 ? 1 : dx < 0 ? 0 : 0);
          const py = CY - 2 + (dy > 0 ? 1 : 0);
          g.stamp(px, py, mood === "swing" ? ["kk"] : ["kk", "kk"]);
        }
      }
    }
  } else if (sp === "frog") {
    // The frog looks with its eyes on top: move those pupils, keep a mouth on the disc.
    const pupil = (x: number) => {
      g.set(x, CY - 9, "c");
      g.set(x, CY - 8, "c");
      g.set(x + Math.max(0, dx), CY - 9 + Math.max(0, dy), "k");
      g.set(x + Math.max(0, dx), CY - 8 + Math.min(0, dy), "k");
    };
    if (mood === "look" || mood === "swing") {
      pupil(CX - 5);
      pupil(CX + 5);
    } else if (mood === "blink" || mood === "cheer") {
      for (const x of [CX - 6, CX + 4]) g.stamp(x, CY - 9, mood === "cheer" ? [".s.", "s.s"] : ["sss", "..."]);
    } else if (mood === "dizzy") {
      for (const x of [CX - 6, CX + 4]) g.stamp(x, CY - 10, ["k.k", ".k.", "k.k"]);
    } else {
      for (const x of [CX - 6, CX + 4]) g.stamp(x, CY - 10, ["ccc", "ckc", "ccc"]);
    }
  } else {
    switch (mood) {
      case "look":
      case "swing": {
        const narrow = mood === "swing";
        for (const x of [L, R]) {
          if (sp === "cat") {
            g.set(x, ey, eye);
            g.set(x + 1, ey, eye);
            if (!narrow) {
              g.set(x, ey - 1, eye);
              g.set(x + 1, ey - 1, eye);
            }
            g.set(x + (dx > 0 ? 1 : 0), ey - (narrow ? 0 : dy < 0 ? 1 : 0), "k");
          } else {
            g.set(x + (dx > 0 ? 1 : 0), ey, eye);
            if (!narrow) g.set(x + (dx > 0 ? 1 : 0), ey - 1, eye);
          }
        }
        break;
      }
      case "blink":
        for (const x of [L, R]) {
          g.set(x, ey, sp === "raccoon" ? "c" : l.furDark === "k" && sp === "cat" ? "d" : "k");
          g.set(x + 1, ey, sp === "raccoon" ? "c" : sp === "cat" ? "d" : "k");
        }
        break;
      case "cheer":
        for (const x of [L, R]) {
          const c = sp === "cat" ? "y" : sp === "raccoon" ? "c" : "k";
          g.set(x, ey, c);
          g.set(x + 1, ey - 1, c);
          g.set(x + 2, ey, c);
        }
        break;
      case "shock":
        for (const x of [L, R]) g.stamp(x, ey - 1, sp === "raccoon" ? ["cc", "ck"] : sp === "cat" ? ["yy", "yk"] : ["cc", "ck"]);
        break;
      case "dizzy":
        for (const x of [L - 1, R]) g.stamp(x, ey - 1, [sp === "cat" ? "y.y" : "c.c", sp === "cat" ? ".y." : ".c.", sp === "cat" ? "y.y" : "c.c"]);
        break;
    }
  }
  // Mouths and noses.
  const my = CY + 2;
  switch (sp) {
    case "cat":
      g.set(CX, my - 1, "r");
      if (mood === "cheer") g.stamp(CX - 1, my, ["r.r", ".r."]);
      else if (mood === "shock") g.stamp(CX - 1, my, [".k.", "k.k", ".k."].map((r) => r.replace(/k/g, "r")));
      else g.stamp(CX - 1, my, ["d.d"]);
      break;
    case "frog":
      if (mood === "cheer") g.stamp(CX - 3, my - 1, ["m.....m", ".mmmmm.", "..rrr.."]);
      else if (mood === "shock") g.stamp(CX - 1, my - 1, [".m.", "mkm", ".m."]);
      else if (mood === "dizzy") g.stamp(CX - 3, my, ["m.m.m.m", ".m.m.m."]);
      else g.stamp(CX - 3, my, ["mmmmmmm"]);
      break;
    case "owl":
      g.stamp(CX - 1, CY + 1, ["ooo", ".o."]);
      if (mood === "shock") g.set(CX, CY + 3, "k");
      break;
    case "hedgehog":
      g.set(CX, CY + 1, "k");
      if (mood === "cheer") g.stamp(CX - 1, CY + 2, ["k.k", ".k."]);
      else if (mood === "shock") g.set(CX, CY + 3, "k");
      break;
    case "fox":
      g.set(CX, CY + 1, "k");
      if (mood === "cheer") g.stamp(CX - 2, CY + 2, ["k...k", ".kkk."]);
      else if (mood === "shock") g.set(CX, CY + 3, "k");
      break;
    case "raccoon":
      g.set(CX, CY + 1, "k");
      if (mood === "cheer") g.stamp(CX - 2, CY + 2, ["k...k", ".kkk."]);
      else if (mood === "shock") g.set(CX, CY + 3, "k");
      else g.stamp(CX - 1, CY + 2, ["k.k"]);
      break;
  }
}

const cache = new Map<string, HTMLCanvasElement>();

/** A mallet head: species, mood and where it's looking (-1, 0 or 1 on each axis). Cached. */
export function head(sp: Species, mood: Mood, lx = 0, ly = 0): HTMLCanvasElement {
  const key = `${sp}|${mood}|${lx}|${ly}`;
  let c = cache.get(key);
  if (c) return c;
  const l = LOOKS[sp];
  const g = new Grid(HEAD_W - 2, HEAD_H - 2);
  topper(g, sp, l);
  disc(g, l);
  markings(g, sp);
  face(g, sp, l, mood, lx, ly);
  c = sprite(outlineRows(g.toRows(), "k", false));
  cache.set(key, c);
  return c;
}

/** The moonstone: a pale disc of frost with a butter crescent glint, four spin frames (11 × 11 + outline). */
// prettier-ignore
const STONE = [
  "...fffff...",
  "..fcccfff..",
  ".fccffffii.",
  "fccffffffii",
  "fcffffffffi",
  "fffffffffii",
  "ffffffffiii",
  "fffffffiiii",
  ".fffffiiii.",
  "..ffiiiii..",
  "...iiiii...",
];
const GLINTS: Array<Array<[number, number]>> = [
  [[6, 3], [7, 4], [7, 5]],
  [[6, 6], [5, 7], [4, 7]],
  [[3, 6], [3, 5], [4, 4]],
  [[4, 3], [5, 3], [6, 3]],
];

export const STONE_FRAMES: string[][] = GLINTS.map((gl) => {
  const rows = STONE.map((r) => [...r]);
  for (const [x, y] of gl) rows[y]![x] = "y";
  return outlineRows(rows.map((r) => r.join("")), "k", false);
});

/**
 * A tiny face for the HUD (7 × 5, no outline, so the HUD lanes stay narrow): each striker's rim colour, which is what
 * you see on the ice, with ink eyes and its own ears on top.
 */
export function badge(sp: Species): string[] {
  const f = LOOKS[sp].rim;
  const top =
    sp === "cat" || sp === "fox" ? `${f}.....${f}` : sp === "frog" ? ".kk.kk." : sp === "owl" ? `${f}.....${f}` : sp === "hedgehog" ? "k.k.k.k" : `${f}${f}...${f}${f}`;
  return [top, f.repeat(7), `${f}k${f}${f}${f}k${f}`, f.repeat(7), `.${f.repeat(5)}.`];
}

/** A cat's paw print in cream, for the first-run hint (9 × 9). */
// prettier-ignore
export const PAW = [
  ".c..c....",
  "ccc.ccc..",
  ".c..cc.c.",
  "......ccc",
  "..ccc..c.",
  ".ccccc...",
  ".ccccc...",
  "..ccc....",
];

/** A lantern on a post (5 × 9): the frame, the flame (swapped when it flickers) and the post. */
// prettier-ignore
export const LANTERN = [
  [".kkk.", "kyoyk", "kooyk", "kyook", ".kkk.", "..w..", "..w..", "..w..", ".kwk."],
  [".kkk.", "koyok", "kyyok", "koyyk", ".kkk.", "..w..", "..w..", "..w..", ".kwk."],
];

/** A little crescent moon for the clock (7 × 7). */
// prettier-ignore
export const MOON = [
  "..ccc..",
  ".cyy...",
  "cyy....",
  "cyy....",
  "cyy....",
  ".cyy...",
  "..ccc..",
];

/** A snow pine (7 × 12) for the banks. */
// prettier-ignore
export const PINE = [
  "...c...",
  "..ctc..",
  ".cttpc.",
  "..ttp..",
  ".cttpp.",
  "cctttpc",
  "..ttp..",
  ".ttttp.",
  "cttttpp",
  "ttttppp",
  "...w...",
  "...w...",
];

/** A sparkle (two frames), pixelwitch's mark on every icon and title. */
export const SPARKLE = [
  ["..c..", "..c..", "ccycc", "..c..", "..c.."],
  ["c...c", ".c.c.", "..y..", ".c.c.", "c...c"],
];

/** Snowflake for the falling snow (3 × 3). */
export const FLAKE = [".c.", "cfc", ".c."];

export function sprites(): {
  stone: HTMLCanvasElement[];
  lantern: HTMLCanvasElement[];
  moon: HTMLCanvasElement;
  pine: HTMLCanvasElement;
  sparkle: HTMLCanvasElement[];
  paw: HTMLCanvasElement;
  flake: HTMLCanvasElement;
  badges: Record<Species, HTMLCanvasElement>;
} {
  const sps: Species[] = ["cat", "frog", "hedgehog", "owl", "fox", "raccoon"];
  return {
    stone: STONE_FRAMES.map((f) => sprite(f)),
    lantern: LANTERN.map((l) => sprite(l)),
    moon: sprite(outlineRows(MOON, "k", false)),
    pine: sprite(PINE),
    sparkle: SPARKLE.map((s) => sprite(s)),
    paw: sprite(outlineRows(PAW, "k", false)),
    flake: sprite(FLAKE),
    badges: Object.fromEntries(sps.map((s) => [s, sprite(badge(s))])) as Record<Species, HTMLCanvasElement>,
  };
}
