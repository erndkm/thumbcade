/**
 * Pittermoon's sprites. Keys: k ink, n night, d dusk, v mauve, r rose, b blush, e ember, o candle, y butter, c cream,
 * w wood, m moss, s sage, t teal, i mist, p pond, g glacier, f frost, a first light. `.` is clear.
 *
 * The cat is the same black cat as on the potion shelf and the fishing dock (its back and front views come from
 * Bobberlight), now with a rose ribbon for its night out. Everything else is placed by hand, except the things that
 * roll (jack-o'-lanterns, yarn) and the toadstools, which are drawn from a little shape function at each angle so
 * their light stays put while they turn.
 */
import { outlineRows, sprite } from "./pixel.ts";

// ---- the cat (14 px wide; its feet sit on the bottom row) ------------------------------------------

/** From behind, ready to pad on. The rose band is its ribbon; a moonlit rim keeps it off the dark ground. */
// prettier-ignore
export const CAT_BACK = [
  ".k.......k....",
  "kvk.....kvk...",
  "kndkkkkkdnk...",
  "kdnnnnnnnnk...",
  "knnnnnnnnnk...",
  "kdnnnnnnnnk...",
  "knnnnnnnnnk...",
  ".knnnnnnnk....",
  "..krrrrrk.....",
  ".kdnndnnnk..k.",
  "kdnnndnnnnkkvk",
  "knnnndnnnnknk.",
  "knnnnnnnnnkk..",
  ".kkkkkkkkkk...",
];

/** Mid-hop: stretched long, paws tucked, tail out behind. */
// prettier-ignore
export const CAT_LEAP = [
  ".k.......k....",
  "kvk.....kvk...",
  "kndkkkkkdnk...",
  "kdnnnnnnnnk...",
  "knnnnnnnnnk...",
  "knnnnnnnnnk...",
  "kdnnnnnnnnk...",
  "knnnnnnnnnk...",
  ".knnnnnnnk....",
  "..krrrrrk.....",
  ".kdnndnnnk....",
  "kdnnndnnnnk...",
  "knnnndnnnnk...",
  ".knnnnnnnkkk..",
  "..kkkkkkknnvk.",
  "........kkkk..",
];

/**
 * Facing you (Bobberlight's sit), with the ribbon and its bell: how the cat waits between hops, looking down the hill
 * (toward you, and the sunrise). Its butter eyes glance at whatever is coming (see `catEyes`).
 */
// prettier-ignore
export const CAT_FRONT = [
  ".k.......k....",
  "kvk.....kvk...",
  "knrkkkkkrnk...",
  "knnnnnnnnnk...",
  "kncynnncynk...",
  "knyknnnyknk...",
  "knnnnrnnnnk...",
  ".knnndnnnk....",
  "..krryrrk.....",
  ".knnnnnnnk..k.",
  "knnnnnnnnnkkvk",
  "knnnnnnnnnknk.",
  "knndnnndnnkk..",
  ".kkkkkkkkkk...",
];

/** The waiting cat's eyes: pupils toward a hazard on the left, on the right, straight at you, or a blink. */
export type Eyes = "left" | "right" | "ahead" | "blink";
export function catEyes(eyes: Eyes): string[] {
  const rows = [...CAT_FRONT];
  if (eyes === "blink") {
    rows[4] = "knnnnnnnnnk...";
    rows[5] = "knkknnnkknk...";
  } else if (eyes === "left") rows[5] = "knkynnnkynk...";
  else if (eyes === "ahead") rows[5] = "knyknnnkynk...";
  return rows;
}

/** Pressed (or just landed), facing you: crouched for the next hop, two rows lower and a little wider. */
// prettier-ignore
export const CAT_FRONT_CROUCH = [
  "..............",
  "..............",
  ".k.......k....",
  "kvk.....kvk...",
  "knrkkkkkrnk...",
  "knnnnnnnnnk...",
  "kncynnncynk...",
  "knyknnnyknk...",
  ".knnnrnnnk....",
  ".kkrryrrkk....",
  "knnnnnnnnnkkvk",
  "knnnnnnnnnnknk",
  "knndnnndnnnkk.",
  "kkkkkkkkkkkk..",
];

