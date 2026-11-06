/**
 * Brinebop's rock pool: a 7×9 grid of critters. Pure logic with no DOM, so the game, the attract demo, the hint,
 * the headless playtests and the unit tests all run this same code.
 *
 * The board is time-stepped instead of turn-based, so play never has to wait for it: any two settled critters can
 * be swapped while other columns are still falling, and a cascade is simply a match made by critters that landed.
 * Everything is in cell units (x grows to the right, y grows downward, row 0 at the top) and seeded, so the same
 * inputs at the same steps always give the same board.
 */
import type { Rng } from "@thumbcade-games/kit/rng";

export const COLS = 7;
export const ROWS = 9;
export const N = COLS * ROWS;
/** Critter kinds: crab, puffer, clam, fish, octopus, starfish. */
export const KINDS = 6;
/** The conch has no kind; it is never part of a match. */
export const CONCH = -1;

/** Seconds for a swap, and for the swap back when it made nothing. */
export const SWAP_T = 0.13;
/** Seconds a cleared critter takes to pop. */
export const CLEAR_T = 0.2;
export const SHUFFLE_T = 0.6;
/** Fall acceleration (cells/s²) and top speed (cells/s). */
export const GRAVITY = 80;
export const MAX_FALL = 24;
/** A special hit by another special goes off this much later, so chain reactions ripple instead of popping at once. */
export const FIRE_HOP = 0.08;
/** Critters still this far above their slot (cells) are in flight and don't get hit. */
const AIRBORNE = 0.75;
/** Points per critter cleared by a special, and by two specials swapped together. */
export const SPECIAL_POINTS = 10;
export const COMBO_POINTS = 25;
/** A chain survives this long without a new match while the pool is still busy. */
export const CHAIN_WINDOW = 1.5;
/** Chain multiplier cap for scoring. */
export const MAX_MULT = 10;

export type Special = "none" | "lineH" | "lineV" | "bomb" | "conch";
export type PieceState = "idle" | "swap" | "back" | "move" | "clear";

export interface Piece {
  id: number;
  /** 0..KINDS-1, or CONCH. */
  kind: number;
  special: Special;
  /** Drawn offset from the slot, in cells. */
  ox: number;
  oy: number;
  /** Fall speed (cells/s). */
  vy: number;
  state: PieceState;
  /** Seconds in the state. A clear with a negative t is waiting to pop. */
  t: number;
  /** Length of a swap/back/move. */
  dur: number;
  /** Offset at the start of a swap/back/move. */
  fx: number;
  fy: number;
  /** A special that goes off when its clear reaches t = 0. */
  armed: boolean;
  settledAt: number;
  /** Just swapped in by the player: a special made by this move appears here. */
  moved: boolean;
  /** Board time it became a special (the renderer pops it). */
  bornAt: number;
  /** Seconds before it starts to fall (the opening pour). */
  wait: number;
  /** Render-only: landing squash and its speed (the board never reads these). */
  sq: number;
  sqv: number;
}

export type BoardEvent =
  | { type: "swap"; a: number; b: number }
  | { type: "reject"; a: number; b: number }
  | { type: "match"; cells: number[]; kind: number; chain: number; created: Special; at: number; points: number; player: boolean }
  | { type: "fire"; special: Special; at: number; cells: number[]; kind: number; combo: Combo | null; points: number; chain: number }
  | { type: "pop"; i: number; kind: number; special: Special; x: number; y: number }
  | { type: "land"; i: number; speed: number }
  | { type: "shuffle" }
  | { type: "calm" }
  /** The chain ran out: the pool went still, or nothing matched for CHAIN_WINDOW seconds. */
  | { type: "chainEnd"; chain: number };

export type Combo = "cross" | "triple" | "megablast" | "conchLine" | "conchBomb" | "conchKind" | "tidal";

export interface Move {
  /** The critter dragged, and the neighbour it lands on. */
  from: number;
  to: number;
  /** Rough worth: cells cleared, with a bonus for specials it makes or sets off. */
  value: number;
  makes: Special;
}

interface Swap {
  a: Piece;
  b: Piece;
  /** Slot a moved into (the combo centre). */
  at: number;
  back: boolean;
}

interface Group {
  cells: number[];
  hasH: boolean;
  hasV: boolean;
  maxLen: number;
  /** Direction of the longest run. */
  dir: "h" | "v";
  /** Cells in both a horizontal and a vertical run. */
  cross: number[];
}

export const idx = (c: number, r: number): number => r * COLS + c;
export const col = (i: number): number => i % COLS;
export const row = (i: number): number => (i / COLS) | 0;
export const isLine = (s: Special): boolean => s === "lineH" || s === "lineV";

const LETTERS = "ABCDEF";
const SPECIAL_VALUE: Record<Special, number> = { none: 0, lineH: 7, lineV: 9, bomb: 14, conch: 18 };

