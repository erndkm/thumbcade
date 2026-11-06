/**
 * Brains for the mallets: the critters on the far side, and the pilot that plays the cat in attract mode, in QA
 * autoplay builds and in the headless run-length tests. Both are the same controller with different limits.
 *
 * Human-like limits: a brain only sees the puck as it was `reaction` seconds ago, looks again every `look` seconds,
 * misjudges speed and direction a little, aims with an error, moves its mallet with a capped speed (and acceleration),
 * and now and then has a lapse. It plans in its own frame, where it defends y = 0 and attacks y = L.
 */
import type { Rng } from "@thumbcade-games/kit/rng";
import { crossAt, GOAL, L, MALLET_R, PUCK_R, reflectX, W, type Side, type Table } from "./physics.ts";

export interface Brain {
  name: string;
  /** Seconds of perception delay. */
  reaction: number;
  /** Seconds between looks. */
  look: number;
  /** Mallet speed (px/s) and acceleration (px/s², Infinity for a thumb). */
  speed: number;
  accel: number;
  /** Aim error, radians (uniform ±). */
  aim: number;
  /** Misjudged puck speed and heading (fraction / radians, uniform ±). */
  read: number;
  /** Guard line: distance from its own goal line it waits on (px). */
  home: number;
  /** How far out it will go to strike, from its own goal line (px). Past this it only blocks. */
  reach: number;
  /** 0-1: when the puck is loose in its half, the chance it goes for a shot rather than staying in front of goal. */
  aggression: number;
  /** 0-1: chance a shot is aimed off a side board. */
  bank: number;
  /** Mallet speed when it swings through the puck (px/s): the shot's power. */
  shot: number;
  /** 0-1: how far it follows through. */
  power: number;
  /** Chance per look of a lapse (it keeps doing what it was doing for a moment). */
  lapse: number;
  /** How much of its guard position follows the puck sideways (0 = stays central, 1 = shadows it). */
  shadow: number;
}

/** The five critters of the pond, in the order you meet them. */
export interface Critter {
  id: "frog" | "hedgehog" | "owl" | "fox" | "raccoon";
  label: string;
  /** One-line personality, shown when it skates in. */
  quip: string;
  style: "aggressive" | "defensive" | "trickster";
  brain: Brain;
}

export const CRITTERS: readonly Critter[] = [
  {
    id: "frog",
    label: "pip the frog",
    quip: "rushes every puck",
    style: "aggressive",
    brain: { name: "pip", reaction: 0.32, look: 0.11, speed: 135, accel: 900, shot: 210, aim: 0.2, read: 0.3, home: 24, reach: 92, aggression: 0.95, bank: 0.05, power: 0.75, lapse: 0.1, shadow: 0.25 },
  },
  {
    id: "hedgehog",
    label: "bramble",
    quip: "never leaves the den",
    style: "defensive",
    brain: { name: "bramble", reaction: 0.28, look: 0.1, speed: 150, accel: 1100, shot: 150, aim: 0.14, read: 0.22, home: 16, reach: 44, aggression: 0.4, bank: 0.15, power: 0.7, lapse: 0.07, shadow: 0.5 },
  },
  {
    id: "owl",
    label: "old hoot",
    quip: "loves a bank shot",
    style: "trickster",
    brain: { name: "hoot", reaction: 0.25, look: 0.09, speed: 160, accel: 1200, shot: 185, aim: 0.09, read: 0.18, home: 20, reach: 72, aggression: 0.7, bank: 0.8, power: 0.8, lapse: 0.06, shadow: 0.35 },
  },
  {
    id: "fox",
    label: "ember the fox",
    quip: "fast and hungry",
    style: "aggressive",
    brain: { name: "ember", reaction: 0.22, look: 0.08, speed: 190, accel: 1500, shot: 230, aim: 0.08, read: 0.15, home: 22, reach: 88, aggression: 0.9, bank: 0.3, power: 0.95, lapse: 0.05, shadow: 0.4 },
  },
  {
    id: "raccoon",
    label: "rascal",
    quip: "the pond champion",
    style: "trickster",
    brain: { name: "rascal", reaction: 0.2, look: 0.07, speed: 205, accel: 1600, shot: 230, aim: 0.06, read: 0.12, home: 18, reach: 80, aggression: 0.75, bank: 0.6, power: 0.95, lapse: 0.04, shadow: 0.5 },
  },
];

