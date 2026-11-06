/**
 * The set list. Every tune is a public-domain composition (composers who died more than seventy years ago, or
 * traditional), transcribed here note by note as a plain melody with a simple chord per bar. No recording, score
 * edition or arrangement was copied; the game synthesizes everything itself.
 *
 * Melody notation: space-separated tokens, `|` between bars (bars are checked against the time signature in the
 * tests). A note is `<name><octave>:<ticks>` with ticks in sixteenth notes (`E4:4` is a quarter-note E above middle
 * C); a rest is `r:<ticks>`. Chords: one or two per bar, `|`-separated like the melody; `-` is none, `B5` a bare
 * fifth.
 */

export interface Song {
  id: string;
  title: string;
  composer: string;
  /** Ticks (sixteenth notes) per bar. */
  bar: number;
  /** Ticks in the first bar when it is a pickup (anacrusis). */
  pickup?: number;
  /** Quarter-note tempo. */
  bpm: number;
  melody: string;
  chords: string;
  /** Octaves the melody sounds above the written pitch. */
  octave: number;
  /**
   * Played several times, each pass at its own tempo and octave shift (the finale's accelerando). Without it the
   * song plays once at `bpm`.
   */
  passes?: Array<{ bpm: number; shift: number }>;
  /** Played once after the last pass (melody, chord). */
  coda?: { melody: string; chord: string };
}

export const SONGS: Record<string, Song> = {
  ode: {
    id: "ode",
    title: "ODE TO JOY",
    composer: "BEETHOVEN",
    bar: 16,
    bpm: 126,
    octave: 1,
    melody:
      "E4:4 E4:4 F4:4 G4:4 | G4:4 F4:4 E4:4 D4:4 | C4:4 C4:4 D4:4 E4:4 | E4:6 D4:2 D4:8 | " +
      "E4:4 E4:4 F4:4 G4:4 | G4:4 F4:4 E4:4 D4:4 | C4:4 C4:4 D4:4 E4:4 | D4:6 C4:2 C4:8",
    chords: "C | G | C | G | C | G | C | G C",
  },
  frere: {
    id: "frere",
    title: "FRÈRE JACQUES",
    composer: "TRADITIONAL",
    bar: 16,
    bpm: 112,
    octave: 1,
    melody:
      "C4:4 D4:4 E4:4 C4:4 | C4:4 D4:4 E4:4 C4:4 | E4:4 F4:4 G4:8 | E4:4 F4:4 G4:8 | " +
      "G4:2 A4:2 G4:2 F4:2 E4:4 C4:4 | G4:2 A4:2 G4:2 F4:2 E4:4 C4:4 | C4:4 G3:4 C4:8 | C4:4 G3:4 C4:8",
    chords: "C | Am | C | Am | C | Am | C | G C",
  },
  minuet: {
    id: "minuet",
    title: "MINUET IN G",
    composer: "PETZOLD",
    bar: 12,
    bpm: 138,
    octave: 1,
    melody:
      "D5:4 G4:2 A4:2 B4:2 C5:2 | D5:4 G4:4 G4:4 | E5:4 C5:2 D5:2 E5:2 F#5:2 | G5:4 G4:4 G4:4 | " +
      "C5:4 D5:2 C5:2 B4:2 A4:2 | B4:4 C5:2 B4:2 A4:2 G4:2 | F#4:4 G4:2 A4:2 B4:2 G4:2 | A4:12 | " +
      "D5:4 G4:2 A4:2 B4:2 C5:2 | D5:4 G4:4 G4:4 | E5:4 C5:2 D5:2 E5:2 F#5:2 | G5:4 G4:4 G4:4 | " +
      "C5:4 D5:2 C5:2 B4:2 A4:2 | B4:4 C5:2 B4:2 A4:2 G4:2 | A4:4 B4:2 A4:2 G4:2 F#4:2 | G4:12",
    chords: "G | G | C | G | C | G | D | D | G | G | C | G | C | G | D | G",
  },
  greensleeves: {
    id: "greensleeves",
    title: "GREENSLEEVES",
    composer: "TRADITIONAL",
    bar: 12,
    pickup: 2,
    bpm: 124,
    octave: 1,
    melody:
      "A4:2 | C5:4 D5:2 E5:3 F5:1 E5:2 | D5:4 B4:2 G4:3 A4:1 B4:2 | C5:4 A4:2 A4:3 G#4:1 A4:2 | B4:4 G#4:2 E4:4 A4:2 | " +
      "C5:4 D5:2 E5:3 F5:1 E5:2 | D5:4 B4:2 G4:3 A4:1 B4:2 | C5:3 B4:1 A4:2 G#4:3 F#4:1 G#4:2 | A4:10 r:2 | " +
      "G5:6 G5:3 F#5:1 E5:2 | D5:4 B4:2 G4:3 A4:1 B4:2 | C5:4 A4:2 A4:3 G#4:1 A4:2 | B4:4 G#4:2 E4:6 | " +
      "G5:6 G5:3 F#5:1 E5:2 | D5:4 B4:2 G4:3 A4:1 B4:2 | C5:3 B4:1 A4:2 G#4:3 F#4:1 G#4:2 | A4:12",
    chords: "- | Am | G | Am | E | Am | G | Am E | Am | C | G | Am | E | C | G | Am E | Am",
  },
  elise: {
    id: "elise",
    title: "FÜR ELISE",
    composer: "BEETHOVEN",
    bar: 6,
    pickup: 2,
    bpm: 75,
    octave: 1,
    melody:
      "E5:1 D#5:1 | E5:1 D#5:1 E5:1 B4:1 D5:1 C5:1 | A4:2 r:1 C4:1 E4:1 A4:1 | B4:2 r:1 E4:1 G#4:1 B4:1 | " +
      "C5:2 r:1 E4:1 E5:1 D#5:1 | E5:1 D#5:1 E5:1 B4:1 D5:1 C5:1 | A4:2 r:1 C4:1 E4:1 A4:1 | B4:2 r:1 E4:1 C5:1 B4:1 | " +
      "A4:2 r:2 E5:1 D#5:1 | E5:1 D#5:1 E5:1 B4:1 D5:1 C5:1 | A4:2 r:1 C4:1 E4:1 A4:1 | B4:2 r:1 E4:1 G#4:1 B4:1 | " +
      "C5:2 r:1 E4:1 E5:1 D#5:1 | E5:1 D#5:1 E5:1 B4:1 D5:1 C5:1 | A4:2 r:1 C4:1 E4:1 A4:1 | B4:2 r:1 E4:1 C5:1 B4:1 | A4:6",
    chords: "- | - | Am | E | Am | - | Am | E | Am | - | Am | E | Am | - | Am | E | Am",
  },
  cancan: {
    id: "cancan",
    title: "CAN-CAN",
    composer: "OFFENBACH",
    bar: 8,
    bpm: 92,
    octave: 1,
    melody:
      "C4:4 D4:1 F4:1 E4:1 D4:1 | G4:4 G4:4 | G4:1 A4:1 E4:1 F4:1 D4:4 | D4:4 D4:1 F4:1 E4:1 D4:1 | C4:1 C5:1 B4:1 A4:1 G4:1 F4:1 E4:1 D4:1 | " +
      "C4:4 D4:1 F4:1 E4:1 D4:1 | G4:4 G4:4 | G4:1 A4:1 E4:1 F4:1 D4:4 | D4:4 D4:1 F4:1 E4:1 D4:1 | C4:1 C5:1 B4:1 A4:1 G4:1 F4:1 E4:1 D4:1 | " +
      "C4:4 D4:1 F4:1 E4:1 D4:1 | G4:4 G4:4 | G4:1 A4:1 E4:1 F4:1 D4:4 | D4:4 D4:1 F4:1 E4:1 D4:1 | C4:1 G4:1 D4:1 E4:1 C4:4",
    chords: "C | C | G | G | C G | C | C | G | G | C G | C | C | G | G | G C",
  },
  mountain: {
    id: "mountain",
    title: "MOUNTAIN KING",
    composer: "GRIEG",
    bar: 16,
    bpm: 126,
    octave: 1,
    melody:
      "B3:2 C#4:2 D4:2 E4:2 F#4:2 D4:2 F#4:4 | F4:2 C#4:2 F4:4 E4:2 C4:2 E4:4 | " +
      "B3:2 C#4:2 D4:2 E4:2 F#4:2 D4:2 F#4:2 B4:2 | A4:2 F#4:2 D4:2 F#4:2 A4:8",
    chords: "B5 | F#5 | B5 | F#5",
    passes: [
      { bpm: 136, shift: 0 },
      { bpm: 158, shift: 0 },
      { bpm: 182, shift: 1 },
      { bpm: 210, shift: 1 },
    ],
    coda: { melody: "B4:8", chord: "Bm" },
  },
};

