/**
 * The run: three balls (plus an extra ball you can earn) on the Galebell table, and everything that scores.
 *
 * Pure and deterministic: `step(dt, controls)` advances real time, the table runs `speed` times faster than the clock
 * (the storm), in fixed 1/480 s substeps. The client draws from the state here and reacts to `events`.
 *
 *   - a served ball waits on the plunger: a tap launches it, or the tide takes it after a few seconds;
 *   - the lifeboat (ball save) covers the first seconds of each ball, if you have flipped at all this ball;
 *   - the storm ladder: shots (orbits, lamp lanes, flags, whirls, the harbour, jackpots) charge it; each tier
 *     multiplies every point (×1 to ×5), speeds the table up a little and has its own line; STORM lights the extra
 *     ball in the harbour;
 *   - flags down open the harbour and light a lock; two moored balls light HIGH TIDE (three-ball multiball), where
 *     every orbit is a jackpot and two jackpots light the super jackpot in the harbour;
 *   - shots within 4 s of each other chain into combos; a gold buoy lights every 12-18 s;
 *   - a ball held on a raised flipper slips after 3.5 s, so nobody can stall a run.
 */
import { createRng, type Rng } from "@thumbcade-games/kit/rng";
import { BALL_R, EvKind, SUBSTEP, World, type Ball } from "./physics.ts";
import { buildTable, Sensor, Tag, type TableDef } from "./table.ts";

export const RULES = {
  balls: 3,
  /** Lifeboat seconds after launch: the first ball, later balls, a multiball start; and a hidden grace. */
  saveFirst: 12,
  saveNext: 5,
  saveMulti: 8,
  saveGrace: 1,
  /** The first ball is saved inside this many seconds of its launch whatever the player does. */
  firstBallSure: 10,
  /** Seconds a served ball waits on the plunger before the tide takes it. */
  autoLaunchFirst: 3.2,
  autoLaunch: 1.8,
  autoLaunchSaved: 0.6,
  launchSpeed: 2250,
  /** A ball held still on a raised flipper slips after this long. */
  holdLimit: 3.5,
  slipTime: 0.35,
  comboWindow: 4,
  /** Charge needed for each next tier. */
  tierNeed: [3, 5, 6, 8],
  /** Table speed by tier, and the creep that starts after `creepStart` seconds of run. */
  speeds: [1, 1.05, 1.1, 1.16, 1.22],
  creepStart: 30,
  creepRate: 0.006,
  maxSpeed: 1.5,
  goldEvery: [12, 18] as [number, number],
  goldFor: 8,
  whirlSpins: 10,
  /** The tier that lights the extra ball in the harbour (STORM). */
  extraAt: 4,
} as const;

/** Game events for the client (sound, light, text). */
export const GE = {
  Flip: 0,
  Bumper: 1,
  Sling: 2,
  Wall: 3,
  Target: 4,
  Flags: 5,
  Lane: 6,
  Lamps: 7,
  LaneShift: 8,
  Spin: 9,
  Whirl: 10,
  Orbit: 11,
  Harbour: 12,
  Kickout: 13,
  Lock: 14,
  Multiball: 15,
  MultiballEnd: 16,
  Jackpot: 17,
  Super: 18,
  TierUp: 19,
  Combo: 20,
  ExtraLit: 21,
  ExtraBall: 22,
  Save: 23,
  Drain: 24,
  Bonus: 25,
  BallStart: 26,
  Launch: 27,
  GameOver: 28,
  Slip: 29,
  GoldLit: 30,
  GoldHit: 31,
  Points: 32,
  FlagsReset: 33,
  FlipperHit: 34,
  Inlane: 35,
  SuperLit: 36,
  Nudge: 37,
  BallBall: 38,
} as const;
export type GE = (typeof GE)[keyof typeof GE];

export interface GameEvent {
  type: GE;
  x: number;
  y: number;
  a: number;
  b: number;
}