export class Board {
  readonly grid: (Piece | null)[] = new Array<Piece | null>(N).fill(null);
  readonly events: BoardEvent[] = [];
  time = 0;
  /**
   * The chain: match waves in a row (1 = the player's own match, then each cascade). It lives while the pool is
   * busy and a new match lands within CHAIN_WINDOW seconds of the last, so fast play can keep it going.
   */
  chain = 0;
  private lastMatchAt = -10;
  calm = false;
  /** Cleared critters since creation (stats). */
  cleared = 0;
  private nextId = 1;
  private readonly swaps: Swap[] = [];
  private dirty = true;
  private holes = false;
  private readonly kindBuf = new Int8Array(N);
  private readonly hRun = new Int16Array(N);
  private readonly vRun = new Int16Array(N);
  private readonly pool: Piece[] = [];

  constructor(
    private readonly rng: Rng,
    opts: { fill?: boolean; pour?: boolean } = {},
  ) {
    if (opts.fill !== false) this.fill(opts.pour ?? false);
  }

  // -------------------------------------------------------------------------------------------------------------
  // Construction
  // -------------------------------------------------------------------------------------------------------------

  private make(kind: number, special: Special = "none"): Piece {
    const p = this.pool.pop() ?? ({} as Piece);
    p.id = this.nextId++;
    p.kind = kind;
    p.special = special;
    p.ox = 0;
    p.oy = 0;
    p.vy = 0;
    p.state = "idle";
    p.t = 0;
    p.dur = 0;
    p.fx = 0;
    p.fy = 0;
    p.armed = false;
    p.settledAt = this.time;
    p.moved = false;
    p.bornAt = -10;
    p.wait = 0;
    p.sq = 0;
    p.sqv = 0;
    return p;
  }

  /** A fresh board: no match anywhere and at least one move. `pour` drops every column in from above. */
  fill(pour = false): void {
    for (let i = 0; i < N; i++) {
      const p = this.grid[i];
      if (p) this.pool.push(p);
      this.grid[i] = null;
    }
    this.swaps.length = 0;
    for (let tries = 0; tries < 200; tries++) {
      for (let r = 0; r < ROWS; r++)
        for (let c = 0; c < COLS; c++) {
          let k = this.rng.int(0, KINDS - 1);
          for (let n = 0; n < KINDS && this.makesRun(c, r, k); n++) k = (k + 1) % KINDS;
          this.kindBuf[idx(c, r)] = k;
        }
      if (this.anyMove(this.kindBuf, null)) break;
    }
    for (let i = 0; i < N; i++) {
      const p = this.make(this.kindBuf[i]!);
      if (pour) {
        // A wave from the bottom left: each critter plops in from just above its own slot. (A whole pool pouring
        // down through itself strobes: rows of bright critters streaming over dark water.)
        p.oy = -0.85;
        p.wait = col(i) * 0.04 + (ROWS - 1 - row(i)) * 0.03;
      }
      this.grid[i] = p;
    }
    this.dirty = true;
    this.calm = false;
    this.chain = 0;
  }

  /** Would kind k at (c, r) complete a run with the two to its left or the two above (generation order)? */
  private makesRun(c: number, r: number, k: number): boolean {
    const b = this.kindBuf;
    if (c >= 2 && b[idx(c - 1, r)] === k && b[idx(c - 2, r)] === k) return true;
    if (r >= 2 && b[idx(c, r - 1)] === k && b[idx(c, r - 2)] === k) return true;
    return false;
  }

  /**
   * Builds a board from rows of tokens for tests: a letter A-F is a critter kind, followed by "-" (sideways
   * squirter), "|" (up-down squirter) or "*" (boomer); "@" is a conch and "." an empty cell.
   */
  static fromRows(rows: string[], rng: Rng): Board {
    const b = new Board(rng, { fill: false });
    if (rows.length !== ROWS) throw new Error(`need ${ROWS} rows`);
    rows.forEach((line, r) => {
      const toks = line.trim().split(/\s+/);
      if (toks.length !== COLS) throw new Error(`row ${r}: need ${COLS} cells`);
      toks.forEach((t, c) => {
        if (t === ".") return;
        if (t === "@") {
          b.grid[idx(c, r)] = b.make(CONCH, "conch");
          return;
        }
        const k = LETTERS.indexOf(t[0]!);
        if (k < 0) throw new Error(`bad token ${t}`);
        const sp: Special = t[1] === "-" ? "lineH" : t[1] === "|" ? "lineV" : t[1] === "*" ? "bomb" : "none";
        b.grid[idx(c, r)] = b.make(k, sp);
      });
    });
    b.dirty = true;
    b.holes = b.grid.some((p) => !p);
    return b;
  }

  /** The board as rows of tokens (the `fromRows` format). */
  toRows(): string[] {
    const out: string[] = [];
    for (let r = 0; r < ROWS; r++) {
      const t: string[] = [];
      for (let c = 0; c < COLS; c++) {
        const p = this.grid[idx(c, r)];
        if (!p) t.push(".");
        else if (p.special === "conch") t.push("@");
        else t.push(LETTERS[p.kind]! + (p.special === "lineH" ? "-" : p.special === "lineV" ? "|" : p.special === "bomb" ? "*" : ""));
      }
      out.push(t.join(" "));
    }
    return out;
  }