/** One tune per slot: an easy opener, a middle, a hard one and the finale. */
export const SLOTS: string[][] = [["ode", "frere"], ["minuet", "greensleeves"], ["elise", "cancan"], ["mountain"]];

export interface Note {
  /** MIDI note number (written pitch), or null for a rest. */
  midi: number | null;
  /** Start in ticks from the song's first tick. */
  at: number;
  ticks: number;
  bar: number;
}

const STEPS: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

export function noteMidi(name: string): number {
  const m = /^([A-G])(#|b)?(-?\d)$/.exec(name);
  if (!m) throw new Error(`bad note "${name}"`);
  const acc = m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0;
  return (Number(m[3]) + 1) * 12 + STEPS[m[1]!]! + acc;
}

/** Splits a melody into notes with their tick positions and bar numbers. */
export function parseMelody(melody: string): { notes: Note[]; bars: number[] } {
  const notes: Note[] = [];
  const bars: number[] = [];
  let at = 0;
  let bar = 0;
  let barTicks = 0;
  for (const tok of melody.trim().split(/\s+/)) {
    if (tok === "|") {
      bars.push(barTicks);
      bar++;
      barTicks = 0;
      continue;
    }
    const [name, len] = tok.split(":");
    const ticks = Number(len);
    if (!name || !Number.isInteger(ticks) || ticks <= 0) throw new Error(`bad token "${tok}"`);
    notes.push({ midi: name === "r" ? null : noteMidi(name), at, ticks, bar });
    at += ticks;
    barTicks += ticks;
  }
  bars.push(barTicks);
  return { notes, bars };
}

/** Chord tones (root in octave 3, then the rest of the triad above it), or null for "-". */
export function chordTones(sym: string): number[] | null {
  if (sym === "-") return null;
  const m = /^([A-G])(#|b)?(m|5)?$/.exec(sym);
  if (!m) throw new Error(`bad chord "${sym}"`);
  const acc = m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0;
  let root = 48 + STEPS[m[1]!]! + acc;
  // Keep the bass between A2 and G#3.
  if (root > 56) root -= 12;
  if (m[3] === "5") return [root, root + 7];
  return [root, root + (m[3] === "m" ? 3 : 4) + 12, root + 7 + 12];
}

/** The chords of each bar: one symbol fills the bar, two split it in halves. */
export function parseChords(chords: string): string[][] {
  return chords.split("|").map((b) => b.trim().split(/\s+/));
}