export interface Controls {
  left: boolean;
  right: boolean;
  /** A tap this frame (launches a waiting ball). */
  launch: boolean;
}

export type HarbourLit = "none" | "lock" | "multiball" | "extra" | "super";

export interface RunStats {
  flips: number;
  drains: number;
  /** Drains with a flip in the last moment (late) and with no flip near the end at all. */
  lateDrains: number;
  quietDrains: number;
  orbits: number;
  lamps: number;
  flagBanks: number;
  locks: number;
  multiballs: number;
  jackpots: number;
  supers: number;
  maxCombo: number;
  combos: number;
  tier: number;
  extraLit: boolean;
  extraBalls: number;
  saves: number;
  slips: number;
  bells: number;
  spins: number;
  whirls: number;
  cradles: number;
  shots: number;
  golds: number;
  bestShot: number;
  nudges: number;
}

const freshStats = (): RunStats => ({
  flips: 0,
  drains: 0,
  lateDrains: 0,
  quietDrains: 0,
  orbits: 0,
  lamps: 0,
  flagBanks: 0,
  locks: 0,
  multiballs: 0,
  jackpots: 0,
  supers: 0,
  maxCombo: 0,
  combos: 0,
  tier: 1,
  extraLit: false,
  extraBalls: 0,
  saves: 0,
  slips: 0,
  bells: 0,
  spins: 0,
  whirls: 0,
  cradles: 0,
  shots: 0,
  golds: 0,
  bestShot: 0,
  nudges: 0,
});

export type Phase = "serve" | "play" | "bonus" | "over";

interface Release {
  t: number;
  vx: number;
  vy: number;
}

export interface GameOptions {
  seed: number;
  /** Attract mode: balls never run out. */
  attract?: boolean;
  def?: TableDef;
}

const SHARED_DEF = buildTable();
/** Seconds the bonus count after a lost ball takes. */
export const BONUS_TIME = 1.3;

export class Game {
  readonly def: TableDef;
  readonly world: World;
  readonly rng: Rng;
  readonly attract: boolean;
  phase: Phase = "serve";
  /** Real seconds since the run started. */
  t = 0;
  score = 0;
  tier = 1;
  charge = 0;
  ballNo = 1;
  ballsTotal: number = RULES.balls;
  /** Real seconds of the current ball since its launch (-1 before launch). */
  ballT = -1;
  saveUntil = 0;
  flippedThisBall = false;
  savesThisBall = 0;
  readonly stats = freshStats();

  lanes = [false, false, false];
  lanesFlash = 0;
  flags = [true, true, true, true];
  locks = 0;
  multiball = false;
  multiballT = 0;
  jackpotsThisTide = 0;
  extraLit = false;
  extraGiven = false;
  gold = -1;
  goldUntil = 0;
  nextGold = 0;
  combo = 0;
  lastShotT = -99;
  /** The ball waiting on the plunger, and how long it has waited. */
  laneBall: Ball | null = null;
  waitT = 0;
  autoAfter: number = RULES.autoLaunchFirst;
  /** The harbour holding a ball, what it is doing and for how long. */
  harbourT = 0;
  harbourKind: HarbourLit | "plain" = "none";
  harbourHolding = false;
  private releases: Release[] = [];
  /** Served balls waiting for the shooter lane to clear (two lifeboat saves at once). */
  private queued: number[] = [];
  bonusT = 0;
  bonusValue = 0;
  /** Bells, flags and shots this ball (for the bonus). */
  private ballBells = 0;
  private ballShots = 0;
  private ballSpins = 0;
  private acc = 0;
  private prevPress = [false, false];
  private lastFlipT = [-9, -9];
  private flagRaiseAt = -1;
  private bumperT = [-9, -9, -9];
  private slingT = [-9, -9];
  private orbitFrom = -1;
  private orbitT = -9;
  private spinAcc = 0;
  private passSpins = 0;
  private passT = -9;
  private holdT = [0, 0];
  private cradleT = [0, 0];
  private stillT = 0;
  private stillX = 0;
  private stillY = 0;

