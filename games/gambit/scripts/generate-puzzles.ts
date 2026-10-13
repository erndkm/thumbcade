/**
 * Generates Gambit's original puzzle set: random but game-like positions (castled kings, pawn shields,
 * a few attackers and defenders) searched for a UNIQUE forced mate in 1, 2 or 3.
 * Run: npx tsx scripts/generate-puzzles.ts  (writes src/puzzles.ts; test/puzzles.test.ts re-verifies)
 */
import { writeFileSync } from "node:fs";
import { Chess } from "chess.js";
import { mainLine, Solver } from "./solver.ts";

let seed = Number(process.argv[2] ?? 20261013) >>> 0;
const rand = () => {
  seed = (seed + 0x6d2b79f5) >>> 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = <T>(a: readonly T[]): T => a[Math.floor(rand() * a.length)]!;

type Board = (string | null)[][]; // [rank 8..1][file a..h]
const FILES = "abcdefgh";

const SHIELDS: Array<{ king: string; pawns: string[] }> = [
  { king: "g8", pawns: ["f7", "g7", "h7"] },
  { king: "g8", pawns: ["f7", "g6", "h7"] },
  { king: "h8", pawns: ["g7", "h7"] },
  { king: "g8", pawns: ["f7", "g7", "h6"] },
  { king: "b8", pawns: ["a7", "b7", "c7"] },
  { king: "c8", pawns: ["a7", "b7", "c7"] },
  { king: "e8", pawns: ["d7", "e7", "f7"] },
  { king: "f8", pawns: ["f7", "g7", "h7"] },
  { king: "h7", pawns: ["g7", "h6"] },
  { king: "g7", pawns: ["f7", "g6", "h7"] },
  { king: "e7", pawns: ["d6", "f7"] },
  { king: "a8", pawns: ["a7", "b7"] },
  { king: "d8", pawns: ["c7", "e7"] },
  { king: "h8", pawns: ["g7", "h6"] },
  { king: "g6", pawns: ["f7", "h7"] },
];
const WHITE_HOMES: Array<{ king: string; pawns: string[] }> = [
  { king: "g1", pawns: ["f2", "g2", "h2"] },
  { king: "c1", pawns: ["a2", "b2", "c2"] },
  { king: "h1", pawns: ["g2", "h2"] },
  { king: "g1", pawns: ["g3", "h2", "f2"] },
  { king: "b1", pawns: ["a2", "b2"] },
  { king: "e1", pawns: [] },
];

function at(b: Board, s: string): string | null {
  return b[8 - Number(s[1])]![FILES.indexOf(s[0]!)]!;
}
function put(b: Board, s: string, p: string): void {
  b[8 - Number(s[1])]![FILES.indexOf(s[0]!)] = p;
}
function randomEmpty(b: Board, rankLo = 1, rankHi = 8, pawn = false): string {
  for (;;) {
    const f = Math.floor(rand() * 8);
    const r = rankLo + Math.floor(rand() * (rankHi - rankLo + 1));
    if (pawn && (r === 1 || r === 8)) continue;
    const s = FILES[f]! + r;
    if (!at(b, s)) return s;
  }
}
function toFen(b: Board, turn: "w" | "b"): string {
  const rows = b.map((row) => {
    let out = "";
    let e = 0;
    for (const c of row) {
      if (!c) e++;
      else {
        if (e) out += e;
        e = 0;
        out += c;
      }
    }
    return out + (e ? e : "");
  });
  return `${rows.join("/")} ${turn} - - 0 1`;
}

function candidate(): string | null {
  const b: Board = Array.from({ length: 8 }, () => Array<string | null>(8).fill(null));
  const shield = pick(SHIELDS);
  put(b, shield.king, "k");
  for (const p of shield.pawns) if (!at(b, p)) put(b, p, "p");
  const home = pick(WHITE_HOMES);
  if (at(b, home.king)) return null;
  put(b, home.king, "K");
  for (const p of home.pawns) if (!at(b, p)) put(b, p, "P");
  // Realistic material: at most one queen and two of each minor/rook per side.
  const limits: Record<string, number> = { q: 1, r: 2, b: 2, n: 2, p: 8 };
  const count: Record<string, number> = {};
  const placeFrom = (pool: string[], n: number, pawnLo: number, pawnHi: number, lo: number, hi: number) => {
    for (let i = 0; i < n; i++) {
      const p = pick(pool);
      const k = p.toLowerCase() + (p === p.toUpperCase() ? "W" : "B");
      if ((count[k] ?? 0) >= (limits[p.toLowerCase()] ?? 0)) continue;
      count[k] = (count[k] ?? 0) + 1;
      const pawn = p.toLowerCase() === "p";
      put(b, randomEmpty(b, pawn ? pawnLo : lo, pawn ? pawnHi : hi, pawn), p);
    }
  };
  placeFrom(["Q", "R", "R", "B", "N", "N", "B", "Q", "R", "P"], 2 + Math.floor(rand() * 3), 4, 7, 2, 8);
  placeFrom(["r", "b", "n", "p", "p", "q", "r", "n"], 1 + Math.floor(rand() * 4), 3, 6, 4, 8);
  const fen = toFen(b, "w");
  try {
    const c = new Chess(fen);
    // Side not to move must not be in check; keep the attacker's own king out of check too.
    const bk = shield.king as Parameters<Chess["isAttacked"]>[0];
    const wk = home.king as Parameters<Chess["isAttacked"]>[0];
    if (c.isAttacked(bk, "w") || c.isAttacked(wk, "b")) return null;
    if (c.isGameOver()) return null;
    return fen;
  } catch {
    return null;
  }
}

/** Mirror the position so Black is the side to move (variety; the board flips for the player). */
function mirror(fen: string): string {
  const [board, , , , , ] = fen.split(" ");
  const rows = board!.split("/").reverse().map((r) => r.replace(/[a-zA-Z]/g, (c) => (c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase())));
  return `${rows.join("/")} b - - 0 1`;
}

interface Puzzle {
  fen: string;
  mateIn: 1 | 2 | 3;
  line: string[];
}

const want = { 1: 24, 2: 26, 3: 14 } as const;
const found: Record<1 | 2 | 3, Puzzle[]> = { 1: [], 2: [], 3: [] };
const seenFen = new Set<string>();
const started = Date.now();
let tries = 0;

while ((found[1].length < want[1] || found[2].length < want[2] || found[3].length < want[3]) && Date.now() - started < 25 * 60_000) {
  tries++;
  const fen = candidate();
  if (!fen || seenFen.has(fen)) continue;
  seenFen.add(fen);
  const s = new Solver(fen);
  s.budget = 400_000;
  try {
    const m1 = s.keys(1);
    if (m1.length === 1 && found[1].length < want[1]) {
      const line = mainLine(fen, 1);
      if (line) found[1].push({ fen, mateIn: 1, line });
      continue;
    }
    if (m1.length > 0) continue;
    if (found[2].length < want[2] || found[3].length < want[3]) {
      const k2 = s.keys(2);
      if (k2.length === 1 && found[2].length < want[2]) {
        const line = mainLine(fen, 2);
        if (line) found[2].push({ fen, mateIn: 2, line });
        continue;
      }
      if (k2.length > 0 || found[3].length >= want[3]) continue;
      s.budget = 6_000_000;
      s.nodes = 0;
      const k3 = s.keys(3);
      if (k3.length === 1) {
        const line = mainLine(fen, 3);
        if (line) found[3].push({ fen, mateIn: 3, line });
      }
    }
  } catch {
    /* over budget: skip */
  }
  if (tries % 500 === 0) console.error(`tries ${tries}: m1 ${found[1].length} m2 ${found[2].length} m3 ${found[3].length} (${Math.round((Date.now() - started) / 1000)}s)`);
}

// Half of the puzzles become Black-to-move by mirroring (line moves mirror rank-wise).
const mirrorSq = (u: string) => u.replace(/([a-h])([1-8])/g, (_, f: string, r: string) => f + String(9 - Number(r)));
const all: Puzzle[] = [];
let i = 0;
for (const n of [1, 2, 3] as const) {
  for (const p of found[n]) {
    if (i++ % 2 === 1) all.push({ fen: mirror(p.fen), mateIn: n, line: p.line.map(mirrorSq) });
    else all.push(p);
  }
}

const body = all.map((p) => `  { fen: "${p.fen}", mateIn: ${p.mateIn}, line: [${p.line.map((m) => `"${m}"`).join(", ")}] },`).join("\n");
writeFileSync(
  new URL("../src/puzzles.ts", import.meta.url),
  `/**\n * Gambit's original puzzle set — generated by scripts/generate-puzzles.ts and verified by test/puzzles.test.ts:\n * every puzzle has exactly one key move, no faster mate, and a main line that ends in checkmate.\n * \`line\` alternates player / opponent moves in UCI notation; the player's last move may be any mate.\n */\nexport interface Puzzle {\n  fen: string;\n  mateIn: 1 | 2 | 3;\n  line: string[];\n}\n\nexport const PUZZLES: Puzzle[] = [\n${body}\n];\n`,
);
console.error(`done: ${all.length} puzzles (m1 ${found[1].length}, m2 ${found[2].length}, m3 ${found[3].length}) after ${tries} candidates in ${Math.round((Date.now() - started) / 1000)}s`);