/** Bowled over: squeezed-shut eyes (the stars are particles). */
// prettier-ignore
export const CAT_DIZZY = [
  ".k.......k....",
  "kvk.....kvk...",
  "knrkkkkkrnk...",
  "knnnnnnnnnk...",
  "knknnnnnknk...",
  "knnknnnknnk...",
  "knnnnrnnnnk...",
  ".knnnknnnk....",
  "..krryrrk.....",
  ".knnnnnnnk..k.",
  "knnnnnnnnnkkvk",
  "knnnnnnnnnknk.",
  "knndnnndnnkk..",
  ".kkkkkkkkkk...",
];

/** Soaked: ears flat, fur in spikes, very cross. */
// prettier-ignore
export const CAT_WET = [
  "..............",
  "kk.......kk...",
  "kvkkkkkkkvk...",
  "knnnnnnnnnk...",
  "knkkknkkknk...",
  "knyknnnyknk...",
  "knnnnrnnnnk...",
  ".knnnknnnk....",
  "..krryrrk.....",
  "knknnnnnknk.k.",
  "knnnnnnnnnkkvk",
  "knnnnnnnnnknk.",
  "kknknknknkkk..",
  ".k.k.k.k.k....",
];

/** Curled up asleep (game over): a loaf with its tail round its paws. */
// prettier-ignore
export const CAT_SLEEP = [
  "..k..k........",
  ".kvkkvkkkkk...",
  "kndnnnnnnnnkk.",
  "knkkknnnnnnnnk",
  "knnnnnnnnnnnnk",
  "kvnnnnnnnnnnnk",
  "kknnnnnnnnnnkk",
  ".kdvvvvvvvdkk.",
  "..kkkkkkkkk...",
];

/** Half asleep: one long yawn as first light reaches it. */
// prettier-ignore
export const CAT_YAWN = [
  ".k.......k....",
  "kvk.....kvk...",
  "knrkkkkkrnk...",
  "knnnnnnnnnk...",
  "knkknnnkknk...",
  "knnnnnnnnnk...",
  "knnnkrknnnk...",
  ".knnkrknnk....",
  "..krryrrk.....",
  ".knnnnnnnk..k.",
  "knnnnnnnnnkkvk",
  "knnnnnnnnnknk.",
  "knndnnndnnkk..",
  ".kkkkkkkkkk...",
];

/** Where the cat's body is centred in its 14 px map (the tail hangs off to the right). */
export const CAT_CX = 5;

// ---- brooms ----------------------------------------------------------------------------------

/**
 * An enchanted broom out sweeping on its own, flying right: straw fan behind, rose binding, a wooden handle with a
 * knob in front. Variants: plain, trailing ribbons, a parcel on a string (the market's couriers).
 */
// prettier-ignore
const BROOM_BODY = [
  "o..y.y....................",
  ".yoyoyy...................",
  "yoyoyoyorrwwwwwwwwwwwwwwwk",
  "oyoyoyoyrreeeeeeeeeeeeeeek",
  ".oyoyoy...................",
  "y..o.o....................",
];
export function broomRows(v: number): string[] {
  const rows = BROOM_BODY.map((r) => [...r]);
  const pad = (n: number) => {
    while (rows.length < n) rows.push([..."..........................".split("")]);
  };
  if (v === 1) {
    // Ribbons streaming back from the binding.
    pad(8);
    rows[4]![9] = "r";
    rows[5]![8] = "r";
    rows[5]![10] = "a";
    rows[6]![7] = "a";
    rows[6]![11] = "r";
  } else if (v === 2) {
    // A little parcel tied under the handle.
    pad(10);
    rows[4]![17] = "k";
    rows[5]![17] = "k";
    for (let x = 14; x <= 20; x++) for (let y = 6; y <= 9; y++) rows[y]![x] = y === 6 ? "o" : x === 17 ? "r" : "w";
  }
  return outlineRows(rows.map((r) => r.join("")), "k", false);
}