  // -------------------------------------------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------------------------------------------

  settled(p: Piece | null): p is Piece {
    return !!p && p.state === "idle" && p.oy === 0 && p.vy === 0 && p.ox === 0;
  }

  /** Two neighbours that are both resting can be swapped. */
  canSwap(i: number, j: number): boolean {
    if (i < 0 || j < 0 || i >= N || j >= N || i === j) return false;
    const dc = Math.abs(col(i) - col(j));
    const dr = Math.abs(row(i) - row(j));
    if (dc + dr !== 1) return false;
    return this.settled(this.grid[i]!) && this.settled(this.grid[j]!);
  }

  /** Kinds of resting critters into `buf` (-9 = anything that can't match right now). */
  private snapshot(buf: Int8Array): void {
    for (let i = 0; i < N; i++) {
      const p = this.grid[i]!;
      buf[i] = this.settled(p) && p.kind >= 0 ? p.kind : -9;
    }
  }

  /** Length of the run of `k` through (c, r) along (dx, dy), counting (c, r) itself as k. */
  private static runLen(buf: Int8Array, c: number, r: number, k: number, dx: number, dy: number): number {
    let n = 1;
    for (let x = c + dx, y = r + dy; x >= 0 && y >= 0 && x < COLS && y < ROWS && buf[idx(x, y)] === k; x += dx, y += dy) n++;
    for (let x = c - dx, y = r - dy; x >= 0 && y >= 0 && x < COLS && y < ROWS && buf[idx(x, y)] === k; x -= dx, y -= dy) n++;
    return n;
  }

  /** What a critter of kind k arriving at cell i would match there: [horizontal, vertical] run lengths. */
  private static lens(buf: Int8Array, i: number, k: number): [number, number] {
    return [Board.runLen(buf, col(i), row(i), k, 1, 0), Board.runLen(buf, col(i), row(i), k, 0, 1)];
  }

  private static worth(h: number, v: number): { cells: number; makes: Special } {
    const mh = h >= 3 ? h : 0;
    const mv = v >= 3 ? v : 0;
    if (!mh && !mv) return { cells: 0, makes: "none" };
    const cells = mh + mv - (mh && mv ? 1 : 0);
    const makes: Special = Math.max(h, v) >= 5 ? "conch" : mh && mv ? "bomb" : h === 4 ? "lineH" : v === 4 ? "lineV" : "none";
    return { cells, makes };
  }

  /** Every swap of two resting neighbours that would do something, with a rough value. */
  findMoves(): Move[] {
    const buf = this.kindBuf;
    this.snapshot(buf);
    const out: Move[] = [];
    this.scanMoves(buf, this.grid, out);
    return out;
  }

  hasMove(): boolean {
    this.snapshot(this.kindBuf);
    return this.anyMove(this.kindBuf, this.grid);
  }

  private anyMove(buf: Int8Array, grid: (Piece | null)[] | null): boolean {
    return this.scanMoves(buf, grid, null);
  }

  /** Scans every right/down neighbour pair. With `out` null it stops at the first move. */
  private scanMoves(buf: Int8Array, grid: (Piece | null)[] | null, out: Move[] | null): boolean {
    for (let i = 0; i < N; i++) {
      const c = col(i);
      const r = row(i);
      for (let side = 0; side < 2; side++) {
        const j = side === 0 ? (c + 1 < COLS ? i + 1 : -1) : r + 1 < ROWS ? i + COLS : -1;
        if (j < 0) continue;
        const pa = grid ? grid[i] : null;
        const pb = grid ? grid[j] : null;
        if (grid) {
          if (!this.settled(pa ?? null) || !this.settled(pb ?? null)) continue;
          const sa = pa!.special;
          const sb = pb!.special;
          if (sa === "conch" || sb === "conch" || (sa !== "none" && sb !== "none")) {
            if (!out) return true;
            const v = sa === "conch" && sb === "conch" ? 60 : SPECIAL_VALUE[sa] + SPECIAL_VALUE[sb] + 10;
            out.push({ from: sa === "conch" ? j : i, to: sa === "conch" ? i : j, value: v, makes: "none" });
            continue;
          }
        }
        const ka = buf[i]!;
        const kb = buf[j]!;
        if (ka < 0 || kb < 0 || ka === kb) continue;
        buf[i] = kb;
        buf[j] = ka;
        const [ah, av] = Board.lens(buf, j, ka);
        const [bh, bv] = Board.lens(buf, i, kb);
        buf[i] = ka;
        buf[j] = kb;
        const wa = Board.worth(ah, av);
        const wb = Board.worth(bh, bv);
        if (!wa.cells && !wb.cells) continue;
        if (!out) return true;
        // Specials caught up in the match add their own clear.
        let bonus = 0;
        if (grid) {
          if (wa.cells && pa!.special !== "none") bonus += SPECIAL_VALUE[pa!.special];
          if (wb.cells && pb!.special !== "none") bonus += SPECIAL_VALUE[pb!.special];
        }
        const value = wa.cells + wb.cells + SPECIAL_VALUE[wa.makes] + SPECIAL_VALUE[wb.makes] + bonus;
        // Drag the critter whose arrival makes the bigger match.
        const aFirst = wa.cells + SPECIAL_VALUE[wa.makes] >= wb.cells + SPECIAL_VALUE[wb.makes];
        out.push({ from: aFirst ? i : j, to: aFirst ? j : i, value, makes: aFirst ? wa.makes : wb.makes });
      }
    }
    return out ? out.length > 0 : false;
  }

