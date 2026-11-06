/**
 * Turns a set list into a roll of tiles. Every melody note becomes one tile at the moment it sounds, so a player who
 * taps each tile as it meets the line plays the tune in time. Lanes follow the shape of the melody (up moves right,
 * down moves left, a repeated note stays put), with a little seeded variety, so the same tune never lays out quite
 * the same way twice. Long notes become hold tiles.
 *
 * Distances on the roll are in "units": one unit is the distance from the top of the screen to the strike line. The
 * roll moves at 1 / lead units per second, where lead is the time a tile takes from the top edge to the line.
 */
import { createRng, type Rng } from "@thumbcade-games/kit/rng";
import { chordTones, parseChords, parseMelody, SLOTS, SONGS, type Song } from "./songs.ts";

export const LANES = 4;
/** Notes at least this long (seconds) become hold tiles. */
export const HOLD_MIN = 0.7;
/** Seconds between the end of one tune and the first note of the next (the title card). */
export const GAP = 2.0;
/** Seconds from the tap that starts a run to the first tile reaching the line. */
export const LEAD_IN = 1.8;
/** Shortest and longest drawn tap tile, in units. */
export const MIN_L = 0.118;
export const MAX_L = 0.24;
/** Paper left between two tiles in one lane, in units. */
export const LANE_GAP = 0.03;
/** Lead (seconds from the top edge to the line) per slot; the finale speeds up pass by pass. */
export const LEADS = [1.62, 1.42, 1.28];
export const FINALE_LEADS = [1.2, 1.1, 1.0, 0.92];

export interface Tile {
  id: number;
  /** Slot in the set (0-based). */
  slot: number;
  /** Pass of a multi-pass tune (the finale), else 0. */
  pass: number;
  lane: number;
  /** Seconds (roll clock) when the head reaches the line. */
  t: number;
  /** Length of the note in seconds. */
  dur: number;
  hold: boolean;
  /** Sounding MIDI note. */
  midi: number;
  /** Chord to sound with this tile (bass first), if a chord starts here. */
  chord: number[] | null;
  /** Roll position of the head and drawn length, in units. */
  P: number;
  L: number;
  /** Last tile of its tune. */
  last: boolean;
}

export interface Play {
  slot: number;
  song: Song;
  /** Seconds (roll clock) of the first note and the end of the last. */
  start: number;
  end: number;
  first: number;
  /** Index after the last tile. */
  stop: number;
}

const TABLE_HZ = 240;

export class Chart {
  readonly tiles: Tile[] = [];
  readonly plays: Play[] = [];
  /** Roll clock when the last tile has finished. */
  readonly end: number;
  private readonly table: Float64Array;
  private readonly keys: Array<[number, number]> = [];

  constructor(ids: string[], seed: number, opts: { leadIn?: number; leads?: number[] } = {}) {
    const leads = opts.leads ?? LEADS;
    const rng = createRng(seed);
    let t = opts.leadIn ?? LEAD_IN;
    let lane = rng.int(1, 2);
    let prev: number | null = null;
    ids.forEach((id, slot) => {
      const song = SONGS[id];
      if (!song) throw new Error(`no song "${id}"`);
      const first = this.tiles.length;
      const start = t;
      const passes = song.passes ?? [{ bpm: song.bpm, shift: 0 }];
      const finale = !!song.passes;
      passes.forEach((p, pi) => {
        const lead = finale ? FINALE_LEADS[Math.min(pi, FINALE_LEADS.length - 1)]! : leads[Math.min(slot, leads.length - 1)]!;
        const len = this.lay(song.melody, song.chords, p.bpm, song.octave + p.shift, t, slot, pi, rng, lane, prev);
        lane = len.lane;
        prev = len.prev;
        if (pi === 0) this.keys.push([t - (slot === 0 ? 10 : 0), lead]);
        else {
          // Speed up over the last beat of the previous pass.
          this.keys.push([t - 60 / passes[pi - 1]!.bpm, this.keys[this.keys.length - 1]![1]]);
          this.keys.push([t, lead]);
        }
        t = len.end;
      });
      if (song.coda) {
        const last = passes[passes.length - 1]!;
        const len = this.lay(song.coda.melody, song.coda.chord, last.bpm, song.octave + last.shift, t, slot, passes.length - 1, rng, lane, prev);
        lane = len.lane;
        prev = len.prev;
        t = len.end;
      }
      this.keys.push([t, this.keys[this.keys.length - 1]![1]]);
      const stop = this.tiles.length;
      if (stop > first) this.tiles[stop - 1]!.last = true;
      this.plays.push({ slot, song, start, end: t, first, stop });
      t += GAP;
    });
    this.end = this.plays.length ? this.plays[this.plays.length - 1]!.end : 0;

    // The roll's position over time: the integral of 1 / lead, with lead eased linearly between keyframes.
    const n = Math.ceil((this.end + 12) * TABLE_HZ) + 2;
    this.table = new Float64Array(n);
    let s = 0;
    for (let i = 1; i < n; i++) {
      const tm = (i - 0.5) / TABLE_HZ;
      s += 1 / this.lead(tm) / TABLE_HZ;
      this.table[i] = s;
    }
    this.place();
  }

