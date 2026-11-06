/**
 * Every sprite in Bobberlight, placed by hand. Keys: k ink, n night, d dusk, v mauve, r rose, b blush,
 * e ember, o candle, y butter, c cream, w wood, m moss, s sage, t teal, i mist, p pond. `.` is clear.
 */

/** The witch's cat, front view (the same cat that lives on the potion shelf). */
// prettier-ignore
export const CAT = {
  sit: [
    ".k.......k....",
    "kdk.....kdk...",
    "knrkkkkkrnk...",
    "knnnnnnnnnk...",
    "knyynnnyynk...",
    "knyknnnyknk...",
    "knnnnrnnnnk...",
    ".knnndnnnk....",
    "..knnnnnk.....",
    ".knnnnnnnk..k.",
    "knnnnnnnnnkknk",
    "knnnnnnnnnknk.",
    "knndnnndnnkk..",
    ".kkkkkkkkkk...",
  ],
  blink: [
    ".k.......k....",
    "kdk.....kdk...",
    "knrkkkkkrnk...",
    "knnnnnnnnnk...",
    "knnnnnnnnnk...",
    "knkknnnkknk...",
    "knnnnrnnnnk...",
    ".knnndnnnk....",
    "..knnnnnk.....",
    ".knnnnnnnk..k.",
    "knnnnnnnnnkknk",
    "knnnnnnnnnknk.",
    "knndnnndnnkk..",
    ".kkkkkkkkkk...",
  ],
  swish: [
    ".k.......k....",
    "kdk.....kdk...",
    "knrkkkkkrnk...",
    "knnnnnnnnnk...",
    "knyynnnyynk...",
    "knyknnnyknk...",
    "knnnnrnnnnk...",
    ".knnndnnnk....",
    "..knnnnnk.....",
    ".knnnnnnnk....",
    "knnnnnnnnnk...",
    "knnnnnnnnnkkk.",
    "knndnnndnnknnk",
    ".kkkkkkkkkkkk.",
  ],
  /** From behind, minding the rod. */
  back: [
    ".k.......k....",
    "kdk.....kdk...",
    "knnkkkkknnk...",
    "knnnnnnnnnk...",
    "knnnnnnnnnk...",
    "kdnnnnnnndk...",
    "knnnnnnnnnk...",
    ".knnnnnnnk....",
    "..knnnnnk.....",
    ".knnndnnnk..k.",
    "knnnndnnnnkknk",
    "knnnndnnnnknk.",
    "knnnnnnnnnkk..",
    ".kkkkkkkkkk...",
  ],
  backSwish: [
    ".k.......k....",
    "kdk.....kdk...",
    "knnkkkkknnk...",
    "knnnnnnnnnk...",
    "knnnnnnnnnk...",
    "kdnnnnnnndk...",
    "knnnnnnnnnk...",
    ".knnnnnnnk....",
    "..knnnnnk.....",
    ".knnndnnnk....",
    "knnnndnnnnk...",
    "knnnndnnnnkkk.",
    "knnnnnnnnnknnk",
    ".kkkkkkkkkkkk.",
  ],
};

/** The witch, from behind: plum hat with a candle band, ginger braid, teal cloak. */
// prettier-ignore
export const WITCH = [
  "...........kk...",
  "..........kdnk..",
  ".........kddk...",
  "........kddnk...",
  ".......kdddnk...",
  ".......kddddk...",
  "......kdddddnk..",
  "......kyoooook..",
  ".....kdddddddnk.",
  "..kkddddddddddnk",
  "kvdddddddddddnnk",
  ".kkkkkkkkkkkkkk.",
  "...keooeeoeoek..",
  "...koeoeooeoek..",
  "..ktkeoeeoeoktk.",
  ".kttktkeoektttk.",
  "kittttkookttttpk",
  "kitttttkoktttppk",
  "kittttttkttttppk",
  "kittttttttttpppk",
  "ktttttttttttpppk",
  "kpttttttttttpppk",
  ".kkkkkkkkkkkkkk.",
];

/** Fish shadows under the water, facing left. Two frames each (tail flick). */
// prettier-ignore
export const SHADOW = {
  minnow: [
    [".kkk.k", "kkkkk.", ".kkk.k"],
    [".kkk..", "kkkkkk", ".kkk.."],
  ],
  perch: [
    ["..kkkkk...", ".kkkkkkk.k", "kkkkkkkkkk", ".kkkkkkk.k"],
    ["..kkkkk...", ".kkkkkkkkk", "kkkkkkkkk.", ".kkkkkkkkk"],
  ],
  carp: [
    ["...kkkkkk....", ".kkkkkkkkkk.k", "kkkkkkkkkkkkk", "kkkkkkkkkkk.k", ".kkkkkkkk...."],
    ["...kkkkkk....", ".kkkkkkkkkkk.", "kkkkkkkkkkkkk", "kkkkkkkkkkkkk", ".kkkkkkkk...."],
  ],
  koi: [
    ["...oyyyoo....", ".ooyyyyyoo.o", "oyyyyyyyyyyyo", "ooyyyyyyyoo.o", ".oooooooo...."].map((r) => r.padEnd(13, ".")),
    ["...ooyyyo....", ".oooyyyyyoo.", "ooyyyyyyyyyoo", "oyyyyyyyyyyyo", ".oooooooo...."].map((r) => r.padEnd(13, ".")),
  ],
};