/** The cat's pilots. Thumbs have no acceleration limit but get tired: speed is capped well under the mallet's. */
export const PILOTS: Record<"novice" | "casual" | "good" | "expert", Brain> = {
  novice: { name: "novice", reaction: 0.42, look: 0.16, speed: 200, accel: Infinity, shot: 150, aim: 0.34, read: 0.38, home: 20, reach: 70, aggression: 0.75, bank: 0.08, power: 0.6, lapse: 0.14, shadow: 0.35 },
  casual: { name: "casual", reaction: 0.32, look: 0.12, speed: 260, accel: Infinity, shot: 210, aim: 0.22, read: 0.26, home: 22, reach: 82, aggression: 0.8, bank: 0.2, power: 0.75, lapse: 0.08, shadow: 0.5 },
  good: { name: "good", reaction: 0.25, look: 0.09, speed: 300, accel: Infinity, shot: 260, aim: 0.13, read: 0.18, home: 22, reach: 92, aggression: 0.85, bank: 0.4, power: 0.85, lapse: 0.05, shadow: 0.6 },
  expert: { name: "expert", reaction: 0.2, look: 0.07, speed: 330, accel: Infinity, shot: 300, aim: 0.08, read: 0.12, home: 22, reach: 96, aggression: 0.9, bank: 0.5, power: 0.95, lapse: 0.025, shadow: 0.66 },
};

interface Seen {
  t: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

type Mode = "guard" | "block" | "approach" | "strike" | "clear";

/**
 * One brain driving one mallet. Call `observe()` every physics step (it records the puck), and `think()` every step;
 * it writes the mallet's target.
 */
export class Controller {
  mode: Mode = "guard";
  private history: Seen[] = [];
  private clock = 0;
  private nextLook = 0;
  private lapseLeft = 0;
  private strikeLeft = 0;
  private aimX = W / 2;
  private aimBank = false;
  /** Puck seen at the last look, in its own frame. */
  seen: Seen | null = null;

  constructor(
    readonly side: Side,
    public brain: Brain,
    private readonly rng: Rng,
  ) {}

  /** Own frame: y measured from its own goal line. */
  private fy(y: number): number {
    return this.side === 1 ? y : L - y;
  }

  reset(): void {
    this.history = [];
    this.mode = "guard";
    this.strikeLeft = 0;
    this.lapseLeft = 0;
    this.nextLook = this.clock + this.brain.reaction;
  }

  observe(table: Table, dt: number): void {
    this.clock += dt;
    if (!table.live) return;
    const p = table.puck;
    this.history.push({ t: this.clock, x: p.x, y: this.fy(p.y), vx: p.vx, vy: this.side === 1 ? p.vy : -p.vy });
    // Keep about a second.
    if (this.history.length > 300) this.history.splice(0, this.history.length - 300);
  }

  private recall(): Seen | null {
    const at = this.clock - this.brain.reaction;
    let s: Seen | null = null;
    for (let i = this.history.length - 1; i >= 0; i--) {
      if (this.history[i]!.t <= at) {
        s = this.history[i]!;
        break;
      }
    }
    if (!s) return null;
    const b = this.brain;
    const r = this.rng;
    const k = 1 + (r() * 2 - 1) * b.read;
    const a = (r() * 2 - 1) * b.read * 0.6;
    const vx = (s.vx * Math.cos(a) - s.vy * Math.sin(a)) * k;
    const vy = (s.vx * Math.sin(a) + s.vy * Math.cos(a)) * k;
    // People extrapolate a little past what they saw, never all the way.
    const ex = b.reaction * 0.6;
    return { t: s.t, x: reflectX(s.x + vx * ex), y: s.y + vy * ex, vx, vy };
  }

