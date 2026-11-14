/**
 * The pilot: plays the attract demo, the QA autoplay and headless runs at several skill levels, so run lengths can be
 * measured without a person (scripts/playtest.ts, test/pilot.test.ts). It reads what a player reads (the marked
 * lines and the places set in by themselves), thinks of words it knows, and presses keys one at a time with a
 * person's pauses, so every key goes through the same path as a tap.
 */
import { createRng, type Rng } from "@thumbcade-games/kit/rng";
import { LETTERS, RING, RULE, STRUCK, type Mark } from "./marks.ts";
import { type Key, Run, type RunEvent, type RunStats } from "./run.ts";

export interface Skill {
  name: string;
  /** Share of the answer list this player would think of. */
  vocab: number;
  /** Chance each kind of mark is taken into account. */
  heed: { ring: number; rule: number; struck: number };
  /** Seconds before the first key of a line, plus this much per doubling of the words it is choosing between. */
  think: [number, number];
  perDoubling: number;
  /** Seconds per key. */
  key: [number, number];
  /** Chance a line is first written with a slip of the finger (a non-word, shaken back). */
  typo: number;
  /** Opens every slip with a strong opening word instead of any word it knows. */
  opener: boolean;
  /** Chance of picking the word that tests the most new letters instead of any word that fits. */
  sharp: number;
  /** Uses the pencil when a slip drags on. */
  pencil: boolean;
}

export const SKILLS: Skill[] = [
  { name: "novice", vocab: 0.55, heed: { ring: 1, rule: 0.8, struck: 0.55 }, think: [4, 6.5], perDoubling: 0.35, key: [0.38, 0.55], typo: 0.1, opener: false, sharp: 0, pencil: false },
  { name: "casual", vocab: 0.7, heed: { ring: 1, rule: 0.9, struck: 0.75 }, think: [3, 5], perDoubling: 0.3, key: [0.3, 0.42], typo: 0.06, opener: false, sharp: 0.25, pencil: true },
  { name: "good", vocab: 0.85, heed: { ring: 1, rule: 1, struck: 0.92 }, think: [2.2, 3.6], perDoubling: 0.25, key: [0.22, 0.32], typo: 0.03, opener: true, sharp: 0.6, pencil: true },
  { name: "expert", vocab: 0.95, heed: { ring: 1, rule: 1, struck: 1 }, think: [1.4, 2.4], perDoubling: 0.2, key: [0.16, 0.22], typo: 0.01, opener: true, sharp: 0.9, pencil: true },
];

export const skillByName = (name: string): Skill | undefined => SKILLS.find((s) => s.name === name);

/** Opening words a practised player keeps in their pocket. */
export const OPENERS = ["slate", "crane", "trace", "stare", "arise", "stone", "least", "alert", "raise", "learn"];

/** Does `w` fit what the player took from one marked line? (Only the marks they heeded.) */
function fits(w: string, guess: string, marks: readonly Mark[], heeded: readonly boolean[]): boolean {
  for (let i = 0; i < LETTERS; i++) {
    if (!heeded[i]) continue;
    const g = guess[i]!;
    const m = marks[i]!;
    if (m === RING) {
      if (w[i] !== g) return false;
    } else if (m === RULE) {
      if (w[i] === g || !w.includes(g)) return false;
    } else {
      let elsewhere = false;
      for (let j = 0; j < LETTERS; j++) if (j !== i && guess[j] === g && marks[j] !== STRUCK) elsewhere = true;
      if (elsewhere ? w[i] === g : w.includes(g)) return false;
    }
  }
  return true;
}

export class Pilot {
  private queue: Key[] = [];
  private wait: number;
  private slipN = -1;
  private lineN = -1;
  /** Which marks of each line on this slip the player took in (decided once per line). */
  private heeded: boolean[][] = [];
  readonly vocab: string[];

  constructor(
    readonly skill: Skill,
    private readonly rng: Rng,
    answers: readonly string[],
    /** Words the pilot must never write (the attract demo keeps today's word unspoken). */
    private readonly avoid: ReadonlySet<string> = new Set(),
  ) {
    this.vocab = answers.filter(() => rng() < skill.vocab);
    this.wait = rng.range(0.4, 0.9);
  }

  /** The key to press now, or null to keep reading. Call every frame with the frame's dt. */
  next(run: Run, dt: number): Key | null {
    if (!run.live) return null;
    const s = run.slip;
    if (s.n !== this.slipN || s.lines.length !== this.lineN) {
      // A new slip or a freshly marked line: read it before typing.
      if (s.n !== this.slipN) this.heeded = [];
      this.slipN = s.n;
      this.lineN = s.lines.length;
      this.queue = [];
      while (this.heeded.length < s.lines.length) {
        const l = s.lines[this.heeded.length]!;
        const h = this.skill.heed;
        this.heeded.push(l.marks.map((m) => this.rng() < (m === RING ? h.ring : m === RULE ? h.rule : h.struck)));
      }
    }
    this.wait -= dt;
    if (this.wait > 0) return null;
    if (!this.queue.length) {
      if (run.typedCount > 0) {
        // A full line waiting on the dictionary: wait with it.
        if (run.full) return null;
        // Something it didn't plan is on the line (a pencil landed on a typed letter): clear and think again.
        this.wait = this.rng.range(0.15, 0.3);
        return "erase";
      }
      this.plan(run);
      return null;
    }
    const k = this.queue.shift()!;
    const ks = this.skill.key;
    this.wait = this.rng.range(ks[0], ks[1]) * (k === "write" ? 1.3 : 1);
    return k;
  }