/** Fish out of the water (on the dock and in the catch popup), facing left. */
// prettier-ignore
export const FISH = {
  minnow: [
    ".kkkk..k.",
    "kicciikik",
    "kkiiiikik",
    ".kkkk..k.",
  ],
  perch: [
    "...kkkkk....",
    "..krkrkrk.kk",
    ".kssmsmsskrk",
    "kcksmsmssskk",
    "kssssmsmsskk",
    ".kcccccccsrk",
    "..kkkkkkk.kk",
  ],
  carp: [
    "....kkkkkkk......",
    "..kkwewewewkk..kk",
    ".kwewewewewek.kok",
    "kckooooooooookoo.",
    "kyoooooooooookoo.",
    ".kyyyyyyyyyyk.kok",
    "..kkkkkkkkkk...kk",
  ],
  koi: [
    "....kkkkkkk.......",
    "..kkyyrryyykk..kk.",
    ".kyyyrryyyccyk.kyk",
    "kckyyyyyrryyyykyyk",
    "kyyyyyyyrryyyyykyk",
    ".koyyyyyyyyyyok.kk",
    "..kkkkkkkkkkkk....",
  ],
};

// prettier-ignore
export const BOBBER = [
  "..k..",
  ".krk.",
  "krbrk",
  "kccck",
  ".kck.",
];

/** The moon: butter with blush craters and a cream rim of light. */
// prettier-ignore
export const MOON = [
  ".....kkkkk.....",
  "...kkcccyykk...",
  "..kcccyyyyyyk..",
  ".kccyyyybyyyyk.",
  ".kcyyybbyyyyyk.",
  "kcyyyyyyyyyyyyk",
  "kcyyyyyyybyyyyk",
  "kcyyyyyyybbyyok",
  "kcyybyyyyyyyyok",
  "kyyybbyyyyyyook",
  ".kyyyyyyyyyyok.",
  ".kyyyyyyyyyook.",
  "..kyyyyyyyook..",
  "...kkoyyyokk...",
  ".....kkkkk.....",
];

/** A paper lantern on the dock: candle inside, three flicker frames. */
// prettier-ignore
export const LANTERN = [
  [
    "..kk..",
    ".kwwk.",
    "kkkkkk",
    "kyccyk",
    "kycoyk",
    "kyooyk",
    "kkkkkk",
    ".kwwk.",
  ],
  [
    "..kk..",
    ".kwwk.",
    "kkkkkk",
    "kyccyk",
    "kyocyk",
    "kyooyk",
    "kkkkkk",
    ".kwwk.",
  ],
  [
    "..kk..",
    ".kwwk.",
    "kkkkkk",
    "kycyyk",
    "kycoyk",
    "kyooyk",
    "kkkkkk",
    ".kwwk.",
  ],
];

// prettier-ignore
export const BASKET = [
  ".kkkkkkkkk.",
  "kowowowowok",
  "kwowowowowk",
  "kowowowowok",
  ".kwowowowk.",
  "..kkkkkkk..",
];

// prettier-ignore
export const LILY = [
  [
    "..kkkkkkkk..",
    ".kssmsssmssk",
    "kmssssmssssk",
    ".kmmssssmmk.",
    "..kkkkkkkk..",
  ],
  [
    "..kkkkk..",
    ".kssmssk.",
    "kmssssmsk",
    ".kkkkkkk.",
  ],
];

// prettier-ignore
export const FLOWER = [
  "..k.k..",
  ".kbkbk.",
  "kbrbrbk",
  ".kryrk.",
  "..kkk..",
];

/** A frog on a lily pad: sit and blink. */
// prettier-ignore
export const FROG = [
  [
    ".kk.kk.",
    "kyksyk.",
    "ksssssk",
    "kmsssmk",
    ".kkkkk.",
  ],
  [
    ".kk.kk.",
    "kskssk.",
    "ksssssk",
    "kmsssmk",
    ".kkkkk.",
  ],
];

/** Reeds with two cattails. The second sway frame is made by leaning the tips. */
// prettier-ignore
export const REEDS = [
  "...kk......",
  "..kwek.....",
  "..kwwk..k..",
  "..kwwk.kwk.",
  "..kwwk.kwk.",
  "...km..kwk.",
  "...km...m..",
  ".k.km...m..",
  ".mk.m..km..",
  ".mk.m..m..k",
  "..m.mk.m.km",
  "..m.mk.m.m.",
  "..mkms.mkm.",
  "..mkmsmmm..",
  "...mmsmm...",
  "...msmm....",
  "...mmsm....",
  "..kmsmmk...",
  "..kmmsmk...",
  "...kkkk....",
];

/** The cottage on the far shore (the one with the potion shelf), window lit. */
// prettier-ignore
export const COTTAGE = [
  "......k.....",
  ".....kkk.kk.",
  "....kddnkkn.",
  "...kddddnkn.",
  "..kddddddnk.",
  ".kkkkkkkkkkk",
  "..knnnnnnk..",
  "..knyynnnk..",
  "..knyynwnk..",
  "..kkkkkwkk..",
];

/** pixelwitch's signature: the four-pointed sparkle. */
// prettier-ignore
export const SPARKLE = [
  ["..y..", ".yyy.", "yycyy", ".yyy.", "..y.."],
  ["...y...", "...y...", "..ycy..", "yycccyy", "..ycy..", "...y...", "...y..."],
];