// ---- rolling things (drawn per angle) -------------------------------------------------------------

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
  toRows(): string[] {
    return this.rows.map((r) => r.join(""));
  }
}

/**
 * A jack-o'-lantern rolling: its ribs, carved face and stem turn with `a` (radians) while the moonlight on it stays
 * top left. `big` is the 15 px one.
 */
export function pumpkinRows(a: number, big: boolean): string[] {
  const W = big ? 15 : 12;
  const H = big ? 13 : 11;
  const g = new Grid(W + 2, H + 3);
  const cx = (W + 1) / 2;
  const cy = (H + 3) / 2 + 0.5;
  const rx = W / 2 - 0.2;
  const ry = H / 2 - 0.2;
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const e = (dx / rx) ** 2 + (dy / ry) ** 2;
      if (e > 1) continue;
      // Ribs turn with the pumpkin; the moonlight (top left) and shade (bottom right) stay put.
      const u = (dx * ca + dy * sa) / rx;
      const rib = Math.abs(Math.abs(u) - 0.62) < 0.1;
      const lit = dx / rx + dy / ry;
      let k = rib ? "e" : "o";
      if (lit < -0.9 && !rib) k = "y";
      else if (lit > 0.8) k = rib ? "w" : "e";
      if (e > 0.86) k = "k";
      g.set(x, y, k);
    }
  }
  // The carved face, glowing from the candle inside: two triangle eyes and a grin, turned with the pumpkin.
  const s = big ? 1.25 : 1;
  // prettier-ignore
  const face: Array<[number, number]> = [
    [-3, -1], [-2, -1], [-2, -2],
    [2, -1], [3, -1], [2, -2],
    [-3, 1.2], [-2, 2], [-1, 2], [0, 2], [1, 2], [2, 2], [3, 1.2], [-1, 1.2], [1, 1.2],
  ];
  for (const [fx, fy] of face) {
    const x = cx - 0.5 + (fx * ca - fy * sa) * s;
    const y = cy - 0.5 + (fx * sa + fy * ca) * s;
    const px = Math.round(x);
    const py = Math.round(y);
    if (g.get(px, py) === "k") continue;
    g.set(px, py, "c");
    // The carved edge below each hole catches the candlelight less.
    const bx = Math.round(x - sa * 0.9);
    const by = Math.round(y + ca * 0.9);
    if (g.get(bx, by) === "o" || g.get(bx, by) === "y") g.set(bx, by, "e");
  }
  // The stem, poking out wherever "up" has turned to.
  const sx = cx + sa * (rx + 0.8) - 0.5;
  const sy = cy - ca * (ry + 0.8) - 0.5;
  g.set(Math.round(sx), Math.round(sy), "m");
  g.set(Math.round(sx + sa * 1.2), Math.round(sy - ca * 1.2), "w");
  return outlineRows(g.toRows(), "k", false);
}

/** A runaway ball of yarn (9 px): wraps that turn with `a`, light top left. Colour keys per variant. */
export function yarnRows(a: number, v: number): string[] {
  const [base, dark, lite] = (v === 1 ? ["t", "p", "i"] : v === 2 ? ["y", "o", "c"] : ["r", "e", "b"]) as [string, string, string];
  const W = 9;
  const g = new Grid(W, W);
  const c = (W - 1) / 2;
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      const dx = x - c;
      const dy = y - c;
      const d = Math.hypot(dx, dy);
      if (d > 4.3) continue;
      const u = (dx * ca + dy * sa) / 4.3;
      const wv = (-dx * sa + dy * ca) / 4.3;
      let k: string = base;
      // Wraps: bands across the ball, bending round it.
      if (Math.abs(Math.sin((u + wv * wv * 0.5) * 6.2)) > 0.82) k = dark;
      if (dx + dy < -4.2) k = lite;
      if (d > 3.6) k = "k";
      g.set(x, y, k);
    }
  }
  return g.toRows();
}

