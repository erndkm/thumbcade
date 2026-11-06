import { describe, expect, it } from "vitest";
import { Chart, HOLD_MIN, LANES, MAX_L, MIN_L, nextLane, setList } from "../src/chart.ts";
import { chordTones, noteMidi, parseChords, parseMelody, SLOTS, SONGS } from "../src/songs.ts";
import { createRng } from "@thumbcade-games/kit/rng";

describe("the transcriptions", () => {
  for (const song of Object.values(SONGS)) {
    it(`${song.id}: every bar fills its time signature`, () => {
      const { bars } = parseMelody(song.melody);
      bars.forEach((ticks, i) => {
        const want = i === 0 && song.pickup ? song.pickup : song.bar;
        expect(ticks, `${song.id} bar ${i}`).toBe(want);
      });
    });
    it(`${song.id}: one chord group per bar`, () => {
      expect(parseChords(song.chords).length).toBe(parseMelody(song.melody).bars.length);
      for (const group of parseChords(song.chords)) for (const sym of group) chordTones(sym);
    });
    it(`${song.id}: stays in a singable range`, () => {
      const midis = parseMelody(song.melody).notes.flatMap((n) => (n.midi === null ? [] : [n.midi + 12 * song.octave]));
      expect(Math.min(...midis)).toBeGreaterThanOrEqual(noteMidi("G4"));
      expect(Math.max(...midis)).toBeLessThanOrEqual(noteMidi("G6"));
    });
  }

  it("reads note names", () => {
    expect(noteMidi("C4")).toBe(60);
    expect(noteMidi("A4")).toBe(69);
    expect(noteMidi("F#5")).toBe(78);
    expect(noteMidi("Bb3")).toBe(58);
    expect(() => noteMidi("H4")).toThrow();
  });

  it("builds chords with the bass between A2 and G#3", () => {
    expect(chordTones("C")).toEqual([48, 64, 67]);
    expect(chordTones("Am")).toEqual([45, 60, 64]);
    expect(chordTones("B5")).toEqual([47, 54]);
    expect(chordTones("-")).toBeNull();
    for (const sym of ["C", "D", "E", "F", "G", "A", "B", "F#"]) {
      const bass = chordTones(sym)![0]!;
      expect(bass).toBeGreaterThanOrEqual(45);
      expect(bass).toBeLessThanOrEqual(56);
    }
  });
});

describe("the chart", () => {
  it("lays every note of the set out as one tile, in time order", () => {
    const set = setList(42);
    const c = new Chart(set, 42);
    const notes = set.reduce((n, id) => {
      const s = SONGS[id]!;
      const per = parseMelody(s.melody).notes.filter((x) => x.midi !== null).length;
      const coda = s.coda ? parseMelody(s.coda.melody).notes.filter((x) => x.midi !== null).length : 0;
      return n + per * (s.passes?.length ?? 1) + coda;
    }, 0);
    expect(c.tiles.length).toBe(notes);
    for (let i = 1; i < c.tiles.length; i++) {
      expect(c.tiles[i]!.t).toBeGreaterThan(c.tiles[i - 1]!.t);
      expect(c.tiles[i]!.P).toBeGreaterThan(c.tiles[i - 1]!.P);
    }
  });

  it("keeps tiles in their lanes, apart from each other and readable", () => {
    for (const seed of [1, 2, 3, 99, 1234]) {
      const c = new Chart(setList(seed), seed);
      const lastInLane: Array<number | null> = Array.from({ length: LANES }, () => null);
      for (const tl of c.tiles) {
        expect(tl.lane).toBeGreaterThanOrEqual(0);
        expect(tl.lane).toBeLessThan(LANES);
        if (!tl.hold) expect(tl.L).toBeLessThanOrEqual(MAX_L + 1e-9);
        const prev = lastInLane[tl.lane];
        if (prev !== null && prev !== undefined) {
          const p = c.tiles[prev]!;
          // Never overlapping the tile before it in the same lane.
          expect(p.P + p.L).toBeLessThan(tl.P);
        }
        lastInLane[tl.lane] = tl.id;
      }
      // Tap tiles are at least MIN_L tall unless the next one in their lane is very close.
      const short = c.tiles.filter((t) => !t.hold && t.L < MIN_L - 1e-9);
      expect(short.length / c.tiles.length).toBeLessThan(0.1);
    }
  });

  it("makes long notes into holds and ends each tune on its last tile", () => {
    const c = new Chart(["ode"], 5);
    expect(c.tiles.filter((t) => t.hold).every((t) => t.dur >= HOLD_MIN)).toBe(true);
    expect(c.tiles.some((t) => t.hold)).toBe(true);
    expect(c.tiles[c.tiles.length - 1]!.last).toBe(true);
    expect(c.tiles.filter((t) => t.last).length).toBe(1);
  });

  it("is the same chart for the same seed, and a different layout for another", () => {
    const a = new Chart(["minuet"], 7).tiles.map((t) => t.lane).join("");
    const b = new Chart(["minuet"], 7).tiles.map((t) => t.lane).join("");
    const c = new Chart(["minuet"], 8).tiles.map((t) => t.lane).join("");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it("speeds the finale up pass by pass", () => {
    const c = new Chart(["mountain"], 3);
    const p = c.plays[0]!;
    expect(c.lead(p.start + 0.5)).toBeGreaterThan(c.lead(p.end - 0.5));
  });

  it("moves lanes with the melody: up goes right, down goes left, a repeat stays", () => {
    const rng = createRng(1);
    expect(nextLane(1, 2, rng)).toBe(2);
    expect(nextLane(2, -1, rng)).toBe(1);
    expect(nextLane(2, 0, rng)).toBe(2);
    for (let i = 0; i < 50; i++) {
      const l = nextLane(3, 4, rng);
      expect(l).toBeGreaterThanOrEqual(0);
      expect(l).toBeLessThan(3);
    }
  });

  it("picks one tune per slot, the finale last", () => {
    const seen = new Set<string>();
    for (let s = 0; s < 40; s++) {
      const set = setList(s);
      expect(set.length).toBe(SLOTS.length);
      set.forEach((id, i) => expect(SLOTS[i]).toContain(id));
      seen.add(set.join());
    }
    expect(seen.size).toBeGreaterThan(4);
  });
});
