/**
 * Every sprite in Stirabout, placed by hand. Keys: k ink, n night, d dusk, v mauve, r rose, b blush,
 * e ember, o candle, y butter, c cream, w wood, m moss, s sage, t teal, i mist, p pond. `.` is clear.
 * In the cauldron and bottle maps, L / H are the brew color and its highlight (swapped at runtime).
 */

// prettier-ignore
export const INGREDIENTS = {
  shroom: [
    "..kkkkk..",
    ".kbeceek.",
    "keeeeeeck",
    "kecceeeek",
    "kvvvvvvvk",
    ".kkccbkk.",
    "..kccbk..",
    "..kccbk..",
    "...kkk...",
  ],
  eye: [
    "..kkkkk..",
    ".kccccck.",
    "kcctttcbk",
    "kcciktcbk",
    "kcctktcbk",
    "krctttcbk",
    "kcrcccbbk",
    ".kbbbbbk.",
    "..kkkkk..",
  ],
  frog: [
    "..kkk....",
    ".ksssk...",
    ".kscsk...",
    ".kmssk...",
    "..kmsk...",
    "...ksk...",
    "..ksssskk",
    ".ksmsmssk",
    ".kkkkkkkk",
  ],
  star: [
    "....k....",
    "...kyk...",
    "kkkkcykkk",
    "kyycyyyok",
    ".kyyyyok.",
    "..kyyyk..",
    ".kyyoyok.",
    ".kyk.kok.",
    ".kk...kk.",
  ],
  feather: [
    "......kk.",
    ".....kiik",
    "....kicik",
    "...kiitik",
    "..kiitik.",
    ".kiitik..",
    ".kitik...",
    "ktkkk....",
    "kk.......",
  ],
  crystal: [
    "....k....",
    "...kbk...",
    "..kbcvk..",
    "..kbvvk..",
    ".kbbvvdk.",
    ".kbvvvdk.",
    ".kbvvddk.",
    "..kvvdk..",
    "...kkk...",
  ],
  snail: [
    "...kkkk..",
    "..krrbrk.",
    ".krbkkrrk",
    ".krkrbkrk",
    ".krkkrkrk",
    "kkrrrrkrk",
    "kckkkkrk.",
    "kcccccck.",
    ".kkkkkkk.",
  ],
} as const;

export type Kind = keyof typeof INGREDIENTS;
export const KINDS = Object.keys(INGREDIENTS) as Kind[];

/** Brew tint each ingredient leaves behind: [liquid, highlight]. */
export const TINT: Record<Kind, [string, string]> = {
  shroom: ["o", "y"],
  eye: ["i", "c"],
  frog: ["s", "c"],
  star: ["y", "c"],
  feather: ["t", "i"],
  crystal: ["v", "b"],
  snail: ["r", "b"],
};

/** What the recipe card calls each one. */
export const NAMES: Record<Kind, string> = {
  shroom: "toadstool",
  eye: "eyeball",
  frog: "frog leg",
  star: "star",
  feather: "feather",
  crystal: "crystal",
  snail: "snail",
};

// prettier-ignore
export const CAULDRON = [
  "....kkkkkkkkkkkkkkkkkk....",
  "..kkvvvvvvvvvvvvvvvvvvkk..",
  ".kvvnnHHLLLLLLLLLLLLnnvvk.",
  ".kvnLLLLLLLLLLLLLLLLLLnvk.",
  ".kcvvvvvvvvvvvvvvvvvvvvdk.",
  "..kkkkkkkkkkkkkkkkkkkkkk..",
  ".knvdddddddddddddddddnnnk.",
  "kndvvddddddddddddddddnnnnk",
  "kdvcdddddddddddddddddnnnnk",
  "kdvddddddddddddddddddnnnnk",
  "kdvddddddddddddddddddnnnnk",
  "kddddddddddddddddddddnnnnk",
  "knddddddddddddddddddnnnnnk",
  ".knddddddddddddddddnnnnnk.",
  "..knnnnnnnnnnnnnnnnnnnnk..",
  "...kkkkkkkkkkkkkkkkkkkk...",
  "...knk..............knk...",
  "...knk..............knk...",
  "...knk..............knk...",
  "...knk..............knk...",
  "..kvnk..............kvnk..",
  "..kkkk..............kkkk..",
];

