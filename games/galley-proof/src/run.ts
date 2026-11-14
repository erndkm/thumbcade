/**
 * One run: hidden words set one after another on galley slips, against one clock. Type a five-letter line, write it,
 * and the proofreader marks each letter. Solving a slip winds the clock back (more for fewer lines) and sets the next;
 * six lines without it reveal the word and cost time. The first slip of the day's first run is today's word.
 * Pure and time-stepped, so the game, the pilot and the tests all play the same rules.
 */
import { createRng, type Rng } from "@thumbcade-games/kit/rng";
import { LETTERS, markLine, RING, RULE, STRUCK, type Mark } from "./marks.ts";

export const TUNE = {
  /** Seconds on the clock at the first tap, and the most it ever holds. */
  clock: 52,
  clockMax: 75,
  /** The clock burns 1 + (t / burnScale)^burnPow seconds a second, t counted from the first tap. */
  burnScale: 60,
  burnPow: 2.5,
  /** ...and this share faster for every slip filed. */
  wordBurn: 0.08,
  /** A run with no key pressed after this many seconds burns this many times faster (nobody is there). */
  idleAfter: 10,
  idleBurn: 3,
  /** Lines on a slip. */
  lines: 6,
  /** Seconds a solve gives back, by the number of lines it took (index 1-6). */
  solveTime: [0, 20, 18, 15, 12, 9, 7],
  /** Each slip already filed this run gives back this share less (never below the floor). */
  refundDecay: 0.1,
  refundFloor: 0.4,
  /** Points for a solve by lines, times the multiplier. */
  solvePoints: [0, 600, 480, 360, 270, 200, 150],
  /** A place ringed for the first time on this slip. */
  ringTime: 0.5,
  ringPoints: 20,
  /** A letter found to be in the word (ruled) for the first time on this slip. */
  ruleTime: 0.2,
  rulePoints: 8,
  /** A missed slip (six lines, no solve) costs this many seconds. */
  missTime: 6,
  /** The clock stands still while a line is marked, and while a slip is filed and the next one set. */
  markPause: 0.55,
  filePause: 0.9,
  /** ...or while a missed word is written in. */
  missPause: 2.1,
  /** A solve in this many lines or fewer is clean: clean solves in a row climb the multiplier. */
  cleanLines: 4,
  /** The run of clean solves that reaches ×2, ×3, ×4 and ×5. */
  tiers: [2, 3, 5, 7],
  /** Today's word pays this on top. */
  dailyPoints: 250,
  /** Pencils (write in one letter) held at most; a solve in this many lines or fewer earns one. */
  pencilsMax: 2,
  pencilAt: 3,
} as const;

/** What each multiplier is called. */
export const TIER_NAMES = ["", "", "a steady hand", "a fine hand", "a clean proof", "letter perfect"] as const;
/** What a solve in n lines is called. */
export const SOLVE_NAMES = ["", "sight unseen", "at a glance", "a quick study", "in good time", "on the margin", "by a hair"] as const;

export function multiplier(streak: number): number {
  let m = 1;
  for (const t of TUNE.tiers) if (streak >= t) m++;
  return m;
}

export type Key = "erase" | "write" | "pencil" | (string & {});

export interface Line {
  word: string;
  marks: Mark[];
}

export interface LineView {
  letters: Array<string | null>;
  /** Typed (set in ink) rather than only known (in pencil). */
  typed: boolean[];
  /** The place each key landed in, in order. */
  at: number[];
  caret: number | null;
  /** Read as a whole word typed over the known places. */
  whole: boolean;
}

export interface Slip {
  /** 1-based number of the slip in this run. */
  n: number;
  answer: string;
  daily: boolean;
  lines: Line[];
  /** Places already known on this slip (ringed earlier, or pencilled in): set into every new line by themselves. */
  known: Array<string | null>;
  pencilled: boolean[];
  /** Letters known to be in the word. */
  found: Set<string>;
  outcome: "open" | "solved" | "missed";
}

export type RunEvent =
  | { type: "type"; letter: string; at: number; whole: boolean }
  | { type: "confirm"; letter: string; at: number }
  | { type: "erase"; at: number }
  | { type: "full" }
  | { type: "short"; have: number }
  | { type: "unknown"; word: string }
  | { type: "checking"; word: string }
  | { type: "line"; slip: number; ref: Slip; line: number; word: string; marks: Mark[]; rings: number[]; rules: number[]; points: number; time: number; bell: boolean }
  | { type: "solve"; slip: number; ref: Slip; lines: number; points: number; time: number; streak: number; mult: number; tierUp: boolean; daily: boolean; clean: boolean }
  | { type: "miss"; slip: number; ref: Slip; answer: string; time: number; daily: boolean }
  | { type: "earn"; what: "pencil" }
  | { type: "pencil"; at: number; letter: string }
  | { type: "nopencil" }
  | { type: "next"; slip: number; daily: boolean }
  | { type: "over"; why: "time" };