  readonly events: GameEvent[] = [];
  evCount = 0;

  constructor(o: GameOptions) {
    this.def = o.def ?? SHARED_DEF;
    this.world = new World(this.def);
    this.rng = createRng(o.seed);
    this.attract = !!o.attract;
    if (this.attract) this.ballsTotal = 9999;
    for (let i = 0; i < 160; i++) this.events.push({ type: GE.Points, x: 0, y: 0, a: 0, b: 0 });
    this.serve(RULES.autoLaunchFirst);
    this.nextGold = this.rng.range(...RULES.goldEvery);
  }

  // --- derived state --------------------------------------------------------------------------------------------

  get speed(): number {
    const base = RULES.speeds[this.tier - 1] ?? 1;
    return Math.min(RULES.maxSpeed, base + Math.max(0, this.t - RULES.creepStart) * RULES.creepRate);
  }

  get saveLeft(): number {
    return Math.max(0, this.saveUntil - this.t);
  }

  /**
   * The lifeboat saves a ball lost inside its window if you have flipped this ball (an idle run must end on its own),
   * and the first ball always inside its first 10 s: nobody loses their first ball that fast.
   */
  get lifeboatOn(): boolean {
    if (this.saveLeft <= 0) return false;
    if (this.flippedThisBall || this.multiball) return true;
    // The first ball is always saved inside its first 10 s, flips or not.
    return this.ballNo === 1 && !this.attract && this.ballT >= 0 && this.ballT < RULES.firstBallSure;
  }

  /** What the harbour gives right now. */
  get harbourLit(): HarbourLit {
    if (this.extraLit) return "extra";
    if (this.multiball) return this.jackpotsThisTide >= 2 ? "super" : "none";
    if (this.locks >= 2) return "multiball";
    if (this.flags.every((f) => !f)) return "lock";
    return "none";
  }

  get ballsLeft(): number {
    return Math.max(0, this.ballsTotal - this.ballNo);
  }

  get liveBalls(): number {
    return this.world.balls.length + (this.harbourHolding ? 1 : 0) + this.releases.length + this.queued.length;
  }

  /** The charge still needed for the next tier (0 at the top). */
  get needed(): number {
    return this.tier >= 5 ? 0 : (RULES.tierNeed[this.tier - 1] ?? 9);
  }

  // --- events ---------------------------------------------------------------------------------------------------

  private emit(type: GE, x = 0, y = 0, a = 0, b = 0): void {
    if (this.evCount >= this.events.length) return;
    const e = this.events[this.evCount++]!;
    e.type = type;
    e.x = x;
    e.y = y;
    e.a = a;
    e.b = b;
  }

  drain(cb: (e: GameEvent) => void): void {
    for (let i = 0; i < this.evCount; i++) cb(this.events[i]!);
    this.evCount = 0;
  }

  /** Adds `base` × the tier and reports where it was earned. Returns the points. */
  private award(base: number, x: number, y: number, show = true): number {
    const pts = Math.round(base * this.tier);
    this.score += pts;
    if (show) this.emit(GE.Points, x, y, pts, 0);
    return pts;
  }

  // --- the ball's life --------------------------------------------------------------------------------------------

  private serve(autoAfter: number): void {
    if (this.laneBall) {
      // The lane is taken: this one follows as soon as it's free.
      this.queued.push(autoAfter);
      return;
    }
    const p = this.def.plunger;
    this.laneBall = this.world.addBall(p.x, p.y, 0, 0);
    this.waitT = 0;
    this.autoAfter = autoAfter;
    if (this.phase !== "play") this.phase = "serve";
  }

  private launch(): void {
    const b = this.laneBall;
    if (!b) return;
    this.laneBall = null;
    b.vy = -(RULES.launchSpeed + this.rng.range(-35, 35));
    b.vx = 0;
    if (this.ballT < 0) {
      this.ballT = 0;
      this.saveUntil = this.t + (this.ballNo === 1 && !this.attract ? RULES.saveFirst : RULES.saveNext);
    }
    this.phase = "play";
    this.emit(GE.Launch, b.x, b.y);
  }

