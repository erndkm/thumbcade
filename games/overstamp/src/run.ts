/**
 * One run: sheets dealt against a clock. Lift a free slip and it goes to the tray beside its own kind; three alike
 * are sealed and leave. Clearing a sheet winds the clock back and deals a bigger one. Pure and time-stepped, so the
 * game, the pilot and the tests all play the same rules.
 */
import { createRng, type Rng } from "@thumbcade-games/kit/rng";
import { freeSlips, isFree, planFor, type Slip } from "./board.ts";
import { dealSheet, riffleSheet, TRAY } from "./deal.ts";

export const TUNE = {
  /** Seconds on the clock at the first tap. */
  clock: 24,
  /** The clock never holds more than this. */
  clockMax: 45,
  /** Seconds a sealed triple gives back. */
  tripleTime: 1,
  /** Seconds a cleared sheet gives back: the first, then less each sheet down to the floor. */
  sheetTime: 9,
  sheetTimeStep: 0.5,
  sheetTimeMin: 5,
  /** The clock burns 1 + (t / burnScale)^burnPow seconds a second. */
  burnScale: 75,
  burnPow: 1.35,
  /** A triple within this many seconds of the last one keeps the run of seals going. */
  comboWindow: 2.5,
  /** Points for a triple, times the multiplier of the run of seals it belongs to. */
  triplePoints: 30,
  /** The run of seals that reaches each multiplier: ×2 at two in a row, ×3 at four, ×4 at seven, ×5 at eleven. */
  comboTiers: [2, 4, 7, 11],
  /** A slip that comes free. */
  revealPoints: 3,
  /** The last slip of a layer above the bottom: per layer number. */
  layerPoints: 40,
  layerTime: 0.5,
  /** A cleared sheet: per sheet number, plus per second left on the clock. */
  sheetPoints: 250,
  clockPoints: 10,
  /** Seconds the clock stands still while a cleared sheet is celebrated and the next one dealt. */
  dealPause: 1.5,
  /** Paper clips (send the last three back) held at most, and riffles. */
  clipsMax: 2,
  rifflesMax: 1,
  /** A run of this many seals earns a riffle. */
  riffleAt: 4,
  /** A full tray this early in a run is always forgiven, however often. */
  safeStart: 15,
} as const;

export type Ending = "time" | "full";

/** The multiplier for the n-th seal in a row. */
export function multiplier(combo: number): number {
  let m = 1;
  for (const t of TUNE.comboTiers) if (combo >= t) m++;
  return m;
}

export type RunEvent =
  | { type: "lift"; id: number; kind: number; slot: number }
  | { type: "seal"; kind: number; ids: number[]; combo: number; mult: number; tierUp: boolean; points: number; slot: number }
  | { type: "reveal"; ids: number[] }
  | { type: "layer"; z: number; points: number }
  | { type: "sheet"; sheet: number; points: number; time: number; clip: boolean }
  | { type: "deal"; sheet: number }
  | { type: "covered"; id: number }
  | { type: "back"; ids: number[]; why: "grace" | "clip" }
  | { type: "riffle"; ok: boolean }
  | { type: "earn"; what: "clip" | "riffle" }
  | { type: "over"; why: Ending };

export interface RunStats {
  sheets: number;
  triples: number;
  bestCombo: number;
  fills: number;
  clipsUsed: number;
  riffles: number;
  coveredTaps: number;
  /** Seconds from the first tap. */
  seconds: number;
  /** Most slips held in the tray at once. */
  peak: number;
  /** Lifts that started a new kind while another kind already had two in the tray. */
  scatter: number;
}

/** A slip in the tray: which slip it was and its kind. Kept grouped by kind, oldest first within a group. */
export interface TraySlip {
  id: number;
  kind: number;
  /** Lift order, for sending the last three back. */
  n: number;
}

