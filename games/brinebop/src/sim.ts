/**
 * The pilot: plays the attract demo, picks the hint, and plays headless runs at several skill levels so run
 * lengths and scores can be measured without a person (see scripts/playtest.ts and test/sim.test.ts).
 */
import { createRng, type Rng } from "@thumbcade-games/kit/rng";
import { col, COLS, N, row, type Board, type Move } from "./board.ts";
import { Run, type RunStats } from "./run.ts";

export interface Skill {
  name: string;
  /** Seconds from one move to the next (uniform range): seeing, deciding, dragging. */
  think: [number, number];
  /** 0 = any move that works, 1 = always the most valuable one on the board. */
  greed: number;
  /** Chance a move is a mis-swap that snaps back. */
  miss: number;
}

export const SKILLS: Skill[] = [
  { name: "first-timer", think: [2.2, 4], greed: 0.1, miss: 0.25 },
  { name: "casual", think: [1.4, 2.6], greed: 0.4, miss: 0.12 },
  { name: "good", think: [0.9, 1.6], greed: 0.75, miss: 0.05 },
  { name: "expert", think: [0.55, 0.95], greed: 1, miss: 0.02 },
];

/** Picks a move: with probability `greed` the best one, otherwise a random one that works. */
export function chooseMove(moves: Move[], greed: number, rng: () => number): Move | null {
  if (!moves.length) return null;
  if (rng() < greed) {
    let best = moves[0]!;
    for (const m of moves) if (m.value > best.value) best = m;
    return best;
  }
  return moves[Math.floor(rng() * moves.length)]!;
}

/** A swap of two resting neighbours that does nothing (a fumble), or null. */
export function fumble(board: Board, rng: () => number): Move | null {
  for (let tries = 0; tries < 20; tries++) {
    const i = Math.floor(rng() * N);
    const j = rng() < 0.5 ? (col(i) + 1 < COLS ? i + 1 : i - 1) : row(i) + 1 < 9 ? i + COLS : i - COLS;
    if (board.canSwap(i, j) && !board.wouldWork(i, j)) return { from: i, to: j, value: 0, makes: "none" };
  }
  return null;
}

export class Pilot {
  wait: number;
  constructor(
    readonly skill: Skill,
    private readonly rng: Rng,
  ) {
    this.wait = rng.range(skill.think[0], skill.think[1]) * 0.6;
  }
  /** Returns the move to make this frame, if any. */
  next(board: Board, dt: number): Move | null {
    this.wait -= dt;
    if (this.wait > 0) return null;
    const m = this.rng() < this.skill.miss ? fumble(board, this.rng) : chooseMove(board.findMoves(), this.skill.greed, this.rng);
    // Nothing to do yet (the board is still busy): look again in a moment.
    this.wait = m ? this.rng.range(this.skill.think[0], this.skill.think[1]) : 0.15;
    return m;
  }
}

export interface SimResult {
  seconds: number;
  score: number;
  stats: RunStats;
}

/** Plays one full run headless at 60 steps a second. */
export function simulate(seed: number, skill: Skill): SimResult {
  const rng = createRng(seed);
  const run = new Run(rng);
  const pilot = new Pilot(skill, createRng(seed ^ 0x5bd1e995));
  const dt = 1 / 60;
  while (run.phase !== "done" && run.elapsed < 300) {
    if (run.canSwap) {
      const m = pilot.next(run.board, dt);
      if (m) run.swap(m.from, m.to);
    }
    run.step(dt);
    run.events.length = 0;
  }
  return { seconds: run.elapsed, score: run.score, stats: { ...run.stats } };
}

export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}