// ---- wisps, boats, toadstools ----------------------------------------------------------------------

/** A will-o'-wisp: a friendly flame with a face (two frames of flicker). Edges in teal, it glows. */
// prettier-ignore
export const WISP = [
  [
    "....t....",
    "...tit...",
    "...tft...",
    "..tifit..",
    "..tfcft..",
    ".tifccfit",
    ".tfckckft",
    "tifcccfit",
    "tifcbcfit",
    ".tiffffit",
    "..tiiiit.",
    "...tttt..",
  ],
  [
    "...t.....",
    "...tt....",
    "..tift...",
    "..tfft...",
    ".tiffcit.",
    ".tifccfit",
    ".tfckckft",
    "tifcccfit",
    "tifcbcfit",
    ".tiffffit",
    "..tiiiit.",
    "...tttt..",
  ],
];

/** A paper boat (two cells long), folded from the witch's shopping list. */
// prettier-ignore
const BOAT2 = [
  "............kk..............",
  "...........kcfk.............",
  "..........kccffk............",
  ".........kcccfffk...........",
  "kkkkkkkkkcccccfffkkkkkkkkkkk",
  "kccccccccccccffffffffffiiiik",
  ".kcccccccccccfffffffiiiiiik.",
  "..kkkkkkkkkkkkkkkkkkkkkkkk..",
];

/** The big one (three cells) carries a candle in a jar. */
// prettier-ignore
const BOAT3 = [
  "...................kk.............kyk.....",
  "..................kcfk............kok.....",
  ".................kccffk..........kckck....",
  "................kcccfffk.........kcock....",
  "kkkkkkkkkkkkkkkkcccccfffkkkkkkkkkkkkkkkkkk",
  "kccccccccccccccccccccfffffffffffffffiiiik",
  ".kcccccccccccccccccccffffffffffffffiiiiik.",
  "..kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk..",
];

export function boatRows(v: number): string[] {
  const rows = v === 1 ? BOAT3 : BOAT2;
  const w = v === 1 ? 42 : 28;
  return rows.map((r) => r.padEnd(w, ".").slice(0, w));
}

/** A toadstool cap and stem (12 × 10). `sink` 0..1 pushes it down into the bog (the bottom is cut by the caller). */
// prettier-ignore
export const TOAD = [
  "...kkkkkk...",
  "..krrcrrrk..",
  ".krcrrrrcrk.",
  "krrrrrrcrrrk",
  "krcrrrrrrrck",
  "kbrrrcrrrrrk",
  ".kkkkkkkkkk.",
  "....kcck....",
  "....kcck....",
  "....kick....",
];

// ---- fish ------------------------------------------------------------------------------------

/** A silver fish (Bobberlight's minnow), and the golden moonfish. */
// prettier-ignore
export const FISH = [
  ".kkkk..k.",
  "kicciikik",
  "kkiiiikik",
  ".kkkk..k.",
];
export const GOLDFISH = FISH.map((r) => r.replaceAll("i", "o").replaceAll("c", "y"));

// ---- things in the way (one set per stretch of scenery) ----------------------------------------------

