/**
 * Jost's advance widths (em) for printable ASCII plus ×, · and →, measured from the bundled Light and Medium faces in
 * Chromium. The tests use them to check that every line of copy fits its plate without a canvas; the game measures
 * with the canvas itself (`type.ts`).
 */
const EXTRA = "×·→";

const LIGHT = [0.3, 0.285, 0.44, 0.591, 0.58, 0.731, 0.675, 0.26, 0.282, 0.282, 0.592, 0.589, 0.295, 0.21, 0.284, 0.499, 0.58, 0.434, 0.547, 0.548, 0.571, 0.561, 0.56, 0.521, 0.534, 0.56, 0.3, 0.308, 0.64, 0.615, 0.64, 0.551, 0.77, 0.636, 0.533, 0.685, 0.662, 0.534, 0.48, 0.771, 0.688, 0.219, 0.223, 0.521, 0.442, 0.818, 0.755, 0.784, 0.521, 0.782, 0.523, 0.524, 0.451, 0.606, 0.636, 0.974, 0.533, 0.539, 0.541, 0.284, 0.483, 0.284, 0.51, 0.5, 0.366, 0.463, 0.558, 0.482, 0.558, 0.51, 0.283, 0.558, 0.505, 0.232, 0.222, 0.413, 0.21, 0.744, 0.505, 0.55, 0.558, 0.558, 0.322, 0.403, 0.22, 0.505, 0.432, 0.656, 0.404, 0.434, 0.448, 0.299, 0.248, 0.299, 0.575, 0.589, 0.277, 1];
const MEDIUM = [0.3, 0.318, 0.486, 0.63, 0.597, 0.819, 0.706, 0.294, 0.323, 0.323, 0.592, 0.639, 0.314, 0.215, 0.309, 0.553, 0.625, 0.474, 0.604, 0.576, 0.629, 0.597, 0.614, 0.556, 0.579, 0.614, 0.309, 0.355, 0.64, 0.62, 0.64, 0.585, 0.77, 0.69, 0.601, 0.691, 0.701, 0.571, 0.521, 0.791, 0.744, 0.275, 0.276, 0.619, 0.481, 0.843, 0.783, 0.803, 0.578, 0.82, 0.595, 0.579, 0.504, 0.656, 0.69, 1.02, 0.608, 0.601, 0.575, 0.325, 0.528, 0.325, 0.51, 0.513, 0.375, 0.504, 0.589, 0.484, 0.589, 0.539, 0.309, 0.586, 0.543, 0.267, 0.259, 0.495, 0.246, 0.796, 0.545, 0.564, 0.589, 0.589, 0.371, 0.424, 0.271, 0.545, 0.475, 0.713, 0.465, 0.473, 0.485, 0.346, 0.306, 0.346, 0.575, 0.596, 0.309, 1];

function advance(table: number[], ch: string): number {
  const c = ch.charCodeAt(0);
  if (c >= 32 && c < 127) return table[c - 32]!;
  const i = EXTRA.indexOf(ch);
  return i >= 0 ? table[95 + i]! : table[33]!;
}

/** Width in px of `text` set in Jost at `px` with `track` px between glyphs (like `spacedWidth`). */
export function measure(text: string, weight: "light" | "medium", px: number, track: number): number {
  const t = weight === "light" ? LIGHT : MEDIUM;
  let w = 0;
  let n = 0;
  for (const ch of text) {
    w += advance(t, ch) * px + track;
    n++;
  }
  return n ? w - track : 0;
}
