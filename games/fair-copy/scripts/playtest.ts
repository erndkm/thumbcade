/**
 * Headless playtest: the pilots in src/pilot.ts play full rounds on real dealt boards with the real rules and word
 * lists, at four skill levels. `pnpm --filter @thumbcade-games/fair-copy playtest [rounds]`.
 */
import { readFileSync } from "node:fs";
import { createRng } from "@thumbcade-games/kit/rng";
import { dealBoard, lexicon, type Blocked } from "../src/deal.ts";
import { SortedWords } from "../src/lexicon.ts";
import { SKILLS, WordPilot } from "../src/pilot.ts";
import { Round } from "../src/round.ts";

const ROUNDS = Number(process.argv[2] ?? 60);
const read = (f: string) => readFileSync(new URL(`../src/data/${f}`, import.meta.url), "utf8");
const t0 = performance.now();
const lex = lexicon(read("common.txt"), JSON.parse(read("blocked.json")) as Blocked);
const accept = new SortedWords(read("accept.txt"));
console.log(`lexicon ${(performance.now() - t0).toFixed(0)} ms`);
const q = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(p * xs.length))]!;

const t1 = performance.now();
const boards = Array.from({ length: ROUNDS }, (_, i) => dealBoard(lex, createRng(500 + i)));
console.log(`dealing ${((performance.now() - t1) / ROUNDS).toFixed(1)} ms per board`);

for (const skill of Object.values(SKILLS)) {
  const secs: number[] = [];
  const scores: number[] = [];
  const found: number[] = [];
  const longest: number[] = [];
  for (let i = 0; i < ROUNDS; i++) {
    const rated = boards[i]!;
    const round = new Round(rated.board, (w) => accept.has(w));
    const pilot = new WordPilot(skill, createRng(900 + i));
    const seen = new Set<string>();
    for (let f = 0; f < 300 * 60 && !round.over; f++) {
      round.step(1 / 60);
      if (pilot.tick(1 / 60)) {
        const pick = pilot.choose(rated, lex.everyday, seen);
        if (pick) {
          seen.add(pick.word);
          round.submit(pick.path);
        }
      }
    }
    const s = round.stats;
    secs.push(s.seconds);
    scores.push(round.score);
    found.push(s.words);
    longest.push(s.longest);
  }
  const p = (xs: number[]) => [0.1, 0.5, 0.9].map((x) => Math.round(q(xs, x))).join(" / ");
  console.log(`${skill.name.padEnd(8)} round s ${p(secs)}  score ${p(scores)}  words ${p(found)}  longest ${p(longest)}`);
}