  /** The words that fit everything this player took in, among those they'd think of. */
  candidates(run: Run, pool: readonly string[] = this.vocab): string[] {
    const s = run.slip;
    return pool.filter((w) => {
      if (this.avoid.has(w)) return false;
      for (let i = 0; i < LETTERS; i++) if (s.known[i] !== null && w[i] !== s.known[i]) return false;
      for (let k = 0; k < s.lines.length; k++) {
        const l = s.lines[k]!;
        if (l.word === w) return false;
        if (!fits(w, l.word, l.marks, this.heeded[k] ?? [])) return false;
      }
      return true;
    });
  }

  private plan(run: Run) {
    const sk = this.skill;
    const s = run.slip;
    let pool = this.candidates(run);
    let think = this.rng.range(sk.think[0], sk.think[1]);
    if (!pool.length) {
      // Nothing it knows fits: it digs deeper (any common word), which takes longer.
      pool = this.candidates(run, run.answers);
      think *= 1.6;
      if (!pool.length) pool = run.answers.filter((w) => !this.avoid.has(w) && s.known.every((k, i) => k === null || w[i] === k));
    }
    if (sk.pencil && run.pencils > 0 && s.lines.length >= 2 && pool.length > 2 && s.known.some((k) => k === null)) {
      this.queue = ["pencil"];
      this.wait = think * 0.5;
      return;
    }
    let word: string;
    if (s.lines.length === 0 && sk.opener) {
      word = this.rng.pick(OPENERS.filter((w) => !this.avoid.has(w)));
      think = this.rng.range(0.4, 0.9);
    } else {
      think += sk.perDoubling * Math.log2(Math.max(1, pool.length));
      word = this.rng() < sk.sharp ? this.sharpest(pool, s.found) : this.rng.pick(pool);
    }
    // Like a person, it types the whole word; the places already set are confirmed as it goes.
    const keys: Key[] = [...word];
    if (this.rng() < sk.typo) {
      const wrong = this.slip(word, run);
      if (wrong) {
        this.queue = [...wrong, "write", "erase", "erase", ...word.slice(3), "write"];
        this.wait = think;
        return;
      }
    }
    keys.push("write");
    this.queue = keys;
    this.wait = think;
  }

  /** A slip of the finger in one of the last two places (an open one) that makes a non-word. */
  private slip(word: string, run: Run): string | null {
    const open = [3, 4].filter((i) => run.slip.known[i] === null);
    if (!open.length) return null;
    for (let tries = 0; tries < 12; tries++) {
      const i = this.rng.pick(open);
      const c = String.fromCharCode(97 + this.rng.int(0, 25));
      const w = word.slice(0, i) + c + word.slice(i + 1);
      if (run.isWord(w) === false) return w;
    }
    return null;
  }

  /** The word that tries the most letters common among the words still in play. */
  private sharpest(pool: readonly string[], found: ReadonlySet<string>): string {
    const freq = new Float32Array(26);
    for (const w of pool) {
      const seen = new Set<number>();
      for (let i = 0; i < LETTERS; i++) seen.add(w.charCodeAt(i) - 97);
      for (const c of seen) freq[c]!++;
    }
    let best = pool[0]!;
    let bestV = -1;
    const sample = pool.length > 300 ? Array.from({ length: 300 }, () => this.rng.pick(pool)) : pool;
    for (const w of sample) {
      const seen = new Set<string>();
      let v = 0;
      for (let i = 0; i < LETTERS; i++) {
        const c = w[i]!;
        if (seen.has(c)) continue;
        seen.add(c);
        if (!found.has(c)) v += freq[c.charCodeAt(0) - 97]!;
      }
      v += this.rng() * 0.5;
      if (v > bestV) {
        bestV = v;
        best = w;
      }
    }
    return best;
  }
}

export interface Played {
  seconds: number;
  score: number;
  stats: RunStats;
  /** Clock left at 10 s (Infinity if the run never got there). */
  clockAt10: number;
  lostBy10: boolean;
  events: RunEvent[];
}

export interface Lists {
  answers: readonly string[];
  isWord: (w: string) => boolean;
}

/** Plays one whole run headless at 60 steps a second. `skill` null = an idle player. */
export function playRun(skill: Skill | null, seed: number, lists: Lists, opts: { daily?: string | null; keep?: boolean; maxSeconds?: number } = {}): Played {
  const run = new Run({ seed, answers: lists.answers, daily: opts.daily ?? null, isWord: lists.isWord });
  const pilot = skill ? new Pilot(skill, createRng(seed ^ 0x5eed), lists.answers) : null;
  const dt = 1 / 60;
  let clockAt10 = Infinity;
  let wall = 0;
  const events: RunEvent[] = [];
  const max = opts.maxSeconds ?? 300;
  while (run.live && wall < max) {
    wall += dt;
    const ev = run.step(dt);
    if (opts.keep) events.push(...ev);
    if (clockAt10 === Infinity && wall >= 10) clockAt10 = run.clock;
    if (!pilot || !run.live) continue;
    const k = pilot.next(run, dt);
    if (k) {
      const e = run.press(k);
      if (opts.keep) events.push(...e);
    }
  }
  return { seconds: wall, score: run.score, stats: run.stats, clockAt10, lostBy10: !run.live && wall < 10, events };
}

export const percentile = (xs: readonly number[], p: number): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))]!;
};