  private startBall(): void {
    this.ballT = -1;
    this.flippedThisBall = false;
    this.savesThisBall = 0;
    this.ballBells = 0;
    this.ballShots = 0;
    this.ballSpins = 0;
    this.combo = 0;
    this.nextGold = this.rng.range(...RULES.goldEvery);
    this.phase = "serve";
    this.serve(this.ballNo === 1 && !this.attract ? RULES.autoLaunchFirst : RULES.autoLaunch);
    this.emit(GE.BallStart, 0, 0, this.ballNo, this.ballsLeft);
  }

  /** Every ball left the table (nothing held or queued). */
  private ballOver(): void {
    if (this.lifeboatOn || (this.saveUntil + RULES.saveGrace > this.t && this.flippedThisBall)) {
      this.stats.saves++;
      this.savesThisBall++;
      this.emit(GE.Save, this.def.plunger.x, 600);
      this.serve(RULES.autoLaunchSaved);
      this.phase = "play";
      return;
    }
    this.stats.drains++;
    const bonus = (this.ballBells * 25 + this.ballShots * 400 + this.ballSpins * 5 + 500) * this.tier;
    this.bonusValue = bonus;
    this.score += bonus;
    this.bonusT = 0;
    this.phase = "bonus";
    this.multiball = false;
    this.emit(GE.Drain, 169, 640, this.ballNo, this.ballsLeft);
    this.emit(GE.Bonus, 169, 400, bonus, this.tier);
  }

  // --- stepping --------------------------------------------------------------------------------------------------

  step(dt: number, c: Controls): void {
    if (this.phase === "over") return;
    this.t += dt;
    if (this.ballT >= 0) this.ballT += dt;
    const w = this.world;

    // Flippers follow the thumbs (a slip holds one down for a moment).
    const press = [c.left, c.right];
    for (let i = 0; i < 2; i++) {
      const f = w.flippers[i]!;
      const p = press[i]!;
      if (p && !this.prevPress[i]) {
        this.stats.flips++;
        this.flippedThisBall = true;
        this.lastFlipT[i] = this.t;
        this.emit(GE.Flip, f.def.x, f.def.y, i, 0);
        // Lane change: the lit lamps shift with the flipper.
        if (this.lanes.some((l) => l) && !this.lanes.every((l) => l)) {
          const l = this.lanes;
          this.lanes = i === 0 ? [l[1]!, l[2]!, l[0]!] : [l[2]!, l[0]!, l[1]!];
          this.emit(GE.LaneShift, 0, 0, i, 0);
        }
      }
      this.prevPress[i] = p;
      f.pressed = p;
    }

    if (this.phase === "bonus") {
      this.bonusT += dt;
      // Keep the table ticking so the flippers move.
      this.advance(dt);
      if (this.bonusT >= BONUS_TIME) {
        if (this.ballNo >= this.ballsTotal) {
          this.phase = "over";
          this.emit(GE.GameOver, 0, 0, this.score, 0);
        } else {
          this.ballNo++;
          this.startBall();
        }
      }
      return;
    }

    // The plunger.
    if (!this.laneBall && this.queued.length) {
      const lb = this.world.balls;
      const clear = !lb.some((b) => b.x > 326 && b.y > 560);
      if (clear) this.serve(this.queued.shift()!);
    }
    if (this.laneBall) {
      const b = this.laneBall;
      const resting = b.y > this.def.plunger.y - 6 && Math.abs(b.vy) < 30;
      if (resting) {
        this.waitT += dt;
        if (c.launch || this.waitT >= this.autoAfter) this.launch();
      }
    }

    // The harbour: hold, then kick out (or release the tide).
    if (this.harbourHolding) {
      this.harbourT -= dt;
      if (this.harbourT <= 0) this.kickout();
    }
    for (let i = this.releases.length - 1; i >= 0; i--) {
      const r = this.releases[i]!;
      r.t -= dt;
      if (r.t <= 0) {
        this.releases.splice(i, 1);
        const hb = this.def.harbour;
        const b = this.world.addBall(hb.x, hb.y, r.vx, r.vy);
        b.harbourImmune = 0.6;
        this.emit(GE.Kickout, hb.x, hb.y, 0, 0);
      }
    }

    this.advance(dt);
    this.rulesTick(dt);
  }