  /** Sets the mallet's target for this step. `live` is false while the puck is off the ice. */
  think(table: Table, dt: number, live: boolean): void {
    const b = this.brain;
    const m = table.mallets[this.side];
    m.maxSpeed = b.speed;
    m.accel = b.accel;
    const myY = this.fy(m.y);
    const set = (x: number, y: number) => {
      m.tx = x;
      m.ty = this.side === 1 ? y : L - y;
    };
    if (!live) {
      this.mode = "guard";
      set(W / 2, b.home + 6);
      return;
    }
    this.strikeLeft = Math.max(0, this.strikeLeft - dt);
    this.lapseLeft = Math.max(0, this.lapseLeft - dt);
    if (this.mode === "strike" && this.strikeLeft > 0) return;
    if (this.clock < this.nextLook || this.lapseLeft > 0) return;
    this.nextLook = this.clock + b.look * (0.8 + this.rng() * 0.4);
    if (this.rng() < b.lapse) {
      this.lapseLeft = 0.18 + this.rng() * 0.25;
      return;
    }
    const s = this.recall();
    if (!s) return;
    this.seen = s;
    const half = L / 2;
    const speed = Math.hypot(s.vx, s.vy);
    const mine = s.y < half;
    const coming = s.vy < -25;

    // A shot on its way to the goal: get in front of it.
    if (coming) {
      const lineY = Math.max(MALLET_R + 2, Math.min(b.home, myY));
      const cross = crossAt(s.x, s.y, s.vx, s.vy, lineY, 2);
      const goalX = cross ? cross.x : s.x;
      // A shot that arrives soon: block where it will cross. One that takes its time in its own half: go and hit it.
      const arrives = (s.y - lineY) / -s.vy;
      const slow = speed < 70 || arrives > 0.35 + b.aggression * 0.35;
      if (!(mine && slow && s.y < b.reach)) {
        const gx = Math.max(W / 2 - GOAL / 2 - 4, Math.min(W / 2 + GOAL / 2 + 4, goalX));
        // Bold ones don't just stand there: once in front of it, they step into the puck and send it back.
        const near = Math.hypot(s.x - m.x, s.y - myY);
        if (b.aggression > 0.6 && near < 40 && Math.abs(gx - m.x) < 9 && s.y > myY) {
          this.mode = "strike";
          this.strikeLeft = 0.12;
          m.maxSpeed = b.shot * 0.85;
          m.accel = b.accel * 2;
          const tx = s.x + s.vx * 0.06;
          const ty = s.y + s.vy * 0.06;
          set(tx + (W / 2 - tx) * 0.15, ty + 22);
          return;
        }
        this.mode = "block";
        set(gx, lineY);
        return;
      }
    }

    if (mine && s.y < b.reach) {
      // Loose in its half. Go for a shot, or just stay home and clear it when it comes close.
      const close = Math.hypot(s.x - m.x, s.y - myY) < 46;
      if (this.mode !== "approach" && this.mode !== "strike") {
        if (this.rng() > b.aggression && !close) {
          this.mode = "guard";
        } else {
          this.mode = "approach";
          this.pickAim(table, s);
        }
      }
      if (this.mode === "approach") {
        // Where the puck will be by the time the mallet gets there (two passes).
        let px = s.x;
        let py = s.y;
        for (let i = 0; i < 2; i++) {
          const tt = Math.min(0.6, Math.hypot(px - m.x, py - myY) / b.speed + b.reaction * 0.3);
          px = reflectX(s.x + s.vx * tt * 0.9);
          py = s.y + s.vy * tt * 0.9;
        }
        py = Math.max(PUCK_R + 1, py);
        // Aim: straight at the mouth, or at its mirror image across a side board.
        let ax = this.aimX;
        if (this.aimBank) ax = this.aimX < W / 2 ? 2 * PUCK_R - this.aimX : 2 * (W - PUCK_R) - this.aimX;
        let dx = ax - px;
        let dy = L - py;
        const err = (this.rng() * 2 - 1) * b.aim;
        const ang = Math.atan2(dy, dx) + err;
        dx = Math.cos(ang);
        dy = Math.sin(ang);
        // Stand behind the puck on the line of the shot.
        const back = PUCK_R + MALLET_R + 5;
        const sx = px - dx * back;
        const sy = py - dy * back;
        // Can't get behind it (it's against our own goal line): just poke it out.
        if (sy < MALLET_R) {
          set(px, Math.max(MALLET_R, py - 4));
          return;
        }
        const offLine = Math.hypot(sx - m.x, sy - myY);
        if (offLine < 10 || (close && offLine < 16 && myY < py)) {
          // Swing through.
          this.mode = "strike";
          this.strikeLeft = 0.16 + (1 - b.power) * 0.1;
          const reachThrough = 18 + b.power * 40;
          m.maxSpeed = b.shot;
          m.accel = b.accel * 2;
          set(px + dx * reachThrough, py + dy * reachThrough);
          return;
        }
        // Go round the puck rather than through it when it sits between the mallet and the spot.
        const toPx = px - m.x;
        const toPy = py - myY;
        const toSx = sx - m.x;
        const toSy = sy - myY;
        if (toPx * toSx + toPy * toSy > 0 && myY > py - 2) {
          const side = m.x < px ? -1 : 1;
          set(px + side * (back + 4), py - back * 0.6);
          return;
        }
        set(sx, sy);
        return;
      }
    } else if (this.mode === "approach" || this.mode === "strike") {
      this.mode = "guard";
    }

    // Guard: on the guard line, shading toward the puck.
    this.mode = "guard";
    const gx = W / 2 + (s.x - W / 2) * b.shadow;
    // Waiting for the puck to come back: bold critters lurk further out.
    const gy = mine ? b.home : b.home + (b.reach - b.home) * (0.12 + 0.3 * b.aggression);
    set(Math.max(W / 2 - GOAL / 2 - 6, Math.min(W / 2 + GOAL / 2 + 6, gx)), gy);
  }

