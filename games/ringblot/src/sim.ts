/**
 * Ringblot's rules, pure and deterministic. Beetles that walked through the ink share a sheet of paper. Each owns a
 * patch printed in its ink; off its patch a beetle leaves a wet line, and when the line comes home the press prints
 * everything the loop encloses. A wet line that anyone walks across is smudged: its beetle goes back to the start
 * of the line (the player) or off the sheet with its whole print (a rival). The ink is drying the whole time.
 *
 * The sheet is 15 × 26 squares and everything moves square to square. Time runs on fixed ticks (120 a second), so a
 * run plays out the same at 30, 60 or 120 frames a second.
 */
import { createRng, type Rng } from "@thumbcade-games/kit/rng";
import { Brain, RIVALS, type BrainSpec } from "./brain.ts";
import { beside, cellOf, COLS, DX, DY, N, opposite, ROWS, xOf, yOf } from "./grid.ts";

export { beside, cellOf, COLS, DX, DY, N, opposite, ROWS, xOf, yOf, type Dir } from "./grid.ts";

export const HZ = 120;
const H = 1 / HZ;
export const HERO = 1;
/** Squares a second. */
export const HERO_SPEED = 7.5;
/** A swipe waits this long for the beetle to reach the next square. */
export const BUFFER = 0.5;
/** A swipe this far (in squares) past the middle of a square still turns there. */
export const LATE_TURN = 0.34;
/** Seconds of wet ink: at the start, at most, and what a full sheet tops it up to. */
export const INK_START = 20;
export const INK_MAX = 26;
export const INK_LOW = 6;
/** Ink a printed square gives back (seconds), and the most one loop can give. */
export const INK_PER_SQUARE = 0.09;
export const INK_PER_LOOP = 5;
/** Ink for smudging a rival, and ink lost when the player's line is smudged. */
export const INK_SMUDGE = 3;
export const INK_SMUDGED = 4;
/** Loop sizes (squares printed at once) that pay ×2, ×3, ×4. */
export const PULLS = [10, 25, 50] as const;
export const SMUDGE_PTS = 100;
export const SHAVE_PTS = 30;
export const SHEET_PTS = 150;
/** Seconds the finished sheet is held up before the next one. */
export const PRINT_TIME = 1.5;
/** Seconds before a smudged rival crawls back onto the sheet. */
export const RESPAWN = 3.5;

export type Phase = "play" | "printed" | "over";

export interface Bug {
  /** 1 is the player; 2 and 3 are rivals. */
  id: number;
  cell: number;
  /** -1: standing still. */
  dir: number;
  /** 0-1 of the way to the next square. */
  t: number;
  speed: number;
  /** The wet line: squares off its own print, in the order walked. */
  line: number[];
  /** The square of its own print it last left (where a smudged player goes back to). */
  gate: number;
  /** False while a smudged rival is off the sheet. */
  on: boolean;
  /** Ticks until a smudged rival comes back. */
  timer: number;
  brain: Brain | null;
}

export type SimEvent =
  | { k: "turn"; late: boolean }
  | { k: "bonk"; dir: number }
  | { k: "out"; id: number; cell: number }
  | { k: "print"; id: number; squares: number; cells: number[]; from: number; stolen: number; pts: number; tier: number; ink: number; share: number }
  | { k: "shave"; pts: number; cell: number }
  | { k: "smudge"; id: number; by: number; cell: number; line: number[]; land: number[]; pts: number }
  | { k: "smudged"; by: number; cell: number; line: number[]; home: number }
  | { k: "crawl"; id: number; cell: number }
  | { k: "low" }
  | { k: "tick"; left: number }
  | { k: "sheet"; sheet: number; bonus: number; share: number; clean: boolean }
  | { k: "fresh"; sheet: number }
  | { k: "over"; cell: number };

