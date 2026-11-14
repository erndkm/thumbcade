import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { charsFit, gridTag, HINTS, hintFor, summaryBox, summaryLines, wrapWords } from "../src/copy.ts";
import { deal, specFor } from "../src/gen.ts";
import { createRng } from "@thumbcade-games/kit/rng";
import { COMBO_NAMES, TIER_NAMES, type Stats } from "../src/run.ts";

// The narrowest phone: 360 px wide, the feed's preview insets (72 pt rail, 148 pt caption).
const ANDROID = { W: 360, H: 724, ins: { left: 0, right: 72, bottom: 148 } };

const stats = (o: Partial<Stats> = {}): Stats => ({
  grids: 3, solved: 2, digits: 40, wrong: 1, locks: 30, doubles: 5, triples: 2, bestStreak: 30, sparks: 1, lampsEarned: 1, lampsUsed: 1,
  marked: 0, nudges: 0, armed: 10, keyFirst: 30, seconds: 60, clashes: 0, ...o,
});

describe("copy fits its plates", () => {
  const box = summaryBox(ANDROID.W, ANDROID.H, ANDROID.ins, false, 2);
  const inner = box.w - 28;

  it("every hint wraps onto two lines of the game-over panel at 11 px on a 360 px phone", () => {
    for (const hint of Object.values(HINTS)) {
      const line = `NEXT: ${hint}`;
      const lines = wrapWords(line, charsFit(inner, 11));
      expect(lines.length, line).toBeLessThanOrEqual(2);
    }
  });

  it("the panel's head line fits at 11 px and its stats line at 10 px", () => {
    const worst = summaryLines(987_654, 912_345, stats({ solved: 12, locks: 240, bestStreak: 199 }), HINTS.deep);
    const none = summaryLines(0, null, stats({ solved: 0 }), HINTS.noGrid);
    for (const line of [worst[0], none[0]]) expect(line.length, line).toBeLessThanOrEqual(charsFit(inner, 11));
    // The stats line is set at 11 px and may shrink to 10 px for a record run.
    for (const line of [worst[1], none[1]]) expect(line.length, line).toBeLessThanOrEqual(charsFit(inner, 10));
  });

  it("grid tags, tier lines and combo names fit the tag line at 12 px", () => {
    const tagW = ANDROID.W - 32;
    const lines = [...TIER_NAMES.map((t, i) => `${t} · ×${i + 1}`), ...COMBO_NAMES, "PAST YOUR BEST", "SPARK · A LAMP FOR LATER", "NOT THAT ONE · STREAK RESET", "6 IS ALREADY IN THIS COLUMN", "PENCIL MARKS ARE OUT", "6 HAS ONE HOME HERE · TAP 6"];
    for (let i = 0; i < 8; i++) lines.push(gridTag(i, deal(specFor(Math.min(i, 3)), createRng(i)), "SEP 30").text);
    for (const l of lines) expect(l.length, l).toBeLessThanOrEqual(charsFit(tagW, 12));
    // The first-run rule line is set at 11 px.
    expect("EVERY ROW, COLUMN AND BOX TAKES 1-4 ONCE".length).toBeLessThanOrEqual(charsFit(tagW, 11));
  });

  it("the hint comes from what happened in the run", () => {
    expect(hintFor(stats({ solved: 0 }), 0)).toBe(HINTS.noGrid);
    expect(hintFor(stats({ wrong: 6, clashes: 3 }), 0)).toBe(HINTS.clashes);
    expect(hintFor(stats({ wrong: 5 }), 0)).toBe(HINTS.slips);
    expect(hintFor(stats({ lampsUsed: 0 }), 1)).toBe(HINTS.lamp);
    expect(hintFor(stats({ armed: 0 }), 0)).toBe(HINTS.armed);
    expect(hintFor(stats({ nudges: 4 }), 0)).toBe(HINTS.stuck);
    expect(hintFor(stats({ doubles: 1, triples: 0 }), 0)).toBe(HINTS.combos);
    expect(hintFor(stats({ bestStreak: 12 }), 0)).toBe(HINTS.streak);
    expect(hintFor(stats(), 0)).toBe(HINTS.deep);
  });
});

describe("naming", () => {
  it("no third-party puzzle name anywhere in the game's copy or manifest", () => {
    const files = [
      "../thumbcade.json",
      "../index.html",
      ...readdirSync(new URL("../src", import.meta.url)).map((f) => `../src/${f}`),
    ];
    for (const f of files) {
      const text = readFileSync(new URL(f, import.meta.url), "utf8");
      expect(text, f).not.toMatch(/sudoku|doku|kakuro|kenken|nikoli|number place|nanpure/i);
    }
    const manifest = JSON.parse(readFileSync(new URL("../thumbcade.json", import.meta.url), "utf8")) as { name: string; description: string };
    expect(manifest.name).toBe("Rowlock");
    expect(manifest.description.length).toBeLessThanOrEqual(120);
  });
});
