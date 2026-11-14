/**
 * Headless thumbs. A pilot looks at the map every so often, the way a player glances ahead: which gap leads to the
 * nearest coin, and is a scribble too close to it? Skill is how quickly it reacts, how often it fumbles, how fine
 * it dares to cut it, and whether it knows what swords are for.
 */
import type { Rng } from "@thumbcade-games/kit/rng";
import { beside, distances, isOpen, N, opposite } from "./maze.ts";
import { COIN_HERE, SWORD_HERE, type Sim } from "./sim.ts";

export interface Skill {
  name: string;
  /** The berth it gives a scribble, in squares. A better thumb cuts it finer: the knight is the faster one. */
  aware: number;
  /** Seconds between looks at the map. */
  react: number;
  /** Fuzz on every choice (in squares of detour). */
  noise: number;
  /** Goes for a sword when hunted, and for the scribbles when holding one. */
  tactics: boolean;
}

export const SKILLS: Skill[] = [
  { name: "novice", aware: 2, react: 0.34, noise: 3, tactics: false },
  { name: "good", aware: 2.6, react: 0.2, noise: 1.2, tactics: true },
  { name: "expert", aware: 2.2, react: 0.07, noise: 0.25, tactics: true },
];
/** The attract demo: tidy, not superhuman. */
export const DEMO: Skill = { name: "demo", aware: 2.4, react: 0.12, noise: 0.6, tactics: true };

export class Pilot {
  private wait = 0;
  private readonly goal = new Int16Array(N);
  private readonly fields: Int16Array[] = [];

  constructor(
    readonly skill: Skill,
    private readonly rng: Rng,
  ) {}

  step(sim: Sim, dt: number): void {
    if (sim.phase !== "play") return;
    this.wait -= dt;
    if (this.wait > 0) return;
    this.wait = this.skill.react * (0.7 + this.rng() * 0.6);
    const d = this.choose(sim);
    const h = sim.hero;
    if (d >= 0 && d !== h.dir && d !== h.want) sim.steer(d);
  }

  /** The way to go: the best gap at the square ahead, or straight back. -1: carry on. */
  choose(sim: Sim): number {
    const h = sim.hero;
    const maze = sim.maze;
    const sk = this.skill;
    // Where the trouble is: steps from each hunting scribble to every square.
    const hunters = sim.monsters.filter((m) => m.state === "hunt");
    hunters.forEach((m, i) => {
      const at = m.dir >= 0 && m.t > 0.5 ? beside(m.cell, m.dir) : m.cell;
      this.fields[i] = distances(maze, at, this.fields[i] ?? new Int16Array(N));
    });
    const threat = (c: number): number => {
      let t = 99;
      for (let i = 0; i < hunters.length; i++) t = Math.min(t, this.fields[i]![c]!);
      return t;
    };
    const here = h.dir >= 0 ? beside(h.cell, h.dir) : h.cell;
    // What he is after: a scared scribble, a sword when hunted, the gold star, otherwise the nearest coin.
    const targets: number[] = [];
    const scared = sim.monsters.filter((m) => m.state === "scared");
    if (sk.tactics && scared.length && h.brave > 60) for (const m of scared) targets.push(m.dir >= 0 ? beside(m.cell, m.dir) : m.cell);
    else {
      const hunted = sk.tactics && h.inv <= 0 && threat(here) <= sk.aware + 1;
      if (hunted) for (let c = 0; c < N; c++) if (sim.things[c] === SWORD_HERE) targets.push(c);
      if (!targets.length) {
        for (let c = 0; c < N; c++) if (sim.things[c] === COIN_HERE || (sk.tactics && c === sim.star)) targets.push(c);
        if (!sk.tactics || !hunters.length) for (let c = 0; c < N; c++) if (sim.things[c] === SWORD_HERE && sk.tactics === false) targets.push(c);
      }
    }
    // Steps to the nearest target from every square (a many-source flood).
    const goal = this.goal;
    goal.fill(-1);
    const queue: number[] = [];
    for (const c of targets) {
      if (goal[c]! < 0) {
        goal[c] = 0;
        queue.push(c);
      }
    }
    for (let q = 0; q < queue.length; q++) {
      const c = queue[q]!;
      for (let d = 0; d < 4; d++) {
        if (!isOpen(maze, c, d)) continue;
        const n = beside(c, d);
        if (goal[n]! >= 0) continue;
        goal[n] = goal[c]! + 1;
        queue.push(n);
      }
    }
    const worth = (c: number, steps: number): number => {
      let v = -(goal[c]! < 0 ? 30 : goal[c]!);
      if (h.inv <= 0 || h.inv < 40) {
        const t = threat(c) - steps * 0.7;
        if (t <= sk.aware) v -= (sk.aware + 1 - t) * 25;
      }
      return v + (this.rng() - 0.5) * sk.noise;
    };
    let best = -1;
    let bestV = -1e9;
    for (let d = 0; d < 4; d++) {
      if (!isOpen(maze, here, d)) continue;
      const back = h.dir >= 0 && d === opposite(h.dir);
      // Turning round at the square ahead is just a slower way of doubling back now.
      if (back) continue;
      const v = worth(beside(here, d), 1 + (h.dir >= 0 ? 1 - h.t : 0)) - (h.dir >= 0 && d !== h.dir ? 0.15 : 0);
      if (v > bestV) {
        bestV = v;
        best = d;
      }
    }
    if (h.dir >= 0) {
      const v = worth(h.cell, h.t) - 0.6;
      if (v > bestV) return opposite(h.dir);
    }
    return best;
  }
}