// prettier-ignore
const OBSTACLES: Record<string, string[][]> = {
  garden: [
    [
      ".....mw.......",
      "..smmw........",
      ".sm.kkkkkk....",
      "..kkoyooookk..",
      ".koyooeooooek.",
      "koyoooeoooooek",
      "koooooeooooeek",
      "kooooeoooooeek",
      "koooooeooooeek",
      ".keoooeoooeek.",
      "..kkeeeeeekk..",
      "....kkkkkk....",
    ],
    [
      "...s.s.m..",
      "..ssmsmsm.",
      ".smsmmsms.",
      "..msmsmm..",
      ".kkkkkkkk.",
      "kweeeeeewk",
      ".kwwwwwwk.",
      ".kweeeewk.",
      "..kwwwwk..",
      "..kkkkkk..",
    ],
    [
      "......kkk...",
      "..k..kgggk..",
      ".kgk.kgfgkk.",
      "kgfgkkggggfk",
      ".kgfggggggk.",
      "..kgfgggggk.",
      "..kggggggk..",
      "..kgpgggpk..",
      "...kkkkkk...",
    ],
  ],
  market: [
    [
      ".krkrk.kr...",
      "krrrkrkrrk..",
      "kkkkkkkkkkkk",
      "kweeweeweeek",
      "kwwwwwwwwwwk",
      "kweewweewwek",
      "kwwwwwwwwwwk",
      "kweewweewwek",
      "kwwwwwwwwwwk",
      "kkkkkkkkkkkk",
    ],
    [
      "..kkkkkkkk..",
      ".kwwewwewwk.",
      "kddddddddddk",
      "kweewweewwek",
      "kwwwwwwwwwwk",
      "kddddddddddk",
      "kweewweewwek",
      ".kwwwwwwwwk.",
      "..kkkkkkkk..",
    ],
    [
      "...kkkkkk...",
      "..k......k..",
      ".kyoyrkrrok.",
      "kwwwwwwwwwwk",
      "kweweweweewk",
      ".kwewewewek.",
      ".kwwwwwwwwk.",
      "..kkkkkkkk..",
    ],
  ],
  bog: [
    [
      "..s.m.s.....",
      ".kkmkkskk...",
      "kwmwwwmwwk..",
      "kweeeeeeewk.",
      "kwwewwweewk.",
      "kwweewwwewk.",
      "kwwwwewwwwk.",
      "kmwmwwmwwmk.",
      ".kkkkkkkkk..",
    ],
    [
      "..wk...kw...",
      "..wk..kew...",
      "..mk..km.kw.",
      ".kmsk.km.kw.",
      ".kmsk.ksk.m.",
      "..ms.kms.km.",
      ".kmsmkmskms.",
      "kmsmsmsmsmsk",
      ".kkkkkkkkkk.",
    ],
    [
      "...kkk......",
      "..kbbbk.kkk.",
      ".kbcbbbkbbbk",
      ".kkkkkkkcbbk",
      "...kck.kkkkk",
      "...kck..kck.",
      "..kkckkkkckk",
      ".kmsmsmsmsmk",
      "..kkkkkkkkk.",
    ],
  ],
  orchard: [
    [
      "...kkkkkkk....",
      ".kkmsmmsmmkk..",
      "kmsmmrmmsmmmk.",
      "kmmsmmmmmrmmk.",
      "kmrmmsmmsmmmk.",
      "kmmmmmmrmmsmk.",
      ".kmmsmmmmmmk..",
      "..kkkwwwkkk...",
      ".....kwek.....",
      ".....kwek.....",
      "....kwweek....",
      "....kkkkkk....",
    ],
    [
      "..kkkkkkkk..",
      ".kyoyyoyyok.",
      "kyyoyyoyyoyk",
      "koyyoyyoyyok",
      "kyyoyyoyyoyk",
      "koowoowoowok",
      ".kkkkkkkkkk.",
    ],
    [
      "...kkkkkk...",
      "..k......k..",
      ".krkrrkrrrk.",
      "kwrrkrrkrrwk",
      "kweweweweewk",
      ".kwewewewek.",
      ".kwwwwwwwwk.",
      "..kkkkkkkk..",
    ],
  ],
};

