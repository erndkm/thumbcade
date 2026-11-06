/**
 * The rules of a night on the pond: a ladder of five critters against the moon clock.
 *
 * - The clock starts at 32 s and only runs while the puck is in play (it waits through goal beats and knockouts).
 * - Each critter is a bout, first to three. Win it and the critter is knocked off the ice: time back, and the next,
 *   tougher critter skates in. Lose it (they get three first) and you face it again, six seconds poorer. Nothing costs
 *   time in the first ten seconds of a run.
 * - Your goals buy a little time; banks and zingers pay extra; goals in a row build a streak multiplier; the last ten
 *   seconds pay double; a shot still sliding in at the buzzer counts.
 * - Beat all five and you are the pond champion: the run ends with every second left paid out.
 *
 * Pure and deterministic: given the same seed and the same cat targets, a run plays out the same.
 */
import { createRng, type Rng } from "@thumbcade-games/kit/rng";
import { Controller, CRITTERS, type Brain, type Critter } from "./ai.ts";
import { CAT, crossAt, CRITTER, DT, GX0, GX1, L, PUCK_R, Table, W, type Hit, type Side } from "./physics.ts";

export const RULES = {
  clock: 32,
  cap: 40,
  /** Goals that win a bout, per critter: pip is a two-goal warm-up. */
  boutTo: [2, 3, 3, 3, 3],
  /** Seconds a goal of yours buys, per critter. */
  goalTime: [2, 2, 2, 1.5, 1.5],
  /** Seconds a knockout buys, per critter (the last one ends the run). */
  koTime: [6, 5, 5, 4, 0],
  lostBout: 6,
  grace: 10,
  frenzy: 10,
  goalBeat: 1.15,
  concedeBeat: 1.0,
  koBeat: 2.5,
  lostBeat: 1.7,
  dropBeat: 0.55,
  /** A shot still sliding toward the den at the buzzer gets this long to go in. */
  lastShot: 1.4,
  goalPts: 100,
  bankPts: 60,
  zingerPts: 60,
  /** Entry speed that makes a zinger (px/s). */
  zinger: 225,
  blockPts: 20,
  koPts: 250,
  shutoutPts: 250,
  comebackPts: 400,
  buzzerPts: 200,
  championPerSecond: 50,
  /** A puck at rest this long in the cat's half drifts back toward the middle (so an idle cat still plays). */
  drift: 1.3,
} as const;

/** How fast the clock runs at run time `t`: 1 s a second for the first 40 s, then faster. */
export function burn(t: number): number {
  return 1 + Math.max(0, t - 40) / 70;
}

/** Streak (goals in a row without conceding) → multiplier. */
export function multiplier(streak: number): number {
  return streak >= 6 ? 4 : streak >= 4 ? 3 : streak >= 2 ? 2 : 1;
}

export type RunEvent =
  | { type: "hit"; who: Side; speed: number; impact: number; x: number; y: number }
  | { type: "rail"; speed: number; x: number; y: number; post: boolean }
  | { type: "block"; x: number; y: number; points: number }
  | { type: "saved"; x: number; y: number }
  | { type: "goal"; by: Side; x: number; speed: number; points: number; bank: boolean; zinger: boolean; buzzer: boolean; own: boolean; streak: number; mult: number; time: number; frenzy: boolean }
  | { type: "tier"; mult: number }
  | { type: "ko"; critter: number; points: number; shutout: boolean; comeback: boolean; time: number }
  | { type: "lostBout"; critter: number; time: number }
  | { type: "next"; critter: number }
  | { type: "drop"; x: number; y: number }
  | { type: "frenzy" }
  | { type: "drift" }
  | { type: "lastShot" }
  | { type: "over"; champion: boolean; bonus: number };

export type Phase = "drop" | "play" | "goal" | "ko" | "lost" | "lastShot" | "over";

export interface RunStats {
  goals: number;
  against: number;
  kos: number;
  bestStreak: number;
  banks: number;
  zingers: number;
  blocks: number;
  saved: number;
  shots: number;
  lostBouts: number;
  comebacks: number;
  /** Seconds the cat's thumb moved the mallet (set by whoever drives the cat). */
  moved: number;
  champion: boolean;
}

