/**
 * Scribbledelve's rules, pure and deterministic. My stick knight runs the corridors of a dungeon I mapped on squared
 * paper, picking up a coin in every square; scribbles crawl out of holes at the edge and hunt him, each in its own
 * way; a sword turns the tables for a few seconds. Clear a floor and the next one is drawn, a little meaner.
 *
 * Everything moves from square to square through the gaps. Time runs on fixed ticks (120 a second), so a run plays
 * out the same at 30, 60 or 120 frames a second. Positions are in squares (x right, y down).
 */
import { createRng, type Rng } from "@thumbcade-games/kit/rng";
import { beside, distances, DX, DY, generate, isOpen, N, opposite, xOf, yOf, type Maze } from "./maze.ts";

export const HZ = 120;
const H = 1 / HZ;
export const HEARTS = 3;
/** Squares a second. */
export const HERO_SPEED = 6.5;
export const BRAVE_SPEED = 7.2;
/** A swipe waits this long for the next gap before it is forgotten. */
export const BUFFER = 1.2;
/** A swipe this far (in squares) past a gap still takes it. */
export const LATE_TURN = 0.36;
/** The knight picks a coin up this far (in squares) before he reaches the middle of its square. */
export const REACH = 0.4;
/** Closer than this and a scribble has him (or he has it). */
export const TOUCH = 0.6;
/** Coins closer together than this (seconds) keep the streak going. */
export const STREAK_GAP = 0.9;
/** Coins in a row for ×2, ×3, ×4. */
export const STREAK_TIERS = [12, 28, 48] as const;
export const COIN = 10;
export const POOF = 200;
export const SHAVE = 50;
export const OUCH_TIME = 1.0;
export const CLEAR_TIME = 1.5;
export const GONE_TIME = 3;
export const DRAW_TIME = 1.2;
export const STAR_TIME = 8;
const NEAR = 1.0;
const AWAY = 1.8;

export const NOTHING = 0;
export const COIN_HERE = 1;
export const SWORD_HERE = 2;

/** 0 Grumble hunts, 1 Sneak cuts him off, 2 Dither wanders until it sees him, 3 Lurk sits on the far coins. */
export type MonsterKind = 0 | 1 | 2 | 3;
export type MonsterState = "drawing" | "hunt" | "scared" | "gone";
export type Phase = "play" | "ouch" | "clear" | "over";

export interface Mover {
  /** The square being left (or stood on). */
  cell: number;
  /** -1: standing still. */
  dir: number;
  /** 0-1 of the way to the next square. */
  t: number;
}

export interface Hero extends Mover {
  want: number;
  wantTicks: number;
  /** Ticks of being untouchable (after a floor starts or a heart is lost). */
  inv: number;
  /** Ticks of sword left. */
  brave: number;
  /** The way he last faced. */
  face: number;
}

export interface Monster extends Mover {
  id: number;
  kind: MonsterKind;
  state: MonsterState;
  /** Ticks left in "drawing" or "gone". */
  timer: number;
  hole: number;
  /** True once it has been within a square of the knight (a close shave pays when it falls behind again). */
  near: boolean;
}

export type SimEvent =
  | { k: "coin"; cell: number; pts: number; streak: number; mult: number; left: number }
  | { k: "tier"; mult: number }
  | { k: "streakLost"; mult: number; streak: number }
  | { k: "sword"; cell: number; seconds: number }
  | { k: "braveEnd" }
  | { k: "poof"; x: number; y: number; pts: number; n: number; kind: MonsterKind }
  | { k: "shave"; x: number; y: number; pts: number }
  | { k: "caught"; x: number; y: number; hearts: number; kind: MonsterKind }
  | { k: "respawn" }
  | { k: "crawl"; id: number; kind: MonsterKind; cell: number }
  | { k: "star"; cell: number }
  | { k: "starGot"; cell: number; pts: number }
  | { k: "starGone"; cell: number }
  | { k: "turn"; late: boolean }
  | { k: "bump"; dir: number }
  | { k: "clear"; floor: number; bonus: number; heart: boolean }
  | { k: "floor"; floor: number }
  | { k: "over"; x: number; y: number };

export interface Stats {
  coins: number;
  poofs: number;
  swords: number;
  /** Swords that ran out without a single poof. */
  swordsWasted: number;
  shaves: number;
  stars: number;
  floors: number;
  maxStreak: number;
  maxMult: number;
  swipes: number;
  bumps: number;
  /** Hearts lost to each kind of scribble. */
  caughtBy: [number, number, number, number];
}