export interface RunStats {
  words: number;
  misses: number;
  /** Lines over all solved slips, and lines written in all. */
  solvedLines: number;
  linesWritten: number;
  fewest: number;
  bestStreak: number;
  unknown: number;
  shortWrites: number;
  pencilsEarned: number;
  pencilsUsed: number;
  /** Lines written while a pencil sat unused. */
  pencilIdleLines: number;
  /** Letters written again after the keyboard had struck them. */
  struckReuse: number;
  /** Ruled letters written again in the very place they were ruled. */
  samePlace: number;
  bellSolves: number;
  seconds: number;
  /** Lines on today's slip: null if it wasn't in this run, 0 if missed. */
  dailyLines: number | null;
  dailyMarks: Mark[][];
}

export interface RunOptions {
  seed: number;
  answers: readonly string[];
  /** Today's word, set as the first slip; null when the player has filed it already today. */
  daily: string | null;
  /** Is this a word we accept? null = can't tell yet (the dictionary is still on its way). */
  isWord: (w: string) => boolean | null;
}

export class Run {
  readonly rng: Rng;
  readonly answers: readonly string[];
  isWord: (w: string) => boolean | null;
  /** Seconds since the first tap, pauses included (the clock's burn grows with it). */
  t = 0;
  clock: number = TUNE.clock;
  score = 0;
  slip!: Slip;
  /** The share of a solve's time this slip gives back (less with every slip filed). */
  get refund(): number {
    return Math.max(TUNE.refundFloor, 1 - TUNE.refundDecay * this.stats.words);
  }

  /**
   * The keys typed on the current line, in order. The line is read from them two ways: letter by letter into the
   * places still open, passing over places already known (and confirming one when its very letter is typed), or,
   * when the keys don't fit around the known places, as a whole word typed over them. So players who type only the
   * gaps and players who type the whole word both end up with the word they meant.
   */
  strokes: string[] = [];
  streak = 0;
  pencils = 0;
  pause = 0;
  over = false;
  /** Keys pressed this run. */
  keys = 0;
  stats: RunStats = {
    words: 0, misses: 0, solvedLines: 0, linesWritten: 0, fewest: 0, bestStreak: 0, unknown: 0, shortWrites: 0, pencilsEarned: 0, pencilsUsed: 0,
    pencilIdleLines: 0, struckReuse: 0, samePlace: 0, bellSolves: 0, seconds: 0, dailyLines: null, dailyMarks: [],
  };
  private used = new Set<string>();
  private readonly dailyWord: string | null;

  constructor(o: RunOptions) {
    this.rng = createRng(o.seed);
    this.answers = o.answers;
    this.isWord = o.isWord;
    this.dailyWord = o.daily;
    if (o.daily) this.used.add(o.daily);
    this.setSlip(1, o.daily);
  }

  get live(): boolean {
    return !this.over;
  }

  /** Seconds the clock burns per second right now. */
  get burn(): number {
    const idle = this.keys === 0 && this.t > TUNE.idleAfter ? TUNE.idleBurn : 1;
    return (1 + (this.t / TUNE.burnScale) ** TUNE.burnPow) * (1 + TUNE.wordBurn * this.stats.words) * idle;
  }

  /** How the current line reads: each place's letter, whether it was typed (ink) or is only known (pencil), the caret. */
  get view(): LineView {
    const known = this.slip.known;
    const letters: Array<string | null> = [...known];
    const typed = [false, false, false, false, false];
    const at: number[] = [];
    let i = 0;
    for (const c of this.strokes) {
      while (i < LETTERS && known[i] !== null && known[i] !== c) i++;
      if (i >= LETTERS) {
        // The keys don't fit around the known places: read them as a whole word, typed over the pencil.
        const whole = this.strokes.map((k) => k as string | null);
        while (whole.length < LETTERS) whole.push(null);
        return { letters: whole, typed: whole.map((k) => k !== null), at: this.strokes.map((_, n) => n), caret: this.strokes.length < LETTERS ? this.strokes.length : null, whole: true };
      }
      letters[i] = c;
      typed[i] = true;
      at.push(i);
      i++;
    }
    const caret = letters.some((c) => c === null) ? Math.min(i, LETTERS - 1) : null;
    return { letters, typed, at, caret, whole: false };
  }