export class Run {
  readonly table = new Table();
  readonly rng: Rng;
  readonly critterBrain: Controller;
  phase: Phase = "drop";
  /** Seconds in this phase. */
  phaseT = 0;
  /** Wall seconds since the run began. */
  t = 0;
  clock: number = RULES.clock;
  score = 0;
  critter = 0;
  me = 0;
  them = 0;
  /** Worst deficit in this bout. */
  deficit = 0;
  streak = 0;
  frenzy = false;
  events: RunEvent[] = [];
  readonly stats: RunStats = { goals: 0, against: 0, kos: 0, bestStreak: 0, banks: 0, zingers: 0, blocks: 0, saved: 0, shots: 0, lostBouts: 0, comebacks: 0, moved: 0, champion: false };
  private acc = 0;
  private lastTouch: Side | -1 = -1;
  private railsSince = 0;
  private dropSide: Side = CAT;
  private pendingNext = false;
  private resetBout = false;
  private driftArmed = true;
  private lastKnock = [-1, -1];
  /** Attract only: the critter's mallet stays at least this far from its goal line (so the title sign never hides it). */
  critterFloor = 0;

  /** `critter` starts the ladder further up (tests and QA builds only). */
  constructor(seed: number, opts: { critter?: number } = {}) {
    this.rng = createRng(seed);
    this.critter = Math.max(0, Math.min(CRITTERS.length - 1, opts.critter ?? 0));
    this.critterBrain = new Controller(CRITTER, CRITTERS[this.critter]!.brain, createRng(seed ^ 0x5eed));
    this.table.live = false;
    this.startDrop(CAT);
  }

  get current(): Critter {
    return CRITTERS[this.critter]!;
  }

  /** Goals that win (or lose) the current bout. */
  get boutTo(): number {
    return RULES.boutTo[this.critter]!;
  }

  get mult(): number {
    return multiplier(this.streak);
  }

  get over(): boolean {
    return this.phase === "over";
  }

  /** How far the wall clock is into the next fixed step (0-1), for drawing between steps. */
  get alpha(): number {
    return Math.min(1, this.acc / DT);
  }

  /** True while the clock is running. */
  get ticking(): boolean {
    return this.phase === "play";
  }

  private emit(e: RunEvent): void {
    this.events.push(e);
  }

  /** Takes (and clears) what happened since the last call. */
  drain(): RunEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  private startDrop(side: Side): void {
    this.phase = "drop";
    this.phaseT = 0;
    this.dropSide = side;
    this.table.live = false;
    this.lastTouch = -1;
    this.railsSince = 0;
    this.critterBrain.reset();
  }

  private place(): void {
    const x = W / 2 + (this.rng() * 2 - 1) * 14;
    const y = this.dropSide === CAT ? L * 0.68 : L * 0.32;
    this.table.drop(x, y);
    this.driftArmed = true;
    this.emit({ type: "drop", x, y });
  }

  /** Advances by `dt` seconds of wall time in fixed steps. `cat` (optional) drives the cat each step. */
  update(dt: number, cat?: (run: Run, dt: number) => void): void {
    if (this.phase === "over") {
      this.acc = 0;
      return;
    }
    this.acc += Math.min(dt, 0.25);
    while (this.acc >= DT && !this.over) {
      this.acc -= DT;
      cat?.(this, DT);
      this.fixed(DT);
    }
  }

  private fixed(dt: number): void {
    this.t += dt;
    this.phaseT += dt;
    const tb = this.table;
    this.critterBrain.observe(tb, dt);
    this.critterBrain.think(tb, dt, tb.live);
    if (this.critterFloor > 0) tb.mallets[CRITTER].ty = Math.max(tb.mallets[CRITTER].ty, this.critterFloor);
    switch (this.phase) {
      case "drop":
        tb.step(dt);
        if (this.phaseT >= RULES.dropBeat) {
          this.place();
          this.phase = "play";
          this.phaseT = 0;
        }
        return;
      case "goal":
      case "lost":
      case "ko": {
        tb.step(dt);
        const beat = this.phase === "ko" ? RULES.koBeat : this.phase === "lost" ? RULES.lostBeat : this.lastGoalBy === CAT ? RULES.goalBeat : RULES.concedeBeat;
        if (this.phaseT >= beat) {
          if (this.phase === "ko" && this.pendingNext) {
            this.pendingNext = false;
            if (this.critter >= CRITTERS.length - 1) {
              this.finish(true);
              return;
            }
            this.critter++;
            this.critterBrain.brain = this.current.brain;
            this.me = 0;
            this.them = 0;
            this.deficit = 0;
            this.emit({ type: "next", critter: this.critter });
          }
          if (this.resetBout) {
            this.resetBout = false;
            this.me = 0;
            this.them = 0;
            this.deficit = 0;
          }
          this.startDrop(this.lastGoalBy === CAT ? CRITTER : CAT);
        }
        return;
      }
      case "play":
      case "lastShot":
        this.play(dt);
        return;
      default:
        return;
    }
  }