export const monstersOn = (floor: number): number => (floor <= 1 ? 2 : floor <= 3 ? 3 : 4);
export const monsterSpeed = (floor: number): number => Math.min(6.6, 3.3 + 0.45 * (floor - 1));
export const braveSeconds = (floor: number): number => Math.max(2.6, 5.6 - 0.4 * (floor - 1));
/** How often a scribble takes a turn at random instead of the one it wants. */
export const wobble = (floor: number): number => Math.max(0.06, 0.3 - 0.05 * (floor - 1));
export const multFor = (streak: number): number => 1 + STREAK_TIERS.filter((t) => streak >= t).length;
export const floorSeed = (seed: number, floor: number): number => (seed ^ Math.imul(floor, 0x9e3779b1)) >>> 0;

export const posX = (m: Mover): number => xOf(m.cell) + (m.dir >= 0 ? DX[m.dir]! * m.t : 0);
export const posY = (m: Mover): number => yOf(m.cell) + (m.dir >= 0 ? DY[m.dir]! * m.t : 0);

export class Sim {
  maze: Maze;
  /** What lies in each square: NOTHING, COIN_HERE or SWORD_HERE. */
  readonly things = new Uint8Array(N);
  /** Squares the knight has run through this floor (for the pencil trail). */
  readonly walked = new Uint8Array(N * 4);
  hero: Hero;
  monsters: Monster[] = [];
  events: SimEvent[] = [];
  phase: Phase = "play";
  floor = 1;
  hearts = HEARTS;
  score = 0;
  coinsLeft = 0;
  coinsTotal = 0;
  streak = 0;
  /** Scribbles poofed with the sword in hand right now. */
  poofs = 0;
  /** The gold star: its square (-1: none) and the ticks it has left. */
  star = -1;
  starTicks = 0;
  /** Ticks since the run began, and into the current phase. */
  tick = 0;
  pt = 0;
  readonly stats: Stats = { coins: 0, poofs: 0, swords: 0, swordsWasted: 0, shaves: 0, stars: 0, floors: 0, maxStreak: 0, maxMult: 1, swipes: 0, bumps: 0, caughtBy: [0, 0, 0, 0] };

  private readonly seed: number;
  private readonly rng: Rng;
  private acc = 0;
  private lastCoin = -9999;
  private starDone = false;
  private nextId = 1;
  private readonly field = new Int16Array(N);
  private readonly heroField = new Int16Array(N);

  constructor(o: { seed: number }) {
    this.seed = o.seed >>> 0;
    this.rng = createRng(this.seed ^ 0x5c21bb1e);
    this.maze = generate(floorSeed(this.seed, 1));
    this.hero = { cell: this.maze.start, dir: -1, t: 0, want: -1, wantTicks: 0, inv: 0, brave: 0, face: 0 };
    this.drawFloor();
  }

  get t(): number {
    return this.tick / HZ;
  }
  get over(): boolean {
    return this.phase === "over";
  }
  get mult(): number {
    return multFor(this.streak);
  }
  /** 0-1: how much of the gap is left before the coin streak ends. */
  get streakFrac(): number {
    if (this.streak <= 0) return 0;
    return Math.max(0, 1 - (this.tick - this.lastCoin) / (STREAK_GAP * HZ));
  }
  get braveFrac(): number {
    return this.hero.brave / (braveSeconds(this.floor) * HZ);
  }
  get heroX(): number {
    return posX(this.hero);
  }
  get heroY(): number {
    return posY(this.hero);
  }

  // -------------------------------------------------------------------------------------------------------------
  // Floors
  // -------------------------------------------------------------------------------------------------------------

  private drawFloor(): void {
    const m = this.maze;
    this.things.fill(COIN_HERE);
    this.things[m.start] = NOTHING;
    for (const h of m.holes) this.things[h] = NOTHING;
    for (const s of m.swords) this.things[s] = SWORD_HERE;
    this.coinsTotal = this.coinsLeft = this.things.reduce((a, v) => a + (v === COIN_HERE ? 1 : 0), 0);
    this.walked.fill(0);
    this.star = -1;
    this.starDone = false;
    this.poofs = 0;
    this.monsters = [];
    const n = monstersOn(this.floor);
    // Which scribbles come: the hunter always, then the others in an order that changes floor by floor.
    const kinds: MonsterKind[] = [0, ...(this.floor % 2 ? [2, 1, 3] : [1, 3, 2])] as MonsterKind[];
    for (let i = 0; i < n; i++) {
      this.monsters.push({ id: this.nextId++, kind: kinds[i]!, state: "drawing", timer: 0, hole: m.holes[i % m.holes.length]!, cell: 0, dir: -1, t: 0, near: false });
    }
    this.placeAll(this.floor === 1 ? 3 : 1.4);
  }