  /** Runs the table for `dt` real seconds at the storm's speed, in fixed substeps, handling what happened. */
  private advance(dt: number): void {
    this.acc += dt * this.speed;
    let n = 0;
    while (this.acc >= SUBSTEP && n < 64) {
      this.acc -= SUBSTEP;
      n++;
      this.world.substep(SUBSTEP);
      if (this.world.evCount) this.handle();
    }
    if (n >= 64) this.acc = 0;
  }

  private handle(): void {
    const w = this.world;
    for (let i = 0; i < w.evCount; i++) {
      const e = w.events[i]!;
      switch (e.kind) {
        case EvKind.Contact:
          this.contact(e.a, e.s, e.x, e.y);
          break;
        case EvKind.Sensor:
          this.sensor(e.a, e.s, e.x, e.y);
          break;
        case EvKind.TargetDown:
          this.targetDown(e.a, e.x, e.y);
          break;
        case EvKind.Harbour:
          this.harbourIn(e.ball);
          break;
        case EvKind.Drain:
          this.drained(e.ball, e.x);
          break;
        case EvKind.BallBall:
          this.emit(GE.BallBall, e.x, e.y, e.s, 0);
          break;
      }
    }
    w.evCount = 0;
  }

  private contact(tag: number, speed: number, x: number, y: number): void {
    const t = this.t;
    if (tag >= Tag.Bumper0 && tag <= Tag.Bumper2) {
      const i = tag - Tag.Bumper0;
      if (t - this.bumperT[i]! < 0.05) return;
      this.bumperT[i] = t;
      this.stats.bells++;
      this.ballBells++;
      const isGold = this.gold === i && t < this.goldUntil;
      if (isGold) {
        this.gold = -1;
        this.stats.golds++;
        this.award(2000, x, y);
        this.emit(GE.GoldHit, this.def.bumpers[i]!.x, this.def.bumpers[i]!.y, i, 0);
        this.shot(x, y);
      } else this.award(100, x, y, false);
      this.emit(GE.Bumper, this.def.bumpers[i]!.x, this.def.bumpers[i]!.y, i, speed);
    } else if (tag === Tag.SlingL || tag === Tag.SlingR) {
      const i = tag === Tag.SlingL ? 0 : 1;
      if (speed < 70 || t - this.slingT[i]! < 0.08) return;
      this.slingT[i] = t;
      this.award(10, x, y, false);
      this.emit(GE.Sling, x, y, i, speed);
    } else if (tag === Tag.FlipperL || tag === Tag.FlipperR) {
      if (speed > 120) this.emit(GE.FlipperHit, x, y, tag === Tag.FlipperL ? 0 : 1, speed);
    } else if (speed > 140) {
      this.emit(GE.Wall, x, y, tag, speed);
    }
  }

