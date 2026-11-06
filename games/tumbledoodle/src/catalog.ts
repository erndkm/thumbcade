/**
 * Everything the hole can eat, smallest first. `s` is the doodle's footprint radius in page units, `tier` the hole size
 * (0-6) at which it first fits through, `pts` what a swallow pays before multipliers. Pure data: the drawings live in
 * doodles.ts, keyed by `id`.
 */

export interface Kind {
  id: string;
  /** "a paperclip": the callout when it falls in. */
  name: string;
  /** "paperclips": the results list. */
  plural: string;
  tier: number;
  s: number;
  pts: number;
}

export const KINDS: readonly Kind[] = [
  // Tier 0: desk dust and the tiniest doodles.
  { id: "crumb", name: "an eraser crumb", plural: "eraser crumbs", tier: 0, s: 3.6, pts: 5 },
  { id: "dot", name: "an ink dot", plural: "ink dots", tier: 0, s: 3.2, pts: 5 },
  { id: "shaving", name: "a pencil shaving", plural: "pencil shavings", tier: 0, s: 6.2, pts: 10 },
  { id: "staple", name: "a staple", plural: "staples", tier: 0, s: 5.6, pts: 10 },
  { id: "star", name: "a star", plural: "stars", tier: 0, s: 7.2, pts: 10 },
  { id: "heart", name: "a heart", plural: "hearts", tier: 0, s: 6.6, pts: 10 },
  // Tier 1.
  { id: "paperclip", name: "a paperclip", plural: "paperclips", tier: 1, s: 13, pts: 25 },
  { id: "button", name: "a button", plural: "buttons", tier: 1, s: 11, pts: 25 },
  { id: "snail", name: "a snail", plural: "snails", tier: 1, s: 14, pts: 25 },
  { id: "flower", name: "a flower", plural: "flowers", tier: 1, s: 14.5, pts: 25 },
  { id: "smiley", name: "a smiley", plural: "smileys", tier: 1, s: 12.5, pts: 25 },
  { id: "fish", name: "a fish", plural: "fish", tier: 1, s: 13.5, pts: 25 },
  // Tier 2.
  { id: "cat", name: "a cat!", plural: "cats", tier: 2, s: 21, pts: 60 },
  { id: "cupcake", name: "a cupcake", plural: "cupcakes", tier: 2, s: 19, pts: 60 },
  { id: "ghost", name: "a ghost", plural: "ghosts", tier: 2, s: 20, pts: 60 },
  { id: "mushroom", name: "a mushroom", plural: "mushrooms", tier: 2, s: 18, pts: 60 },
  { id: "bird", name: "a bird", plural: "birds", tier: 2, s: 19.5, pts: 60 },
  // Tier 3.
  { id: "car", name: "a car!", plural: "cars", tier: 3, s: 32, pts: 140 },
  { id: "bike", name: "a bike", plural: "bikes", tier: 3, s: 30, pts: 140 },
  { id: "tree", name: "a tree!", plural: "trees", tier: 3, s: 33.5, pts: 140 },
  { id: "robot", name: "a robot", plural: "robots", tier: 3, s: 29, pts: 140 },
  { id: "sailboat", name: "a sailboat", plural: "sailboats", tier: 3, s: 31, pts: 140 },
  // Tier 4.
  { id: "house", name: "a whole house!", plural: "houses", tier: 4, s: 49, pts: 320 },
  { id: "rocket", name: "a rocket!", plural: "rockets", tier: 4, s: 44, pts: 320 },
  { id: "dino", name: "a dinosaur!", plural: "dinosaurs", tier: 4, s: 50, pts: 320 },
  { id: "balloon", name: "a hot-air balloon", plural: "balloons", tier: 4, s: 42, pts: 320 },
  // Tier 5.
  { id: "castle", name: "a castle!!", plural: "castles", tier: 5, s: 73, pts: 700 },
  { id: "whale", name: "a whale!!", plural: "whales", tier: 5, s: 70, pts: 700 },
  { id: "ship", name: "a pirate ship!!", plural: "pirate ships", tier: 5, s: 66, pts: 700 },
  // Tier 6.
  { id: "moon", name: "THE MOON", plural: "moons", tier: 6, s: 100, pts: 1500 },
  { id: "kraken", name: "THE KRAKEN", plural: "krakens", tier: 6, s: 108, pts: 1500 },
];

export const KIND_INDEX: Readonly<Record<string, number>> = Object.fromEntries(KINDS.map((k, i) => [k.id, i]));

export const kindsOfTier = (tier: number): number[] => KINDS.flatMap((k, i) => (k.tier === tier ? [i] : []));

/** The three erasers, one after another: a pencil-top cap, a block eraser, a chalkboard duster. */
export interface EraserKind {
  name: string;
  s: number;
  /** Chase speed, as a share of the current view width per second. */
  chase: number;
  /** Flee speed once you are big enough to eat it. */
  flee: number;
  pts: number;
}

export const ERASERS: readonly EraserKind[] = [
  { name: "the cap eraser", s: 26, chase: 0.42, flee: 0.5, pts: 600 },
  { name: "the block eraser", s: 47, chase: 0.47, flee: 0.48, pts: 1500 },
  { name: "the chalk duster", s: 72, chase: 0.52, flee: 0.46, pts: 3500 },
];