export class Run {
  readonly rng: Rng;
  t = 0;
  clock: number = TUNE.clock;
  sheet = 0;
  slips: Slip[] = [];
  above: number[][] = [];
  witness: number[] = [];
  tray: TraySlip[] = [];
  score = 0;
  combo = 0;
  sinceSeal = Infinity;
  /** Seconds left in the pause between sheets (the clock stands still). */
  pause = 0;
  graceUsed = false;
  clips = 0;
  riffles = 0;
  over: Ending | null = null;
  liftCount = 0;
  stats: RunStats = { sheets: 0, triples: 0, bestCombo: 0, fills: 0, clipsUsed: 0, riffles: 0, coveredTaps: 0, seconds: 0, peak: 0, scatter: 0 };
  private free = new Set<number>();

  constructor(seed: number) {
    this.rng = createRng(seed);
    this.nextSheet();
  }

  get live(): boolean {
    return this.over === null;
  }

  /** Seconds the clock burns per second right now. */
  get burn(): number {
    return 1 + (this.t / TUNE.burnScale) ** TUNE.burnPow;
  }

  get heapLeft(): number {
    let n = 0;
    for (const s of this.slips) if (!s.gone) n++;
    return n;
  }

  isFree(id: number): boolean {
    return isFree(this.slips, this.above, id);
  }

  freeIds(): number[] {
    return freeSlips(this.slips, this.above);
  }

  /** How many of `kind` sit in the tray. */
  inTray(kind: number): number {
    let n = 0;
    for (const s of this.tray) if (s.kind === kind) n++;
    return n;
  }

  private nextSheet(): RunEvent {
    this.sheet++;
    const d = dealSheet(planFor(this.sheet), this.rng);
    this.slips = d.slips;
    this.above = d.above;
    this.witness = d.witness;
    this.graceUsed = false;
    this.free = new Set(this.freeIds());
    return { type: "deal", sheet: this.sheet };
  }

  /** Advances the clock. Returns what happened (the clock running out). */
  step(dt: number): RunEvent[] {
    if (!this.live) return [];
    if (this.pause > 0) {
      this.pause = Math.max(0, this.pause - dt);
      return [];
    }
    this.t += dt;
    this.stats.seconds = this.t;
    this.sinceSeal += dt;
    if (this.sinceSeal > TUNE.comboWindow) this.combo = 0;
    this.clock -= dt * this.burn;
    if (this.clock <= 0) {
      this.clock = 0;
      this.over = "time";
      return [{ type: "over", why: "time" }];
    }
    return [];
  }

