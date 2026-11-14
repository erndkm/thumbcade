/**
 * pixelwitch's palette: the sixteen colors every game of mine shares (night plums, candlelight, moss and a teal),
 * plus the two winter inks from the pond and one new one, first light: the pink the sky goes just before the sun.
 * Sprite maps use the one-letter keys; `.` is transparent.
 */
export const PAL = {
  ink: "#1b1029",
  night: "#2d1d45",
  dusk: "#4b3366",
  mauve: "#7a5a85",
  rose: "#c97b8f",
  blush: "#f0b8a8",
  ember: "#b5523b",
  candle: "#e8893c",
  butter: "#f6d27a",
  cream: "#fbf1d3",
  wood: "#6b3f37",
  moss: "#4f6b3a",
  sage: "#93ad6e",
  teal: "#2f7a7a",
  mist: "#8cc7b8",
  pond: "#1f3c55",
  glacier: "#3f6f8f",
  frost: "#c6e6f5",
  /** First light: the dawn that follows the cat up the hill. */
  dawn: "#f2b0c0",
} as const;

export type Color = (typeof PAL)[keyof typeof PAL];

/** Sprite-map keys. */
export const KEY: Record<string, string> = {
  k: PAL.ink,
  n: PAL.night,
  d: PAL.dusk,
  v: PAL.mauve,
  r: PAL.rose,
  b: PAL.blush,
  e: PAL.ember,
  o: PAL.candle,
  y: PAL.butter,
  c: PAL.cream,
  w: PAL.wood,
  m: PAL.moss,
  s: PAL.sage,
  t: PAL.teal,
  i: PAL.mist,
  p: PAL.pond,
  g: PAL.glacier,
  f: PAL.frost,
  a: PAL.dawn,
};