export function obstacleRows(biome: string, v: number): string[] {
  const set = OBSTACLES[biome] ?? OBSTACLES.garden!;
  return set[v % set.length]!;
}

// ---- the witch -------------------------------------------------------------------------------

/** The witch on her broom, flying right: plum hat with a candle band, ginger braid, teal cloak. */
// prettier-ignore
export const WITCH = [
  "................kk........",
  "...............kddk.......",
  "..............kdddk.......",
  ".............kddddk.......",
  "............kddddnk.......",
  "..........kkkooooookk.....",
  ".........kddddddddddnk....",
  "...........kobbbbbk.......",
  "...........koobbkbk.......",
  "...........koobbbbk.......",
  "..........koktttttk.......",
  ".........kottttttttk......",
  "o..y.y..kttttttttttk......",
  ".yoyoyyrkttttttttttkwwwwwk",
  "yoyoyoyorkttttttttkeeeeeek",
  "oyoyoyo.kkkkkkkkkk........",
  "y..o.o...kk..kk...........",
];

// ---- small things ------------------------------------------------------------------------------

/** A cat's paw print in cream, for the first-run hints (9 × 8). */
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

/** A little crescent moon (7 × 7). */
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

/** A sparkle (two frames), pixelwitch's mark on every icon and title. */
export const SPARKLE = [
  ["..c..", "..c..", "ccycc", "..c..", "..c.."],
  ["c...c", ".c.c.", "..y..", ".c.c.", "c...c"],
];

/** The best-row flag: a first-light pennant on a stick (7 × 9). */
// prettier-ignore
export const FLAG = [
  "kaaak..",
  "kaaaaak",
  "kabaak.",
  "kaaak..",
  "kk.....",
  "kw.....",
  "kw.....",
  "kw.....",
  "kk.....",
];

/** A sun for the game-over line (9 × 5, its top half over the hill). */
// prettier-ignore
export const SUN = [
  "y.y.y.y.y",
  ".yyyyyyy.",
  "yybbbbbyy",
  "ybbbbbbby",
  "bbbbbbbbb",
];

// ---- building the canvases ---------------------------------------------------------------------

/** Angles a rolling thing is drawn at. */
export const ROLL_FRAMES = 8;

const flipRows = (rows: readonly string[]) => rows.map((r) => [...r].reverse().join(""));

/**
 * The cat's moonlit rim: a 1 px frost edge outside its ink outline, so the black cat's silhouette reads on every ground
 * (dark grass, flagstones, the bog, paper boats). No rim under its feet, where its shadow is.
 */
export function rimmed(rows: readonly string[]): string[] {
  const out = outlineRows(rows, "f", false);
  out.pop();
  return out;
}
/** Where the cat's body is centred in its rimmed map. */
export const CAT_RIM_CX = CAT_CX + 1;

export interface Sprites {
  cat: Record<"crouch" | "leap" | "front" | "dizzy" | "wet" | "sleep" | "yawn", HTMLCanvasElement>;
  eyes: Record<Eyes, HTMLCanvasElement>;
  leapFlip: HTMLCanvasElement;
  broom: HTMLCanvasElement[][];
  pumpkin: HTMLCanvasElement[][];
  yarn: HTMLCanvasElement[][];
  wisp: HTMLCanvasElement[];
  boat: HTMLCanvasElement[][];
  toad: HTMLCanvasElement;
  fish: HTMLCanvasElement;
  goldfish: HTMLCanvasElement;
  obstacles: Record<string, HTMLCanvasElement[]>;
  witch: HTMLCanvasElement;
  paw: HTMLCanvasElement;
  lantern: HTMLCanvasElement[];
  moon: HTMLCanvasElement;
  sparkle: HTMLCanvasElement[];
  flag: HTMLCanvasElement;
  sun: HTMLCanvasElement;
}

