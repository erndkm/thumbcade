import type { Rng } from "@thumbcade-games/kit";

/** The four micro-games. Pure data + hit-testing; main.ts animates and scores them. */

export type Kind = "wait" | "odd" | "ink" | "pop";

export const LABELS: Record<Kind, string> = {
  wait: "TAP WHEN IT TURNS",
  odd: "TAP THE ODD ONE",
  ink: "TAP THE INK, NOT THE WORD",
  pop: "TAP THE TARGET",
};

export interface InkColor {
  name: string;
  hex: string;
}

export const INKS: readonly InkColor[] = [
  { name: "RED", hex: "#FF4A3D" },
  { name: "BLUE", hex: "#4D8DFF" },
  { name: "GREEN", hex: "#3DDC84" },
  { name: "YELLOW", hex: "#FFD23F" },
];

export interface Area {
  x: number;
  y: number;
  size: number;
}

export interface Round {
  kind: Kind;
  /** Seconds allowed once the stimulus is live. */
  limit: number;
  /** Seconds since the round began. */
  t: number;
  /** When the stimulus goes live (wait: the hidden delay; others: after the intro). */
  liveAt: number;
  result: null | { ok: boolean; at: number; text: string; points: number; x: number; y: number };
  odd?: { n: number; index: number; hue: number; light: number; delta: number };
  ink?: { word: InkColor; ink: InkColor; options: InkColor[] };
  pop?: { x: number; y: number; r: number };
}

export function makeRound(kind: Kind, level: number, rng: Rng): Round {
  const d = Math.min(1, level / 24);
  const base: Round = { kind, limit: 1, t: 0, liveAt: 0.35, result: null };
  switch (kind) {
    case "wait":
      return { ...base, liveAt: rng.range(0.9, 2.6 - d * 0.6), limit: 0.75 - d * 0.33 };
    case "odd": {
      const n = level < 5 ? 3 : level < 12 ? 4 : 5;
      return {
        ...base,
        limit: 2.8 - d * 1.3,
        odd: { n, index: rng.int(0, n * n - 1), hue: rng.range(0, 360), light: rng.range(0.42, 0.56), delta: 0.16 - d * 0.1 },
      };
    }
    case "ink": {
      const word = rng.pick(INKS);
      let ink = rng.pick(INKS);
      while (ink === word) ink = rng.pick(INKS);
      const others = rng.shuffle(INKS.filter((c) => c !== ink)).slice(0, 2);
      // The word's own color is always one of the wrong answers: that's the trap.
      if (!others.includes(word)) others[0] = word;
      return { ...base, limit: 2.4 - d * 1.1, ink: { word, ink, options: rng.shuffle([ink, ...others]) } };
    }
    case "pop":
      return { ...base, limit: 1.5 - d * 0.6, pop: { x: rng.range(0.18, 0.82), y: rng.range(0.18, 0.82), r: 0.16 - d * 0.05 } };
  }
}

/** Cell rects of the odd-one grid. */
export function oddCells(r: Round, a: Area): Array<{ x: number; y: number; s: number }> {
  const n = r.odd!.n;
  const gap = a.size * 0.035;
  const s = (a.size - gap * (n - 1)) / n;
  const out: Array<{ x: number; y: number; s: number }> = [];
  for (let i = 0; i < n * n; i++) out.push({ x: a.x + (i % n) * (s + gap), y: a.y + Math.floor(i / n) * (s + gap), s });
  return out;
}

/** Swatch buttons of the ink round. */
export function inkButtons(a: Area): Array<{ x: number; y: number; w: number; h: number }> {
  const gap = a.size * 0.05;
  const w = (a.size - gap * 2) / 3;
  const h = Math.min(w * 0.9, a.size * 0.3);
  const y = a.y + a.size - h;
  return [0, 1, 2].map((i) => ({ x: a.x + i * (w + gap), y, w, h }));
}

/** Where the correct answer is (for the attract-mode ghost finger). */
export function answerPoint(r: Round, a: Area): { x: number; y: number } {
  switch (r.kind) {
    case "wait":
      return { x: a.x + a.size * 0.66, y: a.y + a.size * 0.7 };
    case "odd": {
      const c = oddCells(r, a)[r.odd!.index]!;
      return { x: c.x + c.s / 2, y: c.y + c.s / 2 };
    }
    case "ink": {
      const i = r.ink!.options.indexOf(r.ink!.ink);
      const b = inkButtons(a)[i]!;
      return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
    }
    case "pop":
      return { x: a.x + r.pop!.x * a.size, y: a.y + r.pop!.y * a.size };
  }
}

/** Judges a tap. Returns null when the tap should be ignored (e.g. between buttons). */
export function judge(r: Round, a: Area, x: number, y: number): { ok: boolean; text: string } | null {
  const live = r.t >= r.liveAt;
  switch (r.kind) {
    case "wait":
      return live ? { ok: true, text: "" } : { ok: false, text: "TOO SOON" };
    case "odd": {
      if (!live) return null;
      const cells = oddCells(r, a);
      const i = cells.findIndex((c) => x >= c.x && x <= c.x + c.s && y >= c.y && y <= c.y + c.s);
      if (i < 0) return null;
      return i === r.odd!.index ? { ok: true, text: "" } : { ok: false, text: "NOPE" };
    }
    case "ink": {
      if (!live) return null;
      const i = inkButtons(a).findIndex((b) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h);
      if (i < 0) return null;
      return r.ink!.options[i] === r.ink!.ink ? { ok: true, text: "" } : { ok: false, text: "THAT'S THE WORD" };
    }
    case "pop": {
      if (!live) return null;
      const k = Math.max(0, 1 - (r.t - r.liveAt) / r.limit);
      const p = answerPoint(r, a);
      const rad = r.pop!.r * a.size * (0.45 + 0.55 * k);
      return Math.hypot(x - p.x, y - p.y) <= rad + 14 ? { ok: true, text: "" } : { ok: false, text: "MISSED IT" };
    }
  }
}