/** Brew boiling over: foam spilling down the front of the pot (drawn over the cauldron). */
// prettier-ignore
export const FOAM = [
  [
    "......cc..ccc...cc........",
    "...ccHHccHHHHccHHHcc......",
    "..cHHLLHHLLLLHHLLLHHc.....",
    ".cHLLLLLLLLLLLLLLLLLHc....",
    ".cHLLLLLLLLLLLLLLLLLLHc...",
    "..cHL..cHL...HLc..cLHc....",
    "...cL...cL....Lc...cL.....",
    "....c....c.....c....c.....",
  ],
  [
    "....cc..ccc..ccc..cc......",
    "..ccHHccHHHccHHHccHHc.....",
    ".cHHLLHHLLLHHLLLHHLLHc....",
    ".cHLLLLLLLLLLLLLLLLLLHc...",
    ".cHLLLLLLLLLLLLLLLLLLLHc..",
    "..cHLc.cHLc..cHL..cHLLc...",
    "..cHL...cL....cL...cHL....",
    "...cL....c.....c....cL....",
    "....c...............c.....",
  ],
];

// prettier-ignore
export const FIRE = [
  [
    ".....e........",
    "....eoe...e...",
    "...eoyoe.eoe..",
    "..eoyyyoeoyoe.",
    ".eoyycyyyyyoe.",
    "kwwwewkwwwwewk",
    ".kkkkkkkkkkkk.",
  ],
  [
    "........e.....",
    "...e...eoe....",
    "..eoe.eoyoe...",
    ".eoyoeoyyyoe..",
    ".eoyyyyycyyoe.",
    "kwwwewkwwwwewk",
    ".kkkkkkkkkkkk.",
  ],
  [
    "......e.......",
    "..e..eoe..e...",
    ".eoe.eoyoeoe..",
    ".eoyoeyyyoyoe.",
    ".eoyycyyyyyoe.",
    "kwwwewkwwwwewk",
    ".kkkkkkkkkkkk.",
  ],
];

// prettier-ignore
export const BOTTLE = [
  "..kkk..",
  "..kwk..",
  "..kck..",
  ".kkckk.",
  "kcHLLLk",
  "kHLLLLk",
  "kLLLLLk",
  "kLLLLLk",
  ".kkkkk.",
];

// prettier-ignore
export const HEART = [
  ".kk.kk.",
  "kbrkrrk",
  "krrrrrk",
  "krrrrrk",
  ".krrrk.",
  "..krk..",
  "...k...",
];

// prettier-ignore
export const HEART_EMPTY = [
  ".kk.kk.",
  "kdnkndk",
  "knnnnnk",
  "knnnnnk",
  ".knnnk.",
  "..knk..",
  "...k...",
];

/** The witch's cat, front view. Frames: sit, blink, tail swish, swat (left paw out), crouch (before a hop). */
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
  swat: [
    "...k.......k..",
    "..kdk.....kdk.",
    "..knrkkkkkrnk.",
    "..knnnnnnnnnk.",
    "..knyynnnyynk.",
    "..kknnnnnyknk.",
    "..knnnnrnnnnk.",
    "...knnndnnnk..",
    "kk..knnnnnk...",
    "knkknnnnnnnk..",
    ".knnnnnnnnnnk.",
    "..knnnnnnnnnk.",
    "..knndnnndnnk.",
    "...kkkkkkkkk..",
  ],
  crouch: [
    "..............",
    "..............",
    ".k.......k....",
    "kdk.....kdk...",
    "knrkkkkkrnk...",
    "knnnnnnnnnk...",
    "knyynnnyynk...",
    "knyknnnyknk...",
    "knnnnrnnnnk...",
    ".knnndnnnk....",
    "knnnnnnnnnk.k.",
    "knnnnnnnnnkknk",
    "knndnnndnnkk..",
    ".kkkkkkkkkk...",
  ],
};

/** Shelf candle: wax body and three flame frames (drawn above it). */
// prettier-ignore
export const CANDLE = {
  wax: [
    ".kkk.",
    "kcck.",
    "kcbk.",
    "kcbk.",
    "kcbk.",
    "kcbk.",
    "kkkkk",
    "kwwwk",
    ".kkk.",
  ],
  flame: [
    ["..y..", ".yoy.", ".yoy.", "..k.."],
    [".y...", ".yoy.", "..oy.", "..k.."],
    ["...y.", ".yoy.", ".yo..", "..k.."],
  ],
};

