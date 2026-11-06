/** lowpolyfox's daylight palette: pastels for the world, a few deeper tones for contrast. */
export const P = {
  haze: "#F8EDE3",
  hazeLow: "#F3E4EC",
  cream: "#FFF7EC",
  ink: "#4B4060",
  inkSoft: "#7D7190",

  mint: "#A8E6C1",
  mintDeep: "#6FCB9D",
  leaf: "#86D3A0",
  leafDeep: "#56B07F",
  peach: "#FFCBA6",
  peachDeep: "#F2A07C",
  butter: "#FFE7A1",
  butterDeep: "#F4C964",
  sky: "#A9DDF3",
  skyDeep: "#78C2E4",
  lilac: "#D2C3F3",
  lilacDeep: "#A592E0",
  blossom: "#FBC3D4",
  blossomDeep: "#EE93AF",

  water: "#8FD3E6",
  waterDeep: "#6EBFDB",
  foam: "#F4FCFF",
  stone: "#E6DEDA",
  stoneDeep: "#CABFBD",
  pebble: "#D9CCE3",
  wood: "#DDA676",
  woodDeep: "#B9825A",
  bark: "#9C7059",
  soil: "#D9A98A",

  fox: "#F68A4A",
  foxDeep: "#DE6C33",
  foxCream: "#FFF3E2",
  foxDark: "#5B4759",

  berry: "#EC5F82",
  berryDeep: "#C9466A",
  coral: "#F27C6B",
} as const;

export type PaletteKey = keyof typeof P;