  /** The letter in each place of the line being typed. */
  get current(): Array<string | null> {
    return this.view.letters;
  }

  get full(): boolean {
    return this.current.every((c) => c !== null);
  }

  /** Where the next key goes (5 when the line is full). */
  get caret(): number {
    return this.view.caret ?? LETTERS;
  }

  get typedCount(): number {
    return this.strokes.length;
  }

  private setSlip(n: number, word: string | null): RunEvent {
    let answer = word;
    if (!answer) {
      do answer = this.rng.pick(this.answers);
      while (this.used.has(answer) && this.used.size < this.answers.length);
    }
    this.used.add(answer);
    this.slip = { n, answer, daily: !!word && word === this.dailyWord, lines: [], known: [null, null, null, null, null], pencilled: [false, false, false, false, false], found: new Set(), outcome: "open" };
    this.strokes = [];
    return { type: "next", slip: n, daily: this.slip.daily };
  }

  /** One key from the keyboard (a letter "a"-"z", "erase", "write" or "pencil"). */
  press(key: Key): RunEvent[] {
    if (!this.live) return [];
    this.keys++;
    if (key === "erase") return this.erase();
    if (key === "write") return this.write();
    if (key === "pencil") return this.pencil();
    if (key.length === 1 && key >= "a" && key <= "z") return this.type(key);
    return [];
  }

  private type(letter: string): RunEvent[] {
    if (this.strokes.length >= LETTERS) return [{ type: "full" }];
    const was = this.view;
    this.strokes.push(letter);
    const v = this.view;
    const at = v.at[v.at.length - 1]!;
    if (!v.whole && was.letters[at] !== null && this.slip.known[at] === letter) return [{ type: "confirm", letter, at }];
    return [{ type: "type", letter, at, whole: v.whole && !was.whole }];
  }

  private erase(): RunEvent[] {
    if (!this.strokes.length) return [];
    const at = this.view.at[this.view.at.length - 1]!;
    this.strokes.pop();
    return [{ type: "erase", at }];
  }

  /** Writes the line: the proofreader marks it. */
  write(bell = false): RunEvent[] {
    if (!this.live) return [];
    const cur = this.current;
    if (!this.full) {
      this.stats.shortWrites++;
      return [{ type: "short", have: cur.filter((c) => c !== null).length }];
    }
    const word = cur.join("");
    const verdict = this.isWord(word);
    if (verdict === null) return [{ type: "checking", word }];
    if (!verdict) {
      this.stats.unknown++;
      return [{ type: "unknown", word }];
    }
    const s = this.slip;
    const marks = markLine(word, s.answer);
    // What a careful reader would not have written again.
    const keys = this.keyBest();
    for (let i = 0; i < LETTERS; i++) {
      const c = word[i]!;
      if (keys.get(c) === STRUCK) this.stats.struckReuse++;
      if (s.lines.some((l) => l.word[i] === c && l.marks[i] === RULE)) this.stats.samePlace++;
    }
    if (this.pencils > 0) this.stats.pencilIdleLines++;
    s.lines.push({ word, marks });
    this.stats.linesWritten++;
    const rings: number[] = [];
    const rules: number[] = [];
    for (let i = 0; i < LETTERS; i++) {
      const c = word[i]!;
      if (marks[i] === RING && s.known[i] === null) {
        rings.push(i);
        s.known[i] = c;
      }
    }
    for (let i = 0; i < LETTERS; i++) {
      const c = word[i]!;
      if (marks[i] !== STRUCK && !s.found.has(c)) {
        s.found.add(c);
        if (!rings.includes(i)) rules.push(i);
      }
    }
    const points = rings.length * TUNE.ringPoints + rules.length * TUNE.rulePoints;
    const time = rings.length * TUNE.ringTime + rules.length * TUNE.ruleTime;
    this.score += points;
    this.addClock(time);
    this.strokes = [];
    const out: RunEvent[] = [{ type: "line", slip: s.n, ref: s, line: s.lines.length, word, marks, rings, rules, points, time, bell }];
    if (marks.every((m) => m === RING)) out.push(...this.solve(bell));
    else if (s.lines.length >= TUNE.lines) out.push(...this.miss());
    else this.pause = Math.max(this.pause, TUNE.markPause);
    return out;
  }