  /** Knight to the start, scribbles back down their holes to be drawn again, one after another. */
  private placeAll(firstDelay: number): void {
    const h = this.hero;
    h.cell = this.maze.start;
    h.dir = -1;
    h.t = 0;
    h.want = -1;
    h.brave = 0;
    h.face = 0;
    this.monsters.forEach((mo, i) => {
      mo.cell = mo.hole;
      mo.dir = -1;
      mo.t = 0;
      mo.state = "drawing";
      mo.timer = Math.round((firstDelay + i * 1.4) * HZ);
      mo.near = false;
    });
  }

  // -------------------------------------------------------------------------------------------------------------
  // The thumb
  // -------------------------------------------------------------------------------------------------------------

  /** A swipe: run that way now, or at the next gap. */
  steer(d: number): void {
    if (this.phase !== "play") return;
    const h = this.hero;
    this.stats.swipes++;
    if (h.dir < 0) {
      if (isOpen(this.maze, h.cell, d)) {
        h.dir = d;
        h.face = d;
        h.t = 0;
        h.want = -1;
        this.events.push({ k: "turn", late: false });
      } else {
        this.stats.bumps++;
        h.face = d;
        this.events.push({ k: "bump", dir: d });
      }
      return;
    }
    if (d === h.dir) {
      h.want = -1;
      return;
    }
    if (d === opposite(h.dir)) {
      // Doubling back happens on the spot.
      h.cell = beside(h.cell, h.dir);
      h.dir = d;
      h.face = d;
      h.t = 1 - h.t;
      h.want = -1;
      this.events.push({ k: "turn", late: false });
      return;
    }
    if (h.t <= LATE_TURN && isOpen(this.maze, h.cell, d)) {
      // Just past the gap: take it anyway.
      h.dir = d;
      h.face = d;
      h.t = 0;
      h.want = -1;
      this.events.push({ k: "turn", late: true });
      return;
    }
    h.want = d;
    h.wantTicks = Math.round(BUFFER * HZ);
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
    switch (this.phase) {
      case "play":
        this.playTick();
        break;
      case "ouch":
        if (this.pt >= OUCH_TIME * HZ) {
          if (this.hearts <= 0) {
            this.phase = "over";
            this.pt = 0;
            this.events.push({ k: "over", x: this.heroX, y: this.heroY });
          } else {
            this.placeAll(1.6);
            this.hero.inv = Math.round(2 * HZ);
            this.phase = "play";
            this.pt = 0;
            this.events.push({ k: "respawn" });
          }
        }
        break;
      case "clear":
        if (this.pt >= CLEAR_TIME * HZ) {
          this.floor++;
          this.maze = generate(floorSeed(this.seed, this.floor));
          this.drawFloor();
          this.hero.inv = Math.round(1 * HZ);
          this.phase = "play";
          this.pt = 0;
          this.events.push({ k: "floor", floor: this.floor });
        }
        break;
    }
  }

  private playTick(): void {
    const h = this.hero;
    if (h.inv > 0) h.inv--;
    if (h.want >= 0 && --h.wantTicks <= 0) h.want = -1;
    if (this.streak > 0 && this.tick - this.lastCoin > STREAK_GAP * HZ) {
      const lost = this.mult;
      this.events.push({ k: "streakLost", mult: lost, streak: this.streak });
      this.streak = 0;
    }
    if (h.brave > 0 && --h.brave === 0) {
      if (this.poofs === 0) this.stats.swordsWasted++;
      for (const m of this.monsters) if (m.state === "scared") m.state = "hunt";
      this.events.push({ k: "braveEnd" });
    }
    if (this.star >= 0 && --this.starTicks <= 0) {
      this.events.push({ k: "starGone", cell: this.star });
      this.star = -1;
    }
    this.moveHero();
    if (this.phase !== "play") return;
    for (const m of this.monsters) this.moveMonster(m);
    this.meet();
  }

  // -------------------------------------------------------------------------------------------------------------
  // The knight
  // -------------------------------------------------------------------------------------------------------------

