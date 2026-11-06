/**
 * The nine bakes, smallest to biggest. Each one has its own size, colour, silhouette and face, so the tin reads at a
 * glance without colour. Radii are in tin units (the tin is 10 units wide inside).
 */
export interface Tier {
  name: string;
  /** Shown on the "new bake" card. */
  title: string;
  r: number;
  /** Main clay colour, its shade and its highlight. */
  body: string;
  deep: string;
  hi: string;
}

export const TIERS: readonly Tier[] = [
  { name: "pearl", title: "sugar pearl", r: 0.44, body: "#F4AFC0", deep: "#DE8AA0", hi: "#FFD9E2" },
  { name: "gumdrop", title: "gumdrop", r: 0.6, body: "#9CC98A", deep: "#76A966", hi: "#CBE8BE" },
  { name: "cookie", title: "cookie", r: 0.78, body: "#DFA963", deep: "#BE8443", hi: "#F3CD93" },
  { name: "donut", title: "donut", r: 0.96, body: "#F29A8C", deep: "#D97464", hi: "#FFC6BC" },
  { name: "truffle", title: "truffle", r: 1.17, body: "#82503B", deep: "#5E3627", hi: "#A9775E" },
  { name: "macaron", title: "macaron", r: 1.42, body: "#C4AEE8", deep: "#9F86D2", hi: "#E5DAFA" },
  { name: "cupcake", title: "cupcake", r: 1.72, body: "#9EC7EC", deep: "#73A6D6", hi: "#D3E8FA" },
  { name: "pie", title: "lattice pie", r: 2.05, body: "#EEC060", deep: "#C99536", hi: "#FBE2A2" },
  { name: "cake", title: "party cake", r: 2.42, body: "#E2667E", deep: "#BC4560", hi: "#F79BAC" },
] as const;

export const TOP = TIERS.length - 1;

export const radius = (tier: number): number => TIERS[tier]!.r;
