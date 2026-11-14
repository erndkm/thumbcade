/**
 * Writes shoot.json: screenshots of a real run played through real taps on the keyboard. The review harness
 * launches every game with seed 1234 and a fresh store, so the first run opens on today's word and its later slips
 * are known in advance. This plays that run headless with the expert pilot, turns every key into a tap at the
 * iPhone layout, and places shots on a marked line, a solve, a tier-up and the game over.
 *
 * Today's word changes at midnight UTC, so run this on the day you shoot:
 *   pnpm --filter @thumbcade-games/galley-proof shoot-plan   (then the reviewer's `shoot` with games/galley-proof/shoot.json)
 */
import { writeFileSync } from "node:fs";
import { createRng } from "@thumbcade-games/kit/rng";
import { dailyWord, seedForDay } from "../src/daily.ts";
import { keyboard, keyCentre } from "../src/layout.ts";
import { Pilot, SKILLS } from "../src/pilot.ts";
import { type Key, Run, type RunEvent, TUNE } from "../src/run.ts";
import { loadLists } from "./lists.ts";

const HARNESS_SEED = 1234;
// iPhone 6.1": 390×844 minus the 56 pt bottom bar and the 34 pt home indicator.
const W = 390;
const H = 844 - 56 - 34;
const kb = keyboard(W, H - 8, H);
const lists = loadLists();
const now = Date.now();
const today = dailyWord(lists.answers, seedForDay(now), now);

type Action = { wait: number } | { tap: [number, number] } | { shot: string };
const actions: Action[] = [{ wait: 3400 }, { shot: "attract" }, { tap: [195, 420] }, { wait: 1400 }];

const run = new Run({ seed: (HARNESS_SEED ^ Math.imul(1, 0x9e3779b1)) >>> 0, answers: lists.answers, daily: today.word, isWord: lists.isWord });
// The pilot only chooses the words; the plan sets its own steady pace.
const pilot = new Pilot({ ...SKILLS[3]!, typo: 0, pencil: false }, createRng(HARNESS_SEED), lists.answers);
const KEY_MS = 170;
let solves = 0;
let shotPlay = false;
let shotTier = false;
let keys = 0;
const step = (s: number) => {
  for (let x = 0; x < s; x += 1 / 60) run.step(1 / 60);
};
while (run.live && solves < 4 && keys < 200) {
  // Ask the pilot for its next key, letting its own thinking time pass off the books.
  let k: Key | null = null;
  for (let i = 0; i < 2000 && !k; i++) k = pilot.next(run, 1 / 60);
  if (!k) break;
  keys++;
  actions.push({ tap: keyCentre(kb, k) });
  const evs: RunEvent[] = run.press(k);
  const solve = evs.find((e) => e.type === "solve");
  const line = evs.find((e) => e.type === "line");
  if (solve && solve.type === "solve") {
    solves++;
    if (solve.tierUp && !shotTier) {
      shotTier = true;
      actions.push({ wait: 1480 }, { shot: "tier" }, { wait: 570 });
      step(2.05);
    } else if (solves === 1) {
      actions.push({ wait: 1000 }, { shot: "solve" }, { wait: 920 });
      step(1.92);
    } else {
      actions.push({ wait: 1900 });
      step(1.9);
    }
  } else if (line) {
    if (!shotPlay && run.slip.lines.length === 2) {
      shotPlay = true;
      actions.push({ wait: 900 }, { shot: "play" });
      step(0.9);
    } else {
      actions.push({ wait: 950 });
      step(0.95);
    }
  } else {
    actions.push({ wait: KEY_MS });
    step(KEY_MS / 1000);
  }
}
// Then hands off: the clock runs out; the summary shows today's marks.
let left = 0;
while (run.live && left < 200) {
  run.step(1 / 60);
  left += 1 / 60;
}
actions.push({ wait: Math.round((left + 2.6) * 1000) }, { shot: "over" });
writeFileSync(new URL("../shoot.json", import.meta.url), `${JSON.stringify(actions, null, 0).replace(/\},\{/g, "},\n  {").replace(/^\[/, "[\n  ").replace(/\]$/, "\n]")}\n`);
console.log(
  `shoot.json for ${new Date(now).toISOString().slice(0, 10)} (today's word ${today.word}): ${actions.length} steps, ${keys} keys, ${solves} solves, the bell ${left.toFixed(1)} s after the last key (clock ${TUNE.clock} s at the start)`,
);