  /** Lead (seconds from the top edge to the line) at roll time t. */
  lead(t: number): number {
    const k = this.keys;
    if (!k.length) return LEADS[0]!;
    if (t <= k[0]![0]) return k[0]![1];
    for (let i = 1; i < k.length; i++) {
      const [t1, l1] = k[i]!;
      if (t <= t1) {
        const [t0, l0] = k[i - 1]!;
        return t1 <= t0 ? l1 : l0 + (l1 - l0) * ((t - t0) / (t1 - t0));
      }
    }
    return k[k.length - 1]![1];
  }

  /** Roll position (units) at roll time t. */
  pos(t: number): number {
    if (t <= 0) return t / this.lead(0);
    const x = t * TABLE_HZ;
    const i = Math.floor(x);
    if (i >= this.table.length - 1) return this.table[this.table.length - 1]! + (t - (this.table.length - 1) / TABLE_HZ) / this.lead(t);
    const f = x - i;
    return this.table[i]! + (this.table[i + 1]! - this.table[i]!) * f;
  }

  /** The tune playing (or about to) at roll time t. */
  playAt(t: number): Play | null {
    for (const p of this.plays) if (t < p.end + GAP * 0.5) return p;
    return this.plays[this.plays.length - 1] ?? null;
  }

  private lay(
    melody: string,
    chords: string,
    bpm: number,
    octave: number,
    t0: number,
    slot: number,
    pass: number,
    rng: Rng,
    lane0: number,
    prev0: number | null,
  ): { end: number; lane: number; prev: number | null } {
    const tick = 60 / bpm / 4;
    const { notes, bars } = parseMelody(melody);
    const barChords = parseChords(chords);
    // Bar start ticks.
    const barStart: number[] = [];
    let acc = 0;
    for (const b of bars) {
      barStart.push(acc);
      acc += b;
    }
    // Which notes start a chord: the first note at or after each chord's start, inside its span.
    const chordAt = new Map<number, number[]>();
    barChords.forEach((syms, b) => {
      const s0 = barStart[b] ?? 0;
      const span = bars[b] ?? 0;
      syms.forEach((sym, ci) => {
        const tones = chordTones(sym);
        if (!tones) return;
        const from = s0 + (span * ci) / syms.length;
        const to = s0 + (span * (ci + 1)) / syms.length;
        const idx = notes.findIndex((nt) => nt.midi !== null && nt.at >= from && nt.at < to);
        if (idx >= 0) chordAt.set(idx, tones);
      });
    });
    let lane = lane0;
    let prev = prev0;
    notes.forEach((nt, i) => {
      if (nt.midi === null) return;
      if (prev !== null) lane = nextLane(lane, nt.midi - prev, rng);
      prev = nt.midi;
      const dur = nt.ticks * tick;
      this.tiles.push({
        id: this.tiles.length,
        slot,
        pass,
        lane,
        t: t0 + nt.at * tick,
        dur,
        hold: dur >= HOLD_MIN,
        midi: nt.midi + 12 * octave,
        chord: chordAt.get(i) ?? null,
        P: 0,
        L: 0,
        last: false,
      });
    });
    return { end: t0 + acc * tick, lane, prev };
  }

  /** Roll positions and drawn lengths. */
  private place(): void {
    const nextInLane: Array<Tile | null> = Array.from({ length: LANES }, () => null);
    for (let i = this.tiles.length - 1; i >= 0; i--) {
      const tl = this.tiles[i]!;
      tl.P = this.pos(tl.t);
      const span = this.pos(tl.t + tl.dur) - tl.P;
      let L = tl.hold ? span - LANE_GAP : Math.min(MAX_L, Math.max(MIN_L, span * 0.92));
      const nx = nextInLane[tl.lane];
      if (nx) L = Math.min(L, nx.P - tl.P - LANE_GAP);
      tl.L = Math.max(0.05, L);
      nextInLane[tl.lane] = tl;
    }
  }
}

/** The lane after `lane` for a melodic step of `d` semitones. */
export function nextLane(lane: number, d: number, rng: Rng): number {
  if (d === 0) return lane;
  const dir = Math.sign(d);
  const step = Math.abs(d) >= 5 && rng() < 0.55 ? 2 : 1;
  let nl = lane + dir * step;
  if (nl < 0 || nl >= LANES) nl = lane + dir;
  if (nl < 0 || nl >= LANES) {
    // At the edge: turn back, one or two lanes.
    nl = lane - dir * (rng() < 0.6 ? 1 : 2);
  }
  return Math.max(0, Math.min(LANES - 1, nl));
}

/** The set list for a run: one tune per slot. */
export function setList(seed: number): string[] {
  const rng = createRng((seed ^ 0x5bd1e995) >>> 0);
  return SLOTS.map((pool) => rng.pick(pool));
}