  /**
   * Picks where to shoot: a corner or the inside of the mouth, straight or off a side board, preferring lines that
   * keep clear of the other mallet. How much it cares (versus picking on a whim) follows its aim.
   */
  private pickAim(table: Table, s: Seen): void {
    const b = this.brain;
    const opp = table.mallets[this.side === 1 ? 0 : 1];
    const ox = opp.x;
    const oy = this.fy(opp.y);
    const half = GOAL / 2 - PUCK_R - 1;
    let best = -Infinity;
    for (const x of [W / 2 - half, W / 2 - half * 0.35, W / 2 + half * 0.35, W / 2 + half]) {
      for (const bank of [false, true]) {
        const tx = bank ? (x < W / 2 ? 2 * PUCK_R - x : 2 * (W - PUCK_R) - x) : x;
        // How close the shot's (folded) line passes the other mallet.
        let clear = Infinity;
        for (let i = 1; i <= 12; i++) {
          const k = i / 12;
          const px = reflectX(s.x + (tx - s.x) * k);
          const py = s.y + (L - s.y) * k;
          clear = Math.min(clear, Math.hypot(px - ox, py - oy) - MALLET_R - PUCK_R);
        }
        const pref = bank ? b.bank : 1 - b.bank;
        const score = Math.min(clear, 30) / 15 + pref + this.rng() * (0.3 + b.aim * 5);
        if (score > best) {
          best = score;
          this.aimX = x;
          this.aimBank = bank;
        }
      }
    }
  }
}
