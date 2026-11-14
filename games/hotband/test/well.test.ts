import { describe, expect, it } from "vitest";
import { COLS, HIDDEN, ROWS } from "../src/pieces.ts";
import { at, clipped, collides, dropRow, EMPTY, fullRows, heights, holes, isEmpty, lit, newWell, NOISE, place, pushNoise, removeRows, SIGNAL } from "../src/well.ts";

const fillRow = (w: Uint8Array, y: number, except: number[] = [], v = SIGNAL) => {
  for (let x = 0; x < COLS; x++) if (!except.includes(x)) w[at(x, y)] = v;
};

describe("the grid", () => {
  it("stops a piece at the walls, the floor and lit segments, and lets it pass above the grid", () => {
    const w = newWell();
    expect(collides(w, 1, 0, 0, 0)).toBe(false);
    expect(collides(w, 1, 0, -1, 0)).toBe(true);
    expect(collides(w, 1, 0, COLS - 2, 0)).toBe(true);
    expect(collides(w, 1, 0, 0, ROWS - 1)).toBe(true);
    expect(collides(w, 1, 0, 0, ROWS - 2)).toBe(false);
    expect(collides(w, 1, 0, 2, -3)).toBe(false);
    w[at(1, 5)] = SIGNAL;
    expect(collides(w, 1, 0, 0, 4)).toBe(true);
    expect(collides(w, 1, 0, 2, 4)).toBe(false);
  });

  it("drops a piece straight down onto whatever is under it", () => {
    const w = newWell();
    expect(dropRow(w, 1, 0, 0, 0)).toBe(ROWS - 2);
    w[at(2, 10)] = SIGNAL;
    expect(dropRow(w, 1, 0, 0, 0)).toBe(8);
    expect(dropRow(w, 1, 0, 3, 0)).toBe(ROWS - 2);
  });

  it("lights a placed piece's segments and refuses one that sticks out of the top", () => {
    const w = newWell();
    const cells = place(w, 2, 0, 3, ROWS - 2)!;
    expect(cells.sort((a, b) => a - b)).toEqual([at(3, ROWS - 2), at(3, ROWS - 1), at(4, ROWS - 1)]);
    expect(lit(w)).toBe(3);
    expect(place(newWell(), 2, 0, 3, -1)).toBeNull();
  });

  it("finds full rows, and taking them out drops everything above by one row each", () => {
    const w = newWell();
    fillRow(w, 17);
    fillRow(w, 16, [3]);
    fillRow(w, 15);
    w[at(0, 14)] = SIGNAL;
    w[at(5, 13)] = NOISE;
    expect(fullRows(w)).toEqual([15, 17]);
    removeRows(w, [15, 17]);
    expect(fullRows(w)).toEqual([]);
    // The row with the gap is now the floor; the two loose segments fell two rows.
    for (let x = 0; x < COLS; x++) expect(w[at(x, 17)]).toBe(x === 3 ? EMPTY : SIGNAL);
    expect(w[at(0, 16)]).toBe(SIGNAL);
    expect(w[at(5, 15)]).toBe(NOISE);
    expect(lit(w)).toBe(9);
  });

  it("pushes noise in at the floor with one dark band, lifting the stack a row", () => {
    const w = newWell();
    w[at(2, 17)] = SIGNAL;
    expect(pushNoise(w, 5)).toBe(false);
    expect(w[at(2, 16)]).toBe(SIGNAL);
    for (let x = 0; x < COLS; x++) expect(w[at(x, 17)]).toBe(x === 5 ? EMPTY : NOISE);
    expect(fullRows(w)).toEqual([]);
    // A segment on the top row has nowhere to go.
    const full = newWell();
    full[at(4, 0)] = SIGNAL;
    expect(pushNoise(full, 0)).toBe(true);
  });

  it("measures band heights and covered gaps", () => {
    const w = newWell();
    expect(heights(w)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    expect(holes(w)).toBe(0);
    w[at(0, 17)] = SIGNAL;
    w[at(1, 15)] = SIGNAL;
    expect(heights(w)).toEqual([1, 3, 0, 0, 0, 0, 0, 0]);
    expect(holes(w)).toBe(2);
  });

  it("knows a clipped meter (anything lit above the top row) and a dark one", () => {
    const w = newWell();
    expect(isEmpty(w)).toBe(true);
    expect(clipped(w)).toBe(false);
    w[at(3, HIDDEN)] = SIGNAL;
    expect(clipped(w)).toBe(false);
    w[at(3, HIDDEN - 1)] = SIGNAL;
    expect(clipped(w)).toBe(true);
    expect(isEmpty(w)).toBe(false);
  });
});