  private moveHero(): void {
    const h = this.hero;
    const m = this.maze;
    if (h.dir < 0) {
      if (h.want >= 0 && isOpen(m, h.cell, h.want)) {
        h.dir = h.want;
        h.face = h.dir;
        h.want = -1;
      } else return;
    }
    h.t += (h.brave > 0 ? BRAVE_SPEED : HERO_SPEED) * H;
    if (h.t >= 1 - REACH) this.pickUp(beside(h.cell, h.dir));
    while (h.t >= 1 && h.dir >= 0) {
      this.walked[h.cell * 4 + h.dir] = 1;
      h.cell = beside(h.cell, h.dir);
      this.walked[h.cell * 4 + opposite(h.dir)] = 1;
      h.t -= 1;
      this.pickUp(h.cell);
      if (this.phase !== "play") {
        h.t = 0;
        h.dir = -1;
        return;
      }
      if (h.want >= 0 && isOpen(m, h.cell, h.want)) {
        h.dir = h.want;
        h.face = h.dir;
        h.want = -1;
        this.events.push({ k: "turn", late: false });
      } else if (!isOpen(m, h.cell, h.dir)) {
        h.dir = -1;
        h.t = 0;
      }
    }
  }

  private pickUp(c: number): void {
    const what = this.things[c];
    if (what === COIN_HERE) {
      this.things[c] = NOTHING;
      this.coinsLeft--;
      const before = this.mult;
      this.streak++;
      this.lastCoin = this.tick;
      const mult = this.mult;
      const pts = COIN * mult;
      this.score += pts;
      this.stats.coins++;
      this.stats.maxStreak = Math.max(this.stats.maxStreak, this.streak);
      this.stats.maxMult = Math.max(this.stats.maxMult, mult);
      this.events.push({ k: "coin", cell: c, pts, streak: this.streak, mult, left: this.coinsLeft });
      if (mult > before) this.events.push({ k: "tier", mult });
      if (!this.starDone && this.coinsLeft <= this.coinsTotal / 2 && this.coinsLeft > 6) this.dropStar();
      if (this.coinsLeft === 0) this.clearFloor();
    } else if (what === SWORD_HERE) {
      this.things[c] = NOTHING;
      const h = this.hero;
      if (h.brave > 0 && this.poofs === 0) this.stats.swordsWasted++;
      h.brave = Math.round(braveSeconds(this.floor) * HZ);
      this.poofs = 0;
      this.stats.swords++;
      for (const m of this.monsters) {
        if (m.state !== "hunt") continue;
        m.state = "scared";
        // Turn tail on the spot.
        if (m.dir >= 0) {
          m.cell = beside(m.cell, m.dir);
          m.dir = opposite(m.dir);
          m.t = 1 - m.t;
        }
      }
      this.events.push({ k: "sword", cell: c, seconds: braveSeconds(this.floor) });
    }
    if (c === this.star) {
      const pts = 250 + 50 * this.floor;
      this.score += pts;
      this.stats.stars++;
      this.events.push({ k: "starGot", cell: c, pts });
      this.star = -1;
    }
  }

  private dropStar(): void {
    this.starDone = true;
    const from = distances(this.maze, this.hero.cell, this.heroField);
    const spots: number[] = [];
    for (let c = 0; c < N; c++) if (this.things[c] === NOTHING && from[c]! >= 5 && !this.maze.holes.includes(c) && c !== this.maze.start) spots.push(c);
    if (!spots.length) return;
    this.star = this.rng.pick(spots);
    this.starTicks = Math.round(STAR_TIME * HZ);
    this.events.push({ k: "star", cell: this.star });
  }

  private clearFloor(): void {
    const bonus = 200 * this.floor;
    this.score += bonus;
    this.stats.floors++;
    const heart = this.floor % 2 === 0 && this.hearts < HEARTS;
    if (heart) this.hearts++;
    if (this.hero.brave > 0 && this.poofs === 0) this.stats.swordsWasted++;
    this.hero.brave = 0;
    this.star = -1;
    for (const m of this.monsters) m.state = "gone";
    this.phase = "clear";
    this.pt = 0;
    this.events.push({ k: "clear", floor: this.floor, bonus, heart });
  }

  // -------------------------------------------------------------------------------------------------------------
  // The scribbles
  // -------------------------------------------------------------------------------------------------------------

  private moveMonster(m: Monster): void {
    if (m.state === "gone" || m.state === "drawing") {
      if (--m.timer > 0) return;
      if (m.state === "gone") {
        m.cell = m.hole;
        m.dir = -1;
        m.t = 0;
        m.state = "drawing";
        m.timer = Math.round(DRAW_TIME * HZ);
        return;
      }
      m.state = this.hero.brave > 0 ? "scared" : "hunt";
      m.near = false;
      this.events.push({ k: "crawl", id: m.id, kind: m.kind, cell: m.cell });
    }
    if (m.dir < 0) {
      m.dir = this.choose(m, -1);
      // Walled in on every side (never on a real floor): it stays put.
      if (m.dir < 0) return;
    }
    const speed = monsterSpeed(this.floor) * (m.state === "scared" ? 0.6 : m.kind === 3 ? 0.9 : 1);
    m.t += speed * H;
    while (m.t >= 1) {
      m.cell = beside(m.cell, m.dir);
      m.t -= 1;
      m.dir = this.choose(m, opposite(m.dir));
    }
  }