  /** Lifts slip `id` into the tray, if it is free. */
  tap(id: number): RunEvent[] {
    if (!this.live || this.pause > 0) return [];
    const s = this.slips[id];
    if (!s || s.gone) return [];
    if (!this.isFree(id)) {
      this.stats.coveredTaps++;
      return [{ type: "covered", id }];
    }
    const out: RunEvent[] = [];
    if (this.tray.some((t) => this.inTray(t.kind) === 2) && this.inTray(s.type) === 0) this.stats.scatter++;
    s.gone = true;
    // Beside its own kind, or at the end.
    let at = this.tray.length;
    for (let i = this.tray.length - 1; i >= 0; i--) {
      if (this.tray[i]!.kind === s.type) {
        at = i + 1;
        break;
      }
    }
    this.tray.splice(at, 0, { id, kind: s.type, n: ++this.liftCount });
    out.push({ type: "lift", id, kind: s.type, slot: at });
    this.stats.peak = Math.max(this.stats.peak, this.tray.length);
    // Slips that came free.
    const nowFree = this.freeIds();
    const revealed = nowFree.filter((i) => !this.free.has(i));
    this.free = new Set(nowFree);
    if (revealed.length) {
      this.score += revealed.length * TUNE.revealPoints;
      out.push({ type: "reveal", ids: revealed });
    }
    // The last slip of a layer.
    if (s.z > 0 && !this.slips.some((o) => !o.gone && o.z === s.z)) {
      const pts = TUNE.layerPoints * s.z;
      this.score += pts;
      this.addClock(TUNE.layerTime);
      out.push({ type: "layer", z: s.z, points: pts });
    }
    // Three alike.
    const same = this.tray.filter((t) => t.kind === s.type);
    if (same.length === 3) {
      const slot = this.tray.indexOf(same[0]!);
      this.tray = this.tray.filter((t) => t.kind !== s.type);
      this.combo = this.sinceSeal <= TUNE.comboWindow ? this.combo + 1 : 1;
      this.sinceSeal = 0;
      const mult = multiplier(this.combo);
      const pts = TUNE.triplePoints * mult;
      this.score += pts;
      this.addClock(TUNE.tripleTime);
      this.stats.triples++;
      this.stats.bestCombo = Math.max(this.stats.bestCombo, this.combo);
      out.push({ type: "seal", kind: s.type, ids: same.map((t) => t.id), combo: this.combo, mult, tierUp: mult > multiplier(this.combo - 1), points: pts, slot });
      if (this.combo === TUNE.riffleAt && this.riffles < TUNE.rifflesMax) {
        this.riffles++;
        out.push({ type: "earn", what: "riffle" });
      }
    } else if (this.tray.length >= TRAY) {
      // A full tray: the sheet's one grace, then a paper clip, then the end.
      this.stats.fills++;
      if (!this.graceUsed || this.t < TUNE.safeStart) {
        this.graceUsed = true;
        out.push(this.sendBack("grace"));
      } else if (this.clips > 0) {
        this.clips--;
        this.stats.clipsUsed++;
        out.push(this.sendBack("clip"));
      } else {
        this.over = "full";
        out.push({ type: "over", why: "full" });
        return out;
      }
    }
    if (this.heapLeft === 0 && this.tray.length === 0) out.push(...this.clearSheet());
    return out;
  }

  private addClock(s: number) {
    this.clock = Math.min(TUNE.clockMax, this.clock + s);
  }

  private clearSheet(): RunEvent[] {
    const n = this.sheet;
    const time = Math.max(TUNE.sheetTimeMin, TUNE.sheetTime - TUNE.sheetTimeStep * (n - 1));
    const pts = TUNE.sheetPoints * n + Math.round(this.clock) * TUNE.clockPoints;
    this.score += pts;
    this.addClock(time);
    this.stats.sheets++;
    const clip = this.clips < TUNE.clipsMax;
    if (clip) this.clips++;
    this.pause = TUNE.dealPause;
    const out: RunEvent[] = [{ type: "sheet", sheet: n, points: pts, time, clip }];
    if (clip) out.push({ type: "earn", what: "clip" });
    out.push(this.nextSheet());
    return out;
  }

  /** The last three slips lifted go back to the heap, where they lay. */
  private sendBack(why: "grace" | "clip"): RunEvent {
    const last = [...this.tray].sort((a, b) => b.n - a.n).slice(0, 3);
    const ids = new Set(last.map((t) => t.id));
    this.tray = this.tray.filter((t) => !ids.has(t.id));
    for (const id of ids) this.slips[id]!.gone = false;
    this.free = new Set(this.freeIds());
    return { type: "back", ids: [...ids], why };
  }

  /** Uses a paper clip by hand. */
  clip(): RunEvent[] {
    if (!this.live || this.pause > 0 || this.clips <= 0 || this.tray.length === 0) return [];
    this.clips--;
    this.stats.clipsUsed++;
    return [this.sendBack("clip")];
  }

  /** Uses a riffle: the kinds left on the heap are dealt again so the sheet can be cleared from this tray. */
  riffle(): RunEvent[] {
    if (!this.live || this.pause > 0 || this.riffles <= 0 || this.heapLeft === 0) return [];
    const ok = riffleSheet(this.slips, this.above, this.tray.map((t) => t.kind), this.rng);
    if (ok) {
      this.riffles--;
      this.stats.riffles++;
    }
    return [{ type: "riffle", ok }];
  }
}