  /** Would swapping i and j do anything? (Both must be resting.) */
  wouldWork(i: number, j: number): boolean {
    if (!this.canSwap(i, j)) return false;
    const a = this.grid[i]!;
    const b = this.grid[j]!;
    if (a.special === "conch" || b.special === "conch" || (a.special !== "none" && b.special !== "none")) return true;
    const buf = this.kindBuf;
    this.snapshot(buf);
    buf[i] = b.kind;
    buf[j] = a.kind;
    const [ah, av] = Board.lens(buf, j, a.kind);
    const [bh, bv] = Board.lens(buf, i, b.kind);
    return ah >= 3 || av >= 3 || bh >= 3 || bv >= 3;
  }

  /** Indices of resting specials. */
  specials(): number[] {
    const out: number[] = [];
    for (let i = 0; i < N; i++) {
      const p = this.grid[i]!;
      if (this.settled(p) && p.special !== "none") out.push(i);
    }
    return out;
  }

  /** How many resting critters of each kind. */
  private mostCommonKind(): number {
    const n = [0, 0, 0, 0, 0, 0];
    for (const p of this.grid) if (p && p.kind >= 0 && p.state !== "clear") n[p.kind]!++;
    let best = 0;
    for (let k = 1; k < KINDS; k++) if (n[k]! > n[best]!) best = k;
    return best;
  }

  // -------------------------------------------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------------------------------------------

  /**
   * The player drags the critter at `i` onto its neighbour `j`. `drag` is how far (cells, along the swap) the
   * critter had already followed the finger, so the swap picks up where the finger left it.
   */
  trySwap(i: number, j: number, drag = 0): boolean {
    if (!this.canSwap(i, j)) return false;
    const a = this.grid[i]!;
    const b = this.grid[j]!;
    const dx = col(j) - col(i);
    const dy = row(j) - row(i);
    this.grid[i] = b;
    this.grid[j] = a;
    // a sat at slot i (+ drag toward j); it now lives at j.
    a.fx = -dx * (1 - drag);
    a.fy = -dy * (1 - drag);
    b.fx = dx;
    b.fy = dy;
    for (const p of [a, b]) {
      p.state = "swap";
      p.t = 0;
      p.dur = SWAP_T * (p === a ? Math.max(0.5, 1 - drag * 0.6) : 1);
      p.ox = p.fx;
      p.oy = p.fy;
    }
    this.swaps.push({ a, b, at: j, back: false });
    this.calm = false;
    this.events.push({ type: "swap", a: i, b: j });
    return true;
  }

  /** Turns the resting critter at i into a special (frenzy sprinkles, tests). */
  makeSpecial(i: number, special: Special): boolean {
    const p = this.grid[i];
    if (!this.settled(p ?? null) || p!.special !== "none") return false;
    p!.special = special;
    if (special === "conch") p!.kind = CONCH;
    p!.bornAt = this.time;
    return true;
  }

  /** Sets off a resting special now (the cash-out). */
  detonate(i: number): boolean {
    const p = this.grid[i];
    if (!this.settled(p ?? null) || p!.special === "none") return false;
    this.hit(i, 0, true);
    return true;
  }

  /** Clears piece i after `delay` seconds; `arm` makes a special go off when it pops. Returns 1 if it was hit. */
  private hit(i: number, delay: number, arm: boolean): number {
    const p = this.grid[i];
    if (!p || p.state === "clear") return 0;
    if (p.oy < -AIRBORNE) return 0;
    // A critter hit mid-swap pops where it is drawn; its swap is dropped when it resolves.
    p.state = "clear";
    p.t = -delay;
    p.vy = 0;
    p.armed = arm && p.special !== "none";
    this.calm = false;
    return 1;
  }

  // -------------------------------------------------------------------------------------------------------------
  // Simulation
  // -------------------------------------------------------------------------------------------------------------

  step(dt: number): void {
    this.time += dt;
    this.stepSwaps(dt);
    this.stepClears(dt);
    if (this.holes) this.gravity();
    this.stepFalls(dt);
    if (this.dirty) {
      this.dirty = false;
      this.resolveMatches();
    }
    const calm = this.isCalm();
    if (this.chain > 0 && (calm || this.time - this.lastMatchAt > CHAIN_WINDOW)) {
      this.events.push({ type: "chainEnd", chain: this.chain });
      this.chain = 0;
    }
    if (calm && !this.calm) {
      this.events.push({ type: "calm" });
      if (!this.hasMove()) this.reshuffle();
    }
    this.calm = calm && this.isCalm();
  }