  private lastGoalBy: Side = CAT;

  private play(dt: number): void {
    const tb = this.table;
    const p = tb.puck;
    const pre = { x: p.x, y: p.y, vx: p.vx, vy: p.vy };
    const hits = tb.step(dt);
    for (const h of hits) this.onHit(h, pre);
    if (this.phase !== "play" && this.phase !== "lastShot") return;
    if (this.phase === "lastShot") {
      if (this.phaseT >= RULES.lastShot || Math.hypot(p.vx, p.vy) < 20 || p.y > L / 2 + 10) this.finish(false);
      return;
    }
    // The clock: the moon sinks a little faster the longer the night goes on.
    this.clock = Math.max(0, this.clock - dt * burn(this.t));
    if (!this.frenzy && this.clock <= RULES.frenzy && this.clock > 0) {
      this.frenzy = true;
      this.emit({ type: "frenzy" });
    } else if (this.frenzy && this.clock > RULES.frenzy + 0.5) {
      this.frenzy = false;
    }
    if (this.clock <= 0) {
      // A shot sliding toward the den at the buzzer gets to finish.
      const c = crossAt(p.x, p.y, p.vx, p.vy, 0, RULES.lastShot);
      if (p.vy < -40 && c && c.x > GX0 + 1 && c.x < GX1 - 1) {
        this.phase = "lastShot";
        this.phaseT = 0;
        this.emit({ type: "lastShot" });
      } else this.finish(false);
      return;
    }
    // A puck nobody can reach drifts back into play.
    if (tb.stillFor > RULES.drift && this.driftArmed) {
      const inCat = p.y > L / 2;
      if (inCat || tb.stillFor > RULES.drift + 1.2) {
        p.vx = (W / 2 - p.x) * 0.6;
        p.vy = inCat ? -72 : 72;
        tb.stillFor = 0;
        this.emit({ type: "drift" });
      }
    }
  }