  private sensor(id: number, dir: number, x: number, y: number): void {
    const t = this.t;
    if (id <= Sensor.Lane2) {
      if (!this.lanes[id]) {
        this.lanes[id] = true;
        this.award(250, x, y);
        this.emit(GE.Lane, x, y, id, 0);
        if (this.lanes.every((l) => l)) {
          this.stats.lamps++;
          this.award(2500, 169, 110);
          this.lanesFlash = 0.9;
          this.emit(GE.Lamps, 169, 80, this.stats.lamps, 0);
          this.shot(169, 110);
        }
      } else this.award(50, x, y, false);
    } else if (id === Sensor.Spinner) {
      this.passSpins = 0;
      this.passT = t;
    } else if (id === Sensor.OrbitL || id === Sensor.OrbitR) {
      const side = id === Sensor.OrbitL ? 0 : 1;
      if (dir > 0) {
        this.orbitFrom = side;
        this.orbitT = t;
      } else if (this.orbitFrom === 1 - side && t - this.orbitT < 3) {
        this.orbitFrom = -1;
        this.stats.orbits++;
        this.award(1000, x, y - 30);
        this.emit(GE.Orbit, x, y, side, 0);
        if (this.multiball) this.jackpot(x, y - 60);
        this.shot(x, y);
      } else if (this.orbitFrom === side) this.orbitFrom = -1;
    } else if (id === Sensor.InlaneL || id === Sensor.InlaneR) {
      if (dir < 0) {
        this.award(100, x, y, false);
        this.emit(GE.Inlane, x, y, id === Sensor.InlaneL ? 0 : 1, 0);
      }
    }
  }

  private targetDown(i: number, x: number, y: number): void {
    this.flags[i] = false;
    this.award(150, x, y);
    this.emit(GE.Target, x, y, i, 0);
    if (this.flags.every((f) => !f)) {
      this.stats.flagBanks++;
      this.award(1500, 169, 330);
      this.emit(GE.Flags, 169, 310, this.harbourLit === "lock" ? 1 : 0, 0);
      this.shot(169, 320);
    }
  }

  private jackpot(x: number, y: number): void {
    this.jackpotsThisTide++;
    this.stats.jackpots++;
    const pts = this.award(5000 + 2500 * (this.jackpotsThisTide - 1), x, y);
    this.emit(GE.Jackpot, x, y, pts, this.jackpotsThisTide);
    if (this.jackpotsThisTide === 2) this.emit(GE.SuperLit, 169, 270, 0, 0);
    this.charge++;
  }

  /** A major shot: combo, storm charge. */
  private shot(x: number, y: number): void {
    const t = this.t;
    this.stats.shots++;
    this.ballShots++;
    this.combo = t - this.lastShotT <= RULES.comboWindow ? this.combo + 1 : 1;
    this.lastShotT = t;
    if (this.combo >= 2) {
      this.stats.combos++;
      this.stats.maxCombo = Math.max(this.stats.maxCombo, this.combo);
      // The bonus climbs to the fifth link (SEVEN SEAS) and holds there.
      const pts = this.award(750 * Math.min(this.combo - 1, 4), x, y - 24, false);
      this.emit(GE.Combo, x, y, this.combo, pts);
    }
    this.addCharge(1);
  }

  private addCharge(n: number): void {
    this.charge += n;
    while (this.tier < 5 && this.charge >= this.needed) {
      this.charge -= this.needed;
      this.tier++;
      this.stats.tier = Math.max(this.stats.tier, this.tier);
      this.emit(GE.TierUp, 169, 300, this.tier, 0);
      if (this.tier === RULES.extraAt && !this.extraGiven && !this.extraLit && !this.attract) {
        this.extraLit = true;
        this.stats.extraLit = true;
        this.emit(GE.ExtraLit, 169, 270, 0, 0);
      }
    }
    if (this.tier >= 5) this.charge = Math.min(this.charge, 0);
  }

