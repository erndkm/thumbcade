/** softbake's clay box: warm pastels with chocolate accents. Every color in the game comes from here. */
export const PAL = {
  butter: "#F6D98B",
  butterDeep: "#E9BE5E",
  sage: "#A8C795",
  sageDeep: "#82AA74",
  salmon: "#F2A08A",
  salmonDeep: "#DE7E68",
  powder: "#A7CBEA",
  powderDeep: "#7FAED8",
  lavender: "#C8B5E8",
  lavenderDeep: "#A891D6",
  cream: "#FBF1DE",
  creamDeep: "#EEDCBC",
  choc: "#6E4533",
  chocDeep: "#4C2E22",
  felt: "#F4DCC2",
  feltDeep: "#E8C7A6",
  sand: "#EFD29A",
  ball: "#FFF8EC",
  pink: "#F6B9C4",
} as const;

/** Rim colors cycle per hole so consecutive holes feel freshly sculpted. */
export const RIM_COLORS = [PAL.butter, PAL.salmon, PAL.lavender, PAL.powder, PAL.pink] as const;
/** Macaron bumper shells. */
export const MACARON_COLORS = [PAL.lavender, PAL.salmon, PAL.powder, PAL.pink, PAL.butter] as const;