  private onHit(h: Hit, pre: { x: number; y: number; vx: number; vy: number }): void {
    if (h.kind === "mallet") {
      // A mallet resting against the puck touches it every step; only a real knock counts (and only one per knock).
      if (h.impact < 14 || this.t - this.lastKnock[h.who]! < 0.07) {
        this.lastTouch = h.who;
        return;
      }
      this.lastKnock[h.who] = this.t;
      // Was it a shot on goal that the mallet just stopped?
      const goalY = h.who === CAT ? L : 0;
      const speed = Math.hypot(pre.vx, pre.vy);
      const toward = h.who === CAT ? pre.vy > 0 : pre.vy < 0;
      const c = toward ? crossAt(pre.x, pre.y, pre.vx, pre.vy, goalY, 0.9) : null;
      const onTarget = !!c && c.x > GX0 - PUCK_R && c.x < GX1 + PUCK_R && speed > 95 && this.lastTouch !== h.who;
      if (onTarget) {
        if (h.who === CAT) {
          this.stats.blocks++;
          const points = RULES.blockPts * (this.frenzy ? 2 : 1);
          this.score += points;
          this.emit({ type: "block", x: h.x, y: h.y, points });
        } else {
          this.stats.saved++;
          this.emit({ type: "saved", x: h.x, y: h.y });
        }
      }
      if (h.who === CAT && h.impact > 40) {
        const after = this.table.puck;
        if (after.vy < -60) this.stats.shots++;
      }
      this.lastTouch = h.who;
      this.railsSince = 0;
      this.emit({ type: "hit", who: h.who, speed: h.speed, impact: h.impact, x: h.x, y: h.y });
      return;
    }
    if (h.kind === "rail" || h.kind === "post") {
      if (h.kind === "rail" && (h.side === "left" || h.side === "right" || h.side === "corner")) this.railsSince++;
      this.emit({ type: "rail", speed: h.speed, x: h.x, y: h.y, post: h.kind === "post" });
      return;
    }
    // A goal.
    const buzzer = this.phase === "lastShot";
    if (h.into === CRITTER) {
      this.me++;
      this.stats.goals++;
      this.streak++;
      this.stats.bestStreak = Math.max(this.stats.bestStreak, this.streak);
      const before = multiplier(this.streak - 1);
      const mult = this.mult;
      const own = this.lastTouch === CRITTER;
      const bank = !own && this.railsSince > 0;
      const zinger = h.speed >= RULES.zinger;
      const f = this.frenzy || buzzer ? 2 : 1;
      let pts = RULES.goalPts;
      if (bank) pts += RULES.bankPts;
      if (zinger) pts += RULES.zingerPts;
      if (buzzer) pts += RULES.buzzerPts;
      const points = pts * mult * f;
      this.score += points;
      if (bank) this.stats.banks++;
      if (zinger) this.stats.zingers++;
      const time = buzzer ? 0 : RULES.goalTime[this.critter]!;
      this.clock = Math.min(RULES.cap, this.clock + time);
      this.lastGoalBy = CAT;
      this.emit({ type: "goal", by: CAT, x: h.x, speed: h.speed, points, bank, zinger, buzzer, own, streak: this.streak, mult, time, frenzy: this.frenzy });
      if (mult > before) this.emit({ type: "tier", mult });
      if (buzzer) {
        this.finish(false);
        return;
      }
      if (this.me >= this.boutTo) {
        const shutout = this.them === 0;
        const comeback = this.deficit >= 2;
        let points2 = RULES.koPts * (this.critter + 1);
        if (shutout) points2 += RULES.shutoutPts;
        if (comeback) {
          points2 += RULES.comebackPts;
          this.stats.comebacks++;
        }
        points2 *= this.frenzy ? 2 : 1;
        this.score += points2;
        this.stats.kos++;
        const koTime = RULES.koTime[this.critter]!;
        this.clock = Math.min(RULES.cap, this.clock + koTime);
        this.phase = "ko";
        this.phaseT = 0;
        this.pendingNext = true;
        this.emit({ type: "ko", critter: this.critter, points: points2, shutout, comeback, time: koTime });
        return;
      }
      this.phase = "goal";
      this.phaseT = 0;
      return;
    }
    // Conceded.
    this.them++;
    this.stats.against++;
    this.streak = 0;
    this.deficit = Math.max(this.deficit, this.them - this.me);
    this.lastGoalBy = CRITTER;
    this.emit({ type: "goal", by: CRITTER, x: h.x, speed: h.speed, points: 0, bank: false, zinger: false, buzzer, own: this.lastTouch === CAT, streak: 0, mult: 1, time: 0, frenzy: this.frenzy });
    if (buzzer) {
      this.finish(false);
      return;
    }
    if (this.them >= this.boutTo) {
      const time = this.t < RULES.grace ? 0 : RULES.lostBout;
      this.clock = Math.max(0.5, this.clock - time);
      this.stats.lostBouts++;
      this.resetBout = true;
      this.phase = "lost";
      this.phaseT = 0;
      this.emit({ type: "lostBout", critter: this.critter, time });
      return;
    }
    this.phase = "goal";
    this.phaseT = 0;
  }

  private finish(champion: boolean): void {
    let bonus = 0;
    if (champion) {
      bonus = Math.round(this.clock) * RULES.championPerSecond;
      this.score += bonus;
      this.stats.champion = true;
    }
    this.phase = "over";
    this.phaseT = 0;
    this.table.live = false;
    this.emit({ type: "over", champion, bonus });
  }
}

/** A brain-driven cat for the pilot: watches and plays the cat's mallet like a thumb would. */
export function pilotCat(brain: Brain, seed: number): { drive: (run: Run, dt: number) => void; controller: Controller } {
  const controller = new Controller(CAT, brain, createRng(seed));
  let wasLive = false;
  return {
    controller,
    drive(run, dt) {
      const live = run.phase === "play" || run.phase === "lastShot";
      if (live && !wasLive) controller.reset();
      wasLive = live;
      controller.observe(run.table, dt);
      controller.think(run.table, dt, live);
      const m = run.table.mallets[CAT];
      if (Math.hypot(m.vx, m.vy) > 20) run.stats.moved += dt;
    },
  };
}
