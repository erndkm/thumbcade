import { describe, expect, it } from "vitest";
import { ALL_TIPS, BANNER_PX, BANNER_SUB_PX, BANNER_W, barLabel, MIN_W, statLine, STRIP_TEXT, TAGLINE, TAGLINE_2, tierLine, TIP_MIN_PX, TIP_PX, tipFor, TITLE } from "../src/copy.ts";
import { measure } from "../src/metrics.ts";
import { STAGES } from "../src/palette.ts";
import { GRADE_WORDS, type RunStats } from "../src/sim.ts";

const stats = (o: Partial<RunStats> = {}): RunStats => ({
  bends: 12,
  grades: { paint: 2, kissed: 2, tight: 3, clean: 2, wide: 2, scraped: 1 },
  bestStreak: 5,
  bestMult: 3,
  driftM: 120,
  drifts: 9,
  lemons: 3,
  gates: 2,
  saves: 1,
  scrapes: 1,
  presses: 14,
  end: "wide",
  maxSpeed: 22,
  ...o,
});

describe("copy fits its plate", () => {
  it("every game-over tip fits the strip on the narrowest phone", () => {
    for (const t of ALL_TIPS) expect(measure(t, "light", TIP_MIN_PX, 0.6), t).toBeLessThanOrEqual(STRIP_TEXT);
    // Most fit at full size on the narrowest phone; all do on a 390 px one.
    expect(ALL_TIPS.filter((t) => measure(t, "light", TIP_PX, 0.6) <= STRIP_TEXT).length).toBeGreaterThanOrEqual(ALL_TIPS.length - 4);
    for (const t of ALL_TIPS) expect(measure(t, "light", TIP_PX, 0.6), t).toBeLessThanOrEqual(STRIP_TEXT + 30);
  });

  it("the tip comes from what happened, and is always one the strip was measured for", () => {
    const cases: Array<[Partial<RunStats>, number, string]> = [
      [{ end: "inside" }, 0, "let go sooner"],
      [{ end: "wide", presses: 2, bends: 9 }, 0, "press as each bend"],
      [{ end: "wide" }, 0, "hold a moment longer"],
      [{ end: null, scrapes: 4 }, 0, "gravel"],
      [{ end: null, scrapes: 0, bends: 8, grades: { paint: 0, kissed: 0, tight: 1, clean: 1, wide: 6, scraped: 0 } }, 0, "earlier"],
      [{ end: null, scrapes: 0, grades: { paint: 0, kissed: 3, tight: 3, clean: 3, wide: 1, scraped: 0 } }, 0, "painted edge"],
      [{ end: null, scrapes: 0 }, 5, "lemons"],
      [{ end: null, scrapes: 0, saves: 0, gates: 2 }, 0, "earns a crate"],
    ];
    for (const [o, missed, word] of cases) {
      const tip = tipFor({ stats: stats(o), lemonsMissed: missed });
      expect(tip).toContain(word);
      expect(ALL_TIPS).toContain(tip);
    }
  });

  it("the strip's stat line and bar label fit, for any run", () => {
    for (const metres of [0, 87, 999, 1000, 9_999, 54_321]) {
      for (const bends of [0, 1, 9, 140]) {
        for (const g of [null, "paint", "kissed", "tight", "clean"] as const) {
          const grades = { paint: 0, kissed: 0, tight: 0, clean: 0, wide: 1, scraped: 0 };
          if (g) grades[g] = 1;
          const line = statLine(metres, stats({ bends, grades }));
          expect(measure(line, "medium", 10, 1.6), line).toBeLessThanOrEqual(STRIP_TEXT);
        }
      }
    }
    const fmt = (n: number) => n.toLocaleString("en-US");
    for (const l of [barLabel(true, 99_999, 12_345, 1, fmt), barLabel(true, 500, null, 1, fmt), barLabel(false, 10, 900_000, 0.01, fmt)])
      expect(measure(l, "light", 14, 1.2), l).toBeLessThanOrEqual(STRIP_TEXT);
  });

  it("every banner fits the narrowest phone", () => {
    const words = [...STAGES.map((s) => s.name), ...[2, 3, 4, 5].map(tierLine), "saved by the crate", "over the wall", "off the road", "new best"];
    const scale = Math.min(1, MIN_W / 390);
    for (const w of words) expect(measure(w, "light", BANNER_PX * scale, BANNER_PX * scale * 0.08) + 36, w).toBeLessThanOrEqual(BANNER_W);
    for (const sub of ["it went over. you didn't.", "1.9 km · a spare crate", "14 clean in a row", "123,456"])
      expect(measure(sub, "medium", BANNER_SUB_PX, 2.4) + 36, sub).toBeLessThanOrEqual(BANNER_W);
  });

  it("the title card fits beside the action rail", () => {
    const avail = MIN_W - 72 - 28;
    const size = Math.min(54 * 0.92, avail / 5.2);
    expect(measure(TITLE, "light", size, size * 0.1)).toBeLessThanOrEqual(Math.min(avail, size * 5.6));
    for (const t of [TAGLINE, TAGLINE_2]) expect(measure(t, "medium", 11 * 0.92, 2 * 0.92), t).toBeLessThanOrEqual(Math.min(avail, size * 5.6) - 12);
  });

  it("every named line fits a popup beside the cart", () => {
    for (const w of Object.values(GRADE_WORDS)) expect(measure(`${w} +2,400`, "medium", 18 * 1.15, 1.2) + 14).toBeLessThanOrEqual(MIN_W - 140 + 140);
  });
});
