/**
 * Every line the player reads, in softbake's voice (lowercase, short, warm), kept in one place so the copy test can
 * check each one fits its plate on the narrowest phone.
 */
import { KINDS } from "./kinds.ts";
import { TIER_LINES } from "./run.ts";

export const COPY = {
  teachLift: "tap a pot to lift its top lump",
  teachDrop: "now tap its kind, or an empty pot",
  teachSeal: "four alike in a pot get patted shut",
  sealed: "that pot is done",
  busy: "lumps only land on their own kind",
  covered: "grey lumps wake up at the top",
  little: "little pots hold three, never seal",
  stuck: "no way out from here!",
  helpSpare: "here's a spare pot!",
  grace: "rewound! this one's on the house",
  spare: "a spare pot, just for this level",
  over: "time's up, lumps!",
  best: "new best!",
  party: "all tidy!",
  attractTap: "tap to play!",
  attractSub: "lift a lump, plop it on its kind",
  again: "tap to hop again",
  firstBest: "your first tidy-up!",
  noScore: "no pots sealed yet",
} as const;

export const newLump = (kind: number): string => `new lump: the ${KINDS[kind]!.name}!`;
export const levelLine = (n: number): string => `level ${n}`;
export const rewound = (cost: number): string => `rewound, −${Math.round(cost)}s`;
export const tierLine = (mult: number): string => `×${mult} ${TIER_LINES[Math.min(mult, TIER_LINES.length - 1)]}`;
export const partyLine = (level: number, spare: boolean): string => (spare ? `level ${level} · +1 spare pot` : `level ${level} done`);

/** Lane messages fit at 15 px on a 360 px phone up to this many characters (the lane shrinks the type below that). */
export const LANE_CHARS = 36;

/** Splits a tip into at most two lines of `max` characters, at word breaks. */
export function wrap(text: string, max: number): string[] {
  const lines: string[] = [];
  let cur = "";
  for (const w of text.split(" ")) {
    if (!cur) cur = w;
    else if ((cur + " " + w).length <= max) cur += " " + w;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}
