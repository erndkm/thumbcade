import { describe, expect, it } from "vitest";
import { BASKET_ROWS, catRows, COAT_SWAPS, EMBERS, FLAME, MOON, PAW, SPARKLE, STAR, usesOnlyPalette, type Pose } from "../src/art.ts";
import { COATS } from "../src/board.ts";
import { CELL } from "../src/layout.ts";

const POSES: Pose[] = ["nap", "awake", "grump", "scootA", "scootB"];

describe("sprites", () => {
  it("a cat is drawn for one, two or three squares: thirteen pixels tall, two short of each end", () => {
    for (const len of [1, 2, 3]) {
      for (const pose of POSES) {
        const rows = catRows(len, pose);
        expect(rows).toHaveLength(13);
        for (const r of rows) expect(r.length, `${len} ${pose}`).toBe(len * CELL - 4);
        // Outlined, it still fits inside its squares.
        expect(rows.length + 2).toBeLessThanOrEqual(CELL);
      }
    }
  });

  it("the head is at the front: nose on the last column, eyes ahead of the collar, a tail at the back", () => {
    for (const len of [1, 2, 3]) {
      const nap = catRows(len, "nap");
      const w = nap[0]!.length;
      expect(nap[6]![w - 1]).toBe("P");
      expect(nap.join("").includes("C")).toBe(true);
      expect(catRows(len, "awake").join("").includes("E")).toBe(true);
      expect(nap.some((r) => r.slice(0, 8).includes("D"))).toBe(true);
      // The collar sits where the head joins the body.
      expect(nap[6]![w - 10]).toBe("Y");
    }
  });

  it("scooting stretches one front paw out, then the other; a grump flattens its ears", () => {
    const a = catRows(2, "scootA");
    const b = catRows(2, "scootB");
    expect(a[3]!.endsWith("LL")).toBe(true);
    expect(b[9]!.endsWith("LL")).toBe(true);
    expect(a).not.toEqual(b);
    const grump = catRows(2, "grump");
    expect(grump[0]!.replaceAll(".", "")).toBe("");
    expect(catRows(2, "nap")[0]!.replaceAll(".", "")).not.toBe("");
  });

  it("there is a coat for the witch's cat and for every other cat, all in the palette, all different", () => {
    expect(COAT_SWAPS).toHaveLength(COATS + 1);
    const looks = new Set(COAT_SWAPS.map((s) => `${s.B}${s.D}`));
    expect(looks.size).toBe(COAT_SWAPS.length);
    for (const swap of COAT_SWAPS) for (const pose of POSES) expect(usesOnlyPalette(catRows(3, pose), swap)).toBe(true);
    // Only the witch's cat wears a collar that shows.
    expect(COAT_SWAPS[0]!.R).not.toBe(COAT_SWAPS[0]!.B);
    for (const swap of COAT_SWAPS.slice(1)) expect(swap.R).toBe(swap.B);
  });

  it("the other sprite maps are rectangular and in the palette", () => {
    for (const rows of [BASKET_ROWS, PAW, MOON, STAR, ...SPARKLE, ...FLAME, ...EMBERS]) {
      expect(new Set(rows.map((r) => r.length)).size).toBe(1);
      expect(usesOnlyPalette(rows)).toBe(true);
    }
    expect(BASKET_ROWS[0]!.length).toBeLessThanOrEqual(CELL - 2);
  });
});