export interface Stats {
  swipes: number;
  bonks: number;
  prints: number;
  squares: number;
  biggest: number;
  bestTier: number;
  /** Rivals smudged by the player. */
  smudges: number;
  /** Times the player's line was smudged by a rival, and by walking across it himself. */
  smudged: number;
  selfCuts: number;
  shaves: number;
  sheets: number;
  stolen: number;
  /** Ticks spent standing still during play. */
  stillTicks: number;
  /** Ticks with a wet line out, and the longest line. */
  lineTicks: number;
  longestLine: number;
}

/** The share of the sheet (0-1) the player must hold to finish it. */
export const goalFor = (sheet: number): number => Math.min(0.5, 0.15 + 0.05 * (sheet - 1));
/** Ink a finished sheet gives back (seconds): less each time. */
export const refillFor = (sheet: number): number => Math.max(5, 11 - sheet);
/** How fast the ink dries on a sheet (seconds of ink a second). */
export const dryFor = (sheet: number): number => 1 + 0.09 * (sheet - 1);
/** What a loop of `squares` pays a square. */
export const tierFor = (squares: number): number => 1 + PULLS.filter((p) => squares >= p).length;
export const rivalsOn = (sheet: number): number => (sheet <= 1 ? 1 : 2);
export const sheetSeed = (seed: number, sheet: number): number => (seed ^ Math.imul(sheet, 0x9e3779b1)) >>> 0;

export const posX = (b: Bug): number => xOf(b.cell) + (b.dir >= 0 ? DX[b.dir]! * b.t : 0);
export const posY = (b: Bug): number => yOf(b.cell) + (b.dir >= 0 ? DY[b.dir]! * b.t : 0);

const START = cellOf(7, ROWS - 4);
/** Where rivals set up: top middle on the first sheet, the top corners after. */
const RIVAL_SPOTS = [
  [cellOf(7, 4)],
  [cellOf(3, 4), cellOf(11, 5)],
];
/** Places a beetle can be put back on the sheet. */
const SPAWNS = [cellOf(3, 4), cellOf(11, 4), cellOf(7, 4), cellOf(2, 12), cellOf(12, 12), cellOf(3, 21), cellOf(11, 21), cellOf(7, 21), cellOf(7, 13)];

export class Sim {
  /** Whose print each square is (0: bare paper). */
  readonly owner = new Uint8Array(N);
  /** Whose wet line runs through each square (0: none). */
  readonly wet = new Uint8Array(N);
  /** Squares held by each beetle, by id. */
  readonly held = [0, 0, 0, 0];
  bugs: Bug[] = [];
  events: SimEvent[] = [];
  phase: Phase = "play";
  sheet = 1;
  score = 0;
  ink = INK_START;
  /** Ticks since the run began, and into the current phase. */
  tick = 0;
  pt = 0;
  /** True once the player's line has been smudged on this sheet. */
  smudgedHere = false;
  readonly stats: Stats = { swipes: 0, bonks: 0, prints: 0, squares: 0, biggest: 0, bestTier: 1, smudges: 0, smudged: 0, selfCuts: 0, shaves: 0, sheets: 0, stolen: 0, stillTicks: 0, lineTicks: 0, longestLine: 0 };

  private readonly seed: number;
  private rng: Rng;
  private acc = 0;
  private want = -1;
  private wantTicks = 0;
  private lowSaid = false;
  private readonly seen = new Uint8Array(N);
  private readonly queue = new Int16Array(N);

  constructor(o: { seed: number }) {
    this.seed = o.seed >>> 0;
    this.rng = createRng(sheetSeed(this.seed, 1));
    this.lay();
  }

  get t(): number {
    return this.tick / HZ;
  }
  get over(): boolean {
    return this.phase === "over";
  }
  get hero(): Bug {
    return this.bugs[0]!;
  }
  /** The player's share of the sheet, 0-1. */
  get share(): number {
    return this.held[HERO]! / N;
  }
  get goal(): number {
    return goalFor(this.sheet);
  }

  // -------------------------------------------------------------------------------------------------------------
  // Sheets
  // -------------------------------------------------------------------------------------------------------------