  /** The way a scribble goes from its square: never back the way it came unless that is the only gap. */
  private choose(m: Monster, back: number): number {
    const maze = this.maze;
    const ways: number[] = [];
    for (let d = 0; d < 4; d++) if (d !== back && isOpen(maze, m.cell, d)) ways.push(d);
    if (!ways.length) return back;
    if (ways.length === 1) return ways[0]!;
    const h = this.hero;
    if (m.state === "scared") {
      // Away from the knight: the gap that leads farthest from him.
      const f = distances(maze, h.dir >= 0 && h.t > 0.5 ? beside(h.cell, h.dir) : h.cell, this.field);
      let best = ways[0]!;
      for (const d of ways) if (f[beside(m.cell, d)]! > f[beside(m.cell, best)]!) best = d;
      return best;
    }
    if (this.rng.chance(wobble(this.floor))) return this.rng.pick(ways);
    const heroCell = h.dir >= 0 && h.t > 0.5 ? beside(h.cell, h.dir) : h.cell;
    let target = heroCell;
    switch (m.kind) {
      case 1: {
        // Sneak: where the knight will be three squares on.
        let c = heroCell;
        const d = h.dir >= 0 ? h.dir : h.face;
        for (let i = 0; i < 3 && isOpen(maze, c, d); i++) c = beside(c, d);
        target = c;
        break;
      }
      case 2: {
        // Dither: wanders, unless the knight is in plain sight down a corridor.
        if (!this.sees(m.cell, heroCell)) return this.rng.pick(ways);
        break;
      }
      case 3: {
        // Lurk: sits on the coin farthest from the knight, and only gives chase when he comes near.
        const f = distances(maze, heroCell, this.heroField);
        if (f[m.cell]! > 4) {
          let far = -1;
          for (let c = 0; c < N; c++) if (this.things[c] === COIN_HERE && (far < 0 || f[c]! > f[far]!)) far = c;
          if (far >= 0 && far !== m.cell) target = far;
        }
        break;
      }
    }
    const f = distances(maze, target, this.field);
    let best = ways[0]!;
    for (const d of ways) if (f[beside(m.cell, d)]! < f[beside(m.cell, best)]!) best = d;
    return best;
  }

  /** True when `to` is straight down an open corridor from `from`. */
  private sees(from: number, to: number): boolean {
    if (from === to) return true;
    const sameRow = yOf(from) === yOf(to);
    const sameCol = xOf(from) === xOf(to);
    if (!sameRow && !sameCol) return false;
    const d = sameRow ? (xOf(to) > xOf(from) ? 1 : 3) : yOf(to) > yOf(from) ? 2 : 0;
    for (let c = from; c !== to; c = beside(c, d)) if (!isOpen(this.maze, c, d)) return false;
    return true;
  }

  /** Knight meets scribble. */
  private meet(): void {
    const h = this.hero;
    const hx = this.heroX;
    const hy = this.heroY;
    for (const m of this.monsters) {
      if (m.state !== "hunt" && m.state !== "scared") continue;
      const mx = posX(m);
      const my = posY(m);
      const d = Math.hypot(mx - hx, my - hy);
      if (m.state === "scared") {
        if (d < TOUCH) {
          this.poofs++;
          const pts = POOF * 2 ** (this.poofs - 1);
          this.score += pts;
          this.stats.poofs++;
          m.state = "gone";
          m.timer = Math.round(GONE_TIME * HZ);
          this.events.push({ k: "poof", x: mx, y: my, pts, n: this.poofs, kind: m.kind });
        }
        continue;
      }
      if (h.inv > 0) continue;
      if (d < TOUCH) {
        this.hearts--;
        this.stats.caughtBy[m.kind]++;
        if (this.streak > 0) {
          this.events.push({ k: "streakLost", mult: this.mult, streak: this.streak });
          this.streak = 0;
        }
        this.phase = "ouch";
        this.pt = 0;
        this.events.push({ k: "caught", x: hx, y: hy, hearts: this.hearts, kind: m.kind });
        return;
      }
      if (d < NEAR) m.near = true;
      else if (m.near && d > AWAY) {
        m.near = false;
        this.score += SHAVE;
        this.stats.shaves++;
        this.events.push({ k: "shave", x: hx, y: hy, pts: SHAVE });
      }
    }
  }
}