/** Decor jars on the shelves. */
// prettier-ignore
export const JARS = [
  [
    ".kkkk.",
    "kwwwwk",
    ".kiik.",
    "kiitik",
    "kittik",
    "kitttk",
    ".kkkk.",
  ],
  [
    "..kk..",
    "..kk..",
    ".kbbk.",
    "kbrrbk",
    "krrrrk",
    "krrrrk",
    "krrrek",
    ".kkkk.",
  ],
  [
    ".kkkkk.",
    "kwwwwwk",
    "kyccyyk",
    "kycyyok",
    "kyyyyok",
    ".kkkkk.",
  ],
  [
    "kkkk",
    "ksmk",
    "ksmk",
    "kmmk",
    "ksmk",
    "kkkk",
  ],
];

/** A bundle of drying herbs hanging from the beam. */
// prettier-ignore
export const HERBS = [
  "..kk..",
  "..ke..",
  ".kssk.",
  "ksmsmk",
  "kmssmk",
  "ksmmsk",
  ".ksmk.",
  ".kmsk.",
  "..kk..",
];

/** Round window with the moon outside. */
// prettier-ignore
export const WINDOW = [
  "......kkkkkk......",
  "....kkwwwwwwkk....",
  "...kwwkkkkkkwwk...",
  "..kwkppppkpppkwk..",
  ".kwkppppnkppppkwk.",
  ".kwkpcyypkpppnkwk.",
  "kwkpcyyyykpppppkwk",
  "kwkpyyyyykppnpppwk",
  "kwkpyyyypkpppppkwk",
  "kwkkkkkkkkkkkkkkwk",
  "kwkpppnpkkppppppwk",
  "kwkppppppkpppnppwk",
  ".kwkpppppkpppppkwk",
  ".kwkpnppppkppppkwk",
  "..kwkppppkppppkwk.",
  "...kwwkkkkkkwwkk..",
  "....kkwwwwwwkk....",
  "......kkkkkk......",
];

/** A broom leaning on the wall and a closed spellbook. */
// prettier-ignore
export const BROOM = [
  "...kk",
  "...kw",
  "..kwk",
  "..kw.",
  "..kw.",
  ".kwk.",
  ".kw..",
  ".kw..",
  "kwk..",
  "kw...",
  "kyk..",
  "kyok.",
  "kyyok",
  "kyoyk",
  "kkkkk",
];

// prettier-ignore
export const BOOK = [
  ".kkkkkkkkk.",
  "kttttttttck",
  "ktyttyttcck",
  "kttttttttck",
  "kkkkkkkkkkk",
  "kccccccccck",
  ".kkkkkkkkk.",
];

/** The little pointing paw on the recipe card. */
// prettier-ignore
export const ARROW = [
  "kkkkk",
  "kyyyk",
  ".kyk.",
  "..k..",
];

// prettier-ignore
export const CHECK = [
  "....k",
  "...ks",
  "k.ks.",
  "ksk..",
  ".k...",
];

/** pixelwitch's signature: the four-pointed sparkle. */
// prettier-ignore
export const SPARKLE = [
  ["..y..", ".yky.", "ykcky", ".yky.", "..y.."].map((r) => r.replace(/k/g, "y")),
  ["...y...", "...y...", "..ycy..", "yycccyy", "..ycy..", "...y...", "...y..."],
];

/** A little framed portrait of the cat, hung on the wall. */
// prettier-ignore
export const PORTRAIT = [
  "kkkkkkkkkkkkkk",
  "keeeeeeeeeeewk",
  "kekkkkkkkkkkwk",
  "kekvvvvvvvvkwk",
  "kekvvkvvkvvkwk",
  "kekvknkknkvkwk",
  "kekvknnnnkvkwk",
  "kekvkynnykvkwk",
  "kekvknrrnkvkwk",
  "kekvvkkkkvvkwk",
  "kekvvvvvvvvkwk",
  "kekkkkkkkkkkwk",
  "kwwwwwwwwwwwwk",
  "kkkkkkkkkkkkkk",
];