  private isCalm(): boolean {
    if (this.swaps.length || this.holes) return false;
    for (const p of this.grid) if (!this.settled(p)) return false;
    return true;
  }

  private stepSwaps(dt: number): void {
    // Shuffle moves are swaps without a partner.
    for (const p of this.grid) {
      if (!p || p.state !== "move") continue;
      p.t += dt;
      const k = Math.min(1, p.t / p.dur);
      const e = 1 - (1 - k) ** 3;
      p.ox = p.fx * (1 - e);
      p.oy = p.fy * (1 - e);
      if (k >= 1) {
        p.state = "idle";
        p.ox = p.oy = 0;
        p.settledAt = this.time;
        this.dirty = true;
      }
    }
    for (let s = this.swaps.length - 1; s >= 0; s--) {
      const sw = this.swaps[s]!;
      const { a, b } = sw;
      let done = true;
      for (const p of [a, b]) {
        if (p.state !== "swap" && p.state !== "back") continue;
        p.t += dt;
        const k = Math.min(1, p.t / p.dur);
        // A little overshoot: the critters bump into their new slots.
        const e = sw.back ? 1 - (1 - k) ** 3 : easeOutBack(k);
        p.ox = p.fx * (1 - e);
        p.oy = p.fy * (1 - e);
        if (k < 1) done = false;
      }
      if (!done) continue;
      this.swaps.splice(s, 1);
      const live = (p: Piece) => p.state === "swap" || p.state === "back";
      if (!live(a) || !live(b)) {
        // One of them was blown up mid-swap: whatever is left just rests.
        for (const p of [a, b]) if (live(p)) this.rest(p);
        continue;
      }
      this.rest(a);
      this.rest(b);
      if (sw.back) continue;
      const ia = sw.at;
      const ib = this.grid.indexOf(b);
      if (this.tryCombo(a, ia, b, ib)) continue;
      if (this.matchesAt(ia) || this.matchesAt(ib)) {
        a.moved = b.moved = true;
        this.dirty = true;
        continue;
      }
      // Nothing: slide back without penalty.
      this.grid[ia] = b;
      this.grid[ib] = a;
      const dx = col(ia) - col(ib);
      const dy = row(ia) - row(ib);
      a.fx = dx;
      a.fy = dy;
      b.fx = -dx;
      b.fy = -dy;
      for (const p of [a, b]) {
        p.state = "back";
        p.t = 0;
        p.dur = SWAP_T * 1.25;
        p.ox = p.fx;
        p.oy = p.fy;
      }
      this.swaps.push({ a, b, at: ib, back: true });
      this.events.push({ type: "reject", a: ib, b: ia });
    }
  }

  private rest(p: Piece): void {
    p.state = "idle";
    p.ox = p.oy = 0;
    p.t = 0;
    p.settledAt = this.time;
  }

  private matchesAt(i: number): boolean {
    const buf = this.kindBuf;
    this.snapshot(buf);
    const k = buf[i]!;
    if (k < 0) return false;
    const [h, v] = Board.lens(buf, i, k);
    return h >= 3 || v >= 3;
  }