  private solve(bell: boolean): RunEvent[] {
    const s = this.slip;
    const lines = s.lines.length;
    s.outcome = "solved";
    const clean = lines <= TUNE.cleanLines;
    const before = multiplier(this.streak);
    this.streak = clean ? this.streak + 1 : 0;
    const mult = clean ? multiplier(this.streak) : 1;
    const points = TUNE.solvePoints[lines]! * mult + (s.daily ? TUNE.dailyPoints : 0);
    const time = Math.round(TUNE.solveTime[lines]! * this.refund * 2) / 2;
    this.score += points;
    this.addClock(time);
    const st = this.stats;
    st.words++;
    st.solvedLines += lines;
    st.fewest = st.fewest ? Math.min(st.fewest, lines) : lines;
    st.bestStreak = Math.max(st.bestStreak, this.streak);
    if (bell) st.bellSolves++;
    if (s.daily) {
      st.dailyLines = lines;
      st.dailyMarks = s.lines.map((l) => [...l.marks]);
    }
    const out: RunEvent[] = [{ type: "solve", slip: s.n, ref: s, lines, points, time, streak: this.streak, mult, tierUp: clean && mult > before, daily: s.daily, clean }];
    if (lines <= TUNE.pencilAt && this.pencils < TUNE.pencilsMax) {
      this.pencils++;
      st.pencilsEarned++;
      out.push({ type: "earn", what: "pencil" });
    }
    this.pause = Math.max(this.pause, TUNE.markPause + TUNE.filePause);
    out.push(this.setSlip(s.n + 1, null));
    return out;
  }

  private miss(): RunEvent[] {
    const s = this.slip;
    s.outcome = "missed";
    this.streak = 0;
    this.stats.misses++;
    if (s.daily) {
      this.stats.dailyLines = 0;
      this.stats.dailyMarks = s.lines.map((l) => [...l.marks]);
    }
    this.clock = Math.max(0, this.clock - TUNE.missTime);
    this.pause = Math.max(this.pause, TUNE.markPause + TUNE.missPause);
    return [{ type: "miss", slip: s.n, ref: s, answer: s.answer, time: TUNE.missTime, daily: s.daily }, this.setSlip(s.n + 1, null)];
  }

  /** The pencil writes one right letter in its place: the first place not yet known, an empty one if it can. */
  private pencil(): RunEvent[] {
    if (this.pencils <= 0) return [{ type: "nopencil" }];
    const s = this.slip;
    let at = -1;
    const cur = this.current;
    for (let i = 0; i < LETTERS && at < 0; i++) if (s.known[i] === null && cur[i] === null) at = i;
    for (let i = 0; i < LETTERS && at < 0; i++) if (s.known[i] === null) at = i;
    if (at < 0) return [{ type: "nopencil" }];
    const letter = s.answer[at]!;
    s.known[at] = letter;
    s.pencilled[at] = true;
    s.found.add(letter);
    this.pencils--;
    this.stats.pencilsUsed++;
    return [{ type: "pencil", at, letter }];
  }

  /** The best mark each letter has on this slip so far (what the keyboard shows), pencilled places as rings. */
  keyBest(): Map<string, Mark> {
    const s = this.slip;
    const out = new Map<string, Mark>();
    for (const l of s.lines) {
      for (let i = 0; i < LETTERS; i++) {
        const c = l.word[i]!;
        const m = l.marks[i]!;
        const was = out.get(c);
        if (was === undefined || m > was) out.set(c, m);
      }
    }
    for (let i = 0; i < LETTERS; i++) if (s.pencilled[i]) out.set(s.known[i]!, RING);
    return out;
  }

  private addClock(s: number) {
    this.clock = Math.min(TUNE.clockMax, this.clock + s);
  }

  /** Advances the clock. A full line still waiting when it runs out is written at the bell. */
  step(dt: number): RunEvent[] {
    if (!this.live) return [];
    this.t += dt;
    this.stats.seconds = this.t;
    if (this.pause > 0) {
      this.pause -= dt;
      if (this.pause > 0) return [];
      dt = -this.pause;
      this.pause = 0;
    }
    if (this.clock <= 0) return this.end();
    this.clock -= dt * this.burn;
    if (this.clock > 0) return [];
    this.clock = 0;
    if (this.full && this.isWord(this.current.join("")) === true) {
      const out = this.write(true);
      if (this.clock > 0) return out;
      return [...out, ...this.end()];
    }
    return this.end();
  }

  private end(): RunEvent[] {
    this.over = true;
    this.clock = 0;
    return [{ type: "over", why: "time" }];
  }
}
