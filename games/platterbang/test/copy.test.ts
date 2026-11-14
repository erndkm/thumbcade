import { describe, expect, it } from "vitest";
import { burstWidth, fitSize, tipFor, TIPS } from "../src/copy.ts";
import { bungeeWidth } from "../src/metrics.ts";
import { TIER_LINES } from "../src/run.ts";

/** Narrowest phone the feed runs on: 360 pt; the game-over strip leaves 242 pt for its tip (rail and margins off). */
const STRIP = 242;
const SCREEN = 360 - 24;

describe("copy fits its plate", () => {
  it("every game-over tip fits the strip at 10 px or more", () => {
    for (const tip of Object.values(TIPS)) expect(bungeeWidth(`TIP: ${tip}`, 10), tip).toBeLessThanOrEqual(STRIP);
  });

  it("the tip is picked from what happened", () => {
    const base = { walls: 3, ships: 12, drops: 15, pulls: 40, coveredTaps: 0, shelved: 5, peakShelf: 3, saves: 0, magnetsUsed: 0, bestStreak: 8, bestMult: 4, fancy: 1, seconds: 60, magnetIdle: 0 };
    expect(tipFor(base, "full", 1)).toBe(TIPS.magnet);
    expect(tipFor(base, "full", 0)).toBe(TIPS.match);
    expect(tipFor({ ...base, coveredTaps: 5 }, "time", 0)).toBe(TIPS.covered);
    expect(tipFor({ ...base, walls: 0 }, "time", 0)).toBe(TIPS.wall);
    expect(tipFor({ ...base, bestMult: 2 }, "time", 0)).toBe(TIPS.streak);
    expect(tipFor({ ...base, peakShelf: 5 }, "time", 0)).toBe(TIPS.next);
    expect(tipFor(base, "time", 0)).toBe(TIPS.smash);
  });

  it("every multiplier line fits across the screen in its burst, big enough to read", () => {
    for (let m = 2; m < TIER_LINES.length; m++) {
      const text = `×${m} ${TIER_LINES[m]}`;
      const size = fitSize(text, 24, SCREEN - 48);
      expect(size, text).toBeGreaterThanOrEqual(17);
      expect(burstWidth(bungeeWidth(text, size), size)).toBeLessThanOrEqual(SCREEN);
    }
  });

  it("the big call-outs and the messages fit", () => {
    for (const w of ["WALL CLEAR!", "SPOTLESS!", "SQUEAKY CLEAN!", "CLEAN SWEEP!", "SHELF'S FULL!", "CLOSING TIME!", "NEW BEST!", "ON THE HOUSE!", "MAGNET!"]) {
      const size = fitSize(w, 36, SCREEN - 72);
      expect(size, w).toBeGreaterThanOrEqual(26);
      expect(burstWidth(bungeeWidth(w, size), size)).toBeLessThanOrEqual(SCREEN);
    }
    for (const m of ["NO JAR? IT WAITS ON THE SHELF!", "SHELF'S FULL! PICK A JAR COLOUR!", "+1 MAGNET! TAP IT WHEN THE SHELF FILLS!", "THREE FILL A JAR. KEEP 'EM COMING!", "A JAR RUSHED IN TO SAVE YOU!", "THE MAGNET YANKED IN A JAR!", "CLEAR A WALL FOR A MAGNET!", "×4! THE SHELF GROWS A SLOT!", "INTO THE MATCHING JAR!", "A DISH IS ON TOP OF IT!", "ONE PEG LEFT: IT SWINGS!", "NO PEGS LEFT: SMASH!", "LAST ORDERS!"]) {
      const size = fitSize(m, 15, SCREEN - 26);
      expect(size, m).toBeGreaterThanOrEqual(11);
    }
    for (const w of ["THE GOOD CHINA!", "SMITHEREENS!", "KER-PLINK!", "ORDER UP!", "STUCK!"]) expect(burstWidth(bungeeWidth(w, 21), 21)).toBeLessThanOrEqual(SCREEN);
  });
});