  /** Special + special, or a conch with anything: the swap itself is the move. */
  private tryCombo(a: Piece, ia: number, b: Piece, ib: number): boolean {
    const sa = a.special;
    const sb = b.special;
    if (!(sa === "conch" || sb === "conch" || (sa !== "none" && sb !== "none"))) return false;
    const chain = Math.max(1, this.chain);
    const c = col(ia);
    const r = row(ia);
    const cells: number[] = [];
    let combo: Combo;
    let kind = -1;
    let n = 0;
    this.hit(ia, 0, false);
    this.hit(ib, 0, false);
    n += 2;
    if (sa === "conch" && sb === "conch") {
      combo = "tidal";
      // Everything goes, in a wave out from the swap.
      for (let i = 0; i < N; i++) {
        const d = Math.hypot(col(i) - c, row(i) - r);
        n += this.hit(i, d * 0.045, true);
        cells.push(i);
      }
    } else if (sa === "conch" || sb === "conch") {
      const other = sa === "conch" ? b : a;
      kind = other.kind;
      const turn = other.special === "none" ? "none" : other.special === "bomb" ? "bomb" : "line";
      combo = turn === "none" ? "conchKind" : turn === "bomb" ? "conchBomb" : "conchLine";
      let k = 0;
      // The honk travels out from the conch: nearest critters first.
      const targets: number[] = [];
      for (let i = 0; i < N; i++) {
        const p = this.grid[i];
        if (p && p.kind === kind && p.state !== "clear" && p.oy >= -AIRBORNE) targets.push(i);
      }
      targets.sort((x, y) => Math.hypot(col(x) - c, row(x) - r) - Math.hypot(col(y) - c, row(y) - r));
      for (const i of targets) {
        const p = this.grid[i]!;
        if (turn !== "none") {
          p.special = turn === "bomb" ? "bomb" : this.rng.chance(0.5) ? "lineH" : "lineV";
          p.bornAt = this.time;
          n += this.hit(i, 0.18 + k * 0.09, true);
        } else n += this.hit(i, 0.04 + k * 0.035, false);
        cells.push(i);
        k++;
      }
    } else {
      const lines = (isLine(sa) ? 1 : 0) + (isLine(sb) ? 1 : 0);
      const bombs = (sa === "bomb" ? 1 : 0) + (sb === "bomb" ? 1 : 0);
      if (lines === 2) {
        combo = "cross";
        for (let x = 0; x < COLS; x++) cells.push(idx(x, r));
        for (let y = 0; y < ROWS; y++) if (y !== r) cells.push(idx(c, y));
      } else if (lines === 1 && bombs === 1) {
        combo = "triple";
        for (let y = r - 1; y <= r + 1; y++) if (y >= 0 && y < ROWS) for (let x = 0; x < COLS; x++) cells.push(idx(x, y));
        for (let x = c - 1; x <= c + 1; x++) if (x >= 0 && x < COLS) for (let y = 0; y < ROWS; y++) if (y < r - 1 || y > r + 1) cells.push(idx(x, y));
      } else {
        combo = "megablast";
        for (let y = r - 3; y <= r + 3; y++)
          for (let x = c - 3; x <= c + 3; x++) if (x >= 0 && y >= 0 && x < COLS && y < ROWS && (x - c) ** 2 + (y - r) ** 2 <= 10) cells.push(idx(x, y));
      }
      for (const i of cells) {
        const d = Math.abs(col(i) - c) + Math.abs(row(i) - r);
        n += this.hit(i, d * 0.025, true);
      }
    }
    this.cleared += n;
    this.events.push({ type: "fire", special: sa === "conch" ? sb : sa, at: ia, cells, kind, combo, points: n * COMBO_POINTS * Math.min(MAX_MULT, chain), chain });
    return true;
  }

  private stepClears(dt: number): void {
    for (let i = 0; i < N; i++) {
      const p = this.grid[i];
      if (!p || p.state !== "clear") continue;
      p.t += dt;
      if (p.armed && p.t >= 0) {
        p.armed = false;
        this.fire(i, p);
      }
      if (p.t >= CLEAR_T) {
        this.grid[i] = null;
        this.holes = true;
        this.events.push({ type: "pop", i, kind: p.kind, special: p.special, x: col(i) + p.ox, y: row(i) + p.oy });
        this.pool.push(p);
      }
    }
  }

  /** A special goes off. */
  private fire(i: number, p: Piece): void {
    const c = col(i);
    const r = row(i);
    const cells: number[] = [];
    let kind = p.kind;
    switch (p.special) {
      case "lineH":
        for (let x = 0; x < COLS; x++) cells.push(idx(x, r));
        break;
      case "lineV":
        for (let y = 0; y < ROWS; y++) cells.push(idx(c, y));
        break;
      case "bomb":
        for (let y = r - 2; y <= r + 2; y++)
          for (let x = c - 2; x <= c + 2; x++) if (x >= 0 && y >= 0 && x < COLS && y < ROWS && !(Math.abs(x - c) === 2 && Math.abs(y - r) === 2)) cells.push(idx(x, y));
        break;
      case "conch": {
        kind = this.mostCommonKind();
        for (let j = 0; j < N; j++) if (this.grid[j]?.kind === kind) cells.push(j);
        break;
      }
      default:
        return;
    }
    let n = 0;
    for (const j of cells) {
      if (j === i) continue;
      const q = this.grid[j];
      const d = Math.abs(col(j) - c) + Math.abs(row(j) - r);
      // Beams sweep outward; anything special they reach goes off a beat later.
      n += this.hit(j, q && q.special !== "none" ? FIRE_HOP + d * 0.02 : d * 0.018, true);
    }
    this.cleared += n;
    const chain = Math.max(1, this.chain);
    this.events.push({ type: "fire", special: p.special, at: i, cells, kind, combo: null, points: n * SPECIAL_POINTS * Math.min(MAX_MULT, chain), chain });
  }