  private harbourIn(id: number): void {
    const b = this.world.balls.find((q) => q.id === id);
    if (b) this.world.removeBall(b);
    const lit = this.harbourLit;
    const hb = this.def.harbour;
    this.harbourHolding = true;
    this.harbourKind = lit === "none" ? "plain" : lit;
    this.emit(GE.Harbour, hb.x, hb.y, 0, 0);
    switch (lit) {
      case "extra":
        this.extraLit = false;
        this.extraGiven = true;
        this.stats.extraBalls++;
        this.ballsTotal++;
        this.award(5000, hb.x, hb.y);
        this.emit(GE.ExtraBall, hb.x, hb.y, 0, 0);
        this.harbourT = 1.4;
        this.shot(hb.x, hb.y);
        this.resetFlags();
        break;
      case "lock":
        this.locks++;
        this.stats.locks++;
        this.award(2500, hb.x, hb.y);
        this.emit(GE.Lock, hb.x, hb.y, this.locks, 0);
        this.shot(hb.x, hb.y);
        // The ball stays moored: a new one comes to the plunger.
        this.harbourHolding = false;
        if (this.locks < 2) this.resetFlags();
        this.serve(RULES.autoLaunch);
        this.phase = "play";
        break;
      case "multiball":
        this.multiball = true;
        this.multiballT = this.t;
        this.jackpotsThisTide = 0;
        this.stats.multiballs++;
        this.locks = 0;
        this.award(5000, hb.x, hb.y);
        this.emit(GE.Multiball, hb.x, hb.y, 0, 0);
        this.harbourT = 1.5;
        this.saveUntil = this.t + 1.5 + RULES.saveMulti;
        this.shot(hb.x, hb.y);
        this.resetFlags();
        // The two moored balls follow the one that called them.
        this.releases.push({ t: 1.5 + 0.45, vx: 260, vy: -560 }, { t: 1.5 + 0.9, vx: -260, vy: -560 });
        break;
      case "super":
        this.stats.supers++;
        this.jackpotsThisTide = 0;
        {
          const pts = this.award(25000, hb.x, hb.y);
          this.emit(GE.Super, hb.x, hb.y, pts, 0);
        }
        this.harbourT = 1.2;
        this.shot(hb.x, hb.y);
        this.charge += 1;
        this.resetFlags();
        break;
      default:
        this.award(500, hb.x, hb.y);
        this.harbourT = 0.8;
        this.shot(hb.x, hb.y);
        this.resetFlags();
    }
  }

  private kickout(): void {
    this.harbourHolding = false;
    const hb = this.def.harbour;
    // Up into the buoys, a little to one side.
    const side = this.rng() < 0.5 ? -1 : 1;
    const b = this.world.addBall(hb.x, hb.y, side * this.rng.range(180, 320), -this.rng.range(520, 640));
    b.harbourImmune = 0.6;
    this.emit(GE.Kickout, hb.x, hb.y, side, 0);
  }

  private resetFlags(): void {
    this.flagRaiseAt = this.t + 0.7;
  }

  private drained(id: number, x: number): void {
    const b = this.world.balls.find((q) => q.id === id);
    if (b) this.world.removeBall(b);
    const near = x < 169 ? 0 : 1;
    const sinceFlip = this.t - this.lastFlipT[near]!;
    const left = this.liveBalls;
    if (this.multiball) {
      if (this.lifeboatOn) {
        // Inside the high tide's lifeboat every lost ball comes back.
        this.stats.saves++;
        this.emit(GE.Save, this.def.plunger.x, 600);
        this.serve(RULES.autoLaunchSaved);
        return;
      }
      if (left <= 1) {
        this.multiball = false;
        this.emit(GE.MultiballEnd, 169, 300, this.jackpotsThisTide, 0);
      }
    }
    if (left > 0) return;
    if (!this.lifeboatOn) {
      if (sinceFlip < 0.25) this.stats.lateDrains++;
      else if (sinceFlip > 1.2) this.stats.quietDrains++;
    }
    this.ballOver();
  }