export function sprites(): Sprites {
  const turn = (f: (a: number) => string[]) => Array.from({ length: ROLL_FRAMES }, (_, i) => sprite(f((i / ROLL_FRAMES) * Math.PI * 2)));
  const obstacles: Record<string, HTMLCanvasElement[]> = {};
  for (const b of Object.keys(OBSTACLES)) obstacles[b] = OBSTACLES[b]!.map((o) => sprite(o));
  return {
    cat: {
      crouch: sprite(rimmed(CAT_FRONT_CROUCH)),
      leap: sprite(rimmed(CAT_LEAP)),
      front: sprite(rimmed(CAT_FRONT)),
      dizzy: sprite(rimmed(CAT_DIZZY)),
      wet: sprite(rimmed(CAT_WET)),
      sleep: sprite(rimmed(CAT_SLEEP)),
      yawn: sprite(rimmed(CAT_YAWN)),
    },
    eyes: { left: sprite(rimmed(catEyes("left"))), right: sprite(rimmed(catEyes("right"))), ahead: sprite(rimmed(catEyes("ahead"))), blink: sprite(rimmed(catEyes("blink"))) },
    leapFlip: sprite(rimmed(flipRows(CAT_LEAP))),
    // [variant][0 = flying right, 1 = flying left]
    broom: [0, 1, 2].map((v) => [sprite(broomRows(v)), sprite(flipRows(broomRows(v)))]),
    // [small, big][angle]
    pumpkin: [false, true].map((big) => turn((a) => pumpkinRows(a, big))),
    yarn: [0, 1, 2].map((v) => turn((a) => yarnRows(a, v))),
    wisp: WISP.map((w) => sprite(w)),
    // [short, long][0 = sailing right, 1 = left]
    boat: [0, 1].map((v) => [sprite(boatRows(v)), sprite(flipRows(boatRows(v)))]),
    toad: sprite(TOAD),
    fish: sprite(FISH),
    goldfish: sprite(GOLDFISH),
    obstacles,
    witch: sprite(WITCH),
    paw: sprite(outlineRows(PAW, "k", false)),
    lantern: LANTERN.map((l) => sprite(l)),
    moon: sprite(outlineRows(MOON, "k", false)),
    sparkle: SPARKLE.map((s) => sprite(s)),
    flag: sprite(FLAG),
    sun: sprite(SUN),
  };
}

/** Every map (for the contact sheet and the tests). */
export function allMaps(): Record<string, string[]> {
  const out: Record<string, string[]> = {
    CAT_BACK,
    CAT_LEAP,
    CAT_FRONT,
    CAT_FRONT_CROUCH,
    rim_front: rimmed(CAT_FRONT),
    rim_left: rimmed(catEyes("left")),
    rim_ahead: rimmed(catEyes("ahead")),
    rim_leap: rimmed(CAT_LEAP),
    rim_dizzy: rimmed(CAT_DIZZY),
    CAT_DIZZY,
    CAT_WET,
    CAT_SLEEP,
    CAT_YAWN,
    WITCH,
    TOAD,
    FISH,
    GOLDFISH,
    FLAG,
    SUN,
  };
  [0, 1, 2].forEach((v) => (out[`broom${v}`] = broomRows(v)));
  [0, 2, 4].forEach((i) => (out[`pumpkin${i}`] = pumpkinRows((i / ROLL_FRAMES) * Math.PI * 2, false)));
  [0, 2].forEach((i) => (out[`bigpumpkin${i}`] = pumpkinRows((i / ROLL_FRAMES) * Math.PI * 2, true)));
  [0, 1, 2].forEach((v) => (out[`yarn${v}`] = yarnRows(0.4, v)));
  WISP.forEach((w, i) => (out[`wisp${i}`] = w));
  [0, 1].forEach((v) => (out[`boat${v}`] = boatRows(v)));
  for (const b of Object.keys(OBSTACLES)) OBSTACLES[b]!.forEach((o, i) => (out[`${b}${i}`] = o));
  return out;
}