  /** Critters above holes drop down; empty tops refill from above the pool. */
  private gravity(): void {
    this.holes = false;
    for (let c = 0; c < COLS; c++) {
      let write = ROWS - 1;
      // Walk up from the bottom; anything clearing or swapping is a floor the stack above rests on.
      for (let r = ROWS - 1; r >= 0; r--) {
        const i = idx(c, r);
        const p = this.grid[i];
        if (!p) continue;
        if (p.state === "clear" || p.state === "swap" || p.state === "back" || p.state === "move") {
          write = r - 1;
          continue;
        }
        if (r !== write) {
          const j = idx(c, write);
          if (this.grid[j]) {
            write = r - 1;
            continue;
          }
          this.grid[j] = p;
          this.grid[i] = null;
          p.oy -= write - r;
        }
        write--;
      }
      // Holes left under a floor wait for it; the top of the column refills.
      let top = 0;
      while (top < ROWS && !this.grid[idx(c, top)]) top++;
      // Spawn above whatever is already falling into this column.
      let highest = 0;
      for (let r = 0; r < ROWS; r++) {
        const p = this.grid[idx(c, r)];
        if (p) highest = Math.min(highest, r + p.oy);
      }
      const below = top < ROWS ? this.grid[idx(c, top)] : null;
      // Each column's refill starts a little higher or lower and its critters are spaced a little unevenly, so
      // neighbouring columns never stream down in lockstep (lockstep rows passing over the water would flicker).
      let y = highest - 1 - this.rng.range(0, 0.7);
      for (let r = top - 1; r >= 0; r--) {
        const p = this.make(this.rng.int(0, KINDS - 1));
        p.oy = y - r;
        p.vy = below && below.vy > 0 ? below.vy : this.rng.range(1, 4);
        this.grid[idx(c, r)] = p;
        y -= 1 + this.rng.range(0, 0.25);
      }
      for (let r = 0; r < ROWS; r++) if (!this.grid[idx(c, r)]) this.holes = true;
    }
  }

  private stepFalls(dt: number): void {
    for (let c = 0; c < COLS; c++) {
      let floorY = Infinity; // drawn top of the critter below, in rows
      let floorV = 0;
      for (let r = ROWS - 1; r >= 0; r--) {
        const p = this.grid[idx(c, r)];
        if (!p) {
          floorY = Infinity;
          continue;
        }
        if (p.wait > 0) p.wait -= dt;
        if (p.state !== "idle" || (p.oy === 0 && p.vy === 0) || p.wait > 0) {
          // A critter mid-swap may be drawn below its slot; the stack above rests on the higher of the two.
          floorY = r + Math.min(0, p.oy);
          floorV = 0;
          continue;
        }
        p.vy = Math.min(MAX_FALL, p.vy + GRAVITY * dt);
        p.oy += p.vy * dt;
        // Never fall through the critter underneath.
        if (r + p.oy > floorY - 1) {
          p.oy = floorY - 1 - r;
          p.vy = Math.min(p.vy, floorV);
        }
        if (p.oy >= 0) {
          const speed = p.vy;
          p.oy = 0;
          p.vy = 0;
          p.settledAt = this.time;
          this.dirty = true;
          this.events.push({ type: "land", i: idx(c, r), speed });
        }
        floorY = r + p.oy;
        floorV = p.vy;
      }
    }
  }

  /** Finds every run of three or more resting critters and clears it, making specials from the big ones. */
  private resolveMatches(): void {
    const groups = this.findGroups();
    if (!groups.length) {
      for (const p of this.grid) if (p) p.moved = false;
      return;
    }
    this.chain++;
    this.lastMatchAt = this.time;
    const chain = this.chain;
    for (const g of groups) {
      let made: Special = "none";
      if (g.maxLen >= 5) made = "conch";
      else if (g.hasH && g.hasV) made = "bomb";
      else if (g.maxLen === 4) made = g.dir === "h" ? "lineH" : "lineV";
      const player = g.cells.some((i) => this.grid[i]!.moved);
      let at = -1;
      if (made !== "none") {
        const free = g.cells.filter((i) => this.grid[i]!.special === "none");
        const pool = free.length ? free : g.cells;
        const moved = pool.filter((i) => this.grid[i]!.moved);
        const cross = made === "bomb" ? pool.filter((i) => g.cross.includes(i)) : [];
        const pick = moved.length ? moved : cross.length ? cross : pool;
        // The most recent arrival makes it (ties: the middle of the run).
        let best = -Infinity;
        for (const i of pick) {
          const t = this.grid[i]!.settledAt;
          if (t > best + 1e-9) {
            best = t;
            at = i;
          }
        }
        if (!moved.length && !cross.length) {
          const ties = pick.filter((i) => Math.abs(this.grid[i]!.settledAt - best) < 1e-9);
          at = ties[Math.floor((ties.length - 1) / 2)]!;
        }
      }
      const kind = this.grid[g.cells[0]!]!.kind;
      let n = 0;
      for (const i of g.cells) {
        if (i === at) continue;
        // Specials caught in a match go off a beat after the pop starts.
        n += this.hit(i, 0, true);
        const p = this.grid[i]!;
        if (p.armed) p.t = -FIRE_HOP;
      }
      if (at >= 0) {
        const p = this.grid[at]!;
        if (p.special !== "none") {
          // Everything in the group was special already: it goes off, nothing new is made.
          n += this.hit(at, 0, true);
          made = "none";
        } else {
          p.special = made;
          if (made === "conch") p.kind = CONCH;
          p.bornAt = this.time;
          n++;
        }
      }
      this.cleared += n;
      const bonus = made === "conch" ? 150 : made === "bomb" ? 80 : isLine(made) ? 50 : 0;
      this.events.push({ type: "match", cells: g.cells, kind, chain, created: made, at: at >= 0 ? at : g.cells[Math.floor(g.cells.length / 2)]!, points: (g.cells.length * 10 + bonus) * Math.min(MAX_MULT, chain), player });
    }
    for (const p of this.grid) if (p) p.moved = false;
  }