  private rulesTick(dt: number): void {
    const t = this.t;
    const w = this.world;
    if (this.lanesFlash > 0) {
      this.lanesFlash -= dt;
      if (this.lanesFlash <= 0) this.lanes = [false, false, false];
    }
    // Flags pop back up when no ball is in the way.
    if (this.flagRaiseAt >= 0 && t >= this.flagRaiseAt) {
      let all = true;
      for (let i = 0; i < 4; i++) {
        if (this.flags[i]) continue;
        const tg = this.def.targets[i]!;
        const blocked = w.balls.some((b) => segDist(b.x, b.y, tg.ax, tg.ay, tg.bx, tg.by) < BALL_R + 5);
        if (blocked) all = false;
        else {
          this.flags[i] = true;
          w.setTarget(i, true);
        }
      }
      if (all) {
        this.flagRaiseAt = -1;
        this.emit(GE.FlagsReset, 169, 310, 0, 0);
      }
    }
    // Spinner spins.
    const turns = Math.abs(w.spin - this.spinAcc) / Math.PI;
    if (turns >= 1) {
      const n = Math.floor(turns);
      this.spinAcc += Math.sign(w.spin - this.spinAcc) * n * Math.PI;
      this.stats.spins += n;
      this.ballSpins += n;
      this.passSpins += n;
      this.award(20 * n, 31, 292, false);
      this.emit(GE.Spin, 31, 292, n, Math.abs(w.spinV));
    }
    if (this.passT > 0 && w.spinV === 0) {
      if (this.passSpins >= RULES.whirlSpins) {
        this.stats.whirls++;
        this.award(750, 31, 270);
        this.emit(GE.Whirl, 31, 280, this.passSpins, 0);
        this.shot(31, 280);
      }
      this.passT = -9;
      this.passSpins = 0;
    }
    // Gold buoy.
    if (this.phase === "play" && this.ballT >= 0) {
      if (this.gold < 0 && this.ballT >= this.nextGold) {
        this.gold = this.rng.int(0, 2);
        this.goldUntil = t + RULES.goldFor;
        this.nextGold = this.ballT + RULES.goldFor + this.rng.range(...RULES.goldEvery);
        const bp = this.def.bumpers[this.gold]!;
        this.emit(GE.GoldLit, bp.x, bp.y, this.gold, 0);
      } else if (this.gold >= 0 && t >= this.goldUntil) this.gold = -1;
    }
    // Cradles and the hold limit.
    for (let i = 0; i < 2; i++) {
      const f = w.flippers[i]!;
      const held = w.balls.some((b) => b.live && b !== this.laneBall && Math.hypot(b.vx, b.vy) < 40 && Math.hypot(b.x - f.def.x, b.y - f.def.y) < f.def.len + 14);
      if (held && f.pressed && t >= f.forcedDownUntil) {
        this.holdT[i]! += dt;
        if (this.holdT[i]! > 0.4 && this.cradleT[i]! <= 0.4) this.stats.cradles++;
        this.cradleT[i] = this.holdT[i]!;
        if (this.holdT[i]! >= RULES.holdLimit) {
          f.forcedDownUntil = w.t + RULES.slipTime * this.speed;
          this.holdT[i] = 0;
          this.cradleT[i] = 0;
          this.stats.slips++;
          this.emit(GE.Slip, f.def.x + (i ? -30 : 30), f.def.y - 20, i, 0);
        }
      } else {
        this.holdT[i] = 0;
        this.cradleT[i] = 0;
      }
    }
    // A ball that has sat still away from the flippers and the plunger for 5 s gets a nudge (never needed so far).
    const b0 = w.balls[0];
    if (b0 && b0 !== this.laneBall && this.holdT[0] === 0 && this.holdT[1] === 0) {
      if (Math.hypot(b0.x - this.stillX, b0.y - this.stillY) > 3) {
        this.stillX = b0.x;
        this.stillY = b0.y;
        this.stillT = 0;
      } else {
        this.stillT += dt;
        const nearFlipper = b0.y > 520;
        if (this.stillT > 5 && !nearFlipper) {
          this.stillT = 0;
          this.stats.nudges++;
          b0.vx += this.rng.range(-200, 200);
          b0.vy -= 300;
          this.emit(GE.Nudge, b0.x, b0.y, 0, 0);
        }
      }
    }
  }

  /** Cradle progress toward the slip for side i (0-1). */
  holdProgress(i: number): number {
    return Math.min(1, (this.holdT[i] ?? 0) / RULES.holdLimit);
  }
}

function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2));
  return Math.hypot(px - ax - dx * t, py - ay - dy * t);
}
