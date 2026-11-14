import type { RunStats } from "./rules.ts";

/** Every line of copy the game shows, in one place so the tests can check it fits its plate. */

/** The storm ladder: the playfield multiplier, its name and the line that comes with it. */
export const TIERS = [
  { name: "CALM", line: "THE LAMP IS LIT" },
  { name: "BREEZE", line: "THE BUOYS START TALKING" },
  { name: "GALE", line: "HOLD ON TO THE RAIL" },
  { name: "STORM", line: "EXTRA BALL IN THE HARBOUR" },
  { name: "FORCE 12", line: "OFF THE SCALE" },
] as const;

/** Combo names by length (2+). */
export const COMBOS = ["", "", "ONE-TWO", "TRIPLE", "ROGUE WAVE", "SEVEN SEAS"] as const;
export const comboName = (n: number): string => COMBOS[Math.min(COMBOS.length - 1, n)] ?? "";

export const JACKPOTS = ["JACKPOT", "DOUBLE JACKPOT", "TRIPLE JACKPOT"] as const;
export const jackpotName = (n: number): string => JACKPOTS[Math.min(JACKPOTS.length - 1, n - 1)] ?? "JACKPOT";

export const HINTS = {
  noFlips: "HOLD A SIDE TO RAISE THAT FLIPPER. BOTH THUMBS WORK.",
  late: "FLIP A BEAT EARLIER: MEET THE BALL ABOVE THE FLIPPER'S MIDDLE.",
  quiet: "FOLLOW THE BALL DOWN AND FLIP AS IT REACHES THE RUBBER.",
  cradle: "HOLD A FLIPPER UP TO CATCH THE BALL, THEN LET GO AND AIM.",
  orbit: "SHOOT THE SIDE LANES: A FULL ORBIT WINDS THE STORM UP.",
  flags: "DROP ALL FOUR FLAGS TO OPEN THE HARBOUR.",
  lock: "TWO BALLS MOORED IN THE HARBOUR CALL IN THE HIGH TIDE.",
  jackpots: "IN HIGH TIDE EVERY ORBIT IS A JACKPOT.",
  extra: "THE EXTRA BALL WAITS IN THE HARBOUR. OPEN THE FLAGS.",
  slip: "A HELD BALL SLIPS AFTER 3 SECONDS. AIM, THEN SHOOT.",
  lamps: "RING THE BALL THROUGH ALL THREE LAMP LANES. FLIPS SHIFT THEM.",
  combo: "CHAIN SHOTS INSIDE 4 SECONDS FOR A COMBO.",
  storm: "EVERY TIER MULTIPLIES ALL POINTS. THE TABLE GETS QUICKER TOO.",
} as const;

export type HintKey = keyof typeof HINTS;

export const BANNERS = {
  launch: ["TAP TO LAUNCH", "OR WAIT, THE TIDE TAKES IT"],
  save: ["LIFEBOAT", "BALL SAVED"],
  lamps: ["LAMPS LIT", "+2,500"],
  flags: ["ALL FLAGS DOWN", "HARBOUR OPEN"],
  lock1: ["BALL MOORED", "ONE MORE FOR HIGH TIDE"],
  lock2: ["SECOND BALL MOORED", "HIGH TIDE IS LIT"],
  multiball: ["HIGH TIDE", "EVERY ORBIT IS A JACKPOT"],
  tideEnd: ["THE TIDE GOES OUT", ""],
  extraLit: ["EXTRA BALL LIT", "SHOOT THE HARBOUR"],
  extra: ["EXTRA BALL", "SHOOT AGAIN"],
  superLit: ["SUPER JACKPOT LIT", "SHOOT THE HARBOUR"],
  super: ["SUPER JACKPOT", ""],
  gold: ["GOLD BUOY", "RING IT FOR 2,000"],
  slip: ["IT SLIPPED", "A HELD BALL GOES AFTER 3 S"],
  drain: ["BALL LOST", ""],
  last: ["LAST BALL", "MAKE IT COUNT"],
} as const;

/** Wider than any banner title the game builds (tests check every banner against this). */
export const BANNER_MAX = 18;
export const SUB_MAX = 28;
export const HINT_MAX = 64;

/** Picks the one hint that fits what happened in the run. */
export function hintFor(st: RunStats): HintKey {
  if (st.flips < 6) return "noFlips";
  if (st.lateDrains >= 2) return "late";
  if (st.quietDrains >= 2) return "quiet";
  if (st.slips >= 1) return "slip";
  if (st.extraLit && st.extraBalls === 0) return "extra";
  if (st.flagBanks === 0) return "flags";
  if (st.multiballs > 0 && st.jackpots < 2) return "jackpots";
  if (st.locks < 2 && st.multiballs === 0) return "lock";
  if (st.orbits === 0) return "orbit";
  if (st.cradles === 0) return "cradle";
  if (st.maxCombo < 2) return "combo";
  if (st.lamps === 0) return "lamps";
  return "storm";
}