  private findGroups(): Group[] {
    const buf = this.kindBuf;
    this.snapshot(buf);
    type Run = { cells: number[]; dir: "h" | "v" };
    const runs: Run[] = [];
    const hRun = this.hRun.fill(-1);
    const vRun = this.vRun.fill(-1);
    for (let r = 0; r < ROWS; r++) {
      let c = 0;
      while (c < COLS) {
        const k = buf[idx(c, r)]!;
        let e = c + 1;
        if (k >= 0) while (e < COLS && buf[idx(e, r)] === k) e++;
        if (k >= 0 && e - c >= 3) {
          const cells: number[] = [];
          for (let x = c; x < e; x++) {
            cells.push(idx(x, r));
            hRun[idx(x, r)] = runs.length;
          }
          runs.push({ cells, dir: "h" });
        }
        c = e;
      }
    }
    for (let c = 0; c < COLS; c++) {
      let r = 0;
      while (r < ROWS) {
        const k = buf[idx(c, r)]!;
        let e = r + 1;
        if (k >= 0) while (e < ROWS && buf[idx(c, e)] === k) e++;
        if (k >= 0 && e - r >= 3) {
          const cells: number[] = [];
          for (let y = r; y < e; y++) {
            cells.push(idx(c, y));
            vRun[idx(c, y)] = runs.length;
          }
          runs.push({ cells, dir: "v" });
        }
        r = e;
      }
    }
    if (!runs.length) return [];
    const parent = runs.map((_, i) => i);
    const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x]!)));
    const cross: number[] = [];
    for (let i = 0; i < N; i++) {
      if (hRun[i]! >= 0 && vRun[i]! >= 0) {
        parent[find(hRun[i]!)] = find(vRun[i]!);
        cross.push(i);
      }
    }
    const byRoot = new Map<number, Group>();
    runs.forEach((run, ri) => {
      const root = find(ri);
      let g = byRoot.get(root);
      if (!g) byRoot.set(root, (g = { cells: [], hasH: false, hasV: false, maxLen: 0, dir: run.dir, cross: [] }));
      for (const i of run.cells) if (!g.cells.includes(i)) g.cells.push(i);
      if (run.dir === "h") g.hasH = true;
      else g.hasV = true;
      if (run.cells.length > g.maxLen) {
        g.maxLen = run.cells.length;
        g.dir = run.dir;
      }
    });
    const groups = [...byRoot.values()];
    for (const g of groups) g.cross = cross.filter((i) => g.cells.includes(i));
    return groups;
  }

  /** No moves left: the critters swim to new spots (specials stay put) until a move exists and nothing matches. */
  reshuffle(): void {
    const slots: number[] = [];
    for (let i = 0; i < N; i++) {
      const p = this.grid[i]!;
      if (this.settled(p) && p.special === "none") slots.push(i);
    }
    const buf = this.kindBuf;
    this.snapshot(buf);
    const pieces = slots.map((i) => this.grid[i]!);
    let order = slots.slice();
    let ok = false;
    for (let tries = 0; tries < 80 && !ok; tries++) {
      order = this.rng.shuffle(slots.slice());
      for (let k = 0; k < slots.length; k++) buf[order[k]!] = pieces[k]!.kind;
      ok = !this.anyRun(buf) && this.scanMoves(buf, null, null);
    }
    if (!ok) {
      // Practically never: re-roll the kinds instead.
      for (let tries = 0; tries < 200 && !ok; tries++) {
        for (const i of slots) buf[i] = this.rng.int(0, KINDS - 1);
        ok = !this.anyRun(buf) && this.scanMoves(buf, null, null);
      }
      for (const i of slots) this.grid[i]!.kind = buf[i]!;
      order = slots;
    }
    for (let k = 0; k < slots.length; k++) {
      const p = pieces[k]!;
      const from = slots[k]!;
      const to = order[k]!;
      this.grid[to] = p;
      p.state = "move";
      p.t = 0;
      p.dur = SHUFFLE_T + this.rng.range(-0.08, 0.08);
      p.fx = p.ox = col(from) - col(to);
      p.fy = p.oy = row(from) - row(to);
    }
    this.calm = false;
    this.events.push({ type: "shuffle" });
  }

  private anyRun(buf: Int8Array): boolean {
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++) {
        const k = buf[idx(c, r)]!;
        if (k < 0) continue;
        if (c + 2 < COLS && buf[idx(c + 1, r)] === k && buf[idx(c + 2, r)] === k) return true;
        if (r + 2 < ROWS && buf[idx(c, r + 1)] === k && buf[idx(c, r + 2)] === k) return true;
      }
    return false;
  }
}

function easeOutBack(t: number): number {
  const s = 1.4;
  return 1 + (s + 1) * (t - 1) ** 3 + s * (t - 1) ** 2;
}
