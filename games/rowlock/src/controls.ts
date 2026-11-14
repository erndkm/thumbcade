/**
 * What a tap means. A key and a digit make a move, in either order:
 *
 * - Key first: tap an empty key (its row, column and box light up), then a digit on the pad. A wrong digit keeps
 *   the key selected, so the next guess is one tap.
 * - Digit first: tap a digit on the pad (or any key that already holds it) and it stays armed; every empty key
 *   you tap takes it, until all of that digit are placed or you tap it again.
 *
 * The game calls `tap` on a pointer release, and the pilots (attract demo, QA autoplay, headless runs) call the
 * same `tap`, so they play through exactly the path a player does.
 */
import type { Run } from "./run.ts";

export type Target = { kind: "key"; cell: number } | { kind: "pad"; digit: number } | { kind: "lamp" };

export type TapResult =
  | "right"
  | "wrong"
  | "select"
  | "deselect"
  | "arm"
  | "disarm"
  /** A key that holds a digit that is already complete: show it, arm nothing. */
  | "peek"
  | "lamp"
  /** Nothing to do (a finished digit, no lamp): a shrug, no cost. */
  | "nope"
  | "ignored";

export class Controls {
  selected: number | null = null;
  armed: number | null = null;

  constructor(private run: () => Run) {}

  /** Forget the selection (a new grid, the end of a run). */
  reset(): void {
    this.selected = null;
    this.armed = null;
  }

  tap(t: Target): TapResult {
    const run = this.run();
    if (run.phase !== "play") return "ignored";
    if (t.kind === "lamp") {
      if (run.lamps <= 0) return "nope";
      const sel = this.selected;
      const cell = run.lamp(sel);
      if (cell === null) return "nope";
      if (cell === sel) this.selected = null;
      this.settle();
      return "lamp";
    }
    if (t.kind === "pad") {
      const d = t.digit;
      if (run.done(d)) return "nope";
      if (this.selected !== null) {
        const r = run.place(this.selected, d, "key");
        if (!r.ok) {
          this.selected = null;
          return "ignored";
        }
        if (r.right) {
          this.selected = null;
          this.settle();
          return "right";
        }
        return "wrong";
      }
      if (this.armed === d) {
        this.armed = null;
        return "disarm";
      }
      this.armed = d;
      return "arm";
    }
    const cell = t.cell;
    const v = run.values[cell]!;
    if (v !== 0) {
      this.selected = null;
      if (run.done(v)) {
        this.armed = null;
        return "peek";
      }
      this.armed = v;
      return "arm";
    }
    if (this.armed !== null) {
      const r = run.place(cell, this.armed, "armed");
      if (!r.ok) return "ignored";
      if (r.right) {
        this.settle();
        return "right";
      }
      return "wrong";
    }
    if (this.selected === cell) {
      this.selected = null;
      return "deselect";
    }
    this.selected = cell;
    return "select";
  }

  /** After a right digit: drop an armed digit that is complete, and the selection once the grid is filled. */
  private settle(): void {
    const run = this.run();
    if (this.armed !== null && run.done(this.armed)) this.armed = null;
    if (run.phase !== "play") this.reset();
  }
}
