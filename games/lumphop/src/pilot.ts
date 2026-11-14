/**
 * The pilot plays the attract demo, the QA autoplay and the headless playtests, through the same `Run.tap` a finger
 * uses. It sees what a player sees (covered lumps stay a mystery to its own judgement) and plays at a skill: how long
 * it looks before a move, how often it plans properly, how often it does something careless, and how often its thumb
 * lands on the wrong pot first.
 */
import { createRng, type Rng } from "@thumbcade-games/kit/rng";
import { FULL, isIdleMove, isSealed, legalMoves, moveCount, runLength, type Board, type Move } from "./rules.ts";
import { Run, type RunEvent, type RunStats } from "./run.ts";
import { solve } from "./solver.ts";

export interface Skill {
  name: string;
  /** Seconds from the end of one move to the tap that lifts the next. */
  think: [number, number];
  /** Seconds from the lift to the drop. */
  aim: [number, number];
  /** Chance a move is planned with the whole board in mind (the solver's line) instead of the eye's best guess. */
  plan: number;
  /** Chance of a careless move (any legal move). */
  careless: number;
  /** Chance the drop tap lands on a pot that can't take the run (a re-target, then the right pot). */
  slip: number;
  /** Uses a held spare pot when the board gets tight. */
  spares: boolean;
}

export const SKILLS: Skill[] = [
  { name: "novice", think: [1.3, 2.5], aim: [0.45, 0.85], plan: 0.05, careless: 0.2, slip: 0.12, spares: false },
  { name: "casual", think: [0.9, 1.7], aim: [0.35, 0.6], plan: 0.2, careless: 0.1, slip: 0.06, spares: true },
  { name: "good", think: [0.62, 1.1], aim: [0.26, 0.45], plan: 0.45, careless: 0.05, slip: 0.03, spares: true },
  { name: "expert", think: [0.38, 0.7], aim: [0.18, 0.32], plan: 0.8, careless: 0.01, slip: 0.01, spares: true },
];

export const skillByName = (name: string): Skill | undefined => SKILLS.find((s) => s.name === name);

/** What a move looks like to the eye: sealing, then whole runs onto their own kind, then uncovering, then parking. */
export function eyeScore(board: Board, from: number, to: number): number {
  const a = board[from]!;
  const b = board[to]!;
  const n = moveCount(board, from, to);
  const run = runLength(a);
  let s = 0;
  if (b.cap === FULL && b.units.length && b.units.length + n === FULL && runLength(b) === b.units.length) s += 500;
  if (b.units.length) s += n === run ? 80 + runLength(b) * 10 : 10;
  else s += run < a.units.length ? 30 : -30;
  const below = a.units.length - n - 1;
  if (below >= 0 && a.covered[below]) s += 25;
  if (below < 0) s += 15;
  // A pot holding one kind is a good home; don't pull from it.
  if (run === a.units.length && b.units.length === 0) s -= 60;
  return s;
}

export class Pilot {
  /** Seconds until the next tap. */
  wait: number;
  /** Taps still to make for the move under way, each with the pot that should be lifted just before it. */
  private queue: Array<{ pot: number; held: number }> = [];
  private last: Move | null = null;
  private level = 0;
  constructor(
    readonly skill: Skill,
    private readonly rng: Rng,
  ) {
    this.wait = rng.range(skill.think[0], skill.think[1]);
  }

  /** The pot to tap now (-2 = the spare pot), or null to keep looking. Call every frame with the frame's dt. */
  next(run: Run, dt: number): number | null {
    if (!run.accepting) return null;
    if (run.level !== this.level) {
      this.level = run.level;
      this.queue = [];
    }
    this.wait -= dt;
    if (this.wait > 0) return null;
    const s = this.skill;
    if (this.queue.length && this.queue[0]!.held !== run.held) this.queue = [];
    if (!this.queue.length) {
      if (run.held >= 0) {
        this.wait = this.rng.range(s.aim[0], s.aim[1]);
        return run.held;
      }
      if (s.spares && run.spares > 0 && !run.spareOnBoard && this.tight(run.board)) {
        this.wait = this.rng.range(s.think[0], s.think[1]);
        return -2;
      }
      const m = this.choose(run);
      if (!m) {
        this.wait = 0.5;
        return null;
      }
      this.last = m;
      const wrong = this.rng() < s.slip ? run.board.findIndex((p, i) => i !== m.from && i !== m.to && p.units.length > 0 && !isSealed(p) && moveCount(run.board, m.from, i) === 0) : -1;
      this.queue =
        wrong >= 0
          ? [
              { pot: m.from, held: -1 },
              { pot: wrong, held: m.from },
              { pot: wrong, held: wrong },
              { pot: m.from, held: -1 },
              { pot: m.to, held: m.from },
            ]
          : [
              { pot: m.from, held: -1 },
              { pot: m.to, held: m.from },
            ];
    }
    const tap = this.queue.shift()!;
    this.wait = this.queue.length ? this.rng.range(s.aim[0], s.aim[1]) : this.rng.range(s.think[0], s.think[1]);
    return tap.pot;
  }

  /** No empty pot left and hardly a move onto a matching kind. */
  private tight(board: Board): boolean {
    if (board.some((p) => !p.units.length)) return false;
    return legalMoves(board).filter((m) => !isIdleMove(board, m.from, m.to)).length <= 2;
  }

  /** The move this player makes now. */
  choose(run: Run): Move | null {
    const s = this.skill;
    const board = run.board;
    const moves = legalMoves(board).filter((m) => !isIdleMove(board, m.from, m.to));
    if (!moves.length) return null;
    if (this.rng() < s.careless) return this.rng.pick(moves);
    if (this.rng() < s.plan) {
      const line = solve(board, 20_000);
      if (line.moves.length) return line.moves[0]!;
    }
    let best: Move | null = null;
    let bestV = -Infinity;
    for (const m of moves) {
      let v = eyeScore(board, m.from, m.to) + this.rng() * 20;
      // Don't put straight back what was just moved.
      if (this.last && m.from === this.last.to && m.to === this.last.from) v -= 200;
      if (v > bestV) {
        bestV = v;
        best = m;
      }
    }
    return best;
  }
}

/** Plays a tap from the pilot (-2 = the spare pot). */
export function act(run: Run, pot: number): RunEvent[] {
  return pot === -2 ? run.useSpare() : run.tap(pot);
}

export interface Played {
  seconds: number;
  score: number;
  stats: RunStats;
  /** Clock left at 10 s. */
  clockAt10: number;
  lostBy10: boolean;
  level: number;
}

/** Plays one whole run headless at 60 steps a second. `skill` null = an idle player. */
export function playRun(skill: Skill | null, seed: number, maxSeconds = 300): Played {
  const run = new Run(seed);
  const pilot = skill ? new Pilot(skill, createRng(seed ^ 0x5eed)) : null;
  const dt = 1 / 60;
  let wall = 0;
  let clockAt10 = Infinity;
  while (run.live && wall < maxSeconds) {
    wall += dt;
    run.step(dt);
    if (clockAt10 === Infinity && run.t >= 10) clockAt10 = run.clock;
    if (!pilot || !run.live) continue;
    const pot = pilot.next(run, dt);
    if (pot !== null) act(run, pot);
  }
  return { seconds: wall, score: run.score, stats: run.stats, clockAt10, lostBy10: !run.live && wall < 10, level: run.level };
}

export const percentile = (xs: readonly number[], p: number): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))]!;
};