  /** A fresh sheet: the player's patch bottom middle, the rivals' at the top. */
  private lay(): void {
    this.owner.fill(0);
    this.wet.fill(0);
    this.held.fill(0);
    this.smudgedHere = false;
    this.want = -1;
    this.bugs = [{ id: HERO, cell: START, dir: -1, t: 0, speed: HERO_SPEED, line: [], gate: START, on: true, timer: 0, brain: null }];
    this.patch(HERO, START);
    const n = rivalsOn(this.sheet);
    const spots = RIVAL_SPOTS[n - 1]!;
    for (let i = 0; i < n; i++) {
      const spec: BrainSpec = RIVALS[Math.min(RIVALS.length - 1, this.sheet - 1 + i)]!;
      const id = 2 + i;
      this.bugs.push({ id, cell: spots[i]!, dir: -1, t: 0, speed: spec.speed, line: [], gate: spots[i]!, on: true, timer: 0, brain: new Brain(spec, createRng(sheetSeed(this.seed, this.sheet) ^ (id * 7919))) });
      this.patch(id, spots[i]!);
    }
  }

  /** Prints a 3 × 3 patch for `id` round `c` (over whatever was there). */
  private patch(id: number, c: number): void {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const x = xOf(c) + dx;
        const y = yOf(c) + dy;
        if (x < 0 || y < 0 || x >= COLS || y >= ROWS) continue;
        this.give(cellOf(x, y), id);
      }
    }
  }

  private give(c: number, id: number): void {
    const was = this.owner[c]!;
    if (was === id) return;
    if (was) this.held[was]!--;
    this.owner[c] = id;
    if (id) this.held[id]!++;
  }

  // -------------------------------------------------------------------------------------------------------------
  // The thumb
  // -------------------------------------------------------------------------------------------------------------

  /** A swipe: walk that way from the next square on (or at once, from a standstill or just past a square). */
  steer(d: number): void {
    if (this.phase !== "play") return;
    const h = this.hero;
    this.stats.swipes++;
    if (h.dir < 0) {
      if (this.canGo(h, d)) {
        h.dir = d;
        h.t = 0;
        this.want = -1;
        this.events.push({ k: "turn", late: false });
      } else {
        this.stats.bonks++;
        this.events.push({ k: "bonk", dir: d });
      }
      return;
    }
    if (d === h.dir) {
      this.want = -1;
      return;
    }
    if (d === opposite(h.dir)) {
      // Doubling back along a wet line would smudge it: ignored. On his own print he turns on the spot.
      if (h.line.length || this.wet[beside(h.cell, h.dir)] === HERO) {
        this.stats.bonks++;
        this.events.push({ k: "bonk", dir: d });
        return;
      }
      if (this.owner[beside(h.cell, h.dir)] !== HERO) {
        // Half way out of his print: step back in.
        h.dir = -1;
        h.t = 0;
        if (this.canGo(h, d)) h.dir = d;
        this.events.push({ k: "turn", late: false });
        return;
      }
      h.cell = beside(h.cell, h.dir);
      h.dir = d;
      h.t = 1 - h.t;
      this.want = -1;
      this.events.push({ k: "turn", late: false });
      return;
    }
    if (h.t <= LATE_TURN && this.canGo(h, d)) {
      h.dir = d;
      h.t = 0;
      this.want = -1;
      this.events.push({ k: "turn", late: true });
      return;
    }
    this.want = d;
    this.wantTicks = Math.round(BUFFER * HZ);
  }

  /** The player can set off from his square in direction `d`: on the sheet, and not onto his own wet line. */
  private canGo(b: Bug, d: number): boolean {
    const n = beside(b.cell, d);
    return n >= 0 && this.wet[n] !== b.id;
  }

  step(dt: number): void {
    this.acc += dt;
    // The hair's breadth keeps 1/30 s at exactly four ticks whatever the float rounding.
    while (this.acc >= H - 1e-9) {
      this.acc -= H;
      this.tickOnce();
    }
  }

  private tickOnce(): void {
    if (this.phase === "over") return;
    this.tick++;
    this.pt++;
    if (this.phase === "printed") {
      if (this.pt >= PRINT_TIME * HZ) {
        this.sheet++;
        this.rng = createRng(sheetSeed(this.seed, this.sheet));
        this.lay();
        this.phase = "play";
        this.pt = 0;
        this.events.push({ k: "fresh", sheet: this.sheet });
      }
      return;
    }
    // The ink dries.
    const before = this.ink;
    this.ink -= dryFor(this.sheet) * H;
    if (this.ink <= INK_LOW && !this.lowSaid) {
      this.lowSaid = true;
      this.events.push({ k: "low" });
    } else if (this.ink > INK_LOW + 2) this.lowSaid = false;
    if (Math.ceil(this.ink) < INK_LOW && Math.ceil(this.ink) < Math.ceil(before) && this.ink > 0) this.events.push({ k: "tick", left: Math.ceil(this.ink) });
    if (this.ink <= 0) {
      this.ink = 0;
      this.phase = "over";
      this.pt = 0;
      this.events.push({ k: "over", cell: this.hero.cell });
      return;
    }
    if (this.want >= 0 && --this.wantTicks <= 0) this.want = -1;
    const h = this.hero;
    if (h.dir < 0) this.stats.stillTicks++;
    if (h.line.length) this.stats.lineTicks++;
    for (const b of this.bugs) {
      if (this.phase !== "play") break;
      this.move(b);
    }
  }

  // -------------------------------------------------------------------------------------------------------------
  // Walking
  // -------------------------------------------------------------------------------------------------------------

  private move(b: Bug): void {
    if (!b.on) {
      if (--b.timer <= 0) this.crawlBack(b);
      return;
    }
    if (b.dir < 0) {
      if (b.brain) b.dir = b.brain.choose(this, b);
      else if (this.want >= 0 && this.canGo(b, this.want)) {
        b.dir = this.want;
        this.want = -1;
      }
      if (b.dir < 0) return;
    }
    b.t += b.speed * H;
    while (b.t >= 1 && b.dir >= 0 && b.on && this.phase === "play") {
      const from = b.cell;
      b.cell = beside(b.cell, b.dir);
      b.t -= 1;
      this.arrive(b, from);
      if (!b.on || this.phase !== "play") return;
      if (b.brain) b.dir = b.brain.choose(this, b);
      else {
        if (b.dir < 0) return;
        if (this.want >= 0 && this.want !== opposite(b.dir) && this.canGo(b, this.want)) {
          b.dir = this.want;
          this.want = -1;
          this.events.push({ k: "turn", late: false });
        } else if (!this.canGo(b, b.dir)) {
          // The edge of the sheet, or his own wet line: he stops and waits for a swipe.
          if (beside(b.cell, b.dir) >= 0) this.events.push({ k: "bonk", dir: b.dir });
          b.dir = -1;
          b.t = 0;
        }
      }
      if (b.dir < 0) b.t = 0;
    }
  }

  /** A beetle steps onto a square. */
  private arrive(b: Bug, from: number): void {
    const c = b.cell;
    const line = this.wet[c]!;
    if (line && (line === HERO || b.id === HERO)) {
      // The player on a rival's wet line, or a rival on his: smudged. (Rivals step over each other's lines.)
      const victim = this.bugs[line - 1]!;
      this.smudge(victim, b);
      if (victim === b || !b.on) return;
    }
    if (this.owner[c] === b.id) {
      if (b.line.length) this.print(b);
      b.gate = c;
      return;
    }
    if (!b.line.length) {
      b.gate = from;
      this.events.push({ k: "out", id: b.id, cell: c });
    }
    // Where two rivals' lines cross, the square keeps the first one's mark.
    if (!this.wet[c] || b.id === HERO) this.wet[c] = b.id;
    b.line.push(c);
    if (b.id !== HERO) return;
    this.stats.longestLine = Math.max(this.stats.longestLine, b.line.length);
    // Walled in by his own line, with no way back to his print that doesn't cross it: the line is lost.
    if (!this.wayHome(b)) this.smudge(b, b);
  }

  /** True if the player can still reach his own print without stepping on his own wet line. */
  private wayHome(b: Bug): boolean {
    const seen = this.seen;
    const q = this.queue;
    seen.fill(0);
    let head = 0;
    let tail = 0;
    seen[b.cell] = 1;
    q[tail++] = b.cell;
    while (head < tail) {
      const c = q[head++]!;
      for (let d = 0; d < 4; d++) {
        const n = beside(c, d);
        if (n < 0 || seen[n] || this.wet[n] === b.id) continue;
        if (this.owner[n] === b.id) return true;
        seen[n] = 1;
        q[tail++] = n;
      }
    }
    return false;
  }

  /** The line came home: everything it encloses is printed. */
  private print(b: Bug): void {
    const cells: number[] = [];
    // A close shave: a rival was right on the line as it closed.
    let shave = false;
    if (b.id === HERO) {
      for (const r of this.bugs) {
        if (r === b || !r.on) continue;
        const rc = r.dir >= 0 && r.t > 0.5 ? beside(r.cell, r.dir) : r.cell;
        for (const c of b.line) if (Math.abs(xOf(c) - xOf(rc)) + Math.abs(yOf(c) - yOf(rc)) <= 1) shave = true;
      }
    }
    for (const c of b.line) {
      if (this.wet[c] === b.id) this.wet[c] = 0;
      if (this.owner[c] !== b.id) cells.push(c);
    }
    let stolen = 0;
    for (const c of b.line) {
      if (this.owner[c] && this.owner[c] !== b.id) stolen++;
      this.give(c, b.id);
    }
    b.line = [];
    this.remark();
    // Flood the bare paper from the edge of the sheet: what the flood can't reach is inside the loop.
    const seen = this.seen;
    const q = this.queue;
    seen.fill(0);
    let head = 0;
    let tail = 0;
    const push = (c: number) => {
      if (seen[c] || this.owner[c] === b.id) return;
      seen[c] = 1;
      q[tail++] = c;
    };
    for (let x = 0; x < COLS; x++) {
      push(cellOf(x, 0));
      push(cellOf(x, ROWS - 1));
    }
    for (let y = 0; y < ROWS; y++) {
      push(cellOf(0, y));
      push(cellOf(COLS - 1, y));
    }
    while (head < tail) {
      const c = q[head++]!;
      for (let d = 0; d < 4; d++) {
        const n = beside(c, d);
        if (n >= 0) push(n);
      }
    }
    for (let c = 0; c < N; c++) {
      if (seen[c] || this.owner[c] === b.id) continue;
      if (this.owner[c]) stolen++;
      this.give(c, b.id);
      cells.push(c);
    }
    if (b.id !== HERO) {
      this.events.push({ k: "print", id: b.id, squares: cells.length, cells, from: b.cell, stolen, pts: 0, tier: 1, ink: 0, share: this.share });
      return;
    }
    const squares = cells.length;
    const tier = tierFor(squares);
    const pts = squares * tier;
    const ink = Math.min(INK_PER_LOOP, squares * INK_PER_SQUARE);
    this.score += pts;
    this.ink = Math.min(INK_MAX, this.ink + ink);
    const s = this.stats;
    s.prints++;
    s.squares += squares;
    s.stolen += stolen;
    s.biggest = Math.max(s.biggest, squares);
    s.bestTier = Math.max(s.bestTier, tier);
    this.events.push({ k: "print", id: HERO, squares, cells, from: b.cell, stolen, pts, tier, ink, share: this.share });
    if (shave) {
      this.score += SHAVE_PTS;
      s.shaves++;
      this.events.push({ k: "shave", pts: SHAVE_PTS, cell: b.cell });
    }
    if (this.share >= this.goal) this.finishSheet();
  }

  private finishSheet(): void {
    const bonus = SHEET_PTS * this.sheet;
    this.score += bonus;
    this.stats.sheets++;
    this.ink = Math.min(INK_MAX, this.ink + refillFor(this.sheet));
    this.wet.fill(0);
    for (const b of this.bugs) {
      b.line = [];
      b.dir = -1;
      b.t = 0;
    }
    this.phase = "printed";
    this.pt = 0;
    this.events.push({ k: "sheet", sheet: this.sheet, bonus, share: this.share, clean: !this.smudgedHere });
  }

  /** A line that ran under one that has just gone shows again. */
  private remark(): void {
    for (const o of this.bugs) for (const c of o.line) if (!this.wet[c]) this.wet[c] = o.id;
  }

  /** `by` walked across `victim`'s wet line. */
  private smudge(victim: Bug, by: Bug): void {
    const line = victim.line;
    for (const c of line) if (this.wet[c] === victim.id) this.wet[c] = 0;
    victim.line = [];
    this.remark();
    const at = by.cell;
    if (victim.id === HERO) {
      const self = by === victim;
      if (self) this.stats.selfCuts++;
      else this.stats.smudged++;
      this.smudgedHere = true;
      this.ink = Math.max(0.01, this.ink - INK_SMUDGED);
      this.want = -1;
      // Back to where the line left his print; if that has been printed over, to what he still holds, or a new patch.
      let home = victim.gate;
      if (this.owner[home] !== HERO) {
        home = -1;
        let best = 1e9;
        for (let c = 0; c < N; c++) {
          if (this.owner[c] !== HERO) continue;
          const d = Math.abs(xOf(c) - xOf(victim.gate)) + Math.abs(yOf(c) - yOf(victim.gate));
          if (d < best) {
            best = d;
            home = c;
          }
        }
        if (home < 0) {
          home = this.spawnSpot(HERO);
          this.patch(HERO, home);
        }
      }
      victim.cell = home;
      victim.gate = home;
      victim.dir = -1;
      victim.t = 0;
      this.events.push({ k: "smudged", by: self ? 0 : by.id, cell: at, line, home });
      return;
    }
    // A rival: off the sheet, and its whole print with it.
    const land: number[] = [];
    for (let c = 0; c < N; c++) {
      if (this.owner[c] === victim.id) {
        land.push(c);
        this.give(c, 0);
      }
    }
    victim.on = false;
    victim.dir = -1;
    victim.t = 0;
    victim.timer = Math.round(RESPAWN * HZ);
    let pts = 0;
    if (by.id === HERO) {
      pts = SMUDGE_PTS * this.sheet;
      this.score += pts;
      this.ink = Math.min(INK_MAX, this.ink + INK_SMUDGE);
      this.stats.smudges++;
    }
    this.events.push({ k: "smudge", id: victim.id, by: by.id, cell: at, line, land, pts });
  }

  /** The emptiest corner of the sheet for a beetle to start again: far from the others, no wet lines. */
  private spawnSpot(id: number): number {
    let best = SPAWNS[0]!;
    let bestV = -1e9;
    for (const s of SPAWNS) {
      let v = this.rng() * 0.5;
      let far = 99;
      for (const o of this.bugs) {
        if (o.id === id || !o.on) continue;
        far = Math.min(far, Math.abs(xOf(o.cell) - xOf(s)) + Math.abs(yOf(o.cell) - yOf(s)));
      }
      v += Math.min(far, 12);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const c = cellOf(xOf(s) + dx, yOf(s) + dy);
          if (this.wet[c]) v -= 50;
          if (this.owner[c] && this.owner[c] !== id) v -= this.owner[c] === HERO ? 3 : 1;
        }
      }
      if (v > bestV) {
        bestV = v;
        best = s;
      }
    }
    return best;
  }

  private crawlBack(b: Bug): void {
    const s = this.spawnSpot(b.id);
    b.cell = s;
    b.gate = s;
    b.dir = -1;
    b.t = 0;
    b.on = true;
    b.brain?.reset();
    this.patch(b.id, s);
    this.events.push({ k: "crawl", id: b.id, cell: s });
  }
}
